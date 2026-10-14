/* WebLightroom — Develop module. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h, slider, panel, icon, select, clamp } = LR.UI;
  const { Settings, Catalog, Tools } = LR;
  const S = LR.state;

  const G = {
    temp: 'linear-gradient(90deg,#3f74d6,#b7b7b7 50%,#e2c34a)',
    tint: 'linear-gradient(90deg,#3fae4c,#b7b7b7 50%,#c64ec2)',
    sat: 'linear-gradient(90deg,#8a8a8a,#c03a3a 25%,#d6c43a 50%,#3ab04a 75%,#3a6ad6)',
    lum: 'linear-gradient(90deg,#111,#eee)',
  };
  const HUE_DEG = [0, 30, 60, 120, 180, 240, 270, 300];
  const hueCss = (d, s, l) => `hsl(${(d + 360) % 360},${s}%,${l}%)`;

  const Develop = {
    controls: [],
    viewer: null,
    histogram: null,
    tool: null,
    navTimer: null,
    previewSettings: null,

    init(viewer, histogram) {
      this.viewer = viewer;
      this.histogram = histogram;
      this.left = h('div.panel-scroll');
      this.right = h('div.panel-scroll');
      this.leftFoot = h('div.panel-foot', null,
        h('button.btn', { text: 'Copy…', onclick: () => Catalog.copySettings(true) }),
        h('button.btn', { text: 'Paste', onclick: () => Catalog.pasteSettings() }));
      this.rightFoot = h('div.panel-foot', null,
        h('button.btn', { text: 'Previous', title: 'Apply settings from the previously selected photo', onclick: () => this.applyPrevious() }),
        h('button.btn', { text: 'Reset', title: 'Reset all settings (Ctrl+Shift+R)', onclick: () => this.resetAll() }));
      this.leftCol = h('div.panel-col', null, this.left, this.leftFoot);
      this.rightCol = h('div.panel-col', null, this.histoBox(), this.right, this.rightFoot);
      this.buildLeft();
      this.buildRight();
      this.buildToolbar();
      this.cropTool = new Tools.CropTool(viewer, { changed: () => this.syncCropUI(), commit: (l) => this.commit(l) });
      this.maskTool = new Tools.MaskTool(viewer, { changed: () => {}, commit: (l) => this.commit(l), select: () => this.renderMaskDrawer() });
      this.wbTool = new Tools.WBPickerTool(viewer, { commit: (l) => this.commit(l), done: () => this.setTool(null) });

      LR.bus.on('settings', () => { if (S.module === 'develop') this.refresh(); });
      LR.bus.on('history', (p) => { if (p.id === S.activeId) this.renderHistory(); });
      LR.bus.on('presets', () => this.renderPresets());
      LR.bus.on('viewer-render', () => this.scheduleNavigator());
      LR.bus.on('zoom', () => this.updateZoomUI());
      LR.bus.on('meta', () => this.updateToolbarMeta());
    },

    histoBox() {
      const tools = h('div.toolstrip', null,
        this.btnCrop = h('button.tool-btn', { title: 'Crop Overlay (R)', onclick: () => this.setTool(this.tool === 'crop' ? null : 'crop') }, icon('crop')),
        this.btnMask = h('button.tool-btn', { title: 'Masking (Shift+W)', onclick: () => this.setTool(this.tool === 'mask' ? null : 'mask') }, icon('mask')),
        this.btnWB = h('button.tool-btn', { title: 'White Balance Selector (W)', onclick: () => this.setTool(this.tool === 'wb' ? null : 'wb') }, icon('picker')));
      this.drawer = h('div.tool-drawer');
      this.histoSlot = h('div', null, this.histogram.el);
      return h('div.right-top', null, panel('Histogram', this.histoSlot, { key: 'dev-histo' }), tools, this.drawer);
    },

    /* ---------- control helpers ---------- */
    sl(path, label, min, max, o) {
      o = o || {};
      const def = Settings.getPath(Settings.defaults(), path);
      const c = slider(Object.assign({
        label, min, max, def, path,
        onInput: (v) => this.live(path, v),
        onCommit: (v) => this.commit(Settings.label(path) + ' ' + Settings.fmtValue(path, v)),
      }, o));
      this.controls.push(c);
      return c;
    },
    s() { return this.photo() ? this.photo().settings : Settings.defaults(); },
    photo() { return Catalog.active(); },
    live(path, v) {
      const p = this.photo();
      if (!p) return;
      Settings.setPath(p.settings, path, v);
      if (path === 'temp' || path === 'tint') { p.settings.wbMode = 'Custom'; this.wbSelect.value = 'Custom'; }
      this.viewer.requestRender();
    },
    commit(label) {
      const p = this.photo();
      if (!p) return;
      Catalog.commitSettings(p, label);
      this.refreshMinor();
    },

    /* ---------- left panel ---------- */
    buildLeft() {
      // Navigator
      this.navCanvas = h('canvas.nav-canvas');
      this.navRect = h('div.nav-rect');
      this.navLabel = h('div.nav-label');
      const zoomBtn = (z, l) => h('button.nav-z', { text: l, dataset: { z: String(z) }, onclick: () => this.viewer.setZoom(z) });
      const navHead = h('span.panel-head-extra.nav-zooms', null, zoomBtn('fit', 'FIT'), zoomBtn('fill', 'FILL'), zoomBtn(1, '1:1'), zoomBtn(2, '2:1'));
      this.navWrap = h('div.nav-wrap', null, this.navCanvas, this.navRect, this.navLabel);
      this.navWrap.addEventListener('pointerdown', (e) => this.navPan(e));
      this.navWrap.addEventListener('pointermove', (e) => { if (e.buttons & 1) this.navPan(e); });
      this.left.append(panel('Navigator', this.navWrap, { key: 'dev-nav', headExtra: navHead }));

      // Presets
      this.presetBox = h('div.preset-list');
      this.presetSearch = h('input.text.preset-search', { type: 'search' });
      this.presetSearch.addEventListener('input', LR.UI.debounce(() => this.renderPresets(), 120));
      this.presetSearch.addEventListener('keydown', (e) => e.stopPropagation());
      const presetAdd = h('span.panel-head-extra.head-btn', { title: 'Create Preset', onclick: () => Catalog.newPreset() }, icon('plus'));
      this.left.append(panel('Presets', h('div', null, this.presetSearch, this.presetBox), { key: 'dev-presets', headExtra: presetAdd }));
      this.renderPresets();

      // Snapshots
      this.snapBox = h('div.list');
      const snapAdd = h('span.panel-head-extra.head-btn', { title: 'Create Snapshot', onclick: () => this.addSnapshot() }, icon('plus'));
      this.left.append(panel('Snapshots', this.snapBox, { key: 'dev-snap', headExtra: snapAdd }));

      // History
      this.histList = h('div.list.history');
      const histClear = h('span.panel-head-extra.head-btn', { title: 'Clear History', onclick: () => this.clearHistory() }, icon('close'));
      this.left.append(panel('History', this.histList, { key: 'dev-history', headExtra: histClear }));
    },

    renderPresets() {
      const box = this.presetBox;
      if (!box) return;
      box.innerHTML = '';
      const all = Settings.BUILTIN_PRESETS.concat(S.userPresets.map((p) => Object.assign({ user: true }, p)));
      const q = (this.presetSearch.value || '').trim().toLowerCase();
      this.presetSearch.placeholder = 'Search ' + all.length + ' presets…';
      const groups = {};
      all.forEach((p) => {
        if (q && !(p.name + ' ' + p.group).toLowerCase().includes(q)) return;
        (groups[p.group] = groups[p.group] || []).push(p);
      });
      const order = Object.keys(groups).sort((a, b) => (groups[a][0].user ? -1 : 0) - (groups[b][0].user ? -1 : 0));
      if (!order.length) box.appendChild(h('div.empty-note', { text: 'No presets match' }));
      const openState = JSON.parse(localStorage.getItem('lr-preset-groups') || '{}');
      order.forEach((g) => {
        const items = h('div.preset-items');
        const open = q || openState[g] === true || (groups[g][0].user && openState[g] !== false);
        const head = h('div.preset-group' + (open ? '' : '.closed'), null, h('span.tri'), h('span.pg-name', { text: g }), h('span.cnt', { text: String(groups[g].length) }));
        head.addEventListener('click', () => {
          head.classList.toggle('closed');
          if (q) return;
          openState[g] = !head.classList.contains('closed');
          localStorage.setItem('lr-preset-groups', JSON.stringify(openState));
        });
        groups[g].forEach((p) => {
          const it = h('div.preset-item', { text: p.name, title: 'Click to apply' });
          it.addEventListener('click', () => { if (this.photo()) { Catalog.applyPreset(p, [this.photo()]); this.refresh(); } });
          it.addEventListener('mouseenter', () => this.previewPreset(p));
          it.addEventListener('mouseleave', () => this.previewPreset(null));
          if (p.user) it.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            LR.UI.menu(e.clientX, e.clientY, [
              { label: 'Apply to Selected Photos', action: () => Catalog.applyPreset(p) },
              { label: 'Update with Current Settings', action: async () => {
                p.settings = Catalog.pick(this.s(), Object.keys(groupsOf(p.settings)));
                const up = S.userPresets.find((x) => x.id === p.id);
                if (up) up.settings = p.settings;
                await LR.DB.setKV('presets', S.userPresets);
                LR.UI.toast('Preset updated');
              } },
              '-',
              { label: 'Delete Preset', action: () => Catalog.deletePreset(p.id) },
            ]);
          });
          items.appendChild(it);
        });
        box.append(head, items);
      });
    },
    previewPreset(p) {
      const ph = this.photo();
      if (!p || !ph) { this.previewSettings = null; this.drawNavigator(); return; }
      const s = Settings.clone(ph.settings);
      Settings.deepMerge(s, Settings.clone(p.settings));
      this.previewSettings = s;
      this.drawNavigator();
    },
    scheduleNavigator() {
      clearTimeout(this.navTimer);
      this.navTimer = setTimeout(() => this.drawNavigator(), 160);
      this.updateNavRect();
    },
    drawNavigator() {
      const eng = this.viewer.engine;
      const p = this.photo();
      if (!p || !eng.src || this.viewer.loadedId !== p.id || S.module !== 'develop') return;
      const s = this.previewSettings || p.settings;
      const r = eng.renderFit(s, 260);
      const cv = this.navCanvas;
      cv.width = r.width;
      cv.height = r.height;
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.pixels.buffer), r.width, r.height), 0, 0);
      this.navLabel.textContent = this.previewSettings ? 'Preset Preview' : '';
      this.updateNavRect();
    },
    updateNavRect() {
      const vr = this.viewer.visibleRect();
      const cv = this.navCanvas;
      if (!vr || this.viewer.zoom === 'fit' || (vr.w >= 0.999 && vr.h >= 0.999)) { this.navRect.style.display = 'none'; return; }
      const W = cv.clientWidth, H = cv.clientHeight, ox = cv.offsetLeft, oy = cv.offsetTop;
      Object.assign(this.navRect.style, { display: '', left: ox + vr.x * W + 'px', top: oy + vr.y * H + 'px', width: vr.w * W + 'px', height: vr.h * H + 'px' });
    },
    navPan(e) {
      const cv = this.navCanvas, r = cv.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
      if (this.viewer.zoom === 'fit') this.viewer.setZoom(1);
      this.viewer.pan = { x, y };
      this.viewer.requestRender();
    },

    renderSnapshots() {
      const p = this.photo();
      this.snapBox.innerHTML = '';
      if (!p) return;
      if (!p.snapshots.length) this.snapBox.appendChild(h('div.empty-note', { text: 'No snapshots' }));
      p.snapshots.forEach((sn, i) => {
        const it = h('div.list-item', { text: sn.name });
        it.addEventListener('click', () => { p.settings = Settings.clone(sn.settings); this.commit('Snapshot: ' + sn.name); this.refresh(); });
        it.addEventListener('mouseenter', () => this.previewPreset({ settings: sn.settings }));
        it.addEventListener('mouseleave', () => this.previewPreset(null));
        it.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          LR.UI.menu(e.clientX, e.clientY, [
            { label: 'Update with Current Settings', action: () => { sn.settings = Settings.clone(p.settings); Catalog.save(p); LR.UI.toast('Snapshot updated'); } },
            { label: 'Rename', action: async () => { const n = await LR.UI.prompt('Rename Snapshot', 'Name', sn.name); if (n) { sn.name = n; Catalog.save(p); this.renderSnapshots(); } } },
            '-',
            { label: 'Delete', action: () => { p.snapshots.splice(i, 1); Catalog.save(p); this.renderSnapshots(); } },
          ]);
        });
        this.snapBox.appendChild(it);
      });
    },
    async addSnapshot() {
      const p = this.photo();
      if (!p) return;
      const d = new Date();
      const name = await LR.UI.prompt('New Snapshot', 'Snapshot Name', d.toLocaleDateString() + ' ' + d.toLocaleTimeString());
      if (!name) return;
      p.snapshots.push({ name, settings: Settings.clone(p.settings), time: Date.now() });
      Catalog.save(p);
      this.renderSnapshots();
    },
    renderHistory() {
      const p = this.photo();
      this.histList.innerHTML = '';
      if (!p) return;
      for (let i = p.history.length - 1; i >= 0; i--) {
        const st = p.history[i];
        const it = h('div.list-item' + (i === p.hIndex ? '.current' : i > p.hIndex ? '.future' : ''), { text: st.label });
        it.addEventListener('click', () => this.gotoHistory(i));
        it.addEventListener('mouseenter', () => this.previewPreset({ settings: st.settings }));
        it.addEventListener('mouseleave', () => this.previewPreset(null));
        this.histList.appendChild(it);
      }
    },
    gotoHistory(i) {
      const p = this.photo();
      if (!p || i < 0 || i >= p.history.length) return;
      p.hIndex = i;
      p.settings = Settings.clone(p.history[i].settings);
      Catalog.markEdited(p);
      Catalog.save(p);
      Catalog.refreshThumb(p.id);
      this.refresh();
    },
    undo() {
      const p = this.photo();
      if (!p || p.hIndex <= 0) { LR.UI.hud('Nothing to undo'); return; }
      const label = p.history[p.hIndex].label;
      this.gotoHistory(p.hIndex - 1);
      LR.UI.hud('Undo ' + label);
    },
    redo() {
      const p = this.photo();
      if (!p || p.hIndex >= p.history.length - 1) { LR.UI.hud('Nothing to redo'); return; }
      this.gotoHistory(p.hIndex + 1);
      LR.UI.hud('Redo ' + p.history[p.hIndex].label);
    },
    async clearHistory() {
      const p = this.photo();
      if (!p) return;
      if (!(await LR.UI.confirm('Clear History', 'Clear the history list for this photo? Current settings are kept.', 'Clear'))) return;
      p.history = [{ label: 'Clear History', settings: Settings.clone(p.settings), time: Date.now() }];
      p.hIndex = 0;
      Catalog.save(p);
      this.renderHistory();
    },

    /* ---------- right panel ---------- */
    buildRight() {
      const R = this.right;
      // BASIC
      this.treatColor = h('button.seg', { text: 'Color', onclick: () => this.setTreatment('color') });
      this.treatBW = h('button.seg', { text: 'Black & White', onclick: () => this.setTreatment('bw') });
      this.wbSelect = select(['As Shot', 'Auto', 'Custom'], 'As Shot', (v) => this.setWBMode(v), 'wb-select');
      const basic = h('div', null,
        h('div.ctl-row', null, h('label.ctl-label', { text: 'Treatment:' }), h('div.segs', null, this.treatColor, this.treatBW)),
        h('div.ctl-row', null, h('button.icon-btn', { title: 'White Balance Selector (W)', onclick: () => this.setTool('wb') }, icon('picker')), h('label.ctl-label', { text: 'WB:' }), this.wbSelect),
        this.sl('temp', 'Temp', -100, 100, { gradient: G.temp }),
        this.sl('tint', 'Tint', -100, 100, { gradient: G.tint }),
        h('div.sub-head', null, h('span', { text: 'Tone' }), h('button.link-btn', { text: 'Auto', title: 'Auto Tone (Ctrl+U)', onclick: () => this.autoTone() })),
        this.sl('exposure', 'Exposure', -5, 5, { step: 0.01, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(2) }),
        this.sl('contrast', 'Contrast', -100, 100),
        h('div.sl-gap'),
        this.sl('highlights', 'Highlights', -100, 100),
        this.sl('shadows', 'Shadows', -100, 100),
        this.sl('whites', 'Whites', -100, 100),
        this.sl('blacks', 'Blacks', -100, 100),
        h('div.sub-head', null, h('span', { text: 'Presence' })),
        this.sl('texture', 'Texture', -100, 100),
        this.sl('clarity', 'Clarity', -100, 100),
        this.sl('dehaze', 'Dehaze', -100, 100),
        h('div.sl-gap'),
        this.sl('vibrance', 'Vibrance', -100, 100, { gradient: G.sat }),
        this.sl('saturation', 'Saturation', -100, 100, { gradient: G.sat }));
      R.append(panel('Basic', basic, { key: 'dev-basic' }));

      // TONE CURVE
      this.curve = new LR.Widgets.CurveEditor({
        settings: () => (this.photo() ? this.photo().settings : null),
        input: () => this.viewer.requestRender(),
        commit: (l) => this.commit(l),
        histogram: () => this.histogram.bins,
      });
      this.curveModeBtns = ['param', 'point'].map((m) => h('button.seg', { text: m === 'param' ? 'Parametric' : 'Point', onclick: () => this.setCurveMode(m) }));
      this.curveChanBtns = [['master', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B']].map(([c, l]) => h('button.seg.chan-' + c, { text: l, onclick: () => this.setCurveChannel(c) }));
      this.curveParamSliders = h('div', null,
        this.sl('curveParam.highlights', 'Highlights', -100, 100),
        this.sl('curveParam.lights', 'Lights', -100, 100),
        this.sl('curveParam.darks', 'Darks', -100, 100),
        this.sl('curveParam.shadows', 'Shadows', -100, 100));
      this.curveChanRow = h('div.ctl-row', null, h('label.ctl-label', { text: 'Channel:' }), h('div.segs', null, this.curveChanBtns),
        h('button.link-btn', { text: 'Reset', onclick: () => this.resetCurve() }));
      const curveBox = h('div', null, h('div.ctl-row', null, h('div.segs.wide', null, this.curveModeBtns)), this.curve.el, this.curveChanRow, this.curveParamSliders);
      R.append(panel('Tone Curve', curveBox, { key: 'dev-curve' }));
      this.setCurveMode('param');

      // HSL / COLOR / B&W
      this.hslTabs = h('div.segs.wide');
      this.hslBody = h('div');
      this.hslMode = 'hue';
      ['hue', 'sat', 'lum', 'all'].forEach((m) => {
        this.hslTabs.appendChild(h('button.seg', { text: { hue: 'Hue', sat: 'Saturation', lum: 'Luminance', all: 'All' }[m], dataset: { m }, onclick: () => { this.hslMode = m; this.buildHSL(); } }));
      });
      this.hslPanel = panel('HSL / Color', h('div', null, this.hslTabs, this.hslBody), { key: 'dev-hsl' });
      R.append(this.hslPanel);

      // COLOR GRADING
      R.append(panel('Color Grading', this.buildGrading(), { key: 'dev-grading', collapsed: true }));

      // DETAIL
      const detail = h('div', null,
        h('div.sub-head', null, h('span', { text: 'Sharpening' })),
        this.sl('sharpen.amount', 'Amount', 0, 150),
        this.sl('sharpen.radius', 'Radius', 0.5, 3, { step: 0.1, fmt: (v) => v.toFixed(1) }),
        this.sl('sharpen.detail', 'Detail', 0, 100),
        this.sl('sharpen.masking', 'Masking', 0, 100),
        h('div.sub-head', null, h('span', { text: 'Noise Reduction' })),
        this.sl('nr.luminance', 'Luminance', 0, 100),
        this.sl('nr.color', 'Color', 0, 100));
      R.append(panel('Detail', detail, { key: 'dev-detail', collapsed: true }));

      // LENS
      const lens = h('div', null,
        h('div.sub-head', null, h('span', { text: 'Manual' })),
        this.sl('lens.distortion', 'Distortion', -100, 100),
        this.sl('lens.vignetting', 'Vignetting', -100, 100));
      R.append(panel('Lens Corrections', lens, { key: 'dev-lens', collapsed: true }));

      // EFFECTS
      const fx = h('div', null,
        h('div.sub-head', null, h('span', { text: 'Post-Crop Vignetting' })),
        this.sl('vignette.amount', 'Amount', -100, 100, { gradient: 'linear-gradient(90deg,#111,#888 50%,#eee)' }),
        this.sl('vignette.midpoint', 'Midpoint', 0, 100),
        this.sl('vignette.roundness', 'Roundness', -100, 100),
        this.sl('vignette.feather', 'Feather', 0, 100),
        this.sl('vignette.highlights', 'Highlights', 0, 100),
        h('div.sub-head', null, h('span', { text: 'Grain' })),
        this.sl('grain.amount', 'Amount', 0, 100),
        this.sl('grain.size', 'Size', 0, 100),
        this.sl('grain.roughness', 'Roughness', 0, 100));
      R.append(panel('Effects', fx, { key: 'dev-effects', collapsed: true }));
    },

    buildHSL() {
      const s = this.s();
      const bw = s.treatment === 'bw';
      this.hslPanel.querySelector('.panel-title').textContent = bw ? 'B&W' : 'HSL / Color';
      this.hslTabs.style.display = bw ? 'none' : '';
      [...this.hslTabs.children].forEach((b) => b.classList.toggle('on', b.dataset.m === this.hslMode));
      // drop old hsl controls from registry
      this.controls = this.controls.filter((c) => !/^(hsl|bw)\./.test(c.path));
      this.hslBody.innerHTML = '';
      const names = Settings.HUE_NAMES;
      if (bw) {
        this.hslBody.append(h('div.sub-head', null, h('span', { text: 'Black & White Mix' }), h('button.link-btn', { text: 'Auto', onclick: () => this.autoBW() })));
        names.forEach((n, i) => this.hslBody.appendChild(this.sl('bw.' + i, n, -100, 100, { gradient: `linear-gradient(90deg,#222,${hueCss(HUE_DEG[i], 70, 50)} 50%,#eee)` })));
        return;
      }
      const make = (kind) => {
        const wrap = h('div');
        if (this.hslMode === 'all') wrap.appendChild(h('div.sub-head', null, h('span', { text: { hue: 'Hue', sat: 'Saturation', lum: 'Luminance' }[kind] })));
        names.forEach((n, i) => {
          const d = HUE_DEG[i];
          let grad;
          if (kind === 'hue') grad = `linear-gradient(90deg,${hueCss(d - 30, 75, 50)},${hueCss(d, 75, 50)},${hueCss(d + 30, 75, 50)})`;
          else if (kind === 'sat') grad = `linear-gradient(90deg,#7a7a7a,${hueCss(d, 85, 50)})`;
          else grad = `linear-gradient(90deg,${hueCss(d, 60, 10)},${hueCss(d, 70, 50)},${hueCss(d, 60, 92)})`;
          wrap.appendChild(this.sl('hsl.' + kind + '.' + i, n, -100, 100, { gradient: grad }));
        });
        return wrap;
      };
      if (this.hslMode === 'all') this.hslBody.append(make('hue'), make('sat'), make('lum'));
      else this.hslBody.append(make(this.hslMode));
      this.refreshControls();
    },

    buildGrading() {
      const box = h('div.grading');
      this.cgMode = '3way';
      const tabs = h('div.segs.wide');
      const modes = [['3way', '3-Way'], ['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights'], ['global', 'Global']];
      modes.forEach(([m, l]) => tabs.appendChild(h('button.seg', { text: l, dataset: { m }, onclick: () => { this.cgMode = m; this.renderGrading(); } })));
      this.cgTabs = tabs;
      this.cgBody = h('div.cg-body');
      this.cgSliders = h('div', null,
        this.sl('grading.blending', 'Blending', 0, 100),
        this.sl('grading.balance', 'Balance', -100, 100));
      box.append(tabs, this.cgBody, this.cgSliders);
      this.wheels = [];
      return box;
    },
    renderGrading() {
      [...this.cgTabs.children].forEach((b) => b.classList.toggle('on', b.dataset.m === this.cgMode));
      this.controls = this.controls.filter((c) => !/^grading\.(shadows|midtones|highlights|global)\./.test(c.path));
      this.cgBody.innerHTML = '';
      this.wheels = [];
      const mkWheel = (key, label, size) => {
        const w = new LR.Widgets.ColorWheel({
          size, label,
          get: () => this.s().grading[key],
          set: (hh, ss) => {
            const p = this.photo();
            if (!p) return;
            p.settings.grading[key].h = hh;
            p.settings.grading[key].s = ss;
            this.viewer.requestRender();
            this.syncGradingSliders(key);
          },
          commit: () => this.commit('Color Grade ' + label),
        });
        this.wheels.push(w);
        const lum = this.sl('grading.' + key + '.l', size > 120 ? 'Luminance' : 'Lum', -100, 100, { gradient: G.lum, cls: size > 120 ? null : 'compact' });
        const box = h('div.cg-wheel', null, w.el, lum);
        if (size > 120) {
          box.append(
            this.sl('grading.' + key + '.h', 'Hue', 0, 359, { gradient: 'linear-gradient(90deg,#f33,#ff3,#3f3,#3ff,#33f,#f3f,#f33)', fmt: (v) => String(Math.round(v)), onInput: (v) => { this.live('grading.' + key + '.h', v); w.update(); } }),
            this.sl('grading.' + key + '.s', 'Saturation', 0, 100, { onInput: (v) => { this.live('grading.' + key + '.s', v); w.update(); } }));
        }
        w.update();
        return box;
      };
      if (this.cgMode === '3way') {
        this.cgBody.append(
          h('div.cg-row.center', null, mkWheel('midtones', 'Midtones', 112)),
          h('div.cg-row', null, mkWheel('shadows', 'Shadows', 112), mkWheel('highlights', 'Highlights', 112)));
      } else {
        const name = this.cgMode[0].toUpperCase() + this.cgMode.slice(1);
        this.cgBody.append(h('div.cg-row.center', null, mkWheel(this.cgMode, name, 190)));
      }
      this.refreshControls();
    },
    syncGradingSliders(key) {
      const g = this.s().grading[key];
      this.controls.forEach((c) => {
        if (c.path === 'grading.' + key + '.h') c.set(g.h);
        if (c.path === 'grading.' + key + '.s') c.set(g.s);
      });
    },

    setCurveMode(m) {
      this.curve.setMode(m);
      this.curveModeBtns.forEach((b, i) => b.classList.toggle('on', ['param', 'point'][i] === m));
      this.curveParamSliders.style.display = m === 'param' ? '' : 'none';
      this.curveChanRow.style.display = m === 'point' ? '' : 'none';
      this.setCurveChannel(m === 'param' ? 'master' : this.curve.channel);
    },
    setCurveChannel(c) {
      this.curve.setChannel(c);
      this.curveChanBtns.forEach((b, i) => b.classList.toggle('on', ['master', 'r', 'g', 'b'][i] === c));
    },
    resetCurve() {
      const p = this.photo();
      if (!p) return;
      p.settings.curve[this.curve.channel] = [[0, 0], [1, 1]];
      this.viewer.requestRender();
      this.commit('Reset Tone Curve');
      this.curve.draw();
    },

    setTreatment(t) {
      const p = this.photo();
      if (!p) return;
      if (p.settings.treatment === t) return;
      p.settings.treatment = t;
      this.viewer.requestRender();
      this.commit(t === 'bw' ? 'Black & White' : 'Color');
      this.refresh();
    },
    async setWBMode(v) {
      const p = this.photo();
      if (!p) return;
      if (v === 'As Shot') { p.settings.temp = 0; p.settings.tint = 0; }
      else if (v === 'Auto') Object.assign(p.settings, await Tools.autoSettings(p, ['wb']));
      p.settings.wbMode = v;
      this.viewer.requestRender();
      this.commit('White Balance: ' + v);
      this.refreshControls();
    },
    async autoTone() {
      const p = this.photo();
      if (!p) return;
      Object.assign(p.settings, await Tools.autoSettings(p, ['tone']));
      this.viewer.requestRender();
      this.commit('Auto Settings');
      this.refreshControls();
      LR.UI.hud('Auto Tone');
    },
    autoBW() {
      const p = this.photo();
      if (!p) return;
      p.settings.bw = [-5, -15, -10, -20, -20, -25, -10, -5];
      this.viewer.requestRender();
      this.commit('Auto B&W Mix');
      this.refreshControls();
    },
    resetAll() {
      const p = this.photo();
      if (!p) return;
      p.settings = Settings.defaults();
      this.commit('Reset Settings');
      this.refresh();
      LR.UI.hud('Reset Settings');
    },
    applyPrevious() {
      const prev = this.prevId && S.byId.get(this.prevId);
      const p = this.photo();
      if (!prev || !p || prev === p) { LR.UI.toast('No previous photo'); return; }
      const keep = { crop: p.settings.crop, angle: p.settings.angle, orientation: p.settings.orientation, flipH: p.settings.flipH, flipV: p.settings.flipV, masks: p.settings.masks };
      p.settings = Object.assign(Settings.clone(prev.settings), Settings.clone(keep));
      this.commit('Previous Settings');
      this.refresh();
    },

    /* ---------- tools ---------- */
    setTool(t) {
      const v = this.viewer;
      if (this.tool === 'crop' && t !== 'crop') this.cropTool.deactivate();
      this.tool = t;
      this.btnCrop.classList.toggle('on', t === 'crop');
      this.btnMask.classList.toggle('on', t === 'mask');
      this.btnWB.classList.toggle('on', t === 'wb');
      v.showMask = null;
      if (t === 'crop') { this.cropTool.activate(); v.setTool(this.cropTool); v.clickZoom = false; }
      else if (t === 'mask') {
        v.setTool(this.maskTool);
        v.clickZoom = false;
        const ms = this.s().masks;
        if (!this.maskTool.selected && ms.length) this.maskTool.selected = ms[ms.length - 1].id;
        if (this.maskOverlay) v.showMask = this.maskTool.selected;
      } else if (t === 'wb') { v.setTool(this.wbTool); v.clickZoom = false; }
      else { v.setTool(null); v.clickZoom = true; }
      this.renderDrawer();
      v.requestRender();
    },
    renderDrawer() {
      const d = this.drawer;
      d.innerHTML = '';
      this.controls = this.controls.filter((c) => !/^(angle|mask\.)/.test(c.path));
      if (this.tool === 'crop') d.appendChild(this.buildCropDrawer());
      else if (this.tool === 'mask') { this.maskDrawer = h('div'); d.appendChild(this.maskDrawer); this.renderMaskDrawer(); }
      else if (this.tool === 'wb') d.appendChild(h('div.drawer', null, h('div.drawer-title', { text: 'White Balance Selector' }), h('p.hint', { text: 'Click a neutral (gray or white) area of the photo. Esc to cancel.' })));
    },
    buildCropDrawer() {
      const s = this.s();
      const ct = this.cropTool;
      this.aspectSel = select(Tools.ASPECTS, s.aspect || 'original', (v) => ct.setAspect(v));
      this.lockBtn = h('button.icon-btn', { title: 'Lock aspect ratio (A)', onclick: () => { s.aspectLocked = !s.aspectLocked; this.syncCropUI(); } });
      this.angleSl = slider({
        label: 'Angle', min: -45, max: 45, step: 0.01, def: 0, path: 'angle', value: s.angle || 0, fmt: (v) => v.toFixed(2),
        onInput: (v) => { ct.beginAngleEdit(); ct.setAngle(v); },
        onCommit: (v) => { ct.setAngle(v, true); },
      });
      return h('div.drawer', null,
        h('div.drawer-title', null, h('span', { text: 'Crop & Straighten' }), h('button.link-btn', { text: 'Reset', onclick: () => { ct.reset(); this.syncCropUI(); } })),
        h('div.ctl-row', null, h('label.ctl-label', { text: 'Aspect:' }), this.aspectSel, this.lockBtn,
          h('button.icon-btn', { title: 'Swap orientation (X)', onclick: () => ct.swapAspect() }, h('span.txt-ico', { text: '⇄' }))),
        this.angleSl,
        h('div.ctl-row.icons', null,
          h('button.icon-btn', { title: 'Rotate Left (Ctrl+[)', onclick: () => ct.rotate90(-1) }, icon('rotL')),
          h('button.icon-btn', { title: 'Rotate Right (Ctrl+])', onclick: () => ct.rotate90(1) }, icon('rotR')),
          h('button.icon-btn', { title: 'Flip Horizontal', onclick: () => ct.flip('h') }, icon('flipH')),
          h('button.icon-btn', { title: 'Flip Vertical', onclick: () => ct.flip('v') }, icon('flipV'))),
        h('div.drawer-buttons', null, h('button.btn', { text: 'Cancel', onclick: () => { ct.cancel(); this.setTool(null); } }), h('button.btn.primary', { text: 'Done', onclick: () => this.setTool(null) })));
    },
    syncCropUI() {
      const s = this.s();
      if (this.angleSl) this.angleSl.set(s.angle || 0);
      if (this.lockBtn) { this.lockBtn.innerHTML = ''; this.lockBtn.appendChild(icon(s.aspectLocked ? 'lock' : 'unlock')); this.lockBtn.classList.toggle('on', !!s.aspectLocked); }
      if (this.aspectSel) this.aspectSel.value = s.aspect || 'original';
    },
    renderMaskDrawer() {
      if (this.tool !== 'mask' || !this.maskDrawer) return;
      const mt = this.maskTool, s = this.s();
      const d = this.maskDrawer;
      d.innerHTML = '';
      this.controls = this.controls.filter((c) => !/^mask\./.test(c.path));
      if (this.maskOverlay) this.viewer.showMask = mt.selected;
      const list = h('div.mask-list');
      s.masks.forEach((m) => {
        const eye = h('button.icon-btn.small' + (m.enabled === false ? '.off' : ''), { title: 'Show/Hide mask effect', onclick: (e) => { e.stopPropagation(); m.enabled = m.enabled === false; this.commit((m.enabled ? 'Enable ' : 'Disable ') + m.name); this.renderMaskDrawer(); this.viewer.requestRender(); } }, icon('eye'));
        const del = h('button.icon-btn.small', { title: 'Delete mask', onclick: (e) => { e.stopPropagation(); mt.remove(m.id); } }, icon('trash'));
        const it = h('div.mask-item' + (m.id === mt.selected ? '.on' : ''), null, icon(m.type === 'linear' ? 'linear' : 'radial'), h('span.mask-name', { text: m.name }), eye, del);
        it.addEventListener('click', () => mt.select(m.id));
        it.addEventListener('dblclick', async () => { const n = await LR.UI.prompt('Rename Mask', 'Name', m.name); if (n) { m.name = n; this.commit('Rename Mask'); this.renderMaskDrawer(); } });
        list.appendChild(it);
      });
      if (!s.masks.length) list.appendChild(h('div.empty-note', { text: 'No masks yet. Create one below, then drag on the photo.' }));
      const overlayCb = h('input', { type: 'checkbox', checked: !!this.maskOverlay, onchange: () => this.toggleMaskOverlay() });
      d.append(h('div.drawer', null,
        h('div.drawer-title', null, h('span', { text: 'Masks' })),
        h('div.ctl-row', null,
          h('button.btn.small', { onclick: () => mt.startCreate('linear'), title: 'Linear Gradient (M)' }, icon('linear'), ' Linear'),
          h('button.btn.small', { onclick: () => mt.startCreate('radial'), title: 'Radial Gradient (Shift+M)' }, icon('radial'), ' Radial')),
        list,
        h('label.check', null, overlayCb, ' Show Overlay (O)')));
      const m = mt.sel();
      if (m) {
        const msl = (key, label, min, max, o) => {
          const path = key.startsWith('adj.') ? key : key;
          const get = () => Settings.getPath(m, path);
          const c = slider(Object.assign({
            label, min, max, def: key === 'amount' ? 100 : key === 'feather' ? (m.type === 'linear' ? 100 : 50) : 0, value: get(), path: 'mask.' + key,
            onInput: (v) => { Settings.setPath(m, path, v); this.viewer.requestRender(); },
            onCommit: (v) => this.commit(m.name + ' ' + label + ' ' + (key === 'adj.exposure' ? v.toFixed(2) : Math.round(v))),
          }, o || {}));
          this.controls.push(c);
          return c;
        };
        const inv = h('input', { type: 'checkbox', checked: !!m.invert, onchange: () => { m.invert = inv.checked; this.viewer.requestRender(); this.commit('Invert ' + m.name); } });
        d.append(h('div.drawer', null,
          h('div.drawer-title', null, h('span', { text: m.name }), h('button.link-btn', { text: 'Reset sliders', onclick: () => { Object.keys(m.adj).forEach((k) => (m.adj[k] = 0)); this.viewer.requestRender(); this.commit('Reset ' + m.name); this.renderMaskDrawer(); } })),
          msl('amount', 'Amount', 0, 200),
          msl('adj.temp', 'Temp', -100, 100, { gradient: G.temp }),
          msl('adj.tint', 'Tint', -100, 100, { gradient: G.tint }),
          msl('adj.exposure', 'Exposure', -4, 4, { step: 0.01, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(2) }),
          msl('adj.contrast', 'Contrast', -100, 100),
          msl('adj.highlights', 'Highlights', -100, 100),
          msl('adj.shadows', 'Shadows', -100, 100),
          msl('adj.clarity', 'Clarity', -100, 100),
          msl('adj.saturation', 'Saturation', -100, 100, { gradient: G.sat }),
          msl('feather', 'Feather', 0, 100),
          h('label.check', null, inv, ' Invert')));
      }
      d.append(h('div.drawer-buttons', null, h('button.btn.primary', { text: 'Close', onclick: () => this.setTool(null) })));
    },
    toggleMaskOverlay() {
      this.maskOverlay = !this.maskOverlay;
      this.viewer.showMask = this.maskOverlay && this.tool === 'mask' ? this.maskTool.selected : null;
      this.viewer.requestRender();
      if (this.tool === 'mask') this.renderMaskDrawer();
    },

    /* ---------- toolbar ---------- */
    buildToolbar() {
      this.tbBefore = h('button.tb-btn', { title: 'Toggle Before / After (\\)', onclick: () => this.toggleBefore() }, h('span', { text: 'Before' }));
      this.tbSplit = h('button.tb-btn', { title: 'Before & After Left/Right (Y)', onclick: () => this.toggleSplit() }, icon('beforeAfter'), h('span', { text: 'Y|Y' }));
      this.tbZoom = h('span.tb-label');
      this.tbStars = h('span.tb-stars');
      this.tbFlags = h('span.tb-flags');
      this.toolbar = h('div.toolbar', null,
        h('button.tb-btn', { title: 'Loupe View (E)', onclick: () => LR.App.setModule('library', 'loupe') }, icon('loupe')),
        this.tbBefore, this.tbSplit,
        h('span.tb-sep'),
        h('span.tb-text', { text: 'Zoom:' }), this.tbZoom,
        h('span.tb-flex'),
        this.tbFlags, this.tbStars,
        h('label.tb-check', { title: 'Show clipping (J)' }, this.clipCb = h('input', { type: 'checkbox', onchange: () => this.toggleClipping() }), ' Clipping'));
    },
    updateZoomUI() {
      this.tbZoom.textContent = this.viewer.zoomLabel();
      LR.UI.$$('.nav-z').forEach((b) => b.classList.toggle('on', String(this.viewer.zoom) === b.dataset.z));
    },
    updateToolbarMeta() {
      const p = this.photo();
      LR.App.renderStars(this.tbStars, p);
      LR.App.renderFlags(this.tbFlags, p);
    },
    toggleBefore() {
      this.viewer.before = !this.viewer.before;
      this.viewer.split = false;
      this.tbBefore.classList.toggle('on', this.viewer.before);
      this.tbSplit.classList.remove('on');
      this.viewer.requestRender();
    },
    toggleSplit() {
      this.viewer.split = !this.viewer.split;
      this.viewer.before = false;
      this.tbSplit.classList.toggle('on', this.viewer.split);
      this.tbBefore.classList.remove('on');
      if (this.viewer.split && this.tool === 'crop') this.setTool(null);
      this.viewer.requestRender();
    },
    toggleClipping() {
      this.viewer.clipWarn = !this.viewer.clipWarn;
      this.clipCb.checked = this.viewer.clipWarn;
      this.histogram.setClipActive(this.viewer.clipWarn);
      this.viewer.requestRender();
    },

    /* ---------- refresh ---------- */
    refreshControls() {
      const s = this.s();
      this.controls.forEach((c) => {
        if (!c.path || c.path.startsWith('mask.')) return;
        const v = Settings.getPath(s, c.path);
        if (typeof v === 'number') c.set(v);
      });
      this.wheels.forEach((w) => w.update());
    },
    refreshMinor() {
      this.renderHistory();
      const s = this.s();
      this.treatColor.classList.toggle('on', s.treatment !== 'bw');
      this.treatBW.classList.toggle('on', s.treatment === 'bw');
      this.wbSelect.value = s.wbMode || 'As Shot';
      this.curve.draw();
    },
    refresh() {
      const s = this.s();
      const bwNow = s.treatment === 'bw';
      if (this._bwBuilt !== bwNow || !this.hslBody.children.length) { this._bwBuilt = bwNow; this.buildHSL(); }
      if (!this.cgBody.children.length) this.renderGrading();
      this.refreshControls();
      this.refreshMinor();
      this.renderSnapshots();
      this.syncCropUI();
      if (this.tool === 'mask') this.renderMaskDrawer();
      this.updateZoomUI();
      this.updateToolbarMeta();
      this.viewer.requestRender();
    },
    onActivePhotoChanged(prevId) {
      if (prevId && prevId !== S.activeId) this.prevId = prevId;
      if (this.tool) this.setTool(null);
      this.maskTool.selected = null;
      this.refresh();
    },
  };
  function groupsOf(settings) {
    const out = {};
    Catalog.GROUPS.forEach(([k, , keys]) => { if (keys.some((key) => key in settings)) out[k] = true; });
    return out;
  }

  LR.Develop = Develop;
})();
