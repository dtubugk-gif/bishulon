// Recipe view: scale servings, tick ingredients, tap a time to start a timer,
// send ingredients to the shopping list, plan it, share it, rate it.
import { state, put, remove } from '../db.js';
import { icon, esc, fmtMinutes, fmtQty, uid, dayKey, safeUrl } from '../util.js';
import { recipeArt, toast, sheet, confirmSheet, stars, promptSheet } from '../ui.js';
import { parseIngredient, scaleIngredient, findDurations, recipeToText } from '../parse.js';
import { addTimer } from '../timers.js';
import { itemsFromIngredients, mergeInto } from '../shopping.js';
import { recipeLink, shareOut } from '../share.js';
import { findRecipe, isSeed, saveSeed, savedCopyOf } from '../lookup.js';

const servingsMemo = new Map();
const checkedMemo = new Map();
export const servingsFor = (id) => servingsMemo.get(id);
export const checkedFor = (id) => { if (!checkedMemo.has(id)) checkedMemo.set(id, new Set()); return checkedMemo.get(id); };

export function stepHtml(text, recipeId, stepIdx) {
  const durs = findDurations(text);
  if (!durs.length) return esc(text);
  let out = '', i = 0;
  for (const d of durs) {
    out += esc(text.slice(i, d.index));
    out += `<button class="tchip" data-timer="${d.seconds}" data-step="${stepIdx}" aria-label="טיימר ${esc(d.text)}">${icon('timer', '', 16)}${esc(d.text)}</button>`;
    i = d.index + d.length;
  }
  return out + esc(text.slice(i));
}

export function ingredientsHtml(r, factor, checked = new Set()) {
  return (r.ingredients || []).map((line, i) => {
    const p = parseIngredient(line);
    if (!p) return '';
    if (p.header) return `<li class="ing-head">${esc(p.name)}</li>`;
    const s = scaleIngredient(p, factor);
    const q = s.qtyText ? `<bdi class="ltr">${esc(s.qtyText)}</bdi>${s.unitText ? ' ' + esc(s.unitText) : ''}` : '';
    return `<li class="ing ${checked.has(i) ? 'done' : ''}" data-ing="${i}" role="checkbox" aria-checked="${checked.has(i)}" tabindex="0">
      <span class="box">${icon('check', '', 16)}</span>
      <span class="ing-text">${q ? `<b class="num">${q}</b> ` : ''}${esc(p.qty == null ? p.raw : s.name)}${p.qty != null && s.note ? `<span class="note">, ${esc(s.note)}</span>` : ''}</span>
    </li>`;
  }).join('');
}

export async function addToShopping(r, factor) {
  const items = itemsFromIngredients(r.ingredients || [], factor, r);
  const { list, changed } = mergeInto(state.shop, items);
  const { putMany } = await import('../db.js');
  await putMany('shop', list.filter((x) => changed.includes(x)));
  return items.length;
}

