import assert from 'node:assert/strict';
import { createWebviewHost, createMockHost, createHost, timeoutFor, TIMEOUTS, HostError } from '../host.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; }
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function fakeWebview() {
  const listeners = [];
  const sent = [];
  return {
    sent,
    postMessage(msg) { sent.push(msg); },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    reply(data) { for (const fn of listeners) fn({ data }); },
  };
}

await test('timeouts per kind', () => {
  assert.equal(timeoutFor('generate'), TIMEOUTS.long);
  assert.equal(timeoutFor('makeDepth'), TIMEOUTS.long);
  assert.equal(TIMEOUTS.long, 300_000);
  assert.equal(timeoutFor('listScenes'), TIMEOUTS.short);
  assert.equal(TIMEOUTS.short, 30_000);
});

await test('call posts {id, kind, ...args} and resolves on ok', async () => {
  const wv = fakeWebview();
  const host = createWebviewHost(wv);
  const p = host.call('saveDraft', { draft: 'd1', recipe: { a: 1 }, id: 'spoof', kind: 'spoof' });
  assert.equal(wv.sent.length, 1);
  const msg = wv.sent[0];
  assert.equal(msg.kind, 'saveDraft', 'args cannot override kind');
  assert.notEqual(msg.id, 'spoof', 'args cannot override id');
  assert.equal(msg.draft, 'd1');
  wv.reply({ id: msg.id, ok: true, result: { base: '/user/_drafts/d1/' } });
  assert.deepEqual(await p, { base: '/user/_drafts/d1/' });
  assert.equal(host.pendingCount(), 0);
});

await test('rejects with the host error text; accepts JSON strings', async () => {
  const wv = fakeWebview();
  const host = createWebviewHost(wv);
  const p = host.call('generate', { draft: 'd', prompt: 'x', allowCode: false });
  wv.reply(JSON.stringify({ id: wv.sent[0].id, ok: false, error: 'Invalid API key' }));
  await assert.rejects(p, (e) => e instanceof HostError && e.message === 'Invalid API key' && e.kind === 'generate');
  const q = host.call('listScenes');
  wv.reply({ id: wv.sent[1].id, ok: false, error: { message: 'disk full' } });
  await assert.rejects(q, /disk full/);
});

await test('progress goes to that call only, then the result', async () => {
  const wv = fakeWebview();
  const host = createWebviewHost(wv);
  const a = [];
  const b = [];
  const pa = host.call('makeDepth', { draft: 'a' }, { onProgress: (x) => a.push(x) });
  const pb = host.call('generate', { draft: 'b' }, { onProgress: (x) => b.push(x) });
  const [ma, mb] = wv.sent;
  wv.reply({ id: ma.id, kind: 'progress', text: 'Downloading model', fraction: 0.25 });
  wv.reply({ id: mb.id, kind: 'progress', text: 'Asking Claude' });
  wv.reply({ id: ma.id, kind: 'progress', text: 'Thinking', fraction: 0.5 });
  assert.deepEqual(a, [{ text: 'Downloading model', fraction: 0.25 }, { text: 'Thinking', fraction: 0.5 }]);
  assert.deepEqual(b, [{ text: 'Asking Claude', fraction: null }]);
  wv.reply({ id: mb.id, ok: true, result: { recipe: {} } });
  wv.reply({ id: ma.id, ok: true, result: { url: '/x/depth.png' } });
  assert.deepEqual(await pa, { url: '/x/depth.png' });
  assert.deepEqual(await pb, { recipe: {} });
});

await test('ignores unknown ids, junk and late replies', async () => {
  const wv = fakeWebview();
  const host = createWebviewHost(wv);
  wv.reply('not json');
  wv.reply(null);
  wv.reply({ id: '999', ok: true });
  const p = host.call('getSettings');
  wv.reply({ id: wv.sent[0].id, ok: true, result: 1 });
  wv.reply({ id: wv.sent[0].id, ok: true, result: 2 });
  assert.equal(await p, 1);
});

