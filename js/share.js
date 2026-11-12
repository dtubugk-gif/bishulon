// Share recipes and shopping lists as self-contained links (data packed in the URL hash,
// nothing is uploaded anywhere), or as plain text through the phone's share sheet.
import { safeUrl } from './util.js';

const b64u = (bytes) => {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b;
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function pack(obj, { compress = false } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (compress && 'CompressionStream' in window) {
    try { return 'z' + b64u(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + b64u(bytes);
}

export async function unpack(str) {
  const kind = str[0], body = str.slice(1);
  let bytes = unb64u(body);
  if (kind === 'z') {
    if (!('DecompressionStream' in window)) throw new Error('old-browser');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

const baseUrl = () => location.href.split('#')[0];

/** Link that opens the recipe in anyone's copy of the app. Photos are left out to keep it short. */
export async function recipeLink(r) {
  const slim = { t: r.title, d: r.description, s: r.servings, p: r.prepTime, c: r.cookTime, i: r.ingredients, st: r.steps, n: r.notes, g: r.tags, u: r.source?.url || '', un: r.source?.name || '' };
  return `${baseUrl()}#/shared/r/${await pack(slim)}`;
}
export function recipeFromSlim(x) {
  const n = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  const arr = (a) => (Array.isArray(a) ? a.map((s) => String(s ?? '')).filter(Boolean) : []);
  return { title: String(x.t || ''), description: String(x.d || ''), servings: n(x.s, null), prepTime: n(x.p, 0), cookTime: n(x.c, 0), ingredients: arr(x.i), steps: arr(x.st), notes: String(x.n || ''), tags: arr(x.g), source: x.u || x.un ? { url: safeUrl(x.u), name: String(x.un || '') } : null };
}

export async function listLink(items) {
  const slim = items.filter((i) => !i.checked).map((i) => [i.name, i.qty, i.unit, i.aisle, i.qty2]);
  return `${baseUrl()}#/shared/l/${await pack(slim)}`;
}

/** Native share sheet with copy-to-clipboard fallback. Returns 'shared' | 'copied' | 'cancelled'. */
export async function shareOut({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText([text, url].filter(Boolean).join('\n\n')); return 'copied'; } catch { return 'cancelled'; }
}
