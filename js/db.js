// Local-first storage: everything lives in IndexedDB on the device, mirrored in memory
// so screens can read synchronously. Writes go through `save*` / `remove*`.

import { sanitizeRecipe, safeId, num } from './util.js';

const DB_NAME = 'bishulon';
const DB_VER = 1;
const STORES = ['recipes', 'albums', 'shop', 'plan', 'kv'];

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const state = { recipes: [], albums: [], shop: [], plan: [], kv: {} };

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

export async function load() {
  for (const s of ['recipes', 'albums', 'shop', 'plan']) {
    state[s] = (await tx(s, 'readonly', (st) => st.getAll())) || [];
  }
  const kv = (await tx('kv', 'readonly', (st) => st.getAll())) || [];
  state.kv = Object.fromEntries(kv.map((r) => [r.id, r.value]));
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
}

function upsertMem(store, obj) {
  const arr = state[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
}

export async function put(store, obj) {
  if (store === 'recipes') obj = sanitizeRecipe(obj);
  await tx(store, 'readwrite', (s) => s.put(obj)); // memory only changes once the write succeeded
  upsertMem(store, obj);
  emit(store);
  return obj;
}

export async function putMany(store, objs) {
  if (store === 'recipes') objs = objs.map(sanitizeRecipe);
  await tx(store, 'readwrite', (s) => { objs.forEach((o) => s.put(o)); });
  objs.forEach((o) => upsertMem(store, o));
  emit(store);
}

export async function remove(store, id) {
  await tx(store, 'readwrite', (s) => s.delete(id));
  state[store] = state[store].filter((x) => x.id !== id);
  emit(store);
}

export async function removeMany(store, ids) {
  const set = new Set(ids);
  await tx(store, 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); });
  state[store] = state[store].filter((x) => !set.has(x.id));
  emit(store);
}

export async function clearStore(store) {
  state[store] = store === 'kv' ? {} : [];
  await tx(store, 'readwrite', (s) => s.clear());
  emit(store);
}

export const getKV = (k, d) => (k in state.kv ? state.kv[k] : d);
export async function setKV(k, value) {
  state.kv[k] = value;
  await tx('kv', 'readwrite', (s) => s.put({ id: k, value }));
  emit('kv');
}

export const getRecipe = (id) => state.recipes.find((r) => r.id === id);
export const getAlbum = (id) => state.albums.find((a) => a.id === id);

/** Full backup as a plain object. */
export function exportAll() {
  return { app: 'bishulon', version: 1, exportedAt: new Date().toISOString(), recipes: state.recipes, albums: state.albums, shop: state.shop, plan: state.plan, settings: state.kv.settings || null };
}

export async function importAll(data, { replace = false } = {}) {
  if (!data || data.app !== 'bishulon') throw new Error('bad-file');
  // validate everything BEFORE touching the existing data
  const clean = {
    recipes: (Array.isArray(data.recipes) ? data.recipes : []).filter((r) => r && typeof r === 'object' && r.title).map(sanitizeRecipe),
    albums: (Array.isArray(data.albums) ? data.albums : []).filter((a) => a && safeId(a.id)).map((a) => ({ id: a.id, name: String(a.name || 'אלבום'), createdAt: num(a.createdAt, Date.now()) })),
    shop: (Array.isArray(data.shop) ? data.shop : []).filter((i) => i && safeId(i.id) && i.name).map((i) => ({ ...i, name: String(i.name), qty: num(i.qty), qty2: num(i.qty2), unit: i.unit ? String(i.unit).replace(/[^a-z]/g, '') || null : null, aisle: String(i.aisle || 'other').replace(/[^a-z]/g, '') || 'other', checked: !!i.checked, recipes: (Array.isArray(i.recipes) ? i.recipes : []).filter((r) => r && safeId(r.id)).map((r) => ({ id: r.id, title: String(r.title || '') })) })),
    plan: (Array.isArray(data.plan) ? data.plan : []).filter((p) => p && safeId(p.id) && safeId(p.recipeId) && /^\d{4}-\d{2}-\d{2}$/.test(p.date)).map((p) => ({ id: p.id, date: p.date, recipeId: p.recipeId, meal: ['breakfast', 'lunch', 'dinner', 'other'].includes(p.meal) ? p.meal : 'other', servings: num(p.servings), addedAt: num(p.addedAt, Date.now()) })),
  };
  if (replace) for (const s of ['recipes', 'albums', 'shop', 'plan']) await clearStore(s);
  for (const s of ['recipes', 'albums', 'shop', 'plan']) if (clean[s].length) await putMany(s, clean[s]);
  if (data.settings && typeof data.settings === 'object') {
    const st = data.settings;
    await setKV('settings', { theme: ['light', 'dark', 'system'].includes(st.theme) ? st.theme : 'system', autoRead: !!st.autoRead, voiceAuto: st.voiceAuto !== false, keepAwake: st.keepAwake !== false });
  }
  return clean.recipes.length;
}
