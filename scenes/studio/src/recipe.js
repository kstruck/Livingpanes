// Scene recipes: turn anything (a model's tool call, a file from disk, a postMessage)
// into a complete, safe recipe the engine can draw. Pure: no DOM, importable from Node.
// The field names and ranges follow ../recipe.schema.json exactly.

export const MEDIA = Object.freeze(['water', 'air']);
export const MODES = Object.freeze(['recipe', 'code']);
export const BACKDROPS = Object.freeze(['image', 'gradient']);
export const PARTICLES = Object.freeze(['bubbles', 'dust', 'snow', 'rain', 'fireflies', 'embers', 'petals', 'stars', 'plankton']);
export const CREATURES = Object.freeze(['fish', 'angelfish', 'jellyfish', 'firefly', 'bird', 'butterfly', 'koi']);
export const FOODS = Object.freeze(['flakes', 'pellets', 'seeds', 'nectar', 'none']);
export const MOODS = Object.freeze(['day', 'dusk', 'night', 'dawn']);
export const EFFECTS = Object.freeze(['ripples', 'caustics', 'rays', 'fog', 'vignette', 'sway']);

const HEX = /^#[0-9a-fA-F]{6}$/;
// Asset names stay inside the scene folder: a plain file name, no slashes, no "..".
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/;

const PARTICLE_COLOR = Object.freeze({
  bubbles: '#d8f4ff', dust: '#fff1d6', snow: '#ffffff', rain: '#bcd3e6', fireflies: '#e8ff7a',
  embers: '#ff8a3d', petals: '#ffc3d6', stars: '#fffbe8', plankton: '#7ff5e0',
});

export const CREATURE_DEFAULTS = Object.freeze({
  fish: { count: 14, colors: ['#f2a03d', '#2f6f9f'], schooling: 0.65, zone: [0.2, 0.85] },
  angelfish: { count: 6, colors: ['#f4f0e0', '#2b2b38', '#e8c45a'], schooling: 0.3, zone: [0.2, 0.75] },
  koi: { count: 7, colors: ['#fbf6ee', '#e4572e', '#1c1c1c'], schooling: 0.2, zone: [0.08, 0.92] },
  jellyfish: { count: 8, colors: ['#c9a8ff', '#7fe7ff'], schooling: 0.05, zone: [0.1, 0.8] },
  firefly: { count: 24, colors: ['#e8ff7a'], schooling: 0.05, zone: [0.3, 0.9] },
  bird: { count: 9, colors: ['#2a2a33'], schooling: 0.7, zone: [0.05, 0.4] },
  butterfly: { count: 10, colors: ['#ff9f43', '#2d1b10'], schooling: 0.1, zone: [0.35, 0.9] },
});

const GRADIENT = Object.freeze({
  water: ['#0e4a6b', '#082c46', '#03121f'],
  air: ['#7fb8ec', '#cfe6fb', '#f5ead2'],
});

const EFFECT_DEFAULTS = Object.freeze({
  water: { ripples: 0.6, caustics: 0.35, rays: 0.3, fog: 0.15, vignette: 0.35, sway: 0.2 },
  air: { ripples: 0, caustics: 0, rays: 0.25, fog: 0.1, vignette: 0.3, sway: 0.04 },
});

