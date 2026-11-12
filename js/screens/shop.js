// Shopping list sorted by supermarket aisle; add by typing or speaking; share with family.
import { state, put, putMany, remove, removeMany, onChange } from '../db.js';
import { icon, esc, uid } from '../util.js';
import { sheet, toast, confirmSheet, emptyState, promptSheet } from '../ui.js';
import { AISLES, itemQtyText, itemFromText, mergeInto, listToText, aisleFor } from '../shopping.js';
import { listLink, shareOut } from '../share.js';
import { Dictation, voiceSupported } from '../voice.js';

const qtyHtml = (it) => { const t = itemQtyText(it); const m = t.match(/^(\S+)(.*)$/); return m ? `<bdi class="ltr">${esc(m[1])}</bdi>${esc(m[2])}` : esc(t); };

function itemHtml(it) {
  const from = (it.recipes || []).map((r) => r.title).join(' · ');
  return `<div class="item ${it.checked ? 'checked' : ''}" data-id="${it.id}">
    <button class="tap" data-toggle aria-pressed="${it.checked}">
      <span class="box">${icon('check', '', 14)}</span>
      <span class="it-text"><span class="it-name">${itemQtyText(it) ? `<span class="it-qty num">${qtyHtml(it)}</span>` : ''}${esc(it.name)}</span>${from ? `<span class="it-from">${esc(from)}</span>` : ''}</span>
    </button>
    <button class="icon-btn" data-edit aria-label="עריכה">${icon('ellipsis-vertical', '', 20)}</button>
  </div>`;
}

function listHtml() {
  const items = state.shop;
  if (!items.length) {
    return emptyState({ ic: 'shopping-cart', title: 'הרשימה ריקה', text: 'הוסיפו מוצרים למעלה, או לחצו "לרשימת הקניות" בתוך מתכון – המצרכים יסודרו לבד לפי מחלקות בסופר.' });
  }
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  let h = '';
  for (const a of AISLES) {
    const its = open.filter((i) => (i.aisle || 'other') === a.id).sort((x, y) => x.name.localeCompare(y.name, 'he'));
    if (!its.length) continue;
    h += `<section class="aisle"><div class="aisle-head">${icon(a.icon, '', 18)}${a.name}<span class="hint" style="margin-inline-start:auto">${its.length}</span></div><div class="items">${its.map(itemHtml).join('')}</div></section>`;
  }
  if (!open.length) h += `<div class="empty" style="padding:24px"><div class="empty-art" style="background:var(--accent-container);color:var(--on-accent-container)">${icon('circle-check', '', 40)}</div><h2>הכל בסל!</h2></div>`;
  if (done.length) h += `<section class="aisle"><div class="aisle-head">${icon('check', '', 18)}בסל (${done.length})<button class="btn text small" data-act="clear-done" style="margin-inline-start:auto">ניקוי</button></div><div class="items">${done.map(itemHtml).join('')}</div></section>`;
  return h;
}

const headHtml = () => `<div class="grow"><div class="big-title" style="padding:8px 0 0"><p>${state.shop.filter((i) => !i.checked).length || 'אין'} פריטים לקנות</p><h1>רשימת קניות</h1></div></div>
      ${state.shop.length ? `<button class="icon-btn" data-act="share" aria-label="שיתוף הרשימה">${icon('share-2')}</button><button class="icon-btn" data-act="menu" aria-label="עוד">${icon('ellipsis-vertical')}</button>` : ''}`;

export function render() {
  const html = `
    <div class="head-row" id="shead">${headHtml()}</div>
    <form class="add-bar" id="addf" style="position:sticky">
      <label class="search-box">${icon('plus', '', 20)}<input id="newi" dir="auto" placeholder="הוספת מוצר… (למשל: 2 ק״ג תפוחים)" enterkeyhint="done" autocomplete="off">
        ${voiceSupported ? `<button type="button" class="icon-btn" data-act="voice" aria-label="הוספה בקול">${icon('mic', '', 20)}</button>` : ''}
      </label>
    </form>
    <div id="slist">${listHtml()}</div>`;

  return {
    html, tab: 'shop',
    mount(root) {
      const inp = root.querySelector('#newi');
      // update only the list (not the add bar) so the keyboard stays open while adding items
      const off = onChange((what) => { if (what !== 'shop') return; root.querySelector('#slist').innerHTML = listHtml(); root.querySelector('#shead').innerHTML = headHtml(); });
      const addText = async (text) => {
        const parts = text.split(/[,\n]|\s+וגם\s+/).map((s) => s.trim()).filter(Boolean);
        const items = parts.map(itemFromText).filter(Boolean);
        if (!items.length) return;
        const { list, changed } = mergeInto(state.shop, items);
        await putMany('shop', list.filter((x) => changed.includes(x)));
      };
      root.querySelector('#addf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const t = inp.value.trim(); if (!t) return;
        inp.value = '';
        inp.focus();
        await addText(t);
      });
      root.addEventListener('click', async (e) => {
        const item = e.target.closest('.item');
        if (item && e.target.closest('[data-toggle]')) {
          const it = state.shop.find((x) => x.id === item.dataset.id);
          item.classList.toggle('checked');
          await put('shop', { ...it, checked: !it.checked, checkedAt: Date.now() });
          return;
        }
        if (item && e.target.closest('[data-edit]')) { editItem(state.shop.find((x) => x.id === item.dataset.id)); return; }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'clear-done') { await removeMany('shop', state.shop.filter((i) => i.checked).map((i) => i.id)); toast('הפריטים שנקנו נוקו'); }
        else if (act === 'share') shareList();
        else if (act === 'voice') voiceAdd(addText);
        else if (act === 'menu') {
          sheet({
            title: 'רשימת הקניות',
            html: `<div class="menu">
              <button class="menu-item" data-m="uncheck"><span class="mi-ic">${icon('rotate-ccw', '', 20)}</span><span class="mi-text">ביטול כל הסימונים</span></button>
              <button class="menu-item" data-m="copy"><span class="mi-ic">${icon('copy', '', 20)}</span><span class="mi-text">העתקה כטקסט</span></button>
              <button class="menu-item danger" data-m="clear"><span class="mi-ic">${icon('trash-2', '', 20)}</span><span class="mi-text">מחיקת כל הרשימה</span></button></div>`,
            mount: (bd, close) => bd.addEventListener('click', async (ev) => {
              const m = ev.target.closest('[data-m]')?.dataset.m; if (!m) return; close();
              if (m === 'uncheck') await putMany('shop', state.shop.map((i) => ({ ...i, checked: false })));
              else if (m === 'copy') { try { await navigator.clipboard.writeText(listToText(state.shop)); toast('הרשימה הועתקה'); } catch { toast('ההעתקה נכשלה'); } }
              else if (m === 'clear' && await confirmSheet({ title: 'למחוק את כל הרשימה?', text: `${state.shop.length} פריטים יימחקו.`, ok: 'מחיקה', danger: true })) {
                const backup = [...state.shop];
                await removeMany('shop', backup.map((i) => i.id));
                toast('הרשימה נמחקה', { action: 'ביטול', onAction: () => putMany('shop', backup) });
              }
            }),
          });
        }
      });
      return off;
    },
  };
}

