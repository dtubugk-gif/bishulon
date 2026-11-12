// Give an imported recipe a real dish name ("שווארמה הודו", "עוגת שוקולד") instead of the
// creator's name or the first line of a caption. Rule-based: finds the dish type and the
// main ingredient in the recipe itself.
import { norm } from './util.js';
import { parseIngredient } from './parse.js';

// dish words (singular) → how the name starts. "of" = construct form used before an ingredient.
const DISHES = [
  ['שווארמה', 'שווארמה'], ['שקשוקה', 'שקשוקה'], ['קציצות', 'קציצות'], ['קציצה', 'קציצות'], ['שניצל', 'שניצל'], ['המבורגר', 'המבורגר'],
  ['פסטה', 'פסטה'], ['ספגטי', 'ספגטי'], ['לזניה', 'לזניה'], ['ניוקי', 'ניוקי'], ['ריזוטו', 'ריזוטו'], ['פתיתים', 'פתיתים'], ['קוסקוס', 'קוסקוס'],
  ['מג׳דרה', 'מג׳דרה'], ['מגדרה', 'מג׳דרה'], ['אורז', 'אורז'], ['קארי', 'קארי'], ['תבשיל', 'תבשיל'], ['מוקפץ', 'מוקפץ'], ['נודלס', 'נודלס'],
  ['מרק', 'מרק'], ['סלט', 'סלט'], ['חומוס', 'חומוס'], ['פלאפל', 'פלאפל'], ['סביח', 'סביח'], ['טחינה', 'טחינה'],
  ['פשטידה', 'פשטידת', true], ['קיש', 'קיש'], ['פיצה', 'פיצה'], ['פוקאצ׳ה', 'פוקאצ׳ה'], ['פוקצ׳ה', 'פוקאצ׳ה'], ['לחם', 'לחם'], ['חלה', 'חלה'], ['פיתות', 'פיתות'],
  ['לחמניות', 'לחמניות'], ['בורקס', 'בורקס'], ['מאפה', 'מאפה'], ['טורטיה', 'טורטיות'], ['טאקו', 'טאקו'], ['כריך', 'כריך'], ['טוסט', 'טוסט'],
  ['עוגה', 'עוגת', true], ['עוגת', 'עוגת', true], ['עוגיות', 'עוגיות'], ['עוגייה', 'עוגיות'], ['בראוניז', 'בראוניז'], ['בראוני', 'בראוניז'], ['מאפינס', 'מאפינס'],
  ['טארט', 'טארט'], ['פאי', 'פאי'], ['קרם', 'קרם'], ['מוס', 'מוס'], ['גלידה', 'גלידת', true], ['פנקייק', 'פנקייק'], ['פנקייקים', 'פנקייק'], ['וופל', 'וופל'],
  ['חביתה', 'חביתה'], ['פריטטה', 'פריטטה'], ['קרפ', 'קרפ'], ['גרנולה', 'גרנולה'], ['שייק', 'שייק'], ['רוטב', 'רוטב'], ['ממרח', 'ממרח'],
  ['סטייק', 'סטייק'], ['צלי', 'צלי'], ['שיפודים', 'שיפודי', true], ['כנפיים', 'כנפיים'],
  ['shawarma', 'שווארמה'], ['shakshuka', 'שקשוקה'], ['meatballs', 'קציצות'], ['schnitzel', 'שניצל'], ['burger', 'המבורגר'], ['pasta', 'פסטה'], ['spaghetti', 'ספגטי'],
  ['penne', 'פנה'], ['lasagna', 'לזניה'], ['gnocchi', 'ניוקי'], ['risotto', 'ריזוטו'], ['curry', 'קארי'], ['stew', 'תבשיל'], ['soup', 'מרק'], ['salad', 'סלט'],
  ['hummus', 'חומוס'], ['falafel', 'פלאפל'], ['quiche', 'קיש'], ['pizza', 'פיצה'], ['focaccia', 'פוקאצ׳ה'], ['bread', 'לחם'], ['challah', 'חלה'], ['tacos', 'טאקו'],
  ['cake', 'עוגת', true], ['cookies', 'עוגיות'], ['brownies', 'בראוניז'], ['muffins', 'מאפינס'], ['pancakes', 'פנקייק'], ['waffles', 'וופל'], ['omelette', 'חביתה'],
  ['frittata', 'פריטטה'], ['granola', 'גרנולה'], ['smoothie', 'שייק'], ['steak', 'סטייק'], ['dumplings', 'כיסונים'], ['chapati', 'צ׳פאטי'], ['noodles', 'נודלס'], ['wings', 'כנפיים'],
];

