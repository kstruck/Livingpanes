// Pure helpers for the Studio: recipe <-> form mapping, defaults, limits and swatches.
// No DOM access, so it can be imported and tested in Node.

export const ENUMS = Object.freeze({
  mode: ['recipe', 'code'],
  medium: ['water', 'air'],
  backdropKind: ['image', 'gradient'],
  particleKind: ['bubbles', 'dust', 'snow', 'rain', 'fireflies', 'embers', 'petals', 'stars', 'plankton'],
  creatureKind: ['fish', 'angelfish', 'jellyfish', 'firefly', 'bird', 'butterfly', 'koi'],
  food: ['flakes', 'pellets', 'seeds', 'nectar', 'none'],
  mood: ['day', 'dusk', 'night', 'dawn'],
});

export const LIMITS = Object.freeze({
  particles: 4,
  creatures: 5,
  gradientColors: [2, 5],
  creatureColors: [1, 4],
  name: 60,
  description: 280,
  creatureCount: 60,
});

// Every slider in the editor. `path` is relative to the recipe (effects) or to one list item.
export const EFFECT_FIELDS = Object.freeze([
  { key: 'ripples', label: 'Ripples', hint: 'From the cursor and taps', min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: 'caustics', label: 'Caustics', hint: 'Dancing underwater light', min: 0, max: 1, step: 0.01, def: 0.3 },
  { key: 'rays', label: 'Light rays', hint: 'Shafts of light from above', min: 0, max: 1, step: 0.01, def: 0.2 },
  { key: 'fog', label: 'Fog', min: 0, max: 1, step: 0.01, def: 0.1 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, def: 0.4 },
  { key: 'sway', label: 'Sway', hint: 'Wavy motion, like water or heat', min: 0, max: 1, step: 0.01, def: 0.1 },
]);

export const PARTICLE_FIELDS = Object.freeze([
  { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: 'speed', label: 'Speed', min: 0, max: 2, step: 0.01, def: 1 },
]);

export const CREATURE_FIELDS = Object.freeze([
  { key: 'count', label: 'Count', min: 0, max: 60, step: 1, def: 12, integer: true },
  { key: 'size', label: 'Size', min: 0.2, max: 3, step: 0.05, def: 1 },
  { key: 'speed', label: 'Speed', min: 0.1, max: 3, step: 0.05, def: 1 },
  { key: 'schooling', label: 'Schooling', hint: '0 alone, 1 tight school', min: 0, max: 1, step: 0.01, def: 0.5 },
]);

export const BACKDROP_FIELDS = Object.freeze([
  { key: 'parallax', label: 'Parallax', hint: 'How far it shifts with the cursor', min: 0, max: 1, step: 0.01, def: 0.3 },
]);

// Shown when a recipe leaves light out; matches the engine's defaults.
export const LIGHT_DEFAULTS = Object.freeze({ followClock: true, mood: 'day' });

const PARTICLE_COLORS = {
  bubbles: '#d9f3ff', dust: '#e8dcc0', snow: '#ffffff', rain: '#a9c4d8', fireflies: '#e8ff7a',
  embers: '#ff8a3d', petals: '#ffc1d6', stars: '#fff6d8', plankton: '#8ff2e0',
};
const CREATURE_COLORS = {
  fish: '#ff8a3d', angelfish: '#f2e6c9', jellyfish: '#c9a7ff', firefly: '#e8ff7a',
  bird: '#2b2b33', butterfly: '#5aa9ff', koi: '#ff6a3d',
};

export const EXAMPLE_PROMPTS = Object.freeze([
  'a moonlit jellyfish lagoon',
  'koi under cherry blossoms at dusk',
  'fireflies in a misty pine forest',
  'embers drifting over a desert campfire',
  'a sunlit kelp forest with a school of silver fish',
  'snow falling on a quiet mountain lake at night',
]);

export const HEX = /^#[0-9a-fA-F]{6}$/;

