// Minimal dependency-free WebGL1 renderer. Everything in the game is built from boxes, so this only needs:
//  - a static batched mesh for the map,
//  - an instanced-by-uniform unit cube for players / pickups / effects,
//  - a sky gradient pass, fog, simple lighting and a line pass (rain).

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
const EMISSIVE_MATS = new Set(['glow']);

const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;
uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uRot;
varying vec3 vWorld; varying vec3 vNor; varying vec3 vCol;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vWorld = w.xyz; vNor = uRot * aNor; vCol = aCol;
  gl_Position = uVP * w;
}`;

const FS = `
precision mediump float;
varying vec3 vWorld; varying vec3 vNor; varying vec3 vCol;
uniform vec3 uTint; uniform float uUseTint; uniform float uEmit; uniform float uAlpha; uniform float uPattern;
uniform vec3 uSun; uniform vec3 uFog; uniform vec2 uFogRange; uniform vec3 uCam; uniform float uFogOn;
uniform float uBright; uniform float uLight; uniform float uFlash;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
void main(){
  vec3 n = normalize(vNor);
  vec3 base = mix(vCol, uTint, uUseTint);
  if (uPattern > 0.5) {
    vec3 an = abs(n); vec2 uv;
    if (an.y > 0.7) uv = vWorld.xz; else if (an.x > an.z) uv = vec2(vWorld.z, vWorld.y); else uv = vec2(vWorld.x, vWorld.y);
    vec2 g = abs(fract(uv * 0.5) - 0.5);
    float seam = smoothstep(0.47, 0.5, max(g.x, g.y));
    float grain = hash(floor(uv * 6.0)) * 0.07;
    base *= (1.0 - 0.22 * seam) * (0.96 + grain);
    if (an.y < 0.7) base *= 0.78 + 0.22 * smoothstep(0.0, 2.2, vWorld.y);
  }
  float diff = max(dot(n, normalize(uSun)), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float lit = (0.34 + 0.30 * hemi) * uLight + 0.62 * diff * uLight;
  vec3 col = base * lit * uBright;
  col = mix(col, base * uBright, uEmit);
  col += vec3(uFlash);
  if (uFogOn > 0.5) {
    float d = length(vWorld - uCam);
    float f = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
    col = mix(col, uFog, f * f * (3.0 - 2.0 * f));
  }
  gl_FragColor = vec4(col, uAlpha);
}`;

const SKY_VS = `attribute vec2 aP; varying vec2 vP; void main(){ vP = aP; gl_Position = vec4(aP, 0.9999, 1.0); }`;
const SKY_FS = `
precision mediump float;
varying vec2 vP;
uniform mat3 uCamRot; uniform float uTan; uniform float uAspect;
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform float uBright;
void main(){
  vec3 d = normalize(uCamRot * vec3(vP.x * uAspect * uTan, vP.y * uTan, -1.0));
  float t = clamp(d.y, -0.3, 1.0);
  vec3 col = mix(uHor, uTop, smoothstep(0.0, 0.75, t));
  col = mix(col, uHor * 0.85, smoothstep(0.0, -0.3, d.y));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 1.4 + pow(s, 8.0) * 0.12);
  gl_FragColor = vec4(col * uBright, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

// unit cube centred on the origin, 36 verts of pos(3) nor(3) col(3)
const FACES = [
  { n: [1, 0, 0], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], s: 0.88 },
  { n: [-1, 0, 0], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]], s: 0.88 },
  { n: [0, 1, 0], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], s: 1.0 },
  { n: [0, -1, 0], v: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]], s: 0.6 },
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], s: 0.94 },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], s: 0.94 },
];
function pushBox(arr, x0, y0, z0, x1, y1, z1, col, shade = 1) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
  for (const f of FACES) {
    const q = f.v.map(v => [cx + v[0] * hx, cy + v[1] * hy, cz + v[2] * hz]);
    for (const i of [0, 1, 2, 0, 2, 3]) arr.push(q[i][0], q[i][1], q[i][2], f.n[0], f.n[1], f.n[2], col[0] * f.s * shade, col[1] * f.s * shade, col[2] * f.s * shade);
  }
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL is not available in this browser.');
  const main = program(gl, VS, FS);
  const sky = program(gl, SKY_VS, SKY_FS);
  const U = main.u;

  const cube = []; pushBox(cube, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5, [1, 1, 1]);
  const cubeBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cube), gl.STATIC_DRAW);
  const skyBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const lineBuf = gl.createBuffer();

  const aPos = gl.getAttribLocation(main.p, 'aPos'), aNor = gl.getAttribLocation(main.p, 'aNor'), aCol = gl.getAttribLocation(main.p, 'aCol');
  const aP = gl.getAttribLocation(sky.p, 'aP');

  const state = { mapBuf: null, mapCount: 0, theme: null, vp: M4.ident(), cam: [0, 0, 0], bright: 1, fogOn: 1 };
  const model = M4.ident(), rot = new Float32Array(9), tmpVP = M4.ident();
  const IDENT = M4.ident(), IDENT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  function bindMesh(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(aNor); gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 36, 24);
  }

  function setMap(map) {
    const arr = [];
    map.boxes.forEach((b, i) => {
      if (b.y1 - b.y0 < 0.001) return;
      const base = MATERIALS[b.mat] || MATERIALS.wall;
      const v = 0.94 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.12;
      pushBox(arr, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, base.map(c => Math.min(1, c * v)));
    });
    if (state.mapBuf) gl.deleteBuffer(state.mapBuf);
    state.mapBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, state.mapBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    state.mapCount = arr.length / 9;
    state.theme = map.theme;
    // glowing boxes get the emissive flag via a second pass (rare) - collect them
    state.glow = map.boxes.filter(b => EMISSIVE_MATS.has(b.mat));
  }

  function setCommon(weatherDim) {
    const t = state.theme;
    const fog = t.fog.map(c => c * weatherDim);
    gl.uniform3fv(U.uSun, t.sun); gl.uniform3fv(U.uFog, fog);
    gl.uniform2f(U.uFogRange, t.fogNear * (weatherDim < 1 ? 0.7 : 1) * state.fogScale, t.fogFar * (weatherDim < 1 ? 0.7 : 1) * state.fogScale);
    gl.uniform1f(U.uLight, t.light * weatherDim); gl.uniform1f(U.uBright, state.bright);
    gl.uniform3fv(U.uCam, state.cam); gl.uniform1f(U.uFlash, 0);
  }
  state.fogScale = 1;

  function resize(w, h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }

  /** Start a frame: clear, draw sky and static map. cam = {x,y,z,yaw,pitch,roll,fov}. */
  function begin(cam, opts = {}) {
    const w = canvas.width, h = canvas.height, aspect = w / h;
    state.cam = [cam.x, cam.y, cam.z]; state.bright = opts.brightness || 1; state.fogScale = opts.fogScale || 1;
    const dim = opts.weather === 'rain' ? 0.72 : 1;
    const proj = M4.perspective(M4.ident(), cam.fov, aspect, 0.06, 400);
    const view = M4.view(M4.ident(), cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll || 0);
    M4.mul(state.vp, proj, view);
    state.dim = dim;
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(sky.p);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // camera->world rotation (columns: right, up, back)
    const R = [cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp];
    gl.uniformMatrix3fv(sky.u.uCamRot, false, new Float32Array(R));
    gl.uniform1f(sky.u.uTan, Math.tan(cam.fov / 2)); gl.uniform1f(sky.u.uAspect, aspect);
    const t = state.theme;
    gl.uniform3fv(sky.u.uTop, t.sky.map(c => c * 0.8 * dim)); gl.uniform3fv(sky.u.uHor, t.fog.map(c => c * dim));
    gl.uniform3fv(sky.u.uSunDir, t.sun); gl.uniform1f(sky.u.uBright, state.bright);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(aP);

    // map
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.useProgram(main.p);
    gl.uniformMatrix4fv(U.uVP, false, state.vp);
    gl.uniformMatrix4fv(U.uModel, false, IDENT); gl.uniformMatrix3fv(U.uRot, false, IDENT3);
    gl.uniform1f(U.uFogOn, 1); gl.uniform1f(U.uEmit, 0); gl.uniform1f(U.uAlpha, 1); gl.uniform1f(U.uUseTint, 0); gl.uniform1f(U.uPattern, 1);
    setCommon(dim);
    bindMesh(state.mapBuf);
    gl.drawArrays(gl.TRIANGLES, 0, state.mapCount);
    // emissive boxes (reactor core)
    if (state.glow.length) {
      bindMesh(cubeBuf); gl.uniform1f(U.uPattern, 0);
      for (const b of state.glow) box((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, 0, 0, MATERIALS.glow, 1, 1);
    }
    bindMesh(cubeBuf); gl.uniform1f(U.uPattern, 0);
  }

  /** Draw a box: centre, size, yaw (+ optional pitch about its centre), colour, emissive 0..1, alpha. */
  function box(x, y, z, sx, sy, sz, yaw, pitch, col, emit = 0, alpha = 1, flash = 0) {
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ry * Rx
    const r00 = cy, r01 = sy_ * sp, r02 = sy_ * cp;
    const r10 = 0, r11 = cp, r12 = -sp;
    const r20 = -sy_, r21 = cy * sp, r22 = cy * cp;
    model[0] = r00 * sx; model[1] = r10 * sx; model[2] = r20 * sx; model[3] = 0;
    model[4] = r01 * sy; model[5] = r11 * sy; model[6] = r21 * sy; model[7] = 0;
    model[8] = r02 * sz; model[9] = r12 * sz; model[10] = r22 * sz; model[11] = 0;
    model[12] = x; model[13] = y; model[14] = z; model[15] = 1;
    rot[0] = r00; rot[1] = r10; rot[2] = r20; rot[3] = r01; rot[4] = r11; rot[5] = r21; rot[6] = r02; rot[7] = r12; rot[8] = r22;
    gl.uniformMatrix4fv(U.uModel, false, model); gl.uniformMatrix3fv(U.uRot, false, rot);
    gl.uniform1f(U.uUseTint, 1); gl.uniform3fv(U.uTint, col);
    gl.uniform1f(U.uEmit, emit); gl.uniform1f(U.uAlpha, alpha); gl.uniform1f(U.uFlash, flash);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }

  /** Box whose local frame is given as a full 3x3 rotation (used for the view-model and attached parts). */
  function boxRot(x, y, z, sx, sy, sz, R, col, emit = 0, alpha = 1) {
    model[0] = R[0] * sx; model[1] = R[1] * sx; model[2] = R[2] * sx; model[3] = 0;
    model[4] = R[3] * sy; model[5] = R[4] * sy; model[6] = R[5] * sy; model[7] = 0;
    model[8] = R[6] * sz; model[9] = R[7] * sz; model[10] = R[8] * sz; model[11] = 0;
    model[12] = x; model[13] = y; model[14] = z; model[15] = 1;
    gl.uniformMatrix4fv(U.uModel, false, model); gl.uniformMatrix3fv(U.uRot, false, R);
    gl.uniform1f(U.uUseTint, 1); gl.uniform3fv(U.uTint, col); gl.uniform1f(U.uEmit, emit); gl.uniform1f(U.uAlpha, alpha); gl.uniform1f(U.uFlash, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
  }

  /** Switch to blended, non-depth-writing mode for particles / beams. */
  function transparent(on) {
    if (on) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE); }
    else { gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE); }
  }

  /** World-space line list [x,y,z,x,y,z,...] in one colour. */
  function lines(data, count, col, alpha) {
    gl.uniformMatrix4fv(U.uModel, false, IDENT); gl.uniformMatrix3fv(U.uRot, false, IDENT3);
    gl.uniform1f(U.uUseTint, 1); gl.uniform3fv(U.uTint, col); gl.uniform1f(U.uEmit, 1); gl.uniform1f(U.uAlpha, alpha); gl.uniform1f(U.uPattern, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.disableVertexAttribArray(aNor); gl.disableVertexAttribArray(aCol);
    gl.vertexAttrib3f(aNor, 0, 1, 0); gl.vertexAttrib3f(aCol, 1, 1, 1);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0);
    gl.drawArrays(gl.LINES, 0, count * 2);
    bindMesh(cubeBuf);
  }

  /** Draw in camera space after clearing depth (first-person weapon). */
  function beginViewmodel(fov) {
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = M4.perspective(M4.ident(), fov, canvas.width / canvas.height, 0.02, 20);
    gl.uniformMatrix4fv(U.uVP, false, proj);
    gl.uniform1f(U.uFogOn, 0); gl.uniform1f(U.uPattern, 0);
    gl.uniform3fv(U.uCam, [0, 0, 0]);
  }
  function endViewmodel() { gl.uniformMatrix4fv(U.uVP, false, state.vp); gl.uniform1f(U.uFogOn, 1); }

  /** Project a world point to screen pixels (CSS-independent canvas coords). Returns null if behind the camera. */
  function project(x, y, z) {
    const m = state.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.05) return null;
    return { x: (cx / cw * 0.5 + 0.5) * canvas.width, y: (1 - (cy / cw * 0.5 + 0.5)) * canvas.height, w: cw };
  }

  return { gl, setMap, resize, begin, box, boxRot, transparent, lines, beginViewmodel, endViewmodel, project, state };
}
