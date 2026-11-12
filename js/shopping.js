// Shopping list logic: sort items into supermarket aisles, merge duplicates across recipes.
import { norm, uid, fmtQty } from './util.js';
import { parseIngredient, unitText } from './parse.js';

export const AISLES = [
  { id: 'produce', name: 'ירקות ופירות', icon: 'carrot', words: 'עגבני מלפפון בצל שום גזר תפוח תפוא בטטה קישוא חציל פלפל חסה כרוב כרובית ברוקולי תרד פטרוזיליה כוסברה שמיר נענע בזיליקום לימון ליים תפוז בננה אבוקדו פטריות סלרי כרישה ג׳ינג׳ר גינגר צנון סלק דלעת אפונה שעועית ירוקה תירס ענבים תות אגס מנגו אננס רימון קולרבי עירית ירק ירקות פירות ארטישוק אספרגוס שרי חלפיניו צ׳ילי טימין טרי רוזמרין טרי' },
  { id: 'dairy', name: 'מוצרי חלב וביצים', icon: 'egg', words: 'חלב גבינ שמנת יוגורט לבנה חמאה ביצ קוטג מוצרלה פרמזן צפתית בולגרית ריקוטה מסקרפונה פטה שמנת חמוצה גאודה צ׳דר אמנטל ברי קממבר רוקפור עמק' },
  { id: 'meat', name: 'בשר, עוף ודגים', icon: 'beef', words: 'עוף חזה שוקיים כרעיים כנפיים פרגית בשר בקר טחון אנטריקוט צלע אסאדו כבש טלה הודו נקניק נקניקיות קבב המבורגר דג דגים סלמון טונה טרי אמנון לברק דניס בורי מוסר שרימפס כבד שניצל פילה' },
  { id: 'bakery', name: 'לחם ומאפים', icon: 'croissant', words: 'לחם לחמני פיתה חלה באגט טורטיה בצק עלים בצק פילו בייגל קרואסון טוסט פירורי לחם פנקו' },
  { id: 'dry', name: 'יבשים ומזווה', icon: 'wheat', words: 'קמח סוכר אורז פסטה ספגטי פתיתים קוסקוס בורגול קינואה עדשים חומוס יבש שעועית יבשה גריסים שיבולת שועל קורנפלור עמילן אבקת אפייה סודה לשתייה שמרים קקאו שוקולד צ׳יפס אגוזים שקדים בוטנים צימוקים תמרים שומשום פשתן צ׳יה פרג קורנפלקס גרנולה דבש סילאן מייפל ריבה וניל ג׳לטין קוקוס פירורים נודלס אטריות' },
  { id: 'spices', name: 'תבלינים', icon: 'leaf', words: 'מלח פלפל שחור פפריקה כמון כורכום קינמון אגוז מוסקט ציפורן הל זעתר סומק בהרט ראס אל חנות חוואיג׳ אורגנו טימין יבש רוזמרין יבש עלי דפנה תבלין צ׳ילי גרוס ג׳ינג׳ר יבש אבקת שום אבקת בצל אבקת מרק ציר מרק' },
  { id: 'canned', name: 'שימורים, רטבים ושמנים', icon: 'cooking-pot', words: 'שמן זית שמן קנולה שמן חומץ רסק רוטב מרוסקות טחינה מיונז קטשופ חרדל סויה רוטב צ׳ילי שימורי קופסת תירס שימורים זיתים מלפפונים חמוצים קוקוס חלב קוקוס טונה בשימורים חומוס מבושל פסטו סרירצ׳ה הריסה' },
  { id: 'frozen', name: 'קפואים', icon: 'square', words: 'קפוא קפואה קפואים גלידה אפונה קפואה ירקות קפואים בצק קפוא' },
  { id: 'drinks', name: 'משקאות', icon: 'coffee', words: 'יין בירה מיץ סודה מים מינרליים קפה תה' },
  { id: 'other', name: 'שונות', icon: 'shopping-cart', words: '' },
];

const AISLE_WORDS = AISLES.filter((a) => a.words).map((a) => ({ id: a.id, words: a.words.split(' ').map(norm).filter((w) => w.length > 1) }));

