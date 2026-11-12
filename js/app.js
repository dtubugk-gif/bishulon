// בישולון – app shell: router, tab bar, timers dock, service worker.
import { load, onChange, state, getKV } from './db.js';
import { icon, $, $$, esc, fmtClock } from './util.js';
import { closeTopSheet, sheetsOpen, toast } from './ui.js';
import { initTimers, getTimers, onTimers, remainingOf, pauseTimer, resumeTimer, removeTimer, addTime, dismissDone, stopAlarm } from './timers.js';
import * as library from './screens/library.js';
import * as recipe from './screens/recipe.js';
import * as cook from './screens/cook.js';
import * as editor from './screens/editor.js';
import * as discover from './screens/discover.js';
import * as plan from './screens/plan.js';
import * as shop from './screens/shop.js';
import * as chef from './screens/chef.js';
import * as settings from './screens/settings.js';
import * as shared from './screens/shared.js';

const ROUTES = [
  [/^\/?$/, library, () => ({})],
  [/^\/album\/([^/]+)$/, library, (m) => ({ album: decodeURIComponent(m[1]) })],
  [/^\/recipe\/([^/]+)$/, recipe, (m) => ({ id: decodeURIComponent(m[1]) })],
  [/^\/cook\/([^/]+)$/, cook, (m) => ({ id: decodeURIComponent(m[1]) })],
  [/^\/edit\/([^/]+)$/, editor, (m) => ({ id: decodeURIComponent(m[1]) })],
  [/^\/discover$/, discover, () => ({})],
  [/^\/plan$/, plan, () => ({})],
  [/^\/shop$/, shop, () => ({})],
  [/^\/chef$/, chef, () => ({})],
  [/^\/settings$/, settings, () => ({})],
  [/^\/shared\/(r|l)\/(.+)$/, shared, (m) => ({ kind: m[1], data: m[2] })],
];

let current = null; // { mod, params, path, cleanup }
const scrollMemory = new Map();
let navDepth = 0;
let lastPath = null;

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

