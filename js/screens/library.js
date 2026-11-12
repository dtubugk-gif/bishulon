// Home: the user's recipe book – search (by name, ingredient, tag), albums, sorting.
import { state, put, remove, getKV, setKV } from '../db.js';
import { icon, esc, norm, stem, uid, debounce, isIOS, isStandalone } from '../util.js';
import { recipeCard, emptyState, sheet, promptSheet, confirmSheet, toast } from '../ui.js';
import { openAddSheet } from './add.js';

let query = '';
let sortBy = 'recent';

const SORTS = { recent: 'נוספו לאחרונה', name: 'לפי שם (א–ת)', cooked: 'הכי מבושלים', rating: 'דירוג גבוה' };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
}

/** Search: every word must match somewhere; title > tags > ingredients > notes. */
export function searchRecipes(list, q) {
  const words = norm(q).replace(/\s+ו(?=\S)/g, ' ').split(/[\s,]+/).filter((w) => w.length > 1 || /\d/.test(w)).map(stem);
  if (!words.length) return list;
  const scored = [];
  const partial = [];
  for (const r of list) {
    const fields = [
      [norm(r.title).split(' ').map(stem), 4],
      [norm((r.tags || []).join(' ')).split(' ').map(stem), 2.5],
      [norm((r.ingredients || []).join(' ')).split(' ').map(stem), 2],
      [norm(`${r.description || ''} ${r.notes || ''} ${r.source?.name || ''}`).split(' ').map(stem), 0.6],
    ];
    let score = 0, hits = 0;
    for (const w of words) {
      let best = 0;
      for (const [toks, wgt] of fields) {
        if (toks.some((t) => t === w)) best = Math.max(best, wgt);
        else if (toks.some((t) => t.startsWith(w) || (w.length > 3 && t.includes(w)))) best = Math.max(best, wgt * 0.7);
      }
      if (best) { hits++; score += best; }
    }
    if (hits === words.length) scored.push([r, score]);
    else if (hits && words.length > 1) partial.push([r, score, hits]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  partial.sort((a, b) => b[2] - a[2] || b[1] - a[1]);
  const out = scored.map((x) => x[0]);
  out.partial = partial.map((x) => x[0]);
  return out;
}

function sorted(list) {
  const l = [...list];
  if (sortBy === 'name') l.sort((a, b) => a.title.localeCompare(b.title, 'he'));
  else if (sortBy === 'cooked') l.sort((a, b) => (b.cookCount || 0) - (a.cookCount || 0) || (b.lastCooked || 0) - (a.lastCooked || 0));
  else if (sortBy === 'rating') l.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else l.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return l;
}

function installBanner() {
  if (isStandalone() || getKV('installDismissed', false)) return '';
  const ios = isIOS();
  return `<div class="install">
    <img class="app-icon" src="icons/icon-192.png" alt="">
    <div class="grow"><b>להתקין את בישולון במסך הבית</b>${ios ? `לחצו על ${icon('share', '', 15).replace('class="ic ', 'style="display:inline;vertical-align:-2px" class="ic ')} "שיתוף" בספארי ← "הוספה למסך הבית"` : 'פתיחה מהירה במסך מלא, גם בלי אינטרנט'}</div>
    <button class="icon-btn" data-act="dismiss-install" aria-label="הסתרה">${icon('x', '', 20)}</button>
  </div>`;
}

function grid(list, album) {
  return `<div class="grid stagger">${list.map((r) => recipeCard(r, `#/recipe/${encodeURIComponent(r.id)}`)).join('')}</div>`;
}

function body(album) {
  let list = state.recipes;
  if (album === 'fav') list = list.filter((r) => r.favorite);
  else if (album) list = list.filter((r) => (r.albums || []).includes(album));
  if (query.trim()) {
    const res = searchRecipes(list, query);
    if (!res.length && !res.partial?.length) return emptyState({ ic: 'search', title: 'לא נמצאו מתכונים', text: `אין מתכון שמתאים ל"${query}". אפשר לחפש לפי שם, מצרך או תגית.` });
    return `${res.length ? `<div class="section-head"><h2>${res.length} תוצאות</h2></div>${grid(res)}` : ''}
      ${res.partial?.length ? `<div class="section-head"><h2>מתאימים חלקית</h2><span class="muted">חלק מהמילים</span></div>${grid(res.partial.slice(0, 12))}` : ''}`;
  }
  if (!state.recipes.length) {
    return emptyState({
      ic: 'book-heart', title: 'ספר המתכונים שלכם מחכה',
      text: 'הוסיפו מתכון מקישור, מצילום של דף מתכון, בהקלטה קולית – או שמרו מתכונים מ"גלו".',
      actions: `<div class="btns"><button class="btn filled" data-act="add">${icon('plus')}הוספת מתכון</button><a class="btn tonal" href="#/discover">${icon('compass')}גלו מתכונים</a></div>`,
    });
  }
  if (!list.length) {
    return album === 'fav'
      ? emptyState({ ic: 'heart', title: 'עוד אין מועדפים', text: 'לחצו על הלב במתכון כדי לשמור אותו כאן.' })
      : emptyState({ ic: 'folder', title: 'האלבום ריק', text: 'פתחו מתכון ← "עוד" ← "הוספה לאלבום".' });
  }
  return `<div class="section-head"><h2>${album === 'fav' ? 'מועדפים' : album ? esc(state.albums.find((a) => a.id === album)?.name || '') : 'כל המתכונים'}</h2>
    <button class="chip" data-act="sort">${icon('arrow-up-down', '', 16)}${SORTS[sortBy]}</button></div>${grid(sorted(list))}`;
}

export function render({ album = '' }) {
  sortBy = getKV('sortBy', 'recent');
  const albums = [...state.albums].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const count = (id) => state.recipes.filter((r) => (r.albums || []).includes(id)).length;
  const html = `
    <div class="head-row" style="padding-bottom:0">
      <div class="grow"><div class="big-title" style="padding:8px 0 0"><p>${greeting()}</p><h1>המתכונים שלי</h1></div></div>
      <a class="icon-btn" href="#/settings" aria-label="הגדרות">${icon('settings')}</a>
    </div>
    ${installBanner()}
    <div class="search" style="position:sticky">
      <label class="search-box">${icon('search', '', 20)}
        <input type="search" id="q" placeholder="חיפוש לפי שם, מצרך או תגית…" value="${esc(query)}" enterkeyhint="search" autocomplete="off">
        <button class="icon-btn" data-act="clear-q" aria-label="ניקוי חיפוש" ${query ? '' : 'hidden'}>${icon('x', '', 20)}</button>
      </label>
    </div>
    <div class="chips" role="toolbar" aria-label="אלבומים">
      <a class="chip" href="#/" aria-pressed="${!album}">הכל <span class="count">${state.recipes.length}</span></a>
      <a class="chip" href="#/album/fav" aria-pressed="${album === 'fav'}">${icon('heart', '', 16)}מועדפים</a>
      ${albums.map((a) => `<a class="chip" href="#/album/${a.id}" aria-pressed="${album === a.id}">${icon('folder', '', 16)}${esc(a.name)} <span class="count">${count(a.id)}</span></a>`).join('')}
      <button class="chip dashed" data-act="new-album">${icon('folder-plus', '', 16)}אלבום חדש</button>
      ${album && album !== 'fav' ? `<button class="chip dashed" data-act="edit-album">${icon('pencil', '', 16)}עריכת אלבום</button>` : ''}
    </div>
    <div id="lib-body">${body(album)}</div>
    ${state.recipes.length ? `<button class="fab" data-act="add" aria-label="הוספת מתכון">${icon('plus')}מתכון חדש</button>` : ''}`;

  return {
    html, tab: 'book', live: ['recipes', 'albums'],
    mount(root, { navigate, rerender }) {
      const q = root.querySelector('#q');
      const clear = root.querySelector('[data-act="clear-q"]');
      const refresh = debounce(() => { root.querySelector('#lib-body').innerHTML = body(album); clear.hidden = !query; }, 120);
      q.addEventListener('input', () => { query = q.value; refresh(); });
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') q.blur(); });
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'add') openAddSheet(navigate);
        else if (act === 'clear-q') { query = ''; q.value = ''; refresh(); q.focus(); }
        else if (act === 'dismiss-install') { await setKV('installDismissed', true); b.closest('.install').remove(); }
        else if (act === 'sort') {
          sheet({
            title: 'מיון',
            html: `<div class="menu">${Object.entries(SORTS).map(([k, v]) => `<button class="menu-item" data-sort="${k}"><span class="mi-ic">${icon(k === sortBy ? 'check' : 'circle', '', 20)}</span><span class="mi-text">${v}</span></button>`).join('')}</div>`,
            mount: (bd, close) => bd.addEventListener('click', async (ev) => { const s = ev.target.closest('[data-sort]'); if (!s) return; await setKV('sortBy', s.dataset.sort); close(); rerender(); }),
          });
        } else if (act === 'new-album') {
          const name = await promptSheet({ title: 'אלבום חדש', label: 'שם האלבום', placeholder: 'למשל: עוגות, ארוחות שישי, מהיר לערב' });
          if (name) { const a = { id: uid(), name, createdAt: Date.now() }; await put('albums', a); navigate(`#/album/${a.id}`, { replace: true }); }
        } else if (act === 'edit-album') {
          const a = state.albums.find((x) => x.id === album); if (!a) return;
          sheet({
            title: a.name,
            html: `<div class="menu"><button class="menu-item" data-a="rename"><span class="mi-ic">${icon('pencil', '', 20)}</span><span class="mi-text">שינוי שם</span></button>
              <button class="menu-item danger" data-a="delete"><span class="mi-ic">${icon('trash-2', '', 20)}</span><span class="mi-text">מחיקת האלבום<small>המתכונים עצמם נשארים בספר</small></span></button></div>`,
            mount: (bd, close) => bd.addEventListener('click', async (ev) => {
              const x = ev.target.closest('[data-a]'); if (!x) return; close();
              if (x.dataset.a === 'rename') { const n = await promptSheet({ title: 'שינוי שם', label: 'שם האלבום', value: a.name }); if (n) await put('albums', { ...a, name: n }); }
              else if (await confirmSheet({ title: 'למחוק את האלבום?', text: `האלבום "${a.name}" יימחק. המתכונים שבו יישארו בספר.`, ok: 'מחיקה', danger: true })) {
                for (const r of state.recipes.filter((r) => (r.albums || []).includes(a.id))) await put('recipes', { ...r, albums: r.albums.filter((i) => i !== a.id) });
                await remove('albums', a.id); toast('האלבום נמחק'); navigate('#/', { replace: true });
              }
            }),
          });
        }
      });
      return () => {};
    },
  };
}
