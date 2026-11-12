// Import a recipe from a web link (recipe sites, Instagram/TikTok/YouTube captions),
// from a photo (on-device OCR, Hebrew + English) or from plain text.
import { parseRecipeText, findServings, isoMinutes } from './parse.js';

const READER = 'https://r.jina.ai/'; // public page reader: fetches the page for us (sites block direct cross-site reads)
// where the recipe ends and the rest of the page begins
const JUNK = /(האם הכתבה|הכתבה עניינה|להצטרפות|קבוצת הוואטסאפ|\|\d{1,2}\.\d{1,2}\.\d{2,4}|קרא(?:ו)? עוד|כתבות נוספות|אולי יעניין|עוד מתכונים|מתכונים נוספים|מתכונים אחרונים|תגובות|הוספת תגובה|שתפו|שיתוף ב|לכל המתכונים|מומלצים|הירשמו|ניוזלטר|תנאי שימוש|כל הזכויות|©|related|you may also like|more recipes|comments|newsletter|advertisement|פרסומת)/i;
const cleanTitle = (t) => String(t || '').replace(/\s*\|[^|]*$/, '').replace(/\s*[–—-]\s*(mako|ynet|כאן|וואלה|walla|ישראל היום|מעריב|כיכר השבת|[a-z0-9.-]+\.(?:co\.il|com|net|org))\s*$/i, '').trim();

const decode = (s) => {
  const ta = document.createElement('textarea');
  ta.innerHTML = String(s ?? '');
  return ta.value;
};
const strip = (s) => decode(String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim();

async function fetchHtml(url, signal) {
  const r = await fetch(READER + url, { headers: { 'X-Return-Format': 'html' }, signal });
  if (!r.ok) throw Object.assign(new Error('fetch'), { status: r.status });
  return r.text();
}
async function fetchText(url, signal) {
  const r = await fetch(READER + url, { signal });
  if (!r.ok) throw Object.assign(new Error('fetch'), { status: r.status });
  return r.text();
}

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findRecipeNode(n); if (f) return f; } return null; }
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  for (const k of ['@graph', 'mainEntity', 'itemListElement', 'about']) { const f = findRecipeNode(node[k]); if (f) return f; }
  return null;
}

function stepsFrom(ins) {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === 'string') { strip(x).split(/\n+/).map((s) => s.trim()).filter(Boolean).forEach((s) => out.push(s)); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x['@type'] === 'HowToSection' || x.itemListElement) { if (x.name) out.push(`## ${strip(x.name)}`); walk(x.itemListElement); return; }
    walk(x.text || x.name || x.description);
  };
  walk(ins);
  // section titles inside steps aren't steps
  return out.filter((s) => !s.startsWith('## ')).map((s) => s.replace(/^\d+[.)]\s*/, ''));
}

const imageFrom = (img) => {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageFrom(img[0]);
  return img.url || img.contentUrl || '';
};

function fromJsonLd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try { data = JSON.parse(s.textContent.trim()); } catch { try { data = JSON.parse(s.textContent.replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; } }
    const r = findRecipeNode(data);
    if (!r) continue;
    const ings = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : r.ingredients || []).map(strip).filter(Boolean);
    const yieldTxt = Array.isArray(r.recipeYield) ? r.recipeYield.join(' ') : String(r.recipeYield ?? '');
    return {
      title: strip(r.name),
      description: strip(r.description).slice(0, 500),
      image: imageFrom(r.image),
      servings: parseInt(yieldTxt, 10) || findServings(yieldTxt) || null,
      prepTime: isoMinutes(r.prepTime), cookTime: isoMinutes(r.cookTime) || Math.max(0, isoMinutes(r.totalTime) - isoMinutes(r.prepTime)),
      ingredients: ings,
      steps: stepsFrom(r.recipeInstructions),
      tags: [r.recipeCategory, r.recipeCuisine].flat().filter(Boolean).map(strip).slice(0, 3),
      notes: '',
      author: strip(typeof r.author === 'string' ? r.author : (Array.isArray(r.author) ? r.author[0]?.name : r.author?.name) || ''),
    };
  }
  return null;
}

