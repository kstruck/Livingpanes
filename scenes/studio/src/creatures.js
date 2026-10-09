import * as THREE from 'three';
import { COMMON, OUT, blended, instancedQuad, instanceAttribute } from './gl.js';

// One instanced mesh (one draw call) per creature kind, pets included. Every body is
// drawn procedurally in its fragment shader: no image assets.
export const KIND_IDS = Object.freeze({ fish: 0, angelfish: 1, koi: 2, jellyfish: 3, firefly: 4, bird: 5, butterfly: 6 });
// The quad around a body, in body lengths: [xmin, xmax, ymin, ymax]; +x is the nose.
const EXTENT = {
  fish: [-0.6, 0.55, -0.3, 0.3], angelfish: [-0.56, 0.46, -0.64, 0.64], koi: [-0.62, 0.56, -0.3, 0.3],
  jellyfish: [-0.4, 0.4, -1.05, 0.42], firefly: [-1.7, 1.7, -1.7, 1.7], bird: [-0.56, 0.56, -0.36, 0.5], butterfly: [-0.42, 0.4, -0.5, 0.5],
};
const ORDER = { jellyfish: 10, koi: 11, fish: 12, angelfish: 13, butterfly: 14, bird: 15, firefly: 16 };
const SIDE_VIEW = new Set(['fish', 'angelfish']);
const BEND = { fish: 0.035, angelfish: 0.02, koi: 0.075, jellyfish: 0, firefly: 0, bird: 0, butterfly: 0 };

const vertex = /* glsl */ `
${COMMON}
attribute vec4 aPos;   // x, y (CSS px, y down), display angle, mirror
attribute vec4 aMeta;  // length px, phase, glow, eat wiggle
attribute vec4 aState; // desaturate, seed, speed (lengths/s), fear
attribute vec3 aColA, aColB, aColC;
uniform vec4 uExtent;
uniform float uBend, uPad;
varying vec2 vL, vShadow, vQuad;
varying vec3 vColA, vColB, vColC;
varying vec4 vMeta, vState;

void main() {
  vQuad = position.xy;
  vec4 e = uExtent + vec4(-uPad, uPad, -uPad, uPad);
  vec2 l = vec2(mix(e.x, e.y, position.x + .5), mix(e.z, e.w, position.y + .5));
  vL = l;
  // Swimmers bend: a travelling wave that grows toward the tail, stronger after a meal.
  float amp = uBend * (1. + aMeta.w * 2.5) * (.7 + .3 * min(2.5, aState.z) / 2.5);
  float tail = pow(clamp((.28 - l.x) / .85, 0., 1.), 1.5);
  vec2 body = l;
  body.y += amp * sin(aMeta.y - l.x * 6.) * tail - amp * .25 * sin(aMeta.y) * (1. - tail);
  float L = aMeta.x;
  float c = cos(aPos.z), s = sin(aPos.z);
  vec2 f = vec2(c, s), n = vec2(s, -c);    // forward and "up" in y-down screen space
  vec2 off = (body.x * aPos.w) * f + body.y * n;
  vec2 world = aPos.xy + off * L;
  // Koi cast a soft shadow on the pond floor, offset down and to the right on screen.
  vec2 sh = vec2(.035, .06);
  vShadow = vec2(dot(sh, f) * aPos.w, dot(sh, n));
  vColA = aColA; vColB = aColB; vColC = aColC; vMeta = aMeta; vState = aState;
  gl_Position = vec4(world.x / uSize.x * 2. - 1., 1. - world.y / uSize.y * 2., 0., 1.);
}
`;

