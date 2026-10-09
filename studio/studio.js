import { createHost } from './host.js';
import {
  ENUMS, LIMITS, EFFECT_FIELDS, PARTICLE_FIELDS, CREATURE_FIELDS, BACKDROP_FIELDS, EXAMPLE_PROMPTS,
  getPath, setPath, parseControlValue, formatValue, defaultRecipe, addItem, removeItem, canAdd,
  addColor, removeColor, changeKind, effectiveRecipe, mergeGenerated, wantsCode, fileNameFromUrl,
  joinUrl, swatchBackground, errorText, debounce, modelOptions, sortScenes, clone, LIGHT_DEFAULTS,
} from './model.js';

const $ = (sel, root = document) => root.querySelector(sel);
const DEFAULT_GRADIENT = ['#0f3b4a', '#061820'];
const DEFAULT_TINT = '#ffd9a0';
const PREVIEW_SRC = '../scenes/studio/wallpaper.html?preview=1';

const host = createHost({ notify: (text) => toast(text) });
const state = {
  view: 'library',
  settings: null,
  ed: null, // the open editor session
  previewReady: false,
  depthWarned: false,
};

// ---------- DOM helpers ----------
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'open']);
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const late = [];
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) late.push([k, v]);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, v] of late) node[k] = v;
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}
const fid = (path) => `f-${String(path).replace(/[^a-z0-9]+/gi, '-')}`;
const title = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// ---------- Toasts ----------
function toast(text, { error = false } = {}) {
  const box = $('#toasts');
  const close = h('button', { type: 'button', 'aria-label': 'Dismiss', text: '✕' });
  const node = h('div', { class: `toast${error ? ' error' : ''}`, role: error ? 'alert' : 'status' }, h('span', { class: 'toast-text', text }), close);
  const remove = () => node.remove();
  close.addEventListener('click', remove);
  box.append(node);
  while (box.children.length > 4) box.firstElementChild.remove();
  setTimeout(remove, error ? 9000 : 5000);
}
const fail = (e) => toast(errorText(e), { error: true });

// ---------- Confirm dialog ----------
function confirmDialog({ heading, text, ok = 'OK', cancel = 'Cancel' }) {
  const dlg = $('#confirm-dialog');
  $('#confirm-title').textContent = heading;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = ok;
  $('#confirm-cancel').textContent = cancel;
  dlg.returnValue = 'cancel';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    $('#confirm-cancel').focus();
  });
}

// ---------- Settings / API key ----------
async function refreshSettings() {
  try {
    state.settings = await host.call('getSettings');
  } catch (e) {
    fail(e);
    state.settings = state.settings ?? { hasApiKey: false, model: '', models: [] };
  }
  renderKeyStates();
  return state.settings;
}

const keyForms = [];
function buildKeyForm(container, { compact = false } = {}) {
  container.replaceChildren($('#key-template').content.cloneNode(true));
  const n = keyForms.length + 1;
  const input = container.querySelector('[data-role="input"]');
  const label = container.querySelector('[data-role="label"]');
  const save = container.querySelector('[data-role="save"]');
  const clear = container.querySelector('[data-role="clear"]');
  const stateEl = container.querySelector('[data-role="state"]');
  input.id = `api-key-${n}`;
  label.htmlFor = input.id;
  save.setAttribute('aria-label', 'Save API key');
  clear.setAttribute('aria-label', 'Clear saved API key');
  if (compact) container.querySelector('[data-role="intro"]').textContent =
    'Claude needs your Anthropic API key to create scenes from words. It costs a few cents per scene, billed to your Anthropic account. Get a key at console.anthropic.com → API keys.';
  const sync = () => { save.disabled = input.value.trim() === ''; };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
  save.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) return;
    save.disabled = true;
    try {
      await host.call('setApiKey', { key });
      input.value = '';
      await refreshSettings();
      toast('Key saved.');
    } catch (e) { fail(e); } finally { sync(); }
  });
  clear.addEventListener('click', async () => {
    const ok = await confirmDialog({ heading: 'Clear the API key?', text: 'Creating scenes from words will stop working until you add a key again.', ok: 'Clear key' });
    if (!ok) return;
    try {
      await host.call('setApiKey', { key: '' });
      await refreshSettings();
      toast('Key cleared.');
    } catch (e) { fail(e); }
  });
  sync();
  const form = { container, input, clear, stateEl };
  keyForms.push(form);
  return form;
}

function renderKeyStates() {
  const has = Boolean(state.settings?.hasApiKey);
  for (const f of keyForms) {
    f.stateEl.textContent = has ? 'Key saved. Paste a new one to replace it.' : 'No key yet.';
    f.stateEl.classList.toggle('saved', has);
    f.clear.disabled = !has;
  }
  $('#describe-key').hidden = has;
}

