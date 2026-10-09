// Creature, food and pet behaviour for the Studio engine. Pure: no DOM, no WebGL, all
// randomness injected, so it runs (and is tested) in Node. Units are CSS pixels with y
// pointing down, the same space as pointer events and the sceneFeedAt/sceneTap hooks.

// Per kind: body length as a fraction of the shorter screen side, cruise and top speed in
// body lengths per second, how fast it turns, and how it moves.
export const KINDS = Object.freeze({
  fish: { length: 0.055, cruise: 1.15, burst: 4.6, turn: 3.2, flat: 0.35, eats: true },
  angelfish: { length: 0.075, cruise: 0.55, burst: 3.2, turn: 2.2, flat: 0.45, eats: true },
  koi: { length: 0.13, cruise: 0.42, burst: 2.4, turn: 1.5, flat: 1, eats: true },
  jellyfish: { length: 0.08, cruise: 0.22, burst: 1.1, turn: 0.7, flat: 1, eats: false },
  firefly: { length: 0.02, cruise: 1.6, burst: 6, turn: 5, flat: 1, eats: true },
  bird: { length: 0.05, cruise: 2.4, burst: 5.5, turn: 2.2, flat: 0.25, eats: true },
  butterfly: { length: 0.05, cruise: 1.3, burst: 4.5, turn: 4.5, flat: 0.9, eats: true },
});

export const FOOD = Object.freeze({
  // fall: terminal speed (fraction of the shorter side per second); per: items per pinch.
  flakes: { fall: 0.035, flutter: 0.02, per: 7, life: 30, size: 0.008 },
  pellets: { fall: 0.085, flutter: 0.004, per: 4, life: 30, size: 0.009 },
  seeds: { fall: 0.15, flutter: 0.012, per: 6, life: 18, size: 0.008 },
  nectar: { fall: 0, flutter: 0.03, per: 5, life: 28, size: 0.01 },
});

export const DAY = 24 * 60 * 60 * 1000;
export const TAP_RADIUS = 0.25; // of the longer screen side
export const CURIOUS = 0.45; // a slow cursor is noticed this far away (of the shorter side)
export const MAX_FOOD = 80;
export const MAX_PETS = 12;

const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrapAngle = (a) => { a = (a + Math.PI) % TAU; return (a < 0 ? a + TAU : a) - Math.PI; };

// Light from the local clock: sunrise about 06:30, sunset about 19:00, an hour of blend
// each side. night is 0 by day and 1 at night; warm peaks around dawn and dusk.
export const SUNRISE = 6.5 * 60, SUNSET = 19 * 60;
export function daylight(date) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const night = m < 12 * 60 ? 1 - smooth(SUNRISE - 30, SUNRISE + 30, m) : smooth(SUNSET - 30, SUNSET + 30, m);
  const bell = (c, w) => Math.max(0, 1 - Math.abs(m - c) / w) ** 1.5;
  return { night, warm: Math.max(bell(SUNRISE + 10, 70), bell(SUNSET - 15, 80)) };
}
export const MOOD_LIGHT = Object.freeze({
  day: Object.freeze({ night: 0, warm: 0 }),
  dawn: Object.freeze({ night: 0.2, warm: 0.8 }),
  dusk: Object.freeze({ night: 0.3, warm: 1 }),
  night: Object.freeze({ night: 1, warm: 0 }),
});
export function lightFor(light, follow, date) {
  return light?.followClock !== false && follow ? daylight(date) : MOOD_LIGHT[light?.mood] || MOOD_LIGHT.day;
}

