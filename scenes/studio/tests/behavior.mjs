import assert from 'node:assert/strict';
import { createWorld, daylight, lightFor, petScale, isSulking, cleanPets, petKind, DAY, TAP_RADIUS, CURIOUS, MOOD_LIGHT } from '../src/behavior.js';
import { normalize } from '../src/recipe.js';
import { randomGenerator } from '../../shared/random.js';

const W = 1920, H = 1080;
const world = (recipe, seed = 3, now = () => Date.parse('2026-10-09T12:00:00Z')) =>
  createWorld({ recipe: normalize(recipe), width: W, height: H, random: randomGenerator(seed), now });
const run = (w, seconds, each = () => {}) => { for (let t = 0; t < seconds; t += 1 / 60) { each(t); w.step(1 / 60); w.events.length = 0; } };
const centroid = (agents) => agents.reduce((s, a) => ({ x: s.x + a.x / agents.length, y: s.y + a.y / agents.length }), { x: 0, y: 0 });

// Day and night from the local clock.
{
  const at = (h, m = 0) => daylight(new Date(2026, 9, 9, h, m));
  assert.equal(at(3).night, 1);
  assert.equal(at(13).night, 0);
  assert.equal(at(23).night, 1);
  assert.ok(at(6, 30).night > 0.3 && at(6, 30).night < 0.7, 'dawn blends');
  assert.ok(at(19).night > 0.3 && at(19).night < 0.7, 'dusk blends');
  assert.ok(at(18, 45).warm > 0.6, 'dusk is warm');
  assert.ok(at(6, 40).warm > 0.6, 'dawn is warm');
  assert.equal(at(13).warm, 0);
  let last = at(16).night;
  for (let m = 16 * 60; m <= 22 * 60; m += 5) { const n = daylight(new Date(2026, 9, 9, 0, m)).night; assert.ok(n >= last - 1e-9, 'night only deepens through the evening'); last = n; }
  assert.deepEqual(lightFor({ followClock: false, mood: 'night' }, true, new Date(2026, 9, 9, 12)), MOOD_LIGHT.night);
  assert.deepEqual(lightFor({ followClock: true, mood: 'night' }, false, new Date(2026, 9, 9, 12)), MOOD_LIGHT.night, 'host clock off: the fixed mood');
  assert.equal(lightFor({ followClock: true, mood: 'day' }, true, new Date(2026, 9, 9, 2)).night, 1);
}

// Pets: growth, sulking, and cleaning whatever the host sends.
{
  assert.equal(petScale(0), 1);
  assert.equal(petScale(40), 2);
  assert.equal(petScale(400), 2);
  assert.equal(petScale(-5), 1);
  const now = Date.parse('2026-10-09T12:00:00Z');
  assert.equal(isSulking({ lastFed: '2026-10-09T00:00:00Z' }, now), false);
  assert.equal(isSulking({ lastFed: new Date(now - DAY - 1000).toISOString() }, now), true);
  assert.equal(isSulking({ lastFed: 'never' }, now), false);
  const pets = cleanPets([{ id: 'a', name: 'Bubbles\u0007', color: '#FF8A3D', meals: 3.7 }, { id: 'a', name: 'dup' }, null, 'x', { name: 'x'.repeat(99), color: 'red' }]);
  assert.equal(pets.length, 2);
  assert.equal(pets[0].name, 'Bubbles');
  assert.equal(pets[0].color, '#ff8a3d');
  assert.equal(pets[0].meals, 3);
  assert.equal(pets[1].color, '#ff8a3d');
  assert.equal(pets[1].name.length, 24);
  assert.deepEqual(cleanPets('nope'), []);
  assert.equal(petKind(normalize({ creatures: [{ kind: 'koi' }, { kind: 'fish' }] })), 'koi');
  assert.equal(petKind(normalize({})), 'fish');
}

// Cruising: finite, on screen, inside their band, never frozen.
for (const kind of ['fish', 'angelfish', 'koi', 'jellyfish', 'firefly', 'bird', 'butterfly']) {
  const w = world({ medium: kind === 'bird' || kind === 'butterfly' || kind === 'firefly' ? 'air' : 'water', creatures: [{ kind, count: 20, zone: [0.3, 0.7] }] });
  let outside = 0, offBand = 0, samples = 0, moved = 0;
  const start = w.agents.map((a) => ({ x: a.x, y: a.y }));
  run(w, 40, (t) => {
    if (t < 5) return;
    for (const a of w.agents) {
      samples++;
      if (a.x < 0 || a.x > W || a.y < 0 || a.y > H) outside++;
      if (a.y < 0.3 * H - a.len * 3 || a.y > 0.7 * H + a.len * 3) offBand++;
    }
  });
  w.agents.forEach((a, i) => { if (Math.hypot(a.x - start[i].x, a.y - start[i].y) > a.len) moved++; });
  assert.ok(w.diagnostics().finite, `${kind}: state stays finite`);
  assert.equal(outside, 0, `${kind}: stays on screen`);
  assert.ok(offBand / samples < 0.05, `${kind}: keeps to its band (${(100 * offBand / samples).toFixed(1)}% outside)`);
  assert.ok(moved >= w.agents.length * 0.8, `${kind}: they wander`);
}

