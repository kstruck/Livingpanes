import * as THREE from 'three';

// Shared uniforms: one object per engine, referenced (not copied) by every material, so
// a single write per frame reaches all of them. Sizes are CSS pixels, y down.
export function sharedUniforms() {
  return {
    uSize: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uWarm: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
  };
}

// Everything is drawn in linear light and converted to the output space at the end,
// premultiplied, so a fragment can be part covering colour and part additive glow.
export const COMMON = /* glsl */ `
uniform vec2 uSize;
uniform float uTime;
uniform float uNight;
uniform float uWarm;
uniform vec3 uTint;

// smoothstep with edge0 > edge1 is undefined in GLSL (and returns 0 on some drivers);
// every shader here uses it both ways, so route it through a version defined for both.
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
#define smoothstep sstep

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), u.x), mix(hash12(i + vec2(0., 1.)), hash12(i + 1.), u.x), u.y);
}
float fbm3(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= .5; } return s / .875; }
float lum(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }

// Time of day and the recipe tint, applied to everything lit by the sky.
vec3 grade(vec3 c) {
  vec3 warm = c * vec3(1.14, .86, .66) + vec3(.012, .004, 0.);
  c = mix(c, warm, uWarm * .85);
  float l = lum(c);
  vec3 night = mix(vec3(l), c, .38) * vec3(.36, .5, .86) * .5;
  c = mix(c, night, uNight);
  float tl = max(lum(uTint), .05);
  return mix(c, c * uTint / tl, .22);
}
`;

// Fragment shaders only: the output conversion is not defined in vertex shaders.
export const OUT = /* glsl */ `
vec3 toOut(vec3 c) { return linearToOutputTexel(vec4(max(c, 0.), 1.)).rgb; }
vec4 premul(vec3 col, float a, vec3 glow) { return vec4(toOut(col) * a + toOut(glow), a); }
`;

// Premultiplied "over": src.rgb + dst * (1 - src.a).
export function blended(material) {
  material.transparent = true;
  material.side = THREE.DoubleSide; // screen-space y flips and mirrored bodies reverse the winding
  material.depthTest = false;
  material.depthWrite = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return material;
}

// A unit quad (or a strip of quads along x, for bending bodies) drawn once per instance.
export function instancedQuad(segments = 1) {
  const plane = new THREE.PlaneGeometry(1, 1, segments, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.setAttribute('uv', plane.getAttribute('uv'));
  geometry.instanceCount = 0;
  return geometry;
}

export function instanceAttribute(geometry, name, capacity, size) {
  const attribute = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * size), size);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
}

export const linearColor = (hex) => new THREE.Color(hex); // ColorManagement converts sRGB hex to linear

// Full-screen triangle-pair in clip space.
export function screenQuad(material, order) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}
