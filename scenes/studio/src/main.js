import * as THREE from 'three';
import { QUALITY_PRESETS as presets, activeQuality, frameRate, framebufferSize, renderScale } from '../../shared/render-policy.js';
import { preferredQuality } from '../../shared/controls.js';
import { createFrameLoop } from '../../shared/frame-loop.js';
import { randomGenerator } from '../../shared/random.js';
import { normalize, validate } from './recipe.js';
import { lightFor, cleanPets } from './behavior.js';
import { sharedUniforms } from './gl.js';
import { createRecipeScene } from './scene.js';
import { createCodeScene } from './code.js';

const canvas = document.querySelector('#scene'), stage = document.querySelector('#stage'), loading = document.querySelector('#loading');
const params = new URLSearchParams(location.search);
const preview = params.get('preview') === '1';
const hosted = Boolean(window.webkit?.messageHandlers?.ready) && !preview;
const quality = preferredQuality(params);
const ID = /^[a-z0-9-]{1,64}$/, DRAFT = /^[a-z0-9_-]{1,64}$/;

let hostRate = hosted ? 0 : 60, onBattery = false, followClock = params.get('clock') !== '0';
let pets = [], current = null, loop = null, contextLost = false, zeroSize = false, failed = false;
let changeRate = () => {};

// Hooks first, before anything async, so a host call during start-up is never lost.
window.sceneHandlesExtras = true;
window.sceneRate = (fps) => { if (!Number.isFinite(fps)) return; const next = Math.max(0, Math.min(60, fps)); if (next === hostRate) return; hostRate = next; changeRate(); };
window.scenePower = (battery) => { const next = Boolean(battery); if (next === onBattery) return; onBattery = next; resize(); changeRate(); };
window.sceneFeed = () => { current?.feed(); loop?.invalidate(); };
window.sceneFeedAt = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) current?.feedAt(x, y); else current?.feed(); loop?.invalidate(); };
window.sceneTap = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) current?.tap(x, y); loop?.invalidate(); };
window.scenePets = (list) => { pets = cleanPets(list); current?.pets(pets); loop?.invalidate(); };
window.sceneClock = (follow) => { followClock = Boolean(follow); updateLight(true); loop?.invalidate(); };
// The host may have sent pets and the clock setting before this module loaded.
try {
  const early = window.__livingpanes;
  if (early && typeof early === 'object') {
    if (Array.isArray(early.pets)) pets = cleanPets(early.pets);
    if (typeof early.followClock === 'boolean') followClock = early.followClock;
  }
} catch {}

function showError(message) {
  failed = true;
  console.error(message);
  loading.hidden = true;
  const box = document.querySelector('#error');
  box.hidden = false;
  box.replaceChildren(document.createTextNode(`This scene could not start. ${message instanceof Error ? message.message : String(message)} `));
  if (!preview) {
    const reload = document.createElement('a');
    reload.href = location.href;
    reload.textContent = 'Reload';
    box.append(reload);
  }
  loop?.setHidden(true);
}
function clearError() { failed = false; const box = document.querySelector('#error'); box.hidden = true; box.replaceChildren(); }

// Where the recipe comes from, and the folder its assets live in.
function source() {
  const id = params.get('scene'), example = params.get('example'), draft = params.get('draft');
  if (id !== null) { if (!ID.test(id)) throw new Error('Unknown scene id.'); return new URL(`/user/${id}/`, location.href); }
  if (draft !== null) { if (!DRAFT.test(draft)) throw new Error('Unknown draft id.'); return new URL(`/user/_drafts/${draft}/`, location.href); }
  const name = example ?? 'moonlit-lagoon';
  if (!ID.test(name)) throw new Error('Unknown example.');
  return new URL(`./examples/${name}/`, location.href);
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 1);
const shared = sharedUniforms();
let width = 1, height = 1, ratio = 1, autoScale = 1;

// Light: the clock (or the recipe's fixed mood), eased so a change never snaps.
const light = { night: 0, warm: 0, target: { night: 0, warm: 0 }, checked: -1 };
function clockDate() {
  const d = new Date();
  const hour = Number(params.get('hour'));
  if (params.has('hour') && Number.isFinite(hour)) d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d;
}
function updateLight(snap = false) {
  if (!current) return;
  light.target = lightFor(current.recipe.light, followClock, clockDate());
  if (snap) { light.night = light.target.night; light.warm = light.target.warm; }
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  zeroSize = !(w > 0 && h > 0);
  if (zeroSize) { loop?.setHidden(true); return; }
  width = w; height = h;
  const preset = presets[activeQuality(quality, onBattery)];
  const scale = renderScale(quality, devicePixelRatio, onBattery) * autoScale;
  const fb = framebufferSize(w, h, scale, renderer.capabilities.maxTextureSize, preset.pixels);
  ratio = fb.width / w;
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  shared.uSize.value.set(w, h);
  current?.resize(w, h);
  loop?.setHidden(hidden());
  loop?.invalidate();
}
const hidden = () => document.hidden || contextLost || zeroSize || failed;