export const petScale = (meals) => 1 + Math.min(Math.max(0, Number(meals) || 0), 40) * 0.025;
export function isSulking(pet, now) {
  const t = Date.parse(pet?.lastFed ?? pet?.born ?? '');
  return Number.isFinite(t) && now - t > DAY;
}
const PET_COLOR = /^#[0-9a-fA-F]{6}$/;
export function cleanPets(pets) {
  if (!Array.isArray(pets)) return [];
  const out = [];
  for (let i = 0; i < pets.length && out.length < MAX_PETS; i++) {
    const p = pets[i];
    if (!p || typeof p !== 'object') continue;
    const id = typeof p.id === 'string' && p.id ? p.id.slice(0, 64) : `pet-${i}`;
    if (out.some((q) => q.id === id)) continue;
    const name = typeof p.name === 'string' ? p.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';
    out.push({
      id, name,
      color: typeof p.color === 'string' && PET_COLOR.test(p.color) ? p.color.toLowerCase() : '#ff8a3d',
      born: typeof p.born === 'string' ? p.born : '',
      lastFed: typeof p.lastFed === 'string' ? p.lastFed : '',
      meals: Number.isFinite(p.meals) ? Math.max(0, Math.floor(p.meals)) : 0,
    });
  }
  return out;
}

// The kind pets take: the scene's first creature, or a fish when it has none.
export const petKind = (recipe) => recipe?.creatures?.[0]?.kind || 'fish';

