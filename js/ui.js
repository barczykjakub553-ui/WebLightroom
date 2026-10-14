/* WebLightroom — UI helpers: DOM builder, sliders, panels, dialogs, menus, toasts, event bus. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});

  /* ---------- event bus ---------- */
  const handlers = {};
  LR.bus = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    emit(ev, ...a) { (handlers[ev] || []).slice().forEach((f) => f(...a)); },
  };

  /* ---------- DOM builder ---------- */
  function h(tag, props, ...children) {
    const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement(m[1] || 'div');
    (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => {
      if (t[0] === '.') el.classList.add(t.slice(1));
      else el.id = t.slice(1);
    });
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- icons (inline SVG) ---------- */
  const ICONS = {
    grid: '<path d="M3 3h5v5H3zM10 3h5v5h-5zM3 10h5v5H3zM10 10h5v5h-5z"/>',
    loupe: '<rect x="3" y="4" width="12" height="10" rx="1"/>',
    flag: '<path d="M5 2v14M5 3h8l-2 3 2 3H5"/>',
    reject: '<path d="M5 2v14M5 3h8l-2 3 2 3H5"/><path d="M10 11l5 5M15 11l-5 5"/>',
    star: '<path d="M9 2l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L9 12.8l-4.4 2.5 1.1-4.9L1.9 7.1l5-.5z"/>',
    crop: '<path d="M5 1v12h12M1 5h12v12"/>',
    mask: '<circle cx="9" cy="9" r="6"/><path d="M9 3a6 6 0 0 1 0 12z" fill="currentColor"/>',
    brushOff: '<path d="M3 15l5-5M10 3l5 5-6 6-5-5z"/>',
    picker: '<path d="M12.5 2.5l3 3-2 2-3-3zM10.5 4.5l3 3-7 7H3.5v-3z"/>',
    plus: '<path d="M9 3v12M3 9h12"/>',
    minus: '<path d="M3 9h12"/>',
    close: '<path d="M4 4l10 10M14 4L4 14"/>',
    rotL: '<path d="M4 8a5 5 0 1 1 1.5 5M4 3v5h5"/>',
    rotR: '<path d="M14 8a5 5 0 1 0-1.5 5M14 3v5H9"/>',
    flipH: '<path d="M9 2v14M7 4L2 14h5zM11 4l5 10h-5z"/>',
    flipV: '<path d="M2 9h14M4 7L14 2v5zM4 11l10 5v-5z"/>',
    lock: '<rect x="4" y="8" width="10" height="7" rx="1"/><path d="M6 8V5.5a3 3 0 0 1 6 0V8"/>',
    unlock: '<rect x="4" y="8" width="10" height="7" rx="1"/><path d="M6 8V5.5a3 3 0 0 1 6 0"/>',
    eye: '<path d="M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="9" cy="9" r="2.5"/>',
    linear: '<rect x="2" y="2" width="14" height="14" rx="1"/><path d="M2 7h14M2 11h14" stroke-dasharray="2 1.5"/>',
    radial: '<ellipse cx="9" cy="9" rx="7" ry="5"/><ellipse cx="9" cy="9" rx="3.5" ry="2.2"/>',
    trash: '<path d="M3 5h12M7 5V3h4v2M5 5l1 11h6l1-11"/>',
    import: '<path d="M9 2v9M5 7l4 4 4-4M3 13v3h12v-3"/>',
    export: '<path d="M9 12V3M5 7l4-4 4 4M3 13v3h12v-3"/>',
    beforeAfter: '<rect x="2" y="3" width="14" height="12" rx="1"/><path d="M9 3v12"/>',
    sort: '<path d="M5 3v12M2 12l3 3 3-3M13 15V3M10 6l3-3 3 3"/>',
    info: '<circle cx="9" cy="9" r="7"/><path d="M9 8v5M9 5.5v.5"/>',
    stack: '<rect x="5" y="2" width="11" height="9" rx="1"/><path d="M2 6v9h11"/>',
    edited: '<path d="M2 14h3l8-8-3-3-8 8zM11 4l3 3"/>',
  };
  function icon(name, cls) {
    const span = document.createElement('span');
    span.className = 'icon' + (cls ? ' ' + cls : '');
    span.innerHTML = `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return span;
  }

  /* ---------- slider ---------- */
  function slider(o) {
    const step = o.step || 1;
    const fmt = o.fmt || ((v) => (step < 1 ? (v > 0 && o.signed !== false && o.min < 0 ? '+' : '') + v.toFixed(step < 0.1 ? 2 : 1) : (v > 0 && o.min < 0 ? '+' : '') + Math.round(v)));
    const track = h('div.sl-track');
    if (o.gradient) track.style.background = o.gradient;
    const fill = h('div.sl-fill');
    const thumb = h('div.sl-thumb');
    track.append(fill, thumb);
    const valEl = h('input.sl-val', { type: 'text', spellcheck: false });
    const lab = h('label.sl-label', { text: o.label, title: 'Double-click to reset' });
    const row = h('div.sl-row' + (o.cls ? '.' + o.cls : ''), null, lab, h('div.sl-trackwrap', null, track), valEl);
    let value = o.value != null ? o.value : o.def;
    let start = null;

    function pos(v) { return (v - o.min) / (o.max - o.min); }
    function render() {
      const p = clamp(pos(value), 0, 1);
      thumb.style.left = p * 100 + '%';
      const z = clamp(pos(o.min < 0 ? 0 : o.min), 0, 1);
      fill.style.left = Math.min(p, z) * 100 + '%';
      fill.style.width = Math.abs(p - z) * 100 + '%';
      fill.style.display = o.gradient ? 'none' : '';
      if (document.activeElement !== valEl) valEl.value = fmt(value);
      row.classList.toggle('changed', Math.abs(value - o.def) > 1e-9);
    }
    function quant(v) {
      v = clamp(v, o.min, o.max);
      return Math.round(v / step) * step;
    }
    function set(v, commit) {
      v = quant(v);
      if (v === value && !commit) return;
      value = v;
      render();
      if (o.onInput) o.onInput(value);
      if (commit && o.onCommit) o.onCommit(value);
    }
    function fromEvent(e) {
      const r = track.getBoundingClientRect();
      return o.min + clamp((e.clientX - r.left) / r.width, 0, 1) * (o.max - o.min);
    }
    const wrap = row.querySelector('.sl-trackwrap');
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      start = { x: e.clientX, v: value };
      if (e.target !== thumb) set(fromEvent(e));
      row.classList.add('active');
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (e.shiftKey) {
        // fine adjustment: 1/10th of the pointer movement
        const r = track.getBoundingClientRect();
        set(start.v + ((e.clientX - start.x) / r.width) * (o.max - o.min) * 0.1);
      } else set(fromEvent(e));
    });
    const end = () => {
      if (!start) return;
      start = null;
      row.classList.remove('active');
      if (o.onCommit) o.onCommit(value);
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    const reset = () => { set(o.def, true); };
    lab.addEventListener('dblclick', reset);
    thumb.addEventListener('dblclick', reset);
    valEl.addEventListener('focus', () => valEl.select());
    valEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') valEl.blur();
      if (e.key === 'Escape') { valEl.value = fmt(value); valEl.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
        set(value + d, true);
        valEl.value = fmt(value);
        valEl.select();
      }
    });
    valEl.addEventListener('blur', () => {
      const v = parseFloat(valEl.value.replace(',', '.'));
      if (!isNaN(v) && quant(v) !== value) set(v, true);
      valEl.value = fmt(value);
    });
    row.addEventListener('wheel', (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      set(value + (e.deltaY < 0 ? step : -step), true);
    }, { passive: false });
    render();
    row.set = (v) => { value = v == null ? o.def : v; render(); };
    row.get = () => value;
    row.path = o.path;
    return row;
  }

  /* ---------- collapsible panel ---------- */
  const panelState = JSON.parse(localStorage.getItem('lr-panels') || '{}');
  function panel(title, content, opts) {
    opts = opts || {};
    const key = opts.key || title;
    const collapsed = key in panelState ? panelState[key] : !!opts.collapsed;
    const head = h('div.panel-head', null, h('span.panel-title', { text: title }), opts.headExtra || null, h('span.panel-tri'));
    const body = h('div.panel-body', null, content);
    const el = h('section.panel' + (collapsed ? '.collapsed' : ''), { dataset: { key } }, head, body);
    head.addEventListener('click', (e) => {
      if (e.target.closest('.panel-head-extra')) return;
      if (e.altKey || opts.solo) {
        // solo mode: collapse siblings
        el.parentElement.querySelectorAll(':scope > .panel').forEach((p) => {
          if (p !== el) { p.classList.add('collapsed'); panelState[p.dataset.key] = true; }
        });
      }
      el.classList.toggle('collapsed');
      panelState[key] = el.classList.contains('collapsed');
      localStorage.setItem('lr-panels', JSON.stringify(panelState));
      LR.bus.emit('panel-toggle', key);
    });
    el.body = body;
    return el;
  }

  /* ---------- toast ---------- */
  let toastEl, toastTimer;
  function toast(msg, ms) {
    if (!toastEl) { toastEl = h('div.toast'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 1600);
  }
  /** Large centered overlay message like Lightroom's "Rating set to 3". */
  let hudEl, hudTimer;
  function hud(msg) {
    if (!hudEl) { hudEl = h('div.hud'); document.body.appendChild(hudEl); }
    hudEl.textContent = msg;
    hudEl.classList.add('show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hudEl.classList.remove('show'), 900);
  }

  /* ---------- modal dialog ---------- */
  function modal(title, body, buttons, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const close = (v) => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
      const btns = (buttons || [{ label: 'OK', value: true, primary: true }]).map((b) =>
        h('button.btn' + (b.primary ? '.primary' : ''), {
          text: b.label,
          onclick: () => {
            if (b.validate && !b.validate()) return;
            close(typeof b.value === 'function' ? b.value() : b.value);
          },
        })
      );
      const dlg = h('div.dialog', { style: opts.width ? { width: opts.width + 'px' } : null }, h('div.dialog-title', { text: title }), h('div.dialog-body', null, body), h('div.dialog-buttons', null, btns));
      const ov = h('div.overlay', null, dlg);
      ov.addEventListener('pointerdown', (e) => { if (e.target === ov && !opts.noDismiss) close(null); });
      function onKey(e) {
        e.stopPropagation();
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
          const prim = buttons ? buttons.findIndex((b) => b.primary) : 0;
          if (prim >= 0) btns[prim].click();
        }
      }
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(ov);
      const f = dlg.querySelector('input,select,textarea');
      if (f) setTimeout(() => f.focus(), 30);
    });
  }
  async function prompt(title, labelText, value) {
    const inp = h('input.text', { type: 'text', value: value || '' });
    const r = await modal(title, h('div.form-row', null, h('label', { text: labelText }), inp), [
      { label: 'Cancel', value: null },
      { label: 'OK', value: () => inp.value.trim() || null, primary: true },
    ]);
    return r;
  }
  async function confirm(title, text, okLabel) {
    return modal(title, h('p', { text }), [
      { label: 'Cancel', value: false },
      { label: okLabel || 'OK', value: true, primary: true },
    ]);
  }

  /* ---------- context menu ---------- */
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function menu(x, y, items) {
    closeMenu();
    menuEl = h('div.ctxmenu', null, items.map((it) => {
      if (it === '-') return h('div.ctx-sep');
      const el = h('div.ctx-item' + (it.disabled ? '.disabled' : ''), null, h('span', { text: it.label }), it.shortcut ? h('span.ctx-key', { text: it.shortcut }) : null);
      if (!it.disabled) el.addEventListener('click', () => { closeMenu(); it.action(); });
      return el;
    }));
    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
    menuEl.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  }
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

  /** Select dropdown helper */
  function select(options, value, onChange, cls) {
    const s = h('select' + (cls ? '.' + cls : ''), { onchange: () => onChange(s.value) }, options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, text: l });
    }));
    s.value = value;
    return s;
  }

  function throttleRAF(fn) {
    let queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(); });
    };
  }
  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  LR.UI = { h, append, $, $$, clamp, icon, slider, panel, toast, hud, modal, prompt, confirm, menu, closeMenu, select, throttleRAF, debounce, uid, fmtBytes, isTyping };
})();