// main ingredients worth naming, most specific first
const MAINS = [
  ['חזה עוף', 'חזה עוף'], ['פרגיות', 'פרגיות'], ['פרגית', 'פרגיות'], ['כרעיים', 'עוף'], ['שוקיים', 'עוף'], ['כנפיים', 'עוף'], ['עוף', 'עוף'], ['הודו', 'הודו'],
  ['בשר טחון', 'בשר'], ['אנטריקוט', 'אנטריקוט'], ['אסאדו', 'אסאדו'], ['בקר', 'בקר'], ['טלה', 'טלה'], ['סלמון', 'סלמון'], ['טונה', 'טונה'], ['אמנון', 'אמנון'], ['דג', 'דג'],
  ['שרימפס', 'שרימפס'], ['טופו', 'טופו'], ['חציל', 'חצילים'], ['כרובית', 'כרובית'], ['ברוקולי', 'ברוקולי'], ['בטטה', 'בטטה'], ['תפוחי אדמה', 'תפוחי אדמה'],
  ['קישוא', 'קישואים'], ['פטריות', 'פטריות'], ['עדשים', 'עדשים'], ['חומוס', 'חומוס'], ['תרד', 'תרד'], ['עגבניות', 'עגבניות'], ['גבינה', 'גבינה'],
  ['שוקולד', 'שוקולד'], ['תפוזים', 'תפוזים'], ['תפוז', 'תפוזים'], ['לימון', 'לימון'], ['תפוחים', 'תפוחים'], ['בננה', 'בננה'], ['גזר', 'גזר'], ['שיבולת שועל', 'שיבולת שועל'],
  ['chicken breast', 'חזה עוף'], ['chicken', 'עוף'], ['turkey', 'הודו'], ['ground beef', 'בשר'], ['beef', 'בקר'], ['lamb', 'טלה'], ['salmon', 'סלמון'], ['tuna', 'טונה'],
  ['potatoes', 'תפוחי אדמה'], ['shrimp', 'שרימפס'], ['tofu', 'טופו'], ['eggplant', 'חצילים'], ['cauliflower', 'כרובית'], ['broccoli', 'ברוקולי'], ['sweet potato', 'בטטה'], ['potato', 'תפוחי אדמה'],
  ['mushroom', 'פטריות'], ['lentil', 'עדשים'], ['chickpea', 'חומוס'], ['spinach', 'תרד'], ['chocolate', 'שוקולד'], ['lemon', 'לימון'], ['banana', 'בננה'], ['pumpkin', 'דלעת'],
];

const has = (text, w) => {
  const t = ` ${text} `;
  const nw = norm(w);
  return new RegExp(`[\\s(]([והבלמש]|של|ל-)?${nw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(ים|ות|s)?[\\s,.:)]`, 'i').test(t);
};

const WEAK = new Set(['רוטב', 'טחינה', 'ממרח', 'קרם', 'אורז', 'לחם', 'מאפה', 'פיתות', 'לחמניות', 'טוסט', 'סלט', 'חומוס']);
function findDish(text, strongOnly = false) {
  let best = null, at = Infinity;
  for (const [w, name, construct] of DISHES) {
    if (strongOnly && WEAK.has(name)) continue;
    const i = ` ${text} `.search(new RegExp(`[\\s(]([והבלמש])?${norm(w)}[\\s,.:)]`, 'i'));
    if (i >= 0 && i < at) { at = i; best = { name, construct: !!construct, word: norm(w) }; }
  }
  return best;
}

function findMain(ingredients, text) {
  // weight ingredients by position (first ones are usually the main thing) and amount in grams
  let best = null, bestScore = 0;
  ingredients.forEach((line, idx) => {
    const p = parseIngredient(line);
    if (!p || p.header) return;
    const name = norm(p.name);
    for (const [w, label] of MAINS) {
      if (!has(name, w)) continue;
      let score = 10 - Math.min(idx, 9);
      if (p.unit === 'kg' || (p.unit === 'g' && p.qty >= 300) || p.unit === 'lb') score += 6;
      if (has(text, w)) score += 2;
      if (score > bestScore) { bestScore = score; best = label; }
      break;
    }
  });
  return best;
}

function cookingMethod(steps) {
  const t = norm(steps.join(' '));
  if (/(צולימ|על הגריל|grill)/.test(t)) return 'על הגריל';
  if (/(אופימ|בתנור|תנור|roast|bake|oven)/.test(t)) return 'בתנור';
  if (/(מטגנימ|טיגונ|fry)/.test(t)) return 'מטוגן';
  if (/(מבשלימ|סיר|simmer|boil)/.test(t)) return 'בסיר';
  return '';
}

