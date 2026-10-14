/* Stopbath — custom widgets: Tone Curve editor, Color Grading wheel. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h, clamp } = LR.UI;

  /* =================== TONE CURVE =================== */
  class CurveEditor {
    constructor(hooks) {
      this.hooks = hooks;
      this.mode = 'param'; // 'param' | 'point'
      this.channel = 'master';
      this.canvas = h('canvas.curve-canvas');
      this.splitBar = h('div.curve-split');
      this.splitHandles = [0, 1, 2].map((i) => {
        const el = h('div.split-handle', { title: 'Drag to adjust region split' });
        this.splitBar.appendChild(el);
        this._bindSplit(el, i);
        return el;
      });
      this.region = h('div.curve-region');
      this.el = h('div.curve-ed', null, this.canvas, this.splitBar, this.region);
      this.drag = null;
      this.hoverRegion = -1;
      this._bind();
      new ResizeObserver(() => this.draw()).observe(this.canvas);
    }
    get s() { return this.hooks.settings(); }
    points() { return this.s.curve[this.channel]; }
    size() { return { W: this.canvas.clientWidth || 240, H: this.canvas.clientHeight || 240 }; }
    toPx(x, y) { const { W, H } = this.size(); return { x: x * W, y: (1 - y) * H }; }
    fromEvent(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1), rawY: 1 - (e.clientY - r.top) / r.height };
    }
    regionAt(x) {
      const cp = this.s.curveParam;
      if (x < cp.s1 / 100) return 'shadows';
      if (x < cp.s2 / 100) return 'darks';
      if (x < cp.s3 / 100) return 'lights';
      return 'highlights';
    }
    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        const p = this.fromEvent(e);
        c.setPointerCapture(e.pointerId);
        if (this.mode === 'param') {
          const reg = this.regionAt(p.x);
          this.drag = { kind: 'param', reg, startY: e.clientY, startV: this.s.curveParam[reg] };
          return;
        }
        const pts = this.points();
        const { W, H } = this.size();
        let idx = pts.findIndex((q) => Math.hypot((q[0] - p.x) * W, (q[1] - p.y) * H) < 9);
        if (idx < 0) {
          const f = LR.Curves.monotone(pts);
          pts.push([p.x, clamp(f(p.x), 0, 1)]);
          pts.sort((a, b) => a[0] - b[0]);
          idx = pts.findIndex((q) => q[0] === p.x);
        }
        this.drag = { kind: 'point', idx };
        this.draw();
        this.hooks.input();
      });
      c.addEventListener('pointermove', (e) => {
        const p = this.fromEvent(e);
        if (!this.drag) {
          if (this.mode === 'param') {
            const reg = this.regionAt(p.x);
            if (reg !== this.hoverRegion) { this.hoverRegion = reg; this.draw(); this.region.textContent = regionLabel(reg) + ': ' + this.s.curveParam[reg]; }
          }
          return;
        }
        if (this.drag.kind === 'param') {
          const d = (this.drag.startY - e.clientY) * 0.8;
          this.s.curveParam[this.drag.reg] = clamp(Math.round(this.drag.startV + d), -100, 100);
          this.region.textContent = regionLabel(this.drag.reg) + ': ' + this.s.curveParam[this.drag.reg];
          this.hooks.input();
          this.draw();
          return;
        }
        const pts = this.points();
        const i = this.drag.idx;
        const lo = i > 0 ? pts[i - 1][0] + 0.01 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - 0.01 : 1;
        // drag far outside removes interior points
        if (i > 0 && i < pts.length - 1 && (p.rawY < -0.08 || p.rawY > 1.08)) {
          pts.splice(i, 1);
          this.drag = { kind: 'removed' };
        } else if (this.drag.kind === 'point') {
          pts[i] = [clamp(p.x, lo, hi), p.y];
        }
        this.hooks.input();
        this.draw();
      });
      const up = () => {
        if (!this.drag) return;
        const k = this.drag.kind;
        this.drag = null;
        this.hooks.commit(k === 'param' ? 'Tone Curve (Parametric)' : 'Tone Curve' + (this.channel !== 'master' ? ' ' + this.channel.toUpperCase() : ''));
        this.draw();
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', () => { if (!this.drag) { this.hoverRegion = -1; this.region.textContent = ''; this.draw(); } });
      c.addEventListener('dblclick', (e) => {
        if (this.mode !== 'point') return;
        const p = this.fromEvent(e);
        const pts = this.points();
        const { W, H } = this.size();
        const idx = pts.findIndex((q) => Math.hypot((q[0] - p.x) * W, (q[1] - p.y) * H) < 9);
        if (idx > 0 && idx < pts.length - 1) {
          pts.splice(idx, 1);
          this.hooks.input();
          this.hooks.commit('Tone Curve');
          this.draw();
        }
      });
    }
    _bindSplit(el, i) {
      const keys = ['s1', 's2', 's3'];
      let active = false;
      el.addEventListener('pointerdown', (e) => { active = true; el.setPointerCapture(e.pointerId); e.stopPropagation(); });
      el.addEventListener('pointermove', (e) => {
        if (!active) return;
        const r = this.splitBar.getBoundingClientRect();
        const cp = this.s.curveParam;
        const v = clamp(Math.round(((e.clientX - r.left) / r.width) * 100), 5, 95);
        const lo = i > 0 ? cp[keys[i - 1]] + 5 : 5, hi = i < 2 ? cp[keys[i + 1]] - 5 : 95;
        cp[keys[i]] = clamp(v, lo, hi);
        this.hooks.input();
        this.draw();
      });
      el.addEventListener('pointerup', () => { if (active) { active = false; this.hooks.commit('Tone Curve Split'); } });
      el.addEventListener('dblclick', () => {
        this.s.curveParam[keys[i]] = [25, 50, 75][i];
        this.hooks.input();
        this.hooks.commit('Tone Curve Split');
        this.draw();
      });
    }
    setMode(m) { this.mode = m; this.splitBar.style.display = m === 'param' ? '' : 'none'; this.draw(); }
    setChannel(c) { this.channel = c; this.draw(); }
    draw() {
      const cv = this.canvas, dpr = window.devicePixelRatio || 1;
      const { W, H } = this.size();
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = LR.THEME.canvasBg;
      x.fillRect(0, 0, W, H);
      const s = this.hooks.settings && this.hooks.settings();
      if (!s) return;
      // histogram backdrop
      const bins = this.hooks.histogram && this.hooks.histogram();
      if (bins) {
        const arr = this.channel === 'master' ? bins.l : bins[this.channel];
        let mx = 0;
        for (let i = 2; i < 254; i++) mx = Math.max(mx, arr[i]);
        x.beginPath();
        x.moveTo(0, H);
        for (let i = 0; i < 256; i++) x.lineTo((i / 255) * W, H - Math.min(1, Math.sqrt(arr[i] / (mx || 1))) * H * 0.9);
        x.lineTo(W, H);
        x.fillStyle = 'rgba(255,255,255,0.07)';
        x.fill();
      }
      // region highlight
      if (this.mode === 'param') {
        const cp = s.curveParam;
        const bounds = { shadows: [0, cp.s1], darks: [cp.s1, cp.s2], lights: [cp.s2, cp.s3], highlights: [cp.s3, 100] };
        const reg = this.drag && this.drag.kind === 'param' ? this.drag.reg : this.hoverRegion;
        if (bounds[reg]) {
          x.fillStyle = 'rgba(255,255,255,0.05)';
          x.fillRect((bounds[reg][0] / 100) * W, 0, ((bounds[reg][1] - bounds[reg][0]) / 100) * W, H);
        }
      }
      x.strokeStyle = LR.THEME.canvasGrid;
      x.lineWidth = 1;
      x.beginPath();
      for (let i = 1; i < 4; i++) {
        x.moveTo(Math.round((W * i) / 4) + 0.5, 0); x.lineTo(Math.round((W * i) / 4) + 0.5, H);
        x.moveTo(0, Math.round((H * i) / 4) + 0.5); x.lineTo(W, Math.round((H * i) / 4) + 0.5);
      }
      x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.18)';
      x.beginPath(); x.moveTo(0, H); x.lineTo(W, 0); x.stroke();
      // curve(s)
      const col = { master: '#ddd', r: '#ff5b5b', g: '#5bd36b', b: '#5b8dff' };
      const plot = (fn, color, width) => {
        x.strokeStyle = color;
        x.lineWidth = width;
        x.beginPath();
        for (let i = 0; i <= W; i++) {
          const v = fn(i / W);
          if (i === 0) x.moveTo(i, (1 - v) * H); else x.lineTo(i, (1 - v) * H);
        }
        x.stroke();
      };
      if (this.mode === 'param') {
        const par = LR.Curves.parametric(s.curveParam);
        plot(par, '#ddd', 1.5);
      } else {
        if (this.channel === 'master') {
          ['r', 'g', 'b'].forEach((c) => {
            const p = s.curve[c];
            if (p.length > 2 || p[0][1] !== 0 || p[p.length - 1][1] !== 1) plot(LR.Curves.monotone(p), col[c] + '66', 1);
          });
        }
        const pts = this.points();
        plot(LR.Curves.monotone(pts), col[this.channel], 1.5);
        pts.forEach((q, i) => {
          const pp = this.toPx(q[0], q[1]);
          x.beginPath();
          x.arc(pp.x, pp.y, 4, 0, 7);
          x.fillStyle = this.drag && this.drag.idx === i ? '#fff' : '#bbb';
          x.fill();
          x.strokeStyle = '#111';
          x.lineWidth = 1;
          x.stroke();
        });
      }
      // split handles
      const cp = s.curveParam;
      ['s1', 's2', 's3'].forEach((k, i) => { this.splitHandles[i].style.left = cp[k] + '%'; });
    }
  }
  function regionLabel(r) { return { shadows: 'Shadows', darks: 'Darks', lights: 'Lights', highlights: 'Highlights' }[r]; }

  /* =================== COLOR WHEEL =================== */
  class ColorWheel {
    constructor(o) {
      this.o = o; // {size, get(), set(h,s), commit(), label}
      const size = o.size || 150;
      this.size = size;
      this.canvas = h('canvas.wheel', { style: { width: size + 'px', height: size + 'px' } });
      this.puck = h('div.wheel-puck');
      this.readout = h('div.wheel-readout');
      this.wrap = h('div.wheel-wrap', { style: { width: size + 'px', height: size + 'px' } }, this.canvas, this.puck);
      this.el = h('div.wheel-box', null, o.label ? h('div.wheel-label', { text: o.label }) : null, this.wrap, this.readout);
      this._paint();
      this._bind();
    }
    _paint() {
      const dpr = window.devicePixelRatio || 1, S = Math.round(this.size * dpr);
      this.canvas.width = this.canvas.height = S;
      const x = this.canvas.getContext('2d');
      const img = x.createImageData(S, S), d = img.data, R = S / 2;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const dx = i - R + 0.5, dy = j - R + 0.5, r = Math.hypot(dx, dy) / R;
        const k = (j * S + i) * 4;
        if (r > 1) { d[k + 3] = 0; continue; }
        const hue = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
        const [cr, cg, cb] = hsv(hue, Math.min(1, r) * 0.85, 0.62);
        d[k] = cr; d[k + 1] = cg; d[k + 2] = cb;
        d[k + 3] = r > 0.985 ? Math.round((1 - (r - 0.985) / 0.015) * 255) : 255;
      }
      x.putImageData(img, 0, 0);
    }
    _bind() {
      let active = false;
      const set = (e) => {
        const r = this.wrap.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        let sat = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
        const hue = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
        if (e.shiftKey) { /* lock hue: only change saturation */
          const cur = this.o.get();
          this.o.set(cur.h, Math.round(sat * 100));
        } else this.o.set(Math.round(hue), Math.round(sat * 100));
        this.update();
      };
      this.wrap.addEventListener('pointerdown', (e) => { active = true; this.wrap.setPointerCapture(e.pointerId); set(e); });
      this.wrap.addEventListener('pointermove', (e) => { if (active) set(e); });
      this.wrap.addEventListener('pointerup', () => { if (active) { active = false; this.o.commit(); } });
      this.wrap.addEventListener('dblclick', () => { this.o.set(this.o.get().h, 0); this.update(); this.o.commit(); });
    }
    update() {
      const v = this.o.get();
      const a = (v.h * Math.PI) / 180, r = (v.s / 100) * (this.size / 2);
      this.puck.style.left = this.size / 2 + Math.cos(a) * r + 'px';
      this.puck.style.top = this.size / 2 - Math.sin(a) * r + 'px';
      const [cr, cg, cb] = hsv(v.h, v.s / 100, 1);
      this.puck.style.background = v.s ? `rgb(${cr},${cg},${cb})` : '#888';
      this.readout.textContent = 'Hue ' + v.h + '   Sat ' + v.s;
    }
  }
  function hsv(hh, s, v) {
    const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }

  LR.Widgets = { CurveEditor, ColorWheel, hsv };
})();
