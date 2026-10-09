import * as THREE from 'three';
import { COMMON, OUT, blended, instancedQuad, instanceAttribute, linearColor } from './gl.js';
import { randomGenerator } from '../../shared/random.js';

// Stateless GPU particles: every position is a function of time and a per-instance seed,
// so a frame costs one uniform write per system and nothing per particle on the CPU.
// max: particles at amount 1 on a 1920x1080 screen. back: drawn behind the creatures.
export const PARTICLE_KINDS = Object.freeze({
  bubbles: { id: 0, max: 140, back: false },
  dust: { id: 1, max: 320, back: true },
  snow: { id: 2, max: 700, back: false },
  rain: { id: 3, max: 900, back: false },
  fireflies: { id: 4, max: 110, back: false },
  embers: { id: 5, max: 220, back: false },
  petals: { id: 6, max: 90, back: false },
  stars: { id: 7, max: 600, back: true },
  plankton: { id: 8, max: 500, back: true },
});

export function particleCount(kind, amount, width, height) {
  const spec = PARTICLE_KINDS[kind];
  if (!spec) return 0;
  const area = Math.min(2.4, Math.max(0.35, (width * height) / (1920 * 1080)));
  return Math.round(spec.max * Math.min(1, Math.max(0, amount)) * area);
}

const vertex = /* glsl */ `
${COMMON}
#define KIND ${'${KIND}'}
attribute vec4 aSeed;
attribute vec4 aSeed2;
uniform float uSpeed, uScale, uWater;
varying vec2 vLocal;
varying float vAlpha, vBright, vVary;

vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
  float t = uTime * uSpeed;
  float u = min(uSize.x, uSize.y);
  float m = u * .08;                       // wrap margin, so nothing pops at an edge
  vec2 field = uSize + 2. * m;
  vec2 base = aSeed.xy * field - m;
  float near = aSeed.z;                    // 0 far .. 1 near: size, speed and focus
  float size = 1.;
  float angle = 0.;
  vec2 stretch = vec2(1.);
  vec2 pos = base;
  vAlpha = 1.; vBright = 1.; vVary = aSeed2.x;

#if KIND == 0 // bubbles: rise and wobble
  size = mix(.0025, .009, near * near) * u;
  pos.y = base.y - t * u * mix(.05, .16, near);
  pos.x += sin(t * mix(1.2, 2.6, aSeed2.y) + aSeed2.z * 6.28) * u * .006;
  vAlpha = mix(.35, .8, near);
#elif KIND == 1 // dust: motes hanging in the light
  size = mix(.0012, .0036, near) * u;
  pos += vec2(sin(t * .11 + aSeed2.y * 20.) * u * .05 + t * u * .004, cos(t * .09 + aSeed2.z * 20.) * u * .035);
  vBright = .4 + .6 * pow(.5 + .5 * sin(t * (.5 + aSeed2.w) + aSeed2.x * 30.), 3.);
  vAlpha = mix(.25, .7, near);
#elif KIND == 2 // snow: drifting flakes
  size = mix(.0018, .0065, near * near) * u;
  pos.y = base.y + t * u * mix(.03, .09, near);
  pos.x += sin(t * .55 + aSeed2.y * 6.28) * u * .03 + t * u * .01;
  vAlpha = mix(.45, .95, near);
#elif KIND == 3 // rain: fast slanted streaks
  size = mix(.012, .03, near) * u;
  stretch = vec2(.06, 1.);
  float fall = mix(1.1, 1.9, near);
  pos.y = base.y + t * u * fall;
  pos.x = base.x - t * u * fall * .12;
  angle = .12;
  vAlpha = mix(.18, .45, near);
#elif KIND == 4 // fireflies: lazy loops and slow blinks
  size = mix(.018, .032, near) * u;
  pos += vec2(sin(t * .31 + aSeed2.y * 9.) + .5 * sin(t * .73 + aSeed2.z * 7.), cos(t * .27 + aSeed2.w * 8.) + .5 * sin(t * .61 + aSeed2.x * 5.)) * u * .06;
  float blink = .5 + .5 * sin(t * mix(.6, 1.3, aSeed2.y) + aSeed2.x * 40.);
  vBright = .05 + .95 * pow(blink, 5.);
#elif KIND == 5 // embers: rise, flicker, cool and fade
  float life = fract(t * mix(.08, .16, aSeed2.y) + aSeed2.x);
  size = mix(.0022, .0055, near) * u * (1. - life * .5);
  pos.y = mod(base.y * .3 + uSize.y * .7 - life * uSize.y * mix(.6, 1.1, near) + m, field.y) - m;
  pos.x += sin(t * 1.7 + aSeed2.z * 20.) * u * .012 * (life + .2) + life * u * .05;
  vBright = (1. - life) * (.6 + .4 * sin(t * 13. + aSeed2.w * 50.));
  vVary = life;
#elif KIND == 6 // petals: tumbling down on the breeze
  size = mix(.013, .024, near) * u;
  pos.y = base.y + t * u * mix(.035, .07, near);
  pos.x += t * u * mix(.02, .05, near) + sin(t * .7 + aSeed2.y * 6.28) * u * .04;
  angle = t * mix(.6, 1.6, aSeed2.z) + aSeed2.w * 6.28;
  stretch = vec2(1., max(.15, abs(cos(t * mix(.8, 1.8, aSeed2.y) + aSeed2.x * 6.28))));
  vAlpha = mix(.7, 1., near);
#elif KIND == 7 // stars: fixed, twinkling, thinning toward the horizon
  size = mix(.0016, .0048, near * near * near) * u;
  pos = vec2(aSeed.x * uSize.x, pow(aSeed.y, 1.7) * uSize.y * .92);
  vBright = .55 + .45 * sin(uTime * mix(.8, 2.4, aSeed2.y) + aSeed2.x * 40.);
  vAlpha = 1. - smoothstep(.55, .95, pos.y / uSize.y);
#elif KIND == 8 // plankton: tiny sparks adrift
  size = mix(.0018, .0055, near) * u;
  pos += vec2(sin(t * .07 + aSeed2.y * 20.) * u * .06 + t * u * .006, cos(t * .05 + aSeed2.z * 20.) * u * .04 - t * u * .004);
  vBright = .35 + .65 * pow(.5 + .5 * sin(t * (.3 + aSeed2.w * .8) + aSeed2.x * 30.), 4.);
#endif

  pos = mod(pos + m, field) - m;
  size = max(size * uScale, KIND == 3 ? 6. : 3.);
  vLocal = position.xy * 2.;
  vec2 corner = rot(position.xy * stretch * size, angle);
  vec2 world = pos + corner;
  gl_Position = vec4(world.x / uSize.x * 2. - 1., 1. - world.y / uSize.y * 2., 0., 1.);
}
`;