function resolve(path) {
  for (const [rx, mod, fn] of ROUTES) { const m = path.match(rx); if (m) return { mod, params: fn(m) }; }
  return { mod: library, params: {} };
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState(history.state, '', hash); else history.pushState({ depth: ++navDepth }, '', hash);
  route();
}
let leaving = false;
window.addEventListener('popstate', () => {
  while (sheetsOpen()) closeTopSheet();
  // a screen with unsaved work (the editor) can hold the user here and ask first
  if (!leaving && current?.out?.guard?.()) {
    history.pushState({ depth: ++navDepth }, '', '#' + lastPath);
    current.out.onBlockedLeave?.(() => { leaving = true; history.back(); });
    return;
  }
  leaving = false;
  route({ back: true });
});
window.addEventListener('hashchange', () => { if (location.hash.replace(/^#/, '') !== lastPath) route(); });

/** Swap in a brand-new #view element so listeners from the previous screen can never fire again. */
function freshView(html) {
  const old = $('#view');
  const v = old.cloneNode(false);
  v.innerHTML = html;
  old.replaceWith(v);
  return v;
}

function render(back = false) {
  const { path, query } = parseHash();
  const { mod, params } = resolve(path);
  if (current) {
    scrollMemory.set(current.path, window.scrollY);
    try { current.cleanup?.(); } catch (e) { console.error(e); }
  }
  const out = mod.render({ ...params, query });
  document.body.classList.toggle('no-nav', out.nav === false);
  document.body.classList.toggle('cooking', mod === cook);
  const view = freshView(out.html);
  document.title = out.title ? `${out.title} · בישולון` : 'בישולון – ספר המתכונים שלי';
  $$('.tab').forEach((t) => (t.dataset.tab === out.tab ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
  current = { mod, params, path, cleanup: null, out };
  current.cleanup = out.mount?.(view, { navigate, rerender: () => rerender() }) || null;
  const y = back ? scrollMemory.get(path) || 0 : 0;
  window.scrollTo(0, y);
}

function route({ back = false } = {}) {
  const { path, query } = parseHash();
  lastPath = path + (query.toString() ? '?' + query : ''); // set now, so the hashchange that follows a popstate is ignored
  const go = () => render(back);
  document.documentElement.classList.toggle('vt-back', back);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce && current) {
    const t = document.startViewTransition(go);
    t.finished?.catch(() => {}); t.ready?.catch(() => {});
  } else go();
}

/** Re-render the current screen in place (data changed), keeping scroll. */
function rerender() {
  if (!current) return;
  const y = window.scrollY;
  try { current.cleanup?.(); } catch { /* ignore */ }
  const { query } = parseHash();
  const out = current.mod.render({ ...current.params, query });
  const view = freshView(out.html);
  current.out = out;
  current.cleanup = out.mount?.(view, { navigate, rerender }) || null;
  window.scrollTo(0, y);
}

/* ---------------- tab bar ---------------- */
function initTabs() {
  $$('.tab .pill').forEach((p) => { p.innerHTML = icon(p.dataset.ic); });
  $$('.tab').forEach((t) => t.addEventListener('click', (e) => {
    e.preventDefault();
    const href = t.getAttribute('href');
    if (location.hash === href || (href === '#/' && !location.hash)) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    navigate(href);
  }));
  // internal links: use pushState navigation so transitions & back stack work
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || a.classList.contains('tab') || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
}
function updateBadge() {
  const n = state.shop.filter((i) => !i.checked).length;
  const b = $('#shop-badge');
  b.hidden = !n; b.textContent = n > 99 ? '99+' : n;
}

/* ---------------- timers dock (visible on every screen) ---------------- */
function renderTimers(timers) {
  const dock = $('#timer-dock');
  const visible = timers.slice(-3);
  const ids = visible.map((t) => t.id).join(',');
  if (dock.dataset.ids !== ids) {
    dock.dataset.ids = ids;
    dock.innerHTML = visible.map((t) => `
      <div class="tmr" data-id="${t.id}" role="timer">
        <i class="bar"></i>
        <span class="t-time num ltr"></span>
        <span class="t-label">${esc(t.label)}</span>
        <button class="icon-btn" data-act="plus" aria-label="הוספת דקה"><bdi class="num ltr" style="font-weight:700;font-size:14px">+1</bdi></button>
        <button class="icon-btn" data-act="toggle" aria-label="השהיה"></button>
        <button class="icon-btn" data-act="close" aria-label="סגירת טיימר">${icon('x', '', 20)}</button>
      </div>`).join('');
  }
  for (const t of visible) {
    const el = dock.querySelector(`[data-id="${t.id}"]`); if (!el) continue;
    const rem = remainingOf(t);
    el.classList.toggle('done', t.state === 'done');
    el.querySelector('.t-time').textContent = t.state === 'done' ? 'הזמן נגמר!' : fmtClock(rem);
    el.querySelector('.bar').style.transform = `scaleX(${t.total ? Math.min(1, rem / t.total) : 0})`;
    const tg = el.querySelector('[data-act="toggle"]');
    const want = t.state === 'running' ? 'pause' : t.state === 'paused' ? 'play' : 'check';
    if (tg.dataset.ic !== want) { tg.dataset.ic = want; tg.innerHTML = icon(want, '', 20); tg.setAttribute('aria-label', want === 'pause' ? 'השהיה' : want === 'play' ? 'המשך' : 'סיום'); }
  }
}
function initTimerDock() {
  $('#timer-dock').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.closest('.tmr').dataset.id;
    const t = getTimers().find((x) => x.id === id);
    if (b.dataset.act === 'close') removeTimer(id);
    else if (b.dataset.act === 'plus') addTime(id, 60);
    else if (b.dataset.act === 'toggle') {
      if (!t) return;
      if (t.state === 'running') pauseTimer(id); else if (t.state === 'paused') resumeTimer(id); else { stopAlarm(); removeTimer(id); }
    }
  });
  onTimers(renderTimers);
}

/* ---------------- theme ---------------- */
export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('bishulon-theme', JSON.stringify(theme || 'system')); } catch { /* private mode */ }
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  $$('meta[name="theme-color"]').forEach((m) => { m.content = dark ? '#14110F' : '#FAF6F1'; });
}

/* ---------------- boot ---------------- */
async function boot() {
  try { await load(); } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty"><div class="empty-art">${icon('triangle-alert', '', 40)}</div><h2>לא הצלחנו לפתוח את האחסון</h2><p>ייתכן שהדפדפן במצב פרטי. נסו לפתוח את האפליקציה בחלון רגיל.</p><div class="btns"><button class="btn filled" onclick="location.reload()">נסו שוב</button></div></div>`;
    return;
  }
  applyTheme(getKV('settings', {}).theme || 'system');
  initTabs();
  initTimerDock();
  initTimers();
  updateBadge();
  onChange((what) => {
    if (what === 'shop') updateBadge();
    if (current?.out?.live?.includes(what)) rerender();
  });
  // opened from the Android share sheet (manifest share_target): ?url=… / ?text=…
  const sp = new URLSearchParams(location.search);
  const sharedText = [sp.get('title'), sp.get('text'), sp.get('url')].filter(Boolean).join('\n');
  history.replaceState({ depth: 0 }, '', location.pathname + (location.hash || '#/'));
  route();
  if (sharedText) {
    const { linkFlow, pasteFlow } = await import('./screens/add.js');
    const link = sharedText.match(/https?:\/\/\S+/)?.[0];
    if (link) linkFlow(navigate, link); else pasteFlow(navigate, sharedText);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopSheet(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller; // first install claims the page: no reload then
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading || !hadController) return; reloading = true; location.reload(); });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) toast('גרסה חדשה של בישולון מוכנה', { action: 'עדכון', onAction: () => reg.waiting?.postMessage('skip-waiting'), ms: 12000 });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('גרסה חדשה של בישולון מוכנה', { action: 'עדכון', onAction: () => nw.postMessage('skip-waiting'), ms: 12000 });
          }
        });
      });
    }).catch(() => { /* offline support unavailable */ });
  }
  window.addEventListener('resize', () => document.documentElement.style.setProperty('--vh', `${window.innerHeight / 100}px`));
}

window.__bishulon = { navigate };
boot();
