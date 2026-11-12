// Cooking mode: one step at a time, big text, screen stays on, and hands-free Hebrew
// voice control – "הבא", "הקודם", "למטה", "למעלה", "שוב", "מצרכים", "טיימר 10 דקות"…
import { put, getKV, setKV } from '../db.js';
import { icon, esc, norm, stem, vibrate, isIOS, isStandalone, fmtClock } from '../util.js';
import { sheet, toast, closeTopSheet, sheetsOpen } from '../ui.js';
import { parseIngredient, scaleIngredient, ingredientLine, findDurations } from '../parse.js';
import { addTimer, getTimers, removeTimer, dismissDone, stopAlarm, remainingOf, unlockAudio } from '../timers.js';
import { VoiceControl, voiceSupported, ttsSupported, stopSpeaking, speak } from '../voice.js';
import { ask } from '../chef.js';
import { findRecipe, isSeed } from '../lookup.js';
import { stepHtml, ingredientsHtml, servingsFor, checkedFor } from './recipe.js';

const LABEL = {
  next: 'הבא', prev: 'הקודם', up: 'למעלה', down: 'למטה', repeat: 'שוב', ingredients: 'מצרכים', readIngredients: 'קריאת מצרכים', close: 'סגור',
  timer: 'טיימר', timerStop: 'עצירת טיימר', timeLeft: 'כמה זמן נשאר', goto: 'מעבר לשלב', first: 'לשלב הראשון', last: 'לשלב האחרון', mute: 'שקט', exit: 'סיום', ask: 'שאלה',
};

/** Ingredients mentioned in a step → scaled lines (shown under the step). */
function stepIngredients(stepText, ings, factor) {
  const words = new Set(norm(stepText).split(' ').map(stem));
  const out = [];
  for (const p of ings) {
    if (p.header || p.qty == null) continue;
    const key = norm(p.name).split(' ').map(stem).filter((w) => w.length > 2);
    if (key.length && words.has(key[0])) out.push(ingredientLine(p, factor));
    if (out.length >= 5) break;
  }
  return out;
}

