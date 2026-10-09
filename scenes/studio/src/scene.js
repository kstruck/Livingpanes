import * as THREE from 'three';
import { createWorld } from './behavior.js';
import { createBackdrop, MAX_RIPPLES } from './backdrop.js';
import { createParticles } from './particles.js';
import { createCreatures } from './creatures.js';
import { createFood } from './food.js';
import { createLabels } from './labels.js';
import { linearColor } from './gl.js';

// The built-in engine: everything a recipe describes, in one THREE.Scene.
export function createRecipeScene({ recipe, renderer, shared, base, stage, width, height, random }) {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera(); // every shader works in screen space
  const world = createWorld({ recipe, width, height, random });
  const backdrop = createBackdrop({ recipe, renderer, shared, base });
  const particles = createParticles({ recipe, shared, width, height, seed: Math.floor(random() * 1e6) });
  const food = createFood({ recipe, shared, world });
  let creatures = createCreatures({ recipe, shared, world });
  const labels = createLabels(stage);
  for (const mesh of [...backdrop.meshes, ...particles.meshes, ...food.meshes, ...creatures.meshes]) scene.add(mesh);
  shared.uTint.value.copy(linearColor(recipe.effects.tint));

  const ripples = [];
  const water = recipe.medium === 'water';
  const rippleAmount = recipe.effects.ripples;
  // Taps always ring (the backdrop shows at least a faint ring); cursor and food rings
  // only when the recipe asks for ripples.
  function ripple(x, y, strength, always = false) {
    if ((!(rippleAmount > 0) && !always) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (ripples.length >= MAX_RIPPLES) ripples.sort((a, b) => b.age - a.age).shift();
    ripples.push({ x, y, age: 0, strength });
  }
  let lastCursorRipple = -1;

  // A visit opens on a world already in motion.
  for (let i = 0; i < 180; i++) world.step(1 / 30);
  world.events.length = 0;

  const look = { x: 0, y: 0, vx: 0, vy: 0 };
  let time = 0;

  function frame(dt, night) {
    time += dt;
    world.step(dt);
    for (const e of world.events) {
      if (e.type === 'drop' && water) ripple(e.x, e.y, 0.55);
      if (e.type === 'eat' && water) ripple(e.x, e.y, 0.2);
    }
    world.events.length = 0;
    // A fast-moving cursor trails small rings (throttled).
    const p = world.pointer;
    if (p.inside && p.speed > world.unit() * 1.4 && time - lastCursorRipple > 0.14) { ripple(p.x, p.y, 0.32); lastCursorRipple = time; }
    for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].age += dt; if (ripples[i].age > 4.5) ripples.splice(i, 1); }
    backdrop.setRipples(ripples);

    // Parallax follows the cursor through a critically damped spring.
    const tx = p.inside ? (p.x / world.bounds.width - 0.5) * 2 : 0, ty = p.inside ? (p.y / world.bounds.height - 0.5) * 2 : 0;
    const omega = 3.2, k = Math.min(dt, 0.1);
    look.vx += (-(omega * omega) * (look.x - tx) - 2 * omega * look.vx) * k; look.x += look.vx * k;
    look.vy += (-(omega * omega) * (look.y - ty) - 2 * omega * look.vy) * k; look.y += look.vy * k;
    backdrop.update(look, time);

    particles.update(night);
    food.update(night);
    creatures.update(dt, night);
    labels.update(world.agents);
    renderer.render(scene, camera);
  }

  return {
    world, ready: backdrop.ready, three: scene,
    frame,
    resize(w, h) { world.setBounds(w, h); backdrop.fit(w, h); particles.resize(w, h); },
    pointer(x, y) { world.setPointer(x, y); },
    feedAt(x, y) { world.feedAt(x, y); },
    feed() { world.feed(); },
    tap(x, y) { ripple(x, y, 1, true); world.tap(x, y); },
    pets(list) {
      world.setPets(list);
      for (const { old, mesh } of creatures.ensureCapacity()) { scene.remove(old); scene.add(mesh); }
    },
    diagnostics: () => ({ ...world.diagnostics(), ripples: ripples.length, drawCalls: renderer.info.render.calls }),
    dispose() {
      backdrop.dispose(); particles.dispose(); food.dispose(); creatures.dispose(); labels.dispose();
      creatures = null;
    },
  };
}
