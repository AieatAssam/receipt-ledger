import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const dst = join(root, 'public', 'onnx');

if (!existsSync(src)) {
  console.error(`❌ ONNX Runtime source not found: ${src}`);
  process.exit(1);
}

mkdirSync(dst, { recursive: true });

const wasmFiles = readdirSync(src).filter(f => f.startsWith('ort-wasm-simd-threaded') && f.endsWith('.wasm'));

for (const f of wasmFiles) {
  const srcPath = join(src, f);
  const dstPath = join(dst, f);
  cpSync(srcPath, dstPath);
  const size = (statSync(dstPath).size / (1024 * 1024)).toFixed(1);
  console.log(`  ${f} (${size} MB)`);
}

console.log(`✅ Copied ${wasmFiles.length} ONNX Runtime WASM files to public/onnx/`);
