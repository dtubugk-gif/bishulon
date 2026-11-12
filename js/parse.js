// Hebrew-first recipe parsing: ingredient lines (quantity / unit / name), scaling,
// free-text recipes (pasted, OCR, dictated, social captions) and step durations.
import { fmtQty, norm } from './util.js';

/* ---------------- units ---------------- */
// key: [singular, plural, aliases...]
const UNIT_DEFS = {
  cup: ['כוס', 'כוסות', 'cups', 'cup', 'כ׳'],
  tbsp: ['כף', 'כפות', 'tablespoons', 'tablespoon', 'tbsp', 'tbs', 'כף גדושה', 'כפות גדושות'],
  tsp: ['כפית', 'כפיות', 'teaspoons', 'teaspoon', 'tsp'],
  kg: ['ק״ג', 'ק״ג', 'קג', 'קילוגרם', 'קילו', 'kg', 'kilograms', 'kilogram'],
  g: ['גרם', 'גרם', 'גר׳', 'גר', 'ג׳', 'grams', 'gram', 'gr', 'g'],
  l: ['ליטר', 'ליטר', 'ליטרים', 'liters', 'liter', 'litres', 'litre', 'l'],
  ml: ['מ״ל', 'מ״ל', 'מל', 'מיליליטר', 'ml'],
  clove: ['שן', 'שיני', 'שיניים', 'שני', 'cloves', 'clove'],
  pkg: ['חבילה', 'חבילות', 'חב׳', 'שקית', 'שקיות', 'אריזה', 'אריזות', 'packages', 'package', 'pack'],
  can: ['פחית', 'פחיות', 'קופסה', 'קופסאות', 'קופסת', 'cans', 'can'],
  pinch: ['קורט', 'קורט', 'קמצוץ', 'pinch'],
  bunch: ['צרור', 'צרורות', 'אגודה', 'אגודות', 'bunch'],
  sprig: ['ענף', 'ענפים', 'גבעול', 'גבעולים', 'ענפי', 'גבעולי', 'sprigs', 'sprig'],
  slice: ['פרוסה', 'פרוסות', 'slices', 'slice'],
  unit: ['יחידה', 'יחידות', 'יח׳'],
  stick: ['מקל', 'מקלות', 'מקלות של'],
  cube: ['קובייה', 'קוביות', 'קוביה'],
  leaf: ['עלה', 'עלים', 'עלי'],
  head: ['ראש', 'ראשי', 'ראשים'],
  handful: ['חופן', 'חופנים', 'חופן של', 'handful'],
  drop: ['טיפה', 'טיפות'],
  oz: ['אונקיה', 'אונקיות', 'oz', 'ounces', 'ounce'],
  lb: ['ליברה', 'ליברות', 'lbs', 'lb', 'pounds', 'pound'],
};
export const UNIT_LABEL = Object.fromEntries(Object.entries(UNIT_DEFS).map(([k, v]) => [k, { one: v[0], many: v[1] }]));

// alias list, longest first; quotes normalised to Hebrew gershayim/geresh before matching
const UNIT_ALIASES = Object.entries(UNIT_DEFS)
  .flatMap(([k, arr]) => arr.map((a) => [a, k]))
  .sort((a, b) => b[0].length - a[0].length);

const normQuotes = (s) => s.replace(/(\S)["״]/g, '$1״').replace(/(\S)['׳’`]/g, '$1׳');

/* ---------------- numbers ---------------- */
const UNI_FRAC = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const WORD_NUM = {
  'חצי': 0.5, 'רבע': 0.25, 'שליש': 1 / 3, 'שני שליש': 2 / 3, 'שלושת רבעי': 0.75, 'שלושה רבעים': 0.75, 'שלושת רבעים': 0.75,
  'אחד': 1, 'אחת': 1, 'שתיים': 2, 'שניים': 2, 'שני': 2, 'שתי': 2, 'שלוש': 3, 'שלושה': 3, 'שלושת': 3, 'ארבע': 4, 'ארבעה': 4, 'ארבעת': 4,
  'חמש': 5, 'חמישה': 5, 'חמשת': 5, 'שש': 6, 'שישה': 6, 'ששת': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9, 'עשר': 10, 'עשרה': 10,
  'תריסר': 12, 'מספר': null, 'כמה': null,
};
const WORD_KEYS = Object.keys(WORD_NUM).sort((a, b) => b.length - a.length);

const NUM_RE = /^(\d+(?:[.,]\d+)?)?\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])|^(\d+)\s+(\d+)\s*\/\s*(\d+)|^(\d+)\s*\/\s*(\d+)|^(\d+(?:[.,]\d+)?)/;

