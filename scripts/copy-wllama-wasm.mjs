import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const wasmSrc = resolve(
  root,
  'node_modules/@wllama/wllama/esm/wasm/wllama.wasm',
);
const destDir = resolve(root, 'public/wllama');
const dest = resolve(destDir, 'wllama.wasm');

if (!existsSync(wasmSrc)) {
  console.error('ERROR: wllama.wasm not found at', wasmSrc);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(wasmSrc, dest);
console.log('Copied wllama.wasm →', dest);
