import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ENUMS, LIMITS, EFFECT_FIELDS, PARTICLE_FIELDS, CREATURE_FIELDS, BACKDROP_FIELDS, EXAMPLE_PROMPTS,
  clamp, normalizeHex, getPath, setPath, parseControlValue, formatValue, defaultRecipe, newParticle, newCreature,
  canAdd, addItem, removeItem, addColor, removeColor, changeKind, effectiveRecipe, wantsCode, mergeGenerated,
  fileNameFromUrl, joinUrl, safeCssUrl, swatchBackground, errorText, debounce, modelOptions, sortScenes,
  LIGHT_DEFAULTS,
} from '../model.js';

const schema = JSON.parse(await readFile(new URL('../../scenes/studio/recipe.schema.json', import.meta.url), 'utf8'));
const P = schema.properties;
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; }
};

await test('enums match the schema', () => {
  assert.deepEqual(ENUMS.mode, P.mode.enum);
  assert.deepEqual(ENUMS.medium, P.medium.enum);
  assert.deepEqual(ENUMS.backdropKind, P.backdrop.properties.kind.enum);
  assert.deepEqual(ENUMS.particleKind, P.particles.items.properties.kind.enum);
  assert.deepEqual(ENUMS.creatureKind, P.creatures.items.properties.kind.enum);
  assert.deepEqual(ENUMS.food, P.food.enum);
  assert.deepEqual(ENUMS.mood, P.light.properties.mood.enum);
});

await test('limits match the schema', () => {
  assert.equal(LIMITS.particles, P.particles.maxItems);
  assert.equal(LIMITS.creatures, P.creatures.maxItems);
  assert.deepEqual(LIMITS.gradientColors, [P.backdrop.properties.colors.minItems, P.backdrop.properties.colors.maxItems]);
  const cc = P.creatures.items.properties.colors;
  assert.deepEqual(LIMITS.creatureColors, [cc.minItems, cc.maxItems]);
  assert.equal(LIMITS.name, P.name.maxLength);
  assert.equal(LIMITS.description, P.description.maxLength);
});

await test('every numeric schema field has a slider with the same range', () => {
  const check = (fields, props, label) => {
    for (const [key, spec] of Object.entries(props)) {
      if (spec.type !== 'number' && spec.type !== 'integer') continue;
      const f = fields.find((x) => x.key === key);
      assert.ok(f, `${label}.${key} has a control`);
      assert.equal(f.min, spec.minimum, `${label}.${key} min`);
      assert.equal(f.max, spec.maximum, `${label}.${key} max`);
      assert.ok(f.def >= f.min && f.def <= f.max, `${label}.${key} default in range`);
      if (spec.type === 'integer') assert.ok(f.integer, `${label}.${key} integer`);
    }
  };
  check(EFFECT_FIELDS, P.effects.properties, 'effects');
  check(PARTICLE_FIELDS, P.particles.items.properties, 'particles');
  check(CREATURE_FIELDS, P.creatures.items.properties, 'creatures');
  check(BACKDROP_FIELDS, P.backdrop.properties, 'backdrop');
});

await test('light display defaults match the engine', () => {
  assert.equal(LIGHT_DEFAULTS.followClock, true);
  assert.ok(ENUMS.mood.includes(LIGHT_DEFAULTS.mood));
  assert.equal(defaultRecipe().light.followClock, true);
});

await test('six example prompts, including the three required', () => {
  assert.equal(EXAMPLE_PROMPTS.length, 6);
  for (const p of ['a moonlit jellyfish lagoon', 'koi under cherry blossoms at dusk', 'fireflies in a misty pine forest']) assert.ok(EXAMPLE_PROMPTS.includes(p));
});

await test('clamp and normalizeHex', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp('abc', 0, 1), 0);
  assert.equal(normalizeHex('#ABCDEF'), '#abcdef');
  assert.equal(normalizeHex('#abc'), '#aabbcc');
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex(null), null);
});

