// WebGL1 renderer (no libraries). Textured, shadowed, rounded-mesh renderer:
//  - procedural textures with mipmaps + anisotropic filtering (textures.js)
//  - static map mesh with world-space UVs and baked vertex AO (mapmesh.js)
//  - one baked sun shadow map for the static world, soft 3x3 PCF
//  - smooth primitives (sphere/cylinder/capsule/rounded box) for characters, weapons and props (geom.js)

import { buildTextures } from './textures.js';
import * as G from './geom.js';
import { buildMapMesh } from './mapmesh.js';

// ------------------------------------------------------------------ tiny matrix helpers (column-major)
export const M4 = {
  ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  perspective(out, fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
    return out;
  },
  mul(out, a, b) {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
    return out;
  },
  /** View matrix for a camera at (x,y,z) looking along yaw/pitch with optional roll (lean). */
  view(out, x, y, z, yaw, pitch, roll = 0) {
    // world->camera = Rz(-roll) * Rx(-pitch) * Ry(-yaw) * T(-pos)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // right, up, forward(-z) basis of the camera in world space
    const rx = cy, ry = 0, rz = -sy;                                  // yaw only right
    const fx = -sy * cp, fy = sp, fz = -cy * cp;                       // forward
    const ux0 = sy * sp, uy0 = cp, uz0 = cy * sp;                      // up (before roll)
    // apply roll around forward
    const Rx = rx * cr + ux0 * sr, Ry = ry * cr + uy0 * sr, Rz = rz * cr + uz0 * sr;
    const Ux = -rx * sr + ux0 * cr, Uy = -ry * sr + uy0 * cr, Uz = -rz * sr + uz0 * cr;
    out[0] = Rx; out[4] = Ry; out[8] = Rz;  out[12] = -(Rx * x + Ry * y + Rz * z);
    out[1] = Ux; out[5] = Uy; out[9] = Uz;  out[13] = -(Ux * x + Uy * y + Uz * z);
    out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = (fx * x + fy * y + fz * z);
    out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
    return out;
  },
};

export const MATERIALS = {
  floor: [0.30, 0.32, 0.36], wall: [0.46, 0.49, 0.55], metal: [0.38, 0.42, 0.50], crate: [0.62, 0.45, 0.24],
  accent: [0.15, 0.55, 0.75], marble: [0.80, 0.78, 0.74], stone: [0.58, 0.55, 0.50], grass: [0.27, 0.46, 0.22],
  hedge: [0.14, 0.38, 0.17], dark: [0.16, 0.17, 0.20], glow: [0.30, 0.95, 0.85],
  asphalt: [0.20, 0.21, 0.22], sand: [0.72, 0.64, 0.45], brick: [0.55, 0.30, 0.24], wood: [0.45, 0.31, 0.18], rust: [0.52, 0.31, 0.18],
  concrete: [0.55, 0.55, 0.53], olive: [0.30, 0.36, 0.22], blue: [0.18, 0.31, 0.50], red: [0.58, 0.19, 0.16], dirt: [0.40, 0.31, 0.21], leaf: [0.17, 0.36, 0.13],
};

// strength of the shader micro-relief per map material
// glossiness per map material (uSpec): sun glint, fresnel reflection of the sky, dynamic-light highlights
const SPEC = { metal: 0.55, rust: 0.18, marble: 0.5, floor: 0.3, dark: 0.35, accent: 0.4, asphalt: 0.12, stone: 0.12, concrete: 0.08, blue: 0.4, red: 0.4, olive: 0.3, leaf: 0.1, hedge: 0.06, wood: 0.1, brick: 0.06 };
const MICRO = { rock: 0.7, hedge: 0.6, leaf: 0.6, wood: 0.55, grass: 0.4, dirt: 0.55, sand: 0.45, stone: 0.4, brick: 0.35, concrete: 0.4, marble: 0.2, wall: 0.3, metal: 0.25, rust: 0.4, crate: 0.3, floor: 0.2, asphalt: 0.5, plain: 0.3, hay: 0.5 };