async function openSettings() {
  const dlg = $('#settings-dialog');
  dlg.showModal();
  const s = await refreshSettings();
  const select = $('#model-select');
  const options = modelOptions(s.models);
  select.replaceChildren(...(options.length
    ? options.map((o) => h('option', { value: o.id, text: o.label, selected: o.id === s.model }))
    : [h('option', { value: '', text: 'No models available' })]));
  select.disabled = !options.length;
  $('#model-state').textContent = '';
}

// ---------- Library ----------
let libraryToken = 0;
async function loadLibrary() {
  const token = ++libraryToken;
  $('#library-loading').hidden = false;
  let scenes = [];
  try {
    scenes = await host.call('listScenes');
  } catch (e) {
    fail(e);
  }
  if (token !== libraryToken) return;
  $('#library-loading').hidden = true;
  const { saved, examples } = sortScenes(scenes);
  $('#saved-grid').replaceChildren(...saved.map((s) => sceneCard(s)));
  $('#saved-empty').hidden = saved.length > 0;
  $('#example-grid').replaceChildren(...examples.map((s) => sceneCard(s)));
  $('#examples-title').hidden = examples.length === 0;
}

function sceneCard(entry) {
  const name = entry.name || 'Untitled scene';
  const swatch = h('div', { class: 'swatch', role: 'img', 'aria-label': `${name} preview colours` });
  swatch.style.setProperty('background', swatchBackground(entry));
  const badges = h('div', { class: 'badges' },
    entry.example ? h('span', { class: 'badge', text: 'Example' }) : null,
    entry.mode === 'code' ? h('span', { class: 'badge', text: 'Code' }) : null);
  swatch.append(badges);
  const btn = (label, aria, onClick, cls = '') => h('button', { type: 'button', class: `small ${cls}`.trim(), 'aria-label': aria, text: label, onclick: guarded(onClick) });
  const actions = h('div', { class: 'card-actions' },
    btn('Use as wallpaper', `Use ${name} as wallpaper`, () => useScene(entry), 'primary'),
    entry.example ? btn('Remix', `Remix ${name}`, () => remixExample(entry)) : btn('Edit', `Edit ${name}`, () => editScene(entry)),
    entry.example ? null : btn('Export', `Export ${name}`, () => exportScene(entry)),
    entry.example ? null : btn('Delete', `Delete ${name}`, () => deleteScene(entry), 'danger'));
  return h('li', { class: 'card' }, swatch,
    h('div', { class: 'card-body' }, h('h3', { text: name, title: name }), h('p', { text: entry.description || ' ' }), actions));
}

// Disables the clicked button while its async action runs.
function guarded(fn) {
  return async (event) => {
    const button = event?.currentTarget;
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try { await fn(event); } catch (e) { fail(e); } finally { if (button?.isConnected) button.disabled = false; }
  };
}

async function useScene(entry) {
  await host.call('useScene', entry.example ? { example: entry.id } : { id: entry.id });
  if (!host.mock) toast(`${entry.name || 'Scene'} is now your wallpaper.`);
}
async function editScene(entry) {
  const r = await host.call('editScene', { id: entry.id });
  openEditor({ draft: r.draft, base: r.base, recipe: r.recipe ?? defaultRecipe(), sceneId: entry.id, code: r.code ?? null, flow: 'edit' });
}
// A draft copy of an example; it has no saved id, so saving creates a new scene.
async function remixExample(entry) {
  const r = await host.call('editScene', { example: entry.id });
  openEditor({ draft: r.draft, base: r.base, recipe: r.recipe ?? defaultRecipe(), sceneId: null, code: r.code ?? null, flow: 'edit' });
}
async function exportScene(entry) {
  const r = await host.call('exportScene', { id: entry.id });
  if (r?.file) toast(`Exported to ${r.file}`);
}
async function deleteScene(entry) {
  const ok = await confirmDialog({ heading: `Delete “${entry.name || 'Untitled scene'}”?`, text: 'This removes the scene from your library. It cannot be undone.', ok: 'Delete' });
  if (!ok) return;
  await host.call('deleteScene', { id: entry.id });
  toast('Scene deleted.');
  await loadLibrary();
  ($('#saved-grid button') ?? $('#new-image')).focus();
}
async function importScene() {
  const r = await host.call('importScene');
  if (!r) return;
  toast('Scene imported.');
  await loadLibrary();
}

// ---------- Views ----------
function showView(view) {
  state.view = view;
  $('#library-view').hidden = view !== 'library';
  $('#editor-view').hidden = view !== 'editor';
  const nav = $('#nav-library');
  if (view === 'library') nav.setAttribute('aria-current', 'page');
  else nav.removeAttribute('aria-current');
}