await test('getPath / setPath are immutable and create containers', () => {
  const r = { effects: { fog: 0.1 }, creatures: [{ kind: 'fish', zone: [0, 1] }] };
  const frozen = JSON.stringify(r);
  assert.equal(getPath(r, 'effects.fog'), 0.1);
  assert.equal(getPath(r, 'creatures.0.zone.1'), 1);
  assert.equal(getPath(r, 'nope.deeper'), undefined);
  const a = setPath(r, 'effects.fog', 0.5);
  assert.equal(a.effects.fog, 0.5);
  assert.equal(JSON.stringify(r), frozen, 'input untouched');
  assert.equal(a.creatures, r.creatures, 'untouched branches shared');
  const b = setPath(r, 'creatures.0.zone.0', 0.3);
  assert.deepEqual(b.creatures[0].zone, [0.3, 1]);
  assert.ok(Array.isArray(b.creatures));
  const c = setPath({}, 'backdrop.focus.0', 0.2);
  assert.ok(Array.isArray(c.backdrop.focus));
  const d = setPath(r, 'effects.fog', undefined);
  assert.ok(!('fog' in d.effects));
  const e = setPath({ a: [1, 2, 3] }, 'a.1', undefined);
  assert.deepEqual(e.a, [1, 3]);
});

await test('parseControlValue clamps, rounds and validates', () => {
  assert.equal(parseControlValue('range', '0.33333', { min: 0, max: 1 }), 0.333);
  assert.equal(parseControlValue('range', '9', { min: 0, max: 2 }), 2);
  assert.equal(parseControlValue('range', '12.6', { min: 0, max: 60, integer: true }), 13);
  assert.equal(parseControlValue('checkbox', 1), true);
  assert.equal(parseControlValue('color', '#FFAA00'), '#ffaa00');
  assert.equal(parseControlValue('color', 'nope'), undefined);
  assert.equal(parseControlValue('text', undefined), '');
  assert.equal(parseControlValue('select', 'air'), 'air');
});

await test('formatValue', () => {
  assert.equal(formatValue({ min: 0, max: 1, def: 0.5 }, 0.25), '25%');
  assert.equal(formatValue({ min: 0, max: 1, def: 0.5 }, undefined), '50%');
  assert.equal(formatValue({ min: 0, max: 60, integer: true }, 12), '12');
  assert.equal(formatValue({ min: 0.2, max: 3 }, 1.5), '1.50×');
});

await test('defaultRecipe is valid against the schema shapes', () => {
  const r = defaultRecipe();
  assert.equal(r.version, 1);
  for (const key of Object.keys(r)) assert.ok(key in P, `known key ${key}`);
  for (const key of Object.keys(r.effects)) assert.ok(key in P.effects.properties);
  for (const key of Object.keys(r.backdrop)) assert.ok(key in P.backdrop.properties);
  const p = newParticle('snow');
  for (const key of Object.keys(p)) assert.ok(key in P.particles.items.properties);
  const c = newCreature('koi');
  for (const key of Object.keys(c)) assert.ok(key in P.creatures.items.properties);
  assert.notEqual(defaultRecipe().backdrop, defaultRecipe().backdrop, 'fresh copies');
});

await test('add/remove items respect limits and pick unused kinds', () => {
  let r = { particles: [] };
  for (let i = 0; i < 6; i++) r = addItem(r, 'particles');
  assert.equal(r.particles.length, 4);
  assert.equal(new Set(r.particles.map((p) => p.kind)).size, 4);
  assert.equal(canAdd(r, 'particles'), false);
  r = removeItem(r, 'particles', 0);
  assert.equal(r.particles.length, 3);
  assert.equal(canAdd(r, 'particles'), true);
  let c = {};
  for (let i = 0; i < 9; i++) c = addItem(c, 'creatures');
  assert.equal(c.creatures.length, 5);
});

