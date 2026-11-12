// Hebrew voice: hands-free commands for cooking mode, dictation for importing recipes,
// and read-aloud (text-to-speech). Uses the browser's built-in speech engine
// (on iPhone this is Apple's dictation, so Siri & Dictation must be enabled).
import { norm, isIOS } from './util.js';
import { findDurations } from './parse.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;
export const ttsSupported = 'speechSynthesis' in window;

/* ---------------- command grammar ---------------- */
const W = (alts) => new RegExp(`(?:^| )(?:${alts})(?= |$)`);
const ORD = { 'ראשונ': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5, 'שישי': 6, 'שביעי': 7, 'שמיני': 8, 'תשיעי': 9, 'עשירי': 10, 'אחת': 1, 'אחד': 1, 'שתיימ': 2, 'שתיים': 2, 'שלוש': 3, 'ארבע': 4, 'חמש': 5, 'שש': 6, 'שבע': 7, 'שמונה': 8, 'תשע': 9, 'עשר': 10 };

// Order matters: first match wins.
const COMMANDS = [
  { cmd: 'timerStop', fast: false, rx: /(עצור|תעצור|תעצרי|בטל|תבטל|תבטלי|כבה|תכבה|הפסק|תפסיק).*(טיימר|שעונ|טיימרימ|אזעקה|צלצול)|^(השתק|שקט שקט)$/ },
  { cmd: 'timeLeft', fast: false, rx: /(כמה זמנ נשאר|כמה נשאר|מה נשאר בטיימר|כמה עוד)/ },
  { cmd: 'timer', fast: false, rx: W('טיימר|תזמנ|תזמני|שעונ עצר|הפעל טיימר|תפעיל טיימר|timer') },
  { cmd: 'goto', fast: false, rx: /(?:^| )(?:שלב|לשלב|צעד)\s+(\d+|ראשונ|שני|שלישי|רביעי|חמישי|שישי|שביעי|שמיני|תשיעי|עשירי|אחת|אחד|שתיימ|שלוש|ארבע|חמש|שש|שבע|שמונה|תשע|עשר)(?= |$)/ },
  { cmd: 'first', fast: false, rx: W('מההתחלה|להתחלה|התחלה|שלב ראשונ|לשלב הראשונ') },
  { cmd: 'last', fast: false, rx: W('שלב אחרונ|לשלב האחרונ|לסופ') },
  { cmd: 'prev', fast: true, rx: W('הקודמ|הקודמת|אחורה|תחזור אחורה|חזור אחורה|תחזרי אחורה|שלב קודמ|back|previous|בק') },
  { cmd: 'next', fast: true, rx: W('הבא|הבאה|הלאה|קדימה|תמשיכ|תמשיכי|המשכ|נקסט|next|שלב הבא|יאללה|סיימתי שלב|בוצע|עשיתי') },
  { cmd: 'down', fast: true, rx: W('למטה|תרד|תרדי|גלול למטה|תגלול למטה|רד|down') },
  { cmd: 'up', fast: true, rx: W('למעלה|תעלה|תעלי|גלול למעלה|תגלול למעלה|עלה|up') },
  { cmd: 'readIngredients', fast: false, rx: /(תקרא|תקראי|קרא|קראי|תגיד|תגידי).*(מצרכימ|רכיבימ|מרכיבימ)/ },
  { cmd: 'ingredients', fast: false, rx: W('מצרכימ|רכיבימ|מרכיבימ|המצרכימ|הרכיבימ|ingredients|רשימת מצרכימ') },
  { cmd: 'close', fast: false, rx: W('סגור|תסגור|תסגרי|סגרי|close|חזרה לשלב|תחזור לשלב') },
  { cmd: 'repeat', fast: false, rx: W('שוב|עוד פעמ|תחזור|תחזרי|תקרא|תקראי|קרא|קראי|תגיד שוב|מה כתוב|repeat|again') },
  { cmd: 'mute', fast: false, rx: W('שקט|די|תפסיק לקרוא|תפסיק להקריא|בלי הקראה|stop') },
  { cmd: 'exit', fast: false, rx: W('סיימתי לבשל|יציאה|צא ממצב בישול|סיום בישול|סגור מצב בישול') },
  { cmd: 'ask', fast: false, rx: /(?:^| )(כמה|במה|איכ|מה|מתי|למה|האמ|אפשר|אינ לי|נגמר|יותר מדי|יצא|יצאה)(?= |$)/ },
];

