// Create / edit a recipe. Imported drafts land here so the user can check them before saving.
import { state, put, getRecipe } from '../db.js';
import { icon, esc, uid, imageToDataURL } from '../util.js';
import { toast, confirmSheet } from '../ui.js';
import { takeDraft, clearDraft } from './add.js';

const VIA = { link: 'יובא מקישור', photo: 'נקרא מצילום', voice: 'נכתב מהקלטה', paste: 'נקרא מטקסט' };

export function render({ id, query }) {
  const isNew = id === 'new';
  const draft = isNew && query.get('draft') ? takeDraft() : null;
  const base = isNew ? (draft || {}) : getRecipe(id);
  if (!base) return { html: `<div class="empty"><h2>המתכון לא נמצא</h2><a class="btn filled" href="#/">לספר המתכונים</a></div>`, nav: true };
  const r = { title: '', description: '', servings: '', prepTime: '', cookTime: '', ingredients: [], steps: [], tags: [], notes: '', albums: [], ...base };
  let image = r.image || '';
  const imageUrl = r.imageUrl || (draft?.image && /^https?:/.test(draft.image) ? draft.image : '');
  const shown = image || imageUrl;

  const html = `
    <header class="topbar" style="background:var(--bg)">
      <button class="icon-btn" data-act="cancel" aria-label="ביטול">${icon('x')}</button>
      <div class="title" style="opacity:1">${isNew ? 'מתכון חדש' : 'עריכת מתכון'}</div>
      <button class="btn filled small" data-act="save">${icon('check', '', 18)}שמירה</button>
    </header>
    <form class="screen" id="ed" autocomplete="off" novalidate>
      ${draft?.importedVia ? `<div class="notice herb">${icon('sparkles', '', 20)}<span><b>${VIA[draft.importedVia] || 'יובא'}.</b> בדקו שהמצרכים והשלבים נכונים ותקנו מה שצריך לפני השמירה.</span></div>` : ''}
      <label class="photo-pick ${shown ? 'has' : ''}" id="photo">
        ${shown ? `<img src="${esc(shown)}" alt="" referrerpolicy="no-referrer">` : ''}
        <span class="pp-label">${icon('camera', '', shown ? 18 : 28)}${shown ? 'החלפת תמונה' : 'הוספת תמונה של המנה'}</span>
        <input type="file" accept="image/*" hidden>
      </label>
      ${shown ? `<button type="button" class="btn text small" data-act="rm-photo" style="margin:-8px 0 8px">${icon('trash-2', '', 16)}הסרת התמונה</button>` : ''}
      <label class="field"><span>שם המתכון</span><input name="title" dir="auto" value="${esc(r.title)}" placeholder="למשל: עוגת שוקולד של סבתא" required enterkeyhint="next"></label>
      <label class="field"><span>תיאור קצר</span><input name="description" dir="auto" value="${esc(r.description)}" placeholder="מה מיוחד במתכון הזה?"></label>
      <div class="field-row">
        <label class="field"><span>מנות</span><input name="servings" inputmode="numeric" value="${esc(r.servings ?? '')}" placeholder="4"></label>
        <label class="field"><span>הכנה (דק׳)</span><input name="prepTime" inputmode="numeric" value="${esc(r.prepTime || '')}" placeholder="15"></label>
        <label class="field"><span>בישול (דק׳)</span><input name="cookTime" inputmode="numeric" value="${esc(r.cookTime || '')}" placeholder="30"></label>
      </div>
      <label class="field"><span>מצרכים</span>
        <textarea name="ingredients" dir="auto" rows="8" placeholder="מצרך בכל שורה, הכמות בהתחלה:&#10;2 כוסות קמח&#10;1/2 כפית מלח&#10;## לציפוי&#10;100 גרם שוקולד">${esc((r.ingredients || []).join('\n'))}</textarea>
        <small>שורה שמתחילה ב-## היא כותרת (למשל "## לרוטב"). כך הכמויות יתעדכנו כשמשנים מספר מנות.</small></label>
      <label class="field"><span>אופן ההכנה</span>
        <textarea name="steps" dir="auto" rows="10" placeholder="שלב בכל שורה:&#10;מחממים תנור ל-180 מעלות.&#10;מערבבים את כל החומרים.&#10;אופים 35 דקות.">${esc((r.steps || []).join('\n'))}</textarea>
        <small>זמנים כמו "אופים 35 דקות" יהפכו לכפתור טיימר.</small></label>
      <label class="field"><span>תגיות</span><input name="tags" dir="auto" value="${esc((r.tags || []).join(', '))}" placeholder="חלבי, מהיר, לשבת"></label>
      ${state.albums.length ? `<div class="field"><span>אלבומים</span><div class="tags" id="albums">${state.albums.map((a) => `<button type="button" class="chip" data-album="${a.id}" aria-pressed="${(r.albums || []).includes(a.id)}">${esc(a.name)}</button>`).join('')}</div></div>` : ''}
      <label class="field"><span>הערות וטיפים</span><textarea name="notes" dir="auto" rows="3" placeholder="מה כדאי לזכור בפעם הבאה?">${esc(r.notes || '')}</textarea></label>
      <label class="field"><span>מקור / קרדיט</span><input name="sourceName" dir="auto" value="${esc(r.source?.name || '')}" placeholder="שם האתר, השף או סבתא"></label>
      <label class="field"><span>קישור למקור</span><input name="sourceUrl" type="url" inputmode="url" dir="ltr" value="${esc(r.source?.url || '')}" placeholder="https://"></label>
      <button type="submit" class="btn filled block" style="margin-top:8px">${icon('check')}שמירת המתכון</button>
    </form>`;

  const out = {
    html, nav: false, title: isNew ? 'מתכון חדש' : 'עריכה',
    mount(root, { navigate }) {
      const form = root.querySelector('#ed');
      let dirty = !!draft;
      let removedImage = false;
      form.addEventListener('input', () => { dirty = true; });
      const askLeave = () => confirmSheet({ title: 'לצאת בלי לשמור?', text: draft ? 'המתכון שיובא עוד לא נשמר בספר.' : 'השינויים שעשיתם לא יישמרו.', ok: 'יציאה בלי שמירה', danger: true });
      // back gesture / Android back while there are unsaved changes
      out.guard = () => dirty;
      out.onBlockedLeave = async (proceed) => { if (await askLeave()) { dirty = false; clearDraft(); proceed(); } };
      const fileIn = root.querySelector('#photo input');
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files?.[0]; if (!f) return;
        try {
          image = await imageToDataURL(f, 1280, 0.8); dirty = true; removedImage = false;
          const pick = root.querySelector('#photo');
          pick.classList.add('has');
          pick.querySelector('img')?.remove();
          pick.insertAdjacentHTML('afterbegin', `<img src="${image}" alt="">`);
          pick.querySelector('.pp-label').innerHTML = `${icon('camera', '', 18)}החלפת תמונה`;
        } catch { toast('לא הצלחנו לטעון את התמונה'); }
      });
      root.querySelector('#albums')?.addEventListener('click', (e) => {
        const c = e.target.closest('[data-album]'); if (!c) return;
        c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'); dirty = true;
      });
      const save = async () => {
        const f = new FormData(form);
        const title = String(f.get('title') || '').trim();
        if (!title) {
          const t = form.querySelector('[name=title]'); t.focus();
          t.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 300, iterations: 1 });
          toast('צריך לתת למתכון שם'); return;
        }
        const lines = (k) => String(f.get(k) || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const num = (k) => { const n = parseInt(String(f.get(k) || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
        const albums = [...root.querySelectorAll('#albums [aria-pressed="true"]')].map((c) => c.dataset.album);
        const sUrl = String(f.get('sourceUrl') || '').trim();
        const sName = String(f.get('sourceName') || '').trim();
        const rec = {
          ...(isNew ? { id: uid(), createdAt: Date.now(), favorite: false, rating: 0, cookCount: 0 } : getRecipe(id)),
          title, description: String(f.get('description') || '').trim(),
          servings: num('servings'), prepTime: num('prepTime') || 0, cookTime: num('cookTime') || 0,
          ingredients: lines('ingredients').map((l) => l.replace(/^[•\-–*·]\s*/, '')), steps: lines('steps').map((l) => l.replace(/^\d+[.)]\s*/, '')),
          tags: String(f.get('tags') || '').split(/[,،]/).map((t) => t.trim()).filter(Boolean),
          albums, notes: String(f.get('notes') || '').trim(),
          source: sUrl || sName ? { url: sUrl, name: sName } : null,
          image: removedImage ? '' : image, imageUrl: removedImage ? '' : (image ? '' : imageUrl),
          updatedAt: Date.now(),
        };
        await put('recipes', rec);
        dirty = false; clearDraft();
        toast(isNew ? 'המתכון נשמר בספר' : 'השינויים נשמרו');
        navigate(`#/recipe/${rec.id}`, { replace: true });
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'save') save();
        else if (b.dataset.act === 'rm-photo') {
          removedImage = true; image = ''; dirty = true;
          const pick = root.querySelector('#photo'); pick.classList.remove('has'); pick.querySelector('img')?.remove();
          pick.querySelector('.pp-label').innerHTML = `${icon('camera', '', 28)}הוספת תמונה של המנה`; b.remove();
        } else if (b.dataset.act === 'cancel') {
          if (dirty && !(await askLeave())) return;
          dirty = false; clearDraft();
          history.state?.depth > 0 ? history.back() : navigate('#/', { replace: true });
        }
      });
      const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', warn);
      if (isNew && !draft) setTimeout(() => form.querySelector('[name=title]').focus(), 350);
      return () => window.removeEventListener('beforeunload', warn);
    },
  };
  return out;
}
