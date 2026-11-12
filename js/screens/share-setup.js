// Getting בישולון into the Share menu of Instagram / TikTok / YouTube.
// Android: the installed app is a real share target (manifest share_target).
// iPhone: Apple doesn't let web apps join the share sheet, so a one-time iOS Shortcut
// named "בישולון" does it: it copies the shared link and tells you to open the app,
// which then picks the link up from the clipboard with one tap.
import { icon, esc, isIOS, isStandalone } from '../util.js';
import { sheet, toast } from '../ui.js';
import { getKV, setKV } from '../db.js';

const APP_URL = 'https://dtubugk-gif.github.io/bishulon/';

export function shareSetupSheet() {
  const ios = isIOS();
  const android = /Android/i.test(navigator.userAgent);
  const iosSteps = `
    <ol class="guide">
      <li><b>פותחים את אפליקציית "קיצורים"</b> (Shortcuts) ולוחצים על <b>+</b> למעלה.</li>
      <li>לוחצים על השם למעלה ← <b>שינוי שם</b> ← כותבים <b>בישולון</b>. (אפשר גם לבחור אייקון וצבע.)</li>
      <li>לוחצים על <b>${icon('info', '', 16)}</b> (פרטים) בתחתית ← מפעילים <b>"הצג בגיליון השיתוף"</b> ← <b>סיום</b>.</li>
      <li>בשורה העליונה של הקיצור לוחצים על סוגי הקלט ומשאירים רק <b>כתובות URL</b> ו<b>טקסט</b>.</li>
      <li><b>הוספת פעולה</b> ← מחפשים <b>"העתק ללוח"</b> (Copy to Clipboard) ← בוחרים. היא תעתיק את <b>קלט הקיצור</b> אוטומטית.</li>
      <li><b>הוספת פעולה</b> ← מחפשים <b>"הצג התראה"</b> (Show Notification) ← כותבים: <span class="copyable">המתכון מוכן – פתחו את בישולון</span></li>
      <li>לוחצים <b>סיום</b>. זהו!</li>
    </ol>
    <div class="notice herb">${icon('sparkles', '', 20)}<span><b>איך משתמשים:</b> באינסטגרם / טיקטוק / יוטיוב ← <b>שיתוף</b> ← <b>בישולון</b> (בפעם הראשונה: "עוד" ← מסמנים את בישולון). אחר כך פותחים את בישולון – יופיע כפתור <b>"ייבוא המתכון ששיתפתם"</b>. לוחצים, מאשרים "הדבק" – והמתכון נשמר.</span></div>
    <div class="sheet-actions"><a class="btn filled block" href="shortcuts://create-shortcut">${icon('square-plus', '', 20)}פתיחת אפליקציית קיצורים</a></div>
    <p class="hint" style="margin-top:10px">גם בלי הקיצור: בכל אפליקציה לוחצים "העתקת קישור" ופותחים את בישולון – הכפתור יופיע.</p>`;
  const androidSteps = `
    <ol class="guide">
      <li>פותחים את <b>${esc(APP_URL.replace('https://', ''))}</b> ב<b>כרום</b>.</li>
      <li>תפריט <b>⋮</b> ← <b>"התקנת אפליקציה"</b> (או "הוספה למסך הבית").</li>
      <li>זהו. באינסטגרם / טיקטוק / יוטיוב ← <b>שיתוף</b> ← <b>בישולון</b> – והמתכון ייובא ויישמר.</li>
    </ol>
    ${isStandalone() ? `<div class="notice herb">${icon('circle-check', '', 20)}<span>האפליקציה כבר מותקנת – בישולון אמורה להופיע בתפריט השיתוף.</span></div>` : ''}`;
  sheet({
    title: 'בישולון בתפריט השיתוף',
    full: true,
    html: `<p class="hint" style="margin-bottom:12px">כך שומרים מתכון ישר מאינסטגרם, טיקטוק, יוטיוב, פייסבוק ואתרי מתכונים – בלחיצה על "שיתוף".</p>
      ${ios || !android ? `<h3 class="guide-h">${icon('smartphone', '', 18)}באייפון</h3>${iosSteps}` : ''}
      ${android || !ios ? `<h3 class="guide-h">${icon('smartphone', '', 18)}באנדרואיד</h3>${androidSteps}` : ''}`,
    mount: (b) => {
      b.querySelectorAll('.copyable').forEach((el) => el.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(el.textContent); toast('הטקסט הועתק'); } catch { /* ignore */ }
      }));
      setKV('shareGuideSeen', true);
    },
  });
}

/* ---------- picking the shared link up when the app opens / comes back ---------- */
let pillT = null;
let lastShown = 0;

export function initClipboardPickup(navigate) {
  // only where the share sheet can't hand the link over directly (iPhone)
  if (!isIOS() || !navigator.clipboard?.readText) return;
  let hiddenAt = 0;
  const offer = () => {
    if (Date.now() - lastShown < 20000) return;
    if (/#\/(cook|edit)\//.test(location.hash)) return;
    lastShown = Date.now();
    showPill(navigate);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 1500) offer();
  });
  if (getKV('shareGuideSeen', false)) setTimeout(offer, 900); // fresh launch after sharing
}

export function showPill(navigate) {
  document.getElementById('paste-pill')?.remove();
  const el = document.createElement('button');
  el.id = 'paste-pill';
  el.className = 'paste-pill';
  el.innerHTML = `${icon('clipboard-paste', '', 20)}<span>ייבוא המתכון ששיתפתם</span><span class="pp-x" aria-label="סגירה">${icon('x', '', 18)}</span>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const hide = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); clearTimeout(pillT); };
  pillT = setTimeout(hide, 12000);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('.pp-x')) { hide(); return; }
    hide();
    let text = '';
    try { text = (await navigator.clipboard.readText()) || ''; } catch { toast('לא אושרה הדבקה. אפשר גם: + ← מקישור'); return; }
    const link = text.match(/https?:\/\/\S+/)?.[0];
    const { linkFlow, pasteFlow } = await import('./add.js');
    if (link) linkFlow(navigate, link.replace(/[)\]}>"']+$/, ''), { auto: true });
    else if (text.trim().length > 40) pasteFlow(navigate, text.trim());
    else toast('לא נמצא קישור ללוח. בחרו "שיתוף ← בישולון" או "העתקת קישור" ונסו שוב.');
  });
}
