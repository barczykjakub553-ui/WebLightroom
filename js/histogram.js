/* WebLightroom — RGB histogram panel. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h } = LR.UI;

  class Histogram {
    constructor(opts) {
      this.opts = opts || {};
      this.canvas = h('canvas.histo-canvas', { width: 260, height: 110 });
      this.clipL = h('div.clip-ind.left', { title: 'Show Shadow Clipping (J)' });
      this.clipR = h('div.clip-ind.right', { title: 'Show Highlight Clipping (J)' });
      this.clipL.addEventListener('click', () => LR.bus.emit('toggle-clipping'));
      this.clipR.addEventListener('click', () => LR.bus.emit('toggle-clipping'));
      this.info = h('div.histo-info');
      this.el = h('div.histo', null, h('div.histo-wrap', null, this.canvas, this.clipL, this.clipR), this.info);
      this.bins = null;
    }
    compute(pixels) {
      const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
      for (let i = 0; i < pixels.length; i += 4) {
        const R = pixels[i], G = pixels[i + 1], B = pixels[i + 2];
        r[R]++; g[G]++; b[B]++;
        l[(R * 54 + G * 183 + B * 19) >> 8]++;
      }
      this.bins = { r, g, b, l, total: pixels.length / 4 };
      this.draw();
      return this.bins;
    }
    fromImage(img) {
      const c = document.createElement('canvas');
      const sc = Math.min(1, 300 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * sc));
      c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * sc));
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      this.compute(ctx.getImageData(0, 0, c.width, c.height).data);
    }
    clear() {
      this.bins = null;
      this.draw();
    }
    draw() {
      const cv = this.canvas, dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth || 260, H = cv.clientHeight || 110;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const x = cv.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = '#1a1a1a';
      x.fillRect(0, 0, W, H);
      x.strokeStyle = 'rgba(255,255,255,0.07)';
      x.lineWidth = 1;
      for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(Math.round((W * i) / 4) + 0.5, 0); x.lineTo(Math.round((W * i) / 4) + 0.5, H); x.stroke(); }
      if (!this.bins) return;
      const { r, g, b, total } = this.bins;
      // scale: ignore extreme spikes at ends (like Lightroom)
      let max = 0;
      for (let i = 2; i < 254; i++) max = Math.max(max, r[i], g[i], b[i]);
      max = Math.max(max, total / 256) * 1.08;
      const path = (arr) => {
        x.beginPath();
        x.moveTo(0, H);
        for (let i = 0; i < 256; i++) {
          const v = Math.min(1, Math.sqrt(arr[i] / max) * 0.92 + 0) ;
          x.lineTo((i / 255) * W, H - v * (H - 4));
        }
        x.lineTo(W, H);
        x.closePath();
      };
      x.globalCompositeOperation = 'lighter';
      [[r, 'rgba(200,50,50,0.85)'], [g, 'rgba(50,170,60,0.85)'], [b, 'rgba(50,90,210,0.85)']].forEach(([arr, col]) => {
        path(arr);
        x.fillStyle = col;
        x.fill();
      });
      x.globalCompositeOperation = 'source-over';
      const clipLo = r[0] + g[0] + b[0] > total * 0.003, clipHi = r[255] + g[255] + b[255] > total * 0.003;
      this.clipL.classList.toggle('on', clipLo);
      this.clipR.classList.toggle('on', clipHi);
    }
    setClipActive(on) {
      this.clipL.classList.toggle('active', on);
      this.clipR.classList.toggle('active', on);
    }
    setInfo(p) {
      if (!p) { this.info.textContent = ''; return; }
      const e = p.exif || {};
      const parts = [];
      if (e.iso) parts.push('ISO ' + e.iso);
      if (e.focalLength) parts.push(Math.round(e.focalLength) + ' mm');
      if (e.fNumber) parts.push('f / ' + (Math.round(e.fNumber * 10) / 10));
      if (e.exposureTime) parts.push(LR.Exif.fmtShutter(e.exposureTime));
      this.info.textContent = parts.length ? parts.join('    ') : p.width + ' × ' + p.height + '  ·  ' + (p.type || '').replace('image/', '').toUpperCase();
    }
  }
  LR.Histogram = Histogram;
})();