export function render({ id }) {
  const r = findRecipe(id);
  if (!r) return { html: `<div class="empty" style="padding-top:80px"><div class="empty-art">${icon('search', '', 40)}</div><h2>המתכון לא נמצא</h2><p>ייתכן שנמחק.</p><div class="btns"><a class="btn filled" href="#/">לספר המתכונים</a></div></div>`, tab: 'book' };
  const seed = isSeed(id);
  const copy = seed ? savedCopyOf(id) : null;
  const base = r.servings || 0;
  let servings = servingsMemo.get(id) || base;
  const factor = () => (base && servings ? servings / base : 1);
  const checked = checkedMemo.get(id) || new Set();
  checkedMemo.set(id, checked);
  const total = (r.prepTime || 0) + (r.cookTime || 0);
  const albums = state.albums.filter((a) => (r.albums || []).includes(a.id));

  const html = `
    <div class="hero-bar" id="hb">
      <button class="icon-btn glass" data-act="back" aria-label="חזרה">${icon('arrow-right')}</button>
      <span class="grow">${esc(r.title)}</span>
      ${!seed ? `<button class="icon-btn glass" data-act="edit" aria-label="עריכה">${icon('pencil', '', 20)}</button>` : ''}
      <button class="icon-btn glass" data-act="more" aria-label="עוד פעולות">${icon('ellipsis-vertical')}</button>
    </div>
    <article class="screen">
      <div class="detail-hero">${recipeArt(r, 'hero')}</div>
      <div class="detail-title">
        <h1>${esc(r.title)}</h1>
        ${r.description ? `<p>${esc(r.description)}</p>` : ''}
        ${safeUrl(r.source?.url) ? `<a class="source-link" href="${esc(safeUrl(r.source.url))}" target="_blank" rel="noopener noreferrer">${icon('external-link', '', 16)}${esc(r.source.name || 'למקור המתכון')}</a>` : r.source?.name ? `<p class="cook-stat">${icon('chef-hat', '', 14).replace('class="ic ', 'style="display:inline;vertical-align:-2px" class="ic ')} ${esc(r.source.name)}</p>` : ''}
        ${(r.tags || []).length || albums.length || r.category ? `<div class="tags">${[r.category, ...(r.tags || [])].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${albums.map((a) => `<a class="tag" href="#/album/${a.id}" style="background:var(--surface-2);color:var(--on-surface-2)">${icon('folder', '', 12).replace('class="ic ', 'style="display:inline;vertical-align:-1px" class="ic ')} ${esc(a.name)}</a>`).join('')}</div>` : ''}
      </div>
      <div class="facts">
        <div class="fact">${icon('clock', '', 20)}<b>${total ? fmtMinutes(total) : '—'}</b><small>${r.prepTime && r.cookTime ? `הכנה ${+r.prepTime} + ${+r.cookTime}` : 'זמן כולל'}</small></div>
        <div class="fact">${icon('users', '', 20)}<b>${base || '—'}</b><small>מנות</small></div>
        <div class="fact">${icon(r.difficulty ? 'flame' : 'list', '', 20)}<b>${esc(r.difficulty || (r.ingredients || []).filter((l) => !l.startsWith('##')).length)}</b><small>${r.difficulty ? 'רמת קושי' : 'מצרכים'}</small></div>
      </div>
      <div class="cta-row">
        <a class="btn filled" href="#/cook/${encodeURIComponent(id)}">${icon('chef-hat')}מתחילים לבשל</a>
        ${seed
          ? `<button class="icon-btn ${copy ? 'on' : ''}" data-act="save-seed" aria-label="${copy ? 'שמור בספר' : 'שמירה לספר שלי'}">${icon(copy ? 'check' : 'book-heart')}</button>`
          : `<button class="icon-btn ${r.favorite ? 'on' : ''}" data-act="fav" aria-label="מועדף" aria-pressed="${!!r.favorite}">${icon('heart')}</button>`}
        <button class="icon-btn" data-act="share" aria-label="שיתוף">${icon('share-2')}</button>
      </div>
      ${seed ? `<p class="hint" style="margin-top:6px">${copy ? 'המתכון שמור בספר שלכם.' : 'מתכון מהאוסף של בישולון. שמרו אותו לספר שלכם כדי לערוך, לדרג ולהוסיף לאלבומים.'}</p>` : ''}

      <section class="block">
        <div class="block-head"><h2>מצרכים</h2>
          ${base ? `<div class="stepper" aria-label="מספר מנות"><button data-act="less" aria-label="פחות מנות">${icon('minus', '', 20)}</button><output class="num" id="sv">${servings} מנות</output><button data-act="more-s" aria-label="יותר מנות">${icon('plus', '', 20)}</button></div>` : ''}
        </div>
        <ul class="ing-list" id="ings">${ingredientsHtml(r, factor(), checked)}</ul>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn herb" data-act="to-shop" style="flex:1">${icon('shopping-cart', '', 20)}לרשימת הקניות</button>
          <button class="btn tonal" data-act="to-plan" style="flex:1">${icon('calendar-plus', '', 20)}לתכנון</button>
        </div>
      </section>

      <section class="block">
        <div class="block-head"><h2>אופן ההכנה</h2><span class="hint">${(r.steps || []).length} שלבים</span></div>
        <ol class="steps">${(r.steps || []).map((s, i) => `<li class="step"><span class="step-n num">${i + 1}</span><div class="step-t">${stepHtml(s, id, i)}</div></li>`).join('') || '<li class="hint">אין שלבים עדיין.</li>'}</ol>
      </section>

      ${r.notes || r.tips ? `<section class="block"><div class="block-head"><h2>טיפים והערות</h2></div><div class="notes-box">${esc(r.notes || r.tips)}</div></section>` : ''}

      ${!seed ? `<section class="block"><div class="block-head"><h2>הדירוג שלי</h2>${stars(r.rating, true)}</div>
        <p class="cook-stat">${r.cookCount ? `בישלתם את זה ${r.cookCount === 1 ? 'פעם אחת' : `${r.cookCount} פעמים`}${r.lastCooked ? ` · לאחרונה ${new Date(r.lastCooked).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}` : ''}` : 'עוד לא בישלתם את המתכון הזה.'}</p>
        <button class="btn text small" data-act="note" style="margin-top:4px;padding:0">${icon('notebook-pen', '', 18)}${r.notes ? 'עריכת ההערות' : 'הוספת הערה אישית'}</button></section>` : ''}
    </article>`;

  return {
    html, tab: seed ? 'discover' : 'book', title: r.title, live: ['recipes', 'albums'], nav: true,
    mount(root, { navigate, rerender }) {
      const hb = root.querySelector('#hb');
      const onScroll = () => hb.classList.toggle('scrolled', window.scrollY > 180);
      window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
      const ings = root.querySelector('#ings');
      const refreshIngs = () => { ings.innerHTML = ingredientsHtml(r, factor(), checked); const sv = root.querySelector('#sv'); if (sv) sv.textContent = `${fmtQty(servings)} מנות`; };
      const toggleIng = (li) => { const i = +li.dataset.ing; checked.has(i) ? checked.delete(i) : checked.add(i); li.classList.toggle('done', checked.has(i)); li.setAttribute('aria-checked', checked.has(i)); };
      ings.addEventListener('click', (e) => { const li = e.target.closest('[data-ing]'); if (li) toggleIng(li); });
      ings.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { const li = e.target.closest('[data-ing]'); if (li) { e.preventDefault(); toggleIng(li); } } });

      root.addEventListener('click', async (e) => {
        const tchip = e.target.closest('[data-timer]');
        if (tchip) {
          const step = +tchip.dataset.step + 1;
          addTimer(+tchip.dataset.timer, `${r.title} · שלב ${step}`, id);
          toast(`הטיימר הופעל: ${tchip.textContent.trim()}`);
          return;
        }
        const starB = e.target.closest('[data-star]');
        if (starB) { const n = +starB.dataset.star; await put('recipes', { ...r, rating: r.rating === n ? 0 : n }); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'back') { history.state?.depth > 0 ? history.back() : navigate(seed ? '#/discover' : '#/', { replace: true }); }
        else if (act === 'edit') navigate(`#/edit/${id}`);
        else if (act === 'less' || act === 'more-s') {
          const step = servings <= 2 && act === 'less' ? (servings > 1 ? 1 : 0.5) : 1;
          servings = Math.max(0.5, Math.min(99, servings + (act === 'less' ? -step : step)));
          if (servings > 1) servings = Math.round(servings);
          servingsMemo.set(id, servings); refreshIngs();
        } else if (act === 'fav') {
          await put('recipes', { ...r, favorite: !r.favorite });
          toast(!r.favorite ? 'נוסף למועדפים' : 'הוסר מהמועדפים');
        } else if (act === 'save-seed') {
          if (copy) { navigate(`#/recipe/${copy.id}`); return; }
          const c = await saveSeed(r);
          toast('נשמר בספר המתכונים שלכם', { action: 'פתיחה', onAction: () => navigate(`#/recipe/${c.id}`) });
          rerender();
        } else if (act === 'to-shop') {
          const n = await addToShopping(r, factor());
          toast(`${n} מצרכים נוספו לרשימת הקניות`, { action: 'לרשימה', onAction: () => navigate('#/shop') });
        } else if (act === 'to-plan') planSheet(r, servings);
        else if (act === 'share') shareSheet(r, factor());
        else if (act === 'note') {
          const n = await promptSheet({ title: 'הערה אישית', label: 'מה כדאי לזכור בפעם הבאה?', value: r.notes || '' });
          if (n != null) await put('recipes', { ...r, notes: n });
        } else if (act === 'more') moreSheet(r, seed, navigate);
      });
      return () => window.removeEventListener('scroll', onScroll);
    },
  };
}

