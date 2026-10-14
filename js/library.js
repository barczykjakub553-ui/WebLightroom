/* Stopbath — Library module: grid, loupe, catalog/collections, quick develop, keywords, metadata. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h, panel, icon, select, clamp } = LR.UI;
  const { Catalog, Settings } = LR;
  const S = LR.state;

  const LABEL_COLORS = { red: '#c8433f', yellow: '#cfb33d', green: '#4f9a4a', blue: '#3f6fc4', purple: '#8a50b8' };

  const Library = {
    init(viewer, histogram) {
      this.viewer = viewer;
      this.histogram = histogram;
      this.left = h('div.panel-scroll');
      this.right = h('div.panel-scroll');
      this.leftCol = h('div.panel-col', null, this.left, h('div.panel-foot', null,
        h('button.btn', { text: 'Import…', onclick: () => LR.App.openImport() }),
        h('button.btn', { text: 'Export…', onclick: () => LR.Export.open() })));
      this.rightCol = h('div.panel-col', null, this.right, h('div.panel-foot', null,
        h('button.btn', { text: 'Sync Settings', title: 'Apply the active photo\'s settings to the selection', onclick: () => Catalog.syncSettings() }),
        h('button.btn', { text: 'Sync Metadata', onclick: () => this.syncMetadata() })));
      this.grid = h('div.grid', { tabindex: 0 });
      this.gridWrap = h('div.grid-wrap', null, this.grid);
      this.empty = h('div.empty-state', null,
        h('div.empty-title', { text: 'No photos here yet' }),
        h('div.empty-sub', { text: 'Drop JPEG / PNG / WebP files anywhere in the window, or:' }),
        h('div.row-gap', null,
          h('button.btn.primary', { text: 'Import Photos…', onclick: () => LR.App.openImport() }),
          h('button.btn', { text: 'Add Sample Photos', onclick: () => Catalog.importSamples() })));
      this.buildFilterBar();
      this.buildLeft();
      this.buildRight();
      this.buildToolbar();
      this.gridWrap.appendChild(this.empty);

      this.grid.addEventListener('contextmenu', (e) => {
        const cell = e.target.closest('.cell');
        if (!cell) return;
        e.preventDefault();
        if (!S.selected.has(cell.dataset.id)) Catalog.clickSelect(cell.dataset.id, null);
        this.cellMenu(e.clientX, e.clientY);
      });
      LR.bus.on('photos', () => this.renderAll());
      LR.bus.on('collections', () => this.renderCatalogPanel());
      LR.bus.on('meta', () => { this.renderGrid(); this.renderMeta(); this.renderCatalogPanel(); });
      LR.bus.on('selection', () => { this.updateSelection(); this.renderMeta(); });
      LR.bus.on('active', () => { this.updateNavigator(); });
      LR.bus.on('thumb', (id) => this.updateThumb(id));
      LR.bus.on('settings', () => this.renderGrid());
    },

    /* ---------- left ---------- */
    buildLeft() {
      this.navImg = h('img.lib-nav-img', { alt: '' });
      this.left.append(panel('Navigator', h('div.nav-wrap.lib', null, this.navImg), { key: 'lib-nav' }));
      this.catBox = h('div.list');
      this.left.append(panel('Catalog', this.catBox, { key: 'lib-catalog' }));
      this.collBox = h('div.list');
      const add = h('span.panel-head-extra.head-btn', { title: 'Create Collection', onclick: () => Catalog.newCollection(S.selected.size > 0) }, icon('plus'));
      this.left.append(panel('Collections', this.collBox, { key: 'lib-coll', headExtra: add }));
      this.renderCatalogPanel();
    },
    renderCatalogPanel() {
      const item = (label, count, src, active) => {
        const el = h('div.list-item.count' + (active ? '.current' : ''), null, h('span', { text: label }), h('span.cnt', { text: String(count) }));
        el.addEventListener('click', () => Catalog.setSource(src));
        return el;
      };
      const cur = S.source;
      this.catBox.innerHTML = '';
      this.catBox.append(
        item('All Photographs', S.photos.length, { type: 'all' }, cur.type === 'all'),
        item('Quick Collection +', S.photos.filter((p) => p.quick).length, { type: 'quick' }, cur.type === 'quick'),
        item('Previous Import', S.photos.filter((p) => p.importBatch && p.importBatch === S.lastImport).length, { type: 'import' }, cur.type === 'import'));
      this.collBox.innerHTML = '';
      if (!S.collections.length) this.collBox.appendChild(h('div.empty-note', { text: 'Click + to create a collection' }));
      S.collections.forEach((c) => {
        const el = item(c.name, c.ids.filter((id) => S.byId.has(id)).length, { type: 'collection', id: c.id }, cur.type === 'collection' && cur.id === c.id);
        el.classList.add('coll');
        el.prepend(icon('stack'));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          LR.UI.menu(e.clientX, e.clientY, [
            { label: 'Add Selected Photos', action: () => Catalog.addToCollection(c.id) },
            { label: 'Rename…', action: () => Catalog.renameCollection(c.id) },
            '-',
            { label: 'Delete Collection', action: () => Catalog.deleteCollection(c.id) },
          ]);
        });
        // drop photos onto a collection
        el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-lr-photos')) { e.preventDefault(); el.classList.add('drop'); } });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          el.classList.remove('drop');
          const ids = JSON.parse(e.dataTransfer.getData('text/x-lr-photos') || '[]');
          Catalog.addToCollection(c.id, ids.map((id) => S.byId.get(id)).filter(Boolean));
        });
        this.collBox.appendChild(el);
      });
    },
    updateNavigator() {
      const p = Catalog.active();
      const url = p && Catalog.thumbURL(p.id);
      if (url) { this.navImg.src = url; this.navImg.style.display = ''; } else this.navImg.style.display = 'none';
      if (p && url && S.module === 'library') {
        if (this.navImg.complete && this.navImg.naturalWidth) this.histogram.fromImage(this.navImg);
        else this.navImg.onload = () => { if (S.module === 'library') this.histogram.fromImage(this.navImg); };
      } else if (!p) this.histogram.clear();
      this.histogram.setInfo(p);
    },

    /* ---------- right ---------- */
    buildRight() {
      this.right.append(panel('Histogram', this.histoSlot = h('div'), { key: 'lib-histo' }));
      // Quick Develop
      const presetSel = h('select.qd-select', {
        onchange: () => {
          const all = Settings.BUILTIN_PRESETS.concat(S.userPresets);
          const p = all.find((x) => x.id === presetSel.value);
          if (p) { Catalog.applyPreset(p); LR.UI.toast('Applied "' + p.name + '"'); }
          presetSel.value = '';
        },
      });
      const fillPresets = () => {
        presetSel.innerHTML = '';
        presetSel.appendChild(h('option', { value: '', text: 'Saved Preset…' }));
        const all = Settings.BUILTIN_PRESETS.concat(S.userPresets);
        const groups = {};
        all.forEach((p) => (groups[p.group] = groups[p.group] || []).push(p));
        Object.keys(groups).forEach((g) => presetSel.appendChild(h('optgroup', { label: g }, groups[g].map((p) => h('option', { value: p.id, text: p.name })))));
      };
      fillPresets();
      LR.bus.on('presets', fillPresets);
      const row = (label, path, small, big) => h('div.qd-row', null, h('span.qd-label', { text: label }),
        h('button.qd-btn', { text: '◀◀', onclick: () => this.quick(path, -big) }),
        h('button.qd-btn', { text: '◀', onclick: () => this.quick(path, -small) }),
        h('button.qd-btn', { text: '▶', onclick: () => this.quick(path, small) }),
        h('button.qd-btn', { text: '▶▶', onclick: () => this.quick(path, big) }));
      const qd = h('div.quick-dev', null,
        h('div.qd-row', null, h('span.qd-label', { text: 'Saved Preset' }), presetSel),
        h('div.qd-row', null, h('span.qd-label', { text: 'Treatment' }),
          h('button.btn.small', { text: 'Color', onclick: () => this.quickSet({ treatment: 'color' }, 'Color') }),
          h('button.btn.small', { text: 'B&W', onclick: () => this.quickSet({ treatment: 'bw' }, 'Black & White') })),
        h('div.sub-head', null, h('span', { text: 'White Balance' })),
        row('Temperature', 'temp', 5, 20), row('Tint', 'tint', 5, 20),
        h('div.sub-head', null, h('span', { text: 'Tone Control' }), h('button.link-btn', { text: 'Auto Tone', onclick: () => this.quickAuto() })),
        row('Exposure', 'exposure', 1 / 3, 1), row('Contrast', 'contrast', 5, 20), row('Highlights', 'highlights', 5, 20), row('Shadows', 'shadows', 5, 20),
        row('Whites', 'whites', 5, 20), row('Blacks', 'blacks', 5, 20), row('Clarity', 'clarity', 5, 20), row('Vibrance', 'vibrance', 5, 20),
        h('div.row-gap', null, h('button.btn.small', { text: 'Reset All', onclick: () => { Catalog.resetSettings(); LR.UI.toast('Settings reset'); } })));
      this.right.append(panel('Quick Develop', qd, { key: 'lib-qd' }));
      // Keywording
      this.kwChips = h('div.kw-chips');
      this.kwInput = h('input.text', { type: 'text', placeholder: 'Click here to add keywords' });
      this.kwInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const words = this.kwInput.value.split(',').map((w) => w.trim()).filter(Boolean);
          Catalog.targets().forEach((p) => { p.keywords = [...new Set((p.keywords || []).concat(words))]; Catalog.save(p); });
          this.kwInput.value = '';
          this.renderMeta();
        }
      });
      this.right.append(panel('Keywording', h('div', null, this.kwChips, this.kwInput), { key: 'lib-kw' }));
      // Metadata
      this.metaBox = h('div.meta');
      this.right.append(panel('Metadata', this.metaBox, { key: 'lib-meta' }));
    },
    quick(path, delta) {
      Catalog.targets().forEach((p) => {
        const s = p.settings;
        const lim = path === 'exposure' ? 5 : 100;
        const v = Math.round(clamp(Settings.getPath(s, path) + delta, -lim, lim) * 100) / 100;
        Settings.setPath(s, path, v);
        if (path === 'temp' || path === 'tint') s.wbMode = 'Custom';
        Catalog.commitSettings(p, Settings.label(path) + ' ' + Settings.fmtValue(path, delta) + ' (Quick)');
      });
      LR.bus.emit('settings');
      this.refreshLoupe();
    },
    quickSet(obj, label) {
      Catalog.targets().forEach((p) => { Object.assign(p.settings, obj); Catalog.commitSettings(p, label); });
      LR.bus.emit('settings');
      this.refreshLoupe();
    },
    async quickAuto() {
      for (const p of Catalog.targets()) {
        Object.assign(p.settings, await LR.Tools.autoSettings(p, ['tone']));
        Catalog.commitSettings(p, 'Auto Tone');
      }
      LR.bus.emit('settings');
      this.refreshLoupe();
    },
    refreshLoupe() { if (S.libView === 'loupe') this.viewer.requestRender(); },

    renderMeta() {
      const p = Catalog.active();
      const box = this.metaBox;
      box.innerHTML = '';
      this.kwChips.innerHTML = '';
      if (!p) { box.appendChild(h('div.empty-note', { text: 'No photo selected' })); return; }
      const t = Catalog.targets();
      const kws = [...new Set(t.flatMap((x) => x.keywords || []))];
      kws.forEach((k) => this.kwChips.appendChild(h('span.chip', null, k, h('button.chip-x', {
        text: '×', title: 'Remove keyword',
        onclick: () => { t.forEach((x) => { x.keywords = (x.keywords || []).filter((w) => w !== k); Catalog.save(x); }); this.renderMeta(); },
      }))));
      if (!kws.length) this.kwChips.appendChild(h('div.empty-note', { text: 'No keywords' }));
      const e = p.exif || {};
      const editable = (label, key) => {
        const inp = h('input.text.meta-in', { type: 'text', value: p[key] || '' });
        inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); });
        inp.addEventListener('change', () => { p[key] = inp.value; Catalog.save(p); });
        return h('div.meta-row', null, h('span.meta-k', { text: label }), inp);
      };
      const ro = (label, v) => (v ? h('div.meta-row', null, h('span.meta-k', { text: label }), h('span.meta-v', { text: String(v) })) : null);
      LR.UI.append(box, [
        t.length > 1 ? h('div.meta-multi', { text: t.length + ' photos selected — showing active photo' }) : null,
        ro('File Name', p.name + (p.virtualCopy ? ' (' + p.copyName + ')' : '')),
        editable('Title', 'title'),
        editable('Caption', 'caption'),
        ro('Rating', p.rating ? '■'.repeat(p.rating) : '—'),
        ro('Label', p.label ? p.label[0].toUpperCase() + p.label.slice(1) : '—'),
        ro('Dimensions', p.width + ' × ' + p.height),
        ro('Cropped', p.settings.crop ? Math.round(p.settings.crop.w * Math.max(p.width, p.height)) + ' × ' + Math.round(p.settings.crop.h * Math.max(p.width, p.height)) : ''),
        ro('File Size', LR.UI.fmtBytes(p.size)),
        ro('Capture Time', new Date(p.captureTime).toLocaleString()),
        ro('Camera', [e.make, e.model].filter(Boolean).join(' ')),
        ro('Lens', e.lensModel),
        ro('Exposure', [e.exposureTime && LR.Exif.fmtShutter(e.exposureTime), e.fNumber && 'f/' + e.fNumber.toFixed(1)].filter(Boolean).join(' at ')),
        ro('Focal Length', e.focalLength && Math.round(e.focalLength) + ' mm'),
        ro('ISO', e.iso),
        ro('Exposure Bias', e.exposureBias != null && e.exposureBias !== 0 ? (e.exposureBias > 0 ? '+' : '') + e.exposureBias.toFixed(1) + ' EV' : ''),
        ro('Software', e.software),
        ro('Edited', p.edited ? 'Yes (' + (p.history.length - 1) + ' history steps)' : 'No')]);
    },
    syncMetadata() {
      const p = Catalog.active();
      const t = Catalog.targets().filter((x) => x !== p);
      if (!p || !t.length) { LR.UI.toast('Select more than one photo'); return; }
      t.forEach((x) => { x.title = p.title; x.caption = p.caption; x.keywords = [...(p.keywords || [])]; x.label = p.label; x.rating = p.rating; Catalog.save(x); });
      LR.bus.emit('meta');
      LR.UI.toast('Metadata synchronized');
    },

    /* ---------- filter bar ---------- */
    buildFilterBar() {
      const f = S.filter;
      const search = h('input.text.filter-search', { type: 'search', placeholder: 'Search name, keyword, camera…', value: f.text });
      search.addEventListener('input', LR.UI.debounce(() => { f.text = search.value.trim(); this.renderAll(); }, 150));
      search.addEventListener('keydown', (e) => e.stopPropagation());
      const flagSel = select([['all', 'All Flags'], ['picked', 'Picked'], ['unflagged', 'Unflagged'], ['rejected', 'Rejected'], ['notrejected', 'Not Rejected']], f.flag, (v) => { f.flag = v; this.renderAll(); });
      const opSel = select([['>=', '≥'], ['=', '='], ['<=', '≤']], f.ratingOp, (v) => { f.ratingOp = v; this.renderAll(); }, 'narrow');
      const stars = h('span.filter-stars');
      const drawStars = () => {
        stars.innerHTML = '';
        for (let i = 1; i <= 5; i++) stars.appendChild(h('span.fstar' + (i <= f.rating ? '.on' : ''), { text: '■', onclick: () => { f.rating = f.rating === i ? 0 : i; drawStars(); this.renderAll(); } }));
      };
      drawStars();
      const labels = h('span.filter-labels');
      const drawLabels = () => {
        labels.innerHTML = '';
        Object.keys(LABEL_COLORS).forEach((l) => labels.appendChild(h('span.flabel' + (f.label === l ? '.on' : ''), {
          style: { background: LABEL_COLORS[l] }, title: l,
          onclick: () => { f.label = f.label === l ? 'all' : l; drawLabels(); this.renderAll(); },
        })));
      };
      drawLabels();
      const editedSel = select([['all', 'Any State'], ['edited', 'Edited'], ['unedited', 'Unedited']], f.edited || 'all', (v) => { f.edited = v; this.renderAll(); });
      const none = h('button.link-btn', {
        text: 'None', title: 'Clear all filters',
        onclick: () => {
          Object.assign(f, { text: '', flag: 'all', rating: 0, ratingOp: '>=', label: 'all', edited: 'all' });
          search.value = ''; flagSel.value = 'all'; opSel.value = '>='; editedSel.value = 'all';
          drawStars(); drawLabels(); this.renderAll();
        },
      });
      this.filterBar = h('div.filterbar', null, h('span.fb-title', { text: 'Library Filter:' }), search, flagSel, h('span.fb-k', { text: 'Rating' }), opSel, stars, h('span.fb-k', { text: 'Label' }), labels, editedSel, none);
    },

    /* ---------- toolbar ---------- */
    buildToolbar() {
      const sortSel = select([['captureTime', 'Capture Time'], ['importedAt', 'Added Order'], ['name', 'File Name'], ['rating', 'Rating'], ['size', 'File Size']], S.sort.key, (v) => { S.sort.key = v; Catalog.savePrefs(); this.renderAll(); });
      const dirBtn = h('button.tb-btn', { title: 'Reverse sort direction', onclick: () => { S.sort.dir *= -1; Catalog.savePrefs(); this.renderAll(); dirBtn.textContent = S.sort.dir > 0 ? 'A→Z' : 'Z→A'; } }, S.sort.dir > 0 ? 'A→Z' : 'Z→A');
      const size = h('input.tb-range', { type: 'range', min: 90, max: 360, value: S.thumbSize, title: 'Thumbnails' });
      size.addEventListener('input', () => { S.thumbSize = +size.value; this.grid.style.setProperty('--cell', S.thumbSize + 'px'); Catalog.savePrefs(); });
      this.grid.style.setProperty('--cell', S.thumbSize + 'px');
      this.tbStars = h('span.tb-stars');
      this.tbFlags = h('span.tb-flags');
      this.btnGrid = h('button.tb-btn', { title: 'Grid View (G)', onclick: () => LR.App.setModule('library', 'grid') }, icon('grid'));
      this.btnLoupe = h('button.tb-btn', { title: 'Loupe View (E)', onclick: () => LR.App.setModule('library', 'loupe') }, icon('loupe'));
      this.sortWrap = h('span.tb-group', null, h('span.tb-text', { text: 'Sort:' }), sortSel, dirBtn);
      this.sizeWrap = h('span.tb-group', null, h('span.tb-text', { text: 'Thumbnails' }), size);
      this.toolbar = h('div.toolbar', null, this.btnGrid, this.btnLoupe, h('span.tb-sep'), this.sortWrap, h('span.tb-flex'), this.tbFlags, this.tbStars, h('span.tb-sep'), this.sizeWrap);
      LR.bus.on('meta', () => this.updateToolbar());
      LR.bus.on('active', () => this.updateToolbar());
    },
    updateToolbar() {
      const p = Catalog.active();
      LR.App.renderStars(this.tbStars, p);
      LR.App.renderFlags(this.tbFlags, p);
      this.btnGrid.classList.toggle('on', S.libView === 'grid');
      this.btnLoupe.classList.toggle('on', S.libView === 'loupe');
      this.sortWrap.style.display = S.libView === 'grid' ? '' : 'none';
      this.sizeWrap.style.display = S.libView === 'grid' ? '' : 'none';
    },

    /* ---------- grid ---------- */
    renderAll() {
      this.renderGrid();
      this.renderCatalogPanel();
      this.renderMeta();
      this.updateNavigator();
      LR.bus.emit('visible-changed');
    },
    renderGrid() {
      const list = Catalog.visible();
      const g = this.grid;
      const scroll = this.gridWrap.scrollTop;
      g.innerHTML = '';
      this.empty.style.display = list.length ? 'none' : '';
      if (!list.length && S.photos.length) {
        this.empty.querySelector('.empty-title').textContent = 'No photos match the current filter';
      } else this.empty.querySelector('.empty-title').textContent = 'No photos here yet';
      const frag = document.createDocumentFragment();
      list.forEach((p, i) => frag.appendChild(this.cell(p, i + 1)));
      g.appendChild(frag);
      this.gridWrap.scrollTop = scroll;
      this.updateSelection();
    },
    cell(p, idx) {
      const url = Catalog.thumbURL(p.id);
      const img = h('img', { alt: '', draggable: false });
      if (url) img.src = url;
      const stars = h('div.cell-stars');
      for (let i = 1; i <= 5; i++) {
        stars.appendChild(h('span.cstar' + (i <= p.rating ? '.on' : ''), {
          text: i <= p.rating ? '■' : '□',
          onclick: (e) => { e.stopPropagation(); if (!S.selected.has(p.id)) Catalog.clickSelect(p.id, null); Catalog.setRating(p.rating === i ? 0 : i); },
        }));
      }
      const flag = h('span.cell-flag' + (p.flag === 1 ? '.pick' : p.flag === -1 ? '.reject' : ''), {
        title: 'Flag (P / X / U)',
        onclick: (e) => { e.stopPropagation(); if (!S.selected.has(p.id)) Catalog.clickSelect(p.id, null); Catalog.setFlag(p.flag === 1 ? 0 : 1); },
      }, icon(p.flag === -1 ? 'reject' : 'flag'));
      const badges = h('div.cell-badges', null,
        p.edited ? h('span.badge', { title: 'Develop adjustments applied' }, icon('edited')) : null,
        p.settings.crop || p.settings.angle ? h('span.badge', { title: 'Cropped' }, icon('crop')) : null,
        (p.keywords || []).length ? h('span.badge.kw', { title: p.keywords.join(', '), text: 'K' }) : null,
        p.quick ? h('span.badge.quick', { title: 'In Quick Collection', text: '●' }) : null);
      const el = h('div.cell' + (p.label ? '.label-' + p.label : '') + (p.flag === -1 ? '.rejected' : '') + (p.virtualCopy ? '.vc' : ''), { dataset: { id: p.id }, draggable: true },
        h('div.cell-index', { text: String(idx) }),
        h('div.cell-top', null, flag, h('span.cell-name', { text: p.name })),
        h('div.cell-img', null, img),
        h('div.cell-bottom', null, stars, badges));
      el.addEventListener('click', (e) => { Catalog.clickSelect(p.id, e); this.grid.focus({ preventScroll: true }); });
      el.addEventListener('dblclick', () => { Catalog.setActive(p.id); LR.App.setModule('library', 'loupe'); });
      el.addEventListener('dragstart', (e) => {
        if (!S.selected.has(p.id)) Catalog.clickSelect(p.id, null);
        e.dataTransfer.setData('text/x-lr-photos', JSON.stringify([...S.selected]));
        e.dataTransfer.effectAllowed = 'copy';
      });
      return el;
    },
    updateSelection() {
      LR.UI.$$('.cell', this.grid).forEach((c) => {
        c.classList.toggle('selected', S.selected.has(c.dataset.id));
        c.classList.toggle('active', S.activeId === c.dataset.id);
      });
      const a = this.grid.querySelector('.cell.active');
      if (a && S.module === 'library' && S.libView === 'grid') {
        const r = a.getBoundingClientRect(), w = this.gridWrap.getBoundingClientRect();
        if (r.top < w.top || r.bottom > w.bottom) a.scrollIntoView({ block: 'nearest' });
      }
      this.updateToolbar();
    },
    updateThumb(id) {
      const url = Catalog.thumbURL(id);
      const c = this.grid.querySelector(`.cell[data-id="${id}"] img`);
      if (c && url) c.src = url;
      if (id === S.activeId) this.updateNavigator();
    },
    columns() {
      const cells = this.grid.querySelectorAll('.cell');
      if (cells.length < 2) return 1;
      const top = cells[0].offsetTop;
      let n = 0;
      for (const c of cells) { if (c.offsetTop !== top) break; n++; }
      return n || 1;
    },
    cellMenu(x, y) {
      const items = [
        { label: 'Open in Loupe', shortcut: 'E', action: () => LR.App.setModule('library', 'loupe') },
        { label: 'Edit in Develop', shortcut: 'D', action: () => LR.App.setModule('develop') },
        '-',
        { label: 'Set Pick Flag', shortcut: 'P', action: () => Catalog.setFlag(1) },
        { label: 'Set Rejected', shortcut: 'X', action: () => Catalog.setFlag(-1) },
        { label: 'Remove Flag', shortcut: 'U', action: () => Catalog.setFlag(0) },
        '-',
        { label: 'Add to Quick Collection', shortcut: 'B', action: () => Catalog.toggleQuick() },
        ...S.collections.map((c) => ({ label: 'Add to "' + c.name + '"', action: () => Catalog.addToCollection(c.id) })),
        S.source.type === 'collection' ? { label: 'Remove from this Collection', action: () => Catalog.removeFromCollection(S.source.id) } : null,
        { label: 'New Collection from Selection…', action: () => Catalog.newCollection(true) },
        '-',
        { label: 'Create Virtual Copy', shortcut: 'Ctrl+\'', action: () => Catalog.virtualCopy() },
        { label: 'Copy Settings…', shortcut: 'Ctrl+Shift+C', action: () => Catalog.copySettings(true) },
        { label: 'Paste Settings', shortcut: 'Ctrl+Shift+V', action: () => Catalog.pasteSettings(), disabled: !S.clipboard },
        { label: 'Sync Settings…', action: () => Catalog.syncSettings() },
        { label: 'Reset Settings', action: () => Catalog.resetSettings() },
        '-',
        { label: 'Export…', shortcut: 'Ctrl+Shift+E', action: () => LR.Export.open() },
        { label: 'Remove from Catalog', shortcut: 'Del', action: () => Catalog.removePhotos() },
      ].filter(Boolean);
      LR.UI.menu(x, y, items);
    },
    onShow() {
      this.histoSlot.appendChild(this.histogram.el);
      this.renderAll();
      this.updateToolbar();
    },
  };
  LR.Library = Library;
  LR.LABEL_COLORS = LABEL_COLORS;
})();