export function parseCommand(text) {
  const t = norm(text).replace(/(^| )(בבקשה|אוקיי|אוקי|טוב|נו)(?= |$)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const c of COMMANDS) {
    const m = t.match(c.rx);
    if (!m) continue;
    const out = { cmd: c.cmd, text: t };
    if (c.cmd === 'goto') out.arg = /\d/.test(m[1]) ? parseInt(m[1], 10) : ORD[m[1]];
    if (c.cmd === 'timer') { const d = findDurations(text); out.arg = d.length ? d[0].seconds : null; }
    if (c.cmd === 'ask') out.arg = text;
    return out;
  }
  return null;
}
const isFast = (cmd) => COMMANDS.find((c) => c.cmd === cmd)?.fast;

/* ---------------- continuous command listener ---------------- */
export class VoiceControl {
  constructor({ onCommand, onHeard, onState, lang = 'he-IL' }) {
    this.onCommand = onCommand; this.onHeard = onHeard || (() => {}); this.onState = onState || (() => {});
    this.lang = lang; this.active = false; this.speaking = false; this.rec = null;
    this.consumed = new Map(); this.session = 0; this.lastFire = { cmd: '', t: 0 }; this.failures = 0;
  }

  start() {
    if (!SR) { this.onState('unsupported'); return false; }
    this.active = true; this.failures = 0;
    this._open();
    return true;
  }

  stop() {
    this.active = false;
    clearTimeout(this._restartT);
    try { this.rec?.abort(); } catch { /* already stopped */ }
    this.rec = null;
    this.onState('off');
  }

  _open() {
    if (!this.active || this.speaking) return;
    try { this.rec?.abort(); } catch { /* ignore */ }
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    this.session++; this.consumed.clear();
    const session = this.session;
    rec.onstart = () => { this.failures = 0; this.onState('listening'); };
    rec.onresult = (e) => { if (session === this.session) this._onResult(e); };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.active = false; this.onState(e.error === 'service-not-allowed' ? 'blocked-service' : 'blocked');
      } else if (e.error === 'network') { this.failures++; this.onState('network'); }
      else if (e.error === 'audio-capture') { this.active = false; this.onState('no-mic'); }
    };
    rec.onend = () => {
      if (session !== this.session) return;
      if (!this.active || this.speaking) return;
      // the engine stops after silence; keep listening by reopening
      const delay = Math.min(4000, 250 + this.failures * 900);
      this.onState('restarting');
      this._restartT = setTimeout(() => this._open(), delay);
    };
    this.rec = rec;
    try { rec.start(); } catch { this._restartT = setTimeout(() => this._open(), 600); }
  }

  _fire(c) {
    const now = Date.now();
    if (c.cmd === this.lastFire.cmd && now - this.lastFire.t < 900) return;
    this.lastFire = { cmd: c.cmd, t: now };
    this.onCommand(c);
  }

  _onResult(e) {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      // pick the alternative that contains a command, else the top one
      let text = res[0].transcript;
      for (let a = 0; a < res.length; a++) { if (parseCommand(res[a].transcript)) { text = res[a].transcript; break; } }
      const words = norm(text).split(' ').filter(Boolean);
      let st = this.consumed.get(i) || { n: 0, final: false, text: '' };
      // Safari can start a new phrase at an index that already held a finished one
      if (st.final && (!res.isFinal || text !== st.text)) st = { n: 0, final: false, text: '' };
      else if (st.final) continue; // the same final result delivered again
      const freshWords = words.slice(st.n);
      const fresh = freshWords.join(' ');
      this.onHeard(text, res.isFinal);
      if (!res.isFinal) {
        const c = fresh && parseCommand(fresh);
        if (c && isFast(c.cmd) && freshWords.length <= 3) { st = { ...st, n: words.length }; this._fire(c); }
        this.consumed.set(i, st);
        continue;
      }
      this.consumed.set(i, { n: words.length, final: true, text });
      const c = fresh && parseCommand(fresh);
      if (c) this._fire(c);
    }
  }

  /** Speak text; listening pauses while speaking so the app doesn't hear itself. */
  speak(text, { rate = 1 } = {}) {
    const id = (this._utter = (this._utter || 0) + 1);
    return speak(text, {
      rate,
      before: () => { this.speaking = true; try { this.rec?.abort(); } catch { /* ignore */ } this.onState('speaking'); },
      // only the latest utterance may reopen the mic (an interrupted one ends early)
      after: () => { if (id !== this._utter) return; this.speaking = false; if (this.active) this._open(); },
    });
  }

  /** Stop reading aloud and go back to listening. */
  hush() { this._utter = (this._utter || 0) + 1; stopSpeaking(); this.speaking = false; if (this.active) this._open(); }
}

