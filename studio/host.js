// Promise-based client for the Windows host (WebView2), plus an in-memory mock so the
// Studio is fully clickable in a plain browser. Touches no DOM at import time, so Node
// tests can import it.

export const TIMEOUTS = Object.freeze({ long: 5 * 60_000, short: 30_000 });

// generate and makeDepth are long by contract. The three file-dialog kinds also get the
// long timeout: they wait on the user, who may take more than 30 s to pick a file.
const LONG_KINDS = new Set(['generate', 'makeDepth', 'pickImage', 'importScene', 'exportScene']);

export function timeoutFor(kind, timeouts = TIMEOUTS) {
  return LONG_KINDS.has(kind) ? timeouts.long : timeouts.short;
}

export class HostError extends Error {
  constructor(message, kind) {
    super(message || 'The app reported an error.');
    this.name = 'HostError';
    this.kind = kind;
  }
}

function messageOf(error) {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error.message === 'string') return error.message;
  return 'The app reported an error.';
}

export function createWebviewHost(webview, { timeouts = TIMEOUTS } = {}) {
  let next = 1;
  const pending = new Map();

  function arm(id, entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      pending.delete(id);
      entry.reject(new HostError(`The app did not answer (${entry.kind} timed out).`, entry.kind));
    }, timeoutFor(entry.kind, timeouts));
  }

  function receive(raw) {
    let msg = raw;
    if (typeof raw === 'string') {
      try { msg = JSON.parse(raw); } catch { return; }
    }
    if (!msg || typeof msg !== 'object') return;
    const id = String(msg.id);
    const entry = pending.get(id);
    if (!entry) return;
    if (msg.kind === 'progress') {
      // Progress means the host is alive: restart the inactivity timeout.
      arm(id, entry);
      try {
        entry.onProgress?.({ text: typeof msg.text === 'string' ? msg.text : '', fraction: typeof msg.fraction === 'number' ? msg.fraction : null });
      } catch { /* a UI callback error must not break the channel */ }
      return;
    }
    pending.delete(id);
    clearTimeout(entry.timer);
    if (msg.ok === true) entry.resolve(msg.result);
    else entry.reject(new HostError(messageOf(msg.error), entry.kind));
  }

  webview.addEventListener('message', (event) => receive(event?.data));

  function call(kind, args = {}, { onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const id = String(next++);
      const entry = { kind, resolve, reject, onProgress, timer: null };
      pending.set(id, entry);
      arm(id, entry);
      try {
        webview.postMessage({ ...args, id, kind });
      } catch (error) {
        pending.delete(id);
        clearTimeout(entry.timer);
        reject(new HostError(messageOf(error), kind));
      }
    });
  }

  return { mock: false, call, receive, pendingCount: () => pending.size };
}

const MOCK_MODELS = ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'];

const MOCK_SAVED = [
  {
    id: 'moon-lagoon', name: 'Moonlit lagoon', description: 'Jellyfish drifting under a pale moon.',
    recipe: {
      version: 1, name: 'Moonlit lagoon', description: 'Jellyfish drifting under a pale moon.', mode: 'recipe', medium: 'water',
      backdrop: { kind: 'gradient', colors: ['#14254a', '#0a1430', '#03060f'], parallax: 0.3 },
      effects: { ripples: 0.6, caustics: 0.2, rays: 0.35, fog: 0.2, vignette: 0.5, sway: 0.15 },
      particles: [{ kind: 'plankton', amount: 0.4, color: '#8ff2e0', speed: 0.6, night: true }],
      creatures: [{ kind: 'jellyfish', count: 7, colors: ['#c9a7ff', '#8fd3ff'], size: 1.2, speed: 0.6, schooling: 0.1, zone: [0.1, 0.8], glow: true }],
      food: 'none', light: { followClock: false, mood: 'night' },
    },
  },
  {
    id: 'ember-night', name: 'Ember night', description: 'Embers rising into a dark sky.', mode: 'code',
    code: "export default function create(ctx) {\n  // Mock code scene: draws nothing.\n  return { frame() {} };\n}\n",
    recipe: {
      version: 1, name: 'Ember night', description: 'Embers rising into a dark sky.', mode: 'code', medium: 'air',
      backdrop: { kind: 'gradient', colors: ['#2a0f08', '#0b0403'] },
      particles: [{ kind: 'embers', amount: 0.7, color: '#ff8a3d', speed: 1.2 }],
      food: 'none', light: { followClock: true },
    },
  },
];

const MOCK_EXAMPLES = [
  { id: 'reef-dawn', name: 'Reef at dawn', description: 'Example: a school of fish in warm morning light.', colors: ['#f2b880', '#3a7a8c', '#0b2a3a'] },
  { id: 'misty-pines', name: 'Misty pines', description: 'Example: fireflies in a pine forest.', colors: ['#1d2b26', '#0c1512', '#050807'] },
  { id: 'koi-garden', name: 'Koi garden', description: 'Example: koi beneath lily pads.', colors: ['#16302a', '#0a1714'] },
];