await test('add/remove colors respect limits', () => {
  let r = { backdrop: { colors: ['#000000', '#111111'] } };
  r = removeColor(r, 'backdrop.colors', [2, 5], 0);
  assert.equal(r.backdrop.colors.length, 2, 'cannot go below min');
  for (let i = 0; i < 5; i++) r = addColor(r, 'backdrop.colors', [2, 5], '#222222');
  assert.equal(r.backdrop.colors.length, 5);
  r = removeColor(r, 'backdrop.colors', [2, 5], 4);
  assert.equal(r.backdrop.colors.length, 4);
  assert.deepEqual(addColor({}, 'creatures.0.colors', [1, 4], 'bad'), { creatures: [{ colors: ['#ffffff'] }] });
});

await test('changeKind swaps default colors only', () => {
  const r = { particles: [newParticle('bubbles'), { ...newParticle('snow'), color: '#123456' }] };
  const a = changeKind(r, 'particles', 0, 'embers');
  assert.equal(a.particles[0].kind, 'embers');
  assert.equal(a.particles[0].color, newParticle('embers').color);
  const b = changeKind(r, 'particles', 1, 'embers');
  assert.equal(b.particles[1].color, '#123456', 'custom color kept');
  const c = changeKind({ creatures: [newCreature('fish')] }, 'creatures', 0, 'jellyfish');
  assert.deepEqual(c.creatures[0].colors, newCreature('jellyfish').colors);
  assert.equal(changeKind(r, 'particles', 9, 'snow'), r);
});

await test('effectiveRecipe gates code mode behind approval', () => {
  const code = { mode: 'code', name: 'x' };
  assert.equal(effectiveRecipe(code).mode, 'recipe');
  assert.equal(effectiveRecipe(code, { hasCode: true }).mode, 'recipe');
  assert.equal(effectiveRecipe(code, { codeApproved: true }).mode, 'recipe', 'no code file');
  assert.equal(effectiveRecipe(code, { hasCode: true, codeApproved: true }).mode, 'code');
  const imported = { mode: 'recipe', importedCode: true };
  assert.equal(wantsCode(imported), true);
  assert.equal(effectiveRecipe(imported, { hasCode: true }).mode, 'recipe');
  assert.equal(effectiveRecipe(imported, { hasCode: true, codeApproved: true }).mode, 'code');
  assert.equal(effectiveRecipe({ mode: 'recipe' }, { hasCode: true, codeApproved: true }).mode, 'recipe', 'a plain recipe never becomes code');
  assert.equal(effectiveRecipe({ mode: 'bogus' }).mode, 'recipe');
  assert.equal(code.mode, 'code', 'input untouched');
});

await test('effectiveRecipe trims lists, strings and sorts zones', () => {
  const r = effectiveRecipe({
    name: 'n'.repeat(80), description: 'd'.repeat(400),
    particles: Array.from({ length: 6 }, () => newParticle()),
    creatures: [{ kind: 'fish', zone: [0.9, 0.1] }, ...Array.from({ length: 6 }, () => newCreature())],
  });
  assert.equal(r.version, 1);
  assert.equal(r.name.length, 60);
  assert.equal(r.description.length, 280);
  assert.equal(r.particles.length, 4);
  assert.equal(r.creatures.length, 5);
  assert.deepEqual(r.creatures[0].zone, [0.1, 0.9]);
});

await test('mergeGenerated keeps the draft image and depth', () => {
  const cur = { name: 'Mine', backdrop: { kind: 'image', image: 'photo.jpg', depth: 'depth.png' } };
  const m = mergeGenerated(cur, { backdrop: { parallax: 0.4 }, effects: { fog: 1 } });
  assert.equal(m.backdrop.image, 'photo.jpg');
  assert.equal(m.backdrop.depth, 'depth.png');
  assert.equal(m.backdrop.kind, 'image');
  assert.equal(m.backdrop.parallax, 0.4);
  assert.equal(m.name, 'Mine');
  const g = mergeGenerated({ backdrop: { kind: 'gradient' } }, { name: 'New', backdrop: { kind: 'gradient', colors: ['#000000', '#ffffff'] } });
  assert.equal(g.backdrop.image, undefined);
  assert.equal(g.name, 'New');
  assert.equal(mergeGenerated(cur, { backdrop: { kind: 'gradient', image: 'other.png' } }).backdrop.image, 'other.png');
});