/* ---------------- text to speech ---------------- */
let heVoice = null;
function pickVoice() {
  if (!ttsSupported) return null;
  const vs = speechSynthesis.getVoices();
  heVoice = vs.find((v) => /^he|^iw/i.test(v.lang) && /carmit|google/i.test(v.name)) || vs.find((v) => /^he|^iw/i.test(v.lang)) || null;
  return heVoice;
}
if (ttsSupported) { pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }
export const hasHebrewVoice = () => !!(heVoice || pickVoice()) || isIOS();

export function speak(text, { rate = 1, before, after } = {}) {
  if (!ttsSupported || !text) { after?.(); return Promise.resolve(); }
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[⁦-⁩]/g, '').replace(/[•#*]/g, ' '));
    u.lang = 'he-IL';
    const v = heVoice || pickVoice();
    if (v) u.voice = v;
    u.rate = rate;
    let finished = false, started = false;
    const end = () => { if (finished) return; finished = true; clearTimeout(guard); clearTimeout(noStart); setTimeout(() => { after?.(); resolve(); }, 250); };
    u.onend = end; u.onerror = end; u.onstart = () => { started = true; };
    // safety nets: some engines never fire onend; iOS may silently refuse speech not started by a tap
    const guard = setTimeout(end, 2500 + String(text).length * 110);
    const noStart = setTimeout(() => { if (!started && !speechSynthesis.speaking) end(); }, 1500);
    before?.();
    speechSynthesis.speak(u);
  });
}
export const stopSpeaking = () => { try { speechSynthesis.cancel(); } catch { /* ignore */ } };

/* ---------------- dictation (import a recipe by speaking) ---------------- */
export class Dictation {
  constructor({ onText, onState, lang = 'he-IL', sep = ' ' }) {
    this.onText = onText; this.onState = onState || (() => {}); this.lang = lang; this.sep = sep;
    this.finalText = ''; this.active = false;
  }
  start() {
    if (!SR) { this.onState('unsupported'); return false; }
    this.active = true; this._open(); return true;
  }
  _open() {
    const rec = new SR();
    rec.lang = this.lang; rec.continuous = true; rec.interimResults = true;
    let sessionFinal = '';
    rec.onstart = () => this.onState('listening');
    rec.onresult = (e) => {
      let interim = '';
      sessionFinal = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) sessionFinal += t.trim() + this.sep; else interim += t;
      }
      this.onText((this.finalText + sessionFinal + interim).trim());
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.active = false; this.onState('blocked'); } };
    rec.onend = () => {
      this.finalText += sessionFinal;
      sessionFinal = '';
      if (this.active) setTimeout(() => this.active && this._open(), 200); else this.onState('off');
    };
    this.rec = rec;
    try { rec.start(); } catch { /* already running */ }
  }
  stop() { this.active = false; try { this.rec?.stop(); } catch { /* ignore */ } }
  get text() { return this.finalText.trim(); }
}

/** Spoken words for new lines in dictation: "שורה חדשה", "מצרכים", "אופן הכנה" */
export function dictationToText(t) {
  return t
    .replace(/\s*(שורה חדשה|ירידת שורה|נקודה ופסיק)\s*/g, '\n')
    .replace(/\s*(?:^|\s)(מצרכים|רכיבים)(?:\s|:|$)/g, '\nמצרכים:\n')
    .replace(/\s*(?:^|\s)(אופן ה?הכנה|הוראות הכנה|הכנה)(?:\s|:|$)/g, '\nאופן ההכנה:\n')
    .replace(/\s*(?:^|\s)(שלב (?:הבא|\d+))(?:\s|$)/g, '\n')
    .replace(/\s+(אחר כך|ואז|לאחר מכן)\s+/g, '\n')
    .trim();
}
