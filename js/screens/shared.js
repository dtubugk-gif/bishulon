// Opened from a shared link: preview a recipe or a shopping list and save it.
import { state, put, putMany } from '../db.js';
import { icon, esc, uid } from '../util.js';
import { recipeArt, toast } from '../ui.js';
import { unpack, recipeFromSlim } from '../share.js';
import { parseIngredient, ingredientLine, UNIT_LABEL } from '../parse.js';
import { aisleFor, mergeInto, itemQtyText, AISLES } from '../shopping.js';

export function render({ kind, data }) {
  const html = `<header class="topbar"><a class="icon-btn" href="#/" aria-label="לדף הבית">${icon('x')}</a><div class="title" style="opacity:1">${kind === 'r' ? 'מתכון ששיתפו איתכם' : 'רשימת קניות ששיתפו איתכם'}</div></header>
    <div class="screen" id="sh"><div class="skeleton" style="height:200px;margin-top:12px"></div><div class="skeleton" style="height:24px;margin-top:16px;width:60%"></div></div>`;
  return {
    html, tab: kind === 'r' ? 'book' : 'shop',
    mount(root, { navigate }) {
      const box = root.querySelector('#sh');
      unpack(data).then((obj) => {
        if (kind === 'r') {
          const r = recipeFromSlim(obj);
          box.innerHTML = `<div style="border-radius:20px;overflow:hidden;margin-top:8px">${recipeArt({ ...r, id: r.title })}</div>
            <div class="detail-title"><h1>${esc(r.title)}</h1>${r.description ? `<p>${esc(r.description)}</p>` : ''}</div>
            <button class="btn filled block" data-save style="min-height:56px">${icon('book-heart')}שמירה בספר המתכונים שלי</button>
            <section class="block"><div class="block-head"><h2>מצרכים</h2></div><ul class="ing-list">${r.ingredients.map((l) => { const p = parseIngredient(l); return p?.header ? `<li class="ing-head">${esc(p.name)}</li>` : `<li class="ing"><span class="ing-text">${esc(p ? ingredientLine(p) : l)}</span></li>`; }).join('')}</ul></section>
            <section class="block"><div class="block-head"><h2>אופן ההכנה</h2></div><ol class="steps">${r.steps.map((s, i) => `<li class="step"><span class="step-n">${i + 1}</span><div class="step-t">${esc(s)}</div></li>`).join('')}</ol></section>`;
          box.querySelector('[data-save]').addEventListener('click', async () => {
            const dup = state.recipes.find((x) => x.title === r.title && x.ingredients.join() === r.ingredients.join());
            if (dup) { toast('המתכון כבר שמור אצלכם'); navigate(`#/recipe/${dup.id}`, { replace: true }); return; }
            const rec = { ...r, id: uid(), createdAt: Date.now(), updatedAt: Date.now(), favorite: false, rating: 0, cookCount: 0, albums: [] };
            await put('recipes', rec);
            toast('המתכון נשמר בספר שלכם');
            navigate(`#/recipe/${rec.id}`, { replace: true });
          });
        } else {
          if (!Array.isArray(obj)) throw new Error('bad');
          const n = (v) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : null);
          const items = obj.filter((x) => Array.isArray(x) && x[0]).slice(0, 300).map(([name, qty, unit, aisle, qty2]) => ({
            id: uid(), name: String(name).slice(0, 120), qty: n(qty), qty2: n(qty2), unit: UNIT_LABEL[unit] ? unit : null,
            aisle: AISLES.some((a) => a.id === aisle) ? aisle : aisleFor(String(name)), checked: false, recipes: [], addedAt: Date.now(),
          }));
          box.innerHTML = `<p class="hint" style="margin:12px 0">${items.length} פריטים</p>
            <div class="items">${items.map((it) => `<div class="item"><span class="tap"><span class="it-text">${itemQtyText(it) ? `<span class="it-qty">${esc(itemQtyText(it))}</span>` : ''}${esc(it.name)}</span></span></div>`).join('')}</div>
            <button class="btn filled block" data-add style="margin-top:16px;min-height:56px">${icon('shopping-cart')}הוספה לרשימת הקניות שלי</button>`;
          box.querySelector('[data-add]').addEventListener('click', async () => {
            const { list, changed } = mergeInto(state.shop, items);
            await putMany('shop', list.filter((x) => changed.includes(x)));
            toast('נוסף לרשימה'); navigate('#/shop', { replace: true });
          });
        }
      }).catch(() => {
        box.innerHTML = `<div class="empty"><div class="empty-art">${icon('triangle-alert', '', 40)}</div><h2>הקישור לא תקין</h2><p>ייתכן שהקישור נחתך בהעתקה. בקשו לשלוח אותו שוב.</p><div class="btns"><a class="btn filled" href="#/">לספר המתכונים</a></div></div>`;
      });
    },
  };
}