async function goLibrary() {
  if (state.view === 'library') return;
  const ed = state.ed;
  if (ed && (ed.dirty || ed.busy)) {
    const ok = await confirmDialog({
      heading: 'Leave this scene?',
      text: ed.busy ? 'Work is still in progress and unsaved changes will be lost.' : 'You have unsaved changes. They stay in the draft but will not be in your library.',
      ok: 'Leave', cancel: 'Keep editing',
    });
    if (!ok) return;
  }
  state.ed = null;
  reloadPreview(true);
  showView('library');
  loadLibrary();
  $('#library-title').focus?.();
}

// ---------- Editor ----------
function openEditor({ draft, base, recipe, sceneId = null, code = null, flow }) {
  const r = clone(recipe) ?? defaultRecipe();
  const image = r.backdrop?.image ? { url: joinUrl(base, r.backdrop.image) } : null;
  state.ed = {
    draft, base, recipe: r, sceneId, flow, image,
    code: typeof code === 'string' && code ? code : null,
    codeApproved: false, depthFile: r.backdrop?.depth ?? null,
    dirty: false, busy: 0,
  };
  $('#allow-code').checked = false;
  $('#prompt').value = '';
  $('#generate-progress').hidden = true;
  $('#depth-progress').hidden = true;
  $('#flow-panels').classList.toggle('describe-first', flow === 'describe');
  $('#describe-title').textContent = flow === 'describe' ? 'Describe a scene' : 'Ask Claude (optional)';
  $('#image-panel-title').textContent = flow === 'describe' ? 'Image (optional)' : 'Image';
  $('#advanced-panel').open = Boolean(state.ed.code);
  showView('editor');
  renderEditor();
  setDirty(false);
  reloadPreview();
  refreshSettings();
  if (flow === 'describe') $('#prompt').focus();
  else $('#scene-name').focus();
}

function currentEffective() {
  const ed = state.ed;
  return effectiveRecipe(ed.recipe, { hasCode: Boolean(ed.code), codeApproved: ed.codeApproved });
}

function setDirty(dirty) {
  if (!state.ed) return;
  state.ed.dirty = dirty;
  $('#dirty-state').textContent = dirty ? 'Unsaved changes' : state.ed.sceneId ? 'Saved' : '';
}

function updateRecipe(next, { rerender = false, focusId = null } = {}) {
  state.ed.recipe = next;
  setDirty(true);
  if (rerender) {
    const active = focusId ?? document.activeElement?.id;
    renderControls();
    if (active) document.getElementById(active)?.focus();
  }
  schedulePreview();
}

function renderEditor() {
  const r = state.ed.recipe;
  $('#scene-name').value = r.name ?? '';
  $('#scene-description').value = r.description ?? '';
  renderImagePanel();
  renderControls();
  renderCode();
  setBusyUi();
}

function renderImagePanel() {
  const ed = state.ed;
  const has = Boolean(ed.image?.url);
  $('#image-preview').hidden = !has;
  $('#image-empty').hidden = has;
  $('#depth-block').hidden = !has;
  $('#pick-image').textContent = has ? 'Change image…' : 'Choose image…';
  if (has) {
    $('#image-thumb').src = ed.image.url;
    const { width, height, name } = ed.image;
    const label = name || ed.recipe.backdrop?.image || '';
    $('#image-meta').textContent = width && height ? `${label}${label ? ' · ' : ''}${width} × ${height}` : label;
  }
  $('#depth-toggle').checked = Boolean(ed.recipe.backdrop?.depth);
}

// --- control builders ---
function slider(field, path, opts = {}) {
  const value = getPath(state.ed.recipe, path) ?? field.def;
  const id = fid(path);
  return h('div', { class: 'slider' },
    h('label', { for: id, text: opts.label ?? field.label }),
    h('output', { for: id, id: `${id}-out`, text: formatValue(field, value) }),
    h('input', {
      type: 'range', id, min: field.min, max: field.max, step: field.step, value: String(value),
      dataset: { path, type: 'range', min: field.min, max: field.max, integer: field.integer ? '1' : '', fmt: JSON.stringify(field), ...(opts.ensure ? { ensure: opts.ensure, ensureDefault: JSON.stringify(opts.ensureDefault) } : {}) },
      'aria-describedby': field.hint ? `${id}-hint` : null,
    }),
    field.hint ? h('span', { class: 'hint', id: `${id}-hint`, text: field.hint }) : null);
}

