// Import a recipe from a web link (recipe sites, Instagram/TikTok/YouTube captions),
// from a photo (on-device OCR, Hebrew + English) or from plain text.
import { parseRecipeText, findServings, isoMinutes } from './parse.js';
import { dishName, goodTitle } from './dish.js';

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

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const jsonStr = (s) => { try { return JSON.parse(`"${s}"`); } catch { return ''; } };
const SOCIAL = { 'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'facebook.com': 'Facebook', 'fb.watch': 'Facebook', 'pinterest.com': 'Pinterest', 'pin.it': 'Pinterest', 'x.com': 'X', 'twitter.com': 'X', 'threads.net': 'Threads' };
export const socialOf = (url) => { try { const h = new URL(url).hostname.replace(/^(www|m|vm|vt)\./, ''); return Object.entries(SOCIAL).find(([d]) => h === d || h.endsWith('.' + d))?.[1] || ''; } catch { return ''; } };

/** The full caption / description of a social post, from the data embedded in the page. */
function socialCaption(html, doc) {
  const pick = (re) => { const m = html.match(re); return m ? jsonStr(m[1]) : ''; };
  const all = (re) => [...html.matchAll(re)].map((m) => jsonStr(m[1])).filter(Boolean);
  let og = meta(doc, 'og:description', 'description', 'twitter:description');
  const ig = og.match(/^[\d,.KkMm]+ likes?, [\d,.KkMm]+ comments? - [^:]+:\s*"?([\s\S]*?)"?\.?$/);
  if (ig) og = ig[1];
  // pages also embed other posts (suggestions): use the caption that matches this post's own preview text
  const keySrc = og || (meta(doc, 'og:title') || doc.title || '').replace(/^.*? on (Instagram|TikTok)\s*:\s*"?/i, '');
  const key = keySrc.replace(EMOJI, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const clean = (c) => c.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  const same = (c) => key.length > 10 && clean(c).startsWith(key.slice(0, 30));
  const longest = (arr) => arr.sort((a, b) => b.length - a.length)[0] || '';
  const igCaps = all(/"caption":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/g);            // Instagram
  const ttDescs = all(/"desc":"((?:[^"\\]|\\.)*)"/g);                                  // TikTok
  const caption =
    igCaps.find(same) || longest(ttDescs.filter(same)) ||
    pick(/"shortDescription":"((?:[^"\\]|\\.)*)"/) ||                                   // YouTube
    pick(/"description":\{"simpleText":"((?:[^"\\]|\\.)*)"/) ||                          // YouTube (alt)
    longest(ttDescs) || (key.length > 10 ? '' : igCaps[0]) || '';
  const author = pick(/"username":"([\w.]{2,40})"/) || pick(/"uniqueId":"([\w.]{2,40})"/) || pick(/"ownerChannelName":"((?:[^"\\]|\\.){1,60})"/) || pick(/"author":"((?:[^"\\]|\\.){1,60})"/);
  const cover = pick(/"(?:originCover|cover|dynamicCover)":"(https:[^"]+)"/);
  return { text: caption.length >= og.length ? caption : og, author, cover };
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
/** Remove "123 likes, 4 comments - user on November 11, 2026:" and similar wrappers around a caption. */
export function stripPostMeta(t) {
  return String(t || '')
    .replace(/^\s*[\d,.KkMm]+\s+likes?,\s*[\d,.KkMm]+\s+comments?\s*[-–]\s*/i, '')
    .replace(/^\s*[\d,.]+\s*לייקים?,?\s*[\d,.]+\s*תגובות?\s*[-–]\s*/, '')
    .replace(new RegExp(`\\s*[-–—]?\\s*@?[\\w.]{2,30}\\s+on\\s+(?:${MONTHS})\\s+\\d{1,2},\\s*\\d{4}\\s*:?\\s*`, 'gi'), '\n')
    .replace(/\s*[-–—]?\s*@?[\w.]{2,30}\s+ב-?\s*\d{1,2}\s+ב[֐-׿]+\s+\d{4}\s*:?\s*/g, '\n')
    .replace(/^\s*["“”]+|["“”]+\.?\s*$/g, '')
    .trim();
}

/** Captions are often one long line: break bullets, numbers and headers onto their own lines. */
export function unflattenCaption(t) {
  let s = stripPostMeta(t).replace(/\r/g, '').replace(/#[\p{L}\d_]+/gu, ' ').replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1').replace(EMOJI, ' ').replace(/[ \t]+/g, ' ');
  s = s.replace(/\s*[•●▪◦✔✅➡️👉]\s*/g, '\n');
  if ((s.match(/\s[-–]\s/g) || []).length >= 3) s = s.replace(/\s+[-–]\s+(?=[\d½¼¾⅓⅔\p{L}])/gu, '\n');
  // section headers, with or without a colon ("Ingredients - 3lb…", "מצרכים: 2 כוסות…")
  s = s.replace(/(^|\s)(ingredients|instructions|directions|method|preparation|מצרכים|רכיבים|מרכיבים|אופן ההכנה|אופן הכנה|הוראות הכנה|דרך ההכנה)(?:\s*:\s*|\s*(?=\n|[-–•]\s|\d))/giu, '\n$2:\n');
  s = s.replace(/\s+(?=(?:step|שלב)\s*\d+\b)/giu, '\n');
  s = s.replace(/\s+(?=\d{1,2}[.)]\s+[\p{L}*])/gu, '\n');
  return s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !/^[.\-–_—·\s]+$/.test(l)).join('\n');
}

