// Discover: the built-in collection of original Hebrew recipes, by category.
import { icon, esc, fmtMinutes } from '../util.js';
import { recipeCard, recipeArt } from '../ui.js';
import { SEEDS, savedCopyOf } from '../lookup.js';
import { searchRecipes } from './library.js';

let cat = '';
let q = '';
const CATS = ['ארוחות עיקריות', 'תוספות', 'סלטים', 'מרקים', 'ארוחות בוקר', 'אפייה', 'קינוחים', 'טבעוני'];

function pickOfDay() {
  const d = new Date(); const n = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  return SEEDS[n % SEEDS.length];
}

function list() {
  let l = SEEDS;
  if (cat === 'quick') l = l.filter((r) => (r.prepTime || 0) + (r.cookTime || 0) <= 30);
  else if (cat) l = l.filter((r) => r.category === cat);
  if (q.trim()) l = searchRecipes(l, q);
  return l;
}

function gridHtml() {
  const l = list();
  if (!l.length) return `<div class="empty"><div class="empty-art">${icon('search', '', 40)}</div><h2>לא נמצא</h2><p>נסו מילה אחרת או קטגוריה אחרת.</p></div>`;
  return `<div class="grid stagger">${l.map((r) => recipeCard({ ...r, favorite: !!savedCopyOf(r.id) }, `#/recipe/${r.id}`)).join('')}</div>`;
}

export function render() {
  const pick = pickOfDay();
  const html = `
    <div class="big-title" style="padding-top:calc(env(safe-area-inset-top) + 16px);margin-top:calc(-1 * env(safe-area-inset-top))"><p>מתכונים מקוריים של בישולון</p><h1>גלו</h1></div>
    <a class="rcard" href="#/recipe/${pick.id}" style="margin:8px var(--gutter) 4px;flex-direction:row;align-items:stretch">
      <div style="width:42%;flex:none">${recipeArt(pick)}</div>
      <div class="rcard-body" style="justify-content:center;gap:6px">
        <span class="tag" style="align-self:flex-start">${icon('sparkles', '', 12).replace('class="ic ', 'style="display:inline;vertical-align:-1px" class="ic ')} המתכון של היום</span>
        <h3 style="font-size:18px">${esc(pick.title)}</h3>
        <p class="meta">${icon('clock', '', 14)}<span>${fmtMinutes(pick.prepTime + pick.cookTime)}</span></p>
      </div>
    </a>
    <div class="search" style="position:sticky;padding-top:calc(env(safe-area-inset-top) + 8px)">
      <label class="search-box">${icon('search', '', 20)}<input type="search" id="dq" placeholder="חיפוש במתכונים…" value="${esc(q)}" enterkeyhint="search"></label>
    </div>
    <div class="chips" id="cats">
      <button class="chip" data-cat="" aria-pressed="${!cat}">הכל</button>
      <button class="chip" data-cat="quick" aria-pressed="${cat === 'quick'}">${icon('timer', '', 16)}עד 30 דק׳</button>
      ${CATS.map((c) => `<button class="chip" data-cat="${c}" aria-pressed="${cat === c}">${c}</button>`).join('')}
    </div>
    <div id="dgrid" style="margin-top:4px">${gridHtml()}</div>`;
  return {
    html, tab: 'discover', live: ['recipes'],
    mount(root) {
      const g = root.querySelector('#dgrid');
      root.querySelector('#cats').addEventListener('click', (e) => {
        const c = e.target.closest('[data-cat]'); if (!c) return;
        cat = c.dataset.cat;
        root.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', x === c));
        g.innerHTML = gridHtml();
      });
      const inp = root.querySelector('#dq');
      inp.addEventListener('input', () => { q = inp.value; g.innerHTML = gridHtml(); });
    },
  };
}
