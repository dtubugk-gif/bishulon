// Settings: voice & cooking options, theme, install help, backup / restore, privacy.
import { getKV, setKV, exportAll, importAll, state, clearStore } from '../db.js';
import { icon, esc, isIOS, isStandalone } from '../util.js';
import { toast, confirmSheet, sheet } from '../ui.js';
import { voiceSupported, ttsSupported, speak, hasHebrewVoice } from '../voice.js';
import { applyTheme } from '../app.js';

const sw = (key, on, title, sub) => `<label class="switch-row"><span class="grow">${title}${sub ? `<small>${sub}</small>` : ''}</span>
  <span class="switch"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></span></label>`;

export function render() {
  const s = { theme: 'system', autoRead: false, voiceAuto: true, keepAwake: true, ...getKV('settings', {}) };
  const html = `
    <header class="topbar"><button class="icon-btn" data-act="back" aria-label="חזרה">${icon('arrow-right')}</button><div class="title" style="opacity:1">הגדרות</div></header>
    <div class="settings">
      <h2>מצב בישול</h2>
      ${sw('voiceAuto', s.voiceAuto, 'שליטה קולית אוטומטית', voiceSupported ? 'מתחילה להקשיב כשנכנסים למצב בישול (אחרי שאישרתם מיקרופון פעם אחת)' : 'הדפדפן הזה לא תומך בזיהוי דיבור. באייפון השתמשו בספארי.')}
      ${sw('autoRead', s.autoRead, 'הקראת כל שלב בקול', ttsSupported ? 'האפליקציה מקריאה את השלב כשעוברים אליו' : 'לא נתמך בדפדפן הזה')}
      ${sw('keepAwake', s.keepAwake, 'המסך נשאר דולק', 'בזמן מצב בישול המסך לא נכבה')}
      ${ttsSupported ? `<button class="btn tonal small" data-act="test-voice" style="margin-top:12px">${icon('volume-2', '', 18)}בדיקת קול</button>` : ''}
      ${voiceSupported && isIOS() ? `<div class="notice herb" style="margin-top:12px">${icon('info', '', 20)}<span>באייפון, השליטה הקולית משתמשת בהכתבה של אפל. ודאו ש<b>הגדרות ← Siri ← הכתבה</b> מופעלת ושעברית נמצאת בשפות ההכתבה.</span></div>` : ''}

      <h2>שמירה מאינסטגרם, טיקטוק ויוטיוב</h2>
      <p class="about">הוסיפו את בישולון לתפריט "שיתוף" – ושמרו מתכון מכל סרטון או אתר בלחיצה.</p>
      <button class="btn tonal" data-act="share-setup" style="margin-top:10px">${icon('share', '', 18)}הגדרה (דקה אחת)</button>

      <h2>מראה</h2>
      <div class="seg" id="theme" style="margin-top:8px">
        <button data-theme="system" aria-pressed="${s.theme === 'system'}">${icon('smartphone', '', 18)}אוטומטי</button>
        <button data-theme="light" aria-pressed="${s.theme === 'light'}">${icon('sun', '', 18)}בהיר</button>
        <button data-theme="dark" aria-pressed="${s.theme === 'dark'}">${icon('moon', '', 18)}כהה</button>
      </div>

      <h2>התקנה באייפון</h2>
      ${isStandalone() ? `<p class="about">${icon('circle-check', '', 18).replace('class="ic ', 'style="display:inline;vertical-align:-3px;color:var(--success)" class="ic ')} בישולון מותקנת במסך הבית.</p>` : `<ol class="about" style="padding-inline-start:20px;margin:8px 0 0">
        <li>פתחו את הקישור לאפליקציה ב<b>ספארי</b>.</li>
        <li>לחצו על כפתור <b>השיתוף</b> ${icon('share', '', 16).replace('class="ic ', 'style="display:inline;vertical-align:-3px" class="ic ')} בתחתית המסך.</li>
        <li>בחרו <b>"הוספה למסך הבית"</b> ואז <b>"הוספה"</b>.</li>
      </ol>`}

      <h2>גיבוי ושחזור</h2>
      <p class="about">${state.recipes.length} מתכונים · ${state.albums.length} אלבומים · ${state.shop.length} פריטים ברשימה. הכל שמור רק במכשיר הזה – כדאי לגבות מדי פעם.</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn tonal" data-act="export">${icon('download', '', 18)}שמירת גיבוי</button>
        <label class="btn outline">${icon('upload', '', 18)}שחזור מגיבוי<input type="file" accept=".json,application/json" hidden data-act="import"></label>
      </div>

      <h2>פרטיות</h2>
      <p class="about">המתכונים, הרשימות והתכנונים נשמרים רק בטלפון שלכם – אין חשבון ואין שרת. בייבוא מקישור, הכתובת נשלחת לשירות קריאת דפים ציבורי (r.jina.ai) כדי לקרוא את העמוד. זיהוי דיבור נעשה ע״י מנוע ההכתבה של הטלפון. זיהוי טקסט מתמונה נעשה בטלפון עצמו.</p>

      <h2>אזור מסוכן</h2>
      <button class="btn text" data-act="wipe" style="color:var(--error);padding:0">${icon('trash-2', '', 18)}מחיקת כל הנתונים</button>

      <p class="about" style="margin:28px 0 8px;text-align:center">בישולון · גרסה 1.2<br>ספר מתכונים חכם בעברית</p>
    </div>`;

  return {
    html, tab: 'book', title: 'הגדרות',
    mount(root, { navigate, rerender }) {
      root.addEventListener('change', async (e) => {
        const k = e.target.dataset.set;
        if (k) { await setKV('settings', { ...getKV('settings', {}), [k]: e.target.checked }); return; }
        if (e.target.dataset.act === 'import') {
          const f = e.target.files?.[0]; if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            const n = data.recipes?.length || 0;
            const replace = await confirmSheet({ title: 'שחזור מגיבוי', text: `בקובץ ${n} מתכונים. להחליף את כל מה שיש עכשיו? (ביטול = מיזוג עם הקיים)`, ok: 'החלפה' });
            await importAll(data, { replace });
            toast(`שוחזרו ${n} מתכונים`); rerender();
          } catch { toast('הקובץ לא תקין – בחרו קובץ גיבוי של בישולון'); }
          e.target.value = '';
        }
      });
      root.addEventListener('click', async (e) => {
        const th = e.target.closest('[data-theme]');
        if (th) {
          root.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', b === th));
          await setKV('settings', { ...getKV('settings', {}), theme: th.dataset.theme });
          applyTheme(th.dataset.theme); return;
        }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const a = b.dataset.act;
        if (a === 'share-setup') { (await import('./share-setup.js')).shareSetupSheet(); return; }
        if (a === 'back') history.state?.depth > 0 ? history.back() : navigate('#/', { replace: true });
        else if (a === 'test-voice') {
          if (!hasHebrewVoice()) toast('לא נמצא קול עברי במכשיר. אפשר להוסיף קול בהגדרות הנגישות.');
          speak('שלום! אני בישולון. בואו נבשל משהו טעים.');
        } else if (a === 'export') {
          const blob = new Blob([JSON.stringify(exportAll(), null, 1)], { type: 'application/json' });
          const name = `bishulon-backup-${new Date().toISOString().slice(0, 10)}.json`;
          const file = new File([blob], name, { type: 'application/json' });
          if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'גיבוי בישולון' }); return; } catch (err) { if (err.name === 'AbortError') return; } }
          const url = URL.createObjectURL(blob);
          const link = Object.assign(document.createElement('a'), { href: url, download: name });
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          toast('קובץ הגיבוי נשמר');
        } else if (a === 'wipe') {
          if (await confirmSheet({ title: 'למחוק הכל?', text: 'כל המתכונים, האלבומים, רשימת הקניות והתכנון יימחקו מהמכשיר. אי אפשר לבטל.', ok: 'מחיקת הכל', danger: true })) {
            for (const st of ['recipes', 'albums', 'shop', 'plan']) await clearStore(st);
            toast('כל הנתונים נמחקו'); navigate('#/', { replace: true });
          }
        }
      });
    },
  };
}
