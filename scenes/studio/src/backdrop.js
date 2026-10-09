import * as THREE from 'three';
import { COMMON, OUT, screenQuad, blended, linearColor } from './gl.js';

export const MAX_RIPPLES = 8;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

const backdropFragment = /* glsl */ `
${COMMON}${OUT}
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform float uHasImage, uHasDepth, uWater, uCaustics, uSway, uRippleAmount, uUnit;
uniform vec3 uColors[5];
uniform float uColorCount;
uniform vec2 uUvScale, uUvOffset, uLook, uPan;
uniform vec4 uRipples[${MAX_RIPPLES}];

vec3 gradient(float t) {
  t = clamp(t, 0., 1.) * (uColorCount - 1.);
  vec3 c = uColors[0];
  for (int i = 1; i < 5; i++) {
    if (float(i) > uColorCount - .5) break;
    float k = smoothstep(0., 1., clamp(t - float(i - 1), 0., 1.));
    c = mix(c, uColors[i], k);
  }
  return c;
}

// A tileable caustic network (after Dave Hoskins / joltz0r), cheap enough for 5K.
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.;
  vec2 i = p;
  float c = 1., inten = .005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1. - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1. / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.);
}

void main() {
  vec2 p = vec2(vUv.x, 1. - vUv.y) * uSize; // CSS px, y down
  float depthT = 1. - vUv.y;                // 0 at the top, 1 at the bottom

  // Ripples: rings that bend the backdrop under water and shimmer it in air.
  vec2 bend = vec2(0.);
  float shimmer = 0.;
  float speed = uUnit * .32;
  for (int k = 0; k < ${MAX_RIPPLES}; k++) {
    vec4 r = uRipples[k];
    if (r.w <= 0.) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + 1e-3;
    float band = dist - r.z * speed;
    float width = uUnit * (.018 + r.z * .03);
    float env = exp(-band * band / (width * width)) * exp(-r.z * 1.1) * r.w;
    float wave = sin(band / (uUnit * .011)) * env;
    bend += d / dist * wave;
    shimmer += wave;
  }
  bend *= uRippleAmount * uUnit * .012 * uWater;

  // Sway: slow travelling waves, like looking through water or heat.
  vec2 sway = vec2(sin(p.y / uUnit * 7. + uTime * .8) + .5 * sin(p.y / uUnit * 13. - uTime * 1.3),
                   cos(p.x / uUnit * 6. + uTime * .6)) * uSway * uUnit * .0035;
  vec2 offsetPx = bend + sway;
  vec2 uv = vUv + vec2(offsetPx.x, -offsetPx.y) / uSize;

  vec3 col;
  if (uHasImage > .5) {
    vec2 iuv = uUvOffset + uv * uUvScale;
    if (uHasDepth > .5) {
      float d = texture2D(uDepth, iuv).r;
      iuv += uLook * (d - .5);
    }
    iuv += uPan;
    col = texture2D(uImage, clamp(iuv, vec2(.0005), vec2(.9995))).rgb;
  } else {
    // Gradient sky or water, with soft drifting depth so it never reads as flat.
    float t = depthT + (uv.y - vUv.y) * -1. + uLook.y * .4;
    col = gradient(t);
    vec2 q = p / uUnit;
    float n = fbm3(q * vec2(.9, 1.6) + vec2(uTime * .012, uTime * .004) + uLook * 1.5);
    col *= .9 + .2 * n;
    // Light from above: a broad glow near the top.
    vec2 c = vec2(.5 + uLook.x * .05, -.15);
    float g = exp(-length((vUv * vec2(1., 1.) - vec2(c.x, 1. - c.y)) * vec2(uSize.x / uSize.y * .55, 1.)) * 2.2);
    col += mix(vec3(.10, .16, .16), vec3(.16, .12, .06), 1. - uWater) * g * (1. - .7 * uNight);
  }

  if (uCaustics > 0.) {
    vec2 q = (p + offsetPx * 2.) / (uUnit * .55);
    float c = caustic(q, uTime * .28) * .6 + caustic(q * 1.37 + 3.1, uTime * .22) * .4;
    float fade = (1. - depthT * .75) * (1. - uNight * .6);
    col += vec3(.8, .95, 1.) * c * uCaustics * .32 * fade * (.45 + .55 * lum(col) / (lum(col) + .08));
  }
  col *= 1. + shimmer * uRippleAmount * mix(.06, .03, uWater);
  gl_FragColor = vec4(toOut(grade(col)), 1.);
}
`;