export function createWorld({ recipe, width, height, random = Math.random, now = () => Date.now() }) {
  const W = { width: Math.max(1, width), height: Math.max(1, height) };
  const unit = () => Math.min(W.width, W.height);
  const medium = recipe.medium;
  const agents = [], food = [], events = [];
  const pointer = { x: 0, y: 0, inside: false, speed: 0 };
  let lastPointer = null, clock = 0;

  function makeAgent(kind, spec, group, pet = null) {
    const k = KINDS[kind];
    const scale = pet ? 1.55 * petScale(pet.meals) : 1;
    const variation = 0.82 + random() * 0.36;
    const zone = spec.zone || [0.15, 0.85];
    const a = {
      kind, group, pet, glow: Boolean(spec.glow), schooling: spec.schooling ?? 0.3,
      zoneTop: zone[0], zoneBottom: zone[1], sizeScale: spec.size * variation * scale, speedScale: spec.speed * (0.85 + random() * 0.3),
      x: 0, y: 0, vx: 0, vy: 0, heading: random() * TAU, wander: random() * TAU, fear: 0, fx: 0, fy: 0,
      phase: random() * TAU, seed: random(), colorPick: random(), eat: 0, full: random() * 2, target: null, sulking: false,
      len: 0, sx: 1,
    };
    a.len = k.length * unit() * a.sizeScale;
    placeInZone(a);
    const speed = k.cruise * a.len * a.speedScale;
    a.vx = Math.cos(a.heading) * speed; a.vy = Math.sin(a.heading) * speed * k.flat;
    return a;
  }
  function placeInZone(a) {
    const m = a.len;
    a.x = m + random() * Math.max(1, W.width - 2 * m);
    const top = a.zoneTop * W.height, bottom = a.zoneBottom * W.height;
    a.y = clamp(top + random() * (bottom - top), m * 0.5, W.height - m * 0.5);
  }

  recipe.creatures.forEach((spec, group) => {
    // The cast is exactly what the recipe asks for, on any screen size.
    for (let i = 0; i < spec.count; i++) agents.push(makeAgent(spec.kind, spec, group));
  });

  const pkind = petKind(recipe);
  const pspec = recipe.creatures.find((c) => c.kind === pkind) || { size: 1, speed: 1, schooling: 0, zone: KINDS_ZONE[pkind] || [0.2, 0.8], glow: false };
  function setPets(list) {
    const pets = cleanPets(list);
    const keep = new Map(agents.filter((a) => a.pet).map((a) => [a.pet.id, a]));
    for (let i = agents.length - 1; i >= 0; i--) if (agents[i].pet && !pets.some((p) => p.id === agents[i].pet.id)) agents.splice(i, 1);
    for (const pet of pets) {
      const old = keep.get(pet.id);
      if (old) {
        old.pet = pet;
        old.sizeScale = (old.sizeScale / (1.55 * petScale(old.petMeals ?? 0))) * 1.55 * petScale(pet.meals);
        old.petMeals = pet.meals;
        old.len = KINDS[pkind].length * unit() * old.sizeScale;
      } else {
        const a = makeAgent(pkind, { ...pspec, glow: pspec.glow, schooling: 0 }, -1, pet);
        a.petMeals = pet.meals;
        a.speedScale = pspec.speed;
        agents.push(a);
      }
    }
    refreshSulk();
  }
  function refreshSulk() {
    const t = now();
    for (const a of agents) if (a.pet) a.sulking = isSulking(a.pet, t);
  }

  function setBounds(width, height) {
    const oldW = W.width, oldH = W.height;
    W.width = Math.max(1, width); W.height = Math.max(1, height);
    const sx = W.width / oldW, sy = W.height / oldH;
    for (const a of agents) {
      a.x *= sx; a.y *= sy;
      a.len = KINDS[a.kind].length * unit() * a.sizeScale;
    }
    for (const f of food) { f.x *= sx; f.y *= sy; }
  }

  function setPointer(x, y) {
    if (x === null || x === undefined || !Number.isFinite(x) || !Number.isFinite(y)) { pointer.inside = false; lastPointer = null; pointer.speed = 0; return; }
    if (lastPointer && clock > lastPointer.t) {
      const dt = clock - lastPointer.t;
      const v = Math.hypot(x - lastPointer.x, y - lastPointer.y) / Math.max(dt, 1 / 120);
      pointer.speed = pointer.speed * 0.5 + v * 0.5;
    } else if (lastPointer) pointer.speed = Math.max(pointer.speed, Math.hypot(x - lastPointer.x, y - lastPointer.y) * 60 * 0.5);
    lastPointer = { x, y, t: clock };
    pointer.x = x; pointer.y = y; pointer.inside = true;
  }

  function tap(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const R = TAP_RADIUS * Math.max(W.width, W.height);
    for (const a of agents) {
      const dx = a.x - x, dy = a.y - y, d = Math.hypot(dx, dy);
      if (d > R) continue;
      const strength = 1 - 0.55 * (d / R);
      const ux = d > 1e-3 ? dx / d : Math.cos(a.heading), uy = d > 1e-3 ? dy / d : Math.sin(a.heading);
      if (strength > a.fear) { a.fear = strength; a.fx = ux; a.fy = uy; }
      const kick = KINDS[a.kind].burst * a.len * a.speedScale * strength * 0.6;
      a.vx += ux * kick; a.vy += uy * kick;
      a.target = null;
    }
  }

  const kindOfFood = () => (recipe.food === 'none' ? null : recipe.food);
  function feedAt(x, y) {
    const kind = kindOfFood();
    if (!kind || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const spec = FOOD[kind], u = unit();
    let added = 0;
    for (let i = 0; i < spec.per && food.length < MAX_FOOD; i++) {
      const r = Math.sqrt(random()) * u * 0.035, a = random() * TAU;
      food.push({
        kind, x: clamp(x + Math.cos(a) * r, 2, W.width - 2), y: clamp(y + Math.sin(a) * r * 0.6, 2, W.height - 2),
        vx: (random() - 0.5) * u * 0.02, vy: 0, age: 0, life: spec.life * (0.85 + random() * 0.3), seed: random(), landed: false, eaten: false,
      });
      added++;
    }
    if (added) events.push({ type: 'drop', x, y });
    return added;
  }
  // Food at a spot the scene picks: the surface for sinking food, the air for nectar.
  function feed() {
    const kind = kindOfFood();
    if (!kind) return 0;
    const x = W.width * (0.25 + random() * 0.5);
    const y = kind === 'nectar' ? W.height * (0.35 + random() * 0.35) : W.height * (medium === 'water' ? 0.04 : 0.02);
    return feedAt(x, y);
  }

  function stepFood(dt) {
    const u = unit(), floor = W.height - u * 0.025;
    for (let i = food.length - 1; i >= 0; i--) {
      const f = food[i], spec = FOOD[f.kind];
      f.age += dt;
      if (f.eaten || f.age > f.life) { food.splice(i, 1); continue; }
      if (f.kind === 'nectar') {
        // Motes hang in the air and drift.
        const t = f.age * 0.6 + f.seed * 40;
        f.vx = Math.sin(t * 1.3) * spec.flutter * u + Math.sin(t * 0.37) * spec.flutter * u * 0.5;
        f.vy = Math.cos(t * 1.1) * spec.flutter * u * 0.6;
      } else if (!f.landed) {
        f.vy += (spec.fall * u - f.vy) * Math.min(1, dt * 3);
        f.vx = f.vx * Math.exp(-dt * 2) + Math.sin(f.age * 2.6 + f.seed * 30) * spec.flutter * u * dt * 6;
        if (f.y >= floor) { f.y = floor; f.landed = true; f.vx = 0; f.vy = 0; }
      }
      f.x = clamp(f.x + f.vx * dt, 1, W.width - 1);
      if (!f.landed) f.y = clamp(f.y + f.vy * dt, 1, W.height - 1);
    }
  }

  function chooseFood(a) {
    const head = headOf(a), sense = unit() * (a.pet ? 0.8 : 0.45);
    let best = null, bestD = sense;
    for (const f of food) {
      if (f.eaten) continue;
      const d = Math.hypot(f.x - head.x, f.y - head.y);
      if (d >= bestD) continue;
      // Pets eat first: anything a pet is near belongs to the pet.
      if (!a.pet && agents.some((p) => p.pet && !p.full && Math.hypot(p.x - f.x, p.y - f.y) < unit() * 0.35)) continue;
      best = f; bestD = d;
    }
    return best;
  }
  function headOf(a) { return { x: a.x + Math.cos(a.heading) * a.len * 0.4, y: a.y + Math.sin(a.heading) * a.len * 0.4 }; }

  function step(dt) {
    if (!(dt > 0)) return;
    // Long frames are split so steering stays stable at low frame rates.
    const n = Math.min(6, Math.ceil(dt / (1 / 30)));
    for (let i = 0; i < n; i++) stepOnce(dt / n);
  }

  let sulkTimer = 0;
  function stepOnce(dt) {
    clock += dt;
    sulkTimer -= dt;
    if (sulkTimer <= 0) { refreshSulk(); sulkTimer = 1; }
    pointer.speed *= Math.exp(-dt * 6);
    stepFood(dt);
    const u = unit();
    const slow = u * 0.25, fast = u * 1.6;
    for (const a of agents) {
      const k = KINDS[a.kind];
      let dx = 0, dy = 0;
      // Wander: a slowly turning preferred direction.
      a.wander += (random() - 0.5) * dt * (a.kind === 'firefly' || a.kind === 'butterfly' ? 9 : 2.5);
      dx += Math.cos(a.wander); dy += Math.sin(a.wander) * k.flat;

      // Boids, within the agent's own group.
      if (a.group >= 0) {
        let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, nn = 0, near = a.len * 4.5, sep = a.len * 1.3;
        for (const b of agents) {
          if (b === a) continue;
          const ox = b.x - a.x, oy = b.y - a.y, d2 = ox * ox + oy * oy;
          if (d2 < sep * sep && d2 > 1e-6) { const d = Math.sqrt(d2); sx -= (ox / d) * (1 - d / sep); sy -= (oy / d) * (1 - d / sep); }
          if (b.group !== a.group || d2 > near * near) continue;
          const bs = Math.hypot(b.vx, b.vy) || 1;
          ax += b.vx / bs; ay += b.vy / bs; cx += ox; cy += oy; nn++;
        }
        dx += sx * 2.2; dy += sy * 2.2;
        if (nn) {
          const s = a.schooling;
          const al = Math.hypot(ax, ay) || 1, co = Math.hypot(cx, cy) || 1;
          dx += (ax / al) * s * 1.6 + (cx / co) * s * 0.9 * Math.min(1, co / near * 2);
          dy += (ay / al) * s * 1.6 + (cy / co) * s * 0.9 * Math.min(1, co / near * 2);
        }
      } else {
        for (const b of agents) {
          if (b === a) continue;
          const ox = b.x - a.x, oy = b.y - a.y, d = Math.hypot(ox, oy), sep = (a.len + b.len) * 0.6;
          if (d < sep && d > 1e-3) { dx -= (ox / d) * 1.5; dy -= (oy / d) * 1.5; }
        }
      }

      // Stay in the band and on screen.
      const top = a.zoneTop * W.height, bottom = a.zoneBottom * W.height;
      if (a.y < top) dy += 1.2 * Math.min(2, (top - a.y) / (a.len * 2) + 0.3);
      if (a.y > bottom) dy -= 1.2 * Math.min(2, (a.y - bottom) / (a.len * 2) + 0.3);
      const edge = Math.max(a.len * 2.5, u * 0.08);
      if (a.x < edge) dx += 2.5 * (1 - a.x / edge);
      if (a.x > W.width - edge) dx -= 2.5 * (1 - (W.width - a.x) / edge);
      if (a.y < edge * 0.6) dy += 2.5 * (1 - a.y / (edge * 0.6));
      if (a.y > W.height - edge * 0.6) dy -= 2.5 * (1 - (W.height - a.y) / (edge * 0.6));

      // The cursor: a slow one is interesting, a fast one is a threat.
      if (pointer.inside) {
        const ox = pointer.x - a.x, oy = pointer.y - a.y, d = Math.hypot(ox, oy);
        if (d < u * 0.22 && pointer.speed > fast && d > 1e-3) {
          const strength = 0.55 * (1 - d / (u * 0.22));
          if (strength > a.fear) { a.fear = strength; a.fx = -ox / d; a.fy = -oy / d; }
        } else if (d < u * CURIOUS && pointer.speed < slow && a.fear < 0.1 && d > a.len * 1.2 &&
          pointer.y > top - W.height * 0.08 && pointer.y < bottom + W.height * 0.08) {
          // Curious, but only about a cursor near their own band; birds barely care.
          const pull = 1.3 * (CURIOSITY[a.kind] ?? 1) * Math.min(1, 1.6 * (1 - d / (u * CURIOUS))) * (a.pet ? 1.4 : 1);
          dx += (ox / d) * pull; dy += (oy / d) * pull;
        }
      }

      // Food: seek it while hungry, eat it at the mouth.
      a.full = Math.max(0, a.full - dt);
      a.eat = Math.max(0, a.eat - dt);
      let seeking = false;
      if (k.eats && a.full <= 0 && a.fear < 0.3 && food.length) {
        if (!a.target || a.target.eaten || !food.includes(a.target))a.target = chooseFood(a);
        else if (random() < dt * 2) a.target = chooseFood(a) || a.target;
        const f = a.target;
        if (f) {
          const head = headOf(a), ox = f.x - head.x, oy = f.y - head.y, d = Math.hypot(ox, oy);
          if (d < Math.max(a.len * 0.35, u * 0.012)) {
            const blocked = !a.pet && agents.some((p) => p.pet && Math.hypot(p.x - f.x, p.y - f.y) < u * 0.35 && p.full <= 0);
            if (!blocked) {
              f.eaten = true; a.target = null; a.full = a.pet ? 0.5 : 1.6 + random(); a.eat = a.pet ? 1.1 : 0.4;
              events.push({ type: 'eat', x: f.x, y: f.y, pet: a.pet ? a.pet.id : null });
            } else a.target = null;
          } else if (d > 1e-3) { dx += (ox / d) * 3.2; dy += (oy / d) * 3.2; seeking = true; }
        }
      } else if (a.target && (a.fear >= 0.3 || a.full > 0)) a.target = null;

      // Fear: flee hard, then calm down over a few seconds.
      if (a.fear > 0.02) { dx += a.fx * 6 * a.fear; dy += a.fy * 6 * a.fear; }
      a.fear *= Math.exp(-dt / 1.3);
      if (a.fear < 0.02) a.fear = 0;

      const dl = Math.hypot(dx, dy) || 1;
      let speed = k.cruise * a.len * a.speedScale;
      speed *= 1 + a.fear * (k.burst / k.cruise - 1) + (seeking ? 0.6 : 0);
      if (a.eat > 0 && a.pet) speed *= 1.3;
      if (a.sulking) speed *= 0.4;
      if (a.kind === 'jellyfish') { const p = 0.5 + 0.5 * Math.sin(a.phase); speed *= 0.25 + 1.6 * p * p; }
      const tx = (dx / dl) * speed, ty = (dy / dl) * speed;
      const turn = Math.min(1, dt * k.turn * (1 + a.fear * 2));
      a.vx += (tx - a.vx) * turn; a.vy += (ty - a.vy) * turn;
      if (a.kind === 'jellyfish') a.vy += u * 0.004 * dt; // a slow sink between pulses

      a.x += a.vx * dt; a.y += a.vy * dt;
      // Hard bounds: whatever the steering did, keep the body on screen.
      const mx = a.len * 0.3;
      if (a.x < mx) { a.x = mx; a.vx = Math.abs(a.vx) * 0.5; }
      if (a.x > W.width - mx) { a.x = W.width - mx; a.vx = -Math.abs(a.vx) * 0.5; }
      if (a.y < mx) { a.y = mx; a.vy = Math.abs(a.vy) * 0.5; }
      if (a.y > W.height - mx) { a.y = W.height - mx; a.vy = -Math.abs(a.vy) * 0.5; }

      const sp = Math.hypot(a.vx, a.vy);
      if (sp > a.len * 0.02) {
        const want = Math.atan2(a.vy, a.vx);
        a.heading = wrapAngle(a.heading + wrapAngle(want - a.heading) * Math.min(1, dt * (a.kind === 'koi' ? 3 : 6)));
      }
      // Side-view swimmers keep their back up: mirror instead of swimming upside down.
      if (Math.abs(Math.cos(a.heading)) > 0.25) a.sx += ((Math.cos(a.heading) >= 0 ? 1 : -1) - a.sx) * Math.min(1, dt * 8);
      // Animation phase: tail beats, wing flaps and bell pulses quicken with speed.
      const rel = sp / Math.max(1, a.len);
      a.phase += dt * (BEAT[a.kind] + rel * BEAT_GAIN[a.kind]) * (a.sulking ? 0.6 : 1) + (a.eat > 0 && a.pet ? dt * 10 : 0);
    }
  }

  return {
    agents, food, events, pointer, bounds: W,
    get clock() { return clock; },
    step, setBounds, setPointer, tap, feed, feedAt, setPets,
    unit,
    diagnostics() {
      return {
        agents: agents.length, food: food.length, pets: agents.filter((a) => a.pet).length,
        finite: agents.every((a) => Number.isFinite(a.x + a.y + a.vx + a.vy + a.heading)),
      };
    },
  };
}

const KINDS_ZONE = { fish: [0.2, 0.85], angelfish: [0.2, 0.75], koi: [0.08, 0.92], jellyfish: [0.1, 0.8], firefly: [0.3, 0.9], bird: [0.05, 0.4], butterfly: [0.35, 0.9] };
const CURIOSITY = { fish: 1, angelfish: 1, koi: 1.1, jellyfish: 0.3, firefly: 0.6, bird: 0.25, butterfly: 0.8 };
const BEAT = { fish: 5, angelfish: 3, koi: 2.2, jellyfish: 1.3, firefly: 30, bird: 7, butterfly: 11 };
const BEAT_GAIN = { fish: 2.2, angelfish: 1.6, koi: 1.8, jellyfish: 0.4, firefly: 0, bird: 1.2, butterfly: 1.5 };