export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  return HEX.test(s) ? s.toLowerCase() : null;
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function splitPath(path) {
  return String(path).split('.').filter((p) => p !== '').map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

export function getPath(obj, path) {
  let cur = obj;
  for (const key of splitPath(path)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

// Returns a new object with `value` at `path`; containers along the path are copied, the
// input is never mutated. `undefined` removes the key (or array slot).
export function setPath(obj, path, value) {
  const keys = splitPath(path);
  if (!keys.length) return value;
  const [head, ...rest] = keys;
  const base = Array.isArray(obj) ? obj.slice() : { ...(obj && typeof obj === 'object' ? obj : {}) };
  if (!rest.length) {
    if (value === undefined) {
      if (Array.isArray(base)) base.splice(head, 1);
      else delete base[head];
    } else base[head] = value;
    return base;
  }
  const child = base[head];
  const empty = typeof rest[0] === 'number' ? [] : {};
  base[head] = setPath(child && typeof child === 'object' ? child : empty, rest.join('.'), value);
  return base;
}

// Converts a raw form value to the recipe value for a control type.
export function parseControlValue(type, raw, field = {}) {
  if (type === 'checkbox') return Boolean(raw);
  if (type === 'range' || type === 'number') {
    const min = field.min ?? -Infinity;
    const max = field.max ?? Infinity;
    let n = clamp(raw, min, max);
    if (field.integer) n = Math.round(n);
    else n = Math.round(n * 1000) / 1000;
    return n;
  }
  if (type === 'color') return normalizeHex(raw) ?? undefined;
  if (type === 'select') return raw;
  if (type === 'text') return String(raw ?? '');
  return raw;
}

export function formatValue(field, value) {
  const v = value ?? field.def;
  if (field.integer) return String(Math.round(v));
  if (field.max === 1 && field.min === 0) return `${Math.round(v * 100)}%`;
  return `${Number(v).toFixed(2)}×`;
}

export function defaultRecipe() {
  return {
    version: 1,
    name: '',
    description: '',
    mode: 'recipe',
    medium: 'water',
    backdrop: { kind: 'gradient', colors: ['#0f3b4a', '#061820'], parallax: 0.3, focus: [0.5, 0.5] },
    effects: { ripples: 0.5, caustics: 0.3, rays: 0.2, fog: 0.1, vignette: 0.4, sway: 0.1 },
    particles: [newParticle('bubbles')],
    creatures: [newCreature('fish')],
    food: 'flakes',
    light: { followClock: true, mood: 'night' },
  };
}

export function newParticle(kind = 'bubbles') {
  return { kind, amount: 0.5, color: PARTICLE_COLORS[kind] ?? '#ffffff', speed: 1, night: kind === 'fireflies' };
}

export function newCreature(kind = 'fish') {
  return {
    kind, count: kind === 'jellyfish' ? 6 : 12, colors: [CREATURE_COLORS[kind] ?? '#ff8a3d'],
    size: 1, speed: 1, schooling: kind === 'fish' ? 0.6 : 0.2, zone: [0.2, 0.85], glow: kind === 'jellyfish' || kind === 'firefly',
  };
}

export function canAdd(recipe, list) {
  const items = Array.isArray(recipe?.[list]) ? recipe[list] : [];
  return items.length < LIMITS[list];
}

export function addItem(recipe, list) {
  const items = Array.isArray(recipe?.[list]) ? recipe[list] : [];
  if (items.length >= LIMITS[list]) return recipe;
  const used = new Set(items.map((i) => i.kind));
  const kinds = list === 'particles' ? ENUMS.particleKind : ENUMS.creatureKind;
  const kind = kinds.find((k) => !used.has(k)) ?? kinds[0];
  const item = list === 'particles' ? newParticle(kind) : newCreature(kind);
  return { ...recipe, [list]: [...items, item] };
}

export function removeItem(recipe, list, index) {
  const items = Array.isArray(recipe?.[list]) ? recipe[list] : [];
  return { ...recipe, [list]: items.filter((_, i) => i !== index) };
}

// Adds or removes a color in an array at `path`, keeping it inside [min, max].
export function addColor(recipe, path, [, max], color = '#ffffff') {
  const colors = Array.isArray(getPath(recipe, path)) ? getPath(recipe, path) : [];
  if (colors.length >= max) return recipe;
  return setPath(recipe, path, [...colors, normalizeHex(color) ?? '#ffffff']);
}

export function removeColor(recipe, path, [min], index) {
  const colors = Array.isArray(getPath(recipe, path)) ? getPath(recipe, path) : [];
  if (colors.length <= min) return recipe;
  return setPath(recipe, path, colors.filter((_, i) => i !== index));
}

// Switching a creature or particle kind resets only its color to suit the new kind
// when the user had not changed it from the old kind's default.
export function changeKind(recipe, list, index, kind) {
  const item = recipe?.[list]?.[index];
  if (!item) return recipe;
  const next = { ...item, kind };
  if (list === 'particles' && (!item.color || item.color === PARTICLE_COLORS[item.kind])) next.color = PARTICLE_COLORS[kind];
  if (list === 'creatures' && (!item.colors?.length || (item.colors.length === 1 && item.colors[0] === CREATURE_COLORS[item.kind]))) {
    next.colors = [CREATURE_COLORS[kind]];
  }
  return setPath(recipe, `${list}.${index}`, next);
}

// True when the scene wants to run scene.js: a generated or saved code recipe, or an
// imported scene whose code the host disarmed (`importedCode: true`, mode forced to recipe).
export function wantsCode(recipe) {
  return recipe?.mode === 'code' || recipe?.importedCode === true;
}

// The recipe actually sent to the preview and saved. Code mode only appears when the
// scene wants code, a code file exists, and the user ticked "I've read this code".
export function effectiveRecipe(recipe, { hasCode = false, codeApproved = false } = {}) {
  const out = clone(recipe) ?? {};
  out.version = 1;
  out.mode = wantsCode(out) && hasCode && codeApproved ? 'code' : 'recipe';
  if (Array.isArray(out.particles)) out.particles = out.particles.slice(0, LIMITS.particles);
  if (Array.isArray(out.creatures)) {
    out.creatures = out.creatures.slice(0, LIMITS.creatures).map((c) => {
      if (Array.isArray(c.zone) && c.zone.length === 2 && c.zone[0] > c.zone[1]) return { ...c, zone: [c.zone[1], c.zone[0]] };
      return c;
    });
  }
  if (typeof out.name === 'string') out.name = out.name.slice(0, LIMITS.name);
  if (typeof out.description === 'string') out.description = out.description.slice(0, LIMITS.description);
  return out;
}

// After a generate: take Claude's recipe but keep the draft's own image and depth map if
// the result did not name them (Claude cannot know the file names).
export function mergeGenerated(current, generated) {
  const next = clone(generated) ?? {};
  const cur = current?.backdrop ?? {};
  if (cur.image) {
    const b = { ...(next.backdrop ?? {}) };
    if (!b.image) b.image = cur.image;
    if (!b.depth && cur.depth) b.depth = cur.depth;
    if (!b.kind) b.kind = 'image';
    next.backdrop = b;
  }
  if (!next.name && current?.name) next.name = current.name;
  next.version = 1;
  return next;
}

export function fileNameFromUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  const path = url.split(/[?#]/)[0];
  const name = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
  return name || null;
}

export function joinUrl(base, file) {
  if (!base) return file;
  return base.endsWith('/') ? base + file : `${base}/${file}`;
}

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Safe for use inside CSS url("..."): same-origin path, no quotes, parens or escapes.
export function safeCssUrl(url) {
  if (typeof url !== 'string') return null;
  const sameOrigin = (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('https://deskworlds.local/');
  if (!sameOrigin) return null;
  if (/["'()\\\s<>]/.test(url)) return null;
  return url;
}

// CSS `background` value for a library card: the scene's image, its gradient colors, or
// a calm gradient derived from its id so each card is distinct.
// listScenes items carry `image` (a URL or null) and `colors` (array or null); a recipe,
// when one is known, is used as a fallback source for both.
export function swatchBackground(entry = {}, recipe = null) {
  const r = recipe ?? entry.recipe ?? null;
  const h = hash(entry.id ?? entry.name ?? '');
  const hue = h % 360;
  const hue2 = (hue + 30 + (h >> 9) % 60) % 360;
  const fallback = `linear-gradient(160deg, hsl(${hue} 38% 26%), hsl(${hue2} 45% 9%))`;
  const rawColors = Array.isArray(entry.colors) ? entry.colors : r?.backdrop?.colors ?? [];
  const colors = rawColors.map(normalizeHex).filter(Boolean);
  const gradient = colors.length >= 2 ? `linear-gradient(180deg, ${colors.join(', ')})` : fallback;
  let image = typeof entry.image === 'string' ? safeCssUrl(entry.image) : null;
  if (!image && r?.backdrop?.image && entry.base && (r.backdrop.kind ?? 'image') === 'image') {
    image = safeCssUrl(joinUrl(entry.base, r.backdrop.image));
  }
  if (image) return `url("${image}") center / cover no-repeat, ${gradient}`;
  return gradient;
}

export function errorText(error) {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message) return error.message;
  if (typeof error.error === 'string') return error.error;
  return 'Something went wrong.';
}

export function debounce(fn, ms) {
  let timer = null;
  let lastArgs = [];
  const debounced = (...args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, ms);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  debounced.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    fn(...lastArgs);
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

export function modelOptions(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => (typeof m === 'string' ? { id: m, label: m } : m && typeof m.id === 'string' ? { id: m.id, label: m.name || m.label || m.id } : null))
    .filter(Boolean);
}

export function sortScenes(scenes) {
  const list = Array.isArray(scenes) ? scenes.filter((s) => s && typeof s.id === 'string') : [];
  return {
    saved: list.filter((s) => !s.example),
    examples: list.filter((s) => s.example),
  };
}