function shareSheet(r, factor) {
  sheet({
    title: 'שיתוף המתכון',
    html: `<div class="menu">
      <button class="menu-item primary" data-s="link"><span class="mi-ic">${icon('link', '', 22)}</span><span class="mi-text">קישור לבישולון<small>מי שיפתח יוכל לשמור את המתכון אצלו (בלי התמונה)</small></span></button>
      <button class="menu-item" data-s="text"><span class="mi-ic">${icon('file-text', '', 22)}</span><span class="mi-text">כטקסט<small>לוואטסאפ, מייל או הודעה</small></span></button>
      <button class="menu-item" data-s="copy"><span class="mi-ic">${icon('copy', '', 22)}</span><span class="mi-text">העתקה ללוח</span></button>
    </div>`,
    mount: (b, close) => b.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-s]')?.dataset.s; if (!k) return;
      const text = recipeToText(r, factor);
      close();
      if (k === 'link') { const url = await recipeLink(r); const res = await shareOut({ title: r.title, text: `${r.title} – מתכון מבישולון`, url }); if (res === 'copied') toast('הקישור הועתק'); }
      else if (k === 'text') { const res = await shareOut({ title: r.title, text }); if (res === 'copied') toast('המתכון הועתק'); }
      else { try { await navigator.clipboard.writeText(text); toast('המתכון הועתק'); } catch { toast('ההעתקה נכשלה'); } }
    }),
  });
}