function select(path, options, label, { value, rerender = false, kindList = null, index = null, disabled = false } = {}) {
  const id = fid(path);
  const current = value ?? getPath(state.ed.recipe, path) ?? options[0];
  return h('div', { class: 'field' },
    h('label', { for: id, text: label }),
    h('select', { id, disabled, dataset: { path, type: 'select', ...(rerender ? { rerender: '1' } : {}), ...(kindList ? { kindList, index: String(index) } : {}) } },
      options.map((o) => h('option', { value: o, text: title(o), selected: o === current }))));
}

function checkbox(path, label, { value, rerender = false, describedBy = null } = {}) {
  const id = fid(path);
  const checked = value ?? Boolean(getPath(state.ed.recipe, path));
  return h('label', { class: 'check', for: id },
    h('input', { type: 'checkbox', id, checked, 'aria-describedby': describedBy, dataset: { path, type: 'checkbox', ...(rerender ? { rerender: '1' } : {}) } }),
    h('span', { text: label }));
}

function segmented(path, options, legend, { value, disabledOptions = [], rerender = false } = {}) {
  const current = value ?? getPath(state.ed.recipe, path) ?? options[0];
  return h('fieldset', {},
    h('legend', { text: legend }),
    h('div', { class: 'seg' }, options.map((o) => h('label', {},
      h('input', { type: 'radio', name: fid(path), id: fid(`${path}.${o}`), value: o, checked: o === current, disabled: disabledOptions.includes(o), dataset: { path, type: 'select', ...(rerender ? { rerender: '1' } : {}) } }),
      h('span', { text: title(o) })))));
}

function colorInput(path, label, { value, ensure = null, ensureDefault = null, disabled = false } = {}) {
  const id = fid(path);
  return h('input', {
    type: 'color', id, value: value ?? getPath(state.ed.recipe, path) ?? '#ffffff', 'aria-label': label, title: label, disabled,
    dataset: { path, type: 'color', ...(ensure ? { ensure, ensureDefault: JSON.stringify(ensureDefault) } : {}) },
  });
}

function colorList(path, limits, defaults, label) {
  const colors = getPath(state.ed.recipe, path) ?? defaults;
  const [min, max] = limits;
  const items = colors.map((c, i) => h('span', { class: 'color-item' },
    colorInput(`${path}.${i}`, `${label} ${i + 1}`, { value: c, ensure: path, ensureDefault: defaults }),
    colors.length > min ? h('button', { type: 'button', id: fid(`${path}.${i}.remove`), 'aria-label': `Remove ${label.toLowerCase()} ${i + 1}`, text: '✕', dataset: { action: 'remove-color', path, index: String(i), min: String(min), defaults: JSON.stringify(defaults) } }) : null));
  return h('div', { class: 'field' },
    h('span', { class: 'field-label', id: fid(`${path}.label`), text: `${label}s (${colors.length} of ${max})` }),
    h('div', { class: 'colors', role: 'group', 'aria-labelledby': fid(`${path}.label`) }, items,
      colors.length < max ? h('button', { type: 'button', class: 'small', id: fid(`${path}.add`), text: '+ Color', 'aria-label': `Add ${label.toLowerCase()}`, dataset: { action: 'add-color', path, max: String(max), defaults: JSON.stringify(defaults) } }) : null));
}

