// Syntax-checks every JavaScript file the app serves, on any OS (npm runs scripts with
// cmd on Windows, which cannot run the shell loop this replaced).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = ['serve.mjs', 'tools/check.mjs'];
const scan = (dir, depth) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (depth > 0 && name !== 'node_modules' && name !== 'tests') scan(path, depth - 1);
    } else if (/\.m?js$/.test(name)) files.push(path);
  }
};
// The same folders the old loop covered (scenes/*/src, scenes/shared, ui, studio), plus
// every test file, since a test that does not parse cannot fail.
for (const dir of readdirSync('scenes')) {
  if (statSync(join('scenes', dir)).isDirectory()) {
    for (const sub of ['src', 'tests']) {
      try { scan(join('scenes', dir, sub), 0); } catch {}
    }
  }
}
scan('scenes/shared', 0);
scan('ui', 0);
scan('studio', 0);
for (const dir of ['ui/tests', 'studio/tests', 'scenes/shared/tests']) {
  try { scan(dir, 0); } catch {}
}

let failed = 0;
for (const file of new Set(files)) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed++;
    console.error(`${file}\n${error.stderr}`);
  }
}
console.log(`check: ${new Set(files).size} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
