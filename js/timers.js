// Kitchen timers: several at once, saved with their end time so they survive a reload,
// with an alarm tone (Web Audio) + vibration when they finish.
import { getKV, setKV } from './db.js';
import { uid, vibrate } from './util.js';

let timers = [];
const subs = new Set();
let tick = null;
let ctx = null;
let alarmNodes = null;

export const onTimers = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach((fn) => fn(timers));

export function initTimers() {
  timers = (getKV('timers', []) || []).filter((t) => t.state !== 'done' || Date.now() - t.end < 5 * 60e3);
  ensureTick();
  emit();
}

const persist = () => setKV('timers', timers);

/** Must be called from a user gesture once (iOS) so the alarm can play later. */
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch { /* no audio */ }
}

export function addTimer(seconds, label, recipeId = null) {
  unlockAudio();
  const t = { id: uid(), label: label || 'טיימר', total: seconds, end: Date.now() + seconds * 1000, state: 'running', remaining: seconds, recipeId };
  timers.push(t);
  persist(); ensureTick(); emit();
  return t;
}

export function pauseTimer(id) {
  const t = timers.find((x) => x.id === id); if (!t || t.state !== 'running') return;
  t.remaining = Math.max(0, (t.end - Date.now()) / 1000); t.state = 'paused'; persist(); emit();
}
export function resumeTimer(id) {
  const t = timers.find((x) => x.id === id); if (!t || t.state !== 'paused') return;
  unlockAudio(); t.end = Date.now() + t.remaining * 1000; t.state = 'running'; persist(); ensureTick(); emit();
}
export function addTime(id, seconds) {
  const t = timers.find((x) => x.id === id); if (!t) return;
  if (t.state === 'done') { stopAlarm(); t.state = 'running'; t.end = Date.now() + seconds * 1000; t.total = seconds; }
  else if (t.state === 'paused') t.remaining += seconds; else t.end += seconds * 1000;
  t.total = Math.max(t.total, remainingOf(t));
  persist(); ensureTick(); emit();
}
export function removeTimer(id) {
  timers = timers.filter((x) => x.id !== id);
  if (!timers.some((t) => t.state === 'done')) stopAlarm();
  persist(); emit();
}
export function dismissDone() {
  timers = timers.filter((t) => t.state !== 'done'); stopAlarm(); persist(); emit();
}
export const getTimers = () => timers;
export const remainingOf = (t) => (t.state === 'running' ? Math.max(0, (t.end - Date.now()) / 1000) : t.state === 'paused' ? t.remaining : 0);

function ensureTick() {
  if (tick) return;
  tick = setInterval(() => {
    let changed = false;
    for (const t of timers) {
      if (t.state === 'running' && Date.now() >= t.end) { t.state = 'done'; changed = true; startAlarm(); }
    }
    if (changed) persist();
    emit();
    if (!timers.some((t) => t.state === 'running') && !timers.some((t) => t.state === 'done')) { clearInterval(tick); tick = null; }
  }, 250);
}

function startAlarm() {
  vibrate([400, 200, 400, 200, 400]);
  if (alarmNodes) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 880; osc.connect(gain); osc.start();
    // gentle kitchen-timer pattern: three soft beeps, pause, repeat (up to 60 s)
    const t0 = ctx.currentTime;
    for (let r = 0; r < 30; r++) {
      for (let b = 0; b < 3; b++) {
        const s = t0 + r * 2 + b * 0.28;
        gain.gain.setValueAtTime(0, s);
        gain.gain.linearRampToValueAtTime(0.35, s + 0.02);
        gain.gain.linearRampToValueAtTime(0, s + 0.18);
      }
    }
    osc.stop(t0 + 60);
    alarmNodes = { osc, gain };
    osc.onended = () => { alarmNodes = null; };
  } catch { /* no audio */ }
}
export function stopAlarm() {
  try { alarmNodes?.osc.stop(); } catch { /* already stopped */ }
  alarmNodes = null;
}
