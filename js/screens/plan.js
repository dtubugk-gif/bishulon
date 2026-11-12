// Meal planner: a week (Sunday–Saturday), recipes per day and meal, and one tap to put
// the whole week's ingredients on the shopping list.
import { state, put, remove, putMany } from '../db.js';
import { icon, esc, dayKey, uid } from '../util.js';
import { recipeArt, sheet, toast, emptyState } from '../ui.js';
import { findRecipe, SEEDS } from '../lookup.js';
import { itemsFromIngredients, mergeInto } from '../shopping.js';
import { searchRecipes } from './library.js';

let weekOffset = 0;
const MEAL = { breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', other: 'אחר' };
const ORDER = { breakfast: 0, lunch: 1, dinner: 2, other: 3 };

function weekDays() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + weekOffset * 7);
  return [...Array(7)].map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function render() {
  const days = weekDays();
  const today = dayKey(new Date());
  const keys = new Set(days.map(dayKey));
  const weekPlans = state.plan.filter((p) => keys.has(p.date));
  const fmt = (d) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  const label = weekOffset === 0 ? 'השבוע' : weekOffset === 1 ? 'שבוע הבא' : weekOffset === -1 ? 'שבוע שעבר' : `${fmt(days[0])} – ${fmt(days[6])}`;

  const html = `
    <div class="big-title" style="padding-top:calc(env(safe-area-inset-top) + 16px);margin-top:calc(-1 * env(safe-area-inset-top))"><p>מה מבשלים השבוע?</p><h1>תכנון ארוחות</h1></div>
    <div class="week-nav">
      <button class="icon-btn" data-act="prevw" aria-label="השבוע הקודם">${icon('chevron-right')}</button>
      <div class="grow">${label}<div class="hint">${fmt(days[0])} – ${fmt(days[6])}</div></div>
      <button class="icon-btn" data-act="nextw" aria-label="השבוע הבא">${icon('chevron-left')}</button>
    </div>
    ${weekPlans.length ? `<div style="padding:4px var(--gutter) 0"><button class="btn herb block" data-act="week-shop">${icon('shopping-cart', '', 20)}כל מצרכי השבוע לרשימת הקניות</button></div>` : ''}
    <div class="days">
      ${days.map((d) => {
        const k = dayKey(d);
        const items = state.plan.filter((p) => p.date === k).sort((a, b) => ORDER[a.meal] - ORDER[b.meal]);
        return `<section class="day ${k === today ? 'today' : ''}">
          <div class="day-head">
            <div class="day-date"><b class="num">${d.getDate()}</b><small>${d.toLocaleDateString('he-IL', { month: 'short' })}</small></div>
            <h3>${d.toLocaleDateString('he-IL', { weekday: 'long' })}${k === today ? ' <span class="sub">· היום</span>' : ''}${items.length ? '' : ' <span class="sub">· עוד לא תוכנן</span>'}</h3>
            <button class="icon-btn" data-add="${k}" aria-label="הוספת מתכון ליום ${d.toLocaleDateString('he-IL', { weekday: 'long' })}">${icon('circle-plus')}</button>
          </div>
          ${items.length ? `<div class="plan-items">${items.map((p) => {
            const r = findRecipe(p.recipeId);
            if (!r) return '';
            return `<div class="plan-item">
              <a href="#/recipe/${encodeURIComponent(r.id)}" style="display:contents">${recipeArt(r, 'thumb')}<span class="grow"><span class="meal-tag">${MEAL[p.meal] || ''}</span><b>${esc(r.title)}</b>${p.servings ? `<small>${+p.servings || ''} מנות</small>` : ''}</span></a>
              <button class="icon-btn" data-del="${p.id}" aria-label="הסרה מהתכנון">${icon('x', '', 20)}</button>
            </div>`;
          }).join('')}</div>` : ''}
        </section>`;
      }).join('')}
    </div>`;

  return {
    html, tab: 'plan', live: ['plan', 'recipes'],
    mount(root, { rerender }) {
      root.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { await remove('plan', del.dataset.del); toast('הוסר מהתכנון'); return; }
        const add = e.target.closest('[data-add]');
        if (add) { pickRecipe(add.dataset.add); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'prevw') { weekOffset--; rerender(); }
        else if (b.dataset.act === 'nextw') { weekOffset++; rerender(); }
        else if (b.dataset.act === 'week-shop') {
          let items = [];
          for (const p of weekPlans) {
            const r = findRecipe(p.recipeId); if (!r) continue;
            const f = r.servings && p.servings ? p.servings / r.servings : 1;
            items = items.concat(itemsFromIngredients(r.ingredients || [], f, r));
          }
          const { list, changed } = mergeInto(state.shop, items);
          await putMany('shop', list.filter((x) => changed.includes(x)));
          toast(`${items.length} מצרכים נוספו לרשימת הקניות`, { action: 'לרשימה', onAction: () => window.__bishulon.navigate('#/shop') });
        }
      });
    },
  };
}

function pickRecipe(date) {
  let meal = 'dinner';
  let q = '';
  const mine = () => [...state.recipes].sort((a, b) => (b.lastCooked || b.createdAt || 0) - (a.lastCooked || a.createdAt || 0));
  const rows = () => {
    const all = [...mine(), ...SEEDS.filter((s) => !state.recipes.some((r) => r.seedId === s.id))];
    const l = q.trim() ? searchRecipes(all, q) : all;
    if (!l.length) return emptyState({ ic: 'search', title: 'לא נמצא', text: 'נסו מילה אחרת.' });
    return l.slice(0, 60).map((r) => `<button class="row" data-pick="${r.id}" style="width:100%;text-align:start;margin-bottom:8px">${recipeArt(r, 'thumb')}<span class="grow"><h3>${esc(r.title)}</h3><span class="sub">${r.seed ? 'מהאוסף של בישולון' : 'מהספר שלי'}</span></span>${icon('circle-plus', '', 22)}</button>`).join('');
  };
  sheet({
    title: `מה מבשלים ב${new Date(date).toLocaleDateString('he-IL', { weekday: 'long' })}?`,
    full: true,
    html: `<div class="seg" id="meal">${Object.entries(MEAL).map(([k, v]) => `<button data-meal="${k}" aria-pressed="${k === meal}">${v}</button>`).join('')}</div>
      <label class="search-box" style="margin:12px 0">${icon('search', '', 20)}<input type="search" placeholder="חיפוש מתכון…" id="pq"></label>
      <div id="prows">${rows()}</div>`,
    mount: (b, close) => {
      b.querySelector('#meal').addEventListener('click', (e) => { const c = e.target.closest('[data-meal]'); if (!c) return; meal = c.dataset.meal; b.querySelectorAll('[data-meal]').forEach((x) => x.setAttribute('aria-pressed', x === c)); });
      b.querySelector('#pq').addEventListener('input', (e) => { q = e.target.value; b.querySelector('#prows').innerHTML = rows(); });
      b.querySelector('#prows').addEventListener('click', async (e) => {
        const p = e.target.closest('[data-pick]'); if (!p) return;
        const r = findRecipe(p.dataset.pick);
        await put('plan', { id: uid(), date, meal, recipeId: r.id, servings: r.servings || null, addedAt: Date.now() });
        close(); toast(`"${r.title}" נוסף לתכנון`);
      });
    },
  });
}