const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol; attribute vec2 aUV;
uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uRot; uniform vec3 uInvS; uniform mat4 uLightVP; uniform float uUVMul; uniform float uOutline; uniform vec3 uCam;
varying vec3 vWorld; varying vec3 vNor; varying vec3 vCol; varying vec2 vUV; varying vec4 vLP;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vWorld = w.xyz; vNor = uRot * (aNor * uInvS); vCol = aCol; vUV = aUV * uUVMul; vLP = uLightVP * w;
  if (uOutline > 0.0) { float dd = length(w.xyz - uCam); w.xyz += normalize(vNor) * uOutline * (1.0 + dd * 0.045); }
  gl_Position = uVP * w;
}`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vWorld; varying vec3 vNor; varying vec3 vCol; varying vec2 vUV; varying vec4 vLP;
uniform sampler2D uTex; uniform sampler2D uShadow;
uniform vec3 uTint; uniform float uUseTint; uniform float uEmit; uniform float uAlpha; uniform float uSpec;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGnd;
uniform vec3 uFog; uniform vec2 uFogRange; uniform vec3 uCam; uniform float uFogOn;
uniform float uBright; uniform float uLight; uniform float uFlash; uniform float uDark;
#define NL 8
uniform vec4 uLP[NL]; uniform vec3 uLC[NL]; uniform vec4 uLD[NL];   // dynamic lights: pos+radius, colour*intensity, spot dir+cone (cone<-1 = point)
uniform float uMicro;
uniform float uShadowOn; uniform float uShadowTexel; uniform float uShadowQ; uniform float uRim; uniform float uOutlineOn;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
// value noise with analytic gradient: x = noise, yzw = d/dp
vec4 vnoise3(vec3 x){
  vec3 i = floor(x), f = fract(x), u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = h3(i), b = h3(i + vec3(1.0,0.0,0.0)), c = h3(i + vec3(0.0,1.0,0.0)), d = h3(i + vec3(1.0,1.0,0.0));
  float e = h3(i + vec3(0.0,0.0,1.0)), f2 = h3(i + vec3(1.0,0.0,1.0)), g = h3(i + vec3(0.0,1.0,1.0)), h = h3(i + vec3(1.0,1.0,1.0));
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + g, k6 = a - b - e + f2, k7 = -a + b + c - d + e - f2 - g + h;
  return vec4(a + k1*u.x + k2*u.y + k3*u.z + k4*u.x*u.y + k5*u.y*u.z + k6*u.z*u.x + k7*u.x*u.y*u.z,
              du * vec3(k1 + k4*u.y + k6*u.z + k7*u.y*u.z, k2 + k5*u.z + k4*u.x + k7*u.z*u.x, k3 + k6*u.x + k5*u.y + k7*u.x*u.y));
}
float unpackD(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }
float shadowAt(float ndl){
  vec3 p = vLP.xyz / vLP.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float bias = 0.0012 + 0.0035 * (1.0 - ndl);
  if (uShadowQ < 0.5) return (p.z - bias > unpackD(texture2D(uShadow, p.xy))) ? 0.0 : 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    float d = unpackD(texture2D(uShadow, p.xy + vec2(float(i), float(j)) * uShadowTexel * 1.3));
    s += (p.z - bias > d) ? 0.0 : 1.0;
  }
  return s / 9.0;
}
void main(){
  if (uOutlineOn > 0.5) {
    vec3 oc = vec3(0.055, 0.045, 0.05) * uBright;
    if (uFogOn > 0.5) { float d0 = length(vWorld - uCam); oc = mix(oc, uFog, clamp((d0 - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0)); }
    gl_FragColor = vec4(oc, 1.0); return;
  }
  vec3 n = normalize(vNor);
  vec3 base = texture2D(uTex, vUV).rgb * mix(vCol, uTint, uUseTint);
  if (uMicro > 0.0) {                                   // procedural micro-relief in world space: three octaves of gradient noise bend the normal and mottle the albedo
    float dM = length(uCam - vWorld), fadeM = 1.0 - smoothstep(10.0, 28.0, dM);
    if (fadeM > 0.0) {
      vec4 m1 = vnoise3(vWorld * 7.0), m2 = vnoise3(vWorld * 23.0 + 3.1);
      vec3 gr = m1.yzw * 0.62 + m2.yzw * 0.38; float hv = m1.x * 0.62 + m2.x * 0.38;
      if (dM < 12.0) { vec4 m3 = vnoise3(vWorld * 61.0 + 7.7); gr = m1.yzw * 0.5 + m2.yzw * 0.3 + m3.yzw * 0.2; hv = m1.x * 0.5 + m2.x * 0.3 + m3.x * 0.2; }   // finest octave only up close
      n = normalize(n - (gr - n * dot(gr, n)) * 0.5 * uMicro * fadeM);
      base *= 1.0 + (hv - 0.5) * 0.5 * uMicro * fadeM;
    }
  }
  vec3 L = normalize(uSun);
  float ndl = max(dot(n, L), 0.0);
  float sh = uShadowOn > 0.5 ? shadowAt(ndl) : 1.0;
  // painterly ramp: soft half-lambert with a cool, saturated shadow side and a warm sunlit side
  float wrap = smoothstep(0.12, 0.82, dot(n, L) * 0.55 + 0.45);
  vec3 amb = mix(uGnd, uSky, 0.5 + 0.5 * n.y);
  vec3 shade = amb * vec3(0.92, 0.97, 1.08);
  vec3 sunl = uSunCol * vec3(1.06, 1.0, 0.9) * wrap * mix(0.2, 1.0, sh);           // deeper cast shadows
  vec3 lit = (shade * 0.92 + sunl * (0.34 + 0.66 * sh) * 1.04) * uLight;
  vec3 col = base * lit * uBright;
  vec3 V = normalize(uCam - vWorld);
  vec3 dyn = vec3(0.0);
  for (int i = 0; i < NL; i++) {
    vec3 lc = uLC[i]; if (lc.x + lc.y + lc.z <= 0.0) continue;
    vec3 d = uLP[i].xyz - vWorld; float dist = length(d); float rad = uLP[i].w; if (dist >= rad) continue;
    vec3 ld = d / max(dist, 0.001);
    float att = 1.0 - dist / rad; att *= att;
    float cone = 1.0;
    if (uLD[i].w > -1.0) cone = smoothstep(uLD[i].w, uLD[i].w + 0.18, dot(-ld, uLD[i].xyz));
    float df = max(dot(n, ld), 0.0) * 0.8 + 0.2;
    vec3 c = lc * att * cone * df;
    if (uSpec > 0.0) c += lc * att * cone * pow(max(dot(n, normalize(ld + V)), 0.0), 28.0) * uSpec * 0.9;
    dyn += c;
  }
  dyn = min(dyn * 1.45, vec3(1.1));                                                   // stronger dynamic light against the darker ambient
  col += base * dyn * 1.0 * uBright + dyn * 0.03 * uBright;
  if (uSpec > 0.0) {
    vec3 H = normalize(L + V);
    col += uSunCol * pow(max(dot(n, H), 0.0), 36.0) * uSpec * (0.25 + 0.75 * sh) * uBright;
    float ndv = max(dot(n, V), 0.0);
    vec3 Rv = reflect(-V, n);                                                         // image-based-lighting stand-in: reflect the view into a sky/ground gradient with a sun glint
    vec3 env = mix(uGnd * 0.8, uSky * 1.35, smoothstep(-0.15, 0.45, Rv.y)) + uSunCol * pow(max(dot(Rv, L), 0.0), 48.0) * 2.0;
    float fres = 0.04 + 0.7 * pow(1.0 - ndv, 5.0);                                     // Schlick fresnel
    col += env * fres * uSpec * 0.55 * (0.35 + 0.65 * sh) * uBright;
  }
  if (uRim > 0.0) {                                                                   // TF2-style rim light
    float rim = pow(1.0 - max(dot(n, V), 0.0), 2.6) * smoothstep(-0.2, 0.6, dot(n, L) + 0.35);
    col += (uSky * 0.7 + uSunCol * 0.45) * rim * uRim * uBright;
  }
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.14);                                                    // colour grade: richer saturation
  { vec3 x = col * 1.12;                                                              // filmic tone-map (ACES fit): rolls off highlights, deepens shadows
    col = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  col *= uDark;                                                                       // every map about 20% darker after tone-mapping (so bright, saturated maps darken too); lamps and glow are exempt
  col = mix(col, base * uBright, uEmit);
  col += vec3(uFlash);
  if (uFogOn > 0.5) {
    float d = length(vWorld - uCam);
    float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
    float sunAmt = pow(max(dot(normalize(vWorld - uCam), normalize(uSun)), 0.0), 6.0);   // forward scattering: haze warms and brightens toward the sun
    vec3 fogC = uFog + uSunCol * sunAmt * 0.22;
    col = mix(col, fogC, f * f * (3.0 - 2.0 * f));
  }
  gl_FragColor = vec4(col, uAlpha);
}`;

