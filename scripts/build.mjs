import { execFileSync } from 'node:child_process';
import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

const run = (...args) =>
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', ...args], {
    stdio: 'inherit',
  });

rmSync('lib', { recursive: true, force: true });

// ES2017 output keeps optional chaining and nullish coalescing out of the
// shipped JavaScript, so older bundlers and test runners can parse it. The
// classic JSX transform works with every React release from 17 on.
run('--module', 'commonjs', '--outDir', 'lib/commonjs');
run('--module', 'esnext', '--outDir', 'lib/module');
run(
  '--declaration',
  '--emitDeclarationOnly',
  '--sourceMap',
  'false',
  '--outDir',
  'lib/typescript',
);

// The package has no "type" field, so tell Node how to read each folder:
// `import` resolves to real ES modules, `require` to CommonJS.
writeFileSync('lib/module/package.json', '{\n  "type": "module"\n}\n');
writeFileSync('lib/commonjs/package.json', '{\n  "type": "commonjs"\n}\n');

copyFileSync('src/styles.css', 'lib/styles.css');