// Schooling: a tight school stays together more than loners do.
{
  const spread = (schooling) => {
    const w = world({ creatures: [{ kind: 'fish', count: 16, schooling, zone: [0.1, 0.9] }] }, 11);
    let total = 0, n = 0;
    run(w, 60, (t) => {
      if (t < 20 || Math.round(t * 60) % 30) return;
      const c = centroid(w.agents);
      total += w.agents.reduce((s, a) => s + Math.hypot(a.x - c.x, a.y - c.y), 0) / w.agents.length; n++;
    });
    return total / n;
  };
  const tight = spread(1), loose = spread(0);
  assert.ok(tight < loose * 0.8, `schooling pulls fish together (${tight.toFixed(0)} vs ${loose.toFixed(0)} px)`);
}

// A tap scatters everything nearby, hard, and they calm down within a few seconds.
{
  const w = world({ creatures: [{ kind: 'fish', count: 20, schooling: 0.7 }] }, 5);
  run(w, 10);
  const c = centroid(w.agents);
  const R = TAP_RADIUS * Math.max(W, H);
  const near = w.agents.filter((a) => Math.hypot(a.x - c.x, a.y - c.y) < R);
  const before = near.map((a) => Math.hypot(a.x - c.x, a.y - c.y));
  w.tap(c.x, c.y);
  assert.ok(near.length > 0 && near.every((a) => a.fear > 0.4), 'everything within the radius is frightened');
  run(w, 0.8);
  const after = near.map((a) => Math.hypot(a.x - c.x, a.y - c.y));
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  assert.ok(mean(after) > mean(before) + 100, `they scatter (${mean(before).toFixed(0)} -> ${mean(after).toFixed(0)} px)`);
  run(w, 6);
  assert.ok(w.agents.every((a) => a.fear < 0.05), 'and calm down after a few seconds');
  const far = world({ creatures: [{ kind: 'fish', count: 10, zone: [0.1, 0.2] }] }, 9);
  far.agents.forEach((a) => { a.x = 100; a.y = 100; });
  far.tap(W - 10, H - 10);
  assert.ok(far.agents.every((a) => a.fear === 0), 'a tap far away frightens nobody');
}

// The cursor: a slow one draws them in, a fast one sends them off.
{
  const w = world({ creatures: [{ kind: 'fish', count: 12, schooling: 0.2 }] }, 21);
  run(w, 5);
  const c = centroid(w.agents);
  const target = { x: Math.min(W - 200, c.x + 150), y: c.y };
  const watchers = w.agents.filter((a) => Math.hypot(a.x - target.x, a.y - target.y) < CURIOUS * H * 0.9);
  assert.ok(watchers.length > 0);
  const dist = () => watchers.reduce((s, a) => s + Math.hypot(a.x - target.x, a.y - target.y), 0) / watchers.length;
  const d0 = dist();
  run(w, 8, () => w.setPointer(target.x, target.y));
  assert.ok(dist() < d0, `a still cursor is interesting (${d0.toFixed(0)} -> ${dist().toFixed(0)} px)`);
  let x = 0;
  run(w, 0.5, () => { x += 60; w.setPointer(target.x + Math.sin(x / 50) * 120, target.y); });
  assert.ok(w.agents.some((a) => a.fear > 0.1), 'a fast cursor is a threat');
  w.setPointer(null);
  assert.equal(w.pointer.inside, false);
}