// Rays, fog and vignette, drawn over everything else.
const overlayFragment = /* glsl */ `
${COMMON}${OUT}
varying vec2 vUv;
uniform float uRays, uFog, uVignette, uWater, uUnit;
uniform vec3 uFogColor;

void main() {
  vec2 p = vec2(vUv.x, 1. - vUv.y) * uSize;
  float depthT = 1. - vUv.y;
  vec2 q = p / uUnit;

  vec3 add = vec3(0.);
  if (uRays > 0.) {
    float x = p.x / uUnit * .62 + depthT * (uWater > .5 ? .35 : .9);
    float r = smoothstep(.55, 1., sin(x * 3.1 + uTime * .11) * .5 + .5)
            + .7 * smoothstep(.6, 1., sin(x * 5.3 - uTime * .083 + 1.7) * .5 + .5)
            + .5 * smoothstep(.62, 1., sin(x * 9.1 + uTime * .17 + 4.1) * .5 + .5);
    r *= .55 + .45 * vnoise(vec2(x * 2.2, uTime * .07));
    float fall = uWater > .5 ? exp(-depthT * 2.4) : exp(-depthT * 1.5) * smoothstep(0., .25, 1. - abs(vUv.x - .2) * .9);
    vec3 tone = mix(uWater > .5 ? vec3(.62, .86, .9) : vec3(1., .9, .7), vec3(1., .62, .34), uWarm);
    tone = mix(tone, vec3(.45, .55, .85), uNight);
    add += tone * r * fall * uRays * .2 * (1. - .6 * uNight);
  }

  float fog = 0.;
  if (uFog > 0.) {
    float n = fbm3(q * .55 + vec2(uTime * .018, -uTime * .006));
    float base = uWater > .5 ? .25 + .75 * smoothstep(0., 1., depthT) : smoothstep(.35, 1., depthT) * .9 + .1;
    fog = clamp(uFog * base * (.45 + .75 * n) * .8, 0., .85);
  }
  vec3 fogColor = grade(uFogColor);

  vec2 v = (vUv - .5) * 2.;
  float d = length(v * vec2(.92, 1.)) / 1.3;
  float vig = 1. - (uVignette * .7 + uNight * .12) * smoothstep(.25, 1.05, d);

  // dst * (1 - fog) * vig + fogColor * fog * vig + rays
  float keep = (1. - fog) * vig;
  vec3 rgb = toOut(fogColor * fog * vig + add) * 1.;
  // A touch of blue-noise-like dither so 5K gradients never band.
  rgb += (hash12(gl_FragCoord.xy + fract(uTime) * 37.) - .5) / 255.;
  gl_FragColor = vec4(max(rgb, 0.), 1. - keep);
}
`;