function editItem(it) {
  if (!it) return;
  sheet({
    title: 'עריכת פריט',
    html: `<label class="field"><span>מוצר וכמות</span><input id="ei" dir="auto" value="${esc([itemQtyText(it), it.name].filter(Boolean).join(' '))}" enterkeyhint="done"></label>
      <label class="field"><span>מחלקה</span><select id="ea">${AISLES.map((a) => `<option value="${a.id}" ${a.id === (it.aisle || 'other') ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label>
      <div class="sheet-actions"><button class="btn tonal" data-del style="color:var(--error)">${icon('trash-2', '', 18)}מחיקה</button><button class="btn filled" data-ok>שמירה</button></div>`,
    mount: (b, close) => {
      const save = async () => {
        const parsed = itemFromText(b.querySelector('#ei').value.trim());
        if (!parsed) { close(); return; }
        const aisle = b.querySelector('#ea').value;
        await put('shop', { ...it, name: parsed.name, qty: parsed.qty, qty2: parsed.qty2, unit: parsed.unit, aisle });
        close();
      };
      b.querySelector('[data-ok]').addEventListener('click', save);
      b.querySelector('#ei').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      b.querySelector('[data-del]').addEventListener('click', async () => { await remove('shop', it.id); close(); toast('הפריט נמחק', { action: 'ביטול', onAction: () => put('shop', it) }); });
    },
  });
}

function shareList() {
  sheet({
    title: 'שיתוף עם המשפחה',
    html: `<div class="menu">
      <button class="menu-item primary" data-s="text"><span class="mi-ic">${icon('file-text', '', 22)}</span><span class="mi-text">כטקסט עם תיבות סימון<small>לוואטסאפ – כל אחד רואה מה צריך לקנות</small></span></button>
      <button class="menu-item" data-s="link"><span class="mi-ic">${icon('link', '', 22)}</span><span class="mi-text">קישור לבישולון<small>מי שיפתח יוכל להוסיף את הפריטים לרשימה שלו</small></span></button>
    </div>`,
    mount: (b, close) => b.addEventListener('click', async (e) => {
      const k = e.target.closest('[data-s]')?.dataset.s; if (!k) return; close();
      const res = k === 'text'
        ? await shareOut({ title: 'רשימת קניות', text: listToText(state.shop) })
        : await shareOut({ title: 'רשימת קניות', text: 'רשימת הקניות שלנו בבישולון:', url: await listLink(state.shop) });
      if (res === 'copied') toast('הועתק ללוח – אפשר להדביק בוואטסאפ');
    }),
  });
}

function voiceAdd(addText) {
  let d = null;
  sheet({
    title: 'הוספה בקול',
    html: `<p class="hint">אמרו את המוצרים, למשל: <b>"חלב, שני קילו תפוחי אדמה, ביצים"</b></p>
      <button class="big-mic live" data-mic aria-label="הקלטה">${icon('mic', '', 36)}</button>
      <div class="dict-box" data-ph="מקשיב…"></div>
      <div class="sheet-actions"><button class="btn filled block" data-ok disabled>${icon('plus', '', 20)}הוספה לרשימה</button></div>`,
    mount: (b, close) => {
      const box = b.querySelector('.dict-box'); const ok = b.querySelector('[data-ok]'); const mic = b.querySelector('[data-mic]');
      let text = '';
      d = new Dictation({
        sep: ', ',
        onText: (t) => { text = t; box.textContent = t; ok.disabled = !t; },
        onState: (s) => { mic.classList.toggle('live', s === 'listening'); if (s === 'blocked') box.textContent = 'אין הרשאה למיקרופון/הכתבה. באייפון: הגדרות ← Siri ← הפעלת הכתבה.'; },
      });
      d.start();
      mic.addEventListener('click', () => { if (d.active) d.stop(); else d.start(); });
      ok.addEventListener('click', async () => {
        d.stop(); close();
        const norm = text.replace(/\s*פסיק\s*/g, ', ').replace(/\s+וגם\s+/g, ', ').replace(/\s+ו(?!ניל|ופל|אפל|ודקה|ויסקי|ופלים)(?=[א-ת]{2,})/g, ', ');
        await addText(norm);
        toast('נוסף לרשימה');
      });
    },
    onClose: () => d?.stop(),
  });
}
