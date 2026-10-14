/* Stopbath — develop settings model, tone curves, presets. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});

  const HUE_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
  const HUE_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#00acc1', '#1e88e5', '#8e24aa', '#d81b60'];

  function defaults() {
    return {
      treatment: 'color',
      profile: 'Color',
      wbMode: 'As Shot',
      temp: 0, tint: 0,
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
      curve: { master: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
      curveParam: { highlights: 0, lights: 0, darks: 0, shadows: 0, s1: 25, s2: 50, s3: 75 },
      hsl: { hue: [0, 0, 0, 0, 0, 0, 0, 0], sat: [0, 0, 0, 0, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 0, 0, 0] },
      bw: [0, 0, 0, 0, 0, 0, 0, 0],
      grading: {
        shadows: { h: 220, s: 0, l: 0 }, midtones: { h: 40, s: 0, l: 0 }, highlights: { h: 45, s: 0, l: 0 },
        global: { h: 30, s: 0, l: 0 }, blending: 50, balance: 0,
      },
      sharpen: { amount: 0, radius: 1.0, detail: 25, masking: 0 },
      nr: { luminance: 0, color: 0 },
      lens: { distortion: 0, vignetting: 0 },
      vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 },
      grain: { amount: 0, size: 25, roughness: 50 },
      crop: null, angle: 0, orientation: 0, flipH: false, flipV: false, aspect: 'original', aspectLocked: true,
      masks: [],
    };
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  function getPath(o, path) {
    return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  }
  function setPath(o, path, v) {
    const ks = path.split('.');
    let a = o;
    for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]];
    a[ks[ks.length - 1]] = v;
  }
  function deepMerge(target, src) {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
      else target[k] = clone(v);
    }
    return target;
  }
  /** Fill in missing keys (older catalog entries) */
  function normalize(s) {
    return deepMerge(defaults(), s || {});
  }
  function isDefault(s) {
    const d = defaults();
    const strip = (x) => { const c = clone(x); delete c.aspect; delete c.aspectLocked; delete c.wbMode; delete c.profile; return JSON.stringify(c); };
    return strip(s) === strip(d);
  }

  /* ---------- labels for history ---------- */
  const LABELS = {
    temp: 'Temperature', tint: 'Tint', exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows',
    whites: 'Whites', blacks: 'Blacks', texture: 'Texture', clarity: 'Clarity', dehaze: 'Dehaze', vibrance: 'Vibrance', saturation: 'Saturation',
    'curveParam.highlights': 'Highlights (Curve)', 'curveParam.lights': 'Lights', 'curveParam.darks': 'Darks', 'curveParam.shadows': 'Shadows (Curve)',
    'grading.blending': 'Color Grade Blending', 'grading.balance': 'Color Grade Balance',
    'sharpen.amount': 'Sharpening', 'sharpen.radius': 'Sharpen Radius', 'sharpen.detail': 'Sharpen Detail', 'sharpen.masking': 'Sharpen Masking',
    'nr.luminance': 'Luminance NR', 'nr.color': 'Color NR', 'lens.distortion': 'Distortion', 'lens.vignetting': 'Lens Vignetting',
    'vignette.amount': 'Vignette Amount', 'vignette.midpoint': 'Vignette Midpoint', 'vignette.roundness': 'Vignette Roundness',
    'vignette.feather': 'Vignette Feather', 'vignette.highlights': 'Vignette Highlights',
    'grain.amount': 'Grain Amount', 'grain.size': 'Grain Size', 'grain.roughness': 'Grain Roughness', angle: 'Straighten',
  };
  function label(path) {
    if (LABELS[path]) return LABELS[path];
    let m = path.match(/^hsl\.(hue|sat|lum)\.(\d)$/);
    if (m) return ({ hue: 'Hue', sat: 'Saturation', lum: 'Luminance' })[m[1]] + ' ' + HUE_NAMES[+m[2]];
    m = path.match(/^bw\.(\d)$/);
    if (m) return 'B&W ' + HUE_NAMES[+m[1]];
    m = path.match(/^grading\.(\w+)\.(h|s|l)$/);
    if (m) return 'Color Grade ' + m[1][0].toUpperCase() + m[1].slice(1) + ' ' + ({ h: 'Hue', s: 'Sat', l: 'Lum' })[m[2]];
    return path;
  }
  function fmtValue(path, v) {
    if (typeof v !== 'number') return '';
    if (path === 'exposure') return (v > 0 ? '+' : '') + v.toFixed(2);
    if (path === 'sharpen.radius') return v.toFixed(1);
    if (path === 'angle') return v.toFixed(2);
    return (v > 0 ? '+' : '') + Math.round(v);
  }

  /* ---------- curves ---------- */
  /** Monotone cubic (Fritsch–Carlson) interpolation; returns f(x). */
  function monotone(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0]);
    const n = p.length;
    if (n < 2) return (x) => x;
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(xs[i + 1] - xs[i], 1e-6));
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (i < n - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }

  function parametric(cp) {
    const s1 = cp.s1 / 100, s2 = cp.s2 / 100, s3 = cp.s3 / 100;
    const regions = [
      [0, s1, cp.shadows], [s1, s2, cp.darks], [s2, s3, cp.lights], [s3, 1, cp.highlights],
    ];
    return (x) => {
      let y = x;
      for (const [a, b, amt] of regions) {
        if (!amt) continue;
        const c = (a + b) / 2, w = Math.max(b - a, 0.05);
        const t = (x - c) / w;
        if (Math.abs(t) < 1) y += (amt / 100) * 0.22 * 0.5 * (1 + Math.cos(Math.PI * t));
      }
      const env = Math.min(1, x / 0.04) * Math.min(1, (1 - x) / 0.04);
      return x + (y - x) * env;
    };
  }

  function curveFn(s, channel) {
    const par = parametric(s.curveParam);
    const master = monotone(s.curve.master);
    const ch = channel ? monotone(s.curve[channel]) : (x) => x;
    return (x) => {
      const v = Math.min(1, Math.max(0, master(Math.min(1, Math.max(0, par(x))))));
      return Math.min(1, Math.max(0, ch(v)));
    };
  }

  function buildLut(s, N) {
    const fr = curveFn(s, 'r'), fg = curveFn(s, 'g'), fb = curveFn(s, 'b');
    const out = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      out[i * 4] = fr(x);
      out[i * 4 + 1] = fg(x);
      out[i * 4 + 2] = fb(x);
      out[i * 4 + 3] = 1;
    }
    return out;
  }

  /* ---------- built-in presets ---------- */
  const P = (name, group, s) => ({ id: 'builtin-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, group, builtin: true, settings: s });
  const BUILTIN_PRESETS = [
    P('Auto Pop', 'Color', { contrast: 15, highlights: -25, shadows: 20, whites: 10, blacks: -8, clarity: 10, vibrance: 20, dehaze: 5 }),
    P('Vivid', 'Color', { contrast: 25, vibrance: 40, saturation: 10, clarity: 15, highlights: -20, shadows: 15 }),
    P('Warm Sunset', 'Color', { temp: 22, tint: 6, vibrance: 25, highlights: -30, shadows: 10, grading: { highlights: { h: 40, s: 30, l: 0 }, shadows: { h: 15, s: 12, l: 0 } } }),
    P('Cool Matte', 'Color', {
      temp: -14, contrast: -10, saturation: -15, highlights: -20,
      curve: { master: [[0, 0.1], [0.25, 0.27], [0.75, 0.76], [1, 0.95]] },
      grading: { shadows: { h: 210, s: 20, l: 0 }, highlights: { h: 190, s: 8, l: 0 } },
    }),
    P('Teal & Orange', 'Cinematic', {
      contrast: 20, highlights: -35, shadows: 25, vibrance: 15,
      grading: { shadows: { h: 190, s: 35, l: -5 }, highlights: { h: 35, s: 30, l: 0 }, midtones: { h: 30, s: 8, l: 0 }, balance: 10 },
      hsl: { hue: [0, -10, -10, 30, 0, -15, 0, 0], sat: [0, 15, -25, -40, 10, 10, -20, -20], lum: [0, 10, 0, -20, 0, -10, 0, 0] },
    }),
    P('Moody Dark', 'Cinematic', {
      exposure: -0.4, contrast: 25, highlights: -50, shadows: -10, blacks: -15, clarity: 15, vibrance: -10, saturation: -20, dehaze: 10,
      vignette: { amount: -30, midpoint: 40, feather: 70 }, grading: { shadows: { h: 220, s: 18, l: 0 } },
    }),
    P('Faded Film', 'Film', {
      contrast: -15, saturation: -10, highlights: -15,
      curve: { master: [[0, 0.12], [0.3, 0.32], [0.7, 0.72], [1, 0.93]] },
      grading: { shadows: { h: 30, s: 12, l: 0 }, highlights: { h: 55, s: 10, l: 0 } },
      grain: { amount: 25, size: 30, roughness: 55 },
    }),
    P('Kodachrome-ish', 'Film', {
      contrast: 30, temp: 8, vibrance: 15, saturation: 10, highlights: -20,
      hsl: { hue: [5, 0, -8, 15, 0, -10, 0, 0], sat: [20, 10, 5, -10, 0, 15, 0, 0], lum: [-10, 0, 0, -10, 0, -15, 0, 0] },
      grain: { amount: 15, size: 20, roughness: 40 },
    }),
    P('Portrait Soft', 'Portrait', { exposure: 0.15, contrast: -10, highlights: -20, shadows: 15, texture: -20, clarity: -10, vibrance: 10, hsl: { hue: [0, 0, 0, 0, 0, 0, 0, 0], sat: [0, -10, 0, 0, 0, 0, 0, 0], lum: [0, 15, 0, 0, 0, 0, 0, 0] } }),
    P('B&W High Contrast', 'Black & White', { treatment: 'bw', contrast: 45, highlights: -20, shadows: -10, whites: 20, blacks: -25, clarity: 25, bw: [-10, -20, -10, -25, -20, -30, -10, -10] }),
    P('B&W Soft', 'Black & White', { treatment: 'bw', contrast: -15, highlights: -25, shadows: 25, clarity: -5, curve: { master: [[0, 0.05], [0.5, 0.52], [1, 0.97]] } }),
    P('B&W Sepia', 'Black & White', { treatment: 'bw', contrast: 10, grading: { shadows: { h: 30, s: 25, l: 0 }, highlights: { h: 45, s: 20, l: 0 } }, grain: { amount: 20, size: 25, roughness: 50 }, vignette: { amount: -20, midpoint: 45, feather: 70 } }),
    P('Landscape Punch', 'Landscape', { contrast: 20, highlights: -45, shadows: 30, whites: 15, blacks: -10, clarity: 20, dehaze: 15, vibrance: 30, hsl: { hue: [0, 0, 0, 10, 0, -5, 0, 0], sat: [0, 0, 10, 15, 20, 20, 0, 0], lum: [0, 0, 0, 0, 0, -20, 0, 0] } }),
    P('Sharpen + NR', 'Detail', { sharpen: { amount: 60, radius: 1.0, detail: 25, masking: 30 }, nr: { luminance: 20, color: 25 } }),
  ];

  LR.Settings = { defaults, clone, getPath, setPath, deepMerge, normalize, isDefault, label, fmtValue, HUE_NAMES, HUE_COLORS, BUILTIN_PRESETS };
  LR.Curves = { monotone, parametric, curveFn, buildLut };
})();