function cannedRecipe(prompt) {
  const p = String(prompt).toLowerCase();
  const name = String(prompt).trim().replace(/^an? /i, '').slice(0, 60) || 'New scene';
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  if (p.includes('koi')) {
    return {
      version: 1, name: title, description: String(prompt).slice(0, 280), mode: 'recipe', medium: 'water',
      backdrop: { kind: 'gradient', colors: ['#3a2a3f', '#1a2a2c', '#0a1414'], parallax: 0.2 },
      effects: { ripples: 0.7, caustics: 0.3, rays: 0.1, fog: 0.05, vignette: 0.45, sway: 0.1 },
      particles: [{ kind: 'petals', amount: 0.45, color: '#ffc1d6', speed: 0.5 }],
      creatures: [{ kind: 'koi', count: 7, colors: ['#ff6a3d', '#f2efe6', '#e8b04a'], size: 1.3, speed: 0.6, schooling: 0.2, zone: [0.1, 0.9] }],
      food: 'pellets', light: { followClock: false, mood: 'dusk' },
    };
  }
  if (p.includes('firefl') || p.includes('forest') || p.includes('pine')) {
    return {
      version: 1, name: title, description: String(prompt).slice(0, 280), mode: 'recipe', medium: 'air',
      backdrop: { kind: 'gradient', colors: ['#1d2b26', '#0c1512', '#050807'], parallax: 0.35 },
      effects: { ripples: 0, caustics: 0, rays: 0.15, fog: 0.55, vignette: 0.55, sway: 0.05 },
      particles: [{ kind: 'fireflies', amount: 0.6, color: '#e8ff7a', speed: 0.5, night: true }],
      creatures: [{ kind: 'firefly', count: 24, colors: ['#e8ff7a'], size: 0.8, speed: 0.5, schooling: 0, zone: [0.3, 0.95], glow: true }],
      food: 'none', light: { followClock: true, mood: 'night' },
    };
  }
  return {
    version: 1, name: title, description: String(prompt).slice(0, 280), mode: 'recipe', medium: 'water',
    backdrop: { kind: 'gradient', colors: ['#14254a', '#0a1430', '#03060f'], parallax: 0.3 },
    effects: { ripples: 0.6, caustics: 0.25, rays: 0.35, fog: 0.15, vignette: 0.5, sway: 0.15 },
    particles: [{ kind: 'bubbles', amount: 0.3, color: '#d9f3ff', speed: 0.7 }],
    creatures: [{ kind: 'jellyfish', count: 6, colors: ['#c9a7ff', '#8fd3ff'], size: 1.1, speed: 0.6, schooling: 0.1, zone: [0.1, 0.8], glow: true }],
    food: 'flakes', light: { followClock: false, mood: 'night' },
  };
}

const MOCK_CODE = `// Written for the mock host; the real one asks Claude.
export default function create(ctx) {
  let t = 0;
  return {
    frame(dt) {
      t += dt;
      // draw something calm with ctx here
    },
  };
}
`;