export function planSheet(r, servings) {
  const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  const MEALS = [['breakfast', 'בוקר'], ['lunch', 'צהריים'], ['dinner', 'ערב'], ['other', 'אחר']];
  let day = dayKey(days[0]), meal = new Date().getHours() < 11 ? 'breakfast' : new Date().getHours() < 16 ? 'lunch' : 'dinner';
  sheet({
    title: 'הוספה לתכנון הארוחות',
    html: `<p class="hint" style="margin-bottom:8px">${esc(r.title)}</p>
      <div class="chips" style="margin:0 -20px;padding-inline:20px" id="pdays">${days.map((d, i) => `<button class="chip" data-day="${dayKey(d)}" aria-pressed="${i === 0}">${i === 0 ? 'היום' : i === 1 ? 'מחר' : d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}</button>`).join('')}</div>
      <div class="seg" id="pmeal" style="margin-top:12px">${MEALS.map(([k, v]) => `<button data-meal="${k}" aria-pressed="${k === meal}">${v}</button>`).join('')}</div>
      <div class="sheet-actions"><button class="btn filled block" data-ok>${icon('calendar-plus', '', 20)}הוספה</button></div>`,
    mount: (b, close) => {
      b.querySelector('#pdays').addEventListener('click', (e) => { const c = e.target.closest('[data-day]'); if (!c) return; day = c.dataset.day; b.querySelectorAll('[data-day]').forEach((x) => x.setAttribute('aria-pressed', x === c)); });
      b.querySelector('#pmeal').addEventListener('click', (e) => { const c = e.target.closest('[data-meal]'); if (!c) return; meal = c.dataset.meal; b.querySelectorAll('[data-meal]').forEach((x) => x.setAttribute('aria-pressed', x === c)); });
      b.querySelector('[data-ok]').addEventListener('click', async () => {
        await put('plan', { id: uid(), date: day, meal, recipeId: r.id, servings: servings || r.servings || null, addedAt: Date.now() });
        close(); toast('נוסף לתכנון', { action: 'לתכנון', onAction: () => window.__bishulon.navigate('#/plan') });
      });
    },
  });
}