function renderControls() {
  const r = state.ed.recipe;
  const hasImage = Boolean(state.ed.image?.url || r.backdrop?.image);
  const kind = r.backdrop?.kind ?? (r.backdrop?.image ? 'image' : 'gradient');

  // Look
  $('#look-fields').replaceChildren(
    segmented('medium', ENUMS.medium, 'Medium', { value: r.medium ?? 'water' }),
    h('p', { class: 'muted small', text: (r.medium ?? 'water') === 'water' ? 'Creatures swim, food sinks, ripples bend the light.' : 'Creatures fly, food falls, no refraction.' }),
    segmented('backdrop.kind', ENUMS.backdropKind, 'Backdrop', { value: kind, disabledOptions: hasImage ? [] : ['image'], rerender: true }),
    kind === 'gradient' ? colorList('backdrop.colors', LIMITS.gradientColors, DEFAULT_GRADIENT, 'Gradient color') : null,
    ...BACKDROP_FIELDS.map((f) => slider(f, `backdrop.${f.key}`)),
    kind === 'image' ? h('div', { class: 'two' },
      slider({ label: 'Focus across', min: 0, max: 1, step: 0.01, def: 0.5, hint: 'Kept in view when cropped' }, 'backdrop.focus.0', { ensure: 'backdrop.focus', ensureDefault: [0.5, 0.5] }),
      slider({ label: 'Focus down', min: 0, max: 1, step: 0.01, def: 0.5 }, 'backdrop.focus.1', { ensure: 'backdrop.focus', ensureDefault: [0.5, 0.5] })) : null,
  );
  // medium text depends on value
  for (const input of $('#look-fields').querySelectorAll('input[name="f-medium"]')) input.dataset.rerender = '1';

  // Effects
  const tint = r.effects?.tint;
  $('#effects-fields').replaceChildren(
    ...EFFECT_FIELDS.map((f) => slider(f, `effects.${f.key}`)),
    h('div', { class: 'row' },
      h('label', { class: 'check', for: 'tint-toggle' },
        h('input', { type: 'checkbox', id: 'tint-toggle', checked: Boolean(tint), dataset: { action: 'tint' } }),
        h('span', { text: 'Color tint' })),
      colorInput('effects.tint', 'Tint color', { value: tint ?? DEFAULT_TINT, disabled: !tint })),
  );

  // Particles
  const particles = Array.isArray(r.particles) ? r.particles : [];
  $('#particles-fields').replaceChildren(
    ...(particles.length ? particles.map((p, i) => {
      const base = `particles.${i}`;
      return h('div', { class: 'item', role: 'group', 'aria-label': `Particle layer ${i + 1}: ${p.kind}` },
        h('div', { class: 'item-head' },
          select(`${base}.kind`, ENUMS.particleKind, `Layer ${i + 1}`, { kindList: 'particles', index: i }),
          h('button', { type: 'button', class: 'danger', id: fid(`${base}.remove`), text: 'Remove', 'aria-label': `Remove particle layer ${i + 1}`, dataset: { action: 'remove-item', list: 'particles', index: String(i) } })),
        ...PARTICLE_FIELDS.map((f) => slider(f, `${base}.${f.key}`)),
        h('div', { class: 'row' },
          h('span', { class: 'field-label', text: 'Color' }), colorInput(`${base}.color`, `Layer ${i + 1} color`, { value: p.color ?? '#ffffff' }),
          checkbox(`${base}.night`, 'Night only (or brighter at night)')));
    }) : [h('p', { class: 'list-empty', text: 'No particles. Add bubbles, snow, fireflies and more.' })]),
    h('div', { class: 'list-foot' },
      h('span', { class: 'muted small', text: `${particles.length} of ${LIMITS.particles}` }),
      h('button', { type: 'button', id: 'add-particles', text: '+ Particle layer', disabled: !canAdd(r, 'particles'), dataset: { action: 'add-item', list: 'particles' } })),
  );

  // Creatures
  const creatures = Array.isArray(r.creatures) ? r.creatures : [];
  $('#creatures-fields').replaceChildren(
    ...(creatures.length ? creatures.map((c, i) => {
      const base = `creatures.${i}`;
      const zone = Array.isArray(c.zone) ? c.zone : [0, 1];
      return h('div', { class: 'item', role: 'group', 'aria-label': `Creature group ${i + 1}: ${c.kind}` },
        h('div', { class: 'item-head' },
          select(`${base}.kind`, ENUMS.creatureKind, `Group ${i + 1}`, { kindList: 'creatures', index: i }),
          h('button', { type: 'button', class: 'danger', id: fid(`${base}.remove`), text: 'Remove', 'aria-label': `Remove creature group ${i + 1}`, dataset: { action: 'remove-item', list: 'creatures', index: String(i) } })),
        ...CREATURE_FIELDS.map((f) => slider(f, `${base}.${f.key}`)),
        h('div', { class: 'two' },
          slider({ label: 'Zone top', min: 0, max: 1, step: 0.01, def: zone[0] }, `${base}.zone.0`, { ensure: `${base}.zone`, ensureDefault: [0, 1] }),
          slider({ label: 'Zone bottom', min: 0, max: 1, step: 0.01, def: zone[1] }, `${base}.zone.1`, { ensure: `${base}.zone`, ensureDefault: [0, 1] })),
        colorList(`${base}.colors`, LIMITS.creatureColors, ['#ff8a3d'], 'Color'),
        checkbox(`${base}.glow`, 'Glow (bioluminescent, brighter at night)'));
    }) : [h('p', { class: 'list-empty', text: 'No creatures. Add fish, jellyfish, birds and more.' })]),
    h('div', { class: 'list-foot' },
      h('span', { class: 'muted small', text: `${creatures.length} of ${LIMITS.creatures}` }),
      h('button', { type: 'button', id: 'add-creatures', text: '+ Creature group', disabled: !canAdd(r, 'creatures'), dataset: { action: 'add-item', list: 'creatures' } })),
  );

  // Food & light
  // Matches the engine: lighting follows the clock unless the recipe says otherwise.
  const follow = r.light?.followClock ?? LIGHT_DEFAULTS.followClock;
  $('#life-fields').replaceChildren(
    select('food', ENUMS.food, 'Food', { value: r.food ?? 'flakes' }),
    checkbox('light.followClock', 'Lighting follows the time of day', { value: follow, rerender: true }),
    select('light.mood', ENUMS.mood, follow ? 'Mood (used when not following the clock)' : 'Mood', { value: r.light?.mood ?? LIGHT_DEFAULTS.mood, disabled: follow }),
  );
}

