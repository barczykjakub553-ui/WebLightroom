/* WebLightroom — catalog: photos, selection, filtering, import, thumbnails, collections. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { DB, Settings, UI } = LR;
  const bus = () => LR.bus;

  const state = (LR.state = {
    module: 'library',
    libView: 'grid',
    photos: [],
    byId: new Map(),
    selected: new Set(),
    activeId: null,
    source: { type: 'all' },
    filter: { text: '', flag: 'all', rating: 0, ratingOp: '>=', label: 'all', mode: 'none' },
    sort: { key: 'captureTime', dir: 1 },
    collections: [],
    userPresets: [],
    lastImport: null,
    thumbSize: 170,
    clipboard: null,
  });

  const THUMB_LONG = 480;
  const thumbURLs = new Map();
  const thumbQueue = [];
  let thumbBusy = false;
  let thumbEngine = null;

  function newPhotoRecord(o) {
    const s = Settings.defaults();
    return Object.assign({
      id: UI.uid(), blobId: null, name: '', size: 0, type: '', width: 0, height: 0,
      importedAt: Date.now(), captureTime: Date.now(), exif: {},
      rating: 0, flag: 0, label: '', keywords: [], title: '', caption: '',
      settings: s, history: [{ label: 'Import', settings: Settings.clone(s), time: Date.now() }], hIndex: 0,
      snapshots: [], virtualCopy: false, copyName: '', quick: false, importBatch: null, edited: false,
    }, o);
  }

  async function load() {
    const photos = await DB.all('photos');
    photos.forEach((p) => { p.settings = Settings.normalize(p.settings); });
    state.photos = photos;
    state.byId = new Map(photos.map((p) => [p.id, p]));
    state.collections = await DB.getKV('collections', []);
    state.userPresets = await DB.getKV('presets', []);
    state.lastImport = await DB.getKV('lastImport', null);
    const prefs = await DB.getKV('prefs', {});
    if (prefs.sort) state.sort = prefs.sort;
    if (prefs.thumbSize) state.thumbSize = prefs.thumbSize;
    if (prefs.activeId && state.byId.has(prefs.activeId)) state.activeId = prefs.activeId;
    if (prefs.source) state.source = prefs.source;
    const v = visible();
    if (!state.activeId && v.length) state.activeId = v[0].id;
    if (state.activeId) state.selected = new Set([state.activeId]);
  }
  const savePrefs = UI.debounce(() => {
    DB.setKV('prefs', { sort: state.sort, thumbSize: state.thumbSize, activeId: state.activeId, source: state.source });
  }, 500);

  /* ---------- views ---------- */
  function sourcePhotos() {
    const s = state.source;
    if (s.type === 'quick') return state.photos.filter((p) => p.quick);
    if (s.type === 'import') return state.photos.filter((p) => p.importBatch && p.importBatch === state.lastImport);
    if (s.type === 'collection') {
      const c = state.collections.find((c) => c.id === s.id);
      if (!c) return [];
      const ids = new Set(c.ids);
      return state.photos.filter((p) => ids.has(p.id));
    }
    return state.photos;
  }
  function sourceName() {
    const s = state.source;
    if (s.type === 'quick') return 'Quick Collection';
    if (s.type === 'import') return 'Previous Import';
    if (s.type === 'collection') {
      const c = state.collections.find((c) => c.id === s.id);
      return c ? 'Collection: ' + c.name : 'Collection';
    }
    return 'All Photographs';
  }
  function passesFilter(p) {
    const f = state.filter;
    if (f.text) {
      const t = f.text.toLowerCase();
      const hay = [p.name, p.title, p.caption, p.copyName, (p.keywords || []).join(' '), p.exif.model, p.exif.lensModel].join(' ').toLowerCase();
      if (!hay.includes(t)) return false;
    }
    if (f.flag === 'picked' && p.flag !== 1) return false;
    if (f.flag === 'unflagged' && p.flag !== 0) return false;
    if (f.flag === 'rejected' && p.flag !== -1) return false;
    if (f.flag === 'notrejected' && p.flag === -1) return false;
    if (f.rating > 0) {
      if (f.ratingOp === '>=' && p.rating < f.rating) return false;
      if (f.ratingOp === '<=' && p.rating > f.rating) return false;
      if (f.ratingOp === '=' && p.rating !== f.rating) return false;
    }
    if (f.label !== 'all') {
      if (f.label === 'none' ? p.label : p.label !== f.label) return false;
    }
    if (f.edited === 'edited' && !p.edited) return false;
    if (f.edited === 'unedited' && p.edited) return false;
    return true;
  }
  function visible() {
    const k = state.sort.key, d = state.sort.dir;
    const list = sourcePhotos().filter(passesFilter);
    list.sort((a, b) => {
      let va = a[k], vb = b[k];
      if (k === 'name') { va = (a.name + a.copyName).toLowerCase(); vb = (b.name + b.copyName).toLowerCase(); }
      if (va < vb) return -d;
      if (va > vb) return d;
      return a.importedAt - b.importedAt || (a.id < b.id ? -1 : 1);
    });
    return list;
  }
  function active() { return state.activeId ? state.byId.get(state.activeId) : null; }
  /** Photos targeted by commands: selection (if active is part of it) or just active */
  function targets() {
    const sel = [...state.selected].map((id) => state.byId.get(id)).filter(Boolean);
    if (sel.length) return sel;
    const a = active();
    return a ? [a] : [];
  }

  function setActive(id, keepSelection) {
    if (!state.byId.has(id)) return;
    state.activeId = id;
    if (!keepSelection) state.selected = new Set([id]);
    else state.selected.add(id);
    savePrefs();
    bus().emit('active');
    bus().emit('selection');
  }
  function clickSelect(id, e) {
    const list = visible().map((p) => p.id);
    if (e && (e.ctrlKey || e.metaKey)) {
      if (state.selected.has(id) && state.selected.size > 1) {
        state.selected.delete(id);
        if (state.activeId === id) state.activeId = [...state.selected][0];
      } else { state.selected.add(id); state.activeId = id; }
    } else if (e && e.shiftKey && state.activeId) {
      const a = list.indexOf(state.activeId), b = list.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        state.selected = new Set(list.slice(lo, hi + 1));
      }
    } else {
      state.activeId = id;
      state.selected = new Set([id]);
    }
    savePrefs();
    bus().emit('active');
    bus().emit('selection');
  }
  function selectAll() {
    state.selected = new Set(visible().map((p) => p.id));
    bus().emit('selection');
  }
  function selectNone() {
    state.selected = new Set(state.activeId ? [state.activeId] : []);
    bus().emit('selection');
  }
  function step(dir, extend) {
    const list = visible();
    if (!list.length) return;
    let i = list.findIndex((p) => p.id === state.activeId);
    i = UI.clamp(i + dir, 0, list.length - 1);
    if (extend) setActive(list[i].id, true);
    else setActive(list[i].id);
  }

  /* ---------- metadata commands ---------- */
  function save(p) { DB.savePhoto(p); }
  function setRating(r) {
    const t = targets();
    t.forEach((p) => { p.rating = r; save(p); });
    UI.hud(r ? 'Set Rating to ' + r + (r > 1 ? ' Stars' : ' Star') : 'Rating Removed');
    bus().emit('meta');
  }
  function setFlag(f) {
    const t = targets();
    t.forEach((p) => { p.flag = f; save(p); });
    UI.hud(f === 1 ? 'Flag as Pick' : f === -1 ? 'Flag as Rejected' : 'Remove Flag');
    bus().emit('meta');
  }
  function setLabel(l) {
    const t = targets();
    const toggle = t.length && t.every((p) => p.label === l);
    t.forEach((p) => { p.label = toggle ? '' : l; save(p); });
    UI.hud(toggle || !l ? 'Color Label: None' : 'Color Label: ' + l[0].toUpperCase() + l.slice(1));
    bus().emit('meta');
  }
  function toggleQuick() {
    const t = targets();
    const add = !t.every((p) => p.quick);
    t.forEach((p) => { p.quick = add; save(p); });
    UI.hud(add ? 'Added to Quick Collection' : 'Removed from Quick Collection');
    bus().emit('meta');
    bus().emit('photos');
  }

  /* ---------- import ---------- */
  const ACCEPT = /^image\/(jpeg|png|webp|gif|bmp|avif)$/;
  async function importFiles(files) {
    files = [...files].filter((f) => ACCEPT.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
    if (!files.length) { UI.toast('No supported images (JPEG, PNG, WebP, AVIF, GIF, BMP)'); return; }
    const batch = UI.uid();
    let firstId = null, n = 0;
    LR.bus.emit('progress', { label: 'Importing', done: 0, total: files.length });
    for (const f of files) {
      try {
        const bmp = await createImageBitmap(f);
        const exif = /jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name) ? await LR.Exif.read(f) : {};
        const blobId = UI.uid();
        await DB.put('blobs', { id: blobId, blob: f });
        const capture = LR.Exif.parseDate(exif.dateTimeOriginal || exif.dateTime) || f.lastModified || Date.now();
        const p = newPhotoRecord({ blobId, name: f.name, size: f.size, type: f.type, width: bmp.width, height: bmp.height, exif, captureTime: capture, importBatch: batch });
        bmp.close();
        state.photos.push(p);
        state.byId.set(p.id, p);
        await DB.put('photos', p);
        if (!firstId) firstId = p.id;
        queueThumb(p.id);
      } catch (e) {
        console.error('Import failed', f.name, e);
        UI.toast('Could not import ' + f.name);
      }
      n++;
      LR.bus.emit('progress', { label: 'Importing', done: n, total: files.length });
    }
    state.lastImport = batch;
    DB.setKV('lastImport', batch);
    if (firstId) {
      if (state.source.type === 'collection') state.source = { type: 'all' };
      state.activeId = firstId;
      state.selected = new Set([firstId]);
    }
    bus().emit('photos');
    bus().emit('active');
    bus().emit('selection');
    UI.toast('Imported ' + n + ' photo' + (n === 1 ? '' : 's'));
  }

  /* ---------- thumbnails ---------- */
  function getThumbEngine() {
    if (!thumbEngine) {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      thumbEngine = new LR.Engine(c);
    }
    return thumbEngine;
  }
  async function getBlob(p) {
    const r = await DB.get('blobs', p.blobId);
    return r && r.blob;
  }
  const bitmapCache = new Map();
  /** Decoded source scaled to fit maxLong (cached, keyed per blob+size). */
  async function getBitmap(p, maxLong) {
    const key = p.blobId + ':' + maxLong;
    if (bitmapCache.has(key)) {
      const v = bitmapCache.get(key);
      bitmapCache.delete(key);
      bitmapCache.set(key, v);
      return v;
    }
    const blob = await getBlob(p);
    if (!blob) throw new Error('Original file missing from catalog');
    const sc = Math.min(1, maxLong / Math.max(p.width, p.height));
    const opts = sc < 1 ? { resizeWidth: Math.max(1, Math.round(p.width * sc)), resizeHeight: Math.max(1, Math.round(p.height * sc)), resizeQuality: 'high' } : {};
    const prom = createImageBitmap(blob, opts);
    bitmapCache.set(key, prom);
    while (bitmapCache.size > 6) {
      const k = bitmapCache.keys().next().value;
      const old = bitmapCache.get(k);
      bitmapCache.delete(k);
      Promise.resolve(old).then((b) => b && b.close && b.close()).catch(() => {});
    }
    return prom;
  }
  function pixelsToCanvas(pixels, w, hh) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hh;
    const ctx = c.getContext('2d');
    const id = new ImageData(new Uint8ClampedArray(pixels.buffer), w, hh);
    ctx.putImageData(id, 0, 0);
    return c;
  }
  function queueThumb(id) {
    if (!thumbQueue.includes(id)) thumbQueue.push(id);
    pumpThumbs();
  }
  async function pumpThumbs() {
    if (thumbBusy) return;
    thumbBusy = true;
    while (thumbQueue.length) {
      const id = thumbQueue.shift();
      const p = state.byId.get(id);
      if (!p) continue;
      try {
        const eng = getThumbEngine();
        const src = await getBitmap(p, 1200);
        eng.setImage(src, Math.max(p.width, p.height));
        const r = eng.renderFit(p.settings, THUMB_LONG);
        const c = pixelsToCanvas(r.pixels, r.width, r.height);
        const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
        await DB.put('thumbs', { id, blob, w: r.width, h: r.height });
        setThumbURL(id, blob);
        bus().emit('thumb', id);
      } catch (e) {
        console.warn('thumb failed', e);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    thumbBusy = false;
  }
  function setThumbURL(id, blob) {
    const old = thumbURLs.get(id);
    if (old) URL.revokeObjectURL(old);
    thumbURLs.set(id, URL.createObjectURL(blob));
  }
  const thumbLoading = new Set();
  /** Returns cached URL, or null while loading (emits 'thumb' when ready). */
  function thumbURL(id) {
    if (thumbURLs.has(id)) return thumbURLs.get(id);
    if (!thumbLoading.has(id)) {
      thumbLoading.add(id);
      DB.get('thumbs', id).then((r) => {
        thumbLoading.delete(id);
        if (r) { setThumbURL(id, r.blob); bus().emit('thumb', id); }
        else queueThumb(id);
      });
    }
    return null;
  }
  const pendingThumbs = new Set();
  const flushThumbs = UI.debounce(() => { pendingThumbs.forEach(queueThumb); pendingThumbs.clear(); }, 700);
  function refreshThumb(id) { pendingThumbs.add(id); flushThumbs(); }

  /* ---------- settings helpers ---------- */
  function markEdited(p) {
    p.edited = !Settings.isDefault(p.settings);
  }
  function commitSettings(p, label, settings) {
    if (settings) p.settings = Settings.clone(settings);
    p.history = p.history.slice(0, p.hIndex + 1);
    p.history.push({ label, settings: Settings.clone(p.settings), time: Date.now() });
    if (p.history.length > 250) p.history.splice(1, p.history.length - 250);
    p.hIndex = p.history.length - 1;
    markEdited(p);
    save(p);
    refreshThumb(p.id);
    bus().emit('history', p);
  }

  /* ---------- groups for copy / paste / presets ---------- */
  const GROUPS = [
    ['wb', 'White Balance', ['temp', 'tint', 'wbMode']],
    ['treatment', 'Treatment & Profile', ['treatment', 'profile']],
    ['tone', 'Basic Tone', ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks']],
    ['presence', 'Presence', ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation']],
    ['curve', 'Tone Curve', ['curve', 'curveParam']],
    ['hsl', 'HSL / Color', ['hsl']],
    ['bw', 'B&W Mix', ['bw']],
    ['grading', 'Color Grading', ['grading']],
    ['sharpen', 'Sharpening', ['sharpen']],
    ['nr', 'Noise Reduction', ['nr']],
    ['lens', 'Lens Corrections', ['lens']],
    ['effects', 'Effects', ['vignette', 'grain']],
    ['crop', 'Crop & Rotate', ['crop', 'angle', 'orientation', 'flipH', 'flipV', 'aspect', 'aspectLocked']],
    ['masks', 'Masks', ['masks']],
  ];
  function pick(settings, groups) {
    const out = {};
    GROUPS.forEach(([k, , keys]) => { if (groups.includes(k)) keys.forEach((key) => { out[key] = Settings.clone(settings[key]); }); });
    return out;
  }
  async function chooseGroups(title, defaultsOff, extraTop) {
    const { h } = UI;
    const boxes = GROUPS.map(([k, l]) => {
      const cb = h('input', { type: 'checkbox', checked: !(defaultsOff || []).includes(k) });
      cb.dataset.k = k;
      return h('label.check', null, cb, ' ' + l);
    });
    const all = h('button.btn.small', { text: 'Check All', onclick: () => boxes.forEach((b) => (b.firstChild.checked = true)) });
    const none = h('button.btn.small', { text: 'Check None', onclick: () => boxes.forEach((b) => (b.firstChild.checked = false)) });
    const body = h('div', null, extraTop || null, h('div.check-grid', null, boxes), h('div.row-gap', null, all, none));
    const r = await UI.modal(title, body, [
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, value: () => boxes.filter((b) => b.firstChild.checked).map((b) => b.firstChild.dataset.k) },
    ], { width: 460 });
    return r;
  }

  async function copySettings(withDialog) {
    const p = active();
    if (!p) return;
    let groups = GROUPS.map((g) => g[0]).filter((g) => g !== 'crop' && g !== 'masks');
    if (withDialog) {
      const r = await chooseGroups('Copy Settings', ['crop', 'masks']);
      if (!r) return;
      groups = r;
    }
    state.clipboard = pick(p.settings, groups);
    UI.toast('Settings copied');
  }
  function pasteSettings() {
    if (!state.clipboard) { UI.toast('Nothing to paste'); return; }
    const t = targets();
    t.forEach((p) => {
      Settings.deepMerge(p.settings, Settings.clone(state.clipboard));
      if (state.clipboard.masks) p.settings.masks = Settings.clone(state.clipboard.masks).map((m) => Object.assign(m, { id: UI.uid() }));
      commitSettings(p, 'Paste Settings');
    });
    bus().emit('settings');
    UI.toast('Pasted settings to ' + t.length + ' photo' + (t.length > 1 ? 's' : ''));
  }
  async function syncSettings() {
    const p = active();
    const t = targets().filter((x) => x !== p);
    if (!p || !t.length) { UI.toast('Select more than one photo to sync'); return; }
    const r = await chooseGroups('Synchronize Settings', ['crop', 'masks']);
    if (!r) return;
    const part = pick(p.settings, r);
    t.forEach((x) => {
      Settings.deepMerge(x.settings, Settings.clone(part));
      commitSettings(x, 'Sync Settings');
    });
    bus().emit('settings');
    UI.toast('Synchronized ' + t.length + ' photo' + (t.length > 1 ? 's' : ''));
  }
  function resetSettings(list) {
    (list || targets()).forEach((p) => {
      p.settings = Settings.defaults();
      commitSettings(p, 'Reset Settings');
    });
    bus().emit('settings');
  }
  function applyPreset(preset, list) {
    (list || targets()).forEach((p) => {
      Settings.deepMerge(p.settings, Settings.clone(preset.settings));
      commitSettings(p, 'Preset: ' + preset.name);
    });
    bus().emit('settings');
  }
  async function newPreset() {
    const p = active();
    if (!p) return;
    const { h } = UI;
    const nameI = h('input.text', { type: 'text', value: 'My Preset' });
    const groups = [...new Set(state.userPresets.map((x) => x.group))].concat(['User Presets']);
    const groupI = h('input.text', { type: 'text', value: 'User Presets', list: 'preset-groups' });
    const dl = h('datalist#preset-groups', null, [...new Set(groups)].map((g) => h('option', { value: g })));
    const top = h('div', null, h('div.form-row', null, h('label', { text: 'Preset Name' }), nameI), h('div.form-row', null, h('label', { text: 'Group' }), groupI, dl));
    const r = await chooseGroups('New Develop Preset', ['crop', 'masks', 'wb'], top);
    if (!r) return;
    const preset = { id: UI.uid(), name: nameI.value.trim() || 'Preset', group: groupI.value.trim() || 'User Presets', settings: pick(p.settings, r) };
    state.userPresets.push(preset);
    await DB.setKV('presets', state.userPresets);
    bus().emit('presets');
    UI.toast('Preset "' + preset.name + '" created');
  }
  async function deletePreset(id) {
    state.userPresets = state.userPresets.filter((p) => p.id !== id);
    await DB.setKV('presets', state.userPresets);
    bus().emit('presets');
  }

  /* ---------- catalog editing ---------- */
  async function removePhotos(list) {
    list = list || targets();
    if (!list.length) return;
    const ok = await UI.confirm('Remove Photos', `Remove ${list.length} photo${list.length > 1 ? 's' : ''} from the catalog? Originals stored in this browser catalog will be deleted.`, 'Remove');
    if (!ok) return;
    const vis = visible();
    const idx = vis.findIndex((p) => p.id === state.activeId);
    const ids = new Set(list.map((p) => p.id));
    for (const p of list) {
      state.byId.delete(p.id);
      await DB.del('photos', p.id);
      await DB.del('thumbs', p.id);
      if (!state.photos.some((o) => o.blobId === p.blobId && !ids.has(o.id))) await DB.del('blobs', p.blobId);
    }
    state.photos = state.photos.filter((p) => !ids.has(p.id));
    state.collections.forEach((c) => { c.ids = c.ids.filter((i) => !ids.has(i)); });
    DB.setKV('collections', state.collections);
    const rest = vis.filter((p) => !ids.has(p.id));
    const next = rest[Math.min(idx, rest.length - 1)];
    state.activeId = next ? next.id : null;
    state.selected = new Set(next ? [next.id] : []);
    bus().emit('photos');
    bus().emit('active');
    bus().emit('selection');
  }
  function virtualCopy() {
    const p = active();
    if (!p) return;
    const n = state.photos.filter((o) => o.blobId === p.blobId).length;
    const c = newPhotoRecord(Object.assign(Settings.clone(p), { id: UI.uid(), virtualCopy: true, copyName: 'Copy ' + n, importedAt: p.importedAt + 1 }));
    c.history = [{ label: 'Virtual Copy', settings: Settings.clone(c.settings), time: Date.now() }];
    c.hIndex = 0;
    c.snapshots = [];
    state.photos.push(c);
    state.byId.set(c.id, c);
    DB.put('photos', c);
    queueThumb(c.id);
    state.activeId = c.id;
    state.selected = new Set([c.id]);
    bus().emit('photos');
    bus().emit('active');
    bus().emit('selection');
    UI.toast('Virtual copy created');
  }

  /* ---------- collections ---------- */
  async function newCollection(fromSelection) {
    const name = await UI.prompt('Create Collection', 'Name', 'Collection ' + (state.collections.length + 1));
    if (!name) return;
    const c = { id: UI.uid(), name, ids: fromSelection ? targets().map((p) => p.id) : [] };
    state.collections.push(c);
    await DB.setKV('collections', state.collections);
    bus().emit('collections');
  }
  async function renameCollection(id) {
    const c = state.collections.find((x) => x.id === id);
    const name = await UI.prompt('Rename Collection', 'Name', c.name);
    if (!name) return;
    c.name = name;
    await DB.setKV('collections', state.collections);
    bus().emit('collections');
  }
  async function deleteCollection(id) {
    const c = state.collections.find((x) => x.id === id);
    if (!(await UI.confirm('Delete Collection', `Delete collection "${c.name}"? Photos stay in the catalog.`, 'Delete'))) return;
    state.collections = state.collections.filter((x) => x.id !== id);
    if (state.source.type === 'collection' && state.source.id === id) state.source = { type: 'all' };
    await DB.setKV('collections', state.collections);
    bus().emit('collections');
    bus().emit('photos');
  }
  async function addToCollection(id, list) {
    const c = state.collections.find((x) => x.id === id);
    const ids = new Set(c.ids);
    (list || targets()).forEach((p) => ids.add(p.id));
    c.ids = [...ids];
    await DB.setKV('collections', state.collections);
    bus().emit('collections');
    UI.toast('Added to "' + c.name + '"');
  }
  async function removeFromCollection(id, list) {
    const c = state.collections.find((x) => x.id === id);
    const rm = new Set((list || targets()).map((p) => p.id));
    c.ids = c.ids.filter((i) => !rm.has(i));
    await DB.setKV('collections', state.collections);
    bus().emit('collections');
    bus().emit('photos');
  }
  function setSource(src) {
    state.source = src;
    const v = visible();
    if (!v.find((p) => p.id === state.activeId)) {
      state.activeId = v.length ? v[0].id : null;
      state.selected = new Set(state.activeId ? [state.activeId] : []);
      bus().emit('active');
    }
    savePrefs();
    bus().emit('photos');
  }

  /* ---------- sample images (procedural) ---------- */
  function rnd(seed) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  }
  function sampleLandscape() {
    const W = 3000, H = 2000, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d'), r = rnd(7);
    let g = x.createLinearGradient(0, 0, 0, H * 0.6);
    g.addColorStop(0, '#2b4a7a'); g.addColorStop(0.5, '#c97b5a'); g.addColorStop(1, '#f2c27b');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const sun = x.createRadialGradient(W * 0.62, H * 0.5, 10, W * 0.62, H * 0.5, 420);
    sun.addColorStop(0, 'rgba(255,250,220,1)'); sun.addColorStop(0.12, 'rgba(255,230,160,0.95)'); sun.addColorStop(1, 'rgba(255,200,120,0)');
    x.fillStyle = sun; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(255,${200 + r() * 40},${170 + r() * 50},${0.05 + r() * 0.08})`;
      x.beginPath(); x.ellipse(r() * W, r() * H * 0.35, 200 + r() * 400, 20 + r() * 40, 0, 0, 7); x.fill();
    }
    const layers = [['#6b5a7a', 0.47, 160], ['#4a3f5c', 0.52, 220], ['#2c2a3a', 0.58, 260], ['#1b2420', 0.64, 120]];
    layers.forEach(([col, base, amp], li) => {
      x.fillStyle = col;
      x.beginPath(); x.moveTo(0, H);
      let y = H * base;
      for (let px = 0; px <= W; px += 20) {
        y += (r() - 0.5) * amp * 0.25;
        y = Math.min(H * (base + 0.08), Math.max(H * (base - 0.12), y));
        x.lineTo(px, y + Math.sin(px / (300 + li * 90)) * amp * 0.4);
      }
      x.lineTo(W, H); x.fill();
    });
    // lake reflection
    x.save();
    x.globalAlpha = 0.55;
    x.translate(0, H * 1.36); x.scale(1, -0.32);
    x.drawImage(c, 0, 0, W, H * 0.66, 0, H * 0.0, W, H * 0.66);
    x.restore();
    g = x.createLinearGradient(0, H * 0.68, 0, H);
    g.addColorStop(0, 'rgba(30,40,60,0.2)'); g.addColorStop(1, 'rgba(10,15,20,0.85)');
    x.fillStyle = g; x.fillRect(0, H * 0.68, W, H * 0.32);
    // pines foreground
    for (let i = 0; i < 70; i++) {
      const px = r() * W, base = H * (0.72 + r() * 0.3), hh = 120 + r() * 380;
      x.fillStyle = `rgb(${10 + r() * 15},${20 + r() * 20},${15 + r() * 15})`;
      x.beginPath(); x.moveTo(px, base - hh); x.lineTo(px - hh * 0.22, base); x.lineTo(px + hh * 0.22, base); x.fill();
    }
    // noise
    const id = x.getImageData(0, 0, W, H), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(id, 0, 0);
    return c;
  }
  function sampleCity() {
    const W = 2400, H = 3000, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d'), r = rnd(42);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#060912'); g.addColorStop(0.6, '#172340'); g.addColorStop(1, '#30203a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const bw = 120 + r() * 260, bx = r() * W, bh = 700 + r() * 1700;
      x.fillStyle = `rgb(${12 + r() * 20},${14 + r() * 22},${24 + r() * 30})`;
      x.fillRect(bx, H - bh, bw, bh);
      for (let wy = H - bh + 30; wy < H - 40; wy += 46) for (let wx = bx + 14; wx < bx + bw - 20; wx += 34) {
        if (r() < 0.45) { x.fillStyle = r() < 0.7 ? `rgba(255,${190 + r() * 50},${110 + r() * 60},0.85)` : 'rgba(160,210,255,0.8)'; x.fillRect(wx, wy, 16, 22); }
      }
    }
    x.globalCompositeOperation = 'lighter';
    const cols = ['255,80,120', '255,180,60', '80,180,255', '200,100,255', '255,240,200'];
    for (let i = 0; i < 90; i++) {
      const bx = r() * W, by = H * (0.55 + r() * 0.45), rr = 30 + r() * 110;
      const gg = x.createRadialGradient(bx, by, 0, bx, by, rr);
      const col = cols[(r() * cols.length) | 0];
      gg.addColorStop(0, `rgba(${col},0.35)`); gg.addColorStop(0.85, `rgba(${col},0.22)`); gg.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = gg; x.beginPath(); x.arc(bx, by, rr, 0, 7); x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    const id = x.getImageData(0, 0, W, H), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 18; d[i] += n; d[i + 1] += n * 0.9; d[i + 2] += n * 1.2; }
    x.putImageData(id, 0, 0);
    return c;
  }
  async function importSamples() {
    const toFile = (c, name) => new Promise((res) => c.toBlob((b) => res(new File([b], name, { type: 'image/jpeg', lastModified: Date.now() })), 'image/jpeg', 0.92));
    UI.toast('Generating sample photos…');
    await new Promise((r) => setTimeout(r, 30));
    const files = [await toFile(sampleLandscape(), 'Sample_MountainLake.jpg'), await toFile(sampleCity(), 'Sample_CityNight.jpg')];
    await importFiles(files);
  }

  LR.Catalog = {
    load, visible, sourceName, active, targets, setActive, clickSelect, selectAll, selectNone, step,
    setRating, setFlag, setLabel, toggleQuick, importFiles, importSamples, getBlob, getBitmap, thumbURL, queueThumb, refreshThumb,
    commitSettings, markEdited, copySettings, pasteSettings, syncSettings, resetSettings, applyPreset, newPreset, deletePreset,
    removePhotos, virtualCopy, newCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection, setSource,
    savePrefs, save, pixelsToCanvas, GROUPS, pick,
  };
})();
