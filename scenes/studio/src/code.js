import * as THREE from 'three';

// Code mode: scene.js from the scene folder default-exports create(ctx). The engine keeps
// the frame loop, rate, power profile and hooks; the code only draws. See ../README.md.
export async function createCodeScene({ recipe, base, renderer, canvas, pointer, size, night, onError, bust = 0 }) {
  const handlers = { frame: [], resize: [], feed: [], tap: [], pets: [] };
  const add = (list) => (fn) => {
    if (typeof fn !== 'function') throw new TypeError('Expected a function.');
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  };
  let broken = false;
  const call = (list, ...args) => {
    if (broken) return;
    for (const fn of list.slice()) {
      try { fn(...args); } catch (error) { broken = true; onError(error); return; }
    }
  };
  const ctx = Object.freeze({
    THREE, canvas, renderer,
    size: () => ({ ...size() }),
    pointer,
    night: () => night(),
    recipe: structuredClone(recipe),
    onFrame: add(handlers.frame), onResize: add(handlers.resize), onFeed: add(handlers.feed),
    onTap: add(handlers.tap), onPets: add(handlers.pets),
  });

  const url = new URL('scene.js', base);
  if (bust) url.searchParams.set('v', String(bust));
  let module, instance;
  try {
    module = await import(url.href);
    if (typeof module.default !== 'function') throw new Error('scene.js must default-export create(ctx).');
    instance = await module.default(ctx);
  } catch (error) {
    onError(error);
    broken = true;
  }
  renderer.setAnimationLoop(null); // the engine owns the loop
  let time = 0;
  const center = () => { const s = size(); return [s.width / 2, s.height * 0.3]; };
  return {
    ready: null,
    frame(dt) { time += dt; call(handlers.frame, dt, time); },
    resize(w, h) { call(handlers.resize, w, h); },
    pointer() {}, // ctx.pointer is live
    feedAt(x, y) { call(handlers.feed, x, y); },
    feed() { call(handlers.feed, ...center()); },
    tap(x, y) { call(handlers.tap, x, y); },
    pets(list) { call(handlers.pets, list.map((p) => ({ ...p }))); },
    diagnostics: () => ({ code: true, broken, drawCalls: renderer.info.render.calls }),
    dispose() {
      broken = true;
      try { instance?.dispose?.(); } catch (error) { console.warn(error); }
      renderer.setAnimationLoop(null);
      for (const list of Object.values(handlers)) list.length = 0;
    },
  };
}