/** Read a number at the start of s. Returns [value, consumedLength] or null. */
function readNumber(s) {
  const m = s.match(NUM_RE);
  if (m) {
    if (m[2]) return [(m[1] ? parseFloat(m[1].replace(',', '.')) : 0) + UNI_FRAC[m[2]], m[0].length];
    if (m[3]) return [parseInt(m[3], 10) + parseInt(m[4], 10) / parseInt(m[5], 10), m[0].length];
    if (m[6]) return [parseInt(m[6], 10) / parseInt(m[7], 10), m[0].length];
    if (m[8]) return [parseFloat(m[8].replace(',', '.')), m[0].length];
  }
  for (const w of WORD_KEYS) {
    if (s.startsWith(w) && (s.length === w.length || /[\s\-־,]/.test(s[w.length]))) {
      if (WORD_NUM[w] == null) return null;
      return [WORD_NUM[w], w.length];
    }
  }
  return null;
}

/** Read "N", "N-M", "N עד M" → {qty, qty2, len} */
function readQty(s) {
  const a = readNumber(s);
  if (!a) return null;
  let [qty, len] = a;
  let qty2 = null;
  const rest = s.slice(len);
  const r = rest.match(/^\s*(?:-|–|—|עד|או|to)\s*/);
  if (r) {
    const b = readNumber(rest.slice(r[0].length));
    if (b) { qty2 = b[0]; len += r[0].length + b[1]; }
  }
  return { qty, qty2, len };
}

function readUnit(s) {
  const t = s.replace(/^\s+/, '');
  const lead = s.length - t.length;
  for (const [alias, key] of UNIT_ALIASES) {
    if (t.toLowerCase().startsWith(alias.toLowerCase())) {
      const next = t[alias.length];
      if (next === undefined || /[\s,.)(\-־:]/.test(next)) return { unit: key, len: lead + alias.length, text: alias };
    }
  }
  return null;
}

/* ---------------- ingredient lines ---------------- */
const TO_TASTE = /(לפי ה?טעם|לפי הצורך|לקישוט|להגשה|לטיגון|לציפוי|למריחה|to taste|as needed|optional|רשות)/;

export function isHeaderLine(line) {
  const t = line.trim();
  if (t.startsWith('##')) return true;
  if (/^\*\*.+\*\*:?$/.test(t)) return true;
  return /[:׃]$/.test(t) && !/\d/.test(t) && t.split(/\s+/).length <= 5;
}

