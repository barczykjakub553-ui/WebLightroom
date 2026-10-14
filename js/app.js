/* WebLightroom — application shell: layout, module switching, filmstrip, menus, keyboard shortcuts. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h, icon, clamp } = LR.UI;
  const S = LR.state;
  const { Catalog, Library, Develop } = LR;

  const App = {
    async start() {
      this.histogram = new LR.Histogram();
      try {
        this.viewer = new LR.Viewer();
      } catch (e) {
        document.body.innerHTML = '<div class="fatal">WebLightroom needs a browser with WebGL2 support (Chrome, Edge, Firefox, Safari 15+).<br><small>' + LR.escapeHtml(e.message) + '</small></div>';
        return;
      }
      this.viewer.onHistogram = (px) => {
        this.histogram.compute(px);
        if (S.module === 'develop' && Develop.curve) Develop.curve.draw();
      };
      this.buildLayout();
      await Catalog.load();
      Library.init(this.viewer, this.histogram);
      Develop.init(this.viewer, this.histogram);
      this.bindEvents();
      this.bindKeys();
      this.bindDrop();
      const startModule = localStorage.getItem('lr-module') || 'library';
      const startView = localStorage.getItem('lr-libview') || 'grid';
      this.setModule(S.photos.length ? startModule : 'library', startView);
      this.renderFilmstrip();
      document.body.classList.add('ready');
    },

    buildLayout() {
      this.moduleLinks = {};
      const mod = (id, label) => (this.moduleLinks[id] = h('a.module', { text: label, onclick: () => this.setModule(id) }));
      const menus = [
        ['File', () => this.fileMenu()], ['Edit', () => this.editMenu()], ['Photo', () => this.photoMenu()],
        ['Develop', () => this.developMenu()], ['View', () => this.viewMenu()], ['Help', () => this.helpMenu()],
      ].map(([l, fn]) => h('button.menu-btn', { text: l, onclick: (e) => { const r = e.target.getBoundingClientRect(); LR.UI.menu(r.left, r.bottom + 2, fn()); } }));
      this.topbar = h('header.topbar', null,
        h('div.identity', null, h('div.id-logo', { text: 'WebLightroom' }), h('div.menubar', null, menus)),
        h('nav.modules', null, mod('library', 'Library'), h('span.mod-sep', { text: '|' }), mod('develop', 'Develop')));
      this.leftSlot = h('aside.side.left');
      this.rightSlot = h('aside.side.right');
      this.centerTop = h('div.center-top');
      this.centerView = h('div.center-view');
      this.centerBar = h('div.center-bar');
      this.center = h('section.center', null, this.centerTop, this.centerView, this.centerBar);
      const edge = (side) => h('div.edge.' + side, { title: 'Show/Hide Panel', onclick: () => this.togglePanel(side) }, h('span.edge-tri'));
      this.main = h('div.main', null, edge('left'), this.leftSlot, this.center, this.rightSlot, edge('right'));
      this.fsHead = h('div.fs-head');
      this.fsStrip = h('div.fs-strip');
      this.filmstrip = h('footer.filmstrip', null, h('div.edge-h', { title: 'Show/Hide Filmstrip', onclick: () => this.togglePanel('bottom') }, h('span.edge-tri')), this.fsHead, this.fsStrip);
      this.progress = h('div.progress', null, h('div.progress-label'), h('div.progress-bar', null, h('div.progress-fill')));
      this.dropOverlay = h('div.drop-overlay', null, h('div', { text: 'Drop photos to import' }));
      this.fileInput = h('input', { type: 'file', multiple: true, accept: 'image/*', style: { display: 'none' } });
      this.folderInput = h('input', { type: 'file', multiple: true, webkitdirectory: true, style: { display: 'none' } });
      [this.fileInput, this.folderInput].forEach((inp) => inp.addEventListener('change', () => { if (inp.files.length) Catalog.importFiles(inp.files); inp.value = ''; }));
      this.lights = h('div.lights-out');
      this.app = h('div#app', null, this.topbar, this.main, this.filmstrip, this.progress, this.dropOverlay, this.fileInput, this.folderInput, this.lights);
      document.body.appendChild(this.app);
      const hidden = JSON.parse(localStorage.getItem('lr-hidden') || '{}');
      ['left', 'right', 'bottom', 'top'].forEach((k) => this.app.classList.toggle('hide-' + k, !!hidden[k]));
    },

    setModule(mod, libView) {
      const prevModule = S.module;
      if (mod === 'develop' && !Catalog.active()) { LR.UI.toast('Import or select a photo first'); mod = 'library'; }
      if (prevModule === 'develop' && mod !== 'develop' && Develop.tool) Develop.setTool(null);
      S.module = mod;
      if (libView) S.libView = libView;
      localStorage.setItem('lr-module', mod);
      localStorage.setItem('lr-libview', S.libView);
      Object.entries(this.moduleLinks).forEach(([k, el]) => el.classList.toggle('on', k === mod));
      this.app.dataset.module = mod;
      this.app.dataset.view = mod === 'library' ? S.libView : 'develop';
      const v = this.viewer;
      v.before = false;
      v.split = false;
      v.clickZoom = true;
      v.bgColor = mod === 'develop' ? [0.137, 0.137, 0.137] : [0.137, 0.137, 0.137];
      const swap = (slot, el) => { if (slot.firstChild !== el) { slot.innerHTML = ''; if (el) slot.appendChild(el); } };
      this.centerTop.innerHTML = '';
      if (mod === 'library') {
        swap(this.leftSlot, Library.leftCol);
        swap(this.rightSlot, Library.rightCol);
        if (S.libView === 'grid') {
          this.centerTop.appendChild(Library.filterBar);
          swap(this.centerView, Library.gridWrap);
        } else {
          swap(this.centerView, v.el);
        }
        swap(this.centerBar, Library.toolbar);
        Library.onShow();
        v.setTool(null);
        if (S.libView === 'loupe') { v.load(Catalog.active()); v.requestRender(); }
        else if (S.libView === 'grid') setTimeout(() => Library.grid.focus({ preventScroll: true }), 0);
      } else {
        swap(this.leftSlot, Develop.leftCol);
        swap(this.rightSlot, Develop.rightCol);
        swap(this.centerView, v.el);
        swap(this.centerBar, Develop.toolbar);
        Develop.histoSlot.appendChild(this.histogram.el);
        this.histogram.setInfo(Catalog.active());
        v.load(Catalog.active());
        Develop.refresh();
      }
      this.updateFilmstripSelection();
    },

    bindEvents() {
      let prevActive = S.activeId;
      LR.bus.on('active', () => {
        const p = Catalog.active();
        if (S.module === 'develop' || S.libView === 'loupe') this.viewer.load(p);
        if (S.module === 'develop') Develop.onActivePhotoChanged(prevActive);
        this.histogram.setInfo(p);
        if (!p && S.module === 'develop') this.setModule('library', 'grid');
        prevActive = S.activeId;
      });
      LR.bus.on('settings', () => { if (S.module === 'develop' || S.libView === 'loupe') this.viewer.requestRender(); });
      LR.bus.on('selection', () => this.updateFilmstripSelection());
      LR.bus.on('photos', () => this.renderFilmstrip());
      LR.bus.on('visible-changed', () => this.renderFilmstrip());
      LR.bus.on('meta', () => this.renderFilmstrip());
      LR.bus.on('thumb', (id) => {
        const img = this.fsStrip.querySelector(`.fs-cell[data-id="${id}"] img`);
        const url = Catalog.thumbURL(id);
        if (img && url) img.src = url;
      });
      LR.bus.on('toggle-clipping', () => { if (S.module === 'develop') Develop.toggleClipping(); });
      LR.bus.on('progress', (p) => {
        const el = this.progress;
        el.classList.toggle('show', p.done < p.total);
        el.querySelector('.progress-label').textContent = p.label + ' ' + Math.min(p.done + 1, p.total) + ' of ' + p.total;
        el.querySelector('.progress-fill').style.width = (p.done / p.total) * 100 + '%';
      });
      this.fsStrip.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { this.fsStrip.scrollLeft += e.deltaY; e.preventDefault(); }
      }, { passive: false });
    },

    /* ---------- filmstrip ---------- */
    renderFilmstrip() {
      const list = Catalog.visible();
      const strip = this.fsStrip;
      const scroll = strip.scrollLeft;
      strip.innerHTML = '';
      list.forEach((p) => {
        const url = Catalog.thumbURL(p.id);
        const img = h('img', { alt: '', draggable: false });
        if (url) img.src = url;
        const c = h('div.fs-cell' + (p.label ? '.label-' + p.label : '') + (p.flag === -1 ? '.rejected' : ''), { dataset: { id: p.id }, title: p.name }, img,
          p.rating ? h('div.fs-stars', { text: '★'.repeat(p.rating) }) : null,
          p.flag === 1 ? h('div.fs-flag', null, icon('flag')) : null,
          p.edited ? h('div.fs-edit', null, icon('edited')) : null);
        c.addEventListener('click', (e) => Catalog.clickSelect(p.id, e));
        c.addEventListener('dblclick', () => { if (S.module === 'library') this.setModule('library', 'loupe'); });
        c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!S.selected.has(p.id)) Catalog.clickSelect(p.id, null); Library.cellMenu(e.clientX, e.clientY); });
        strip.appendChild(c);
      });
      strip.scrollLeft = scroll;
      this.updateFilmstripSelection();
    },
    updateFilmstripSelection() {
      LR.UI.$$('.fs-cell', this.fsStrip).forEach((c) => {
        c.classList.toggle('selected', S.selected.has(c.dataset.id));
        c.classList.toggle('active', c.dataset.id === S.activeId);
      });
      const a = this.fsStrip.querySelector('.fs-cell.active');
      if (a) {
        const r = a.getBoundingClientRect(), w = this.fsStrip.getBoundingClientRect();
        if (r.left < w.left || r.right > w.right) this.fsStrip.scrollLeft += r.left - w.left - w.width / 2 + r.width / 2;
      }
      const list = Catalog.visible();
      const p = Catalog.active();
      this.fsHead.innerHTML = '';
      this.fsHead.append(
        h('span.fs-src', { text: Catalog.sourceName() }),
        h('span.fs-info', { text: `${list.length} photo${list.length === 1 ? '' : 's'}${S.selected.size > 1 ? ' / ' + S.selected.size + ' selected' : ''}${p ? ' / ' + p.name + (p.virtualCopy ? ' / ' + p.copyName : '') : ''}` }),
        h('span.tb-flex'),
        h('button.fs-nav', { title: 'Previous (←)', onclick: () => Catalog.step(-1) }, '‹'),
        h('button.fs-nav', { title: 'Next (→)', onclick: () => Catalog.step(1) }, '›'));
    },

    /* ---------- toolbar helpers ---------- */
    renderStars(el, p) {
      el.innerHTML = '';
      if (!p) return;
      for (let i = 1; i <= 5; i++) el.appendChild(h('span.tstar' + (i <= p.rating ? '.on' : ''), { text: '★', title: i + ' star' + (i > 1 ? 's' : ''), onclick: () => Catalog.setRating(p.rating === i ? 0 : i) }));
    },
    renderFlags(el, p) {
      el.innerHTML = '';
      if (!p) return;
      el.append(
        h('button.tb-flag' + (p.flag === 1 ? '.on' : ''), { title: 'Flag as Pick (P)', onclick: () => Catalog.setFlag(p.flag === 1 ? 0 : 1) }, icon('flag')),
        h('button.tb-flag.rej' + (p.flag === -1 ? '.on' : ''), { title: 'Set as Rejected (X)', onclick: () => Catalog.setFlag(p.flag === -1 ? 0 : -1) }, icon('reject')));
    },

    /* ---------- panels ---------- */
    togglePanel(side) {
      const k = 'hide-' + side;
      this.app.classList.toggle(k);
      this.savePanels();
      this.viewer.requestRender();
    },
    savePanels() {
      const o = {};
      ['left', 'right', 'bottom', 'top'].forEach((k) => (o[k] = this.app.classList.contains('hide-' + k)));
      localStorage.setItem('lr-hidden', JSON.stringify(o));
    },
    toggleSidePanels() {
      const hide = !(this.app.classList.contains('hide-left') && this.app.classList.contains('hide-right'));
      this.app.classList.toggle('hide-left', hide);
      this.app.classList.toggle('hide-right', hide);
      this.savePanels();
    },
    toggleAllPanels() {
      const all = ['left', 'right', 'bottom', 'top'];
      const hide = !all.every((k) => this.app.classList.contains('hide-' + k));
      all.forEach((k) => this.app.classList.toggle('hide-' + k, hide));
      this.savePanels();
    },
    cycleLights() {
      const order = ['', 'dim', 'off'];
      const cur = this.app.dataset.lights || '';
      const next = order[(order.indexOf(cur) + 1) % 3];
      this.app.dataset.lights = next;
      LR.UI.hud(next === 'dim' ? 'Lights Dim' : next === 'off' ? 'Lights Out' : 'Lights On');
    },
    toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    },
    openImport(folder) {
      (folder ? this.folderInput : this.fileInput).click();
    },

    /* ---------- drag & drop import ---------- */
    bindDrop() {
      let depth = 0;
      const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
      window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; this.dropOverlay.classList.add('show'); });
      window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) this.dropOverlay.classList.remove('show'); });
      window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
      window.addEventListener('drop', async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        this.dropOverlay.classList.remove('show');
        const files = await collectDropped(e.dataTransfer);
        Catalog.importFiles(files);
      });
    },

    /* ---------- menus ---------- */
    fileMenu() {
      return [
        { label: 'Import Photos…', shortcut: 'Ctrl+Shift+I', action: () => this.openImport() },
        { label: 'Import Folder…', action: () => this.openImport(true) },
        { label: 'Add Sample Photos', action: () => Catalog.importSamples() },
        '-',
        { label: 'Export…', shortcut: 'Ctrl+Shift+E', action: () => LR.Export.open(), disabled: !Catalog.active() },
        '-',
        { label: 'New Collection…', shortcut: 'Ctrl+N', action: () => Catalog.newCollection(S.selected.size > 0) },
        '-',
        { label: 'Clear Entire Catalog…', action: () => this.clearCatalog() },
      ];
    },
    editMenu() {
      return [
        { label: 'Undo', shortcut: 'Ctrl+Z', action: () => Develop.undo() },
        { label: 'Redo', shortcut: 'Ctrl+Y', action: () => Develop.redo() },
        '-',
        { label: 'Select All', shortcut: 'Ctrl+A', action: () => Catalog.selectAll() },
        { label: 'Select None', shortcut: 'Ctrl+D', action: () => Catalog.selectNone() },
        '-',
        { label: 'Copy Settings…', shortcut: 'Ctrl+Shift+C', action: () => Catalog.copySettings(true) },
        { label: 'Paste Settings', shortcut: 'Ctrl+Shift+V', action: () => Catalog.pasteSettings(), disabled: !S.clipboard },
        { label: 'Sync Settings…', action: () => Catalog.syncSettings() },
      ];
    },
    photoMenu() {
      const has = !!Catalog.active();
      return [
        { label: 'Create Virtual Copy', shortcut: "Ctrl+'", action: () => Catalog.virtualCopy(), disabled: !has },
        { label: 'Rotate Left', shortcut: 'Ctrl+[', action: () => this.rotate(-1), disabled: !has },
        { label: 'Rotate Right', shortcut: 'Ctrl+]', action: () => this.rotate(1), disabled: !has },
        '-',
        { label: 'Set Pick', shortcut: 'P', action: () => Catalog.setFlag(1), disabled: !has },
        { label: 'Set Rejected', shortcut: 'X', action: () => Catalog.setFlag(-1), disabled: !has },
        { label: 'Remove Flag', shortcut: 'U', action: () => Catalog.setFlag(0), disabled: !has },
        { label: 'Add to Quick Collection', shortcut: 'B', action: () => Catalog.toggleQuick(), disabled: !has },
        '-',
        { label: 'Remove Photos from Catalog…', shortcut: 'Del', action: () => Catalog.removePhotos(), disabled: !has },
      ];
    },
    developMenu() {
      const has = !!Catalog.active();
      const go = (fn) => () => { if (S.module !== 'develop') this.setModule('develop'); fn(); };
      return [
        { label: 'Auto Tone', shortcut: 'Ctrl+U', action: go(() => Develop.autoTone()), disabled: !has },
        { label: 'Convert to Black & White', shortcut: 'V', action: go(() => Develop.setTreatment(Catalog.active().settings.treatment === 'bw' ? 'color' : 'bw')), disabled: !has },
        { label: 'Crop', shortcut: 'R', action: go(() => Develop.setTool('crop')), disabled: !has },
        { label: 'Masking', shortcut: 'Shift+W', action: go(() => Develop.setTool('mask')), disabled: !has },
        '-',
        { label: 'New Snapshot…', shortcut: 'Ctrl+Shift+N', action: go(() => Develop.addSnapshot()), disabled: !has },
        { label: 'New Preset…', action: () => Catalog.newPreset(), disabled: !has },
        '-',
        { label: 'Reset All Settings', shortcut: 'Ctrl+Shift+R', action: () => { Catalog.resetSettings(); }, disabled: !has },
      ];
    },
    viewMenu() {
      return [
        { label: 'Grid', shortcut: 'G', action: () => this.setModule('library', 'grid') },
        { label: 'Loupe', shortcut: 'E', action: () => this.setModule('library', 'loupe') },
        { label: 'Develop', shortcut: 'D', action: () => this.setModule('develop') },
        '-',
        { label: 'Before / After', shortcut: '\\', action: () => { if (S.module === 'develop') Develop.toggleBefore(); } },
        { label: 'Before / After Left-Right', shortcut: 'Y', action: () => { if (S.module === 'develop') Develop.toggleSplit(); } },
        { label: 'Show Clipping', shortcut: 'J', action: () => { if (S.module === 'develop') Develop.toggleClipping(); } },
        { label: 'Cycle Info Overlay', shortcut: 'I', action: () => this.viewer.cycleInfo() },
        '-',
        { label: 'Toggle Side Panels', shortcut: 'Tab', action: () => this.toggleSidePanels() },
        { label: 'Toggle All Panels', shortcut: 'Shift+Tab', action: () => this.toggleAllPanels() },
        { label: 'Lights Out', shortcut: 'L', action: () => this.cycleLights() },
        { label: 'Full Screen', shortcut: 'F', action: () => this.toggleFullscreen() },
      ];
    },
    helpMenu() {
      return [{ label: 'Keyboard Shortcuts', shortcut: '?', action: () => this.showShortcuts() }];
    },
    rotate(dir) {
      Catalog.targets().forEach((p) => {
        p.settings.orientation = (((p.settings.orientation || 0) + dir) % 4 + 4) % 4;
        p.settings.crop = null;
        Catalog.commitSettings(p, dir > 0 ? 'Rotate Right' : 'Rotate Left');
      });
      LR.bus.emit('settings');
    },
    async clearCatalog() {
      if (!(await LR.UI.confirm('Clear Catalog', 'Delete ALL photos, collections, presets and edits stored in this browser? This cannot be undone.', 'Delete Everything'))) return;
      await LR.DB.flush();
      indexedDB.deleteDatabase('weblightroom-catalog');
      localStorage.removeItem('lr-module');
      location.reload();
    },
    showShortcuts() {
      const groups = [
        ['Modules & Views', [['G', 'Library Grid'], ['E', 'Library Loupe'], ['D', 'Develop'], ['Tab', 'Hide side panels'], ['Shift+Tab', 'Hide all panels'], ['L', 'Lights Out (cycle)'], ['F', 'Full screen'], ['I', 'Info overlay'], ['Z / Click', 'Toggle zoom'], ['Ctrl+Scroll', 'Zoom in / out'], ['Space+Drag', 'Pan while using a tool']]],
        ['Rating & Flags', [['0 – 5', 'Set star rating'], ['[ / ]', 'Decrease / increase rating'], ['6 / 7 / 8 / 9', 'Red / Yellow / Green / Blue label'], ['P', 'Pick'], ['X', 'Reject'], ['U', 'Unflag'], ['B', 'Quick Collection']]],
        ['Develop', [['R', 'Crop & Straighten'], ['Shift+W', 'Masking'], ['M / Shift+M', 'New Linear / Radial Gradient'], ['O', 'Mask overlay'], ['W', 'White balance picker'], ['V', 'Black & White'], ['\\', 'Before / After'], ['Y', 'Before / After side by side'], ['J', 'Clipping warning'], ['Ctrl+U', 'Auto Tone'], ['Ctrl+Shift+R', 'Reset'], ['Ctrl+Shift+N', 'New Snapshot'], ['Alt+Wheel on slider', 'Nudge value'], ['Double-click label', 'Reset slider']]],
        ['Crop Tool', [['A', 'Lock / unlock aspect'], ['X', 'Swap aspect orientation'], ['Enter', 'Done'], ['Esc', 'Cancel'], ['Drag outside', 'Rotate / straighten']]],
        ['Edit', [['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+A / Ctrl+D', 'Select all / none'], ['Ctrl+Shift+C / V', 'Copy / Paste settings'], ["Ctrl+'", 'Virtual copy'], ['Ctrl+[ / ]', 'Rotate left / right'], ['Ctrl+Shift+E', 'Export'], ['Ctrl+Shift+I', 'Import'], ['Delete', 'Remove from catalog'], ['← / →', 'Previous / Next photo']]],
      ];
      const body = h('div.shortcuts', null, groups.map(([t, rows]) => h('div.sc-group', null, h('div.sc-title', { text: t }), rows.map(([k, d]) => h('div.sc-row', null, h('kbd', { text: k }), h('span', { text: d }))))));
      LR.UI.modal('Keyboard Shortcuts', body, [{ label: 'Close', value: true, primary: true }], { width: 760 });
    },

    /* ---------- keyboard ---------- */
    bindKeys() {
      document.addEventListener('keydown', (e) => {
        if (LR.UI.isTyping(e)) return;
        if (document.querySelector('.overlay')) return;
        const k = e.key, ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey;
        const dev = S.module === 'develop';
        const handled = () => { e.preventDefault(); e.stopPropagation(); };
        const v = this.viewer;

        // crop tool specific
        if (dev && Develop.tool === 'crop' && !ctrl) {
          if (k === 'Enter' || k === 'r' || k === 'R') { handled(); Develop.setTool(null); return; }
          if (k === 'Escape') { handled(); Develop.cropTool.cancel(); Develop.setTool(null); return; }
          if (k === 'x' || k === 'X') { handled(); Develop.cropTool.swapAspect(); return; }
          if (k === 'a' || k === 'A') { handled(); const s = Catalog.active().settings; s.aspectLocked = !s.aspectLocked; Develop.syncCropUI(); return; }
        }
        if (ctrl) {
          const lk = k.toLowerCase();
          if (lk === 'z' && !shift) { handled(); Develop.undo(); if (S.module === 'library') LR.bus.emit('settings'); return; }
          if ((lk === 'z' && shift) || lk === 'y') { handled(); Develop.redo(); if (S.module === 'library') LR.bus.emit('settings'); return; }
          if (lk === 'a') { handled(); Catalog.selectAll(); return; }
          if (lk === 'd') { handled(); Catalog.selectNone(); return; }
          if (lk === 'c' && shift) { handled(); Catalog.copySettings(true); return; }
          if (lk === 'v' && shift) { handled(); Catalog.pasteSettings(); return; }
          if (lk === 'e' && shift) { handled(); LR.Export.open(); return; }
          if (lk === 'i' && shift) { handled(); this.openImport(); return; }
          if (lk === 'r' && shift) { handled(); Catalog.resetSettings(); LR.UI.hud('Reset Settings'); return; }
          if (lk === 'n' && shift) { handled(); if (dev) Develop.addSnapshot(); return; }
          if (lk === 'n') { handled(); Catalog.newCollection(S.selected.size > 0); return; }
          if (lk === 'u') { handled(); if (dev) Develop.autoTone(); else Library.quickAuto(); return; }
          if (k === "'") { handled(); Catalog.virtualCopy(); return; }
          if (k === '[') { handled(); if (dev && Develop.tool === 'crop') Develop.cropTool.rotate90(-1); else this.rotate(-1); return; }
          if (k === ']') { handled(); if (dev && Develop.tool === 'crop') Develop.cropTool.rotate90(1); else this.rotate(1); return; }
          if (k === '=' || k === '+') { handled(); this.zoomStep(1); return; }
          if (k === '-') { handled(); this.zoomStep(-1); return; }
          return;
        }
        if (k === 'Tab') { handled(); if (shift) this.toggleAllPanels(); else this.toggleSidePanels(); this.viewer.requestRender(); return; }
        if (k === '?' || k === 'F1') { handled(); this.showShortcuts(); return; }
        switch (k) {
          case 'g': case 'G': handled(); if (dev && Develop.tool) Develop.setTool(null); this.setModule('library', 'grid'); return;
          case 'e': case 'E': handled(); this.setModule('library', 'loupe'); return;
          case 'd': case 'D': handled(); this.setModule('develop'); return;
          case 'r': case 'R': handled(); if (!dev) this.setModule('develop'); if (S.module === 'develop') Develop.setTool(Develop.tool === 'crop' ? null : 'crop'); return;
          case 'W': if (shift) { handled(); if (!dev) this.setModule('develop'); if (S.module === 'develop') Develop.setTool(Develop.tool === 'mask' ? null : 'mask'); return; } break;
          case 'w': if (dev) { handled(); Develop.setTool(Develop.tool === 'wb' ? null : 'wb'); return; } break;
          case 'm': case 'M':
            if (dev) { handled(); if (Develop.tool !== 'mask') Develop.setTool('mask'); Develop.maskTool.startCreate(shift ? 'radial' : 'linear'); return; }
            break;
          case 'o': case 'O': if (dev && Develop.tool === 'mask') { handled(); Develop.toggleMaskOverlay(); return; } break;
          case 'j': case 'J': if (dev) { handled(); Develop.toggleClipping(); return; } break;
          case '\\': if (dev) { handled(); Develop.toggleBefore(); return; } break;
          case 'y': case 'Y': if (dev) { handled(); Develop.toggleSplit(); return; } break;
          case 'v': case 'V': if (Catalog.active()) {
            handled();
            if (dev) Develop.setTreatment(Catalog.active().settings.treatment === 'bw' ? 'color' : 'bw');
            else { const bw = Catalog.active().settings.treatment !== 'bw'; Library.quickSet({ treatment: bw ? 'bw' : 'color' }, bw ? 'Black & White' : 'Color'); }
            return;
          } break;
          case 'z': case 'Z': if (dev || S.libView === 'loupe') { handled(); v.toggleZoom(); return; } break;
          case 'i': case 'I': handled(); v.cycleInfo(); return;
          case 'l': case 'L': handled(); this.cycleLights(); return;
          case 'f': case 'F': handled(); this.toggleFullscreen(); return;
          case 'p': case 'P': handled(); Catalog.setFlag(1); return;
          case 'x': case 'X': handled(); Catalog.setFlag(-1); return;
          case 'u': case 'U': handled(); Catalog.setFlag(0); return;
          case 'b': case 'B': handled(); Catalog.toggleQuick(); return;
          case '[': case ']': { handled(); const p = Catalog.active(); if (p) Catalog.setRating(clamp(p.rating + (k === ']' ? 1 : -1), 0, 5)); return; }
          case 'Delete': case 'Backspace': handled(); Catalog.removePhotos(); return;
          case 'Escape':
            handled();
            if (dev && Develop.tool) { Develop.setTool(null); return; }
            if (document.fullscreenElement) { document.exitFullscreen(); return; }
            if (S.module === 'library' && S.libView === 'loupe') this.setModule('library', 'grid');
            return;
          case 'Enter': if (S.module === 'library' && S.libView === 'grid' && Catalog.active()) { handled(); this.setModule('library', 'loupe'); return; } break;
          case 'ArrowLeft': case 'ArrowRight': handled(); Catalog.step(k === 'ArrowLeft' ? -1 : 1, shift); return;
          case 'ArrowUp': case 'ArrowDown':
            if (S.module === 'library' && S.libView === 'grid') { handled(); Catalog.step((k === 'ArrowUp' ? -1 : 1) * Library.columns(), shift); return; }
            break;
          case '+': case '=': handled(); this.zoomStep(1); return;
          case '-': handled(); this.zoomStep(-1); return;
        }
        if (/^[0-5]$/.test(k)) { handled(); Catalog.setRating(+k); return; }
        const labels = { 6: 'red', 7: 'yellow', 8: 'green', 9: 'blue' };
        if (labels[k]) { handled(); Catalog.setLabel(labels[k]); return; }
      });
      document.addEventListener('keyup', (e) => {
        if (e.key === 'Tab') e.preventDefault();
      });
    },
    zoomStep(dir) {
      const v = this.viewer;
      if (!(S.module === 'develop' || S.libView === 'loupe') || !v.layout) {
        if (S.module === 'library' && S.libView === 'grid') {
          S.thumbSize = clamp(S.thumbSize + dir * 30, 90, 360);
          Library.grid.style.setProperty('--cell', S.thumbSize + 'px');
          const r = Library.toolbar.querySelector('.tb-range');
          if (r) r.value = S.thumbSize;
          Catalog.savePrefs();
        }
        return;
      }
      const steps = [0.0625, 0.125, 0.25, 1 / 3, 0.5, 2 / 3, 1, 2, 3, 4, 8, 11];
      const cur = v.zoom === 'fit' || v.zoom === 'fill' ? v.layout.scale / v.layout.f : v.zoom;
      let next;
      if (dir > 0) next = steps.find((s) => s > cur + 1e-3) || 11;
      else next = [...steps].reverse().find((s) => s < cur - 1e-3);
      if (!next || (dir < 0 && next <= v.fitScale())) v.setZoom('fit');
      else v.setZoom(next);
    },
  };

  async function collectDropped(dt) {
    const items = dt.items ? [...dt.items] : [];
    const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) return [...dt.files];
    const out = [];
    const walk = async (entry) => {
      if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)));
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res) => reader.readEntries(res, () => res([])));
          for (const e of batch) await walk(e);
        } while (batch.length);
      }
    };
    for (const e of entries) await walk(e);
    return out;
  }

  LR.App = App;
  window.addEventListener('DOMContentLoaded', () => App.start());
})();
