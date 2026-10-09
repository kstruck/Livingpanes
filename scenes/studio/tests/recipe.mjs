import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { normalize, validate, CREATURES, PARTICLES, LIMITS } from '../src/recipe.js';

const here = new URL('.', import.meta.url);
const examplesDir = new URL('../examples/', here);
const schema = JSON.parse(readFileSync(new URL('../recipe.schema.json', here), 'utf8'));

// Garbage in, a complete recipe out, never an exception; and what comes out is itself valid.
const garbage = [
  undefined, null, 0, -1, NaN, Infinity, true, 'a string', '', [], [1, 2, 3], () => 1, Symbol('x'),
  { medium: 42, backdrop: 'no', effects: [], particles: 'lots', creatures: { kind: 'fish' }, food: {}, light: null },
  { creatures: new Array(1_000_000).fill({ kind: 'fish', count: 1e9 }) },
  { particles: Array.from({ length: 50 }, () => ({ kind: 'snow', amount: 99 })) },
  { backdrop: { kind: 'image' } },
  { backdrop: { image: '../../secrets.png', depth: 'a/b.png' } },
  { backdrop: { colors: ['#zzzzzz', 7, null] } },
  { name: '\u0000\u0007'.repeat(100), description: 'x'.repeat(10_000) },
  Object.create(null),
  new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } }),
];
for (const input of garbage) {
  let out;
  assert.doesNotThrow(() => { out = normalize(input); }, `normalize must not throw on ${String(typeof input)}`);
  assert.equal(out.version, 1);
  assert.deepEqual(validate(out), [], `normalized garbage validates clean: ${JSON.stringify(validate(out))}`);
  assert.doesNotThrow(() => validate(input));
  assert.ok(Array.isArray(validate(input)));
}

// Defaults for everything.
{
  const r = normalize({});
  assert.equal(r.mode, 'recipe');
  assert.equal(r.medium, 'water');
  assert.equal(r.backdrop.kind, 'gradient');
  assert.ok(r.backdrop.colors.length >= 2);
  assert.deepEqual(r.backdrop.focus, [0.5, 0.5]);
  assert.equal(r.food, 'flakes');
  assert.equal(r.light.followClock, true);
  assert.equal(r.light.mood, 'day');
  assert.equal(normalize({ medium: 'air' }).food, 'seeds');
  for (const key of ['ripples', 'caustics', 'rays', 'fog', 'vignette', 'sway']) assert.ok(r.effects[key] >= 0 && r.effects[key] <= 1);
  assert.equal(r.effects.tint, '#ffffff');
}

// Clamping to the schema's ranges.
{
  const r = normalize({
    backdrop: { parallax: 9, focus: [-3, 4] },
    effects: { ripples: -1, caustics: 2, rays: 0.5, fog: NaN, vignette: '0.5' },
    particles: [{ kind: 'snow', amount: 5, speed: -2 }],
    creatures: [{ kind: 'fish', count: 999.7, size: 0, speed: 100, schooling: 3, zone: [0.9, 0.1] }, { kind: 'koi', count: 2.4 }],
  });
  assert.equal(r.backdrop.parallax, 1);
  assert.deepEqual(r.backdrop.focus, [0, 1]);
  assert.equal(r.effects.ripples, 0);
  assert.equal(r.effects.caustics, 1);
  assert.equal(r.effects.rays, 0.5);
  assert.equal(r.effects.fog, 0.15, 'NaN falls back to the default');
  assert.equal(r.effects.vignette, 0.35, 'a numeric string is not a number');
  assert.equal(r.particles[0].amount, 1);
  assert.equal(r.particles[0].speed, 0);
  const fish = r.creatures[0];
  assert.equal(fish.count, LIMITS.count);
  assert.equal(fish.size, 0.2);
  assert.equal(fish.speed, 3);
  assert.equal(fish.schooling, 1);
  assert.deepEqual(fish.zone, [0.1, 0.9], 'a reversed band is put the right way up');
  assert.equal(r.creatures[1].count, 2);
  assert.ok(Number.isInteger(fish.count));
  const thin = normalize({ creatures: [{ kind: 'fish', zone: [0.5, 0.5] }] }).creatures[0].zone;
  assert.ok(thin[1] - thin[0] >= 0.049, 'a zero-height band is widened');
}