// Food: it sinks in water, falls in air, nectar hangs; hungry creatures find it and eat it.
{
  const w = world({ medium: 'water', food: 'flakes', creatures: [{ kind: 'fish', count: 0 }] });
  w.feedAt(900, 100);
  const y0 = w.food[0].y;
  run(w, 3);
  assert.ok(w.food[0].y > y0 + 40, 'flakes sink');
  const air = world({ medium: 'air', food: 'nectar', creatures: [] });
  air.feedAt(900, 500);
  const n0 = air.food.map((f) => f.y);
  run(air, 3);
  assert.ok(air.food.every((f, i) => Math.abs(f.y - n0[i]) < 120), 'nectar hangs in the air');
  const none = world({ food: 'none', creatures: [{ kind: 'fish' }] });
  assert.equal(none.feed(), 0, 'food "none" drops nothing');

  const eat = world({ food: 'pellets', creatures: [{ kind: 'fish', count: 10, zone: [0.1, 0.9] }] }, 8);
  run(eat, 4);
  eat.agents.forEach((a) => { a.full = 0; });
  const c = centroid(eat.agents);
  let eaten = 0;
  eat.feedAt(c.x, c.y);
  for (let t = 0; t < 12; t += 1 / 60) { eat.step(1 / 60); eaten += eat.events.filter((e) => e.type === 'eat').length; eat.events.length = 0; }
  assert.ok(eaten >= 3, `fish eat the food (${eaten})`);
}

// Pets: bigger, eat first, wiggle after eating, sulk when unfed.
{
  const now = Date.parse('2026-10-09T12:00:00Z');
  const w = world({ food: 'pellets', creatures: [{ kind: 'fish', count: 8, zone: [0.1, 0.9] }] }, 4, () => now);
  w.setPets([{ id: 'p1', name: 'Bubbles', color: '#ff8a3d', meals: 40, lastFed: new Date(now - 1000).toISOString() },
    { id: 'p2', name: 'Grump', color: '#3daaff', meals: 0, lastFed: new Date(now - 2 * DAY).toISOString() }]);
  run(w, 2);
  const [p1, p2] = ['p1', 'p2'].map((id) => w.agents.find((a) => a.pet?.id === id));
  const fish = w.agents.find((a) => !a.pet);
  assert.ok(p1.len > fish.len * 2.2, 'a well-fed pet is much bigger');
  assert.equal(p1.sulking, false);
  assert.equal(p2.sulking, true, 'unfed for two days: sulking');
  // Sulking pets swim at 40%: compare a sulking and a happy twin over time.
  const speeds = { a: 0, b: 0 };
  run(w, 10, () => { speeds.a += Math.hypot(p2.vx, p2.vy) / p2.len; speeds.b += Math.hypot(p1.vx, p1.vy) / p1.len; });
  assert.ok(speeds.a < speeds.b * 0.6, 'sulking pets are slow');
  // Food next to both a pet and an ordinary fish goes to the pet.
  w.agents.forEach((a) => { a.full = 0; a.fear = 0; });
  const others = w.agents.filter((a) => !a.pet);
  p1.x = 600; p1.y = 500; p1.vx = p1.vy = 0;
  others.forEach((a, i) => { a.x = 640 + i * 3; a.y = 520; a.vx = a.vy = 0; });
  w.feedAt(620, 505);
  const eaters = [];
  for (let t = 0; t < 8; t += 1 / 60) { w.step(1 / 60); for (const e of w.events) if (e.type === 'eat') eaters.push(e.pet); w.events.length = 0; }
  assert.ok(eaters.length > 0, 'the food is eaten');
  assert.ok(eaters.filter((p) => p === 'p1').length >= eaters.length * 0.6, `pets eat first (${eaters.filter(Boolean).length}/${eaters.length})`);
  // Updating the list keeps the same pet (and position), and drops removed ones.
  const before = { x: p1.x, y: p1.y }, lenBefore = p1.len;
  w.setPets([{ id: 'p1', name: 'Bubbles II', color: '#ff8a3d', meals: 10, lastFed: new Date(now).toISOString() }]);
  const again = w.agents.filter((a) => a.pet);
  assert.equal(again.length, 1);
  assert.equal(again[0], p1);
  assert.deepEqual({ x: again[0].x, y: again[0].y }, before);
  assert.equal(again[0].pet.name, 'Bubbles II');
  assert.ok(Math.abs(again[0].len / lenBefore - petScale(10) / petScale(40)) < 1e-9, 'resized for its meals');
  w.setPets([]);
  assert.equal(w.agents.filter((a) => a.pet).length, 0);
}

// Resizing rescales positions and bodies, and nothing escapes a smaller screen.
{
  const w = world({ creatures: [{ kind: 'koi', count: 8 }] });
  run(w, 3);
  w.setBounds(800, 600);
  run(w, 5);
  assert.ok(w.agents.every((a) => a.x >= 0 && a.x <= 800 && a.y >= 0 && a.y <= 600));
  assert.ok(w.diagnostics().finite);
  w.step(NaN); w.step(-1); w.step(0);
  assert.ok(w.diagnostics().finite, 'bad time steps are ignored');
}

console.log('studio behavior: ok');
