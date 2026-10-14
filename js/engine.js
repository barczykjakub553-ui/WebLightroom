/* Stopbath — WebGL2 rendering engine.
 * Non-destructive pipeline: geometry (orientation, flip, crop, rotation, lens distortion)
 * -> noise reduction -> white balance -> exposure -> dehaze -> tone (contrast, highlights,
 * shadows, whites, blacks) -> clarity/texture -> presence -> tone curve -> HSL / B&W
 * -> color grading -> sharpening -> vignette -> grain. Local masks modulate parameters per pixel.
 */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const MAX_MASKS = 8;
  const LUT_SIZE = 1024;

  const VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.,1.); }`;

  const FS_COPY = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_tex; out vec4 o;
void main(){ o = texture(u_tex, v_uv); }`;

  const FS_BLUR = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_dir; uniform float u_sigma; out vec4 o;
void main(){
  vec4 acc = vec4(0.); float ws = 0.;
  float step = max(1.0, u_sigma / 4.0);
  for (int i = -12; i <= 12; i++) {
    float x = float(i) * step;
    float w = exp(-x*x / (2.0*u_sigma*u_sigma));
    acc += texture(u_tex, v_uv + u_dir * x) * w; ws += w;
  }
  o = acc / ws;
}`;

  const FS_MAIN = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src, u_blurS, u_blurM, u_blurL, u_lut;
uniform vec2 u_canvas; uniform bool u_flipY;
uniform vec2 u_viewOff; uniform float u_viewScale;
uniform vec2 u_region; uniform vec2 u_qOrigin; uniform bool u_clip;
uniform vec2 u_size; uniform float u_angle; uniform int u_orient; uniform bool u_flipH, u_flipV;
uniform float u_distort; uniform vec3 u_bg; uniform float u_pxScale;
uniform float u_temp, u_tint, u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_texture, u_clarity, u_dehaze, u_vibrance, u_saturation;
uniform vec3 u_hsl[8]; uniform float u_bwMix[8]; uniform bool u_bw;
uniform vec4 u_cgS, u_cgM, u_cgH, u_cgG; uniform float u_cgBlend, u_cgBalance;
uniform vec4 u_sharpen; uniform vec2 u_nr;
uniform vec4 u_vig; uniform float u_vigHl; uniform vec3 u_grain; uniform float u_lensVig;
uniform int u_maskCount; uniform vec4 u_mGeo[${MAX_MASKS}]; uniform vec4 u_mGeo2[${MAX_MASKS}];
uniform vec4 u_mAdj1[${MAX_MASKS}]; uniform vec4 u_mAdj2[${MAX_MASKS}];
uniform int u_showMask; uniform bool u_clipWarn; uniform bool u_bypass;

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c){ return dot(c, LW); }
vec3 s2l(vec3 c){ c = max(c, 0.); return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c){ c = max(c, 0.); return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }
float max3(vec3 c){ return max(c.r, max(c.g, c.b)); }
float min3(vec3 c){ return min(c.r, min(c.g, c.b)); }

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0., -1./3., 2./3., -1.);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.*d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(1., 2./3., 1./3.)) * 6. - 3.);
  return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y);
}

vec2 toTex(vec2 u){
  if (u_flipH) u.x = 1. - u.x;
  if (u_flipV) u.y = 1. - u.y;
  if (u_orient == 1) return vec2(u.y, 1. - u.x);
  if (u_orient == 2) return vec2(1. - u.x, 1. - u.y);
  if (u_orient == 3) return vec2(1. - u.y, u.x);
  return u;
}

float ccurve(float x, float e){
  if (x <= 0. ) return x * e;
  if (x >= 1.) return x;
  return x < 0.5 ? 0.5 * pow(2.*x, e) : 1. - 0.5 * pow(2. - 2.*x, e);
}

const float HC[9] = float[9](0., 30., 60., 120., 180., 240., 270., 300., 360.);
vec3 hslAt(float h){
  for (int i = 0; i < 8; i++) {
    if (h >= HC[i] && h < HC[i+1]) {
      float t = (h - HC[i]) / (HC[i+1] - HC[i]);
      t = t*t*(3.-2.*t);
      return mix(u_hsl[i], u_hsl[(i+1)%8], t);
    }
  }
  return u_hsl[0];
}
float bwAt(float h){
  for (int i = 0; i < 8; i++) {
    if (h >= HC[i] && h < HC[i+1]) {
      float t = (h - HC[i]) / (HC[i+1] - HC[i]);
      t = t*t*(3.-2.*t);
      return mix(u_bwMix[i], u_bwMix[(i+1)%8], t);
    }
  }
  return u_bwMix[0];
}

float maskWeight(int i, vec2 s){
  vec4 g = u_mGeo[i]; vec4 g2 = u_mGeo2[i]; float w;
  if (g2.z < 0.5) {
    vec2 p0 = g.xy * u_size, p1 = g.zw * u_size; vec2 d = p1 - p0;
    float t = dot(s - p0, d) / max(dot(d, d), 1e-6);
    w = 1. - smoothstep(0., 1., clamp(t, 0., 1.));
  } else {
    vec2 c = g.xy * u_size; vec2 r = max(g.zw * u_size, vec2(1.));
    float ca = cos(g2.w), sa = sin(g2.w);
    vec2 d = s - c; d = vec2(ca*d.x + sa*d.y, -sa*d.x + ca*d.y);
    float dist = length(d / r);
    w = 1. - smoothstep(1. - max(g2.x, 0.001), 1., dist);
  }
  if (g2.y > 0.5) w = 1. - w;
  return w;
}

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, u_flipY ? u_canvas.y - gl_FragCoord.y : gl_FragCoord.y);
  vec2 rp = (frag - u_viewOff) / u_viewScale;
  if (u_clip && (rp.x < 0. || rp.y < 0. || rp.x > u_region.x || rp.y > u_region.y)) { o = vec4(u_bg, 1.); return; }
  vec2 q = u_qOrigin + rp;
  float ca = cos(u_angle), sa = sin(u_angle);
  vec2 half_ = u_size * 0.5;
  vec2 s = half_ + vec2(ca*q.x + sa*q.y, -sa*q.x + ca*q.y);
  vec2 dd = s - half_; float r2 = dot(dd, dd) / dot(half_, half_);
  s = half_ + dd * (1. - u_distort * r2 * 0.25);
  if (s.x < 0. || s.y < 0. || s.x > u_size.x || s.y > u_size.y) { o = vec4(u_bg * (u_clip ? 1. : 0.6), 1.); return; }
  vec2 tuv = toTex(s / u_size);
  vec3 src = texture(u_src, tuv).rgb;
  if (u_bypass) { o = vec4(src, 1.); return; }
  vec3 bS = texture(u_blurS, tuv).rgb, bM = texture(u_blurM, tuv).rgb, bL = texture(u_blurL, tuv).rgb;

  // local masks
  vec4 a1 = vec4(0.), a2 = vec4(0.); float showW = 0.;
  for (int i = 0; i < ${MAX_MASKS}; i++) {
    if (i >= u_maskCount) break;
    float w = maskWeight(i, s);
    a1 += u_mAdj1[i] * w; a2 += u_mAdj2[i] * w;
    if (i == u_showMask) showW = w;
  }

  // noise reduction
  float Ls = luma(src), LbM = luma(bM), LbS = luma(bS), LbL = luma(bL);
  if (u_nr.x > 0.) {
    float diff = Ls - LbM;
    float wt = u_nr.x * exp(-diff*diff / (0.0008 + 0.012 * u_nr.x));
    float nl = mix(Ls, LbM, wt);
    src += nl - Ls; Ls = nl;
  }
  if (u_nr.y > 0.) {
    vec3 ch = src - Ls; vec3 cb = bM - LbM;
    src = Ls + mix(ch, cb, u_nr.y);
  }
  float dTex = Ls - LbM, dCla = Ls - LbL, dShp = Ls - LbS;

  // linear light: white balance, exposure, lens vignetting, dehaze
  vec3 c = s2l(src);
  float temp = u_temp + a1.x, tint = u_tint + a1.y;
  vec3 wb = vec3(exp(0.45*temp), exp(-0.35*tint), exp(-0.45*temp));
  wb /= dot(wb, LW);
  c *= wb;
  float ev = exp2(u_exposure + a1.z);
  c *= ev;
  c *= max(0., 1. + u_lensVig * r2 * 0.6);
  if (u_dehaze != 0.) {
    vec3 bl = s2l(bL) * wb * ev;
    float dark = clamp(min3(bl), 0., 1.);
    if (u_dehaze > 0.) {
      float t = max(1. - u_dehaze * 0.9 * dark, 0.2);
      float A = 0.95;
      c = (c - A * (1. - t)) / t;
      c = max(c, 0.);
    } else {
      c = mix(c, vec3(luma(c) * 0.5 + 0.45), -u_dehaze * 0.55 * (0.4 + 0.6 * dark));
    }
  }

  // perceptual tone
  vec3 x = l2s(c);
  float L = luma(x);
  float Lb = clamp(L - dCla * ev, 0., 2.);
  float k = u_contrast + a1.w;
  if (k != 0.) { float e = exp(0.62 * k); x = vec3(ccurve(x.r, e), ccurve(x.g, e), ccurve(x.b, e)); }

  float sh = u_shadows + a2.y, hl = u_highlights + a2.x;
  if (sh != 0. || hl != 0.) {
    L = luma(x);
    float Lr = mix(L, Lb, 0.55);
    float ws = 1. - smoothstep(0.0, 0.6, Lr); ws *= ws;
    float wh = smoothstep(0.3, 1.0, Lr);
    float dL = sh * 0.38 * ws + hl * (hl < 0. ? 0.42 * wh * max(L, 0.6) : 0.25 * wh);
    float nL = max(L + dL, 0.);
    vec3 scaled = x * (nL / max(L, 1e-4));
    x = mix(x + dL, scaled, smoothstep(0.01, 0.12, L));
  }
  if (u_whites != 0.) { vec3 xc = clamp(x, 0., 1.3); x += u_whites * 0.32 * xc * xc * xc; }
  if (u_blacks != 0.) { vec3 xc = clamp(1. - x, 0., 1.); x += u_blacks * 0.12 * xc * xc * xc * xc; }

  // clarity & texture
  L = luma(x);
  float cl = u_clarity + a2.w;
  if (cl != 0.) {
    float mid = 1. - pow(clamp(abs(2.*L - 1.), 0., 1.), 2.);
    x += cl * dCla * 1.4 * mid * ev;
    if (cl > 0.) x = mix(vec3(luma(x)), x, 1. + cl * 0.08);
  }
  if (u_texture != 0.) x += u_texture * dTex * 1.6;

  // presence
  L = luma(x);
  float mx = max3(x), mn = min3(x);
  float sat = (mx - mn) / max(mx, 1e-4);
  if (u_vibrance != 0.) {
    float h = rgb2hsv(clamp(x, 0., 1.)).x * 360.;
    float skin = 1. - 0.5 * smoothstep(40., 0., abs(h - 25.));
    float vf = u_vibrance > 0. ? u_vibrance * (1. - sat) * 1.1 * skin : u_vibrance;
    x = L + (x - L) * (1. + vf);
  }
  float sg = u_saturation + a2.z;
  if (sg != 0.) x = L + (x - L) * (1. + sg);
  x = clamp(x, 0., 1.);

  // tone curve (parametric + point curves baked into LUT)
  float lo = 0.5 / ${LUT_SIZE}.0, sc = (${LUT_SIZE}.0 - 1.) / ${LUT_SIZE}.0;
  x = vec3(texture(u_lut, vec2(lo + x.r*sc, 0.5)).r, texture(u_lut, vec2(lo + x.g*sc, 0.5)).g, texture(u_lut, vec2(lo + x.b*sc, 0.5)).b);
  x = clamp(x, 0., 1.);

  // HSL / B&W mix
  vec3 hsv = rgb2hsv(x);
  float hdeg = hsv.x * 360.;
  if (u_bw) {
    float g = luma(x);
    float m = bwAt(hdeg);
    g *= 1. + m * hsv.y * 0.9;
    x = vec3(clamp(g, 0., 1.));
  } else {
    vec3 adj = hslAt(hdeg);
    if (adj != vec3(0.)) {
      float s0 = hsv.y;
      hsv.x = fract(hsv.x + adj.x * 30. / 360. + 1.);
      hsv.y = clamp(hsv.y * (1. + adj.y), 0., 1.);
      x = hsv2rgb(hsv);
      x *= 1. + adj.z * 0.65 * s0;
    }
  }

  // color grading
  L = clamp(luma(x), 0., 1.);
  {
    float p = clamp(0.5 - u_cgBalance * 0.35, 0.1, 0.9);
    float bw = 0.15 + u_cgBlend * 0.55;
    float wS = 1. - smoothstep(max(p - bw, 0.) * 0.4, p + bw * 0.4, L);
    float wH = smoothstep(p - bw * 0.4, min(p + bw, 1.) + 0.2, L);
    float wM = clamp(1. - abs(L - p) / (0.3 + bw * 0.5), 0., 1.);
    x += u_cgS.rgb * wS + u_cgM.rgb * wM + u_cgH.rgb * wH + u_cgG.rgb;
    x += (u_cgS.a * wS + u_cgM.a * wM + u_cgH.a * wH + u_cgG.a) * 0.3;
  }

  // sharpening
  if (u_sharpen.x > 0.) {
    float lim = 0.03 + u_sharpen.y * 0.25;
    float d = clamp(dShp, -lim, lim);
    float m = 1.;
    if (u_sharpen.z > 0.) m = smoothstep(u_sharpen.z * 0.05, u_sharpen.z * 0.05 + 0.025, abs(dTex));
    x += u_sharpen.x * d * m * ev;
  }

  // post-crop vignette
  if (u_vig.x != 0.) {
    vec2 rr = u_clip ? rp / u_region : s / u_size;
    vec2 vp = rr * 2. - 1.;
    vec2 reg = u_clip ? u_region : u_size;
    float rnd = u_vig.z;
    if (rnd > 0.) vp *= mix(vec2(1.), reg / length(reg) * 1.41421, rnd);
    float pw = 2. + max(-rnd, 0.) * 6.;
    float d = pow(pow(abs(vp.x), pw) + pow(abs(vp.y), pw), 1. / pw);
    float rc = 0.35 + u_vig.y * 1.0;
    float fw = 0.04 + u_vig.w * 1.1;
    float v = smoothstep(rc - fw * 0.5, rc + fw * 0.5, d);
    if (u_vig.x < 0.) {
      float protect = 1. - u_vigHl * smoothstep(0.65, 1., luma(x));
      x *= 1. + u_vig.x * v * protect;
    } else {
      x = mix(x, vec3(1.), u_vig.x * v * 0.9);
    }
  }

  // grain
  if (u_grain.x > 0.) {
    vec2 gp = s * u_pxScale / (1.0 + u_grain.y * 4.0);
    float n = vnoise(gp) * (1. - u_grain.z * 0.5) + vnoise(gp * 2.7 + 13.1) * u_grain.z * 0.5;
    float Lg = luma(x);
    x += (n - 0.5) * u_grain.x * 0.35 * (1. - abs(2. * Lg - 1.) * 0.6);
  }

  if (u_showMask >= 0) x = mix(x, vec3(1., 0.12, 0.12), showW * 0.55);
  if (u_clipWarn) {
    if (max3(x) >= 0.999) x = vec3(1., 0.1, 0.1);
    else if (max3(x) <= 0.002) x = vec3(0.15, 0.35, 1.);
  }
  o = vec4(clamp(x, 0., 1.), 1.);
}`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error(log, src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
      throw new Error('Shader compile error: ' + log);
    }
    return sh;
  }
  function program(gl, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const locs = {};
    return {
      p,
      loc(name) {
        if (!(name in locs)) locs[name] = gl.getUniformLocation(p, name);
        return locs[name];
      },
    };
  }

  /* ---------- settings → shader parameter helpers ---------- */
  function hueRGB(h) {
    const c = (n) => {
      const k = (n + h / 60) % 6;
      return 1 - Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [c(5), c(3), c(1)];
  }
  function gradeVec(g, k) {
    const [r, gg, b] = hueRGB(g.h);
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const s = (g.s / 100) * k;
    return [(r - l) * s, (gg - l) * s, (b - l) * s, g.l / 100];
  }

  class Engine {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false, alpha: false });
      if (!gl) throw new Error('WebGL2 is not supported in this browser.');
      this.gl = gl;
      gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('OES_texture_float_linear');
      this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.pMain = program(gl, FS_MAIN);
      this.pBlur = program(gl, FS_BLUR);
      this.pCopy = program(gl, FS_COPY);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.lut = this._tex(LUT_SIZE, 1, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null);
      this.lutKey = '';
      this.src = null;
      this.targets = {};
      this.sharpRadius = -1;
    }

    _tex(w, h, internal, format, type, data) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal || gl.RGBA8, w, h, 0, format || gl.RGBA, type || gl.UNSIGNED_BYTE, data);
      return t;
    }
    _target(key, w, h) {
      const gl = this.gl;
      let t = this.targets[key];
      if (t && t.w === w && t.h === h) return t;
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      const tex = this._tex(w, h);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      t = this.targets[key] = { tex, fb, w, h };
      return t;
    }
    _pass(prog, target, w, h) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog.p);
    }
    _bind(unit, tex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    _copy(srcTex, dst) {
      const gl = this.gl;
      this._pass(this.pCopy, dst, dst.w, dst.h);
      this._bind(0, srcTex);
      gl.uniform1i(this.pCopy.loc('u_tex'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    _blur(srcTex, tmp, dst, sigma) {
      const gl = this.gl, P = this.pBlur;
      this._pass(P, tmp, tmp.w, tmp.h);
      this._bind(0, srcTex);
      gl.uniform1i(P.loc('u_tex'), 0);
      gl.uniform1f(P.loc('u_sigma'), sigma);
      gl.uniform2f(P.loc('u_dir'), 1 / tmp.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this._pass(P, dst, dst.w, dst.h);
      this._bind(0, tmp.tex);
      gl.uniform1i(P.loc('u_tex'), 0);
      gl.uniform1f(P.loc('u_sigma'), sigma);
      gl.uniform2f(P.loc('u_dir'), 0, 1 / dst.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /** source: ImageBitmap / canvas. fullLong = long edge of the original file (for scale-aware effects). */
    setImage(source, fullLong) {
      const gl = this.gl;
      if (this.src) gl.deleteTexture(this.src);
      this.texW = source.width;
      this.texH = source.height;
      this.fullLong = fullLong || Math.max(source.width, source.height);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.src = this._tex(source.width, source.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this._buildBlurs();
      this.sharpRadius = -1;
    }

    _buildBlurs() {
      const W = this.texW, H = this.texH, long = Math.max(W, H);
      // medium blur (texture / NR / masking), half resolution
      const mw = Math.max(1, Math.round(W / 2)), mh = Math.max(1, Math.round(H / 2));
      const half = this._target('half', mw, mh);
      this._copy(this.src, half);
      const mt = this._target('mTmp', mw, mh);
      const mB = this._target('blurM', mw, mh);
      this._blur(half.tex, mt, mB, Math.max(1.2, 2.2 * (long / 2048)));
      // large blur (clarity, dehaze, highlight/shadow masks): progressive halving down to ~320px
      let cur = half, i = 0;
      while (Math.max(cur.w, cur.h) > 640) {
        const n = this._target('down' + i++, Math.max(1, cur.w >> 1), Math.max(1, cur.h >> 1));
        this._copy(cur.tex, n);
        cur = n;
      }
      const lt = this._target('lTmp', cur.w, cur.h);
      const lB = this._target('blurL', cur.w, cur.h);
      const sig = 5 * (Math.max(cur.w, cur.h) / 640);
      this._blur(cur.tex, lt, lB, sig);
      const lB2 = this._target('lTmp2', cur.w, cur.h);
      this._blur(lB.tex, lt, lB2, sig);
      this._copy(lB2.tex, lB);
    }

    _ensureSharpBlur(radius) {
      if (Math.abs(radius - this.sharpRadius) < 1e-3) return;
      this.sharpRadius = radius;
      const W = this.texW, H = this.texH;
      const t = this._target('sTmp', W, H), d = this._target('blurS', W, H);
      const scale = Math.max(this.texW, this.texH) / this.fullLong;
      this._blur(this.src, t, d, Math.max(0.6, radius * Math.max(scale, 0.6)));
    }

    _updateLut(s) {
      const key = JSON.stringify([s.curve, s.curveParam]);
      if (key === this.lutKey) return;
      this.lutKey = key;
      const data = LR.Curves.buildLut(s, LUT_SIZE);
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.lut);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, data);
    }

    /** Oriented size in engine pixels. */
    orientedSize(s) {
      const odd = (s.orientation || 0) % 2 === 1;
      return odd ? [this.texH, this.texW] : [this.texW, this.texH];
    }
    /** Crop rectangle in engine pixels: {cx, cy, w, h} (center relative to image center, rotated frame). */
    cropPx(s) {
      const [W, H] = this.orientedSize(s);
      const L = Math.max(W, H);
      const c = s.crop;
      if (!c) return { cx: 0, cy: 0, w: W, h: H };
      return { cx: c.cx * L, cy: c.cy * L, w: c.w * L, h: c.h * L };
    }
    /** Size of the region shown for a given mode ('crop' shows the whole rotated image). */
    regionSize(s, mode) {
      const [W, H] = this.orientedSize(s);
      if (mode === 'crop') {
        const a = ((s.angle || 0) * Math.PI) / 180;
        const c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
        return [W * c + H * sn, W * sn + H * c];
      }
      const cp = this.cropPx(s);
      return [cp.w, cp.h];
    }

    /**
     * Render settings s.
     * opts: {width, height, scale, offX, offY, mode:'normal'|'crop', target:null|'fbo', bypass, showMask, clipWarn, bg}
     */
    render(s, opts) {
      const gl = this.gl, P = this.pMain;
      if (!this.src) return;
      this._ensureSharpBlur(s.sharpen.radius);
      this._updateLut(s);
      const W = opts.width, H = opts.height;
      let fbo = null;
      if (opts.toFbo) fbo = this._target('out', W, H);
      else if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width = W;
        this.canvas.height = H;
      }
      this._pass(P, fbo, W, H);
      if (opts.scissor) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(opts.scissor[0], H - opts.scissor[1] - opts.scissor[3], opts.scissor[2], opts.scissor[3]);
      }
      this._bind(0, this.src);
      this._bind(1, this.targets.blurS.tex);
      this._bind(2, this.targets.blurM.tex);
      this._bind(3, this.targets.blurL.tex);
      this._bind(4, this.lut);
      const u = (n) => P.loc(n);
      gl.uniform1i(u('u_src'), 0);
      gl.uniform1i(u('u_blurS'), 1);
      gl.uniform1i(u('u_blurM'), 2);
      gl.uniform1i(u('u_blurL'), 3);
      gl.uniform1i(u('u_lut'), 4);
      gl.uniform2f(u('u_canvas'), W, H);
      gl.uniform1i(u('u_flipY'), fbo ? 0 : 1);
      gl.uniform2f(u('u_viewOff'), opts.offX || 0, opts.offY || 0);
      gl.uniform1f(u('u_viewScale'), opts.scale || 1);
      const [OW, OH] = this.orientedSize(s);
      gl.uniform2f(u('u_size'), OW, OH);
      const mode = opts.mode || 'normal';
      const [RW, RH] = this.regionSize(s, mode);
      gl.uniform2f(u('u_region'), RW, RH);
      if (mode === 'crop') gl.uniform2f(u('u_qOrigin'), -RW / 2, -RH / 2);
      else {
        const cp = this.cropPx(s);
        gl.uniform2f(u('u_qOrigin'), cp.cx - cp.w / 2, cp.cy - cp.h / 2);
      }
      gl.uniform1i(u('u_clip'), 1);
      gl.uniform1f(u('u_angle'), ((s.angle || 0) * Math.PI) / 180);
      gl.uniform1i(u('u_orient'), s.orientation || 0);
      gl.uniform1i(u('u_flipH'), s.flipH ? 1 : 0);
      gl.uniform1i(u('u_flipV'), s.flipV ? 1 : 0);
      gl.uniform1f(u('u_distort'), s.lens.distortion / 100);
      const bg = opts.bg || [0.11, 0.11, 0.11];
      gl.uniform3f(u('u_bg'), bg[0], bg[1], bg[2]);
      gl.uniform1f(u('u_pxScale'), this.fullLong / Math.max(this.texW, this.texH));
      gl.uniform1i(u('u_bypass'), opts.bypass ? 1 : 0);

      gl.uniform1f(u('u_temp'), s.temp / 100);
      gl.uniform1f(u('u_tint'), s.tint / 100);
      gl.uniform1f(u('u_exposure'), s.exposure);
      gl.uniform1f(u('u_contrast'), s.contrast / 100);
      gl.uniform1f(u('u_highlights'), s.highlights / 100);
      gl.uniform1f(u('u_shadows'), s.shadows / 100);
      gl.uniform1f(u('u_whites'), s.whites / 100);
      gl.uniform1f(u('u_blacks'), s.blacks / 100);
      gl.uniform1f(u('u_texture'), s.texture / 100);
      gl.uniform1f(u('u_clarity'), s.clarity / 100);
      gl.uniform1f(u('u_dehaze'), s.dehaze / 100);
      gl.uniform1f(u('u_vibrance'), s.vibrance / 100);
      gl.uniform1f(u('u_saturation'), s.saturation / 100);

      const hsl = [];
      for (let i = 0; i < 8; i++) hsl.push(s.hsl.hue[i] / 100, s.hsl.sat[i] / 100, s.hsl.lum[i] / 100);
      gl.uniform3fv(u('u_hsl'), hsl);
      gl.uniform1fv(u('u_bwMix'), s.bw.map((v) => v / 100));
      gl.uniform1i(u('u_bw'), s.treatment === 'bw' ? 1 : 0);

      const g = s.grading;
      gl.uniform4fv(u('u_cgS'), gradeVec(g.shadows, 0.35));
      gl.uniform4fv(u('u_cgM'), gradeVec(g.midtones, 0.3));
      gl.uniform4fv(u('u_cgH'), gradeVec(g.highlights, 0.3));
      gl.uniform4fv(u('u_cgG'), gradeVec(g.global, 0.2));
      gl.uniform1f(u('u_cgBlend'), g.blending / 100);
      gl.uniform1f(u('u_cgBalance'), g.balance / 100);

      gl.uniform4f(u('u_sharpen'), (s.sharpen.amount / 150) * 2.2, s.sharpen.detail / 100, s.sharpen.masking / 100, 0);
      gl.uniform2f(u('u_nr'), s.nr.luminance / 100, s.nr.color / 100);
      const v = s.vignette;
      gl.uniform4f(u('u_vig'), v.amount / 100, v.midpoint / 100, v.roundness / 100, v.feather / 100);
      gl.uniform1f(u('u_vigHl'), v.highlights / 100);
      gl.uniform3f(u('u_grain'), s.grain.amount / 100, s.grain.size / 100, s.grain.roughness / 100);
      gl.uniform1f(u('u_lensVig'), s.lens.vignetting / 100);

      const masks = (s.masks || []).filter((m) => m.enabled !== false).slice(0, MAX_MASKS);
      const geo = new Float32Array(MAX_MASKS * 4), geo2 = new Float32Array(MAX_MASKS * 4);
      const a1 = new Float32Array(MAX_MASKS * 4), a2 = new Float32Array(MAX_MASKS * 4);
      let showIdx = -1;
      masks.forEach((m, i) => {
        if (m.type === 'linear') geo.set([m.x0, m.y0, m.x1, m.y1], i * 4);
        else geo.set([m.cx, m.cy, m.rx, m.ry], i * 4);
        geo2.set([m.feather / 100, m.invert ? 1 : 0, m.type === 'linear' ? 0 : 1, ((m.rot || 0) * Math.PI) / 180], i * 4);
        const amt = (m.amount == null ? 100 : m.amount) / 100;
        const A = m.adj;
        a1.set([(A.temp / 100) * amt, (A.tint / 100) * amt, A.exposure * amt, (A.contrast / 100) * amt], i * 4);
        a2.set([(A.highlights / 100) * amt, (A.shadows / 100) * amt, (A.saturation / 100) * amt, (A.clarity / 100) * amt], i * 4);
        if (opts.showMask && m.id === opts.showMask) showIdx = i;
      });
      gl.uniform1i(u('u_maskCount'), masks.length);
      gl.uniform4fv(u('u_mGeo'), geo);
      gl.uniform4fv(u('u_mGeo2'), geo2);
      gl.uniform4fv(u('u_mAdj1'), a1);
      gl.uniform4fv(u('u_mAdj2'), a2);
      gl.uniform1i(u('u_showMask'), showIdx);
      gl.uniform1i(u('u_clipWarn'), opts.clipWarn ? 1 : 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (opts.scissor) gl.disable(gl.SCISSOR_TEST);
      if (fbo) {
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return px;
      }
    }

    /** Render the full (cropped) image fitting into maxW x maxH; returns {pixels, width, height} top-down RGBA. */
    renderFit(s, maxLong, opts) {
      const [RW, RH] = this.regionSize(s, 'normal');
      const sc = Math.min(1, maxLong / Math.max(RW, RH));
      const w = Math.max(1, Math.round(RW * sc)), h = Math.max(1, Math.round(RH * sc));
      const pixels = this.render(s, Object.assign({ width: w, height: h, scale: sc, offX: 0, offY: 0, toFbo: true }, opts || {}));
      return { pixels, width: w, height: h };
    }

    /** Render to an exact output size covering the crop. */
    renderSize(s, w, h) {
      const [RW] = this.regionSize(s, 'normal');
      const sc = w / RW;
      return this.render(s, { width: w, height: h, scale: sc, offX: 0, offY: 0, toFbo: true });
    }

    dispose() {
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }

  LR.Engine = Engine;
  LR.MAX_MASKS = MAX_MASKS;
})();