await test('times out, and progress restarts the timer', async () => {
  const wv = fakeWebview();
  const host = createWebviewHost(wv, { timeouts: { long: 60, short: 20 } });
  await assert.rejects(host.call('listScenes'), /timed out/);
  assert.equal(host.pendingCount(), 0);
  const p = host.call('makeDepth', { draft: 'd' });
  const id = wv.sent[1].id;
  for (let i = 0; i < 3; i++) { await tick(35); wv.reply({ id, kind: 'progress', text: 'still', fraction: i / 3 }); }
  wv.reply({ id, ok: true, result: { url: '/d/depth.png' } });
  assert.deepEqual(await p, { url: '/d/depth.png' }, 'survived 105 ms with a 60 ms timeout');
});

await test('a throwing postMessage rejects', async () => {
  const host = createWebviewHost({ addEventListener() {}, postMessage() { throw new Error('closed'); } });
  await assert.rejects(host.call('listScenes'), /closed/);
  assert.equal(host.pendingCount(), 0);
});

await test('createHost picks the mock without chrome.webview', () => {
  assert.equal(createHost({ webview: undefined }).mock, true);
  assert.equal(createHost({ webview: fakeWebview() }).mock, false);
});

await test('mock host: full flow', async () => {
  const notes = [];
  const host = createMockHost({ notify: (t) => notes.push(t), delay: 20 });
  const list = await host.call('listScenes');
  assert.ok(list.some((s) => s.example) && list.some((s) => !s.example));
  for (const s of list) for (const k of ['id', 'name', 'description', 'mode', 'base', 'example', 'image', 'colors']) assert.ok(k in s, `${k} in listScenes item`);
  const { draft, base } = await host.call('newDraft');
  assert.match(base, /^\/user\/_drafts\//);
  assert.equal(await host.call('pickImage', { draft }), null);
  assert.match(notes.at(-1), /Windows app/);
  await assert.rejects(host.call('generate', { draft, prompt: 'koi', allowCode: false }), /API key/);
  await host.call('setApiKey', { key: 'sk-test' });
  assert.equal((await host.call('getSettings')).hasApiKey, true);
  const progress = [];
  const g = await host.call('generate', { draft, prompt: 'koi under cherry blossoms', allowCode: false }, { onProgress: (p) => progress.push(p) });
  assert.equal(g.recipe.creatures[0].kind, 'koi');
  assert.equal(g.code, undefined);
  assert.ok(progress.length >= 2);
  const gc = await host.call('generate', { draft, prompt: 'x', allowCode: true });
  assert.equal(gc.recipe.mode, 'code');
  assert.equal(typeof gc.code, 'string');
  await assert.rejects(host.call('saveScene', { draft }), /Save the draft/);
  await host.call('saveDraft', { draft, recipe: g.recipe });
  const { id } = await host.call('saveScene', { draft });
  const again = await host.call('saveScene', { draft });
  assert.equal(again.id, id, 'saving the same draft updates the same scene');
  const edited = await host.call('editScene', { id: 'ember-night' });
  assert.equal(typeof edited.code, 'string', 'editScene returns code for code scenes');
  assert.equal(await host.call('useScene', { example: 'reef-dawn' }), true);
  assert.equal(await host.call('deleteScene', { id }), true);
  await assert.rejects(host.call('deleteScene', { id }), /no longer exists/);
  await assert.rejects(host.call('nope'), /Unknown request/);
  await host.call('setApiKey', { key: '' });
  assert.equal((await host.call('getSettings')).hasApiKey, false);
  await assert.rejects(host.call('setModel', { model: 'gpt' }), /Unknown model/);
});

await test('mock host: remix an example into a new saved scene', async () => {
  const host = createMockHost({ delay: 10 });
  const before = (await host.call('listScenes')).filter((s) => !s.example).length;
  const r = await host.call('editScene', { example: 'koi-garden' });
  assert.match(r.base, /^\/user\/_drafts\//);
  assert.equal(r.recipe.name, 'Koi garden');
  assert.equal(r.code, undefined);
  await host.call('saveDraft', { draft: r.draft, recipe: r.recipe });
  const { id } = await host.call('saveScene', { draft: r.draft });
  assert.notEqual(id, 'koi-garden');
  const after = await host.call('listScenes');
  assert.equal(after.filter((s) => !s.example).length, before + 1, 'a new saved scene');
  assert.ok(after.some((s) => s.example && s.id === 'koi-garden'), 'example still listed');
  await assert.rejects(host.call('editScene', { example: 'nope' }), /no longer exists/);
});

console.log(`studio host: ${passed} tests passed`);