// An in-memory host. `notify(text)` is how it tells the user about things only the
// Windows app can do; `delay` is the canned latency of generate.
export function createMockHost({ notify = () => {}, delay = 1000 } = {}) {
  const scenes = new Map(MOCK_SAVED.map((s) => [s.id, JSON.parse(JSON.stringify(s))]));
  const drafts = new Map();
  const settings = { hasApiKey: false, model: MOCK_MODELS[0], models: MOCK_MODELS.slice() };
  let draftNo = 0;
  let sceneNo = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = (draft) => `/user/_drafts/${draft}/`;
  const need = (cond, text) => { if (!cond) throw new HostError(text); };
  const draftOf = (draft) => { need(drafts.has(draft), 'That draft no longer exists.'); return drafts.get(draft); };

  const handlers = {
    async listScenes() {
      const saved = [...scenes.values()].map((s) => ({
        id: s.id, name: s.name, description: s.description, mode: s.recipe.mode ?? 'recipe', base: `/user/${s.id}/`,
        example: false, image: null, colors: s.recipe.backdrop?.colors ?? null,
      }));
      const examples = MOCK_EXAMPLES.map((e) => ({
        id: e.id, name: e.name, description: e.description, mode: 'recipe', base: `/scenes/studio/examples/${e.id}/`,
        example: true, image: null, colors: e.colors,
      }));
      return [...saved, ...examples];
    },
    async newDraft() {
      const draft = `mock-${++draftNo}`;
      drafts.set(draft, { recipe: null, code: null });
      return { draft, base: base(draft) };
    },
    async pickImage({ draft }) {
      draftOf(draft);
      notify('Images can be added in the Windows app.');
      return null;
    },
    async makeDepth({ draft }) {
      draftOf(draft);
      throw new HostError('Depth maps can be made in the Windows app.');
    },
    async generate({ draft, prompt, allowCode }, onProgress) {
      const d = draftOf(draft);
      need(settings.hasApiKey, 'Add your Anthropic API key in Settings first.');
      need(typeof prompt === 'string' && prompt.trim(), 'Describe the scene first.');
      onProgress?.({ text: 'Asking Claude…', fraction: 0.1 });
      await wait(delay / 2);
      onProgress?.({ text: 'Composing the scene…', fraction: 0.6 });
      await wait(delay / 2);
      const recipe = cannedRecipe(prompt);
      if (allowCode) {
        recipe.mode = 'code';
        d.code = MOCK_CODE;
        return { recipe, code: MOCK_CODE };
      }
      return { recipe };
    },
    async saveDraft({ draft, recipe }) {
      const d = draftOf(draft);
      need(recipe && typeof recipe === 'object', 'Nothing to save.');
      d.recipe = JSON.parse(JSON.stringify(recipe));
      return { base: base(draft) };
    },
    async saveScene({ draft }) {
      const d = draftOf(draft);
      need(d.recipe, 'Save the draft first.');
      const id = d.sceneId ?? `scene-${++sceneNo}`;
      scenes.set(id, { id, name: d.recipe.name || 'Untitled scene', description: d.recipe.description || '', recipe: d.recipe, code: d.code });
      d.sceneId = id;
      return { id };
    },
    async editScene({ id, example }) {
      if (example !== undefined) {
        // Remix: a fresh draft from an example; saving it creates a new saved scene.
        const ex = MOCK_EXAMPLES.find((e) => e.id === example);
        need(ex, 'That example no longer exists.');
        const recipe = {
          version: 1, name: ex.name, description: ex.description.replace(/^Example: /, ''), mode: 'recipe', medium: 'water',
          backdrop: { kind: 'gradient', colors: ex.colors.slice() }, light: { followClock: true },
        };
        const draft = `mock-${++draftNo}`;
        drafts.set(draft, { recipe: JSON.parse(JSON.stringify(recipe)), code: null });
        return { draft, base: base(draft), recipe };
      }
      need(scenes.has(id), 'That scene no longer exists.');
      const s = scenes.get(id);
      const draft = `mock-${++draftNo}`;
      drafts.set(draft, { recipe: JSON.parse(JSON.stringify(s.recipe)), code: s.code ?? null, sceneId: id });
      const out = { draft, base: base(draft), recipe: JSON.parse(JSON.stringify(s.recipe)) };
      if (s.code) out.code = s.code;
      return out;
    },
    async deleteScene({ id }) {
      need(scenes.delete(id), 'That scene no longer exists.');
      return true;
    },
    async useScene({ id, example }) {
      need(id ? scenes.has(id) : MOCK_EXAMPLES.some((e) => e.id === example), 'That scene no longer exists.');
      notify('The wallpaper is set in the Windows app (mock: nothing changed).');
      return true;
    },
    async exportScene({ id }) {
      need(scenes.has(id), 'That scene no longer exists.');
      notify('Export saves a .livingpane file in the Windows app.');
      return null;
    },
    async importScene() {
      notify('Import opens a .livingpane file in the Windows app.');
      return null;
    },
    async getSettings() {
      return { hasApiKey: settings.hasApiKey, model: settings.model, models: settings.models.slice(), workspaceId: settings.workspaceId || '' };
    },
    async setWorkspace({ id }) {
      need(typeof id === 'string' && /^[A-Za-z0-9_-]{0,100}$/.test(id.trim()), 'That does not look like a workspace ID.');
      settings.workspaceId = id.trim();
      return true;
    },
    async setApiKey({ key }) {
      need(typeof key === 'string', 'The key must be text.');
      settings.hasApiKey = key.trim() !== '';
      return true;
    },
    async setModel({ model }) {
      need(settings.models.includes(model), 'Unknown model.');
      settings.model = model;
      return true;
    },
  };

  async function call(kind, args = {}, { onProgress } = {}) {
    const handler = handlers[kind];
    if (!handler) throw new HostError(`Unknown request: ${kind}`, kind);
    await wait(30);
    return handler(args, onProgress);
  }

  return { mock: true, call };
}

export function createHost({ notify, webview = globalThis.chrome?.webview, delay } = {}) {
  if (webview && typeof webview.postMessage === 'function' && typeof webview.addEventListener === 'function') {
    return createWebviewHost(webview);
  }
  return createMockHost({ notify, delay });
}