export function cleanHeader(line) {
  return line.trim().replace(/^#+\s*/, '').replace(/^\*\*|\*\*:?$/g, '').replace(/[:׃]\s*$/, '').trim();
}

/** Parse one ingredient line → { raw, header, qty, qty2, unit, name, note } */
export function parseIngredient(rawLine) {
  const raw = String(rawLine ?? '').trim();
  if (!raw) return null;
  if (isHeaderLine(raw)) return { raw, header: true, name: cleanHeader(raw) };
  let s = normQuotes(raw.replace(/^[\s•\-–—*·●▪◦✓✔☐□○►▶➤]+/, '').replace(/^\d+[.)]\s+(?=\D)/, '').trim());
  let qty = null, qty2 = null, unit = null;

  // "(2 כוסות)" style or "קמח - 2 כוסות" (quantity at the end)
  let q = readQty(s);
  if (q) {
    qty = q.qty; qty2 = q.qty2; s = s.slice(q.len);
    const u = readUnit(s);
    if (u) { unit = u.unit; s = s.slice(u.len); }
    // "כוס וחצי" / "2 כוסות ורבע"
    const extra = s.match(/^\s*ו(חצי|רבע|שליש)(?=[\s,]|$)/);
    if (extra) { qty += WORD_NUM[extra[1]]; s = s.slice(extra[0].length); }
  } else {
    const u = readUnit(s);
    if (u && u.unit !== 'leaf' && u.unit !== 'head') {
      // unit with no number: "כוס קמח", "קורט מלח", "כף וחצי סוכר"
      unit = u.unit; qty = 1; s = s.slice(u.len);
      const extra = s.match(/^\s*ו(חצי|רבע|שליש)(?=[\s,]|$)/);
      if (extra) { qty += WORD_NUM[extra[1]]; s = s.slice(extra[0].length); }
    } else {
      const tail = s.match(/\s*[-–:(]\s*([\d½⅓⅔¼¾][\d\s/.,½⅓⅔¼¾\-–]*)\s*([^\d()]*?)\)?\s*$/);
      if (tail) {
        const tq = readQty(tail[1].trim());
        if (tq) {
          const u2 = readUnit(tail[2] || '');
          if (!tail[2]?.trim() || u2) {
            qty = tq.qty; qty2 = tq.qty2; unit = u2?.unit || null;
            s = s.slice(0, tail.index);
          }
        }
      }
    }
  }
  s = s.replace(/^\s*(של|מ)\s+/, ' ').replace(/^[\s,\-–:]+/, '').trim();
  let name = s, note = '';
  const ci = s.search(/[,(]/);
  if (ci > 1) { name = s.slice(0, ci).trim(); note = s.slice(ci).replace(/^[,\s]+/, '').replace(/^\((.*)\)$/, '$1').trim(); }
  if (!name) name = raw;
  return { raw, header: false, qty, qty2, unit, name, note, toTaste: qty == null && TO_TASTE.test(raw) };
}

/* ---------------- scaling ---------------- */
function smartUnit(qty, unit) {
  if (unit === 'tsp' && qty >= 3 && Math.abs(qty / 3 - Math.round(qty / 3 * 2) / 2) < 0.01) return [qty / 3, 'tbsp'];
  if (unit === 'tbsp' && qty >= 8 && Math.abs((qty / 16) * 4 - Math.round((qty / 16) * 4)) < 0.01) return [qty / 16, 'cup'];
  if (unit === 'g' && qty >= 1000) return [qty / 1000, 'kg'];
  if (unit === 'ml' && qty >= 1000) return [qty / 1000, 'l'];
  return [qty, unit];
}

const COUNTABLE = new Set(['unit', 'clove', 'slice', 'leaf', 'head', 'stick', 'cube', 'sprig']);
const roundSmart = (n, unit) => {
  if (unit === 'g' || unit === 'ml') return n >= 100 ? Math.round(n / 5) * 5 : Math.round(n);
  return n;
};

export function unitText(unit, qty) {
  const l = unit && UNIT_LABEL[unit];
  if (!l) return '';
  return qty != null && qty > 1 ? l.many : l.one;
}

/** Scaled, display-ready parts of an ingredient. */
export function scaleIngredient(ing, factor = 1) {
  if (!ing || ing.header || ing.qty == null) return { qtyText: '', unitText: '', name: ing?.name || '', note: ing?.note || '', raw: ing?.raw || '' };
  let qty = ing.qty * factor, qty2 = ing.qty2 != null ? ing.qty2 * factor : null, unit = ing.unit;
  if (factor !== 1 && unit) {
    const [nq, nu] = smartUnit(qty, unit);
    if (nu !== unit) { if (qty2 != null) qty2 = qty2 * (nq / qty); qty = nq; unit = nu; }
  }
  qty = roundSmart(qty, unit);
  if (qty2 != null) qty2 = roundSmart(qty2, unit);
  // countable things (eggs, cloves, slices…) are whole once there are two or more
  if (factor !== 1 && (!unit || COUNTABLE.has(unit))) {
    if (qty >= 2) qty = Math.round(qty); else qty = Math.round(qty * 2) / 2;
    if (qty2 != null) qty2 = qty2 >= 2 ? Math.round(qty2) : Math.round(qty2 * 2) / 2;
  }
  const qtyText = fmtQty(qty) + (qty2 != null ? `–${fmtQty(qty2)}` : '');
  return { qtyText, qty, unit, unitText: unitText(unit, qty2 ?? qty), name: ing.name, note: ing.note, raw: ing.raw };
}

export function ingredientLine(ing, factor = 1) {
  if (ing.header) return ing.name;
  if (ing.qty == null) return ing.raw;
  const p = scaleIngredient(ing, factor);
  return [`⁦${p.qtyText}⁩`, p.unitText, p.name].filter(Boolean).join(' ') + (p.note ? `, ${p.note}` : '');
}

/* ---------------- durations in step text ---------------- */
const DUR_UNIT = /^(שניות|שנייה|שניה|דקות|דקה|דק׳|דק|שעות|שעה|seconds?|secs?|minutes?|mins?|hours?|hrs?|h|m)(?![\p{L}])/u;
const unitSecs = (u) => (/^(ש(נ|ני)י?ות?|שני?יה|sec)/.test(u) ? 1 : /^(שע|h)/.test(u) ? 3600 : 60);

const WORD_DUR = [
  [/שלושת רבעי שעה/g, 2700], [/שעה ושלושה רבעים/g, 6300], [/שעה וחצי/g, 5400], [/שעה ורבע/g, 4500], [/שעתיים וחצי/g, 9000],
  [/שעתיים/g, 7200], [/חצי שעה/g, 1800], [/רבע שעה/g, 900],
  // no lookbehind (Safari < 16.4 can't parse it): group 1 is the boundary character, skipped below
  [/(^|[^\p{L}\d])(כ?שעה)(?![\p{L}])/gu, 3600],
  [/(^|[^\p{L}])(כ?(?:דקה אחת|דקה))(?![\p{L}])/gu, 60], [/(^|[^\p{L}])(כ?דקותיים)(?![\p{L}])/gu, 120],
];

/** Find durations in a step: [{index, length, seconds, text}] (non-overlapping, in order). */
export function findDurations(text) {
  const t = normQuotes(String(text || ''));
  const out = [];
  const taken = (i, l) => out.some((o) => i < o.index + o.length && o.index < i + l);
  // numeric: "20 דקות", "20-25 דק׳", "1.5 שעות", "שלוש דקות"
  const re = /(\d+(?:[.,]\d+)?|חצי|שתי|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר|אחת)(?:\s*(?:-|–|עד)\s*(\d+(?:[.,]\d+)?))?\s*/g;
  let m;
  while ((m = re.exec(t))) {
    const after = t.slice(m.index + m[0].length);
    const u = after.match(DUR_UNIT);
    if (!u) continue;
    const prev = t[m.index - 1];
    if (prev && /[\p{L}\d]/u.test(prev) && !/[כו-]/.test(prev)) continue;
    const n = /\d/.test(m[1]) ? parseFloat(m[1].replace(',', '.')) : WORD_NUM[m[1]];
    if (!n) continue;
    let secs = n * unitSecs(u[1]);
    let len = m[0].length + u[0].length;
    // "1 שעה ו-20 דקות"
    const tail = t.slice(m.index + len).match(/^\s*ו-?\s*(\d+)\s*(דקות|דק׳|דק)/);
    if (tail && unitSecs(u[1]) === 3600) { secs += parseInt(tail[1], 10) * 60; len += tail[0].length; }
    const vs = t.slice(m.index + len).match(/^\s*וחצי/);
    if (vs && unitSecs(u[1]) === 3600) { secs += 1800; len += vs[0].length; }
    if (!taken(m.index, len)) out.push({ index: m.index, length: len, seconds: Math.round(secs), text: t.substr(m.index, len) });
    re.lastIndex = m.index + len;
  }
  for (const [rx, secs] of WORD_DUR) {
    rx.lastIndex = 0;
    let w;
    while ((w = rx.exec(t))) {
      const skip = w.length > 2 ? w[1].length : 0;
      const idx = w.index + skip, len = w[0].length - skip;
      if (!taken(idx, len)) out.push({ index: idx, length: len, seconds: secs, text: t.substr(idx, len) });
      if (w[0].length === 0) rx.lastIndex++;
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** ISO-8601 duration (PT1H20M) → minutes */
export function isoMinutes(s) {
  if (!s || typeof s !== 'string') return 0;
  const m = s.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return 0;
  return (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) + Math.round((+(m[4] || 0)) / 60);
}

/* ---------------- whole recipe from free text ---------------- */
const ING_HEAD = /^(?:[#*\s]*)(ה?מצרכים|ה?רכיבים|ה?מרכיבים|ה?חומרים|מה צריך|מה נצטרך|רשימת קניות|ingredients)(?![\p{L}])/iu;
const STEP_HEAD = /^(?:[#*\s]*)(אופן ה?הכנה|דרך ה?הכנה|ה?הכנה|הוראות(?: הכנה)?|שלבי ה?הכנה|שלבים|איך מכינים|instructions|directions|method|preparation)(?![\p{L}])/iu;
const TIP_HEAD = /^(?:[#*\s]*)(טיפ(?:ים)?|הערות?|הערה|דגשים|tips?|notes?)(?![\p{L}])/iu;

function looksLikeIngredient(line) {
  const t = normQuotes(line.replace(/^[\s•\-–—*·●▪◦]+/, ''));
  if (t.split(/\s+/).length > 12) return false;
  if (readQty(t) || readUnit(t)) return true;
  if (TO_TASTE.test(t) && t.split(/\s+/).length <= 7) return true;
  return false;
}

const STEP_VERB = /^(מחממים|מערבבים|מוסיפים|שמים|אופים|מבשלים|מטגנים|קוצצים|חותכים|מניחים|יוצקים|מקציפים|מגישים|טורפים|מרתיחים|מסננים|מפזרים|לחמם|לערבב|להוסיף|לאפות|לבשל|לטגן|לקצוץ|לחתוך|להניח|ליצוק|להקציף|להגיש|לטרוף|חממו|ערבבו|הוסיפו|אפו|בשלו|טגנו|קצצו|חתכו|הניחו|יצקו|הקציפו|הגישו|טרפו|preheat|mix|add|bake|cook|stir|place|pour|serve|whisk|combine|heat)/i;

function splitSteps(lines) {
  const numbered = lines.filter((l) => /^\s*(\d+[.)\-]|\d{1,2}\s+(?=[֐-׿])|שלב\s*\d+)/.test(l)).length;
  const bareNums = lines.filter((l) => /^\s*\d{1,2}\s+(?=[֐-׿])/.test(l)).length >= 2;
  const steps = [];
  for (let l of lines) {
    const isNew = /^\s*(\d+[.)\-]|שלב\s*\d+[:.]?|[•\-–*●▪])/.test(l) || (bareNums && /^\s*\d{1,2}\s+(?=[֐-׿])/.test(l));
    l = l.replace(/^\s*(\d+[.)\-]\s*|שלב\s*\d+[:.]?\s*|[•\-–*●▪]\s*)/, '').trim();
    if (bareNums) l = l.replace(/^\d{1,2}\s+(?=[֐-׿])/, '');
    if (!l) continue;
    if (numbered >= 2 && !isNew && steps.length) steps[steps.length - 1] += ' ' + l;
    else steps.push(l);
  }
  // one giant paragraph → split into sentences
  if (steps.length === 1 && steps[0].length > 220) {
    return steps[0].replace(/([.!?])\s+(?=\S)/g, '$1').split('').reduce((acc, s) => {
      if (acc.length && (acc[acc.length - 1].length < 60)) acc[acc.length - 1] += ' ' + s; else acc.push(s);
      return acc;
    }, []);
  }
  return steps;
}

export function findServings(text) {
  const t = normQuotes(text);
  const m = t.match(/(?:ל-?|כ-?|מספיק ל-?|עבור\s*)?(\d+)(?:\s*[-–]\s*\d+)?\s*(מנות|סועדים|אנשים|איש|serves|servings|portions)/i) || t.match(/(?:serves|servings|מנות|כמות)\s*[:\-]?\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function findTime(text, words) {
  const re = new RegExp(`(?:${words})\\s*[:\\-]?\\s*([^\\n]{1,30})`, 'i');
  const m = normQuotes(text).match(re);
  if (!m) return 0;
  const d = findDurations(m[1]);
  return d.length ? Math.round(d[0].seconds / 60) : 0;
}

/** Turn free text (pasted, OCR, voice, social caption) into a recipe draft. */
export function parseRecipeText(text) {
  const src = String(text || '').replace(/\r/g, '').replace(/‏|‎/g, '');
  let lines = src.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // social captions: drop hashtags-only lines and trailing hashtag clouds
  lines = lines.map((l) => l.replace(/(\s#[\p{L}\d_]+)+\s*$/u, '').trim()).filter((l) => l && !/^(#[\p{L}\d_]+\s*)+$/u.test(l));
  const draft = { title: '', description: '', servings: findServings(src) || null, prepTime: findTime(src, 'זמן הכנה|prep time'), cookTime: findTime(src, 'זמן (?:בישול|אפייה)|cook time|bake time'), ingredients: [], steps: [], notes: '' };

  let iHead = lines.findIndex((l) => ING_HEAD.test(l) && l.length < 40);
  let sHead = lines.findIndex((l, i) => i > iHead && STEP_HEAD.test(l) && l.length < 40);
  const tHead = lines.findIndex((l, i) => i > Math.max(iHead, sHead) && TIP_HEAD.test(l) && l.length < 30);

  const headLine = (l, re) => l.replace(re, '').replace(/^[\s:׃\-–]+/, '').trim();

  if (iHead >= 0) {
    const pre = lines.slice(0, iHead);
    draft.title = pre[0] || '';
    draft.description = pre.slice(1).filter((l) => !/^(זמן|כמות|מנות|רמת קושי)/.test(l))
      .map((l) => l.replace(/[,\s]*(?:ל-?|מספיק ל-?|עבור\s*)?\d+(?:\s*[-–]\s*\d+)?\s*(?:מנות|סועדים|אנשים)[.,]?/g, '').trim()).filter(Boolean).join(' ').slice(0, 400);
    const end = sHead > iHead ? sHead : (tHead > 0 ? tHead : lines.length);
    const inline = headLine(lines[iHead], ING_HEAD);
    let ingLines = lines.slice(iHead + 1, end);
    if (inline) ingLines.unshift(inline);
    if (sHead < 0) {
      // no step header: ingredients run until the first line that doesn't look like one
      const cut = ingLines.findIndex((l, i) => i > 0 && !looksLikeIngredient(l) && !isHeaderLine(l) && (l.split(/\s+/).length > 6 || STEP_VERB.test(l.replace(/^\d+[.)]\s*/, ''))));
      if (cut > 0) { draft.steps = splitSteps(ingLines.slice(cut)); ingLines = ingLines.slice(0, cut); }
    }
    draft.ingredients = ingLines.map((l) => (isHeaderLine(l) ? '## ' + cleanHeader(l) : l.replace(/^[\s•\-–—*·●▪◦]+/, '').trim())).filter(Boolean);
    if (sHead >= 0) {
      const sEnd = tHead > sHead ? tHead : lines.length;
      const inl = headLine(lines[sHead], STEP_HEAD);
      const sl = lines.slice(sHead + 1, sEnd);
      if (inl) sl.unshift(inl);
      draft.steps = splitSteps(sl.filter((l) => !isHeaderLine(l) || /\d/.test(l)));
    }
    if (tHead >= 0) draft.notes = lines.slice(tHead + 1).join('\n') || headLine(lines[tHead], TIP_HEAD);
  } else {
    // no headers: classify line by line
    let start = 0;
    if (lines[0] && !looksLikeIngredient(lines[0]) && lines[0].split(/\s+/).length <= 9) { draft.title = lines[0]; start = 1; }
    const ing = [], steps = [], desc = [];
    for (const l of lines.slice(start)) {
      const shortPlain = ing.length && l.split(/\s+/).length <= 4 && !STEP_VERB.test(l) && !/[.!?]$/.test(l);
      if ((looksLikeIngredient(l) || shortPlain) && !steps.length) ing.push(l.replace(/^[\s•\-–—*·●▪◦]+/, ''));
      else if (isHeaderLine(l) && !steps.length) ing.push('## ' + cleanHeader(l));
      else if (!ing.length && !steps.length && !STEP_VERB.test(l)) desc.push(l);
      else steps.push(l);
    }
    draft.ingredients = ing;
    draft.steps = splitSteps(steps);
    draft.description = desc.join(' ').slice(0, 400);
  }
  draft.title = draft.title.replace(/^[#*\s]+|[*\s:]+$/g, '').slice(0, 120);
  draft.steps = draft.steps.filter((s) => s.length > 1);
  if (!draft.cookTime) {
    // no stated time: estimate from the waits written in the steps
    const secs = draft.steps.reduce((a, s) => a + findDurations(s).reduce((b, d) => b + d.seconds, 0), 0);
    if (secs >= 60) draft.cookTime = Math.round(secs / 60);
  }
  return draft;
}

/** Recipe object → plain shareable text. */
export function recipeToText(r, factor = 1) {
  const ings = (r.ingredients || []).map((l) => parseIngredient(l)).filter(Boolean);
  const out = [r.title, ''];
  if (r.description) out.push(r.description, '');
  out.push('מצרכים:');
  for (const i of ings) out.push(i.header ? `\n${i.name}:` : `• ${ingredientLine(i, factor)}`);
  out.push('', 'אופן ההכנה:');
  (r.steps || []).forEach((s, n) => out.push(`${n + 1}. ${s}`));
  if (r.notes) out.push('', 'הערות:', r.notes);
  if (r.source?.url) out.push('', `מקור: ${r.source.url}`);
  return out.join('\n');
}

export const searchKey = (r) => norm([r.title, r.description, (r.ingredients || []).join(' '), (r.tags || []).join(' '), r.notes, r.source?.name].join(' '));
