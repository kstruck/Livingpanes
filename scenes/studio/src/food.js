import * as THREE from 'three';
import { COMMON, OUT, blended, instancedQuad, instanceAttribute } from './gl.js';
import { FOOD, MAX_FOOD } from './behavior.js';

const FOOD_IDS = { flakes: 0, pellets: 1, seeds: 2, nectar: 3 };

const vertex = /* glsl */ `
${COMMON}
attribute vec4 aFood; // x, y, size px, alpha
attribute vec2 aSpin; // angle, seed
varying vec2 vL;
varying float vAlpha, vSeed;
void main() {
  float c = cos(aSpin.x), s = sin(aSpin.x);
  vec2 l = position.xy * 2.;
  vec2 o = vec2(c * l.x - s * l.y, s * l.x + c * l.y) * aFood.z;
  vec2 w = aFood.xy + o;
  vL = l; vAlpha = aFood.w; vSeed = aSpin.y;
  gl_Position = vec4(w.x / uSize.x * 2. - 1., 1. - w.y / uSize.y * 2., 0., 1.);
}
`;

const fragment = /* glsl */ `
${COMMON}${OUT}
#define KIND ${'${KIND}'}
uniform float uGlowBoost;
varying vec2 vL;
varying float vAlpha, vSeed;
void main() {
  vec2 q = vL;
  float r = length(q);
  float aa = fwidth(r) * 1.2;
  vec3 col = vec3(0.); float a = 0.; vec3 glow = vec3(0.);
#if KIND == 0 // flakes: thin irregular chips in a few colours
  float ang = atan(q.y, q.x);
  float edge = .45 + .12 * sin(ang * 3. + vSeed * 20.) + .08 * sin(ang * 5. + vSeed * 40.);
  a = 1. - smoothstep(edge - aa, edge + aa, r);
  vec3 tones[3];
  tones[0] = vec3(.9, .32, .08); tones[1] = vec3(.85, .62, .12); tones[2] = vec3(.35, .55, .15);
  col = vSeed < .45 ? tones[0] : vSeed < .8 ? tones[1] : tones[2];
  col *= .8 + .3 * vnoise(q * 6. + vSeed * 9.);
#elif KIND == 1 // pellets: round, with a highlight
  a = 1. - smoothstep(.42 - aa, .42 + aa, r);
  col = vec3(.42, .24, .1) * (1.2 - .6 * smoothstep(-.4, .4, q.y + q.x * .3));
  col = mix(col, vec3(.95, .8, .6), smoothstep(.16, .02, length(q - vec2(-.13, .14))) * .7);
#elif KIND == 2 // seeds: small teardrops
  vec2 p = vec2(q.x, q.y * 1.7 - .1);
  float d = length(p) - .32 + .15 * smoothstep(-.3, .5, q.y);
  a = 1. - smoothstep(-aa, aa, d);
  col = mix(vec3(.55, .42, .25), vec3(.85, .74, .52), smoothstep(-.3, .3, q.x));
#elif KIND == 3 // nectar: glowing motes
  glow = vec3(1., .82, .4) * (smoothstep(.22, .0, r) * 1.6 + exp(-r * r * 5.) * .45) * uGlowBoost;
  a = smoothstep(.2, .0, r) * .4;
  col = vec3(1., .9, .6);
#endif
  a *= vAlpha; glow *= vAlpha;
  if (a < .003 && glow.r < .003) discard;
  gl_FragColor = premul(grade(col), a, glow);
}
`;

export function createFood({ recipe, shared, world }) {
  if (!FOOD[recipe.food]) return { meshes: [], update() {}, dispose() {} };
  const geometry = instancedQuad(1);
  const pos = instanceAttribute(geometry, 'aFood', MAX_FOOD, 4), spin = instanceAttribute(geometry, 'aSpin', MAX_FOOD, 2);
  const uniforms = { ...shared, uGlowBoost: { value: 1 } };
  const material = blended(new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment.replaceAll('${KIND}', String(FOOD_IDS[recipe.food])), uniforms }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  function update(night) {
    const u = world.unit();
    let n = 0;
    for (const f of world.food) {
      if (f.eaten || n >= MAX_FOOD) continue;
      const spec = FOOD[f.kind];
      const alpha = Math.min(1, f.age * 4) * Math.min(1, (f.life - f.age) / 2);
      const size = spec.size * u * (f.kind === 'nectar' ? 3 : 1.4) * (0.8 + f.seed * 0.4);
      pos.array.set([f.x, f.y, size, Math.max(0, alpha)], n * 4);
      spin.array.set([f.landed ? f.seed * 6 : f.age * (1 + f.seed * 2) + f.seed * 6, f.seed], n * 2);
      n++;
    }
    geometry.instanceCount = n;
    mesh.visible = n > 0;
    uniforms.uGlowBoost.value = 0.7 + 0.6 * night;
    pos.needsUpdate = true; spin.needsUpdate = true;
  }
  return { meshes: [mesh], update, dispose() { geometry.dispose(); material.dispose(); } };
}