const SH_VS = `
attribute vec3 aPos; uniform mat4 uLightVP;
void main(){ gl_Position = uLightVP * vec4(aPos, 1.0); }`;
const SH_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
vec4 packD(float d){
  vec4 enc = vec4(1.0, 255.0, 65025.0, 16581375.0) * clamp(d, 0.0, 0.99999);
  enc = fract(enc);
  enc -= enc.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0);
  return enc;
}
void main(){ gl_FragColor = packD(gl_FragCoord.z); }`;

const SKY_VS = `attribute vec2 aP; varying vec2 vP; void main(){ vP = aP; gl_Position = vec4(aP, 0.9999, 1.0); }`;
const SKY_FS = `
precision mediump float;
varying vec2 vP;
uniform mat3 uCamRot; uniform float uTan; uniform float uAspect; uniform float uTime;
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform float uBright; uniform float uCloud;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.0, w = 0.5; for (int i = 0; i < 5; i++) { a += vn(p) * w; p = p * 2.03 + 11.7; w *= 0.5; } return a; }
void main(){
  vec3 d = normalize(uCamRot * vec3(vP.x * uAspect * uTan, vP.y * uTan, -1.0));
  float t = clamp(d.y, -0.3, 1.0);
  vec3 col = mix(uHor, uTop, pow(smoothstep(0.0, 0.8, t), 0.8));
  col = mix(col, uHor * 0.85, smoothstep(0.0, -0.3, d.y));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.22) * 0.9 + vec2(uTime * 0.012, 0.0);
    float c = smoothstep(0.46, 0.8, fbm(cp * 1.4)) * uCloud;
    vec3 cc = mix(vec3(0.82, 0.85, 0.9), vec3(1.0, 0.97, 0.9), pow(s, 3.0));
    col = mix(col, cc * (0.8 + 0.25 * fbm(cp * 3.0)), c * smoothstep(0.0, 0.22, d.y) * 0.85);
  }
  col += vec3(1.0, 0.92, 0.75) * (pow(s, 700.0) * 1.6 + pow(s, 8.0) * 0.14);
  gl_FragColor = vec4(col * uBright, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  (attribs || []).forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const STRIDE_B = G.STRIDE * 4;
const SHADOW_SIZE = 2048;
const shade = (c, k) => c.map(v => Math.max(0, Math.min(1.4, v * k)));

export function createRenderer(canvas, opts = {}) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL is not available in this browser.');
  const main = program(gl, VS, FS, ['aPos', 'aNor', 'aCol', 'aUV']);
  const sky = program(gl, SKY_VS, SKY_FS, ['aP']);
  const shp = program(gl, SH_VS, SH_FS, ['aPos']);
  const U = main.u;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

  // ---- textures
  const tex = {};
  function uploadTextures(quality) {
    const cvs = buildTextures(quality);
    for (const [name, cv] of Object.entries(cvs)) {
      if (tex[name]) gl.deleteTexture(tex[name]);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      tex[name] = t;
    }
  }
  uploadTextures(opts.quality || 'high');

  // ---- shadow map (depth packed into RGBA8 so no extensions are needed)
  const shTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_SIZE, SHADOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const shFbo = gl.createFramebuffer(), shDepth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, shDepth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_SIZE, SHADOW_SIZE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shDepth);
  const shadowOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.activeTexture(gl.TEXTURE0);

  // ---- shared meshes
  const mkMesh = (data) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return { buf, count: data.length / G.STRIDE }; };
  const meshes = { cube: mkMesh(G.genCube()), sphere: mkMesh(G.genSphere(20, 12)), cyl: mkMesh(G.genCylinder(20)), cone: mkMesh(G.genCone(18)), disc: mkMesh(G.genDisc(24)), sphereLo: mkMesh(G.genSphere(8, 5)), sphereMid: mkMesh(G.genSphere(12, 8)) };
  const cacheMesh = new Map();
  function cached(key, make) {
    let m = cacheMesh.get(key);
    if (!m) { if (cacheMesh.size > 500) { for (const [k, v] of cacheMesh) { gl.deleteBuffer(v.buf); cacheMesh.delete(k); break; } } m = mkMesh(make()); cacheMesh.set(key, m); }
    return m;
  }
  const scaledCube = (hx, hy, hz) => cached(`sc${hx.toFixed(3)},${hy.toFixed(3)},${hz.toFixed(3)}`, () => { const m = Float32Array.from(G.genCube()); for (let i = 0; i < m.length; i += G.STRIDE) { m[i] *= 2 * hx; m[i + 1] *= 2 * hy; m[i + 2] *= 2 * hz; } return m; });
  const rboxMesh = (hx, hy, hz, r) => (r < 0.012 || Math.max(hx, hy, hz) < 0.035) ? scaledCube(hx, hy, hz) : cached(`rb${hx.toFixed(3)},${hy.toFixed(3)},${hz.toFixed(3)},${r.toFixed(3)}`, () => G.genRBox(hx, hy, hz, r, Infinity, Math.min(hx, hy, hz) < 0.05));
  const capsuleMesh = (r, len) => cached(`cp${r.toFixed(3)},${len.toFixed(3)}`, () => G.genCapsule(r, len));
  const loftMesh = (key, make) => cached('lf' + key, make);
  const frustumMesh = (rt, rb) => cached(`fr${rt.toFixed(3)},${rb.toFixed(3)}`, () => G.genFrustum(rt, rb, 16, true));

  const skyBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const lineBuf = gl.createBuffer();
  const aP = gl.getAttribLocation(sky.p, 'aP');

  const state = { tris: 0, groups: [], theme: null, vp: M4.ident(), cam: [0, 0, 0], bright: 1, fogOn: 1, lightVP: M4.ident(), time: 0, shadowQ: 1, fogScale: 1, curTex: '' };
  const model = M4.ident(), rot = new Float32Array(9), tmpR = new Float32Array(9);
  const IDENT = M4.ident(), IDENT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  function bindMesh(m) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE_B, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE_B, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, STRIDE_B, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STRIDE_B, 36);
  }
  function setTex(name) {
    if (state.curTex === name) return;
    state.curTex = name; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[name] || tex.plain);
  }

  // ---- map
  function lightMatrix(sun, ext) {
    const L = norm3(sun); let up = [0, 1, 0]; if (Math.abs(L[1]) > 0.97) up = [1, 0, 0];
    const Rt = norm3(cross3(up, L)), Up = cross3(L, Rt);
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
    for (const x of [ext.x0, ext.x1]) for (const y of [ext.y0, ext.y1]) for (const z of [ext.z0, ext.z1]) {
      const lx = Rt[0] * x + Rt[1] * y + Rt[2] * z, ly = Up[0] * x + Up[1] * y + Up[2] * z, lz = L[0] * x + L[1] * y + L[2] * z;
      mnx = Math.min(mnx, lx); mxx = Math.max(mxx, lx); mny = Math.min(mny, ly); mxy = Math.max(mxy, ly); mnz = Math.min(mnz, lz); mxz = Math.max(mxz, lz);
    }
    const sx = 2 / (mxx - mnx), sy = 2 / (mxy - mny), sz = 2 / (mxz - mnz), m = new Float32Array(16);
    m[0] = Rt[0] * sx; m[4] = Rt[1] * sx; m[8] = Rt[2] * sx; m[12] = -mnx * sx - 1;
    m[1] = Up[0] * sy; m[5] = Up[1] * sy; m[9] = Up[2] * sy; m[13] = -mny * sy - 1;
    m[2] = -L[0] * sz; m[6] = -L[1] * sz; m[10] = -L[2] * sz; m[14] = mxz * sz - 1;
    m[15] = 1;
    return m;
  }

  function setMap(map) {
    if (state.mapRef === map && state.groups.length) return;                    // same arena as last match: the baked mesh and shadow map are still valid
    state.mapRef = map;
    for (const g of state.groups) gl.deleteBuffer(g.buf);
    state.groups = [];
    const groups = buildMapMesh(map);
    let maxY = 6;
    for (const b of map.boxes) maxY = Math.max(maxY, b.y1);
    for (const [mat, arr] of Object.entries(groups)) {
      if (!arr.length) continue;
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      state.groups.push({ mat, tex: mat === 'ceil' ? 'concrete' : mat, noShadow: mat === 'ceil', buf, count: arr.length / G.STRIDE, emit: mat === 'glow' ? 1 : 0 });
    }
    state.theme = map.theme;
    state.lightVP = lightMatrix(map.theme.sun, { x0: -31, x1: 31, y0: -1.5, y1: Math.max(maxY, 9) + 3, z0: -31, z1: 31 });
    if (shadowOk) renderShadow();
  }

  function renderShadow() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shFbo); gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    gl.useProgram(shp.p); gl.uniformMatrix4fv(shp.u.uLightVP, false, state.lightVP);
    for (const g of state.groups) {
      if (g.noShadow) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE_B, 0);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2); gl.disableVertexAttribArray(3);
      gl.drawArrays(gl.TRIANGLES, 0, g.count);
    }
    gl.cullFace(gl.BACK); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
  }

  const NLIGHT = 8, LP = new Float32Array(NLIGHT * 4), LC = new Float32Array(NLIGHT * 3), LD = new Float32Array(NLIGHT * 4);
  function uploadLights(off) {
    gl.uniform4fv(U['uLP[0]'], LP); gl.uniform3fv(U['uLC[0]'], off ? new Float32Array(NLIGHT * 3) : LC); gl.uniform4fv(U['uLD[0]'], LD);
  }
  /** Set up to 8 dynamic lights: { x,y,z, r (radius), c:[r,g,b] (already scaled by intensity), dir:[x,y,z]|null, cone (cos half-angle) }. */
  function setLights(list) {
    LP.fill(0); LC.fill(0); LD.fill(0); for (let i = 0; i < NLIGHT; i++) LD[i * 4 + 3] = -2;
    for (let i = 0; i < Math.min(NLIGHT, list.length); i++) {
      const l = list[i]; LP.set([l.x, l.y, l.z, l.r], i * 4); LC.set(l.c, i * 3);
      if (l.dir) LD.set([l.dir[0], l.dir[1], l.dir[2], l.cone ?? 0.8], i * 4);
    }
    gl.useProgram(main.p); uploadLights(false);
  }
  function setCommon(dim) {
    const t = state.theme, light = t.light * dim;
    gl.uniform3fv(U.uSun, t.sun);
    gl.uniform3fv(U.uSunCol, [0.82 * (dim < 1 ? 0.55 : 1), 0.76 * (dim < 1 ? 0.6 : 1), 0.62 * (dim < 1 ? 0.7 : 1)]);
    gl.uniform3fv(U.uSky, t.sky.map(c => 0.34 + c * 0.55));
    gl.uniform3fv(U.uGnd, t.fog.map(c => 0.2 + c * 0.32));
    gl.uniform3fv(U.uFog, t.fog.map(c => c * dim * 0.88));
    gl.uniform2f(U.uFogRange, t.fogNear * (dim < 1 ? 0.7 : 1) * state.fogScale, t.fogFar * (dim < 1 ? 0.7 : 1) * state.fogScale);
    gl.uniform1f(U.uLight, light); gl.uniform1f(U.uBright, state.bright); gl.uniform1f(U.uDark, 0.8);
    gl.uniform3fv(U.uCam, state.cam); gl.uniform1f(U.uFlash, 0); gl.uniform1f(U.uSpec, 0); gl.uniform1f(U.uUVMul, 1);
    gl.uniform3f(U.uInvS, 1, 1, 1);
    gl.uniform1f(U.uRim, 0.12); gl.uniform1f(U.uOutlineOn, 0); gl.uniform1f(U.uOutline, 0); state.outlineW = 0; state.inVM = false; resetUC();
  }

  function resize(w, h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }

  /** Start a frame: clear, draw sky and the static map. cam = {x,y,z,yaw,pitch,roll,fov}. */
  function begin(cam, o = {}) {
    const w = canvas.width, h = canvas.height, aspect = w / h;
    state.cam = [cam.x, cam.y, cam.z]; state.bright = o.brightness || 1; state.fogScale = o.fogScale || 1; state.time = o.time || 0;
    state.shadowQ = o.shadowQuality === 0 ? 0 : 1;
    const dim = o.weather === 'rain' ? 0.72 : 1;
    const proj = M4.perspective(M4.ident(), cam.fov, aspect, 0.06, 400);
    state.hideCeil = !!cam.orbit || cam.y > 10;
    const view = M4.view(M4.ident(), cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll || 0);
    M4.mul(state.vp, proj, view);
    state.dim = dim; state.curTex = '';
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(sky.p);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    gl.uniformMatrix3fv(sky.u.uCamRot, false, new Float32Array([cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp]));
    gl.uniform1f(sky.u.uTan, Math.tan(cam.fov / 2)); gl.uniform1f(sky.u.uAspect, aspect); gl.uniform1f(sky.u.uTime, state.time);
    const t = state.theme;
    gl.uniform3fv(sky.u.uTop, t.sky.map(c => c * 0.8 * dim)); gl.uniform3fv(sky.u.uHor, t.fog.map(c => c * dim));
    gl.uniform3fv(sky.u.uSunDir, t.sun); gl.uniform1f(sky.u.uBright, state.bright); gl.uniform1f(sky.u.uCloud, t.light > 0.9 ? (dim < 1 ? 1.2 : 0.8) : 0.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(aP);
    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);

    // map
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.useProgram(main.p);
    gl.uniformMatrix4fv(U.uVP, false, state.vp); gl.uniformMatrix4fv(U.uLightVP, false, state.lightVP);
    gl.uniformMatrix4fv(U.uModel, false, IDENT); gl.uniformMatrix3fv(U.uRot, false, IDENT3);
    gl.uniform1i(U.uTex, 0); gl.uniform1i(U.uShadow, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shTex); gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(U.uFogOn, 1); gl.uniform1f(U.uEmit, 0); gl.uniform1f(U.uAlpha, 1); gl.uniform1f(U.uUseTint, 0);
    gl.uniform1f(U.uShadowOn, shadowOk ? 1 : 0); gl.uniform1f(U.uShadowTexel, 1 / SHADOW_SIZE); gl.uniform1f(U.uShadowQ, state.shadowQ);
    setCommon(dim);
    for (const g of state.groups) {
      if (g.noShadow && state.hideCeil) continue;
      setTex(g.tex || g.mat); gl.uniform1f(U.uEmit, g.emit); gl.uniform1f(U.uMicro, g.emit ? 0 : (MICRO[g.mat] ?? 0.2)); gl.uniform1f(U.uSpec, g.emit ? 0 : (SPEC[g.mat] ?? 0));
      bindMesh(g); gl.drawArrays(gl.TRIANGLES, 0, g.count);
    }
    gl.uniform1f(U.uMicro, 0); gl.uniform1f(U.uSpec, 0); gl.uniform1f(U.uEmit, 0); resetUC();
    setTex('plain'); boundMesh = null;
  }

  // ---- dynamic drawing
  function setModel(x, y, z, R, sx, sy, sz) {
    model[0] = R[0] * sx; model[1] = R[1] * sx; model[2] = R[2] * sx; model[3] = 0;
    model[4] = R[3] * sy; model[5] = R[4] * sy; model[6] = R[5] * sy; model[7] = 0;
    model[8] = R[6] * sz; model[9] = R[7] * sz; model[10] = R[8] * sz; model[11] = 0;
    model[12] = x; model[13] = y; model[14] = z; model[15] = 1;
    gl.uniformMatrix4fv(U.uModel, false, model); gl.uniformMatrix3fv(U.uRot, false, R);
    gl.uniform3f(U.uInvS, 1 / sx, 1 / sy, 1 / sz);
  }
  let boundMesh = null;
  // per-draw uniform state is cached so unchanged values cost no GL calls (a soldier is ~150 draws)
  const uc = { tint: false, emit: -1, alpha: -1, flash: -1, spec: -1, r: -1, g: -1, b: -1, sx: 0, sy: 0, sz: 0, outW: -1 };
  const resetUC = () => { uc.tint = false; uc.emit = uc.alpha = uc.flash = uc.spec = uc.r = uc.g = uc.b = uc.sx = uc.sy = uc.sz = uc.outW = -1; };
  function drawMesh(m, x, y, z, R, sx, sy, sz, col, emit = 0, alpha = 1, spec = 0, flash = 0) {
    if (boundMesh !== m) { bindMesh(m); boundMesh = m; }
    setModel(x, y, z, R || IDENT3, sx, sy, sz);
    if (!uc.tint) { gl.uniform1f(U.uUseTint, 1); uc.tint = true; }
    if (col[0] !== uc.r || col[1] !== uc.g || col[2] !== uc.b) { gl.uniform3fv(U.uTint, col); uc.r = col[0]; uc.g = col[1]; uc.b = col[2]; }
    if (emit !== uc.emit) { gl.uniform1f(U.uEmit, emit); uc.emit = emit; }
    if (alpha !== uc.alpha) { gl.uniform1f(U.uAlpha, alpha); uc.alpha = alpha; }
    if (flash !== uc.flash) { gl.uniform1f(U.uFlash, flash); uc.flash = flash; }
    if (spec !== uc.spec) { gl.uniform1f(U.uSpec, spec); uc.spec = spec; }
    gl.drawArrays(gl.TRIANGLES, 0, m.count); state.tris += m.count / 3;
    if (state.outlineW > 0 && alpha > 0.99 && emit < 0.6 && !state.inVM) {          // inverted-hull outline
      gl.cullFace(gl.FRONT); gl.uniform1f(U.uOutlineOn, 1); gl.uniform1f(U.uOutline, state.outlineW);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
      gl.uniform1f(U.uOutlineOn, 0); gl.uniform1f(U.uOutline, 0); gl.cullFace(gl.BACK);
    }
  }
  /** Draw a pre-baked mesh whose colours live in its vertices (no tint). */
  function drawBaked(m, x, y, z, Rm, spec = 0, emit = 0, sc = 1) {
    if (boundMesh !== m) { bindMesh(m); boundMesh = m; }
    setModel(x, y, z, Rm || IDENT3, sc, sc, sc);
    gl.uniform1f(U.uUseTint, 0); gl.uniform1f(U.uEmit, emit); gl.uniform1f(U.uAlpha, 1); gl.uniform1f(U.uFlash, 0); gl.uniform1f(U.uSpec, spec);
    gl.drawArrays(gl.TRIANGLES, 0, m.count); state.tris += m.count / 3;
    gl.uniform1f(U.uUseTint, 1); uc.tint = true; uc.emit = emit; uc.alpha = 1; uc.flash = 0; uc.spec = spec;
  }
  /** Set the dynamic-object look: outline width (metres, 0 = off) and rim-light strength. */
  function style(o = {}) { state.outlineW = o.outline || 0; gl.uniform1f(U.uRim, o.rim || 0); }
  const rotate = (yaw, pitch, roll = 0) => G.rotYXZ(rot, yaw, pitch, roll);

  /** Sharp box: centre, size, yaw (+pitch about its centre), colour, emissive 0..1, alpha. */
  function box(x, y, z, sx, sy, sz, yaw, pitch, col, emit = 0, alpha = 1, flash = 0) {
    drawMesh(meshes.cube, x, y, z, rotate(yaw, pitch), sx, sy, sz, col, emit, alpha, 0, flash);
  }
  /** Box with a rounded bevel (radius in metres). */
  function rbox(x, y, z, sx, sy, sz, yaw, pitch, col, r = 0.02, emit = 0, alpha = 1, spec = 0, roll = 0) {
    drawMesh(rboxMesh(sx / 2, sy / 2, sz / 2, r), x, y, z, rotate(yaw, pitch, roll), 1, 1, 1, col, emit, alpha, spec);
  }
  /** Box whose local frame is a full 3x3 rotation (attached parts / view-model). */
  function boxRot(x, y, z, sx, sy, sz, R, col, emit = 0, alpha = 1) { drawMesh(meshes.cube, x, y, z, R, sx, sy, sz, col, emit, alpha); }
  /** Capsule limb between two points. */
  function limb(ax, ay, az, bx, by, bz, r, col, spec = 0) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    drawMesh(capsuleMesh(r, Math.max(0.001, len - 2 * r)), (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, G.alignY(tmpR, dx, dy, dz), 1, 1, 1, col, 0, 1, spec);
  }
  /** Cylinder (or cone) between two points. */
  function tube(ax, ay, az, bx, by, bz, r0, r1, col, spec = 0, emit = 0, alpha = 1) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const m = Math.abs(r0 - r1) < 1e-4 ? meshes.cyl : frustumMesh(r1 / Math.max(r0, 1e-4), 1);
    // frustum mesh: unit height, bottom radius 1 (scaled to r0), top radius r1/r0; +Y points from a towards b
    drawMesh(m, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, G.alignY(tmpR, dx, dy, dz), r0, len, r0, col, emit, alpha, spec);
  }
  /** Draw a unit-length (y in [-0.5,0.5]) mesh stretched between two points; sr scales its radius. */
  function span(m, ax, ay, az, bx, by, bz, sr, col, spec = 0, emit = 0) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    drawMesh(m, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, G.alignY(tmpR, dx, dy, dz), sr, len, sr, col, emit, 1, spec);
  }
  function sphere(x, y, z, rx, ry, rz, col, emit = 0, alpha = 1, spec = 0, yaw = 0, pitch = 0) { const mr = Math.max(rx, ry, rz); drawMesh(mr < 0.03 ? meshes.sphereLo : mr < 0.09 ? meshes.sphereMid : meshes.sphere, x, y, z, rotate(yaw, pitch), rx, ry, rz, col, emit, alpha, spec); }
  function blob(x, y, z, r, alpha) { drawMesh(meshes.disc, x, y + 0.02, z, IDENT3, r, 1, r, [0, 0, 0], 0, alpha); }
  function texture(name, uvMul = 1) { setTex(name || 'plain'); gl.uniform1f(U.uUVMul, uvMul); }

  /** Switch to blended, non-depth-writing mode for particles / beams. */
  function transparent(on) {
    if (on) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE); }
    else { gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE); }
  }

  /** World-space line list [x,y,z,x,y,z,...] in one colour. */
  function lines(data, count, col, alpha) {
    gl.uniformMatrix4fv(U.uModel, false, IDENT); gl.uniformMatrix3fv(U.uRot, false, IDENT3); gl.uniform3f(U.uInvS, 1, 1, 1);
    setTex('plain');
    gl.uniform1f(U.uUseTint, 1); gl.uniform3fv(U.uTint, col); gl.uniform1f(U.uEmit, 1); gl.uniform1f(U.uAlpha, alpha); resetUC();
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
    gl.vertexAttrib3f(1, 0, 1, 0); gl.vertexAttrib3f(2, 1, 1, 1); gl.vertexAttrib2f(3, 0, 0);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.drawArrays(gl.LINES, 0, count * 2);
    boundMesh = null;
  }

  /** Draw in camera space after clearing depth (first-person weapon). */
  function beginViewmodel(fov) {
    state.inVM = true; gl.uniform1f(U.uRim, 0.35); uploadLights(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = M4.perspective(M4.ident(), fov, canvas.width / canvas.height, 0.02, 20);
    gl.uniformMatrix4fv(U.uVP, false, proj);
    gl.uniform1f(U.uFogOn, 0); gl.uniform1f(U.uShadowOn, 0);
    gl.uniform3fv(U.uCam, [0, 0, 0]);
    gl.uniform3fv(U.uSun, [0.35, 0.8, 0.55]);
    gl.uniform1f(U.uLight, Math.max(1.0, state.theme.light) * (state.dim < 1 ? 0.85 : 1)); gl.uniform1f(U.uDark, 0.95);   // the gun in your hands stays close to its old brightness so it reads against the darker world
  }
  function endViewmodel() {
    state.inVM = false; gl.uniform1f(U.uRim, 0.12); uploadLights(false);
    gl.uniformMatrix4fv(U.uVP, false, state.vp); gl.uniform1f(U.uFogOn, 1); gl.uniform1f(U.uShadowOn, shadowOk ? 1 : 0);
    gl.uniform3fv(U.uCam, state.cam); gl.uniform3fv(U.uSun, state.theme.sun); gl.uniform1f(U.uSpec, 0); setCommonLight(); resetUC();
  }
  function setCommonLight() { gl.uniform1f(U.uLight, state.theme.light * state.dim); gl.uniform1f(U.uDark, 0.8); }

  /** Project a world point to screen pixels (CSS-independent canvas coords). Returns null if behind the camera. */
  function project(x, y, z) {
    const m = state.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.05) return null;
    return { x: (cx / cw * 0.5 + 0.5) * canvas.width, y: (1 - (cy / cw * 0.5 + 0.5)) * canvas.height, w: cw };
  }

  return { gl, setMap, resize, begin, box, rbox, boxRot, limb, tube, sphere, blob, texture, rotate, drawMesh, meshes, rboxMesh, capsuleMesh,
    transparent, lines, style, loftMesh, drawBaked, setLights, span, beginViewmodel, endViewmodel, project, state, shadowOk, uploadTextures };
}

const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