const ALONE = { 'עוגת': 'עוגה', 'פשטידת': 'פשטידה', 'גלידת': 'גלידה', 'שיפודי': 'שיפודים' };
const STANDALONE = new Set(['קציצות', 'שקשוקה', 'חומוס', 'פלאפל', 'סביח', 'מג׳דרה', 'טחינה', 'חלה', 'פיתות', 'גרנולה']);
const WITH = new Set(['פסטה', 'ספגטי', 'פנה', 'אורז', 'פתיתים', 'קוסקוס', 'פיצה', 'לחם', 'טוסט', 'כריך', 'חביתה', 'פנקייק', 'עוגיות', 'מאפינס', 'בראוניז', 'פוקאצ׳ה', 'קיש', 'טאקו', 'נודלס', 'לזניה', 'ניוקי', 'ריזוטו', 'לחמניות', 'בורקס', 'מאפה', 'טורטיות', 'וופל', 'קרפ', 'פריטטה', 'כיסונים', 'צ׳פאטי', 'מוקפץ']);

const BAD_TITLE = /(on instagram|on tiktok|instagram|tiktok|youtube|@|\b(19|20)\d{2}\b|likes?|comments?|follow|link in bio|recipe below|המתכון (למטה|בתגובות)|לייק|עוקבים)/i;

/** Is this title already a good dish name? */
export function goodTitle(t) {
  const s = String(t || '').trim();
  if (!s || s.length > 60 || BAD_TITLE.test(s)) return false;
  const words = s.split(/\s+/).length;
  if (words > 8) return false;
  if (findDish(norm(s))) return true;
  // short and specific is fine ("חזה עוף בטריאקי"); vague phrases are not ("המתכון של סבתא שלי")
  return words <= 4 && !GENERIC.test(s) && !!findMainWord(norm(s));
}
const GENERIC = /(מתכון|שלי|סבתא|אמא|הכי|מושלם|טעים|מטורף|ממכר|מנצח|קל|מהיר|ארוחת|לשישי|לשבת|recipe|my |best|easy|quick|dinner|lunch|favorite|yummy)/i;
const findMainWord = (s) => MAINS.find(([w]) => has(s, w));

/** Best dish name for a draft: { title, ingredients, steps, description }. */
export function dishName(d, hint = '') {
  if (goodTitle(d.title) && findDish(norm(d.title))) return d.title.trim();
  const ingText = (d.ingredients || []).join(' ');
  const all = norm([hint, d.title, d.description, (d.ingredients || []).filter((l) => /^##|:$/.test(l.trim())).join(' '), (d.steps || []).join(' ')].join(' '));
  const dish = findDish(norm([hint, d.title, d.description].join(' '))) || findDish(all, true) || findDish(all);
  const main = findMain(d.ingredients || [], all);
  if (dish) {
    if (main && !norm(dish.name).includes(norm(main)) && !STANDALONE.has(dish.name)) {
      // "עוגת שוקולד", "מרק עוף", "שווארמה הודו" — but "פסטה עם פטריות", "עוגיות עם שוקולד"
      return dish.construct || !WITH.has(dish.name) ? `${dish.name} ${main}` : `${dish.name} עם ${main}`;
    }
    const how0 = cookingMethod(d.steps || []);
    const base = ALONE[dish.name] || dish.name;
    return (how0 === 'בתנור' || how0 === 'על הגריל') && !STANDALONE.has(dish.name) && !/(עוג|לחם|חלה|פיתות|מאפ|בורקס|פיצה|פוקאצ|לחמניות|קיש|פשטיד|בראוניז|מאפינס|טארט|פאי)/.test(base) ? `${base} ${how0}` : base;
  }
  if (goodTitle(d.title)) return d.title.trim();
  const ingNames = norm((d.ingredients || []).map((l) => parseIngredient(l)?.name || '').join(' , '));
  const how = cookingMethod(d.steps || []);
  // baked sweets: flour + sugar → cake / cookies
  if (/(קמח|flour)/.test(ingNames) && /(סוכר|sugar|דבש|honey)/.test(ingNames) && how === 'בתנור') {
    const cookies = /(עוגיות|כדורים|cookies|balls)/.test(norm((d.steps || []).join(' ')));
    const sweet = main && ['שוקולד', 'תפוזים', 'לימון', 'בננה', 'תפוחים', 'גזר', 'שיבולת שועל', 'דלעת'].includes(main) ? main : '';
    return cookies ? (sweet ? `עוגיות ${sweet}` : 'עוגיות') : (sweet ? `עוגת ${sweet}` : 'עוגה');
  }
  const ingDish = findDish(ingNames, true);
  if (ingDish) {
    if (main && !norm(ingDish.name).includes(norm(main))) return `${ingDish.name} ${WITH.has(ingDish.name) ? 'עם ' : ''}${main}`;
    return `${ALONE[ingDish.name] || ingDish.name}${how ? ' ' + how : ''}`;
  }
  if (main) return how ? `${main} ${how}` : main;
  const first = (d.ingredients || []).map(parseIngredient).find((p) => p && !p.header && p.name);
  return first ? `מתכון עם ${first.name.split(/[,(]/)[0].trim()}` : 'מתכון חדש';
}
