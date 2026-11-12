// "Add a recipe" sheet: from a link, a photo (OCR), by voice, by pasting text, or by hand.
// Every route ends with the recipe saved and organised (ingredients checklist, separate steps).
import { icon, esc } from '../util.js';
import { sheet, toast } from '../ui.js';
import { importFromUrl, ocrImage, cleanOcr, stripPostMeta } from '../import.js';
import { parseRecipeText, splitLongSteps } from '../parse.js';
import { dishName, goodTitle } from '../dish.js';
import { put } from '../db.js';
import { uid } from '../util.js';
import { Dictation, voiceSupported, dictationToText } from '../voice.js';

export function setDraft(d) { try { sessionStorage.setItem('bishulon-draft', JSON.stringify(d)); } catch { /* full */ } }
/** The imported draft stays stored until it is saved or thrown away (survives re-renders). */
export function takeDraft() {
  try { return JSON.parse(sessionStorage.getItem('bishulon-draft') || 'null'); } catch { return null; }
}
export function clearDraft() { try { sessionStorage.removeItem('bishulon-draft'); } catch { /* ignore */ } }

export function openAddSheet(navigate) {
  sheet({
    title: 'הוספת מתכון',
    html: `<div class="menu">
      <button class="menu-item primary" data-k="link"><span class="mi-ic">${icon('link', '', 22)}</span><span class="mi-text">מקישור<small>אתר מתכונים, אינסטגרם, טיקטוק, יוטיוב</small></span></button>
      <button class="menu-item primary" data-k="photo"><span class="mi-ic">${icon('camera', '', 22)}</span><span class="mi-text">מצילום<small>דף מתכון, ספר בישול או צילום מסך</small></span></button>
      <button class="menu-item primary" data-k="voice"><span class="mi-ic">${icon('mic', '', 22)}</span><span class="mi-text">בהקלטה קולית<small>הקריאו את המתכון והוא ייכתב לבד</small></span></button>
      <button class="menu-item" data-k="paste"><span class="mi-ic">${icon('clipboard-paste', '', 22)}</span><span class="mi-text">הדבקת טקסט<small>מוואטסאפ, מייל או כל מקום אחר</small></span></button>
      <button class="menu-item" data-k="manual"><span class="mi-ic">${icon('notebook-pen', '', 22)}</span><span class="mi-text">כתיבה ידנית</span></button>
      <button class="menu-item" data-k="share"><span class="mi-ic">${icon('share', '', 22)}</span><span class="mi-text">ישר מאינסטגרם וטיקטוק<small>הוספת בישולון לתפריט "שיתוף"</small></span></button>
    </div>`,
    mount: (b, close) => b.addEventListener('click', (e) => {
      const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
      close();
      setTimeout(async () => ({ link: linkFlow, photo: photoFlow, voice: voiceFlow, paste: pasteFlow, manual: () => navigate('#/edit/new'), share: async () => (await import('./share-setup.js')).shareSetupSheet() })[k](navigate), 120);
    }),
  });
}

/** Keep a copy of the web photo on the phone (social media image links expire after a while). */
async function keepImage(url) {
  if (!/^https?:/.test(url || '')) return '';
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000);
    const r = await fetch(`https://wsrv.nl/?url=${encodeURIComponent(url)}&w=1280&h=1280&fit=inside&output=jpg&q=80`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return '';
    const blob = await r.blob();
    if (!blob.type.startsWith('image/') || blob.size > 2.5e6) return '';
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(''); fr.readAsDataURL(blob); });
  } catch { return ''; }
}