// Enums are whitelisted; unknown kinds are dropped, not guessed.
{
  const r = normalize({
    mode: 'eval', medium: 'lava', food: 'cake', light: { mood: 'noon', followClock: 'yes' },
    backdrop: { kind: 'video', colors: ['#ABCDEF', '#123456', 'red', '#12345'] },
    particles: [{ kind: 'confetti' }, { kind: 'stars' }, { color: '#ffffff' }],
    creatures: [{ kind: 'shark' }, { kind: 'bird', colors: ['#ff0000', 'blue'] }, 'fish'],
  });
  assert.equal(r.mode, 'recipe');
  assert.equal(r.medium, 'water');
  assert.equal(r.food, 'flakes');
  assert.equal(r.light.mood, 'day');
  assert.equal(r.light.followClock, true);
  assert.equal(r.backdrop.kind, 'gradient');
  assert.deepEqual(r.backdrop.colors, ['#abcdef', '#123456']);
  assert.deepEqual(r.particles.map((p) => p.kind), ['stars']);
  assert.deepEqual(r.creatures.map((c) => c.kind), ['bird']);
  assert.deepEqual(r.creatures[0].colors, ['#ff0000']);
  const problems = validate({ mode: 'eval', medium: 'lava', creatures: [{ kind: 'shark' }], extra: 1 });
  assert.ok(problems.some((p) => p.includes('mode')));
  assert.ok(problems.some((p) => p.includes('medium')));
  assert.ok(problems.some((p) => p.includes('creatures[0].kind')));
  assert.ok(problems.some((p) => p.includes('unknown field "extra"')));
}

// Caps on array lengths, text lengths and asset names.
{
  const r = normalize({
    name: 'n'.repeat(500), description: 'd'.repeat(5000),
    particles: Array.from({ length: 20 }, () => ({ kind: 'dust' })),
    creatures: Array.from({ length: 20 }, () => ({ kind: 'fish', colors: Array(20).fill('#ffffff') })),
    backdrop: { colors: Array(30).fill('#000000'), image: '../escape.png', depth: 'ok-depth.png' },
  });
  assert.equal(r.name.length, LIMITS.name);
  assert.equal(r.description.length, LIMITS.description);
  assert.equal(r.particles.length, LIMITS.particles);
  assert.equal(r.creatures.length, LIMITS.creatures);
  assert.equal(r.creatures[0].colors.length, LIMITS.colors);
  assert.equal(r.backdrop.colors.length, LIMITS.gradient);
  assert.equal(r.backdrop.image, '', 'a path that leaves the folder is refused');
  assert.equal(r.backdrop.depth, 'ok-depth.png');
  assert.equal(r.backdrop.kind, 'gradient');
  assert.ok(validate({ backdrop: { image: '../escape.png' } }).some((p) => p.includes('plain file name')));
  assert.ok(validate({ particles: Array(5).fill({ kind: 'dust' }) }).some((p) => p.includes('at most 4')));
  assert.equal(normalize({ backdrop: { kind: 'image', image: 'photo.jpg' } }).backdrop.kind, 'image');
}

// The engine and the schema agree on the vocabulary.
assert.deepEqual([...CREATURES].sort(), [...schema.properties.creatures.items.properties.kind.enum].sort());
assert.deepEqual([...PARTICLES].sort(), [...schema.properties.particles.items.properties.kind.enum].sort());

// Every shipped example is valid as written, and normalizing is idempotent.
const index = JSON.parse(readFileSync(new URL('index.json', examplesDir), 'utf8'));
const folders = readdirSync(examplesDir).filter((name) => statSync(new URL(name, examplesDir)).isDirectory());
assert.ok(folders.length >= 5, 'At least five examples ship');
assert.deepEqual(index.map((e) => e.name).sort(), folders.sort(), 'index.json lists every example folder');
for (const entry of index) {
  assert.ok(typeof entry.title === 'string' && entry.title.length > 0);
  const recipe = JSON.parse(readFileSync(new URL(`${entry.name}/recipe.json`, examplesDir), 'utf8'));
  assert.deepEqual(validate(recipe), [], `${entry.name} validates`);
  const once = normalize(recipe);
  assert.deepEqual(normalize(once), once, `${entry.name} normalizes idempotently`);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(once))), once, `${entry.name} survives a JSON round trip`);
  assert.equal(once.backdrop.kind, 'gradient', `${entry.name} needs no image files`);
  assert.ok(once.creatures.length > 0 && once.particles.length > 0, `${entry.name} has life in it`);
}

console.log(`studio recipe: ${garbage.length} garbage inputs, ${index.length} examples ok`);