const fragment = /* glsl */ `
${COMMON}${OUT}
#define KIND ${'${KIND}'}
uniform float uGlowBoost;
varying vec2 vL, vShadow, vQuad;
varying vec3 vColA, vColB, vColC;
varying vec4 vMeta, vState;

float cover(float d, float aa) { return 1. - smoothstep(-aa, aa, d); }
float sdEll(vec2 p, vec2 r) { return (length(p / r) - 1.) * min(r.x, r.y); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2, v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0., 1.);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0., 1.);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// Premultiplied "over" in linear light.
void over(inout vec3 c, inout float a, vec3 col, float alpha) { c = col * alpha + c * (1. - alpha); a = alpha + a * (1. - alpha); }

#if KIND == 0 || KIND == 2
float fishHalf(float x, float front, float neck, float tailX) {
  return x > .05 ? front * sqrt(max(0., 1. - pow((x - .05) / .47, 2.))) : mix(neck, front, smoothstep(tailX, .05, x));
}
#endif

void main() {
  vec2 q = vL;
  float aa = max(fwidth(q.x), fwidth(q.y)) * 1.1;
  float phase = vMeta.y, seed = vState.y;
  vec3 A = vColA, B = vColB, C = vColC;
  vec3 c = vec3(0.); float a = 0.;
  float dist = 1.;      // signed distance to the silhouette, for glow
  vec3 emit = vec3(0.); // self light (fireflies, jellies)

#if KIND == 0 // fish, side view
  float x = q.x;
  float h = fishHalf(x, .15, .03, -.37);
  float dBody = max(abs(q.y + .005) - h, max(x - .52, -.4 - x));
  float tx = (-.34 - x) / .22;
  float tw = .03 + .17 * clamp(tx, 0., 1.);
  float dTail = max(max(abs(q.y) - tw, max(-tx, tx - 1.)), .13 * smoothstep(.5, 1., tx) - abs(q.y));
  float hTop = fishHalf(clamp(x, -.4, .5), .15, .03, -.37);
  float dDorsal = max(q.y - hTop - .085 * smoothstep(-.16, -.02, x) * smoothstep(.2, .02, x) * (1. - .4 * smoothstep(-.05, .15, x)), max(hTop - .03 - q.y, max(-.17 - x, x - .2)));
  float dAnal = max(-q.y - hTop - .05 * smoothstep(-.3, -.2, x) * smoothstep(-.04, -.16, x), max(q.y + hTop - .03, max(-.31 - x, x + .04)));
  vec2 pp = rot(q - vec2(.16, -.045), -.35 - .3 * sin(phase * 1.3));
  float dPec = sdEll(pp - vec2(-.05, 0.), vec2(.075, .026));
  float fins = cover(min(dTail, min(dDorsal, dAnal)), aa);
  float body = cover(dBody, aa);
  float k = clamp(q.y / max(h, .02) * .5 + .5, 0., 1.);
  vec3 belly = mix(A, vec3(1.), .35);
  vec3 col = mix(belly, A, smoothstep(.05, .45, k));
  col = mix(col, B, smoothstep(.55, .97, k));
  col *= .92 + .1 * vnoise(q * vec2(70., 55.) + seed * 50.);
  col += .1 * smoothstep(.8, .98, k) * (1. - smoothstep(.98, 1., k));
  col *= mix(.78, 1., smoothstep(-.42, .05, x));
  col = mix(col, B * .7, smoothstep(.006, .0, abs(q.y - .01 - .01 * sin(x * 8.))) * smoothstep(-.3, .0, x) * smoothstep(.36, .2, x) * .35);
  float gill = smoothstep(.007, .0, abs(length((q - vec2(.42, -.01)) * vec2(1., .7)) - .12)) * step(abs(q.y), h * .8) * step(x, .34);
  col *= 1. - gill * .25;
  vec2 ep = q - vec2(.375, .035);
  col = mix(col, vec3(.015), smoothstep(.031, .022, length(ep)));
  col = mix(col, vec3(1.), smoothstep(.011, .004, length(ep - vec2(.008, .009))));
  vec3 finCol = mix(mix(C, A, .4), B, .25) * (.85 + .15 * sin(atan(q.y, q.x + .2) * 60.));
  over(c, a, finCol, fins * .78);
  over(c, a, col, body);
  over(c, a, mix(finCol, vec3(1.), .2), cover(dPec, aa) * .55);
  dist = min(dBody, min(dTail, min(dDorsal, dAnal)));

#elif KIND == 1 // angelfish, side view
  vec2 bq = q - vec2(.05, 0.);
  float dBody = (pow(pow(abs(bq.x) / .3, 1.9) + pow(abs(bq.y) / .27, 1.9), 1. / 1.9) - 1.) * .27;
  dBody = max(dBody, -.25 - q.x);
  float sweep = .03 * sin(phase * .8);
  float dDorsal = sdTri(q, vec2(.12, .2), vec2(-.16, .25), vec2(-.44 + sweep, .6));
  float dAnal = sdTri(q, vec2(.1, -.2), vec2(-.16, -.25), vec2(-.42 + sweep, -.58));
  float dTail = max(sdTri(q, vec2(-.24, 0.), vec2(-.52, .17), vec2(-.52, -.17)), .08 - length(q - vec2(-.62, 0.)) + .0);
  float dFil = sdSeg(q, vec2(.08, -.2), vec2(-.04 + .03 * sin(phase), -.6)) - .006;
  float fins = cover(min(min(dDorsal, dAnal), dTail) - .004, aa);
  float body = cover(dBody, aa);
  float sx = q.x + q.y * .12;
  float stripes = max(max(smoothstep(.04, .025, abs(sx - .2)), smoothstep(.05, .032, abs(sx + .02))), smoothstep(.045, .03, abs(sx + .24)));
  vec3 col = mix(A, vec3(1.), .1 * (1. - abs(q.y) / .27));
  col = mix(col, C, smoothstep(.05, .3, q.x) * .55);
  col *= .9 + .12 * vnoise(q * 80. + seed * 30.);
  col = mix(col, B, stripes * .9);
  col *= .85 + .2 * smoothstep(-.27, .27, q.y);
  vec2 ep = q - vec2(.24, .06);
  col = mix(col, vec3(.6, .1, .06), smoothstep(.034, .026, length(ep)));
  col = mix(col, vec3(.01), smoothstep(.018, .012, length(ep)));
  col = mix(col, vec3(1.), smoothstep(.009, .003, length(ep - vec2(.006, .007))));
  vec3 finCol = mix(mix(A, C, .25), B, stripes * .6 + .2) * .9;
  over(c, a, finCol, fins * .78);
  over(c, a, B, cover(dFil, aa) * .7);
  over(c, a, col, body);
  dist = min(dBody, min(min(dDorsal, dAnal), dTail));

#elif KIND == 2 // koi, from above
  float x = q.x;
  float w = fishHalf(x, .105, .022, -.36);
  float dBody = max(abs(q.y) - w, max(x - .54, -.38 - x));
  float tx = (-.32 - x) / .28;
  float wave = 1. + .14 * sin(tx * 8. - phase * 1.4 + q.y * 20.);
  float tw = (.022 + .15 * pow(clamp(tx, 0., 1.), .8)) * wave;
  float dTail = max(max(abs(q.y) - tw, max(-tx, tx - 1.)), .05 * smoothstep(.6, 1., tx) - abs(q.y));
  float flap = .55 + .25 * sin(phase * 1.2);
  vec2 pl = rot(q - vec2(.2, .095), flap);
  vec2 pr = rot(q - vec2(.2, -.095), -flap);
  float dPec = min(sdEll(pl - vec2(-.04, .02), vec2(.07, .035)), sdEll(pr - vec2(-.04, -.02), vec2(.07, .035)));
  // shadow first, on the floor
  vec2 sq = q - vShadow;
  float sw = fishHalf(sq.x, .105, .022, -.36);
  float dShadow = max(abs(sq.y) - sw, max(sq.x - .54, -.5 - sq.x));
  over(c, a, vec3(0.), (1. - smoothstep(-.04, .05, dShadow)) * .28 * (1. - .6 * uNight));
  float yn = q.y / max(w, .01);
  float n1 = vnoise(q * vec2(7., 11.) + seed * 37.) * .65 + vnoise(q * vec2(15., 22.) + seed * 13.) * .35;
  float spotMix = smoothstep(.5, .56, n1 + .1 * smoothstep(.2, .45, x) * step(.5, fract(seed * 7.)));
  float sumi = smoothstep(.8, .85, vnoise(q * vec2(16., 24.) + seed * 91.)) * step(.45, fract(seed * 3.));
  vec3 col = mix(A, B, spotMix);
  col = mix(col, C, sumi);
  col *= .74 + .3 * sqrt(max(0., 1. - yn * yn));
  col += .07 * smoothstep(.35, .0, abs(yn)) * smoothstep(-.3, .2, x);
  col *= .95 + .08 * vnoise(q * 90.);
  col = mix(col, vec3(.02), smoothstep(.016, .01, length(vec2(q.x - .43, abs(q.y) - .058))));
  vec3 finCol = mix(A, B, spotMix * .5) * 1.05;
  over(c, a, finCol, cover(dTail, aa) * (.42 + .25 * (1. - clamp(tx, 0., 1.))));
  over(c, a, finCol, cover(dPec, aa) * .45);
  over(c, a, col, cover(dBody, aa));
  dist = min(dBody, min(dTail, dPec));

#elif KIND == 3 // jellyfish, bell up
  float p = .5 + .5 * sin(phase);
  float bw = .3 * (1. - .13 * p), bh = .25 * (1. + .1 * p);
  vec2 bq = q - vec2(0., .08);
  float e = length(vec2(bq.x / bw, bq.y / bh));
  float rimY = -.02 + .018 * sin(q.x / bw * 9.) * smoothstep(.0, .9, abs(q.x) / bw);
  float dBell = max((e - 1.) * bh, rimY - bq.y);
  float bell = cover(dBell, aa);
  float fres = smoothstep(.35, 1., e);
  vec3 bellCol = mix(A, B, smoothstep(.2, 1., e) * .4);
  float organs = smoothstep(.025, .0, abs(length(vec2(q.x * 1.15, (q.y - .12) * 1.7)) - .085)) * smoothstep(-.02, .06, bq.y);
  // tentacles: thin, trailing, waving with the pulse
  float tent = 0.;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float x0 = (fi / 6. - .5) * bw * 1.7;
    float len = .65 + .3 * fract(sin(fi * 12.9 + seed * 7.) * 43758.5);
    float y = q.y - .06;
    float along = clamp(-y / len, 0., 1.);
    float xc = x0 * (1. - .35 * along) + sin(-y * 11. + phase * 1.2 + fi * 1.7) * .04 * along;
    float d = abs(q.x - xc) - .006 * (1. - along * .6);
    tent = max(tent, cover(d, aa) * step(y, 0.) * (1. - along) * step(-len, y));
  }
  float arms = 0.;
  for (int i = 0; i < 3; i++) {
    float fi = float(i) - 1.;
    float y = q.y - .05;
    float along = clamp(-y / .55, 0., 1.);
    float xc = fi * .05 * (1. - along) + sin(-y * 8. + phase + fi * 2.) * .035 * along;
    float d = abs(q.x - xc) - (.022 + .01 * sin(-y * 40. + fi)) * (1. - along * .7);
    arms = max(arms, cover(d, aa) * step(y, 0.) * step(-.55, y) * (1. - along * .8));
  }
  over(c, a, mix(A, B, .5), tent * .45);
  over(c, a, mix(A, B, .3) * 1.1, arms * .4);
  over(c, a, bellCol, bell * (.22 + .5 * fres));
  over(c, a, B * 1.2, bell * organs * .45);
  emit = (A * bell * (.12 + .5 * fres) + B * (tent * .25 + arms * .15)) * (.35 + .65 * uNight);
  dist = dBell;

#elif KIND == 4 // firefly: a small dark body under a pulsing lantern
  float r = length(q);
  float blink = .12 + .88 * pow(.5 + .5 * sin(uTime * (1.1 + seed * .9) + seed * 40.), 3.);
  float bodyA = cover(sdEll(q - vec2(-.05, 0.), vec2(.22, .1)), aa);
  over(c, a, vec3(.03, .025, .02), bodyA * .8);
  float edge = smoothstep(1.7, 1.2, r);
  emit = A * (smoothstep(.22, .0, length(q - vec2(-.16, 0.))) * 2.4 + exp(-r * r * 7.) * .5 + exp(-r * 2.2) * .12 * edge) * blink * (.35 + .9 * uNight);
  dist = 1.;

#elif KIND == 5 // bird: a gull-like silhouette, wings flapping or gliding
  float glide = smoothstep(.2, .7, sin(uTime * .23 + seed * 20.));
  float f = mix(sin(phase), .15, glide * .85);
  float ax = abs(q.x);
  float s1 = .28 + .5 * f, s2 = -.28 + .95 * f;
  float yc = ax < .2 ? ax * s1 : .2 * s1 + (ax - .2) * s2;
  yc = mix(yc, .2 * s1 + (ax - .2) * s2, smoothstep(.15, .25, ax));
  float tk = mix(.05, .01, smoothstep(.0, .54, ax)) * (1. + .5 * smoothstep(.0, .05, yc - q.y) * step(ax, .3));
  float dWing = max(abs(q.y - yc) - tk, ax - .54);
  float dBody = sdEll(q - vec2(0., -.01), vec2(.05, .08));
  float sil = cover(min(dWing, dBody), aa);
  vec3 col = mix(A, A * 1.6 + .03, smoothstep(.0, .06, yc - q.y) * .4);
  over(c, a, col, sil);
  dist = min(dWing, dBody);

#elif KIND == 6 // butterfly, from above, wings opening and closing
  float fold = .18 + .82 * abs(cos(phase));
  vec2 wq = vec2(q.x, abs(q.y) / fold);
  vec2 f1 = rot(wq - vec2(.06, .2), .55);
  vec2 h1 = rot(wq - vec2(-.1, .16), -.35);
  float dFore = sdEll(f1, vec2(.15, .21)), dHind = sdEll(h1, vec2(.13, .15));
  float dw = min(dFore, dHind) * fold;
  float wing = cover(dw, aa);
  float border = smoothstep(-.035 * fold, -.015 * fold, dw);
  float spots = smoothstep(.022, .012, length(wq - vec2(.16, .33))) + smoothstep(.018, .01, length(wq - vec2(.09, .37))) + smoothstep(.016, .009, length(wq - vec2(-.15, .25)));
  float veins = smoothstep(.5, .95, abs(sin(atan(wq.y - .02, wq.x + .02) * 9.))) * .25;
  vec3 col = mix(C, A, smoothstep(.05, .22, length(wq - vec2(-.02, .0))));
  col *= 1. - veins;
  col = mix(col, B, border * .9);
  col = mix(col, vec3(1.), spots * border);
  col *= .7 + .3 * fold;
  float dBody = sdEll(q - vec2(.0, 0.), vec2(.2, .028));
  float dHead = length(q - vec2(.19, 0.)) - .032;
  float dAnt = min(sdSeg(q, vec2(.2, .012), vec2(.33, .08)), sdSeg(q, vec2(.2, -.012), vec2(.33, -.08))) - .005;
  float dKnob = min(length(q - vec2(.33, .08)), length(q - vec2(.33, -.08))) - .012;
  over(c, a, col, wing);
  over(c, a, B * .5, cover(min(min(dBody, dHead), min(dAnt, dKnob)), aa));
  dist = min(dw, dBody);
#endif

  // Sulking pets lose their colour.
  vec3 straight = c / max(a, 1e-4);
  straight = mix(straight, vec3(lum(straight)), vState.x * .8) * (1. - .18 * vState.x);
  vec3 lit = grade(straight);
  // Bioluminescence: a rim and a halo, brighter after dark.
  vec3 glow = emit * uGlowBoost;
  if (vMeta.z > .5) {
    float rim = a * (1. - smoothstep(.0, .045, -dist));
    float halo = exp(-max(dist, 0.) / .05) * (1. - a) * .5 * smoothstep(.5, .3, max(abs(vQuad.x), abs(vQuad.y)));
    vec3 gc = mix(A, vec3(1.), .25);
    glow += gc * (rim * .9 + halo + a * .18) * (.45 + 1.1 * uNight) * uGlowBoost;
  }
  if (a < .003 && max(glow.r, max(glow.g, glow.b)) < .003) discard;
  gl_FragColor = premul(lit, a, glow);
}
`;

