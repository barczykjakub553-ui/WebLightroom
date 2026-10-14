/* WebLightroom — image viewer: GPU preview with zoom / pan, before-after, tool overlays. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h, clamp } = LR.UI;
  const { Settings } = LR;

  const PREVIEW_LONG = 4096;

  class Viewer {
    constructor() {
      this.glCanvas = h('canvas.view-gl');
      this.overlay = h('canvas.view-overlay');
      this.placeholder = h('img.view-placeholder', { alt: '' });
      this.badge = h('div.view-badge');
      this.loading = h('div.view-loading', { text: 'Loading…' });
      this.info = h('div.view-info');
      this.stage = h('div.view-stage', null, this.placeholder, this.glCanvas, this.overlay, this.badge, this.info, this.loading);
      this.el = this.stage;
      this.engine = new LR.Engine(this.glCanvas);
      this.photo = null;
      this.loadedId = null;
      this.loadToken = 0;
      this.zoom = 'fit';
      this.pan = { x: 0.5, y: 0.5 };
      this.mode = 'normal';
      this.before = false;
      this.split = false;
      this.clipWarn = false;
      this.showMask = null;
      this.tool = null;
      this.infoMode = 0;
      this.layout = null;
      this.requestRender = LR.UI.throttleRAF(() => this._render());
      this.histoTimer = null;
      new ResizeObserver(() => this.requestRender()).observe(this.stage);
      this._bindPointer();
    }

    /* ---------- loading ---------- */
    async load(photo) {
      this.photo = photo;
      if (!photo) {
        this.loadedId = null;
        this.glCanvas.style.visibility = 'hidden';
        this.placeholder.style.display = 'none';
        this.loading.style.display = 'none';
        this.info.textContent = '';
        this._drawOverlay();
        return;
      }
      const token = ++this.loadToken;
      if (this.loadedBlob === photo.blobId) {
        this.loadedId = photo.id;
        this.requestRender();
        LR.bus.emit('viewer-loaded', photo);
        return;
      }
      const url = LR.Catalog.thumbURL(photo.id);
      if (url) { this.placeholder.src = url; this.placeholder.style.display = ''; }
      this.glCanvas.style.visibility = 'hidden';
      this.loading.style.display = '';
      try {
        const long = Math.min(PREVIEW_LONG, this.engine.maxTex);
        const bmp = await LR.Catalog.getBitmap(photo, long);
        if (token !== this.loadToken) return;
        this.engine.setImage(bmp, Math.max(photo.width, photo.height));
        this.loadedBlob = photo.blobId;
        this.loadedId = photo.id;
        this.loading.style.display = 'none';
        this._render();
        this.glCanvas.style.visibility = '';
        this.placeholder.style.display = 'none';
        LR.bus.emit('viewer-loaded', photo);
      } catch (e) {
        console.error(e);
        this.loading.textContent = 'Could not load image';
      }
    }

    get settings() {
      return this.photo ? this.photo.settings : null;
    }
    beforeSettings() {
      const s = this.photo.settings;
      const b = Settings.defaults();
      ['crop', 'angle', 'orientation', 'flipH', 'flipV'].forEach((k) => (b[k] = Settings.clone(s[k])));
      return b;
    }

    /* ---------- layout ---------- */
    _computeLayout(areaW, areaH, offsetX) {
      const eng = this.engine, s = this.settings;
      const [RW, RH] = eng.regionSize(s, this.mode);
      const dpr = window.devicePixelRatio || 1;
      const f = eng.fullLong / Math.max(eng.texW, eng.texH);
      const margin = this.mode === 'crop' ? 36 * dpr : 0;
      let scale;
      if (this.zoom === 'fit' || this.mode === 'crop') scale = Math.min((areaW - margin * 2) / RW, (areaH - margin * 2) / RH);
      else if (this.zoom === 'fill') scale = Math.max(areaW / RW, areaH / RH);
      else scale = this.zoom * f;
      const dw = RW * scale, dh = RH * scale;
      let offX, offY;
      if (dw <= areaW) offX = (areaW - dw) / 2;
      else offX = clamp(areaW / 2 - this.pan.x * dw, areaW - dw, 0);
      if (dh <= areaH) offY = (areaH - dh) / 2;
      else offY = clamp(areaH / 2 - this.pan.y * dh, areaH - dh, 0);
      return { RW, RH, scale, offX: offX + (offsetX || 0), offY, dw, dh, areaW, areaH, f };
    }
    fitScale() {
      if (!this.photo || !this.engine.src) return 1;
      const dpr = window.devicePixelRatio || 1;
      const [RW, RH] = this.engine.regionSize(this.settings, 'normal');
      const f = this.engine.fullLong / Math.max(this.engine.texW, this.engine.texH);
      return Math.min((this.stage.clientWidth * dpr) / RW, (this.stage.clientHeight * dpr) / RH) / f;
    }

    _render() {
      if (!this.photo || this.loadedId !== this.photo.id || !this.engine.src) { this._drawOverlay(); return; }
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(this.stage.clientWidth * dpr)), H = Math.max(1, Math.round(this.stage.clientHeight * dpr));
      if (this.glCanvas.width !== W || this.glCanvas.height !== H) { this.glCanvas.width = W; this.glCanvas.height = H; }
      const bg = this.bgColor || [0.137, 0.137, 0.137];
      const common = { width: W, height: H, mode: this.mode, clipWarn: this.clipWarn, showMask: this.showMask, bg };
      const s = this.settings;
      if (this.split && this.mode !== 'crop') {
        const half = Math.floor(W / 2);
        const L1 = this._computeLayout(half, H, 0);
        const L2 = this._computeLayout(W - half, H, half);
        this.engine.render(this.beforeSettings(), Object.assign({}, common, { scale: L1.scale, offX: L1.offX, offY: L1.offY, scissor: [0, 0, half, H], showMask: null, clipWarn: false }));
        this.engine.render(s, Object.assign({}, common, { scale: L2.scale, offX: L2.offX, offY: L2.offY, scissor: [half, 0, W - half, H] }));
        this.layout = L2;
        this.layoutBefore = L1;
        this.badge.innerHTML = '<span>Before</span><span>After</span>';
        this.badge.className = 'view-badge split';
      } else {
        const L = this._computeLayout(W, H, 0);
        this.engine.render(this.before ? this.beforeSettings() : s, Object.assign({}, common, { scale: L.scale, offX: L.offX, offY: L.offY }));
        this.layout = L;
        this.layoutBefore = null;
        this.badge.textContent = this.before ? 'Before' : '';
        this.badge.className = 'view-badge' + (this.before ? ' show' : '');
      }
      this._drawOverlay();
      this._updateInfo();
      LR.bus.emit('viewer-render');
      clearTimeout(this.histoTimer);
      this.histoTimer = setTimeout(() => this._histogram(), 90);
    }
    _histogram() {
      if (!this.photo || !this.engine.src || !this.onHistogram) return;
      const r = this.engine.renderFit(this.before ? this.beforeSettings() : this.settings, 320);
      this.onHistogram(r.pixels);
    }
    _updateInfo() {
      const p = this.photo;
      if (!p || !this.infoMode) { this.info.style.display = 'none'; return; }
      this.info.style.display = '';
      const e = p.exif || {};
      const lines = [p.name + (p.virtualCopy ? ' / ' + p.copyName : '')];
      if (this.infoMode === 1) lines.push(new Date(p.captureTime).toLocaleString(), p.width + ' × ' + p.height);
      else {
        lines.push([e.exposureTime && LR.Exif.fmtShutter(e.exposureTime), e.fNumber && 'f/' + e.fNumber.toFixed(1), e.iso && 'ISO ' + e.iso].filter(Boolean).join(' at ') || '—');
        lines.push([e.focalLength && Math.round(e.focalLength) + ' mm', e.lensModel].filter(Boolean).join(' · ') || [e.make, e.model].filter(Boolean).join(' ') || '');
      }
      this.info.innerHTML = lines.map((l, i) => `<div class="${i ? '' : 'title'}">${escapeHtml(l)}</div>`).join('');
    }
    cycleInfo() {
      this.infoMode = (this.infoMode + 1) % 3;
      this._updateInfo();
    }

    /* ---------- coordinate transforms (device px) ---------- */
    canvasPoint(e) {
      const r = this.stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
    }
    /** canvas px -> region px */
    toRegion(p) {
      const L = this.layout;
      return { x: (p.x - L.offX) / L.scale, y: (p.y - L.offY) / L.scale };
    }
    fromRegion(p) {
      const L = this.layout;
      return { x: p.x * L.scale + L.offX, y: p.y * L.scale + L.offY };
    }
    _qOrigin() {
      const s = this.settings, eng = this.engine;
      if (this.mode === 'crop') { const [RW, RH] = eng.regionSize(s, 'crop'); return { x: -RW / 2, y: -RH / 2 }; }
      const c = eng.cropPx(s);
      return { x: c.cx - c.w / 2, y: c.cy - c.h / 2 };
    }
    /** region px -> oriented source px */
    regionToSrc(p) {
      const s = this.settings, [W, H] = this.engine.orientedSize(s);
      const o = this._qOrigin();
      const qx = o.x + p.x, qy = o.y + p.y;
      const a = ((s.angle || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      return { x: W / 2 + ca * qx + sa * qy, y: H / 2 - sa * qx + ca * qy };
    }
    srcToRegion(p) {
      const s = this.settings, [W, H] = this.engine.orientedSize(s);
      const dx = p.x - W / 2, dy = p.y - H / 2;
      const a = ((s.angle || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const qx = ca * dx - sa * dy, qy = sa * dx + ca * dy;
      const o = this._qOrigin();
      return { x: qx - o.x, y: qy - o.y };
    }
    /** canvas px <-> normalized oriented source coords (0..1) */
    canvasToNorm(p) {
      const [W, H] = this.engine.orientedSize(this.settings);
      const s = this.regionToSrc(this.toRegion(p));
      return { x: s.x / W, y: s.y / H };
    }
    normToCanvas(n) {
      const [W, H] = this.engine.orientedSize(this.settings);
      return this.fromRegion(this.srcToRegion({ x: n.x * W, y: n.y * H }));
    }
    /** pixel length conversion: normalized-x units -> canvas px */
    normScaleX() {
      const [W] = this.engine.orientedSize(this.settings);
      return W * this.layout.scale;
    }
    normScaleY() {
      const [, H] = this.engine.orientedSize(this.settings);
      return H * this.layout.scale;
    }

    /* ---------- zoom ---------- */
    setZoom(z, centerCanvasPt) {
      if (!this.photo) return;
      if (centerCanvasPt && this.layout && z !== 'fit') {
        const rp = this.toRegion(centerCanvasPt);
        this.pan = { x: clamp(rp.x / this.layout.RW, 0, 1), y: clamp(rp.y / this.layout.RH, 0, 1) };
      }
      this.zoom = z;
      this.requestRender();
      LR.bus.emit('zoom', z);
    }
    toggleZoom(pt) {
      if (this.zoom === 'fit') this.setZoom(this.lastZoom || 1, pt);
      else { this.lastZoom = this.zoom; this.setZoom('fit'); }
    }
    zoomLabel() {
      if (this.zoom === 'fit') return 'Fit';
      if (this.zoom === 'fill') return 'Fill';
      return Math.round(this.zoom * 100) + '%';
    }
    visibleRect() {
      const L = this.layout;
      if (!L) return null;
      return {
        x: clamp(-L.offX / L.dw, 0, 1), y: clamp(-L.offY / L.dh, 0, 1),
        w: clamp(L.areaW / L.dw, 0, 1), h: clamp(L.areaH / L.dh, 0, 1),
      };
    }

    /* ---------- pointer ---------- */
    _bindPointer() {
      const st = this.stage;
      let drag = null;
      st.addEventListener('pointerdown', (e) => {
        if (!this.photo || !this.layout || e.button !== 0) return;
        const p = this.canvasPoint(e);
        if (this.tool && !this.spaceDown && this.tool.down && this.tool.down(p, e) !== false) {
          st.setPointerCapture(e.pointerId);
          drag = { tool: true };
          return;
        }
        st.setPointerCapture(e.pointerId);
        drag = { start: p, pan: Object.assign({}, this.pan), moved: false };
      });
      st.addEventListener('pointermove', (e) => {
        if (!this.photo || !this.layout) return;
        const p = this.canvasPoint(e);
        if (drag && drag.tool) { this.tool.move && this.tool.move(p, e); return; }
        if (drag) {
          const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
          if (drag.moved && this.zoom !== 'fit') {
            this.pan = { x: clamp(drag.pan.x - dx / this.layout.dw, 0, 1), y: clamp(drag.pan.y - dy / this.layout.dh, 0, 1) };
            st.classList.add('panning');
            this.requestRender();
          }
          return;
        }
        if (this.tool && this.tool.hover && !this.spaceDown) st.style.cursor = this.tool.hover(p, e) || '';
        else st.style.cursor = this.zoom === 'fit' ? 'zoom-in' : 'grab';
      });
      const up = (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        st.classList.remove('panning');
        if (d.tool) { this.tool && this.tool.up && this.tool.up(this.canvasPoint(e), e); return; }
        if (!d.moved && this.clickZoom !== false) this.toggleZoom(d.start);
      };
      st.addEventListener('pointerup', up);
      st.addEventListener('pointercancel', up);
      st.addEventListener('wheel', (e) => {
        if (!this.photo || !this.layout) return;
        if (!(e.ctrlKey || e.metaKey) && this.zoom === 'fit') return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const cur = this.zoom === 'fit' || this.zoom === 'fill' ? this.layout.scale / this.layout.f : this.zoom;
          const nz = clamp(cur * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.05, 11);
          const p = this.canvasPoint(e);
          const rp = this.toRegion(p);
          this.zoom = nz;
          // keep point under cursor fixed
          const L = this._computeLayout(this.layout.areaW, this.layout.areaH, 0);
          this.pan = { x: clamp((rp.x * L.scale - p.x + L.areaW / 2) / L.dw, 0, 1), y: clamp((rp.y * L.scale - p.y + L.areaH / 2) / L.dh, 0, 1) };
          this.requestRender();
          LR.bus.emit('zoom', nz);
        } else {
          this.pan = { x: clamp(this.pan.x + e.deltaX / this.layout.dw, 0, 1), y: clamp(this.pan.y + e.deltaY / this.layout.dh, 0, 1) };
          this.requestRender();
        }
      }, { passive: false });
      window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !LR.UI.isTyping(e)) this.spaceDown = true; });
      window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
    }

    setTool(tool) {
      if (this.tool && this.tool.deactivate) this.tool.deactivate();
      this.tool = tool;
      this.stage.style.cursor = '';
      this.requestRender();
    }

    /* ---------- overlay ---------- */
    _drawOverlay() {
      const ov = this.overlay;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(this.stage.clientWidth * dpr), H = Math.round(this.stage.clientHeight * dpr);
      if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
      const ctx = ov.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (this.split && this.mode !== 'crop' && this.layout) {
        ctx.fillStyle = '#111';
        ctx.fillRect(Math.floor(W / 2) - 1, 0, 2, H);
      }
      if (this.tool && this.tool.draw && this.photo && this.layout && this.loadedId === this.photo.id) this.tool.draw(ctx, dpr);
    }
    redrawOverlay() {
      this._drawOverlay();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  LR.escapeHtml = escapeHtml;
  LR.Viewer = Viewer;
})();
