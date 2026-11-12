// Shared UI pieces: toast, bottom sheets, confirm dialogs, recipe cards & art.
import { esc, icon, fmtMinutes, norm } from './util.js';
import { ICONS } from './icons.js';

/* ---------------- toast ---------------- */
let toastT;
export function toast(msg, { action, onAction, ms = 3800 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action)}</button>` : ''}`;
  el.classList.add('show');
  el.querySelector('.toast-btn')?.addEventListener('click', () => { el.classList.remove('show'); onAction?.(); });
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- bottom sheet ---------------- */
const sheetStack = [];
/** Open a bottom sheet. `build(body, close)` fills it. Returns close(). */
export function sheet({ title = '', html = '', mount, className = '', onClose, full = false } = {}) {
  const root = document.getElementById('sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="scrim"></div>
    <section class="sheet ${full ? 'full' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab" aria-hidden="true"></div>
      ${title ? `<header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="סגירה">${icon('x')}</button></header>` : ''}
      <div class="sheet-body">${html}</div>
    </section>`;
  root.appendChild(wrap);
  const panel = wrap.querySelector('.sheet');
  let closed = false;
  const close = (val) => {
    if (closed) return; closed = true;
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    const i = sheetStack.indexOf(close); if (i >= 0) sheetStack.splice(i, 1);
    setTimeout(() => wrap.remove(), 260);
    onClose?.(val);
  };
  sheetStack.push(close);
  wrap.querySelector('.scrim').addEventListener('click', () => close());
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
  dragToClose(panel, wrap.querySelector('.grab'), close);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  mount?.(wrap.querySelector('.sheet-body'), close, panel);
  setTimeout(() => panel.querySelector('[autofocus]')?.focus(), 320);
  return close;
}
export const closeTopSheet = () => { const c = sheetStack[sheetStack.length - 1]; if (c) { c(); return true; } return false; };
export const sheetsOpen = () => sheetStack.length;

function dragToClose(panel, handle, close) {
  let y0 = null, dy = 0, t0 = 0;
  const head = panel.querySelector('.sheet-head');
  const start = (e) => { y0 = e.clientY; dy = 0; t0 = performance.now(); panel.style.transition = 'none'; (e.target).setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; };
  const end = () => {
    if (y0 == null) return;
    const v = dy / Math.max(1, performance.now() - t0);
    panel.style.transition = ''; panel.style.transform = '';
    if (dy > panel.offsetHeight * 0.35 || v > 0.6) close();
    y0 = null;
  };
  for (const el of [handle, head].filter(Boolean)) {
    el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; start(e); });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}

export function confirmSheet({ title, text, ok = 'אישור', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    sheet({
      title,
      html: `<p class="sheet-text">${esc(text)}</p>
        <div class="sheet-actions"><button class="btn tonal" data-close>ביטול</button><button class="btn ${danger ? 'danger' : 'filled'}" data-ok>${esc(ok)}</button></div>`,
      mount: (b, close) => b.querySelector('[data-ok]').addEventListener('click', () => { result = true; close(); }),
      onClose: () => resolve(result),
    });
  });
}

export function promptSheet({ title, label = '', value = '', ok = 'שמירה', placeholder = '' }) {
  return new Promise((resolve) => {
    let result = null;
    sheet({
      title,
      html: `<label class="field"><span>${esc(label)}</span><input type="text" dir="auto" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus enterkeyhint="done"></label>
        <div class="sheet-actions"><button class="btn tonal" data-close>ביטול</button><button class="btn filled" data-ok>${esc(ok)}</button></div>`,
      mount: (b, close) => {
        const inp = b.querySelector('input');
        const done = () => { result = inp.value.trim(); close(); };
        b.querySelector('[data-ok]').addEventListener('click', done);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      },
      onClose: () => resolve(result),
    });
  });
}

/* ---------------- recipe art (when there is no photo) ---------------- */
const ICON_GUESS = [
  [/מרק|ציר|soup/, 'soup'], [/סלט|salad/, 'salad'], [/עוגיי|עוגיות|cookie|ביסקוו/, 'cookie'], [/עוג|מאפינ|בראוני|טארט|פאי|cake/, 'cake'],
  [/לחמ|חלה|פיתה|בצק|קרואסונ|מאפה|bread/, 'croissant'], [/פיצה|pizza/, 'pizza'], [/כריכ|טוסט|סנדוויצ|sandwich/, 'sandwich'],
  [/דג|סלמונ|טונה|אמנונ|fish/, 'fish'], [/עופ|פרגית|שוק|כנפ|chicken/, 'drumstick'], [/בשר|בקר|קציצ|המבורגר|סטייק|beef|meat/, 'beef'],
  [/ביצ|שקשוקה|חביתה|פנקייק|egg/, 'egg'], [/קפה|שייק|משקה|coffee/, 'coffee'], [/אורז|פסטה|פתיתימ|קוסקוס|קינואה|בורגול|wheat/, 'wheat'],
  [/ירק|גזר|קישוא|חציל|carrot/, 'carrot'], [/טבעוני|עדשימ|חומוס|תרד|leaf/, 'leaf'],
];
const ART_COLORS = ['#B5654A', '#7A8B4F', '#C49A3A', '#8A6F9E', '#5E8C7D', '#B07D5B', '#9C5B5B', '#6E7F9E', '#A3804C', '#6F8C5A'];

export function guessIcon(r) {
  if (r.icon) return r.icon;
  const t = norm(`${r.title} ${(r.tags || []).join(' ')}`);
  for (const [rx, ic] of ICON_GUESS) if (rx.test(t)) return ic;
  return 'cooking-pot';
}
export function artColor(r) {
  if (r.color) return r.color;
  let h = 0; for (const ch of r.id || r.title || 'x') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ART_COLORS[h % ART_COLORS.length];
}

const SCATTER = ['carrot', 'leaf', 'wheat', 'egg', 'cooking-pot', 'utensils', 'coffee', 'cookie', 'soup', 'flame', 'salad', 'croissant'];
const artCache = new Map();

/** Illustrated cover for recipes without a photo: scattered food doodles + the dish on a plate. */
function artSvg(r, size) {
  const key = `${r.id || r.title}|${size}`;
  if (artCache.has(key)) return artCache.get(key);
  let seed = 0; for (const ch of String(r.id || r.title || 'x')) seed = (seed * 33 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const main = guessIcon(r);
  const W = 400, H = 300;
  let doodles = '';
  // jittered grid so doodles spread evenly and stay clear of the plate
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 5; gx++) {
    const x = gx * 84 + 10 + rnd() * 44, y = gy * 78 + 4 + rnd() * 40;
    if (Math.hypot(x + 14 - W / 2, y + 14 - H / 2) < 112) continue;
    const ic = rnd() < 0.3 ? main : SCATTER[Math.floor(rnd() * SCATTER.length)];
    const s = 1 + rnd() * 0.5;
    doodles += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${(rnd() * 60 - 30).toFixed(0)} 12 12) scale(${s.toFixed(2)})">${ICON_SRC(ic)}</g>`;
  }
  const svg = `<svg class="art-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g class="doodles" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${doodles}</g>
    <circle class="plate-shadow" cx="${W / 2}" cy="${H / 2 + 6}" r="84"/>
    <circle class="plate" cx="${W / 2}" cy="${H / 2}" r="84"/>
    <circle class="plate-rim" cx="${W / 2}" cy="${H / 2}" r="66"/>
    <g class="dish" transform="translate(${W / 2 - 36} ${H / 2 - 36}) scale(3)" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_SRC(main)}</g>
  </svg>`;
  artCache.set(key, svg);
  return svg;
}
const ICON_SRC = (n) => ICONS[n] || ICONS['cooking-pot'];