let cpuEMA = 0, slowSamples = 0, time = 0;
const fps = () => frameRate(quality, hostRate, onBattery);
function draw(dt) {
  if (!current || contextLost || failed) return;
  const before = performance.now();
  time += dt;
  shared.uTime.value = time;
  if (time - light.checked > 1 || light.checked < 0) { updateLight(light.checked < 0); light.checked = time; }
  const ease = Math.min(1, dt * 0.8);
  light.night += (light.target.night - light.night) * ease;
  light.warm += (light.target.warm - light.warm) * ease;
  shared.uNight.value = light.night;
  shared.uWarm.value = light.warm;
  try { current.frame(dt, light.night); } catch (error) { showError(error); return; }
  if (!loading.hidden) loading.hidden = true;
  if (!(dt > 0)) return;
  // A conservative one-way resolution downshift under sustained pressure, as upstream.
  const cost = performance.now() - before;
  cpuEMA = cpuEMA ? cpuEMA * 0.96 + cost * 0.04 : cost;
  if (cpuEMA > (1000 / fps()) * 0.85 || dt > 1.65 / fps()) slowSamples++; else slowSamples = Math.max(0, slowSamples - 1);
  if (slowSamples > 90 && autoScale > 0.72 && !params.has('capture')) { autoScale = Math.max(0.72, autoScale - 0.1); slowSamples = 0; resize(); }
}

const pointer = { x: 0, y: 0, inside: false };
function local(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
canvas.addEventListener('pointermove', (event) => {
  const p = local(event);
  pointer.x = p.x; pointer.y = p.y; pointer.inside = true;
  current?.pointer(p.x, p.y);
}, { passive: true });
canvas.addEventListener('pointerleave', () => { pointer.inside = false; current?.pointer(null, null); });
// A real mouse in a browser: click feeds, Shift+click taps the glass.
canvas.addEventListener('click', (event) => {
  if (hosted || !current) return;
  const p = local(event);
  if (event.shiftKey) current.tap(p.x, p.y); else current.feedAt(p.x, p.y);
  loop?.invalidate();
});

let generation = 0;
async function build(input, base) {
  const mine = ++generation;
  const recipe = normalize(input);
  const problems = validate(input);
  if (problems.length) console.warn(`Recipe problems (drawn anyway, with safe values):\n- ${problems.join('\n- ')}`);
  const old = current;
  current = null;
  try { old?.dispose(); } catch (error) { console.warn(error); }
  clearError();
  const random = randomGenerator(params.has('capture') ? Number(params.get('seed')) || 1 : Math.floor(Math.random() * 2 ** 31));
  let next;
  if (recipe.mode === 'code') {
    next = await createCodeScene({
      recipe, base, renderer, canvas, pointer, shared, size: () => ({ width, height, pixelRatio: ratio }),
      night: () => light.night, onError: showError, bust: preview ? mine : 0,
    });
  } else {
    next = createRecipeScene({ recipe, renderer, shared, base, stage, width, height, random });
    next.ready?.catch((error) => console.warn(`Backdrop image: ${error.message} Using the gradient.`));
  }
  if (mine !== generation) { next.dispose(); return; }
  next.recipe = recipe;
  current = next;
  current.resize(width, height);
  current.pets(pets);
  if (pointer.inside) current.pointer(pointer.x, pointer.y);
  updateLight(true);
  light.checked = time;
  loop.setHidden(hidden());
  loop.invalidate();
  next.ready?.then(() => { if (current === next) { current.resize(width, height); loop.invalidate(); } }, () => {});
}

async function start() {
  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  resize();
  loop = createFrameLoop(draw, { fps: fps(), hidden: hidden() });
  changeRate = () => { loop.setRate(fps()); loop.setHidden(hidden()); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) current?.pointer(null, null); loop.setHidden(hidden()); });
  canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); contextLost = true; loop.setHidden(true); loading.hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; resize(); loop.setHidden(hidden()); loop.invalidate(); });
  if (navigator.getBattery && !hosted) {
    navigator.getBattery().then((battery) => {
      const update = () => { onBattery = !battery.charging; resize(); changeRate(); };
      battery.addEventListener('chargingchange', update); update();
    }).catch(() => {});
  }

  window.studioEngine = { get scene() { return current; }, renderer };
  window.sceneStats = () => ({
    ...(current?.diagnostics?.() || {}), mode: current?.recipe?.mode, pixels: [canvas.width, canvas.height], quality,
    effectiveFPS: loop.state.running ? fps() : 0, renderScale: ratio, cpuFrameEMA: cpuEMA, hostRate, hosted, preview,
    night: light.night, warm: light.warm, contextLost,
  });

  if (preview) {
    // The Studio sends recipes as the user edits; coalesce bursts into one rebuild.
    let pending = null, timer = null;
    addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.type !== 'deskworlds:recipe') return;
      let base;
      try { base = new URL(typeof data.base === 'string' && data.base ? data.base : './examples/', location.href); } catch { return; }
      if (base.host !== location.host) return; // assets only from this app
      if (!base.pathname.endsWith('/')) base = new URL(base.pathname + '/', base);
      pending = { recipe: data.recipe, base };
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const { recipe, base: b } = pending;
        build(recipe, b).catch(showError);
      }, 40);
    });
    loading.hidden = true;
    window.parent?.postMessage({ type: 'deskworlds:preview-ready' }, '*');
    return;
  }

  const base = source();
  const response = await fetch(new URL('recipe.json', base));
  if (!response.ok) throw new Error(`No recipe at ${base.pathname} (${response.status}).`);
  let input;
  try { input = await response.json(); } catch { throw new Error('The recipe is not valid JSON.'); }
  await build(input, base);
}
start().catch(showError);
