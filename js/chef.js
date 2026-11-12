// The offline chef assistant: answers Hebrew questions from a built-in knowledge base
// (substitutions, conversions, temperatures, rescue tips) and from the recipe being cooked.
// No network and no AI service – everything runs on the phone.
import { SUBSTITUTIONS, CONVERSIONS, TEMPERATURES, TROUBLESHOOTING, TIPS } from './data/chef-kb.js';
import { norm, stem } from './util.js';
import { parseIngredient, ingredientLine } from './parse.js';
import { state } from './db.js';

const KB = [
  ['sub', SUBSTITUTIONS], ['conv', CONVERSIONS], ['temp', TEMPERATURES], ['fix', TROUBLESHOOTING], ['tip', TIPS],
].flatMap(([kind, arr]) => (arr || []).map((e) => ({ kind, keys: e.keys.map(norm), answer: e.answer })));

const INTENT = {
  sub: /(במה|במקומ|תחליפ|להחליפ|מחליפ|אינ לי|נגמר|חסר לי|אפשר בלי|בלי)/,
  conv: /(כמה (גרמ|מל|כפות|כפיות|כוסות)|המרה|להמיר|ממיר|שווה|פרנהייט|אונקי|ליברה|גרמ ב|כוס של)/,
  temp: /(טמפרטורה|מעלות|עשוי|מוכנ|מבושל|בטוח|מדיומ|נא|פנימית)/,
  fix: /(מה עושימ|איכ מצילימ|יצא|יצאה|נשרפ|שרופ|שקע|דליל|סמיכ|נפרד|יבש|נדבק|לא תפח|לא תופח|יותר מדי|מלוח|חריפ מדי|תקלה|הצילו|עזרה)/,
  tip: /(איכ|כמה זמנ|מה היחס|יחס|טיפ)/,
};

function scoreEntry(e, q, qStems, intents) {
  let s = 0;
  for (const k of e.keys) {
    if (!k) continue;
    if (q.includes(k)) s += 2 + k.length / 4;
    else {
      const ks = k.split(' ').map(stem).filter((x) => x.length > 1);
      const hit = ks.filter((x) => qStems.some((w) => w === x || (x.length > 3 && w.startsWith(x)) || (w.length > 3 && x.startsWith(w))));
      if (hit.length === ks.length && ks.length) s += 1.5 + hit.join('').length / 6;
      else if (hit.length) s += 0.4 * hit.length;
    }
  }
  if (s > 0 && intents.has(e.kind)) s *= 1.8;
  return s;
}

/** Ingredient question about the current recipe: "כמה קמח?", "כמה ביצים צריך" */
function recipeQuantity(q, ctx) {
  if (!ctx?.recipe) return null;
  const m = q.match(/(?:כמה|מה הכמות של|כמות|כמה צריכ|כמה שמימ)\s+(.+)/);
  if (!m) return null;
  const words = m[1].replace(/(צריכ|שמימ|צריכה|צריכימ|יש|במתכונ|לשימ|בבקשה)/g, ' ').split(' ').map(stem).filter((w) => w.length > 1);
  if (!words.length) return null;
  const hits = [];
  for (const line of ctx.recipe.ingredients || []) {
    const p = parseIngredient(line);
    if (!p || p.header) continue;
    const ns = norm(p.name).split(' ').map(stem);
    if (words.some((w) => ns.some((x) => x === w || (w.length > 2 && x.startsWith(w)) || (x.length > 2 && w.startsWith(x))))) hits.push(ingredientLine(p, ctx.factor || 1));
  }
  if (!hits.length) return null;
  return { kind: 'recipe', text: hits.length === 1 ? `צריך ${hits[0]}.` : `במתכון יש:\n• ${hits.join('\n• ')}` };
}

/** "מה אפשר להכין עם עוף ותפוחי אדמה" → matching saved recipes */
function whatCanICook(q) {
  const m = q.match(/(?:מה (?:אפשר|אני יכול|אני יכולה|אפשר ל)?\s*(?:להכינ|לבשל|לאפות)|מתכונ)\s+(?:עמ|ע״י|מ)\s+(.+)/);
  if (!m) return null;
  const want = m[1].split(/\s+ו|,|\s+/).map(stem).filter((w) => w.length > 1 && !['קצת', 'מעט', 'שיש', 'לי'].includes(w));
  if (!want.length) return null;
  const ranked = state.recipes.map((r) => {
    const ing = norm((r.ingredients || []).join(' ')).split(' ').map(stem);
    const hit = want.filter((w) => ing.some((x) => x === w || (w.length > 2 && x.startsWith(w))));
    return { r, n: hit.length };
  }).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 5);
  if (!ranked.length) return { kind: 'cook', text: 'לא מצאתי בספר שלך מתכון עם המצרכים האלה. נסה לחפש במסך "גלה" או לייבא מתכון חדש.' };
  return { kind: 'cook', text: 'הנה מה שמצאתי בספר המתכונים שלך:', recipes: ranked.map((x) => x.r.id) };
}

export function ask(question, ctx = {}) {
  const q = norm(question);
  if (!q) return { kind: 'none', text: 'לא שמעתי שאלה. נסה שוב?' };
  const rq = recipeQuantity(q, ctx);
  if (rq) return rq;
  const wc = whatCanICook(q);
  if (wc) return wc;
  const intents = new Set(Object.entries(INTENT).filter(([, rx]) => rx.test(q)).map(([k]) => k));
  const qStems = q.split(' ').map(stem).filter((w) => w.length > 1);
  let best = null, bestS = 0, second = null, secondS = 0;
  for (const e of KB) {
    const s = scoreEntry(e, q, qStems, intents);
    if (s > bestS) { second = best; secondS = bestS; best = e; bestS = s; } else if (s > secondS && e !== best) { second = e; secondS = s; }
  }
  if (best && bestS >= 1.5) {
    const out = { kind: best.kind, text: best.answer };
    if (second && secondS >= bestS * 0.85 && second.kind === best.kind && second.answer !== best.answer) out.more = second.answer;
    return out;
  }
  return {
    kind: 'none',
    text: 'עוד אין לי תשובה לזה. אני יודע לעזור עם תחליפים ("במה להחליף ביצים?"), המרות ("כמה גרם בכוס קמח?"), טמפרטורות ("מתי העוף מוכן?"), הצלות ("הרוטב יצא דליל") וכמויות מהמתכון ("כמה סוכר?").',
  };
}

export const SUGGESTIONS = [
  'במה להחליף ביצים?', 'כמה גרם בכוס קמח?', 'הרוטב יצא דליל', 'מתי העוף מוכן?', 'יותר מדי מלח בתבשיל', 'איך מבשלים ביצה רכה?', 'מה אפשר להכין עם עוף ותפוחי אדמה?', 'במה להחליף שמנת מתוקה?',
];