export function recipeArt(r, size = 'card') {
  const img = r.image || r.imageUrl;
  const fallback = `<span class="art-fallback" style="--art:${artColor(r)}">${artSvg(r, size)}</span>`;
  if (img) return `<div class="art ${size}"><img src="${esc(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noimg');this.remove()">${fallback}</div>`;
  return `<div class="art ${size} noimg" style="--art:${artColor(r)}">${fallback}</div>`;
}

export function recipeCard(r, href) {
  const time = (+r.prepTime || 0) + (+r.cookTime || 0);
  return `<a class="rcard" href="${esc(href)}" data-vt="${esc(r.id)}">
    ${recipeArt(r)}
    ${r.favorite ? `<span class="fav-dot" aria-label="מועדף">${icon('heart', '', 16)}</span>` : ''}
    <div class="rcard-body">
      <h3>${esc(r.title || 'ללא שם')}</h3>
      <p class="meta">${time ? `${icon('clock', '', 14)}<span>${fmtMinutes(time)}</span>` : ''}${+r.servings ? `${icon('users', '', 14)}<span>${+r.servings}</span>` : ''}</p>
    </div>
  </a>`;
}

export function emptyState({ ic, title, text, actions = '' }) {
  return `<div class="empty">
    <div class="empty-art">${icon(ic, '', 40)}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
    ${actions}
  </div>`;
}

export function stars(n, interactive = false) {
  let s = '<div class="stars" role="' + (interactive ? 'radiogroup' : 'img') + '" aria-label="דירוג ' + (n || 0) + ' מתוך 5">';
  for (let i = 1; i <= 5; i++) s += interactive
    ? `<button class="star ${i <= (n || 0) ? 'on' : ''}" data-star="${i}" aria-label="${i} כוכבים">${icon('star', '', 22)}</button>`
    : `<span class="star ${i <= (n || 0) ? 'on' : ''}">${icon('star', '', 14)}</span>`;
  return s + '</div>';
}