export const LIMITS = Object.freeze({ particles: 4, creatures: 5, colors: 4, gradient: 5, count: 60, name: 60, description: 280, file: 80 });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const read = (object, key) => { try { return isObject(object) ? object[key] : undefined; } catch { return undefined; } };
const clamp = (value, min, max, fallback) => {
  const n = typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const pick = (value, list, fallback) => (typeof value === 'string' && list.includes(value) ? value : fallback);
const color = (value, fallback) => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const file = (value) => (typeof value === 'string' && FILE.test(value) && !value.includes('..') ? value : '');
// Control characters out, length capped, whitespace tidied.
const text = (value, max, fallback) => {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : fallback;
};
// Never walk more of an array than we keep: a million-entry array costs nothing.
const list = (value, max) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  try { for (let i = 0; i < value.length && i < max * 4 && out.length < max * 4; i++) out.push(value[i]); } catch {}
  return out;
};
const colors = (value, max, fallback) => {
  const out = list(value, max).map((c) => color(c, null)).filter(Boolean).slice(0, max);
  return out.length ? out : fallback.slice();
};
const band = (value, fallback) => {
  const v = list(value, 2);
  if (v.length !== 2) return fallback.slice();
  let a = clamp(v[0], 0, 1, NaN), b = clamp(v[1], 0, 1, NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return fallback.slice();
  if (a > b) [a, b] = [b, a];
  // A zero-height band would trap a creature on a line; keep at least 5% of the screen.
  if (b - a < 0.05) { const mid = Math.min(0.975, Math.max(0.025, (a + b) / 2)); a = mid - 0.025; b = mid + 0.025; }
  return [round(a), round(b)];
};
const round = (n) => Math.round(n * 1e6) / 1e6;

function particle(input) {
  const kind = pick(read(input, 'kind'), PARTICLES, null);
  if (!kind) return null;
  return {
    kind,
    amount: clamp(read(input, 'amount'), 0, 1, 0.5),
    color: color(read(input, 'color'), PARTICLE_COLOR[kind]),
    speed: clamp(read(input, 'speed'), 0, 2, 1),
    night: bool(read(input, 'night'), false),
  };
}

function creature(input) {
  const kind = pick(read(input, 'kind'), CREATURES, null);
  if (!kind) return null;
  const d = CREATURE_DEFAULTS[kind];
  const count = clamp(read(input, 'count'), 0, LIMITS.count, d.count);
  return {
    kind,
    count: Math.round(count),
    colors: colors(read(input, 'colors'), LIMITS.colors, d.colors),
    size: clamp(read(input, 'size'), 0.2, 3, 1),
    speed: clamp(read(input, 'speed'), 0.1, 3, 1),
    schooling: clamp(read(input, 'schooling'), 0, 1, d.schooling),
    zone: band(read(input, 'zone'), d.zone),
    glow: bool(read(input, 'glow'), false),
  };
}

function build(input) {
  const source = isObject(input) ? input : {};
  const medium = pick(read(source, 'medium'), MEDIA, 'water');
  const b = read(source, 'backdrop'), e = read(source, 'effects'), l = read(source, 'light');
  const image = file(read(b, 'image'));
  const kind = pick(read(b, 'kind'), BACKDROPS, image ? 'image' : 'gradient');
  const focus = list(read(b, 'focus'), 2);
  const effects = {};
  for (const key of EFFECTS) effects[key] = clamp(read(e, key), 0, 1, EFFECT_DEFAULTS[medium][key]);
  effects.tint = color(read(e, 'tint'), '#ffffff');
  return {
    version: 1,
    name: text(read(source, 'name'), LIMITS.name, 'Untitled scene'),
    description: text(read(source, 'description'), LIMITS.description, ''),
    mode: pick(read(source, 'mode'), MODES, 'recipe'),
    medium,
    backdrop: {
      // An image backdrop with no usable image falls back to the gradient.
      kind: kind === 'image' && !image ? 'gradient' : kind,
      image,
      depth: file(read(b, 'depth')),
      colors: (() => { const c = colors(read(b, 'colors'), LIMITS.gradient, GRADIENT[medium]); return c.length >= 2 ? c : GRADIENT[medium].slice(); })(),
      focus: focus.length === 2 ? [clamp(focus[0], 0, 1, 0.5), clamp(focus[1], 0, 1, 0.5)] : [0.5, 0.5],
      parallax: clamp(read(b, 'parallax'), 0, 1, 0.3),
    },
    effects,
    particles: list(read(source, 'particles'), LIMITS.particles).map(particle).filter(Boolean).slice(0, LIMITS.particles),
    creatures: list(read(source, 'creatures'), LIMITS.creatures).map(creature).filter(Boolean).slice(0, LIMITS.creatures),
    food: pick(read(source, 'food'), FOODS, medium === 'air' ? 'seeds' : 'flakes'),
    light: {
      followClock: bool(read(l, 'followClock'), true),
      mood: pick(read(l, 'mood'), MOODS, 'day'),
    },
  };
}

// Always returns a complete recipe; never throws, whatever it is handed.
export function normalize(input) {
  try { return build(input); } catch { return build({}); }
}

// Human-readable problems with a recipe as given; [] when it matches the schema.
export function validate(input) {
  const problems = [];
  try { check(input, problems); } catch { problems.push('The recipe could not be read.'); }
  return problems.slice(0, 100);
}

function check(input, problems) {
  const say = (message) => problems.push(message);
  if (!isObject(input)) { say('The recipe must be an object.'); return; }
  const known = (object, keys, where) => {
    for (const key of Object.keys(object)) if (!keys.includes(key)) say(`${where}: unknown field "${key}".`);
  };
  const number = (value, min, max, where) => {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) say(`${where} must be a number.`);
    else if (value < min || value > max) say(`${where} must be between ${min} and ${max} (got ${value}).`);
  };
  const oneOf = (value, options, where) => {
    if (value !== undefined && !options.includes(value)) say(`${where} must be one of ${options.join(', ')} (got ${JSON.stringify(value)?.slice(0, 40)}).`);
  };
  const hex = (value, where) => {
    if (value !== undefined && !(typeof value === 'string' && HEX.test(value))) say(`${where} must be a color like #1a2b3c.`);
  };
  const flag = (value, where) => { if (value !== undefined && typeof value !== 'boolean') say(`${where} must be true or false.`); };
  const string = (value, max, where) => {
    if (value === undefined) return;
    if (typeof value !== 'string') say(`${where} must be text.`);
    else if (value.length > max) say(`${where} is longer than ${max} characters.`);
  };
  const assetName = (value, where) => {
    string(value, LIMITS.file, where);
    if (typeof value === 'string' && value !== '' && (!FILE.test(value) || value.includes('..'))) say(`${where} must be a plain file name in the scene folder.`);
  };
  const array = (value, min, max, where) => {
    if (value === undefined) return false;
    if (!Array.isArray(value)) { say(`${where} must be a list.`); return false; }
    if (value.length < min) say(`${where} needs at least ${min} entries.`);
    if (value.length > max) say(`${where} has ${value.length} entries; at most ${max} are allowed.`);
    return true;
  };

  known(input, ['version', 'name', 'description', 'mode', 'medium', 'backdrop', 'effects', 'particles', 'creatures', 'food', 'light'], 'recipe');
  if (input.version !== undefined && input.version !== 1) say('version must be 1.');
  string(input.name, LIMITS.name, 'name');
  string(input.description, LIMITS.description, 'description');
  oneOf(input.mode, MODES, 'mode');
  oneOf(input.medium, MEDIA, 'medium');
  oneOf(input.food, FOODS, 'food');

  const b = input.backdrop;
  if (b !== undefined) {
    if (!isObject(b)) say('backdrop must be an object.');
    else {
      known(b, ['kind', 'image', 'depth', 'colors', 'focus', 'parallax'], 'backdrop');
      oneOf(b.kind, BACKDROPS, 'backdrop.kind');
      assetName(b.image, 'backdrop.image');
      assetName(b.depth, 'backdrop.depth');
      if (b.kind === 'image' && !(typeof b.image === 'string' && b.image)) say('backdrop.kind is "image" but backdrop.image is missing.');
      if (array(b.colors, 2, LIMITS.gradient, 'backdrop.colors')) b.colors.slice(0, 10).forEach((c, i) => hex(c, `backdrop.colors[${i}]`));
      if (array(b.focus, 2, 2, 'backdrop.focus')) b.focus.slice(0, 2).forEach((v, i) => number(v, 0, 1, `backdrop.focus[${i}]`));
      number(b.parallax, 0, 1, 'backdrop.parallax');
    }
  }

  const e = input.effects;
  if (e !== undefined) {
    if (!isObject(e)) say('effects must be an object.');
    else {
      known(e, [...EFFECTS, 'tint'], 'effects');
      for (const key of EFFECTS) number(e[key], 0, 1, `effects.${key}`);
      hex(e.tint, 'effects.tint');
    }
  }

  if (array(input.particles, 0, LIMITS.particles, 'particles')) {
    input.particles.slice(0, 10).forEach((p, i) => {
      const where = `particles[${i}]`;
      if (!isObject(p)) { say(`${where} must be an object.`); return; }
      known(p, ['kind', 'amount', 'color', 'speed', 'night'], where);
      if (p.kind === undefined) say(`${where}.kind is required.`);
      oneOf(p.kind, PARTICLES, `${where}.kind`);
      number(p.amount, 0, 1, `${where}.amount`);
      hex(p.color, `${where}.color`);
      number(p.speed, 0, 2, `${where}.speed`);
      flag(p.night, `${where}.night`);
    });
  }

  if (array(input.creatures, 0, LIMITS.creatures, 'creatures')) {
    input.creatures.slice(0, 10).forEach((c, i) => {
      const where = `creatures[${i}]`;
      if (!isObject(c)) { say(`${where} must be an object.`); return; }
      known(c, ['kind', 'count', 'colors', 'size', 'speed', 'schooling', 'zone', 'glow'], where);
      if (c.kind === undefined) say(`${where}.kind is required.`);
      oneOf(c.kind, CREATURES, `${where}.kind`);
      number(c.count, 0, LIMITS.count, `${where}.count`);
      if (typeof c.count === 'number' && !Number.isInteger(c.count)) say(`${where}.count must be a whole number.`);
      if (array(c.colors, 1, LIMITS.colors, `${where}.colors`)) c.colors.slice(0, 10).forEach((v, j) => hex(v, `${where}.colors[${j}]`));
      number(c.size, 0.2, 3, `${where}.size`);
      number(c.speed, 0.1, 3, `${where}.speed`);
      number(c.schooling, 0, 1, `${where}.schooling`);
      if (array(c.zone, 2, 2, `${where}.zone`)) c.zone.slice(0, 2).forEach((v, j) => number(v, 0, 1, `${where}.zone[${j}]`));
      flag(c.glow, `${where}.glow`);
    });
  }

  const l = input.light;
  if (l !== undefined) {
    if (!isObject(l)) say('light must be an object.');
    else {
      known(l, ['followClock', 'mood'], 'light');
      flag(l.followClock, 'light.followClock');
      oneOf(l.mood, MOODS, 'light.mood');
    }
  }
}
