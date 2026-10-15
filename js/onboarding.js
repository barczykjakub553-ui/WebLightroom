/* Stopbath — first-run onboarding and the local user profile.
 *
 * There is no backend yet, so the profile lives in localStorage behind LR.Account.
 * When a real account service exists, only LR.Account.load/save/clear need to change.
 */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});
  const { h, icon } = LR.UI;

  /* ---------- profile store ---------- */
  const KEY = 'lr-profile';
  const Account = {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; }
    },
    save(profile) {
      localStorage.setItem(KEY, JSON.stringify(profile));
      LR.bus.emit('profile', profile);
      return profile;
    },
    clear() { localStorage.removeItem(KEY); LR.bus.emit('profile', null); },
    get onboarded() { return !!(Account.load() || {}).onboardedAt; },
    initials(p) {
      const n = ((p || Account.load() || {}).name || '').trim();
      if (!n) return '?';
      const parts = n.split(/\s+/);
      return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    },
  };

  /* ---------- options ---------- */
  const LEVELS = [
    ['beginner', 'Getting started', 'New to editing. Show me the essentials first.'],
    ['enthusiast', 'Enthusiast', 'I know my way around exposure, curves and color.'],
    ['pro', 'Professional', 'I edit for clients and need speed and consistency.'],
  ];
  // Each subject maps to preset groups in js/presets.js
  const SUBJECTS = [
    ['portrait', 'Portrait', ['Portrait', 'Film']],
    ['landscape', 'Landscape', ['Landscape', 'Seasons']],
    ['street', 'Street', ['Urban & Street', 'Black & White']],
    ['travel', 'Travel', ['Travel & Lifestyle', 'Landscape']],
    ['wedding', 'Wedding', ['Wedding', 'Portrait']],
    ['product', 'Food & Product', ['Food & Product']],
    ['film', 'Film look', ['Film', 'Vintage']],
    ['cinematic', 'Cinematic', ['Cinematic', 'Creative']],
  ];
  const STEPS = [
    ['welcome', 'Welcome'],
    ['profile', 'Profile'],
    ['work', 'Your work'],
    ['workspace', 'Workspace'],
    ['tour', 'Quick tour'],
    ['start', 'First roll'],
  ];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------- wizard ---------- */
  function show(opts) {
    opts = opts || {};
    const existing = Account.load() || {};
    const data = {
      name: existing.name || '',
      email: existing.email || '',
      level: existing.level || '',
      subjects: new Set(existing.subjects || []),
      libView: localStorage.getItem('lr-libview') || 'grid',
      filmstrip: !JSON.parse(localStorage.getItem('lr-hidden') || '{}').bottom,
    };
    let step = Math.max(0, STEPS.findIndex((s) => s[0] === opts.step));
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));

    const rail = h('ol.ob-rail');
    const stage = h('div.ob-stage');
    const counter = h('span.ob-count');
    const err = h('div.ob-error', { role: 'alert' });
    const backBtn = h('button.btn', { text: 'Back', onclick: () => go(step - 1) });
    const nextBtn = h('button.btn.primary', { onclick: () => next() });
    const skipBtn = h('button.btn.ob-skip', { text: opts.dismissible ? 'Close' : 'Skip setup', onclick: () => (opts.dismissible ? close(false) : finish(null)) });
    const bar = h('div.ob-bar', null, h('div.ob-bar-fill'));
    const root = h('div.overlay.onboard', { role: 'dialog', 'aria-modal': 'true', 'aria-label': LR.APP_NAME + ' setup' },
      h('div.ob-shell', null,
        h('aside.ob-side', null,
          h('div.brand', null, h('span.brand-mark'), h('span.brand-name', { text: LR.APP_NAME }), h('span.brand-tag', { text: 'LAB' })),
          rail,
          h('div.ob-side-foot', { text: 'Stored on this device only' })),
        h('main.ob-main', null, bar, stage, err,
          h('footer.ob-foot', null, skipBtn, h('span.ob-spacer'), counter, backBtn, nextBtn))));

    STEPS.forEach(([, label], i) => rail.append(h('li.ob-step', { dataset: { i } }, h('span.ob-step-n', { text: String(i + 1).padStart(2, '0') }), h('span.ob-step-l', { text: label }))));

    function onKey(e) {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); next(); }
      if (e.key === 'Escape' && opts.dismissible) close(false);
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);

    /* ----- step renderers ----- */
    const head = (kicker, title, sub) => h('header.ob-head', null, h('div.ob-kicker', { text: kicker }), h('h1.ob-title', { text: title }), sub ? h('p.ob-sub', { text: sub }) : null);

    function field(label, input, hint) {
      const id = 'ob-' + label.toLowerCase().replace(/\W+/g, '-');
      input.id = id;
      return h('div.ob-field', null, h('label', { for: id, text: label }), input, hint ? h('div.ob-hint', { text: hint }) : null);
    }

    const views = {
      welcome() {
        const point = (n, t, d) => h('li', null, h('span.ob-pt-n', { text: n }), h('div', null, h('strong', { text: t }), h('span', { text: d })));
        return h('div.ob-welcome', null,
          head('// ' + (existing.name ? 'Welcome back' : 'First run'), 'Develop in the dark.', `${LR.APP_NAME} is a non-destructive photo catalog and developer that runs entirely on your GPU, in the browser. Nothing is uploaded.`),
          h('ul.ob-points', null,
            point('01', 'Catalog', 'Rate, flag, label and collect your photos.'),
            point('02', 'Develop', 'Tone, curves, HSL, color grading, masks and crop — all live.'),
            point('03', 'Export', 'Full-resolution JPEG, PNG or WebP with your edits baked in.')),
          h('p.ob-note', { text: 'Setup takes about a minute. You can change everything later from the account menu.' }));
      },
      profile() {
        const name = h('input.text', { type: 'text', value: data.name, autocomplete: 'name', maxlength: 60, placeholder: 'e.g. Jakub Barczyk', oninput: () => { data.name = name.value; err.textContent = ''; } });
        const email = h('input.text', { type: 'email', value: data.email, autocomplete: 'email', maxlength: 120, placeholder: 'you@example.com', oninput: () => { data.email = email.value; err.textContent = ''; } });
        setTimeout(() => name.focus(), 30);
        return h('div', null,
          head('// Profile', 'Who is editing?', 'Your name appears in the top bar. You can change it anytime from the account menu.'),
          h('div.ob-form', null,
            field('Display name', name),
            field('Email (optional)', email, 'Used later to sync your catalog across devices. No account is created yet.')),
          h('div.ob-callout', null, icon('info'), h('span', { text: 'Cloud accounts are coming. Until then your profile, photos and edits stay in this browser.' })));
      },
      work() {
        const levels = h('div.ob-cards', { role: 'radiogroup', 'aria-label': 'Experience' }, LEVELS.map(([id, t, d]) => {
          const card = h('button.ob-card' + (data.level === id ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(data.level === id), onclick: () => {
            data.level = id; err.textContent = '';
            levels.querySelectorAll('.ob-card').forEach((c) => { c.classList.toggle('on', c === card); c.setAttribute('aria-checked', String(c === card)); });
          } }, h('strong', { text: t }), h('span', { text: d }));
          return card;
        }));
        const chips = h('div.ob-chips', null, SUBJECTS.map(([id, label]) => {
          const chip = h('button.ob-chip' + (data.subjects.has(id) ? '.on' : ''), { type: 'button', 'aria-pressed': String(data.subjects.has(id)), text: label, onclick: () => {
            data.subjects.has(id) ? data.subjects.delete(id) : data.subjects.add(id);
            chip.classList.toggle('on', data.subjects.has(id));
            chip.setAttribute('aria-pressed', String(data.subjects.has(id)));
          } });
          return chip;
        }));
        return h('div', null,
          head('// Your work', 'How do you edit?', 'We use this to suggest a starting point. It never limits what you can do.'),
          h('div.ob-label', { text: 'Experience' }), levels,
          h('div.ob-label', { text: 'What do you shoot?' }), chips);
      },
      workspace() {
        const opt = (group, value, label, desc, checked, onPick) => h('label.ob-radio' + (checked ? '.on' : ''), null,
          h('input', { type: 'radio', name: group, value, checked, onchange: () => { onPick(); stage.querySelectorAll(`input[name=${group}]`).forEach((i) => i.closest('.ob-radio').classList.toggle('on', i.checked)); } }),
          h('span.ob-radio-box'), h('div', null, h('strong', { text: label }), h('span', { text: desc })));
        return h('div', null,
          head('// Workspace', 'Set up your bench.', 'Pick how the Library opens. Both can be switched anytime with G and E.'),
          h('div.ob-label', { text: 'Library opens in' }),
          h('div.ob-radios', null,
            opt('libview', 'grid', 'Grid', 'Contact sheet of thumbnails — best for culling.', data.libView === 'grid', () => (data.libView = 'grid')),
            opt('libview', 'loupe', 'Loupe', 'One photo, large — best for reviewing.', data.libView === 'loupe', () => (data.libView = 'loupe'))),
          h('div.ob-label', { text: 'Filmstrip' }),
          h('div.ob-radios', null,
            opt('fs', 'on', 'Show filmstrip', 'Thumbnail strip along the bottom edge.', data.filmstrip, () => (data.filmstrip = true)),
            opt('fs', 'off', 'Hide filmstrip', 'More room for the photo. Toggle with the bottom edge.', !data.filmstrip, () => (data.filmstrip = false))));
      },
      tour() {
        const card = (n, title, desc, keys) => h('div.ob-tour-card', null,
          h('div.ob-tour-n', { text: n }), h('strong', { text: title }), h('p', { text: desc }),
          h('div.ob-keys', null, keys.map(([k, l]) => h('div', null, h('kbd', { text: k }), h('span', { text: l })))));
        const groups = [...new Set([...data.subjects].flatMap((id) => (SUBJECTS.find((s) => s[0] === id) || [, , []])[2]))].slice(0, 4);
        const beginner = data.level === 'beginner';
        return h('div', null,
          head('// Quick tour', 'Four things to know.', beginner ? 'Start in Basic: Exposure, Contrast, Highlights and Shadows fix most photos.' : 'Everything is keyboard-driven. Press ? anytime for the full list.'),
          h('div.ob-tour', null,
            card('01', 'Library', 'Import, rate and flag. Drag photos onto a collection.', [['G', 'Grid'], ['0–5', 'Rating'], ['P / X', 'Pick / Reject']]),
            card('02', 'Develop', 'Sliders update live on the GPU. Double-click a label to reset.', [['D', 'Develop'], ['\\', 'Before / After'], ['Ctrl+Z', 'Undo']]),
            card('03', 'Masks & crop', 'Local adjustments with linear and radial gradients.', [['R', 'Crop'], ['M', 'Linear mask'], ['Shift+M', 'Radial mask']]),
            card('04', 'Export', 'Full resolution with sizing, sharpening and watermark.', [['Ctrl+Shift+E', 'Export'], ['Ctrl+Shift+C', 'Copy edits']])),
          groups.length ? h('div.ob-suggest', null, h('span.ob-label', { text: 'Suggested preset groups' }),
            h('div.ob-chips.static', null, groups.map((g) => h('span.ob-chip.on', { text: g }))),
            h('div.ob-hint', { text: 'Find them in Develop › Presets. Hover a preset to preview it.' })) : null);
      },
      start() {
        const act = (ic, title, desc, fn, primary) => h('button.ob-action' + (primary ? '.primary' : ''), { type: 'button', onclick: fn }, icon(ic), h('div', null, h('strong', { text: title }), h('span', { text: desc })));
        return h('div', null,
          head('// First roll', `Ready${data.name.trim() ? ', ' + data.name.trim().split(/\s+/)[0] : ''}.`, 'Bring in your first photos. Camera RAW (CR2, CR3, NEF, ARW, DNG, RAF…), JPEG, PNG, WebP and AVIF are supported; you can also drop files anywhere in the window.'),
          h('div.ob-actions', null,
            act('import', 'Import photos…', 'Pick individual files from your disk.', () => finish('files'), true),
            act('stack', 'Import a folder…', 'Bring in a whole shoot at once.', () => finish('folder')),
            act('star', 'Try sample photos', 'Two generated scenes to experiment with.', () => finish('samples')),
            act('grid', 'Start with an empty catalog', 'Import later from File › Import.', () => finish(null))));
      },
    };

    /* ----- navigation ----- */
    function validate() {
      const id = STEPS[step][0];
      if (id === 'profile') {
        if (!data.name.trim()) return 'Enter a display name to continue.';
        if (data.email.trim() && !EMAIL_RE.test(data.email.trim())) return 'That email address doesn’t look right.';
      }
      if (id === 'work' && !data.level) return 'Choose your experience level.';
      return '';
    }
    function next() {
      if (STEPS[step][0] === 'start') return finish('files');
      if (opts.single) { const msg = validate(); if (msg) { err.textContent = msg; return; } return finish(null); }
      const msg = validate();
      if (msg) { err.textContent = msg; const bad = stage.querySelector('input'); if (bad && STEPS[step][0] === 'profile') bad.focus(); return; }
      go(step + 1);
    }
    function go(i) {
      // never skip past an invalid step when jumping forward through the rail
      for (let s = step; s < i; s++) { step = s; const msg = validate(); if (msg) { render(); err.textContent = msg; return; } }
      step = Math.max(0, Math.min(STEPS.length - 1, i));
      err.textContent = '';
      render();
    }
    function render() {
      const id = STEPS[step][0];
      stage.replaceChildren(views[id]());
      stage.classList.remove('enter'); void stage.offsetWidth; stage.classList.add('enter');
      rail.querySelectorAll('.ob-step').forEach((li, i) => {
        li.classList.toggle('on', i === step);
        li.classList.toggle('done', i < step);
        li.onclick = i < step ? () => go(i) : null;
      });
      counter.textContent = String(step + 1).padStart(2, '0') + ' / ' + String(STEPS.length).padStart(2, '0');
      bar.firstChild.style.width = ((step + 1) / STEPS.length) * 100 + '%';
      backBtn.style.visibility = step === 0 || opts.single ? 'hidden' : '';
      nextBtn.style.display = id === 'start' ? 'none' : '';
      nextBtn.textContent = opts.single ? 'Save' : id === 'welcome' ? 'Get started' : 'Continue';
      if (opts.single) rail.querySelectorAll('.ob-step').forEach((li) => { li.onclick = null; li.classList.remove('done'); });
      skipBtn.style.visibility = id === 'start' ? 'hidden' : '';
      const f = stage.querySelector('input.text');
      if (!f) setTimeout(() => nextBtn.focus({ preventScroll: true }), 30);
    }

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      root.classList.add('leaving');
      setTimeout(() => root.remove(), 180);
      resolveDone(result);
    }
    function finish(action) {
      const name = data.name.trim();
      Account.save(Object.assign({}, existing, {
        name: name || existing.name || '',
        email: EMAIL_RE.test(data.email.trim()) ? data.email.trim() : '',
        level: data.level || existing.level || '',
        subjects: [...data.subjects],
        onboardedAt: existing.onboardedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      localStorage.setItem('lr-libview', data.libView);
      const hidden = JSON.parse(localStorage.getItem('lr-hidden') || '{}');
      hidden.bottom = !data.filmstrip;
      localStorage.setItem('lr-hidden', JSON.stringify(hidden));
      close({ action, libView: data.libView, filmstrip: data.filmstrip });
    }

    render();
    return done;
  }

  LR.Account = Account;
  LR.Onboarding = { show };
})();