function renderCode() {
  const ed = state.ed;
  const has = Boolean(ed.code);
  $('#code-block').hidden = !has;
  if (!has) return;
  $('#code-view').textContent = ed.code;
  $('#code-approve').checked = ed.codeApproved;
  $('#code-origin').textContent = ed.recipe.importedCode
    ? 'This imported scene comes with code (scene.js). It will not run until you read it and tick the box.'
    : 'This scene comes with code (scene.js). It will not run until you read it and tick the box.';
  $('#code-state').textContent = !wantsCode(ed.recipe)
    ? 'This recipe does not ask to run the code.'
    : ed.codeApproved ? 'The code runs in the preview and will be saved as a code scene.' : 'Not running: the preview uses the built-in engine.';
}

// --- form events ---
function applyControl(target) {
  const { path, type } = target.dataset;
  let r = state.ed.recipe;
  if (target.dataset.ensure && !Array.isArray(getPath(r, target.dataset.ensure))) {
    r = setPath(r, target.dataset.ensure, JSON.parse(target.dataset.ensureDefault));
  }
  if (target.dataset.kindList) {
    updateRecipe(changeKind(r, target.dataset.kindList, Number(target.dataset.index), target.value), { rerender: true, focusId: target.id });
    return;
  }
  const field = target.dataset.fmt ? JSON.parse(target.dataset.fmt) : { min: Number(target.dataset.min), max: Number(target.dataset.max), integer: Boolean(target.dataset.integer) };
  const raw = type === 'checkbox' ? target.checked : target.value;
  const value = parseControlValue(type, raw, field);
  if (type === 'range') {
    const out = document.getElementById(`${target.id}-out`);
    if (out) out.textContent = formatValue(field, value);
  }
  updateRecipe(setPath(r, path, value), { rerender: Boolean(target.dataset.rerender), focusId: target.id });
}

function onControlsEvent(event) {
  const t = event.target;
  if (!state.ed || !t?.dataset) return;
  if (t.id === 'tint-toggle' && event.type === 'change') {
    const color = $('#f-effects-tint')?.value ?? DEFAULT_TINT;
    updateRecipe(setPath(state.ed.recipe, 'effects.tint', t.checked ? color : undefined), { rerender: true, focusId: t.id });
    return;
  }
  if (!t.dataset.path) return;
  const discrete = t.type === 'checkbox' || t.type === 'radio' || t.tagName === 'SELECT';
  if (discrete !== (event.type === 'change')) return;
  applyControl(t);
}

function onControlsClick(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn || !state.ed) return;
  const { action, list, path } = btn.dataset;
  const r = state.ed.recipe;
  if (action === 'add-item') {
    const next = addItem(r, list);
    const index = next[list].length - 1;
    updateRecipe(next, { rerender: true, focusId: fid(`${list}.${index}.kind`) });
  } else if (action === 'remove-item') {
    updateRecipe(removeItem(r, list, Number(btn.dataset.index)), { rerender: true, focusId: `add-${list}` });
  } else if (action === 'add-color') {
    const defaults = JSON.parse(btn.dataset.defaults);
    const base = Array.isArray(getPath(r, path)) ? r : setPath(r, path, defaults);
    const next = addColor(base, path, [0, Number(btn.dataset.max)], getPath(base, path).at(-1));
    updateRecipe(next, { rerender: true, focusId: fid(`${path}.${getPath(next, path).length - 1}`) });
  } else if (action === 'remove-color') {
    const defaults = JSON.parse(btn.dataset.defaults);
    const base = Array.isArray(getPath(r, path)) ? r : setPath(r, path, defaults);
    updateRecipe(removeColor(base, path, [Number(btn.dataset.min)], Number(btn.dataset.index)), { rerender: true, focusId: fid(`${path}.0`) });
  }
}

// ---------- Preview ----------
function postPreview() {
  const frame = $('#preview');
  if (!state.ed || !state.previewReady || !frame.contentWindow) return;
  // The sandboxed frame has an opaque origin, so '*' is the only target that reaches it.
  frame.contentWindow.postMessage({ type: 'deskworlds:recipe', recipe: currentEffective(), base: state.ed.base }, '*');
}
const schedulePreview = debounce(postPreview, 150);

// A fresh frame per session (and when code approval is withdrawn), so code that ran
// before cannot keep running.
function reloadPreview(blank = false) {
  schedulePreview.cancel();
  state.previewReady = false;
  const frame = $('#preview');
  $('#stage-status').hidden = blank;
  $('#stage-status').textContent = 'Loading preview…';
  // Assigning src always navigates, even to the same URL.
  frame.src = blank ? 'about:blank' : PREVIEW_SRC;
}