function meta(doc, ...names) {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"],meta[name="${n}"]`);
    if (el?.content) return decode(el.content);
  }
  return '';
}

/** Recipe text inside a page (caption / article). Returns a draft or null. */
function fromPageText(html, url, lenient = false) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = meta(doc, 'og:title', 'twitter:title') || doc.title || '';
  const image = meta(doc, 'og:image', 'twitter:image');
  // social captions live in og:description (Instagram, TikTok, Facebook)
  let caption = meta(doc, 'og:description', 'description', 'twitter:description');
  const yt = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (yt) { try { caption = JSON.parse(`"${yt[1]}"`); } catch { /* keep og */ } }
  const ig = caption.match(/^[\d,.KkMm]+ likes?, [\d,.KkMm]+ comments? - [^:]+:\s*"?([\s\S]*?)"?\.?$/);
  if (ig) caption = ig[1];
  const candidates = [];
  if (caption && caption.length > 60) candidates.push(caption);
  doc.querySelectorAll('script,style,nav,header,footer,aside,form,noscript').forEach((n) => n.remove());
  const main = doc.querySelector('article, main, [itemprop=recipeInstructions], .recipe, #recipe') || doc.body;
  if (main) {
    main.querySelectorAll('li,p,h1,h2,h3,h4,br,div').forEach((n) => n.insertAdjacentText('afterend', '\n'));
    const text = (main.textContent || '').replace(/\n\s*\n+/g, '\n').trim();
    candidates.push(text);
  }
  for (const c of candidates) {
    const lines = c.split('\n');
    const at = lines.findIndex((l) => /(מצרכים|רכיבים|מרכיבים|ingredients)/i.test(l) && l.length < 40);
    let sl = at >= 0 ? lines.slice(at, at + 160) : c.slice(0, 6000).split('\n');
    const junk = sl.findIndex((l, i) => i > 3 && JUNK.test(l));
    if (junk > 0) sl = sl.slice(0, junk);
    const slice = sl.join('\n');
    const d = parseRecipeText(slice);
    // a short line without punctuation after real steps = tags / headlines, not a step
    const stop = d.steps.findIndex((st, i) => i >= 2 && st.length < 45 && !/[.!:,)]$/.test(st) && !/^[\p{L}]+(ים|ות|ו)(\s|$)/u.test(st));
    if (stop > 0) d.steps = d.steps.slice(0, stop);
    if ((d.ingredients.length >= 2 || lenient) && d.steps.length >= 1) {
      const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      d.title = (at >= 0 ? '' : d.title) || title.replace(/\s*[|\-–]\s*[^|\-–]+$/, '').trim() || d.title;
      d.image = image; d.author = host;
      return d;
    }
  }
  return null;
}

export async function importFromUrl(url, { signal } = {}) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let html = '';
  try { html = await fetchHtml(url, signal); } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (e.status === 451 || e.status === 403) throw new Error('blocked');
  }
  let draft = html ? fromJsonLd(html) : null;
  if (draft && html && (!draft.steps.length || !draft.ingredients.length)) {
    // structured data was partial – fill the gaps from the page text
    const page = fromPageText(html, url, true);
    if (page) {
      if (!draft.steps.length) draft.steps = page.steps;
      if (!draft.ingredients.length) draft.ingredients = page.ingredients;
      draft.servings = draft.servings || page.servings;
    }
  }
  if (!draft && html) draft = fromPageText(html, url);
  if (!draft) {
    // last try: the reader's clean text version of the page
    try {
      const txt = await fetchText(url, signal);
      const body = txt.replace(/^[\s\S]*?Markdown Content:\s*/i, '');
      const lines = body.split('\n');
      const at = lines.findIndex((l) => /(מצרכים|רכיבים|מרכיבים|ingredients)/i.test(l) && l.length < 60);
      const d = parseRecipeText((at >= 0 ? lines.slice(at, at + 160) : lines.slice(0, 200)).join('\n').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/!\S*/g, ''));
      const tm = txt.match(/^Title:\s*(.+)$/m);
      if (d.ingredients.length >= 2) { d.title = (tm?.[1] || d.title).replace(/\s*[|\-–]\s*[^|\-–]+$/, ''); draft = d; }
    } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  if (!draft) throw new Error(html ? 'no-recipe' : 'network');
  draft.title = cleanTitle(draft.title);
  draft.steps = (draft.steps || []).slice(0, 30);
  draft.ingredients = (draft.ingredients || []).slice(0, 60);
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* bad url */ }
  draft.source = { url, name: draft.author || host };
  delete draft.author;
  return draft;
}

