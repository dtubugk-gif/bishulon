// Find a recipe by id among the user's recipes and the built-in starter collection.
import { state, getRecipe, put } from './db.js';
import { SEED_RECIPES } from './data/seed-recipes.js';
import { uid } from './util.js';

export const SEEDS = SEED_RECIPES.map((r) => ({ ...r, seed: true }));
const seedMap = new Map(SEEDS.map((r) => [r.id, r]));

export const findRecipe = (id) => getRecipe(id) || seedMap.get(id) || null;
export const isSeed = (id) => seedMap.has(id) && !getRecipe(id);

/** The user's saved copy of a starter recipe, if any. */
export const savedCopyOf = (seedId) => state.recipes.find((r) => r.seedId === seedId);

export async function saveSeed(seed) {
  const existing = savedCopyOf(seed.id);
  if (existing) return existing;
  const { seed: _s, id: _i, category, difficulty, tips, ...rest } = seed;
  const r = {
    ...rest, id: uid(), seedId: seed.id, tags: [...new Set([category, ...(seed.tags || [])])].filter(Boolean),
    notes: tips || '', difficulty, source: { name: 'בישולון – מתכוני הבית', url: '' },
    favorite: false, rating: 0, albums: [], createdAt: Date.now(), updatedAt: Date.now(), cookCount: 0,
  };
  await put('recipes', r);
  return r;
}