function colorsFor(agent, spec) {
  const list = agent.pet ? [agent.pet.color] : spec.colors;
  const A = new THREE.Color(list[0]);
  let B = list[1] ? new THREE.Color(list[1]) : A.clone().multiplyScalar(0.4);
  let C = list[2] ? new THREE.Color(list[2]) : A.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
  if (agent.pet) { B = A.clone().multiplyScalar(0.38); C = A.clone().lerp(new THREE.Color(1, 1, 1), 0.5); }
  else if (list.length > 3 && agent.colorPick > 0.5) { C = new THREE.Color(list[3]); }
  // A little individual variation so a school is not a row of clones.
  const v = 0.9 + agent.seed * 0.2;
  A.multiplyScalar(v);
  if (agent.kind === 'koi' && !agent.pet && agent.colorPick < 0.18) B = A.clone().lerp(B, 0.2); // a plain one
  return { A, B, C };
}

export function createCreatures({ recipe, shared, world }) {
  const groups = new Map(); // kind -> mesh bundle
  const counts = {};
  for (const a of world.agents) counts[a.kind] = (counts[a.kind] || 0) + 1;
  const petKind = recipe.creatures[0]?.kind || 'fish';

  function bundle(kind, capacity) {
    const geometry = instancedQuad(kind === 'firefly' || kind === 'bird' || kind === 'butterfly' ? 1 : 24);
    const attrs = {
      pos: instanceAttribute(geometry, 'aPos', capacity, 4),
      meta: instanceAttribute(geometry, 'aMeta', capacity, 4),
      state: instanceAttribute(geometry, 'aState', capacity, 4),
      a: instanceAttribute(geometry, 'aColA', capacity, 3),
      b: instanceAttribute(geometry, 'aColB', capacity, 3),
      c: instanceAttribute(geometry, 'aColC', capacity, 3),
    };
    const glow = recipe.creatures.some((c) => c.kind === kind && c.glow);
    const uniforms = {
      ...shared,
      uExtent: { value: new THREE.Vector4(...EXTENT[kind]) }, uBend: { value: BEND[kind] },
      uPad: { value: glow ? 0.12 : 0.02 }, uGlowBoost: { value: 1 },
    };
    const material = blended(new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment.replaceAll('${KIND}', String(KIND_IDS[kind])), uniforms }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = ORDER[kind];
    return { kind, geometry, material, mesh, attrs, capacity, uniforms };
  }
  for (const kind of new Set([...recipe.creatures.map((c) => c.kind), petKind])) {
    groups.set(kind, bundle(kind, (counts[kind] || 0) + 14));
  }

  const specFor = (agent) => (agent.group >= 0 ? recipe.creatures[agent.group] : null);

  function update(dt, night) {
    for (const g of groups.values()) g.n = 0;
    for (const agent of world.agents) {
      const g = groups.get(agent.kind);
      if (!g || g.n >= g.capacity) continue;
      const i = g.n++;
      if (!agent.rc || agent.rcKey !== (agent.pet?.color ?? '')) { agent.rc = colorsFor(agent, specFor(agent) || recipe.creatures[0] || { colors: ['#ff8a3d'] }); agent.rcKey = agent.pet?.color ?? ''; }
      // Display orientation: side-view swimmers mirror rather than roll; others turn freely.
      let angle, mirror;
      const vx = agent.vx, vy = agent.vy, sp = Math.hypot(vx, vy);
      if (SIDE_VIEW.has(agent.kind)) {
        const sign = agent.sx >= 0 ? 1 : -1;
        const want = Math.max(-0.55, Math.min(0.55, Math.atan2(vy * sign, Math.abs(vx) + 1e-3)));
        agent.tilt = (agent.tilt ?? want) + (want - (agent.tilt ?? want)) * Math.min(1, dt * 4);
        angle = agent.tilt; mirror = agent.sx;
        if (Math.abs(mirror) < 0.08) mirror = mirror < 0 ? -0.08 : 0.08;
      } else if (agent.kind === 'jellyfish' || agent.kind === 'bird' || agent.kind === 'firefly') {
        const want = agent.kind === 'firefly' ? 0 : Math.max(-0.4, Math.min(0.4, (agent.kind === 'bird' ? vy : vx) / (sp + 1e-3) * 0.35));
        agent.tilt = (agent.tilt ?? want) + (want - (agent.tilt ?? want)) * Math.min(1, dt * 2);
        angle = agent.tilt; mirror = 1;
      } else { angle = agent.heading; mirror = 1; }
      g.attrs.pos.array.set([agent.x, agent.y, angle, mirror], i * 4);
      g.attrs.meta.array.set([agent.len, agent.phase, agent.glow ? 1 : 0, agent.pet && agent.eat > 0 ? Math.min(1, agent.eat) : 0], i * 4);
      g.attrs.state.array.set([agent.sulking ? 1 : 0, agent.seed, sp / Math.max(1, agent.len), agent.fear], i * 4);
      const { A, B, C } = agent.rc;
      g.attrs.a.array.set([A.r, A.g, A.b], i * 3);
      g.attrs.b.array.set([B.r, B.g, B.b], i * 3);
      g.attrs.c.array.set([C.r, C.g, C.b], i * 3);
    }
    for (const g of groups.values()) {
      g.geometry.instanceCount = g.n;
      g.mesh.visible = g.n > 0;
      g.uniforms.uGlowBoost.value = 0.6 + 0.6 * night;
      for (const key in g.attrs) {
        const attr = g.attrs[key];
        attr.clearUpdateRanges?.();
        attr.addUpdateRange?.(0, g.n * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
  }

  // Pets can outgrow a bundle sized for the scene's own cast.
  function ensureCapacity() {
    const need = {};
    for (const a of world.agents) need[a.kind] = (need[a.kind] || 0) + 1;
    const rebuilt = [];
    for (const [kind, g] of groups) {
      if ((need[kind] || 0) <= g.capacity) continue;
      g.geometry.dispose(); g.material.dispose();
      const next = bundle(kind, need[kind] + 8);
      groups.set(kind, next);
      rebuilt.push({ old: g.mesh, mesh: next.mesh });
    }
    return rebuilt;
  }

  return {
    get meshes() { return [...groups.values()].map((g) => g.mesh); },
    update, ensureCapacity, groups,
    dispose() { for (const g of groups.values()) { g.geometry.dispose(); g.material.dispose(); } },
  };
}