await test('file names and urls', () => {
  assert.equal(fileNameFromUrl('/user/_drafts/d1/depth.png?v=2'), 'depth.png');
  assert.equal(fileNameFromUrl('https://deskworlds.local/user/_drafts/d1/my%20photo.jpg'), 'my photo.jpg');
  assert.equal(fileNameFromUrl('/user/x/'), null);
  assert.equal(fileNameFromUrl(null), null);
  assert.equal(joinUrl('/user/a/', 'b.png'), '/user/a/b.png');
  assert.equal(joinUrl('/user/a', 'b.png'), '/user/a/b.png');
});

await test('safeCssUrl only allows plain same-origin paths', () => {
  assert.equal(safeCssUrl('/user/a/b.png'), '/user/a/b.png');
  assert.equal(safeCssUrl('https://deskworlds.local/user/a/b.png'), 'https://deskworlds.local/user/a/b.png');
  assert.equal(safeCssUrl('//evil.example/x.png'), null);
  assert.equal(safeCssUrl('https://evil.example/x.png'), null);
  assert.equal(safeCssUrl('/a.png") , url("x'), null);
  assert.equal(safeCssUrl('/a b.png'), null);
  assert.equal(safeCssUrl('javascript:alert(1)'), null);
});

await test('swatchBackground uses image, then colors, then a stable fallback', () => {
  const img = swatchBackground({ id: 'a', image: '/user/a/photo.jpg', colors: ['#000000', '#ffffff'] });
  assert.match(img, /^url\("\/user\/a\/photo\.jpg"\) center \/ cover no-repeat, linear-gradient\(180deg, #000000, #ffffff\)$/);
  assert.equal(swatchBackground({ id: 'a', image: null, colors: ['#ABCDEF', '#000000', 'bad'] }), 'linear-gradient(180deg, #abcdef, #000000)');
  const fb = swatchBackground({ id: 'koi-garden', image: null, colors: null });
  assert.match(fb, /^linear-gradient\(160deg, hsl\(\d+ 38% 26%\), hsl\(\d+ 45% 9%\)\)$/);
  assert.equal(fb, swatchBackground({ id: 'koi-garden' }), 'stable');
  assert.notEqual(fb, swatchBackground({ id: 'moon-lagoon' }));
  const unsafe = swatchBackground({ id: 'x', image: 'https://evil.example/a.png', colors: ['#000000', '#111111'] });
  assert.ok(!unsafe.includes('url('), 'foreign image ignored');
  const fromRecipe = swatchBackground({ id: 'x', base: '/user/x/' }, { backdrop: { kind: 'image', image: 'p.jpg' } });
  assert.ok(fromRecipe.startsWith('url("/user/x/p.jpg")'));
});

await test('errorText', () => {
  assert.equal(errorText('boom'), 'boom');
  assert.equal(errorText(new Error('bad key')), 'bad key');
  assert.equal(errorText({ error: 'x' }), 'x');
  assert.equal(errorText(null), 'Something went wrong.');
});

await test('debounce coalesces, cancels and flushes', async () => {
  const calls = [];
  const d = debounce((v) => calls.push(v), 20);
  d(1); d(2); d(3);
  assert.equal(d.pending(), true);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(calls, [3]);
  d(4); d.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls, [3]);
  d(5); d.flush();
  assert.deepEqual(calls, [3, 5]);
  assert.equal(d.pending(), false);
});

await test('modelOptions and sortScenes', () => {
  assert.deepEqual(modelOptions(['a', { id: 'b', name: 'B' }, { nope: 1 }, null]), [{ id: 'a', label: 'a' }, { id: 'b', label: 'B' }]);
  assert.deepEqual(modelOptions(undefined), []);
  const s = sortScenes([{ id: 'a' }, { id: 'b', example: true }, null, { name: 'no id' }]);
  assert.deepEqual(s.saved.map((x) => x.id), ['a']);
  assert.deepEqual(s.examples.map((x) => x.id), ['b']);
});

console.log(`studio model: ${passed} tests passed`);