export function createBackdrop({ recipe, renderer, shared, base }) {
  const isImage = recipe.backdrop.kind === 'image' && recipe.backdrop.image;
  const colors = recipe.backdrop.colors.map(linearColor);
  while (colors.length < 5) colors.push(colors[colors.length - 1].clone());
  const ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0));
  const water = recipe.medium === 'water' ? 1 : 0;
  const unit = { value: 1 };
  const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  blank.needsUpdate = true;

  const uniforms = {
    ...shared,
    uImage: { value: blank }, uDepth: { value: blank },
    uHasImage: { value: 0 }, uHasDepth: { value: 0 }, uWater: { value: water },
    uCaustics: { value: water ? recipe.effects.caustics : 0 },
    uSway: { value: recipe.effects.sway }, uRippleAmount: { value: Math.max(0.3, recipe.effects.ripples) }, uUnit: unit,
    uColors: { value: colors.slice(0, 5) }, uColorCount: { value: Math.min(5, recipe.backdrop.colors.length) },
    uUvScale: { value: new THREE.Vector2(1, 1) }, uUvOffset: { value: new THREE.Vector2(0, 0) },
    uLook: { value: new THREE.Vector2(0, 0) }, uPan: { value: new THREE.Vector2(0, 0) },
    uRipples: { value: ripples },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: backdropFragment, uniforms, depthTest: false, depthWrite: false });
  const mesh = screenQuad(material, 0);

  // Fog takes the colour of the scene's own middle distance.
  const fogColor = recipe.medium === 'water'
    ? colors[Math.min(colors.length - 1, Math.floor(recipe.backdrop.colors.length / 2))].clone().lerp(new THREE.Color(0.25, 0.55, 0.62), 0.35)
    : new THREE.Color(0.92, 0.9, 0.86).lerp(colors[Math.max(0, recipe.backdrop.colors.length - 1)], 0.35);
  const overlayMaterial = blended(new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: overlayFragment,
    uniforms: {
      ...shared, uRays: { value: recipe.effects.rays }, uFog: { value: recipe.effects.fog },
      uVignette: { value: recipe.effects.vignette }, uWater: { value: water }, uUnit: unit, uFogColor: { value: fogColor },
    },
  }));
  const overlay = screenQuad(overlayMaterial, 50);

  let image = null, imageSize = null, disposed = false;
  const textures = [];
  const maxSize = renderer.capabilities.maxTextureSize;
  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  async function load(name, color) {
    const url = new URL(name, base).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
    const blob = await response.blob();
    let bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: color ? 'default' : 'none' });
    // Full quality: only an image larger than the GPU allows is scaled down.
    if (bitmap.width > maxSize || bitmap.height > maxSize) {
      const s = maxSize / Math.max(bitmap.width, bitmap.height);
      const scaled = await createImageBitmap(bitmap, { resizeWidth: Math.floor(bitmap.width * s), resizeHeight: Math.floor(bitmap.height * s), resizeQuality: 'high' });
      bitmap.close?.();
      bitmap = scaled;
    }
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false; // already flipped by createImageBitmap
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = anisotropy;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    textures.push(texture);
    return texture;
  }

  const ready = (async () => {
    if (!isImage) return;
    const [img, depth] = await Promise.all([
      load(recipe.backdrop.image, true),
      recipe.backdrop.depth ? load(recipe.backdrop.depth, false).catch((error) => { console.warn(error.message); return null; }) : null,
    ]);
    if (disposed) return;
    image = img;
    imageSize = { width: img.image.width, height: img.image.height };
    uniforms.uImage.value = img;
    uniforms.uHasImage.value = 1;
    if (depth) { uniforms.uDepth.value = depth; uniforms.uHasDepth.value = 1; }
    fit(lastSize.width, lastSize.height);
  })();

  let lastSize = { width: 1, height: 1 };
  function fit(width, height) {
    lastSize = { width, height };
    unit.value = Math.min(width, height);
    if (!imageSize) return;
    const parallax = recipe.backdrop.parallax;
    // Zoom in just enough that parallax and drift never reveal an edge.
    const zoom = 1 + (uniforms.uHasDepth.value ? 0.05 * parallax : 0.012 * parallax) + 0.006;
    const imageAspect = imageSize.width / imageSize.height, screenAspect = width / height;
    let sx = 1, sy = 1;
    if (imageAspect > screenAspect) sx = screenAspect / imageAspect; else sy = imageAspect / screenAspect;
    sx /= zoom; sy /= zoom;
    const [fx, fy] = recipe.backdrop.focus;
    uniforms.uUvScale.value.set(sx, sy);
    uniforms.uUvOffset.value.set(Math.min(1 - sx, Math.max(0, fx - sx / 2)), Math.min(1 - sy, Math.max(0, 1 - fy - sy / 2)));
  }

  // Look: the smoothed cursor offset (-1..1) plus a slow idle drift, in image UV terms.
  function update(look, time) {
    const parallax = recipe.backdrop.parallax;
    const drift = { x: Math.sin(time * 0.071) * 0.35 + Math.sin(time * 0.043 + 1.3) * 0.2, y: Math.cos(time * 0.057) * 0.25 };
    const lx = look.x + drift.x * 0.25, ly = look.y + drift.y * 0.25;
    if (imageSize && uniforms.uHasDepth.value) {
      uniforms.uLook.value.set(-lx * parallax * 0.045, ly * parallax * 0.045);
      uniforms.uPan.value.set(0, 0);
    } else if (imageSize) {
      uniforms.uLook.value.set(0, 0);
      uniforms.uPan.value.set(-lx * parallax * 0.004, ly * parallax * 0.004);
    } else {
      uniforms.uLook.value.set(lx * parallax * 0.05, ly * parallax * 0.05);
    }
  }

  function setRipples(list) {
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = list[i];
      if (r) ripples[i].set(r.x, r.y, r.age, r.strength); else ripples[i].set(0, 0, 0, 0);
    }
  }

  return {
    meshes: [mesh, overlay], ready, fit, update, setRipples,
    get hasImage() { return Boolean(image); },
    dispose() {
      disposed = true;
      material.dispose(); overlayMaterial.dispose(); mesh.geometry.dispose(); overlay.geometry.dispose();
      blank.dispose();
      for (const t of textures) { t.image?.close?.(); t.dispose(); }
    },
  };
}