/** An imported recipe is saved straight into the book, already organised, and opened. */
async function toEditor(navigate, draft, how) {
  const clean = (x) => stripPostMeta(x).replace(/\s*\n+\s*/g, ' ').trim();
  const ingredients = (draft.ingredients || []).map(clean).filter(Boolean);
  const steps = splitLongSteps((draft.steps || []).map(clean).filter((x) => x.length > 1));
  if (!ingredients.length && !steps.length) { setDraft({ ...draft, importedVia: how }); navigate('#/edit/new?draft=1'); return; }
  const title = goodTitle(draft.title) ? draft.title.trim() : dishName({ ...draft, ingredients, steps }, draft.title);
  const webImg = /^https?:/.test(draft.image || '') ? draft.image : '';
  const image = webImg ? await keepImage(webImg) : '';
  const rec = {
    id: uid(), title, description: draft.description || '', servings: draft.servings || null, prepTime: draft.prepTime || 0, cookTime: draft.cookTime || 0,
    ingredients, steps, tags: draft.tags || [], notes: draft.notes || '', source: draft.source || null,
    image, imageUrl: image ? '' : webImg, importedVia: how, favorite: false, rating: 0, cookCount: 0, albums: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
  await put('recipes', rec);
  try { sessionStorage.setItem('bishulon-just-imported', rec.id); } catch { /* ignore */ }
  navigate(`#/recipe/${rec.id}`);
}

/* ---------- link ---------- */
export function linkFlow(navigate, prefill = '', { auto = false } = {}) {
  let ctrl = null;
  sheet({
    title: 'ייבוא מקישור',
    html: `<label class="field"><span>קישור למתכון</span><input type="url" inputmode="url" dir="ltr" placeholder="https://…" value="${esc(prefill)}" autofocus enterkeyhint="go"></label>
      <button class="btn tonal small" data-paste style="margin-top:-6px">${icon('clipboard-paste', '', 18)}הדבקה מהלוח</button>
      <div class="progress" hidden><i></i></div>
      <p class="hint" data-status style="margin-top:12px">אפשר להדביק קישור מאתר מתכונים או מפוסט ברשתות. נקרא את המתכון, נסדר אותו למצרכים ולשלבים וניתן לו שם – והוא יישמר בספר.</p>
      <div class="sheet-actions"><button class="btn filled block" data-go>${icon('wand-sparkles', '', 20)}ייבוא המתכון</button></div>`,
    mount: (b, close) => {
      const inp = b.querySelector('input');
      const go = b.querySelector('[data-go]');
      const status = b.querySelector('[data-status]');
      const prog = b.querySelector('.progress');
      b.querySelector('[data-paste]').addEventListener('click', async () => {
        try { const t = await navigator.clipboard.readText(); const m = t.match(/https?:\/\/\S+/); inp.value = m ? m[0] : t.trim(); } catch { toast('אין גישה ללוח – הדביקו ידנית'); inp.focus(); }
      });
      const run = async () => {
        const url = inp.value.trim();
        if (!/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}/i.test(url)) { inp.focus(); status.textContent = 'זה לא נראה כמו קישור. בדקו ונסו שוב.'; status.style.color = 'var(--error)'; return; }
        ctrl = new AbortController();
        go.disabled = true; go.innerHTML = '<span class="spin"></span>קורא את העמוד…';
        prog.hidden = false; const bar = prog.querySelector('i'); bar.style.transition = 'transform 12s cubic-bezier(.1,.7,.1,1)'; requestAnimationFrame(() => { bar.style.transform = 'scaleX(.9)'; });
        status.style.color = ''; status.textContent = 'מחפש את המצרכים ואופן ההכנה…';
        try {
          const d = await importFromUrl(url, { signal: ctrl.signal });
          go.innerHTML = '<span class="spin"></span>מסדר ושומר…';
          status.textContent = `נמצאו ${d.ingredients.length} מצרכים ו-${d.steps.length} שלבים`;
          await toEditor(navigate, d, 'link');
          close();
        } catch (e) {
          if (e.name === 'AbortError') return;
          prog.hidden = true; bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)';
          go.disabled = false; go.innerHTML = `${icon('refresh-cw', '', 20)}נסו שוב`;
          status.style.color = 'var(--error)';
          status.textContent = e.message === 'blocked' ? 'האתר הזה חוסם קריאה אוטומטית. העתיקו את טקסט המתכון והשתמשו ב"הדבקת טקסט".'
            : e.message === 'no-recipe' ? 'לא מצאנו מתכון בעמוד הזה. אם המתכון כתוב בתיאור או בתמונה – נסו "הדבקת טקסט" או "מצילום".'
              : 'לא הצלחנו לפתוח את הקישור. בדקו שיש אינטרנט ונסו שוב.';
          if (e.message !== 'network') status.insertAdjacentHTML('beforeend', ` <button class="btn text small" data-tp>הדבקת טקסט במקום</button>`);
          status.querySelector('[data-tp]')?.addEventListener('click', () => { close(); setTimeout(() => pasteFlow(navigate), 150); });
        }
      };
      go.addEventListener('click', run);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      if (auto && prefill) setTimeout(run, 250); // came from the share menu: start right away
    },
    onClose: () => ctrl?.abort(),
  });
}

/* ---------- photo / OCR ---------- */
export function photoFlow(navigate) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0]; if (!file) return;
    let cancelled = false;
    sheet({
      title: 'קורא את המתכון מהתמונה',
      html: `<img alt="" style="width:100%;max-height:34vh;object-fit:contain;border-radius:16px;background:var(--surface-2)">
        <div class="progress"><i></i></div><p class="hint" data-status>מתחיל…</p>
        <p class="hint" style="margin-top:8px">הזיהוי נעשה בטלפון עצמו. אחרי הקריאה תוכלו לתקן את הטקסט.</p>`,
      mount: async (b, close) => {
        const img = b.querySelector('img'); const url = URL.createObjectURL(file); img.src = url;
        const bar = b.querySelector('.progress i'); const st = b.querySelector('[data-status]');
        try {
          const text = cleanOcr(await ocrImage(file, (p, label) => { bar.style.transform = `scaleX(${p})`; st.textContent = label; }));
          if (cancelled) return;
          URL.revokeObjectURL(url); close();
          if (text.replace(/\s/g, '').length < 20) { toast('לא הצלחנו לקרוא טקסט מהתמונה. נסו צילום חד וישר יותר.'); return; }
          setTimeout(() => pasteFlow(navigate, text, 'photo'), 150);
        } catch {
          st.style.color = 'var(--error)';
          st.textContent = 'זיהוי הטקסט צריך חיבור לאינטרנט בפעם הראשונה (להורדת מילון העברית). בדקו את החיבור ונסו שוב.';
        }
      },
      onClose: () => { cancelled = true; },
    });
  });
  input.click();
}