export function render({ id }) {
  const r = findRecipe(id);
  if (!r) return { html: `<div class="empty" style="padding-top:80px"><div class="empty-art">${icon('search', '', 40)}</div><h2>המתכון לא נמצא</h2><p>ייתכן שהוא נמחק מהספר.</p><div class="btns"><a class="btn filled" href="#/">לספר המתכונים</a></div></div>`, tab: 'book' };
  const steps = r.steps?.length ? r.steps : ['אין שלבים במתכון הזה.'];
  const base = r.servings || 0;
  const servings = servingsFor(id) || base;
  const factor = base && servings ? servings / base : 1;
  const ings = (r.ingredients || []).map(parseIngredient).filter(Boolean);
  const startIdx = Math.min(getKV(`cookpos:${id}`, 0) || 0, steps.length - 1);

  const html = `
    <div class="cook">
      <header class="cook-top">
        <button class="icon-btn" data-act="exit" aria-label="יציאה ממצב בישול">${icon('x')}</button>
        <div class="grow"><b>${esc(r.title)}</b><small id="ctr" class="num">שלב 1 מתוך ${steps.length}</small></div>
        <button class="icon-btn" data-act="ings" aria-label="מצרכים">${icon('list-checks')}</button>
        <button class="icon-btn" data-act="tts" aria-label="הקראה בקול" aria-pressed="false">${icon('volume-x')}</button>
        <button class="icon-btn" data-act="mic" aria-label="שליטה קולית" aria-pressed="false">${icon('mic-off')}</button>
      </header>
      <div class="cook-progress"><i id="prog" style="transform:scaleX(0)"></i></div>
      <ol class="cook-steps" id="csteps">
        ${steps.map((s, i) => {
          const si = stepIngredients(s, ings, factor);
          return `<li class="cstep" data-i="${i}"><div class="cs-n"><span class="num">שלב ${i + 1}</span></div><div class="cs-t">${stepHtml(s, id, i)}</div>${si.length ? `<div class="cs-ing">${si.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</li>`;
        }).join('')}
        <li class="cstep done-card" data-i="${steps.length}">
          <div class="empty-art" style="margin:4px auto 10px;transform:none">${icon('chef-hat', '', 40)}</div>
          <div class="cs-t" style="font-weight:700">בתאבון!</div>
          <p class="hint" style="margin:6px 0 14px">סיימתם את כל השלבים.</p>
          <button class="btn filled" data-act="finish">${icon('check')}סיום בישול</button>
        </li>
      </ol>
      <div class="cook-bottom">
        <button class="voice-pill" id="vpill" data-act="vhelp" aria-live="polite">
          <span class="mic-dot" id="vdot">${icon('mic', '', 16)}</span><span class="heard" id="vheard">${voiceSupported ? 'הפעילו שליטה קולית ובשלו בלי ידיים' : 'מה אפשר לומר?'}</span>
        </button>
        <div class="cook-nav">
          <button class="btn prev" data-act="prev" aria-label="השלב הקודם">${icon('arrow-right')}</button>
          <button class="btn filled" data-act="next" id="nextBtn">הבא${icon('arrow-left')}</button>
        </div>
      </div>
      <video id="keepawake" muted playsinline loop src="assets/blank.mp4" style="position:fixed;width:1px;height:1px;opacity:0;pointer-events:none" aria-hidden="true"></video>
    </div>`;

  return {
    html, nav: false, title: `מבשלים: ${r.title}`,
    mount(root, { navigate }) {
      let idx = -1;
      let tts = !!getKV('settings', {}).autoRead;
      let voice = null;
      let wakeLock = null;
      let alive = true;
      const cards = [...root.querySelectorAll('.cstep')];
      const ctr = root.querySelector('#ctr');
      const prog = root.querySelector('#prog');
      const vheard = root.querySelector('#vheard');
      const vdot = root.querySelector('#vdot');
      const vpill = root.querySelector('#vpill');
      const nextBtn = root.querySelector('#nextBtn');
      const ttsBtn = root.querySelector('[data-act="tts"]');
      const micBtn = root.querySelector('[data-act="mic"]');

      const say = (text) => {
        if (!text) return Promise.resolve();
        if (voice?.active) return voice.speak(text);
        return speak(text);
      };
      const readStep = () => {
        if (idx >= steps.length) return say('בתאבון! סיימתם את כל השלבים.');
        return say(`שלב ${idx + 1}. ${steps[idx]}`);
      };

      let scrollFix;
      const centerCard = (i, smooth) => {
        const c = cards[i]; if (!c) return;
        const r = c.getBoundingClientRect();
        const target = Math.max(0, window.scrollY + r.top - (window.innerHeight - r.height) / 2 + 20);
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: target, behavior: smooth && !reduce ? 'smooth' : 'auto' });
        clearTimeout(scrollFix);
        scrollFix = setTimeout(() => { if (Math.abs(window.scrollY - target) > 8 && alive) window.scrollTo(0, target); }, 700);
      };
      const setIdx = (i, { read = tts, smooth = true } = {}) => {
        i = Math.max(0, Math.min(steps.length, i));
        if (i === idx) { centerCard(i, smooth); return; }
        idx = i;
        cards.forEach((c, k) => { c.classList.toggle('cur', k === i); c.classList.toggle('past', k < i); });
        ctr.textContent = i >= steps.length ? 'סיימתם!' : `שלב ${i + 1} מתוך ${steps.length}`;
        prog.style.transform = `scaleX(${Math.min(1, (i + (i >= steps.length ? 0 : 1)) / steps.length)})`;
        nextBtn.innerHTML = i >= steps.length - 1 ? (i >= steps.length ? `${icon('check')}סיום` : `סיימתי${icon('check')}`) : `הבא${icon('arrow-left')}`;
        centerCard(i, smooth);
        setKV(`cookpos:${id}`, Math.min(i, steps.length - 1));
        if (read) { stopSpeaking(); readStep(); }
      };

      /* ---------- wake lock ---------- */
      // iOS home-screen apps before 18.4 accept a wake lock but don't honour it, so also play a silent video there
      const iosVer = parseFloat((navigator.userAgent.match(/OS (\d+)_(\d+)/) || []).slice(1).join('.')) || 0;
      const needVideo = isIOS() && (!('wakeLock' in navigator) || (isStandalone() && iosVer && iosVer < 18.4));
      const playVideo = () => root.querySelector('#keepawake')?.play().catch(() => { /* needs a tap first */ });
      const keepAwake = async () => {
        if (getKV('settings', {}).keepAwake === false) return;
        if ('wakeLock' in navigator) {
          try {
            const lock = await navigator.wakeLock.request('screen');
            if (!alive) { lock.release().catch(() => {}); return; } // left cook mode while waiting
            wakeLock = lock;
          } catch { /* fall back to the video */ }
        }
        if (needVideo || !wakeLock) playVideo();
      };
      const onVis = () => { if (document.visibilityState === 'visible' && alive) keepAwake(); };
      document.addEventListener('visibilitychange', onVis);
      keepAwake();

      /* ---------- ingredients sheet ---------- */
      let ingClose = null;
      const openIngs = (readAloud = false) => {
        if (ingClose) { if (readAloud) readIngs(); return; }
        const checked = checkedFor(id);
        ingClose = sheet({
          title: `מצרכים${base ? ` · ${servings} מנות` : ''}`,
          html: `<ul class="ing-list">${ingredientsHtml(r, factor, checked)}</ul><p class="hint" style="margin-top:10px">אמרו "למטה" / "למעלה" לגלילה, "סגור" לחזרה לשלבים.</p>`,
          mount: (b) => b.addEventListener('click', (e) => {
            const li = e.target.closest('[data-ing]'); if (!li) return;
            const i = +li.dataset.ing; checked.has(i) ? checked.delete(i) : checked.add(i);
            li.classList.toggle('done', checked.has(i));
          }),
          onClose: () => { ingClose = null; },
        });
        if (readAloud) readIngs();
      };
      const readIngs = () => {
        const lines = ings.map((p) => (p.header ? `${p.name}:` : ingredientLine(p, factor)));
        say(lines.join('. '));
      };
      const scrollSheet = (dir) => {
        const body = document.querySelector('#sheets .sheet-wrap:last-child .sheet-body');
        if (!body) return;
        const target = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, body.scrollTop + dir * body.clientHeight * 0.6));
        body.scrollTo({ top: target, behavior: 'smooth' });
        setTimeout(() => { if (Math.abs(body.scrollTop - target) > 4) body.scrollTop = target; }, 450);
      };

      /* ---------- timers ---------- */
      const startStepTimer = (secs) => {
        let s = secs;
        if (!s) { const d = idx < steps.length ? findDurations(steps[idx]) : []; s = d[0]?.seconds; }
        if (!s) { feedback('לא מצאתי זמן בשלב הזה – אמרו למשל "טיימר 10 דקות"'); say('לא מצאתי זמן בשלב הזה. אמרו למשל: טיימר עשר דקות'); return; }
        addTimer(s, `שלב ${Math.min(idx, steps.length - 1) + 1} · ${r.title}`, id);
        const mins = Math.round(s / 60);
        const txt = s < 60 ? `${s} שניות` : mins === 1 ? 'דקה' : `${mins} דקות`;
        feedback(`טיימר הופעל: ${txt}`);
        say(`הפעלתי טיימר ל${txt}`);
      };
      const stopTimer = () => {
        const ts = getTimers();
        if (ts.some((t) => t.state === 'done')) { dismissDone(); feedback('הטיימר כובה'); return; }
        const running = ts.filter((t) => t.state !== 'done');
        if (!running.length) { feedback('אין טיימר פעיל'); return; }
        removeTimer(running[running.length - 1].id); feedback('הטיימר בוטל'); say('ביטלתי את הטיימר');
      };
      const timeLeft = () => {
        const ts = getTimers().filter((t) => t.state !== 'done').sort((a, b) => remainingOf(a) - remainingOf(b));
        if (!ts.length) { say('אין טיימר פעיל'); feedback('אין טיימר פעיל'); return; }
        const s = Math.round(remainingOf(ts[0]));
        const m = Math.floor(s / 60), sec = s % 60;
        const txt = m ? `${m === 1 ? 'דקה' : `${m} דקות`}${sec ? ` ו-${sec} שניות` : ''}` : `${sec} שניות`;
        feedback(`נשארו ${fmtClock(s)}`); say(`נשארו ${txt}`);
      };

      /* ---------- voice ---------- */
      let fbT;
      const feedback = (text, ok = true) => {
        vheard.textContent = text;
        vpill.classList.remove('flash'); void vpill.offsetWidth; if (ok) vpill.classList.add('flash');
        clearTimeout(fbT);
        fbT = setTimeout(() => { if (voice?.active) vheard.textContent = 'מקשיב… אמרו "הבא" או "מצרכים"'; }, 4000);
      };

      const handle = (c) => {
        if (!alive) return;
        vibrate(12);
        const sheetUp = sheetsOpen() > 0;
        const label = LABEL[c.cmd] || c.cmd;
        if (c.cmd !== 'ask') feedback(`✓ ${label}${c.cmd === 'goto' && c.arg ? ` ${c.arg}` : ''}`);
        switch (c.cmd) {
          case 'next': if (sheetUp && ingClose) { scrollSheet(1); break; } setIdx(idx + 1); break;
          case 'prev': if (sheetUp && ingClose) { scrollSheet(-1); break; } setIdx(idx - 1); break;
          case 'down': if (sheetUp) scrollSheet(1); else setIdx(idx + 1); break;
          case 'up': if (sheetUp) scrollSheet(-1); else setIdx(idx - 1); break;
          case 'repeat': stopSpeaking(); readStep(); break;
          case 'ingredients': openIngs(false); break;
          case 'readIngredients': openIngs(true); break;
          case 'close': if (sheetUp) closeTopSheet(); break;
          case 'timer': startStepTimer(c.arg); break;
          case 'timerStop': stopTimer(); break;
          case 'timeLeft': timeLeft(); break;
          case 'goto': if (c.arg) setIdx(c.arg - 1); break;
          case 'first': setIdx(0); break;
          case 'last': setIdx(steps.length - 1); break;
          case 'mute': stopAlarm(); setTts(false); voice?.hush(); break;
          case 'exit': finish(false); break;
          case 'ask': {
            const a = ask(c.arg, { recipe: r, factor });
            if (a.kind === 'none') { feedback(`לא הבנתי: "${c.arg}"`, false); return; }
            feedback(a.text.split('\n')[0]);
            showAnswer(c.arg, a.text);
            say(a.text);
            break;
          }
          default: break;
        }
      };

      let answerClose = null;
      const showAnswer = (q, text) => {
        answerClose?.();
        answerClose = sheet({ title: 'השף עונה', html: `<p class="hint" style="margin-bottom:6px">${esc(q)}</p><div class="notes-box">${esc(text)}</div>`, onClose: () => { answerClose = null; } });
      };

      const setMicUI = (on) => {
        micBtn.classList.toggle('on', on); micBtn.setAttribute('aria-pressed', on);
        micBtn.innerHTML = icon(on ? 'mic' : 'mic-off');
        vdot.classList.toggle('live', on);
      };
      const startVoice = () => {
        if (!voiceSupported) { helpSheet(); return; }
        unlockAudio();
        voice = new VoiceControl({
          onCommand: handle,
          onHeard: (t, final) => { if (final || t.length < 40) vheard.textContent = `"${t.trim()}"`; },
          onState: (s) => {
            if (!alive) return;
            if (s === 'listening') { setMicUI(true); setKV('voiceOk', true); if (!vheard.textContent.startsWith('✓')) vheard.textContent = 'מקשיב… אמרו "הבא" או "מצרכים"'; }
            else if (s === 'speaking') vheard.textContent = 'מקריא…';
            else if (s === 'blocked' || s === 'blocked-service' || s === 'no-mic' || s === 'unsupported') {
              setMicUI(false); voice = null; setKV('voiceOk', false);
              const msg = s === 'no-mic' ? 'לא נמצא מיקרופון.'
                : isIOS() && isStandalone() && s === 'blocked-service' ? 'באייפון, זיהוי דיבור לא זמין באפליקציה שהותקנה למסך הבית בגרסה הזו. פתחו את בישולון בספארי לשליטה קולית.'
                  : isIOS() ? 'אין הרשאה. באייפון: הגדרות ← Siri ← הפעלת "הכתבה", ובספארי אשרו גישה למיקרופון.' : 'אין הרשאה למיקרופון. אשרו גישה בהגדרות הדפדפן ונסו שוב.';
              vheard.textContent = 'השליטה הקולית כבויה';
              sheet({ title: 'השליטה הקולית לא הופעלה', html: `<div class="notice">${icon('mic-off', '', 20)}<span>${esc(msg)}</span></div><div class="sheet-actions"><button class="btn filled block" data-close>הבנתי</button></div>` });
            } else if (s === 'network') vheard.textContent = 'זיהוי הדיבור צריך אינטרנט – מנסה שוב…';
          },
        });
        voice.start();
      };
      const stopVoice = () => { voice?.stop(); voice = null; setMicUI(false); vheard.textContent = 'השליטה הקולית כבויה – לחצו על המיקרופון'; };
      const setTts = (on) => {
        tts = on; ttsBtn.classList.toggle('on', on); ttsBtn.setAttribute('aria-pressed', on); ttsBtn.innerHTML = icon(on ? 'volume-2' : 'volume-x');
        const st = getKV('settings', {}); setKV('settings', { ...st, autoRead: on });
        if (!on) stopSpeaking();
      };
      setTts(tts);

      const helpSheet = () => sheet({
        title: 'מה אפשר לומר?',
        html: `${!voiceSupported ? `<div class="notice">${icon('info', '', 20)}<span>הדפדפן הזה לא תומך בזיהוי דיבור. באייפון – השתמשו בספארי (עם "הכתבה" מופעלת בהגדרות Siri).</span></div>` : ''}
          <dl class="cmd-list">
            <dt>"הבא" / "למטה"</dt><dd>לשלב הבא</dd>
            <dt>"הקודם" / "למעלה"</dt><dd>לשלב הקודם (בתוך רשימת המצרכים – גלילה)</dd>
            <dt>"שוב"</dt><dd>הקראת השלב הנוכחי</dd>
            <dt>"שלב 3"</dt><dd>מעבר לשלב מסוים · "מההתחלה" · "שלב אחרון"</dd>
            <dt>"מצרכים"</dt><dd>פתיחת רשימת המצרכים · "תקרא מצרכים" · "סגור"</dd>
            <dt>"טיימר"</dt><dd>טיימר לפי הזמן שבשלב · "טיימר 10 דקות"</dd>
            <dt>"כמה זמן נשאר"</dt><dd>הזמן שנשאר בטיימר · "עצור טיימר"</dd>
            <dt>"כמה סוכר?"</dt><dd>הכמות מהמתכון, לפי מספר המנות</dd>
            <dt>"במה להחליף ביצים?"</dt><dd>שאלות לשף: תחליפים, המרות, הצלות</dd>
            <dt>"שקט"</dt><dd>הפסקת הקראה</dd>
          </dl>
          <p class="hint" style="margin-top:10px">מדברים רגיל, בלי מילת הפעלה. כשהאפליקציה מקריאה היא לא מקשיבה – חכו שתסיים.</p>
          <div class="sheet-actions"><button class="btn filled block" data-close>הבנתי</button></div>`,
      });

      const finish = async (done = true) => {
        if (done && !isSeed(id)) {
          const cur = findRecipe(id);
          await put('recipes', { ...cur, cookCount: (cur.cookCount || 0) + 1, lastCooked: Date.now() });
          await setKV(`cookpos:${id}`, 0);
          toast('כל הכבוד! נשמר שבישלתם את המתכון');
        } else if (done) await setKV(`cookpos:${id}`, 0);
        history.state?.depth > 0 ? history.back() : navigate(`#/recipe/${encodeURIComponent(id)}`, { replace: true });
      };

      let unlocked = false;
      root.addEventListener('click', (e) => {
        if (!unlocked) { unlocked = true; unlockAudio(); if (needVideo || !wakeLock) playVideo(); } // first tap: allow alarm sound + keep-awake video
        const tchip = e.target.closest('[data-timer]');
        if (tchip) { e.stopPropagation(); addTimer(+tchip.dataset.timer, `שלב ${+tchip.dataset.step + 1} · ${r.title}`, id); toast(`טיימר הופעל: ${tchip.textContent.trim()}`); return; }
        const b = e.target.closest('[data-act]');
        if (b) {
          const a = b.dataset.act;
          if (a === 'next') { if (idx >= steps.length) finish(true); else setIdx(idx + 1); }
          else if (a === 'prev') setIdx(idx - 1);
          else if (a === 'exit') finish(false);
          else if (a === 'finish') finish(true);
          else if (a === 'ings') openIngs();
          else if (a === 'tts') { setTts(!tts); if (tts) readStep(); }
          else if (a === 'mic') { voice ? stopVoice() : startVoice(); }
          else if (a === 'vhelp') { if (!voice && voiceSupported && !getKV('voiceOk', false)) startVoice(); else helpSheet(); }
          return;
        }
        const card = e.target.closest('.cstep');
        if (card && !card.classList.contains('done-card')) setIdx(+card.dataset.i);
      });
      const onKey = (e) => {
        if (sheetsOpen() || /input|textarea/i.test(e.target.tagName)) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); setIdx(idx + 1); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); setIdx(idx - 1); }
      };
      document.addEventListener('keydown', onKey);

      setIdx(startIdx, { read: false, smooth: false });
      requestAnimationFrame(() => centerCard(startIdx, false));
      if (voiceSupported && getKV('voiceOk', false) && getKV('settings', {}).voiceAuto !== false) startVoice();
      else if (voiceSupported) vheard.textContent = 'לחצו כאן להפעלת שליטה קולית';
      if (startIdx > 0) toast(`ממשיכים משלב ${startIdx + 1}`, { action: 'מההתחלה', onAction: () => setIdx(0) });

      return () => {
        alive = false;
        voice?.stop(); voice = null; stopSpeaking();
        try { wakeLock?.release(); } catch { /* ignore */ }
        root.querySelector('#keepawake')?.pause();
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('keydown', onKey);
        while (sheetsOpen()) closeTopSheet();
      };
    },
  };
}