/* ---------------- OCR ---------------- */
let tessP = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tessP) {
    tessP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(new Error('ocr-load')); };
      document.head.appendChild(s);
    });
  }
  return tessP;
}

/** Read text from a photo of a recipe. onProgress(0..1, label) */
export async function ocrImage(file, onProgress = () => {}) {
  onProgress(0.02, 'טוען מנוע זיהוי טקסט…');
  const T = await loadTesseract();
  const worker = await T.createWorker(['heb', 'eng'], 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(0.3 + m.progress * 0.7, 'קורא את המתכון…');
      else if (/loading|initializ/.test(m.status)) onProgress(0.05 + (m.progress || 0) * 0.25, 'מכין את זיהוי העברית (פעם ראשונה לוקח רגע)…');
    },
  });
  let numWorker = null;
  try {
    const img = await preprocess(file);
    const { data } = await worker.recognize(img);
    // Hebrew OCR often garbles numbers ("100" → "0", "1/2" → "2"); a second, Latin-only
    // pass reads digits reliably, so we take each line's leading quantity from it.
    onProgress(0.92, 'בודק את הכמויות…');
    try {
      numWorker = await T.createWorker(['eng'], 1);
      const { data: nd } = await numWorker.recognize(img);
      return fixNumbers(data.lines || [], nd.lines || []) || data.text || '';
    } catch { return data.text || ''; }
  } finally { worker.terminate(); numWorker?.terminate(); }
}

const PURE_NUM = /^(\d+(?:[/.,]\d+)?|\d+-\d+|[½¼¾⅓⅔])$/;
function fixNumbers(hebLines, engLines) {
  if (!hebLines.length) return '';
  return hebLines.map((hl) => {
    let text = (hl.text || '').trim();
    const y0 = hl.bbox.y0, y1 = hl.bbox.y1;
    const el = engLines.find((e) => Math.min(y1, e.bbox.y1) - Math.max(y0, e.bbox.y0) > (y1 - y0) * 0.5);
    if (!el) return text;
    // the quantity starts a Hebrew line, i.e. it is the right-most number on the line
    const nums = (el.words || []).filter((w) => PURE_NUM.test(w.text.replace(/[.:]$/, '')))
      .filter((w) => w.bbox.x1 > hl.bbox.x1 - (hl.bbox.x1 - hl.bbox.x0) * 0.12)
      .sort((a, b) => b.bbox.x1 - a.bbox.x1);
    if (!nums.length) return text;
    const real = nums[0].text.replace(/[.:]$/, '');
    const m = text.match(/^(\d+(?:[/.,]\d+)?)(\.?)\s*/);
    if (m) {
      if (m[1] !== real && real.replace(/\D/g, '').includes(m[1].replace(/\D/g, ''))) text = real + m[2] + ' ' + text.slice(m[0].length);
    } else if (/^[֐-׿]/.test(text)) text = real + ' ' + text;
    return text;
  }).join('\n');
}

/** Upscale small photos, convert to high-contrast greyscale – noticeably better OCR. */
async function preprocess(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = long < 1600 ? 1600 / long : long > 3000 ? 3000 / long : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.35)';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/** OCR output → tidy text (join hyphen-wrapped lines, drop noise). */
export function cleanOcr(t) {
  return t.split('\n').map((l) => l.replace(/[|_~^`]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 1 && /[\p{L}\d]/u.test(l) && (l.match(/[\p{L}]/gu) || []).length >= Math.min(2, l.length / 3))
    .join('\n');
}