function onPreviewLoad() {
  const frame = $('#preview');
  if (!state.ed || !frame.src.includes('preview=1')) return;
  state.previewReady = true;
  $('#stage-status').hidden = true;
  postPreview();
}

// ---------- Busy work ----------
function setBusyUi() {
  const ed = state.ed;
  const busy = Boolean(ed?.busy);
  for (const id of ['save', 'save-use', 'create', 'pick-image', 'depth-toggle']) $(`#${id}`).disabled = busy;
  for (const b of document.querySelectorAll('#chips button')) b.disabled = busy;
}

async function work(fn) {
  const ed = state.ed;
  if (!ed || ed.busy) return;
  ed.busy++;
  setBusyUi();
  try { await fn(ed); } catch (e) { if (state.ed === ed) fail(e); } finally {
    ed.busy--;
    if (state.ed === ed) setBusyUi();
  }
}

function pickImage() {
  return work(async (ed) => {
    const res = await host.call('pickImage', { draft: ed.draft });
    if (!res || state.ed !== ed) return;
    const file = res.file || fileNameFromUrl(res.url);
    ed.image = { url: res.url, width: res.width, height: res.height, name: res.name };
    ed.depthFile = null;
    const backdrop = { ...(ed.recipe.backdrop ?? {}), kind: 'image', image: file };
    delete backdrop.depth;
    renderImagePanel();
    updateRecipe(setPath(ed.recipe, 'backdrop', backdrop), { rerender: true, focusId: 'pick-image' });
  });
}

async function toggleDepth(event) {
  const ed = state.ed;
  const on = event.target.checked;
  if (!ed) return;
  if (!on) {
    updateRecipe(setPath(ed.recipe, 'backdrop.depth', undefined));
    return;
  }
  if (ed.depthFile) {
    updateRecipe(setPath(ed.recipe, 'backdrop.depth', ed.depthFile));
    return;
  }
  if (!state.depthWarned) {
    const ok = await confirmDialog({
      heading: 'Make a depth map?',
      text: 'The first time, the app downloads a 99 MB depth model (Depth Anything V2 Small). After that it runs offline on your PC and takes a few seconds per image.',
      ok: 'Download and continue',
    });
    if (!ok) { event.target.checked = false; return; }
    state.depthWarned = true;
  }
  const bar = $('#depth-bar');
  const text = $('#depth-text');
  await work(async () => {
    $('#depth-progress').hidden = false;
    bar.removeAttribute('value');
    text.textContent = 'Starting…';
    try {
      const res = await host.call('makeDepth', { draft: ed.draft }, {
        onProgress: ({ text: t, fraction }) => {
          if (state.ed !== ed) return;
          if (t) text.textContent = t;
          if (typeof fraction === 'number') bar.value = Math.max(0, Math.min(1, fraction));
        },
      });
      if (state.ed !== ed) return;
      const file = res?.file || fileNameFromUrl(res?.url);
      if (!file) throw new Error('The app did not return a depth map.');
      ed.depthFile = file;
      let r = setPath(ed.recipe, 'backdrop.depth', file);
      if (getPath(r, 'backdrop.parallax') == null) r = setPath(r, 'backdrop.parallax', 0.5);
      updateRecipe(r, { rerender: true, focusId: 'depth-toggle' });
      toast('Depth map ready. Move the cursor over the preview.');
    } catch (e) {
      if (state.ed === ed) $('#depth-toggle').checked = false;
      throw e;
    } finally {
      if (state.ed === ed) $('#depth-progress').hidden = true;
    }
  });
}

async function generate() {
  const ed = state.ed;
  if (!ed || ed.busy) return;
  const prompt = $('#prompt').value.trim();
  if (!prompt) {
    toast('Describe the scene first, or pick one of the ideas.', { error: true });
    $('#prompt').focus();
    return;
  }
  const settings = await refreshSettings();
  if (!settings.hasApiKey) {
    $('#describe-key').hidden = false;
    $('#describe-key input[type="password"]')?.focus();
    toast('Add your Anthropic API key to create scenes from words.');
    return;
  }
  const allowCode = $('#allow-code').checked;
  await work(async () => {
    $('#generate-progress').hidden = false;
    $('#generate-text').textContent = 'Asking Claude…';
    try {
      const res = await host.call('generate', { draft: ed.draft, prompt, allowCode }, {
        onProgress: ({ text }) => { if (state.ed === ed && text) $('#generate-text').textContent = text; },
      });
      if (state.ed !== ed) return;
      if (!res?.recipe || typeof res.recipe !== 'object') throw new Error('Claude did not return a scene. Try again or reword it.');
      const typedName = $('#scene-name').value.trim();
      const next = mergeGenerated(ed.recipe, res.recipe);
      if (typedName && ed.dirty) next.name = typedName;
      const wasRunning = ed.codeApproved;
      ed.code = allowCode && typeof res.code === 'string' && res.code ? res.code : null;
      ed.codeApproved = false;
      if (!ed.code && next.mode === 'code') next.mode = 'recipe';
      ed.recipe = next;
      renderEditor();
      setDirty(true);
      if (wasRunning) reloadPreview(); else postPreview();
      if (ed.code) {
        $('#advanced-panel').open = true;
        toast('Claude wrote code for this scene. Read it under Advanced before running it.');
      } else toast('Scene created. Tweak anything, then save.');
    } finally {
      if (state.ed === ed) $('#generate-progress').hidden = true;
    }
  });
}

