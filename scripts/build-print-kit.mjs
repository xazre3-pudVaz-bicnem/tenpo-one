// iPad アプリのオフライン印字キット（lib/print-kit.ts）を1ファイルにまとめて public/print-kit.js に置く。
// JavaScriptCore で動くように Buffer を同梱する（Node の機能は使わない）。npm run build の中で毎回動く。
// public/print-kit.js・print-kit.json は git に入れない（.gitignore）。iPad は /print-kit.json の version を見て新しければ取り直す。
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const shim = path.join(root, 'scripts', 'print-kit-shim.js');

const result = await build({
  entryPoints: [path.join(root, 'lib', 'print-kit.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  minify: true,
  write: false,
  inject: [shim],
  tsconfig: path.join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    string_decoder: path.join(root, 'scripts', 'print-kit-stubs', 'string_decoder.js'),
    stream: path.join(root, 'scripts', 'print-kit-stubs', 'empty.js'),
  },
  logLevel: 'warning',
});
const code = result.outputFiles[0].text;
const version = createHash('sha256').update(code).digest('hex').slice(0, 16);
mkdirSync(path.join(root, 'public'), { recursive: true });
writeFileSync(path.join(root, 'public', 'print-kit.js'), `/* tenpo print-kit ${version} */\n${code}`);
writeFileSync(path.join(root, 'public', 'print-kit.json'), JSON.stringify({ version, bytes: code.length }));
console.log(`print-kit: ${version} (${Math.round(code.length / 1024)} KB)`);