function moreSheet(r, seed, navigate) {
  const items = seed ? [] : [
    ['album', 'folder-plus', 'הוספה לאלבום'],
    ['dup', 'copy', 'שכפול המתכון'],
    ['delete', 'trash-2', 'מחיקת המתכון', 'danger'],
  ];
  items.unshift(['print', 'file-text', 'הדפסה / שמירה כ-PDF']);
  sheet({
    title: r.title,
    html: `<div class="menu">${items.map(([k, ic, t, cls]) => `<button class="menu-item ${cls || ''}" data-m="${k}"><span class="mi-ic">${icon(ic, '', 20)}</span><span class="mi-text">${t}</span></button>`).join('')}</div>`,
    mount: (b, close) => b.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-m]')?.dataset.m; if (!k) return; close();
      if (k === 'print') setTimeout(() => window.print(), 300);
      else if (k === 'album') albumSheet(r);
      else if (k === 'dup') {
        const c = { ...r, id: uid(), title: `${r.title} (עותק)`, createdAt: Date.now(), updatedAt: Date.now(), cookCount: 0, lastCooked: null };
        await put('recipes', c); navigate(`#/recipe/${c.id}`);
      } else if (k === 'delete') {
        if (await confirmSheet({ title: 'למחוק את המתכון?', text: `"${r.title}" יימחק מהספר. אי אפשר לבטל את הפעולה.`, ok: 'מחיקה', danger: true })) {
          await remove('recipes', r.id);
          const plans = state.plan.filter((p) => p.recipeId === r.id);
          if (plans.length) { const { removeMany } = await import('../db.js'); await removeMany('plan', plans.map((p) => p.id)); }
          toast('המתכון נמחק'); navigate('#/', { replace: true });
        }
      }
    }),
  });
}

function albumSheet(r) {
  const render = () => state.albums.map((a) => `<button class="menu-item" data-al="${a.id}"><span class="mi-ic">${icon((r.albums || []).includes(a.id) ? 'check' : 'folder', '', 20)}</span><span class="mi-text">${esc(a.name)}</span></button>`).join('');
  sheet({
    title: 'הוספה לאלבום',
    html: `<div class="menu" id="alist">${render()}<button class="menu-item primary" data-al="__new"><span class="mi-ic">${icon('folder-plus', '', 20)}</span><span class="mi-text">אלבום חדש…</span></button></div>`,
    mount: (b, close) => b.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-al]')?.dataset.al; if (!id) return;
      if (id === '__new') {
        close();
        const name = await promptSheet({ title: 'אלבום חדש', label: 'שם האלבום' });
        if (!name) return;
        const a = { id: uid(), name, createdAt: Date.now() };
        await put('albums', a);
        await put('recipes', { ...r, albums: [...(r.albums || []), a.id] });
        toast(`נוסף לאלבום "${name}"`);
        return;
      }
      const has = (r.albums || []).includes(id);
      r = { ...r, albums: has ? r.albums.filter((x) => x !== id) : [...(r.albums || []), id] };
      await put('recipes', r);
      b.querySelector('#alist').innerHTML = render() + `<button class="menu-item primary" data-al="__new"><span class="mi-ic">${icon('folder-plus', '', 20)}</span><span class="mi-text">אלבום חדש…</span></button>`;
    }),
  });
}