/* ---------- voice dictation ---------- */
export function voiceFlow(navigate) {
  if (!voiceSupported) { toast('הקלטה קולית לא נתמכת בדפדפן הזה. באייפון – פתחו בספארי.'); return; }
  let dict = null;
  sheet({
    title: 'הקריאו את המתכון',
    html: `<p class="hint">אמרו את שם המתכון, אחר כך <b>"מצרכים"</b> וכל מצרך, ואז <b>"אופן הכנה"</b> והשלבים. אפשר לומר <b>"שורה חדשה"</b> בין פריטים.</p>
      <button class="big-mic" data-mic aria-label="התחלת הקלטה">${icon('mic', '', 36)}</button>
      <p class="hint" data-st style="text-align:center">לחצו על המיקרופון כדי להתחיל</p>
      <div class="dict-box" data-ph="הטקסט יופיע כאן תוך כדי דיבור…"></div>
      <div class="sheet-actions"><button class="btn filled block" data-done disabled>${icon('check', '', 20)}סיימתי – למלא את המתכון</button></div>`,
    mount: (b, close) => {
      const mic = b.querySelector('[data-mic]'); const box = b.querySelector('.dict-box'); const st = b.querySelector('[data-st]'); const done = b.querySelector('[data-done]');
      let text = '';
      dict = new Dictation({
        onText: (t) => { text = t; box.textContent = dictationToText(t); done.disabled = !t; box.scrollTop = box.scrollHeight; },
        onState: (s) => {
          mic.classList.toggle('live', s === 'listening');
          st.textContent = s === 'listening' ? 'מקשיב… דברו בקצב רגיל' : s === 'blocked' ? 'אין הרשאה למיקרופון / להכתבה. באייפון: הגדרות ← Siri ← הפעלת הכתבה, ואשרו גישה למיקרופון.' : 'ההקלטה הופסקה';
        },
      });
      mic.addEventListener('click', () => {
        if (dict.active) { dict.stop(); mic.classList.remove('live'); st.textContent = 'מושהה – לחצו להמשך'; }
        else dict.start();
      });
      done.addEventListener('click', () => {
        dict.stop(); close();
        const draft = parseRecipeText(dictationToText(text));
        toEditor(navigate, draft, 'voice');
      });
    },
    onClose: () => dict?.stop(),
  });
}

/* ---------- paste text ---------- */
export function pasteFlow(navigate, prefill = '', how = 'paste') {
  sheet({
    title: how === 'photo' ? 'הטקסט שזוהה' : 'הדבקת מתכון',
    full: true,
    html: `<p class="hint" style="margin-bottom:10px">${how === 'photo' ? 'בדקו ותקנו מה שצריך – אחר כך נחלק לבד למצרכים ולשלבים.' : 'הדביקו את כל המתכון. נזהה לבד את השם, המצרכים, השלבים, הזמנים ומספר המנות.'}</p>
      <label class="field"><span class="sr-only">טקסט המתכון</span><textarea dir="auto" style="min-height:46dvh" placeholder="עוגת שוקולד&#10;מצרכים:&#10;2 כוסות קמח&#10;…&#10;אופן ההכנה:&#10;1. מחממים תנור…">${esc(prefill)}</textarea></label>
      <div class="sheet-actions">${how !== 'photo' ? `<button class="btn tonal" data-clip>${icon('clipboard-paste', '', 18)}הדבקה</button>` : ''}<button class="btn filled" data-go>${icon('wand-sparkles', '', 20)}למלא את המתכון</button></div>`,
    mount: (b, close) => {
      const ta = b.querySelector('textarea');
      b.querySelector('[data-clip]')?.addEventListener('click', async () => { try { ta.value = await navigator.clipboard.readText(); } catch { toast('אין גישה ללוח – לחצו לחיצה ארוכה בתיבה ובחרו "הדבקה"'); ta.focus(); } });
      b.querySelector('[data-go]').addEventListener('click', () => {
        const t = ta.value.trim();
        if (t.length < 10) { ta.focus(); toast('הדביקו קודם את טקסט המתכון'); return; }
        const m = t.match(/^https?:\/\/\S+$/);
        close();
        if (m) { setTimeout(() => linkFlow(navigate, m[0]), 150); return; }
        toEditor(navigate, parseRecipeText(t), how);
      });
    },
  });
}
