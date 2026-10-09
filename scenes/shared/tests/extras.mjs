// The pure parts of the Livingpanes overlay: clock lighting and pet growth.
import assert from 'node:assert/strict';
import { nightness, warmth, petScale, SULK_AFTER_MS } from '../extras.js';

const at = (h, m = 0) => new Date(2026, 9, 9, h, m);

assert.equal(nightness(at(12)), 0, 'midday is day');
assert.equal(nightness(at(2)), 1, 'small hours are night');
assert.equal(nightness(at(23)), 1, 'late evening is night');
assert.ok(nightness(at(6, 30)) > 0 && nightness(at(6, 30)) < 1, 'dawn is in between');
assert.ok(nightness(at(19)) > 0 && nightness(at(19)) < 1, 'dusk is in between');
for (let h = 0; h < 24; h++) {
  const n = nightness(at(h)), w = warmth(at(h));
  assert.ok(n >= 0 && n <= 1 && w >= 0 && w <= 1, `bounded at ${h}:00`);
}
assert.ok(warmth(at(19)) > 0.9 && warmth(at(12)) === 0, 'dusk is warm, noon is not');

assert.equal(petScale(0), 1);
assert.equal(petScale(40), 2);
assert.equal(petScale(4000), 2, 'growth is capped');
assert.equal(petScale(-5), 1, 'garbage meals do not shrink a pet');
assert.equal(petScale('x'), 1);
assert.equal(SULK_AFTER_MS, 86400000);

console.log('extras: ok');