const fragment = /* glsl */ `
${COMMON}${OUT}
#define KIND ${'${KIND}'}
uniform vec3 uColor;
uniform float uVisible, uGlowBoost;
varying vec2 vLocal;
varying float vAlpha, vBright, vVary;

void main() {
  float r = length(vLocal);
  vec3 col = uColor; float a = 0.; vec3 glow = vec3(0.);
  float boost = uGlowBoost;
#if KIND == 0
  float ring = smoothstep(1., .82, r) * (.25 + .75 * smoothstep(.45, .95, r));
  float spec = smoothstep(.32, .0, length(vLocal - vec2(-.35, .35)));
  a = ring * .6 * vAlpha;
  col = grade(uColor);
  glow = grade(vec3(1.)) * spec * .8 * vAlpha;
#elif KIND == 1
  a = smoothstep(1., 0., r) * .55 * vAlpha * vBright;
  col = grade(uColor) * 1.2;
#elif KIND == 2
  a = smoothstep(1., .25, r) * vAlpha;
  col = grade(uColor);
#elif KIND == 3
  a = smoothstep(1., 0., abs(vLocal.x)) * smoothstep(1., .2, abs(vLocal.y)) * vAlpha;
  col = grade(uColor);
#elif KIND == 4
  float core = smoothstep(.16, .0, r);
  float halo = exp(-r * r * 9.) * .5;
  glow = uColor * (core * 2. + halo) * vBright * boost;
  a = core * .5 * vBright;
  col = uColor;
#elif KIND == 5
  float core = smoothstep(1., .0, r);
  vec3 hot = mix(uColor * vec3(1.3, 1.1, .8), uColor * vec3(.9, .35, .2), vVary);
  glow = hot * core * core * vBright * 1.6 * boost;
  a = 0.;
#elif KIND == 6
  // A petal: rounded teardrop with a soft notch and a blush toward the base.
  vec2 q = vLocal;
  float w = .62 * (1. - .35 * q.y);
  float d = length(vec2(q.x / max(w, .05), q.y));
  float notch = smoothstep(.0, .18, length(q - vec2(0., 1.)));
  a = smoothstep(1., .86, d) * notch * vAlpha;
  col = grade(mix(uColor, uColor * vec3(1., .78, .85), smoothstep(-.8, .9, q.y)) * (.85 + .25 * vVary));
#elif KIND == 7
  float core = smoothstep(.5, .0, r);
  float spike = (smoothstep(.12, .0, abs(vLocal.x)) + smoothstep(.12, .0, abs(vLocal.y))) * smoothstep(1., .2, r) * .35;
  glow = uColor * (core + spike) * vBright * vAlpha * boost;
#elif KIND == 8
  float core = smoothstep(.45, .0, r);
  float halo = exp(-r * r * 6.) * .35;
  glow = uColor * (core + halo) * vBright * boost;
  a = 0.;
#endif
  a *= uVisible; glow *= uVisible;
  if (a <= .002 && max(glow.r, max(glow.g, glow.b)) <= .002) discard;
  gl_FragColor = premul(col, a, glow);
}
`;

