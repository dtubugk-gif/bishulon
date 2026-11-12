// Small shared helpers: escaping, icons, Hebrew text normalisation, numbers.
import { ICONS } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Inline SVG icon. `cls` adds classes (e.g. "flip" mirrors directional icons in RTL). */
export function icon(name, cls = '', size = 24) {
  const inner = ICONS[name] || ICONS.circle;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Normalise Hebrew for search/matching: strip niqqud & punctuation, unify final letters, lower-case latin. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '') // niqqud + cantillation
    .replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' })[c])
    .replace(/[״"׳'`’]/g, '')
    .replace(/[^\p{L}\p{N}\s/.-]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very light Hebrew stemming for search: drop common prefixes / plural suffixes. */
export function stem(w) {
  let s = norm(w);
  if (s.length > 4) s = s.replace(/(ים|ות)$/, '');
  if (s.length > 3) s = s.replace(/^(וה|שה|מה|כש|וב|ול|ומ|ה|ו|ב|ל|מ|ש)(?=\S{3,})/, '');
  return s;
}

const FRACTIONS = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];

/** Format a quantity nicely: 1.5 → "1½", 0.333 → "⅓", 250 → "250", 12.5 → "12.5". */
export function fmtQty(n) {
  if (n == null || isNaN(n)) return '';
  if (n >= 20) return String(Math.round(n * 10) / 10).replace(/\.0$/, '');
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.06) return String(whole || (n > 0 ? fmtSmall(n) : 0));
  if (frac > 0.94) return String(whole + 1);
  let best = FRACTIONS[0], bd = 9;
  for (const f of FRACTIONS) { const d = Math.abs(f[0] - frac); if (d < bd) { bd = d; best = f; } }
  if (bd > 0.05) return String(Math.round(n * 100) / 100);
  return (whole ? whole : '') + best[1];
}
function fmtSmall(n) { return String(Math.round(n * 100) / 100); }

export const fmtMinutes = (m) => {
  if (!m) return '';
  m = Math.round(m);
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(m / 60), r = m % 60;
  const hs = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`;
  return r ? `${hs} ו-${r} דק׳` : hs;
};

export const fmtClock = (sec) => {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
};

export const vibrate = (p) => { try { navigator.vibrate?.(p); } catch { /* not supported */ } };

/** Resize an image File/Blob to a JPEG data URL (max side `max`). */
export async function imageToDataURL(file, max = 1280, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Finite number or fallback (guards data from links, backups and web pages). */
export const num = (x, d = null) => { const n = typeof x === 'number' ? x : parseFloat(x); return Number.isFinite(n) ? n : d; };
/** Only http(s) links are allowed as recipe sources (no javascript: etc.). */
export const safeUrl = (u) => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
export const safeId = (s) => /^[\w.-]{1,64}$/.test(String(s)) ? String(s) : null;
const strArr = (a) => (Array.isArray(a) ? a : []).map((x) => String(x ?? '')).filter(Boolean);

/** Normalise a recipe object so every field has the type the screens expect. */
export function sanitizeRecipe(r) {
  const img = String(r.image || '');
  return {
    ...r,
    id: safeId(r.id) || uid(),
    title: String(r.title || '').slice(0, 200), description: String(r.description || '').slice(0, 1000),
    servings: num(r.servings), prepTime: num(r.prepTime, 0), cookTime: num(r.cookTime, 0),
    rating: Math.max(0, Math.min(5, num(r.rating, 0))), cookCount: num(r.cookCount, 0),
    lastCooked: num(r.lastCooked), createdAt: num(r.createdAt, Date.now()), updatedAt: num(r.updatedAt, Date.now()),
    favorite: !!r.favorite, difficulty: r.difficulty ? String(r.difficulty) : undefined,
    ingredients: strArr(r.ingredients), steps: strArr(r.steps), tags: strArr(r.tags), albums: strArr(r.albums).filter(safeId),
    notes: String(r.notes || ''),
    source: r.source && (r.source.url || r.source.name) ? { url: safeUrl(r.source.url), name: String(r.source.name || '') } : null,
    image: /^data:image\/(jpeg|png|webp|gif);base64,/.test(img) ? img : '',
    imageUrl: safeUrl(r.imageUrl), seedId: r.seedId ? String(r.seedId) : undefined,
  };
}
