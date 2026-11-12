// The chef assistant chat: type or ask by voice; answers come from the built-in kitchen
// knowledge base and from your own recipes. Works offline.
import { icon, esc } from '../util.js';
import { recipeCard } from '../ui.js';
import { ask, SUGGESTIONS } from '../chef.js';
import { findRecipe } from '../lookup.js';
import { Dictation, voiceSupported, speak, ttsSupported } from '../voice.js';

const history = [];

function msgHtml(m) {
  if (m.me) return `<div class="msg me">${esc(m.text)}</div>`;
  const recs = (m.recipes || []).map(findRecipe).filter(Boolean);
  return `<div class="msg bot">${esc(m.text)}${m.more ? `\n\n<span style="color:var(--on-surface-2)">ועוד: ${esc(m.more)}</span>` : ''}
    ${recs.length ? `<div class="grid" style="padding:10px 0 0;grid-template-columns:repeat(2,minmax(0,1fr))">${recs.map((r) => recipeCard(r, `#/recipe/${r.id}`)).join('')}</div>` : ''}
    ${ttsSupported && m.kind !== 'cook' ? `<div class="msg-actions"><button class="mini" data-say="${esc(m.text)}">${icon('volume-2', '', 16)}הקראה</button></div>` : ''}</div>`;
}

export function render() {
  const html = `
    <div class="big-title" style="padding-top:calc(env(safe-area-inset-top) + 16px);margin-top:calc(-1 * env(safe-area-inset-top))"><p>תחליפים, המרות, טמפרטורות והצלות</p><h1>השף</h1></div>
    <div class="chat" id="chat">
      <div class="msg bot">שלום! אני השף של בישולון – שאלו אותי כל דבר שקורה במטבח: במה להחליף מצרך, כמה גרם יש בכוס, מתי העוף מוכן או איך מצילים רוטב. אני עובד גם בלי אינטרנט.</div>
      ${history.map(msgHtml).join('')}
    </div>
    ${history.length ? '' : `<div class="sugg" id="sugg">${SUGGESTIONS.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
    <div style="height:90px"></div>
    <form class="chat-input" id="cf">
      <label class="search-box">
        <input id="cq" dir="auto" placeholder="שאלו את השף…" enterkeyhint="send" autocomplete="off">
        ${voiceSupported ? `<button type="button" class="icon-btn" data-act="mic" aria-label="שאלה בקול">${icon('mic', '', 22)}</button>` : ''}
      </label>
      <button class="send" aria-label="שליחה">${icon('send', 'flip', 22)}</button>
    </form>`;

  return {
    html, tab: 'chef',
    mount(root) {
      const chat = root.querySelector('#chat');
      const inp = root.querySelector('#cq');
      const scrollDown = () => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      const send = (text, spoken = false) => {
        text = text.trim(); if (!text) return;
        root.querySelector('#sugg')?.remove();
        const me = { me: true, text };
        const a = ask(text);
        const bot = { text: a.text, more: a.more, recipes: a.recipes, kind: a.kind };
        history.push(me, bot);
        chat.insertAdjacentHTML('beforeend', msgHtml(me) + msgHtml(bot));
        inp.value = '';
        scrollDown();
        if (spoken) speak(a.text);
      };
      root.querySelector('#cf').addEventListener('submit', (e) => { e.preventDefault(); send(inp.value); });
      root.addEventListener('click', (e) => {
        const s = e.target.closest('[data-q]'); if (s) { send(s.dataset.q); return; }
        const say = e.target.closest('[data-say]'); if (say) { speak(say.dataset.say); return; }
        const mic = e.target.closest('[data-act="mic"]');
        if (mic) {
          if (mic.classList.contains('on')) { dict?.stop(); mic.classList.remove('on'); inp.placeholder = 'שאלו את השף…'; return; }
          let lastChange = Date.now();
          mic.classList.add('on');
          inp.placeholder = 'מקשיב… שאלו בקול';
          let watch = null;
          const done = (sendIt) => {
            clearInterval(watch); dict?.stop(); mic.classList.remove('on'); inp.placeholder = 'שאלו את השף…';
            if (sendIt && inp.value.trim()) send(inp.value, true);
          };
          dict = new Dictation({
            onText: (t) => { if (t !== inp.value) { inp.value = t; lastChange = Date.now(); } },
            onState: (st) => { if (st === 'blocked') { done(false); inp.placeholder = 'אין הרשאה למיקרופון / הכתבה'; } },
          });
          dict.start();
          // send automatically after ~1.5 s of silence
          watch = setInterval(() => {
            if (!dict?.active) { clearInterval(watch); return; }
            if (inp.value.trim() && Date.now() - lastChange > 1500) done(true);
          }, 250);
        }
      });
      let dict = null;
      if (history.length) scrollDown();
      return () => dict?.stop();
    },
  };
}