export function createParticles({ recipe, shared, width, height, seed = 1 }) {
  const systems = [];
  const water = recipe.medium === 'water' ? 1 : 0;
  recipe.particles.forEach((spec, index) => {
    const kind = PARTICLE_KINDS[spec.kind];
    // Allocate for the biggest screen this could reach; draw only what this one needs.
    const capacity = Math.max(1, Math.round(kind.max * spec.amount * 2.4));
    const geometry = instancedQuad(1);
    const a = instanceAttribute(geometry, 'aSeed', capacity, 4), b = instanceAttribute(geometry, 'aSeed2', capacity, 4);
    const random = randomGenerator(seed * 977 + index * 131 + kind.id);
    for (let i = 0; i < capacity * 4; i++) { a.array[i] = random(); b.array[i] = random(); }
    const uniforms = {
      ...shared,
      uColor: { value: linearColor(spec.color) }, uSpeed: { value: spec.speed }, uScale: { value: 1 }, uWater: { value: water },
      uVisible: { value: 1 }, uGlowBoost: { value: 1 },
    };
    const define = (src) => src.replaceAll('${KIND}', String(kind.id));
    const material = blended(new THREE.ShaderMaterial({ vertexShader: define(vertex), fragmentShader: define(fragment), uniforms }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = kind.back ? 5 : 40;
    systems.push({ spec, kind, mesh, geometry, material, uniforms, capacity });
  });

  function resize(w, h) {
    for (const s of systems) s.geometry.instanceCount = Math.min(s.capacity, particleCount(s.spec.kind, s.spec.amount, w, h));
  }
  resize(width, height);

  const glowing = new Set(['fireflies', 'embers', 'stars', 'plankton']);
  function update(night) {
    for (const s of systems) {
      // "night" particles fade in after dark; glowing ones brighten at night.
      s.uniforms.uVisible.value = s.spec.night ? 0.06 + 0.94 * Math.min(1, night * 1.15) : 1;
      s.uniforms.uGlowBoost.value = glowing.has(s.spec.kind) ? 0.55 + 0.75 * night : 1;
      s.mesh.visible = s.uniforms.uVisible.value > 0.01 && s.geometry.instanceCount > 0;
    }
  }

  return {
    meshes: systems.map((s) => s.mesh), resize, update,
    dispose() { for (const s of systems) { s.geometry.dispose(); s.material.dispose(); } },
  };
}