/** A short title from the caption's first line ("recipe below 👇" etc. removed). */
function captionTitle(caption) {
  const first = String(caption || '').replace(EMOJI, ' ').split(/\n|[.!?]\s/)[0] || '';
  return first.replace(/\b(full )?recipe (below|in (the )?(caption|comments|bio))\b.*$/i, '').replace(/(המתכון|מתכון) (למטה|בתגובות|בתיאור).*$/, '')
    .replace(/[:\-–\s]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 90);
}

/** Recipe text inside a page (caption / article). Returns a draft or null. */
function fromPageText(html, url, lenient = false) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = meta(doc, 'og:title', 'twitter:title') || doc.title || '';
  const social = socialOf(url);
  const sc = socialCaption(html, doc);
  const image = meta(doc, 'og:image', 'twitter:image') || sc.cover || '';
  const caption = social ? unflattenCaption(sc.text) : sc.text;
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
    const stop = social && c === caption ? -1 : d.steps.findIndex((st, i) => i >= 2 && st.length < 45 && !/[.!:,)]$/.test(st) && !/^[\p{L}]+(ים|ות|ו)(\s|$)/u.test(st));
    if (stop > 0) d.steps = d.steps.slice(0, stop);
    if ((d.ingredients.length >= 2 || lenient) && d.steps.length >= 1) {
      const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      if (social && c === caption) {
        d.title = captionTitle(caption) || d.title || `מתכון מ${social}`;
        d.author = sc.author ? `@${sc.author.replace(/^@/, '')} · ${social}` : social;
      } else {
        d.title = (at >= 0 ? '' : d.title) || title.replace(/\s*[|\-–]\s*[^|\-–]+$/, '').trim() || d.title;
        d.author = host;
      }
      d.title = d.title.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
      d.image = image;
      return d;
    }
  }
  return null;
}

/** Instagram: the post's embed page holds the full caption, creator and photo, and opens reliably. */
async function fromInstagramEmbed(url, signal) {
  const code = url.match(/instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,})/i)?.[1];
  if (!code) return null;
  let html;
  try { html = await fetchHtml(`https://instagram.com/p/${code}/embed/captioned/`, signal); } catch (e) { if (e.name === 'AbortError') throw e; return null; }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cap = doc.querySelector('.Caption');
  let text = '';
  let author = doc.querySelector('.CaptionUsername, .UsernameText')?.textContent?.trim() || '';
  if (cap) {
    const c = cap.cloneNode(true);
    c.querySelectorAll('.CaptionUsername, .CaptionComments, .CaptionCommentsText').forEach((n) => n.remove());
    c.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    text = c.textContent || '';
  }
  if (!text.trim()) {
    const m = html.match(/"edge_media_to_caption":\{"edges":\[\{"node":\{"text":"((?:[^"\\]|\\.)*)"/) || html.match(/\\"edge_media_to_caption\\":\{\\"edges\\":\[\{\\"node\\":\{\\"text\\":\\"((?:[^"\\]|\\\\.)*?)\\"/);
    if (m) text = jsonStr(m[1].replace(/\\\\/g, '\\')) || '';
  }
  if (!text.trim()) return null;
  const d = parseRecipeText(unflattenCaption(text));
  if (!d.ingredients.length && !d.steps.length) return null;
  const img = doc.querySelector('img.EmbeddedMediaImage')?.getAttribute('src') || '';
  d.title = captionTitle(unflattenCaption(text)) || d.title;
  d.image = img;
  d.author = author ? `@${author.replace(/^@/, '')} · Instagram` : 'Instagram';
  return d;
}

export async function importFromUrl(url, { signal } = {}) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (/instagram\.com\//i.test(url)) {
    const ig = await fromInstagramEmbed(url, signal);
    if (ig) return finishDraft(ig, url);
  }
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
  if (!draft) {
    if (/instagram\.com\//i.test(url)) throw new Error('blocked');
    throw new Error(html ? 'no-recipe' : 'network');
  }
  return finishDraft(draft, url);
}

/** Shared clean-up for every web import: tidy text, name the dish, attach the source. */
function finishDraft(draft, url) {
  draft.title = cleanTitle(draft.title);
  // leftovers like "@user on November 11, 2026" inside steps / ingredients
  const meta2 = (s) => stripPostMeta(s).replace(/\n+/g, ' ').trim();
  draft.steps = (draft.steps || []).map(meta2).filter((s) => s.length > 1);
  draft.ingredients = (draft.ingredients || []).map(meta2).filter(Boolean);
  // name the dish, not the creator or the caption
  if (socialOf(url) || !goodTitle(draft.title)) draft.title = dishName(draft, draft.title);
  if (/[A-Z]{3}/.test(draft.title) && draft.title === draft.title.toUpperCase()) draft.title = draft.title.charAt(0) + draft.title.slice(1).toLowerCase();
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
