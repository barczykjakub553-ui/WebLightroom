/* Stopbath — interactive viewer tools: Crop & Straighten, Masking, White Balance picker. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { clamp, uid } = LR.UI;
  const { Settings } = LR;

  const ASPECTS = [
    ['original', 'Original'], ['free', 'Free'], ['1:1', '1 x 1'], ['4:5', '4 x 5 / 8 x 10'], ['5:7', '5 x 7'], ['2:3', '2 x 3 / 4 x 6'],
    ['3:4', '3 x 4'], ['16:9', '16 x 9'], ['16:10', '16 x 10'], ['9:16', '9 x 16'],
  ];

  /* =================== CROP =================== */
  class CropTool {
    constructor(viewer, hooks) {
      this.v = viewer;
      this.hooks = hooks || {};
      this.drag = null;
    }
    get s() { return this.v.settings; }
    get eng() { return this.v.engine; }
    unitL() { const [W, H] = this.eng.orientedSize(this.s); return Math.max(W, H); }
    /** current crop in engine px (q-space, relative to image center) */
    cropPx() { return this.eng.cropPx(this.s); }
    setCropPx(c) {
      const L = this.unitL();
      const [W, H] = this.eng.orientedSize(this.s);
      const full = Math.abs(c.cx) < 0.5 && Math.abs(c.cy) < 0.5 && Math.abs(c.w - W) < 0.5 && Math.abs(c.h - H) < 0.5 && !this.s.angle;
      this.s.crop = full ? null : { cx: c.cx / L, cy: c.cy / L, w: c.w / L, h: c.h / L };
    }
    activate() {
      this.orig = Settings.clone({ crop: this.s.crop, angle: this.s.angle, orientation: this.s.orientation, flipH: this.s.flipH, flipV: this.s.flipV });
      this.v.mode = 'crop';
      this.v.requestRender();
    }
    deactivate() {
      this.v.mode = 'normal';
      this.v.requestRender();
    }
    cancel() {
      const cur = JSON.stringify({ crop: this.s.crop, angle: this.s.angle, orientation: this.s.orientation, flipH: this.s.flipH, flipV: this.s.flipV });
      if (cur === JSON.stringify(this.orig)) return;
      Object.assign(this.s, Settings.clone(this.orig));
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit('Cancel Crop');
    }
    aspectRatio() {
      const a = this.s.aspect || 'original';
      if (a === 'free' || !this.s.aspectLocked) return null;
      if (a === 'original') { const [W, H] = this.eng.orientedSize(this.s); return W / H; }
      const [x, y] = a.split(':').map(Number);
      const c = this.cropPx();
      const r = x / y;
      // keep orientation of current crop (portrait vs landscape)
      return (c.w >= c.h) === (r >= 1) ? r : 1 / r;
    }
    fits(c, angleDeg) {
      const [W, H] = this.eng.orientedSize(this.s);
      const a = ((angleDeg == null ? this.s.angle : angleDeg) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const tol = 0.75;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const qx = c.cx + (sx * c.w) / 2, qy = c.cy + (sy * c.h) / 2;
        const x = W / 2 + ca * qx + sa * qy, y = H / 2 - sa * qx + ca * qy;
        if (x < -tol || y < -tol || x > W + tol || y > H + tol) return false;
      }
      return c.w > 4 && c.h > 4;
    }
    lerp(a, b, t) { return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t }; }
    constrain(from, to) {
      if (this.fits(to)) return to;
      let lo = 0, hi = 1;
      for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (this.fits(this.lerp(from, to, m))) lo = m; else hi = m; }
      return this.lerp(from, to, lo);
    }
    /** shrink (and recenter if needed) crop so it fits current angle */
    fitToAngle(c) {
      if (this.fits(c)) return c;
      const shrink = (cc) => {
        let lo = 0, hi = 1;
        for (let i = 0; i < 20; i++) {
          const m = (lo + hi) / 2;
          if (this.fits({ cx: cc.cx, cy: cc.cy, w: cc.w * m, h: cc.h * m })) lo = m; else hi = m;
        }
        return { cx: cc.cx, cy: cc.cy, w: cc.w * lo, h: cc.h * lo };
      };
      let r = shrink(c);
      if (r.w < c.w * 0.5) {
        const centered = shrink({ cx: 0, cy: 0, w: c.w, h: c.h });
        if (centered.w > r.w) r = centered;
      }
      return r;
    }
    setAngle(deg, commit) {
      const orig = this.drag && this.drag.startCrop ? this.drag.startCrop : this.baseCrop || this.cropPx();
      this.s.angle = clamp(deg, -45, 45);
      const c = this.fitToAngle(Object.assign({}, orig));
      this.setCropPx(c);
      this.v.requestRender();
      this.hooks.changed && this.hooks.changed();
      if (commit) { this.baseCrop = null; this.hooks.commit && this.hooks.commit('Straighten'); }
    }
    beginAngleEdit() { if (!this.baseCrop) this.baseCrop = this.cropPx(); }
    setAspect(a) {
      this.s.aspect = a;
      if (a !== 'free') this.s.aspectLocked = true;
      this.applyAspect();
    }
    applyAspect() {
      const r = this.aspectRatio();
      if (!r) { this.v.requestRender(); return; }
      // largest rectangle of the new ratio contained in the current crop
      const c = this.cropPx();
      let w, h;
      if (c.w / c.h > r) { h = c.h; w = h * r; } else { w = c.w; h = w / r; }
      this.setCropPx(this.fitToAngle({ cx: c.cx, cy: c.cy, w, h }));
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit('Crop Aspect ' + this.s.aspect);
    }
    swapAspect() {
      const c = this.cropPx();
      const n = this.fitToAngle({ cx: c.cx, cy: c.cy, w: c.h, h: c.w });
      this.setCropPx(n);
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit('Crop Rotate Aspect');
    }
    reset() {
      this.s.crop = null;
      this.s.angle = 0;
      this.baseCrop = null;
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit('Reset Crop');
    }
    rotate90(dir) {
      this.s.orientation = (((this.s.orientation || 0) + dir) % 4 + 4) % 4;
      this.s.crop = null;
      this.baseCrop = null;
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit(dir > 0 ? 'Rotate Right' : 'Rotate Left');
    }
    flip(axis) {
      if (axis === 'h') this.s.flipH = !this.s.flipH;
      else this.s.flipV = !this.s.flipV;
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit(axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical');
    }
    /** crop rect in canvas coordinates */
    canvasRect() {
      const c = this.cropPx();
      const L = this.v.layout;
      const x0 = (c.cx - c.w / 2 + L.RW / 2) * L.scale + L.offX, y0 = (c.cy - c.h / 2 + L.RH / 2) * L.scale + L.offY;
      return { x: x0, y: y0, w: c.w * L.scale, h: c.h * L.scale };
    }
    hit(p) {
      const r = this.canvasRect(), dpr = window.devicePixelRatio || 1, t = 12 * dpr;
      const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
      const names = [['nw', 'n', 'ne'], ['w', null, 'e'], ['sw', 's', 'se']];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        if (!names[j][i]) continue;
        if (Math.abs(p.x - xs[i]) < t && Math.abs(p.y - ys[j]) < t) return names[j][i];
      }
      if (Math.abs(p.x - r.x) < t / 2 && p.y > r.y && p.y < r.y + r.h) return 'w';
      if (Math.abs(p.x - r.x - r.w) < t / 2 && p.y > r.y && p.y < r.y + r.h) return 'e';
      if (Math.abs(p.y - r.y) < t / 2 && p.x > r.x && p.x < r.x + r.w) return 'n';
      if (Math.abs(p.y - r.y - r.h) < t / 2 && p.x > r.x && p.x < r.x + r.w) return 's';
      if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return 'move';
      return 'rotate';
    }
    hover(p) {
      const k = this.hit(p);
      return { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', rotate: 'alias' }[k];
    }
    down(p) {
      const k = this.hit(p);
      const r = this.canvasRect();
      this.drag = { kind: k, start: p, startCrop: this.cropPx(), startAngle: this.s.angle || 0, center: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
      this.v.redrawOverlay();
    }
    move(p) {
      const d = this.drag;
      if (!d) return;
      const L = this.v.layout;
      const dx = (p.x - d.start.x) / L.scale, dy = (p.y - d.start.y) / L.scale;
      const c0 = d.startCrop;
      if (d.kind === 'rotate') {
        const a0 = Math.atan2(d.start.y - d.center.y, d.start.x - d.center.x);
        const a1 = Math.atan2(p.y - d.center.y, p.x - d.center.x);
        let deg = d.startAngle - ((a1 - a0) * 180) / Math.PI;
        this.s.angle = clamp(Math.round(deg * 100) / 100, -45, 45);
        this.setCropPx(this.fitToAngle(Object.assign({}, c0)));
      } else if (d.kind === 'move') {
        const to = { cx: c0.cx + dx, cy: c0.cy + dy, w: c0.w, h: c0.h };
        // slide along edges: try each axis independently
        let n = this.constrain(c0, to);
        const nx = this.constrain(n, { cx: to.cx, cy: n.cy, w: c0.w, h: c0.h });
        n = this.constrain(nx, { cx: nx.cx, cy: to.cy, w: c0.w, h: c0.h });
        this.setCropPx(n);
      } else {
        let x0 = c0.cx - c0.w / 2, x1 = c0.cx + c0.w / 2, y0 = c0.cy - c0.h / 2, y1 = c0.cy + c0.h / 2;
        const k = d.kind;
        if (k.includes('w')) x0 += dx;
        if (k.includes('e')) x1 += dx;
        if (k.includes('n')) y0 += dy;
        if (k.includes('s')) y1 += dy;
        const min = 16 / L.scale;
        if (x1 - x0 < min) { if (k.includes('w')) x0 = x1 - min; else x1 = x0 + min; }
        if (y1 - y0 < min) { if (k.includes('n')) y0 = y1 - min; else y1 = y0 + min; }
        const r = this.aspectRatio();
        if (r) {
          let w = x1 - x0, hh = y1 - y0;
          if (k === 'n' || k === 's') w = hh * r;
          else if (k === 'e' || k === 'w') hh = w / r;
          else { if (w / hh > r) hh = w / r; else w = hh * r; }
          if (k === 'n' || k === 's') { const cx = c0.cx; x0 = cx - w / 2; x1 = cx + w / 2; }
          else if (k.includes('w')) x0 = x1 - w; else x1 = x0 + w;
          if (k === 'e' || k === 'w') { const cy = c0.cy; y0 = cy - hh / 2; y1 = cy + hh / 2; }
          else if (k.includes('n')) y0 = y1 - hh; else y1 = y0 + hh;
        }
        const to = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
        this.setCropPx(this.constrain(c0, to));
      }
      this.v.requestRender();
      this.hooks.changed && this.hooks.changed();
    }
    up() {
      const d = this.drag;
      this.drag = null;
      this.v.redrawOverlay();
      if (d && (d.kind !== 'move' || true)) this.hooks.commit && this.hooks.commit(d.kind === 'rotate' ? 'Straighten' : 'Crop Rectangle');
    }
    draw(ctx, dpr) {
      const r = this.canvasRect();
      const W = ctx.canvas.width, H = ctx.canvas.height;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      const dragging = !!this.drag;
      const n = dragging && this.drag.kind === 'rotate' ? 8 : 3;
      ctx.strokeStyle = dragging ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(r.x + (r.w * i) / n, r.y); ctx.lineTo(r.x + (r.w * i) / n, r.y + r.h);
        ctx.moveTo(r.x, r.y + (r.h * i) / n); ctx.lineTo(r.x + r.w, r.y + (r.h * i) / n);
      }
      ctx.stroke();
      // corner brackets
      ctx.strokeStyle = LR.THEME.accent;
      ctx.lineWidth = 3 * dpr;
      const L = 18 * dpr;
      ctx.beginPath();
      [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y);
      });
      [[r.x + r.w / 2, r.y, 0], [r.x + r.w / 2, r.y + r.h, 0], [r.x, r.y + r.h / 2, 1], [r.x + r.w, r.y + r.h / 2, 1]].forEach(([x, y, vert]) => {
        if (vert) { ctx.moveTo(x, y - L / 2); ctx.lineTo(x, y + L / 2); } else { ctx.moveTo(x - L / 2, y); ctx.lineTo(x + L / 2, y); }
      });
      ctx.stroke();
      // dimensions label
      const c = this.cropPx();
      const f = this.eng.fullLong / Math.max(this.eng.texW, this.eng.texH);
      const txt = Math.round(c.w * f) + ' × ' + Math.round(c.h * f) + (this.s.angle ? '   ' + (this.s.angle > 0 ? '+' : '') + this.s.angle.toFixed(2) + '°' : '');
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      const tw = ctx.measureText(txt).width;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(r.x + r.w / 2 - tw / 2 - 6 * dpr, r.y + r.h + 8 * dpr, tw + 12 * dpr, 18 * dpr);
      ctx.fillStyle = '#ddd';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, r.x + r.w / 2 - tw / 2, r.y + r.h + 17 * dpr);
    }
  }

  /* =================== MASKS =================== */
  function newMask(type, geo) {
    return Object.assign({
      id: uid(), type, name: type === 'linear' ? 'Linear Gradient' : 'Radial Gradient', enabled: true, invert: false,
      feather: type === 'linear' ? 100 : 50, amount: 100, rot: 0,
      adj: { temp: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, clarity: 0 },
    }, geo);
  }

  class MaskTool {
    constructor(viewer, hooks) {
      this.v = viewer;
      this.hooks = hooks || {};
      this.selected = null;
      this.creating = null; // 'linear' | 'radial'
      this.drag = null;
    }
    get s() { return this.v.settings; }
    masks() { return this.s.masks || (this.s.masks = []); }
    sel() { return this.masks().find((m) => m.id === this.selected); }
    select(id) {
      this.selected = id;
      if (this.v.showMask) this.v.showMask = id;
      this.v.requestRender();
      this.hooks.select && this.hooks.select(id);
    }
    startCreate(type) {
      this.creating = type;
      this.v.stage.style.cursor = 'crosshair';
      LR.UI.toast(type === 'linear' ? 'Drag on the image to draw a Linear Gradient' : 'Drag on the image to draw a Radial Gradient');
    }
    remove(id) {
      this.s.masks = this.masks().filter((m) => m.id !== id);
      if (this.selected === id) this.selected = this.s.masks.length ? this.s.masks[this.s.masks.length - 1].id : null;
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit('Delete Mask');
      this.hooks.select && this.hooks.select(this.selected);
    }
    deactivate() {
      this.creating = null;
    }
    handles(m) {
      const v = this.v;
      if (m.type === 'linear') {
        const p0 = v.normToCanvas({ x: m.x0, y: m.y0 }), p1 = v.normToCanvas({ x: m.x1, y: m.y1 });
        return { p0, p1, c: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 } };
      }
      const [W, H] = v.engine.orientedSize(this.s);
      const a = ((m.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      // point at local ellipse offset (lx, ly) in source px, rotated by m.rot
      const at = (lx, ly) => v.normToCanvas({ x: m.cx + (ca * lx - sa * ly) / W, y: m.cy + (sa * lx + ca * ly) / H });
      const c = v.normToCanvas({ x: m.cx, y: m.cy });
      const RX = m.rx * W, RY = m.ry * H;
      return { c, ex: at(RX, 0), exn: at(-RX, 0), ey: at(0, RY), eyn: at(0, -RY) };
    }
    hit(p) {
      const t = 10 * (window.devicePixelRatio || 1);
      const d = (a) => Math.hypot(p.x - a.x, p.y - a.y);
      const m = this.sel();
      if (m) {
        const hs = this.handles(m);
        if (m.type === 'linear') {
          if (d(hs.p0) < t) return { m, part: 'p0' };
          if (d(hs.p1) < t) return { m, part: 'p1' };
          if (d(hs.c) < t * 1.2) return { m, part: 'move' };
        } else {
          if (d(hs.c) < t * 1.2) return { m, part: 'move' };
          for (const k of ['ex', 'exn', 'ey', 'eyn']) if (d(hs[k]) < t) return { m, part: k };
        }
      }
      for (const o of this.masks()) {
        if (o === m) continue;
        const hs = this.handles(o);
        if (d(hs.c) < t * 1.2) return { m: o, part: 'select' };
      }
      if (m && m.type === 'radial') {
        // drag on ellipse outline to rotate
        const hs = this.handles(m);
        const rx = Math.hypot(hs.ex.x - hs.c.x, hs.ex.y - hs.c.y), ry = Math.hypot(hs.ey.x - hs.c.x, hs.ey.y - hs.c.y);
        const ang = Math.atan2(hs.ex.y - hs.c.y, hs.ex.x - hs.c.x);
        const dx = p.x - hs.c.x, dy = p.y - hs.c.y;
        const lx = Math.cos(-ang) * dx - Math.sin(-ang) * dy, ly = Math.sin(-ang) * dx + Math.cos(-ang) * dy;
        const e = Math.hypot(lx / rx, ly / ry);
        if (Math.abs(e - 1) < 0.08) return { m, part: 'rotate' };
      }
      return null;
    }
    hover(p) {
      if (this.creating) return 'crosshair';
      const h = this.hit(p);
      if (!h) return 'default';
      return { p0: 'grab', p1: 'grab', move: 'move', select: 'pointer', ex: 'ew-resize', exn: 'ew-resize', ey: 'ns-resize', eyn: 'ns-resize', rotate: 'alias' }[h.part];
    }
    down(p, e) {
      const n = this.v.canvasToNorm(p);
      if (this.creating) {
        const type = this.creating;
        const m = type === 'linear' ? newMask('linear', { x0: n.x, y0: n.y, x1: n.x, y1: n.y + 0.001 }) : newMask('radial', { cx: n.x, cy: n.y, rx: 0.001, ry: 0.001 });
        this.masks().push(m);
        this.selected = m.id;
        this.creating = null;
        this.drag = { part: type === 'linear' ? 'p1' : 'create', m, startN: n, start: p, created: true };
        this.hooks.select && this.hooks.select(m.id);
        return;
      }
      const h = this.hit(p);
      if (!h) return false;
      if (h.part === 'select') { this.select(h.m.id); return; }
      this.drag = { part: h.part, m: h.m, startN: n, start: p, orig: Settings.clone(h.m) };
    }
    move(p, e) {
      const d = this.drag;
      if (!d) return;
      const n = this.v.canvasToNorm(p);
      const m = d.m, o = d.orig;
      const [W, H] = this.v.engine.orientedSize(this.s);
      if (d.part === 'p0') { m.x0 = n.x; m.y0 = n.y; }
      else if (d.part === 'p1') { m.x1 = n.x; m.y1 = n.y; }
      else if (d.part === 'move') {
        const dx = n.x - d.startN.x, dy = n.y - d.startN.y;
        if (m.type === 'linear') { m.x0 = o.x0 + dx; m.y0 = o.y0 + dy; m.x1 = o.x1 + dx; m.y1 = o.y1 + dy; }
        else { m.cx = o.cx + dx; m.cy = o.cy + dy; }
      } else if (d.part === 'create') {
        const dx = (n.x - d.startN.x) * W, dy = (n.y - d.startN.y) * H;
        let rx = Math.abs(dx), ry = Math.abs(dy);
        if (e.shiftKey) rx = ry = Math.max(rx, ry);
        m.rx = Math.max(rx / W, 0.002);
        m.ry = Math.max(ry / H, 0.002);
      } else if (d.part === 'rotate') {
        const c = { x: m.cx * W, y: m.cy * H };
        const a0 = Math.atan2(d.startN.y * H - c.y, d.startN.x * W - c.x), a1 = Math.atan2(n.y * H - c.y, n.x * W - c.x);
        m.rot = o.rot + ((a1 - a0) * 180) / Math.PI;
      } else {
        // radial radius handles, measured in the ellipse's rotated frame
        const a = ((m.rot || 0) * Math.PI) / 180;
        const dx = (n.x - m.cx) * W, dy = (n.y - m.cy) * H;
        const lx = Math.cos(a) * dx + Math.sin(a) * dy, ly = -Math.sin(a) * dx + Math.cos(a) * dy;
        if (d.part === 'ex' || d.part === 'exn') m.rx = Math.max(Math.abs(lx) / W, 0.003);
        else m.ry = Math.max(Math.abs(ly) / H, 0.003);
      }
      this.v.requestRender();
      this.hooks.changed && this.hooks.changed();
    }
    up() {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.created && d.m.type === 'radial' && d.m.rx < 0.01 && d.m.ry < 0.01) {
        const [W, H] = this.v.engine.orientedSize(this.s);
        const r = 0.18 * Math.min(W, H);
        d.m.rx = r / W; d.m.ry = r / H;
      }
      if (d.created && d.m.type === 'linear' && Math.hypot(d.m.x1 - d.m.x0, d.m.y1 - d.m.y0) < 0.01) { d.m.y1 = d.m.y0 + 0.25; }
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit(d.created ? 'Add ' + d.m.name : 'Edit ' + d.m.name);
    }
    draw(ctx, dpr) {
      const ms = this.masks();
      ms.forEach((m) => {
        const hs = this.handles(m);
        const isSel = m.id === this.selected;
        if (isSel) {
          ctx.lineWidth = 1.2 * dpr;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 2 * dpr;
          if (m.type === 'linear') {
            const dx = hs.p1.x - hs.p0.x, dy = hs.p1.y - hs.p0.y, len = Math.hypot(dx, dy) || 1;
            const px = -dy / len, py = dx / len, ext = 4000;
            [[hs.p0, []], [hs.c, [6 * dpr, 4 * dpr]], [hs.p1, []]].forEach(([pt, dash]) => {
              ctx.setLineDash(dash);
              ctx.beginPath();
              ctx.moveTo(pt.x - px * ext, pt.y - py * ext);
              ctx.lineTo(pt.x + px * ext, pt.y + py * ext);
              ctx.stroke();
            });
            ctx.setLineDash([]);
            [hs.p0, hs.p1].forEach((pt) => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 4 * dpr, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); });
          } else {
            const rx = Math.hypot(hs.ex.x - hs.c.x, hs.ex.y - hs.c.y), ry = Math.hypot(hs.ey.x - hs.c.x, hs.ey.y - hs.c.y);
            const ang = Math.atan2(hs.ex.y - hs.c.y, hs.ex.x - hs.c.x);
            ctx.beginPath();
            ctx.ellipse(hs.c.x, hs.c.y, Math.max(rx, 1), Math.max(ry, 1), ang, 0, Math.PI * 2);
            ctx.stroke();
            const f = 1 - m.feather / 100;
            if (f > 0.02 && f < 0.98) {
              ctx.setLineDash([5 * dpr, 4 * dpr]);
              ctx.beginPath();
              ctx.ellipse(hs.c.x, hs.c.y, Math.max(rx * f, 1), Math.max(ry * f, 1), ang, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            ['ex', 'exn', 'ey', 'eyn'].forEach((k) => { ctx.beginPath(); ctx.rect(hs[k].x - 3.5 * dpr, hs[k].y - 3.5 * dpr, 7 * dpr, 7 * dpr); ctx.fillStyle = '#fff'; ctx.fill(); });
          }
          ctx.shadowBlur = 0;
        }
        // pin
        ctx.beginPath();
        ctx.arc(hs.c.x, hs.c.y, 6 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? LR.THEME.accent : 'rgba(255,255,255,0.85)';
        ctx.fill();
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = isSel ? '#fff' : 'rgba(0,0,0,0.7)';
        ctx.stroke();
      });
    }
  }

  /* =================== WB PICKER =================== */
  class WBPickerTool {
    constructor(viewer, hooks) {
      this.v = viewer;
      this.hooks = hooks || {};
      this.sample = null;
    }
    async ensureSample() {
      const p = this.v.photo;
      if (this.sample && this.sample.blobId === p.blobId) return this.sample;
      const bmp = await LR.Catalog.getBitmap(p, 1200);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0);
      this.sample = { blobId: p.blobId, ctx: x, w: c.width, h: c.height };
      return this.sample;
    }
    hover(p) {
      this.last = p;
      this.v.redrawOverlay();
      return 'crosshair';
    }
    down() {}
    async up(p) {
      const s = this.v.settings;
      const n = this.v.canvasToNorm(p);
      if (n.x < 0 || n.y < 0 || n.x > 1 || n.y > 1) return;
      const smp = await this.ensureSample();
      const t = toTex(n, s);
      const x = Math.round(t.x * (smp.w - 1)), y = Math.round(t.y * (smp.h - 1));
      const d = smp.ctx.getImageData(clamp(x - 2, 0, smp.w - 5), clamp(y - 2, 0, smp.h - 5), 5, 5).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += s2l(d[i] / 255); g += s2l(d[i + 1] / 255); b += s2l(d[i + 2] / 255); }
      const wb = solveWB(r, g, b);
      s.temp = wb.temp;
      s.tint = wb.tint;
      s.wbMode = 'Custom';
      this.v.requestRender();
      this.hooks.commit && this.hooks.commit('White Balance: Custom');
      this.hooks.done && this.hooks.done();
    }
    draw(ctx, dpr) {
      if (!this.last) return;
      const p = this.last;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(p.x - 12 * dpr, p.y - 12 * dpr, 24 * dpr, 24 * dpr);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeRect(p.x - 13.5 * dpr, p.y - 13.5 * dpr, 27 * dpr, 27 * dpr);
    }
  }

  function s2l(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toTex(u, s) {
    let x = u.x, y = u.y;
    if (s.flipH) x = 1 - x;
    if (s.flipV) y = 1 - y;
    switch (s.orientation || 0) {
      case 1: return { x: y, y: 1 - x };
      case 2: return { x: 1 - x, y: 1 - y };
      case 3: return { x: 1 - y, y: x };
      default: return { x, y };
    }
  }
  function solveWB(r, g, b) {
    r = Math.max(r, 1e-5); g = Math.max(g, 1e-5); b = Math.max(b, 1e-5);
    const t = Math.log(b / r) / 0.9;
    const m = (Math.log(g) - Math.log(r) - 0.45 * t) / 0.35;
    return { temp: clamp(Math.round(t * 100), -100, 100), tint: clamp(Math.round(m * 100), -100, 100) };
  }

  /** Auto tone & auto white balance from source statistics. */
  async function autoSettings(photo, which) {
    const bmp = await LR.Catalog.getBitmap(photo, 1200);
    const c = document.createElement('canvas');
    const sc = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
    c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const out = {};
    if (which.includes('wb')) {
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = s2l(d[i] / 255), G = s2l(d[i + 1] / 255), B = s2l(d[i + 2] / 255);
        const mx = Math.max(R, G, B);
        if (mx > 0.98 || mx < 0.02) continue;
        r += R; g += G; b += B;
      }
      const wb = solveWB(r, g, b);
      out.temp = Math.round(wb.temp * 0.8);
      out.tint = Math.round(wb.tint * 0.8);
    }
    if (which.includes('tone')) {
      const hist = new Uint32Array(256);
      let sumLin = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        hist[Math.round(l)]++;
        sumLin += s2l(l / 255);
        n++;
      }
      const pct = (p) => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= p * n) return i / 255; } return 1; };
      const meanLin = sumLin / n;
      const p01 = pct(0.005), p99 = pct(0.995), p50 = pct(0.5);
      const ev = clamp(Math.log2(0.16 / Math.max(meanLin, 1e-4)) * 0.6, -2.5, 2.5);
      out.exposure = Math.round(ev * 100) / 100;
      const hiClip = hist.slice(250).reduce((a, b) => a + b, 0) / n;
      out.highlights = Math.round(clamp(-hiClip * 900 - (p99 > 0.95 ? 20 : 0), -80, 0));
      out.shadows = Math.round(clamp((0.35 - p50) * 90, -10, 50));
      out.whites = Math.round(clamp((0.94 - p99) * 120, -30, 40));
      out.blacks = Math.round(clamp((0.03 - p01) * 200, -40, 20));
      out.contrast = Math.round(clamp((0.55 - (p99 - p01)) * 40, -20, 30));
      out.vibrance = 10;
    }
    return out;
  }

  LR.Tools = { CropTool, MaskTool, WBPickerTool, ASPECTS, newMask, autoSettings };
})();