// phrases that beat single-word matching
const PHRASES = [
  [/פלפל (שחור|לבן|גרוס|אנגלי|חריף יבש)|^פלפל$|מלח ופלפל|פפריקה|אבקת (שום|בצל|מרק)|ציר (עוף|ירקות|בקר)|מרק עוף/, 'spices'],
  [/חלב קוקוס|קרם קוקוס|שמן|חומץ|רסק|רוטב|טחינה|שימורי|מרוסקות|בקופסה/, 'canned'],
  [/קפוא|קפואה|קפואים|גלידה/, 'frozen'],
  [/שעועית (לבנה|יבשה|אדומה)|חומוס יבש|גרגירי חומוס|שוקולד|קמח|פירורי לחם|פנקו/, 'dry'],
  [/תפוחי אדמה|תפוח אדמה|תפו״א|תפוא/, 'produce'],
  [/שמנת|גבינ/, 'dairy'],
];

export function aisleFor(name) {
  const n = ' ' + norm(name) + ' ';
  for (const [rx, id] of PHRASES) if (rx.test(norm(name)) || rx.test(name)) return id;
  // more specific multi-word matches first (e.g. "שמן זית" before "זית")
  let best = null, bestLen = 0;
  for (const a of AISLE_WORDS) {
    for (const w of a.words) {
      const i = n.indexOf(w);
      if (i < 0) continue;
      const atWordStart = n[i - 1] === ' ' || /[והבלמש]/.test(n[i - 1]) && n[i - 2] === ' ';
      if (!atWordStart) continue;
      if (w.length > bestLen) { best = a.id; bestLen = w.length; }
    }
  }
  return best || 'other';
}

const keyName = (s) => norm(s).replace(/\s+(גדול|גדולה|גדולים|בינוני|בינונית|קטן|קטנה|קטנים|טרי|טרייה|טריים|קצוץ|קצוצה|קצוצים)$/g, '').trim();

/** Make shopping items from ingredient lines (already scaled by factor). */
export function itemsFromIngredients(lines, factor = 1, recipe = null) {
  const items = [];
  for (const line of lines) {
    const p = parseIngredient(line);
    if (!p || p.header) continue;
    const qty = p.qty != null ? p.qty * factor : null;
    const qty2 = p.qty2 != null ? p.qty2 * factor : null;
    items.push({
      id: uid(), name: p.name.replace(/\s+/g, ' ').trim(), qty, qty2, unit: p.unit || null,
      aisle: aisleFor(p.name), checked: false, recipes: recipe ? [{ id: recipe.id, title: recipe.title }] : [], addedAt: Date.now(),
    });
  }
  return items;
}

/** Merge new items into the existing list (same name + same unit → add quantities). */
export function mergeInto(list, incoming) {
  const out = list.map((x) => ({ ...x }));
  const changed = [];
  for (const it of incoming) {
    const k = keyName(it.name);
    const ex = out.find((x) => !x.checked && keyName(x.name) === k && (x.unit || null) === (it.unit || null));
    if (ex) {
      if (ex.qty != null && it.qty != null) { ex.qty += it.qty; if (ex.qty2 != null || it.qty2 != null) ex.qty2 = (ex.qty2 ?? ex.qty) + (it.qty2 ?? it.qty); }
      else if (ex.qty == null && it.qty != null) { ex.qty = it.qty; }
      for (const r of it.recipes || []) if (!(ex.recipes || []).some((x) => x.id === r.id)) ex.recipes = [...(ex.recipes || []), r];
      changed.push(ex);
    } else { out.push(it); changed.push(it); }
  }
  return { list: out, changed };
}

export function itemQtyText(it) {
  if (it.qty == null) return '';
  const q = fmtQty(it.qty) + (it.qty2 != null && it.qty2 !== it.qty ? `–${fmtQty(it.qty2)}` : '');
  return [q, unitText(it.unit, it.qty2 ?? it.qty)].filter(Boolean).join(' ');
}

/** Free text typed into the list ("2 ק״ג תפוחי אדמה") → item */
export function itemFromText(text) {
  return itemsFromIngredients([text])[0] || null;
}

export function listToText(list) {
  const lines = ['רשימת קניות 🛒', ''];
  for (const a of AISLES) {
    const items = list.filter((x) => x.aisle === a.id && !x.checked);
    if (!items.length) continue;
    lines.push(`${a.name}:`);
    for (const it of items) lines.push(`☐ ${[itemQtyText(it), it.name].filter(Boolean).join(' ')}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