function save({ use = false } = {}) {
  return work(async (ed) => {
    let recipe = currentEffective();
    if (!recipe.name?.trim()) {
      recipe.name = 'Untitled scene';
      ed.recipe = setPath(ed.recipe, 'name', recipe.name);
      $('#scene-name').value = recipe.name;
    }
    await host.call('saveDraft', { draft: ed.draft, recipe });
    const { id } = await host.call('saveScene', { draft: ed.draft });
    if (state.ed !== ed) return;
    ed.sceneId = id;
    setDirty(false);
    if (use) {
      await host.call('useScene', { id });
      if (!host.mock) toast(`Saved “${recipe.name}” and set it as your wallpaper.`);
    } else toast(`Saved “${recipe.name}”.`);
  });
}

// ---------- Flows ----------
async function newFromImage(event) {
  const d = await host.call('newDraft');
  openEditor({ draft: d.draft, base: d.base, recipe: defaultRecipe(), flow: 'image' });
  await pickImage();
  void event;
}
async function newFromWords() {
  const d = await host.call('newDraft');
  openEditor({ draft: d.draft, base: d.base, recipe: defaultRecipe(), flow: 'describe' });
}

// ---------- Wiring ----------
function init() {
  $('#mock-badge').hidden = !host.mock;
  $('#chips').replaceChildren(...EXAMPLE_PROMPTS.map((text) => h('button', {
    type: 'button', text, onclick: () => { $('#prompt').value = text; $('#prompt').focus(); },
  })));
  buildKeyForm($('#settings-key'));
  buildKeyForm($('#describe-key'), { compact: true });

  $('#nav-library').addEventListener('click', goLibrary);
  $('#back-to-library').addEventListener('click', goLibrary);
  $('#nav-settings').addEventListener('click', () => openSettings().catch(fail));
  $('#new-image').addEventListener('click', guarded(newFromImage));
  $('#new-describe').addEventListener('click', guarded(newFromWords));
  $('#import-scene').addEventListener('click', guarded(importScene));

  const controls = $('#controls');
  controls.addEventListener('input', onControlsEvent);
  controls.addEventListener('change', onControlsEvent);
  controls.addEventListener('click', onControlsClick);
  controls.addEventListener('submit', (e) => e.preventDefault());

  $('#pick-image').addEventListener('click', pickImage);
  $('#depth-toggle').addEventListener('change', (e) => toggleDepth(e).catch(fail));
  $('#create').addEventListener('click', () => generate().catch(fail));
  $('#prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); generate().catch(fail); }
  });
  $('#allow-code').addEventListener('change', (e) => {
    if (e.target.checked) toast('Claude may now write code for the next scene you create. You will see it before it runs.');
  });
  $('#code-approve').addEventListener('change', (e) => {
    const ed = state.ed;
    if (!ed) return;
    const wasRunning = ed.codeApproved;
    ed.codeApproved = e.target.checked;
    setDirty(true);
    renderCode();
    if (wasRunning && !ed.codeApproved) reloadPreview(); else postPreview();
  });
  $('#save').addEventListener('click', () => save());
  $('#save-use').addEventListener('click', () => save({ use: true }));
  $('#preview').addEventListener('load', onPreviewLoad);
  $('#model-select').addEventListener('change', async (e) => {
    try {
      await host.call('setModel', { model: e.target.value });
      $('#model-state').textContent = 'Model saved.';
      if (state.settings) state.settings.model = e.target.value;
    } catch (err) { fail(err); }
  });

  document.addEventListener('keydown', (e) => {
    if (state.view === 'editor' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (e) => { if (state.ed?.dirty) e.preventDefault(); });

  $('#library-title').tabIndex = -1;
  showView('library');
  reloadPreview(true);
  refreshSettings();
  loadLibrary();
}

init();
