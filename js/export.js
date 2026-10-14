/* Stopbath — Export dialog & renderer. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h, select } = LR.UI;
  const { Catalog, Settings } = LR;

  const PREF_KEY = 'lr-export';
  let engine = null;

  function prefs() {
    return Object.assign({
      format: 'image/jpeg', quality: 90, resize: 'none', longEdge: 2048, percent: 50, naming: 'original', custom: 'Edited', suffix: '-edited',
      sharpen: 'none', watermark: false, wmText: '© ' + new Date().getFullYear(), wmSize: 3, wmOpacity: 70, dest: 'downloads',
    }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}'));
  }

  async function open(list) {
    const photos = list || Catalog.targets();
    if (!photos.length) { LR.UI.toast('Select photos to export'); return; }
    const o = prefs();
    const canPickDir = 'showDirectoryPicker' in window;
    const field = (label, ...ctl) => h('div.form-row', null, h('label', { text: label }), ...ctl);
    const fmt = select([['image/jpeg', 'JPEG'], ['image/png', 'PNG'], ['image/webp', 'WebP']], o.format, (v) => { o.format = v; sync(); });
    const q = h('input', { type: 'range', min: 10, max: 100, value: o.quality });
    const qv = h('span.form-val', { text: o.quality });
    q.addEventListener('input', () => { o.quality = +q.value; qv.textContent = q.value; });
    const qRow = field('Quality', q, qv);
    const resize = select([['none', "Don't resize"], ['long', 'Long Edge'], ['percent', 'Percentage']], o.resize, (v) => { o.resize = v; sync(); });
    const longIn = h('input.text.num', { type: 'number', min: 64, max: 16000, value: o.longEdge });
    longIn.addEventListener('change', () => (o.longEdge = +longIn.value));
    const pctIn = h('input.text.num', { type: 'number', min: 1, max: 100, value: o.percent });
    pctIn.addEventListener('change', () => (o.percent = +pctIn.value));
    const sizeExtra = h('span');
    const naming = select([['original', 'Filename'], ['suffix', 'Filename + Suffix'], ['custom', 'Custom Name - Sequence']], o.naming, (v) => { o.naming = v; sync(); });
    const customIn = h('input.text', { type: 'text', value: o.custom });
    customIn.addEventListener('input', () => (o.custom = customIn.value));
    const suffixIn = h('input.text', { type: 'text', value: o.suffix });
    suffixIn.addEventListener('input', () => (o.suffix = suffixIn.value));
    const nameExtra = h('span');
    const sharpen = select([['none', 'None'], ['low', 'Screen — Low'], ['standard', 'Screen — Standard'], ['high', 'Screen — High']], o.sharpen, (v) => (o.sharpen = v));
    const wmCb = h('input', { type: 'checkbox', checked: o.watermark, onchange: () => { o.watermark = wmCb.checked; sync(); } });
    const wmText = h('input.text', { type: 'text', value: o.wmText });
    wmText.addEventListener('input', () => (o.wmText = wmText.value));
    const wmRow = h('div.wm-opts', null, field('Text', wmText));
    const dest = select([['downloads', 'Browser Downloads'], ...(canPickDir ? [['folder', 'Choose Folder…']] : [])], o.dest, (v) => (o.dest = v));
    const preview = h('div.export-note');

    function sync() {
      qRow.style.display = o.format === 'image/png' ? 'none' : '';
      sizeExtra.innerHTML = '';
      if (o.resize === 'long') sizeExtra.append(longIn, ' px');
      if (o.resize === 'percent') sizeExtra.append(pctIn, ' %');
      nameExtra.innerHTML = '';
      if (o.naming === 'custom') nameExtra.append(customIn);
      if (o.naming === 'suffix') nameExtra.append(suffixIn);
      wmRow.style.display = o.watermark ? '' : 'none';
      preview.textContent = 'Example: ' + fileName(photos[0], 0, o);
    }
    sync();
    [customIn, suffixIn].forEach((i) => i.addEventListener('input', sync));
    [customIn, suffixIn, wmText, longIn, pctIn].forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));

    const body = h('div.export',
      null,
      h('div.form-section', { text: 'Export Location' }), field('Export To', dest),
      h('div.form-section', { text: 'File Naming' }), field('Template', naming, nameExtra), preview,
      h('div.form-section', { text: 'File Settings' }), field('Image Format', fmt), qRow,
      h('div.form-section', { text: 'Image Sizing' }), field('Resize to Fit', resize, sizeExtra),
      h('div.form-section', { text: 'Output Sharpening' }), field('Sharpen For', sharpen),
      h('div.form-section', { text: 'Watermarking' }), h('label.check', null, wmCb, ' Add text watermark'), wmRow);
    const ok = await LR.UI.modal('Export ' + photos.length + ' File' + (photos.length > 1 ? 's' : ''), body, [
      { label: 'Cancel', value: false },
      { label: 'Export', value: true, primary: true },
    ], { width: 520 });
    if (!ok) return;
    localStorage.setItem(PREF_KEY, JSON.stringify(o));
    await run(photos, o);
  }

  function ext(type) { return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type]; }
  function fileName(p, i, o) {
    const base = p.name.replace(/\.[^.]+$/, '') + (p.virtualCopy ? '-' + p.copyName.replace(/\s+/g, '') : '');
    let n = base;
    if (o.naming === 'suffix') n = base + o.suffix;
    if (o.naming === 'custom') n = (o.custom || 'Export') + '-' + String(i + 1).padStart(3, '0');
    return n + '.' + ext(o.format);
  }

  async function run(photos, o) {
    let dir = null;
    if (o.dest === 'folder') {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { return; }
    }
    if (!engine) {
      const c = document.createElement('canvas');
      engine = new LR.Engine(c);
    }
    const cap = Math.min(engine.maxTex, 8192);
    let done = 0;
    LR.bus.emit('progress', { label: 'Exporting', done: 0, total: photos.length });
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      try {
        const bmp = await Catalog.getBitmap(p, cap);
        engine.setImage(bmp, Math.max(p.width, p.height));
        const s = Settings.clone(p.settings);
        const extra = { none: 0, low: 15, standard: 30, high: 50 }[o.sharpen] || 0;
        if (extra) s.sharpen.amount = Math.min(150, s.sharpen.amount + extra);
        const [RW, RH] = engine.regionSize(s, 'normal');
        const f = engine.fullLong / Math.max(engine.texW, engine.texH);
        let W = RW * f, H = RH * f; // full-resolution crop size
        let sc = 1;
        if (o.resize === 'long') sc = Math.min(1, o.longEdge / Math.max(W, H));
        if (o.resize === 'percent') sc = Math.max(0.01, o.percent / 100);
        W = Math.max(1, Math.round(W * sc));
        H = Math.max(1, Math.round(H * sc));
        // never exceed rendering capacity
        const lim = Math.min(engine.maxTex, 8192) / Math.max(W, H);
        if (lim < 1) { W = Math.round(W * lim); H = Math.round(H * lim); }
        const px = engine.renderSize(s, W, H);
        const canvas = Catalog.pixelsToCanvas(px, W, H);
        if (o.watermark && o.wmText) {
          const x = canvas.getContext('2d');
          const size = Math.max(10, Math.round(Math.min(W, H) * 0.035));
          x.font = `600 ${size}px system-ui, sans-serif`;
          x.textAlign = 'right';
          x.textBaseline = 'bottom';
          x.fillStyle = 'rgba(0,0,0,0.35)';
          x.fillText(o.wmText, W - size * 0.8 + 1, H - size * 0.6 + 1);
          x.fillStyle = 'rgba(255,255,255,0.75)';
          x.fillText(o.wmText, W - size * 0.8, H - size * 0.6);
        }
        const blob = await new Promise((res) => canvas.toBlob(res, o.format, o.quality / 100));
        const name = fileName(p, i, o);
        if (dir) {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        } else {
          const a = h('a', { href: URL.createObjectURL(blob), download: name });
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          await new Promise((r) => setTimeout(r, 250));
        }
        done++;
      } catch (e) {
        console.error('Export failed', p.name, e);
        LR.UI.toast('Export failed: ' + p.name);
      }
      LR.bus.emit('progress', { label: 'Exporting', done: i + 1, total: photos.length });
    }
    LR.UI.toast('Exported ' + done + ' of ' + photos.length + ' photo' + (photos.length > 1 ? 's' : ''), 2500);
  }

  LR.Export = { open };
})();
