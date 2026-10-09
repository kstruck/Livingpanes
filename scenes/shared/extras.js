// Livingpanes extras for the six handcrafted Deskworlds scenes: ripples when you tap the
// glass, named pets that live in the water, food at the cursor, and light that follows
// the clock. Drawn on a 2D canvas over the scene, so the scenes themselves stay as Chase
// Lean wrote them. The Studio engine draws all of this natively and skips this file.
//
// The Windows host loads this module into every wallpaper page and calls the hooks
// documented in ARCHITECTURE.md. Nothing here runs unless the host asks for it.

const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
const path = browser ? location.pathname : '';
const world = (path.match(/\/scenes\/([a-z]+)\//) || [])[1] || '';
const studio = world === 'studio' || (browser && window.sceneHandlesExtras);

// Which worlds have water to put pets in, and how each takes food at a point.
const WATER = new Set(['riverscape', 'reefscape', 'bettascape', 'koiscape']);
const ALWAYS_NIGHT = new Set(['bonfirescape', 'plasmascape']);

export const SULK_AFTER_MS = 24 * 60 * 60 * 1000;
export const petScale = (meals) => 1 + Math.min(Math.max(0, meals | 0), 40) * 0.025;

/** 0 at midday, 1 deep at night, from the local clock (sunrise 06:30, sunset 19:00). */
export function nightness(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  const ramp = (from, to) => Math.min(1, Math.max(0, (h - from) / (to - from)));
  if (h < 5.5) return 1;
  if (h < 7.5) return 1 - ramp(5.5, 7.5);
  if (h < 18) return 0;
  if (h < 20) return ramp(18, 20);
  return 1;
}

/** 0..1 warmth for dawn and dusk, peaking at 06:30 and 19:00. */
export function warmth(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  const peak = (center) => Math.max(0, 1 - Math.abs(h - center) / 1.2);
  return Math.max(peak(6.5), peak(19));
}

if (browser && !studio) install();

function install() {
  const canvas = document.createElement('canvas');
  canvas.id = 'livingpanes-extras';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2',
  });
  const tint = document.createElement('div');
  tint.id = 'livingpanes-light';
  Object.assign(tint.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '1', mixBlendMode: 'multiply',
    transition: 'background-color 20s linear', backgroundColor: 'transparent',
  });
  document.body.append(tint, canvas);
  const ctx = canvas.getContext('2d');

  let fps = 0, raf = 0, last = 0, followClock = true, width = 0, height = 0, ratio = 1;
  const ripples = [];
  const crumbs = [];
  let pets = [];

  const scene = () => document.querySelector('#scene');

  function resize() {
    ratio = Math.min(2, window.devicePixelRatio || 1);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  addEventListener('resize', resize);
  resize();

  // Follow the host's frame rate: no drawing at all while the scene is still.
  wrap('sceneRate', (value) => {
    fps = Number.isFinite(value) && value > 0 ? Math.min(60, value) : 0;
    schedule();
  });

  function schedule() {
    if (fps > 0 && !raf && (ripples.length || crumbs.length || pets.length)) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (fps === 0) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    if (now - last < 1000 / fps - 2) { schedule(); return; }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawRipples(dt);
    drawCrumbs(dt);
    drawPets(dt, now / 1000);
    schedule();
  }

  // Tap the glass

  function drawRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.age += dt;
      if (r.age > 2.4) { ripples.splice(i, 1); continue; }
      for (let ring = 0; ring < 3; ring++) {
        const t = r.age - ring * 0.18;
        if (t <= 0) continue;
        const radius = 14 + t * 260;
        const alpha = Math.max(0, 0.42 * (1 - t / 2.2)) * (1 - ring * 0.25);
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(220, 240, 255, ${alpha})`;
        ctx.lineWidth = 2.2 - ring * 0.5;
        ctx.stroke();
      }
    }
  }

  window.sceneTap = (x, y) => {
    if (!fps) return;
    ripples.push({ x, y, age: 0 });
    if (ripples.length > 8) ripples.shift();
    for (const pet of pets) pet.startle(x, y);
    // The worlds' own creatures shy from a fast-moving cursor, so a quick flick of the
    // pointer around the tap startles them the same way.
    const target = scene();
    if (target) {
      let step = 0;
      const flick = setInterval(() => {
        const angle = step * 2.1, spread = 30 + step * 14;
        target.dispatchEvent(new PointerEvent('pointermove', {
          clientX: x + Math.cos(angle) * spread, clientY: y + Math.sin(angle) * spread, bubbles: true,
        }));
        if (++step > 10) clearInterval(flick);
      }, 16);
    }
    schedule();
  };

  // Food at the cursor

  function dropAt(x, y) {
    const target = scene();
    if (!target) return false;
    const init = { clientX: x, clientY: y, button: 0, isPrimary: true, bubbles: true, pointerType: 'mouse' };
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    target.dispatchEvent(new PointerEvent('pointerup', init));
    target.dispatchEvent(new MouseEvent('click', init));
    return true;
  }

  const ownFeedAt = window.sceneFeedAt;
  window.sceneFeedAt = (x, y) => {
    if (!fps) return;
    // Riverbed, Coral reef and Bonfire already take a click as food (or a stir); Koi pond
    // has its own sceneFeedAt; Betta has no way to aim, so it gets its usual pinch.
    if (typeof window.__ownFeedAt === 'function') window.__ownFeedAt(x, y);
    else if (world === 'riverscape' || world === 'reefscape' || world === 'bonfirescape') dropAt(x, y);
    else if (typeof window.sceneFeed === 'function') {
      // The sceneFeed wrapper already drops the pets' crumbs (near the top).
      window.sceneFeed();
      schedule();
      return;
    }
    if (WATER.has(world)) for (let i = 0; i < 5; i++) crumbs.push(crumb(x, y));
    schedule();
  };
  // A world module that loads after this one may define its own; keep it, not ours.
  if (typeof ownFeedAt === 'function') window.__ownFeedAt = ownFeedAt;
  watchAssign('sceneFeedAt', (fn) => { window.__ownFeedAt = fn; });

  // Food from the tray menu: the pets get crumbs of their own near the top.
  wrap('sceneFeed', () => {
    if (!WATER.has(world) || !fps) return;
    const x = width * (0.3 + Math.random() * 0.4), y = height * 0.2;
    for (let i = 0; i < 5; i++) crumbs.push(crumb(x, y));
    schedule();
  });

  function crumb(x, y) {
    return { x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 20, vy: 20 + Math.random() * 25, age: 0 };
  }

  function drawCrumbs(dt) {
    for (let i = crumbs.length - 1; i >= 0; i--) {
      const c = crumbs[i];
      c.age += dt;
      c.y += c.vy * dt;
      c.x += Math.sin(c.age * 3 + i) * 6 * dt;
      if (c.age > 14 || c.y > height + 10) { crumbs.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(214, 160, 92, 0.85)';
      ctx.fill();
    }
  }

  // Pets

  class PetFish {
    constructor(data) {
      this.update(data);
      this.x = width * (0.2 + Math.random() * 0.6);
      this.y = height * (0.35 + Math.random() * 0.4);
      this.vx = (Math.random() - 0.5) * 40;
      this.vy = 0;
      this.goal = this.wander();
      this.fear = 0;
      this.joy = 0;
      this.phase = Math.random() * 10;
    }
    update(data) {
      this.id = data.id;
      this.name = String(data.name || '').slice(0, 24);
      this.color = /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#ff8a3d';
      this.scale = petScale(data.meals);
      const fed = Date.parse(data.lastFed);
      this.sulking = Number.isFinite(fed) && Date.now() - fed > SULK_AFTER_MS;
    }
    wander() {
      return { x: width * (0.1 + Math.random() * 0.8), y: height * (0.25 + Math.random() * 0.6) };
    }
    startle(x, y) {
      const dx = this.x - x, dy = this.y - y, d = Math.hypot(dx, dy);
      if (d > Math.max(width, height) * 0.3) return;
      const push = 520 * (1 - d / (Math.max(width, height) * 0.3)) + 120;
      this.vx += (dx / (d || 1)) * push;
      this.vy += (dy / (d || 1)) * push;
      this.fear = 1.6;
    }
    step(dt) {
      const speed = (this.sulking ? 0.4 : 1) * 70 * this.scale;
      // Food first: the nearest crumb, if one is close.
      let food = null, best = 380;
      for (const c of crumbs) {
        const d = Math.hypot(c.x - this.x, c.y - this.y);
        if (d < best) { best = d; food = c; }
      }
      const goal = food || this.goal;
      if (!food && Math.hypot(goal.x - this.x, goal.y - this.y) < 30) this.goal = this.wander();
      const dx = goal.x - this.x, dy = goal.y - this.y, d = Math.hypot(dx, dy) || 1;
      const pull = this.fear > 0 ? 0.2 : 1;
      this.vx += (dx / d) * speed * 1.6 * pull * dt;
      this.vy += (dy / d) * speed * 1.6 * pull * dt;
      const v = Math.hypot(this.vx, this.vy), cap = speed * (this.fear > 0 ? 4 : food ? 1.7 : 1);
      if (v > cap) { this.vx *= cap / v; this.vy *= cap / v; }
      this.vx *= 1 - 0.4 * dt;
      this.vy *= 1 - 0.8 * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.x = Math.min(width - 20, Math.max(20, this.x));
      this.y = Math.min(height - 20, Math.max(height * 0.12, this.y));
      this.fear = Math.max(0, this.fear - dt);
      this.joy = Math.max(0, this.joy - dt);
      if (food && best < 10 * this.scale) {
        crumbs.splice(crumbs.indexOf(food), 1);
        this.joy = 1.2;
      }
      this.phase += dt * (3 + Math.hypot(this.vx, this.vy) / 30) * (this.joy > 0 ? 2.5 : 1);
    }
    draw(time) {
      const size = 22 * this.scale;
      const facing = this.vx >= 0 ? 1 : -1;
      const tilt = Math.max(-0.5, Math.min(0.5, this.vy / (Math.abs(this.vx) + 40)));
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(facing, 1);
      ctx.rotate(tilt * facing);
      if (this.sulking) ctx.filter = 'grayscale(0.75) brightness(0.8)';
      const wag = Math.sin(this.phase) * 0.35;
      // Tail
      ctx.beginPath();
      ctx.moveTo(-size * 0.8, 0);
      ctx.quadraticCurveTo(-size * 1.25, -size * (0.55 + wag), -size * 1.55, -size * (0.5 + wag));
      ctx.quadraticCurveTo(-size * 1.3, 0, -size * 1.55, size * (0.5 - wag));
      ctx.quadraticCurveTo(-size * 1.25, size * (0.55 - wag), -size * 0.8, 0);
      ctx.fillStyle = shade(this.color, -0.15, 0.85);
      ctx.fill();
      // Body
      const body = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
      body.addColorStop(0, shade(this.color, 0.25, 1));
      body.addColorStop(0.55, this.color);
      body.addColorStop(1, shade(this.color, -0.35, 1));
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.48, 0, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      // Fin
      ctx.beginPath();
      ctx.moveTo(-size * 0.1, -size * 0.42);
      ctx.quadraticCurveTo(-size * 0.35, -size * (0.9 + wag * 0.3), -size * 0.6, -size * 0.35);
      ctx.fillStyle = shade(this.color, 0.1, 0.7);
      ctx.fill();
      // Eye
      ctx.beginPath();
      ctx.arc(size * 0.6, -size * 0.08, size * 0.09, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0b0f';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(size * 0.63, -size * 0.11, size * 0.03, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();

      // Name, and a little cloud when it is sulking.
      ctx.save();
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      const label = this.joy > 0 ? `${this.name} ♥` : this.name;
      ctx.strokeText(label, this.x, this.y + size * 0.9 + 12);
      ctx.fillText(label, this.x, this.y + size * 0.9 + 12);
      if (this.sulking) {
        const cy = this.y - size - 10 + Math.sin(time * 1.5) * 2;
        ctx.fillStyle = 'rgba(200, 205, 215, 0.8)';
        for (const [ox, r] of [[-8, 6], [0, 8], [8, 6]]) {
          ctx.beginPath();
          ctx.arc(this.x + ox, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(40, 45, 60, 0.9)';
        ctx.font = '700 9px "Segoe UI", system-ui, sans-serif';
        ctx.fillText('z z', this.x, cy + 3);
      }
      ctx.restore();
    }
  }

  function drawPets(dt, time) {
    for (const pet of pets) { pet.step(dt); pet.draw(time); }
  }

  window.scenePets = (list) => {
    if (!WATER.has(world) || !Array.isArray(list)) { pets = []; return; }
    const byId = new Map(pets.map((p) => [p.id, p]));
    pets = list.slice(0, 6).map((data) => {
      const pet = byId.get(data.id);
      if (pet) { pet.update(data); return pet; }
      return new PetFish(data);
    });
    schedule();
  };

  // Light that follows the clock

  function light() {
    if (!followClock || ALWAYS_NIGHT.has(world)) {
      tint.style.backgroundColor = 'transparent';
      return;
    }
    const night = nightness(), warm = warmth();
    // Multiply: white leaves the scene alone; cool blue darkens it toward moonlight.
    const r = Math.round(255 - night * 150 - warm * 10);
    const g = Math.round(255 - night * 125 - warm * 45);
    const b = Math.round(255 - night * 60 - warm * 95);
    tint.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
  }

  window.sceneClock = (follow) => {
    followClock = follow !== false;
    light();
  };
  setInterval(light, 60 * 1000);

  // State the host sent before this module finished loading.
  const early = window.__livingpanes;
  if (early) {
    window.sceneClock(early.followClock);
    window.scenePets(early.pets);
  } else {
    light();
  }
}

function shade(hex, amount, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgba(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)}, ${alpha})`;
}

/** Calls `after` whenever the host calls window[name], whether the world defines it now or later. */
function wrap(name, after) {
  let inner = window[name];
  const outer = (...args) => {
    const result = typeof inner === 'function' ? inner(...args) : undefined;
    try { after(...args); } catch (error) { console.warn(`extras ${name}:`, error); }
    return result;
  };
  Object.defineProperty(window, name, {
    configurable: true,
    get: () => outer,
    set: (fn) => { inner = fn; },
  });
}

/** Notices a later assignment to window[name] without replacing what we put there. */
function watchAssign(name, seen) {
  const ours = window[name];
  Object.defineProperty(window, name, {
    configurable: true,
    get: () => ours,
    set: (fn) => { if (fn !== ours) seen(fn); },
  });
}
