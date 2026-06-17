#!/bin/bash
# Copy ONNX Runtime WASM + JS glue files from node_modules to public/
# so they're bundled with the app at the correct version.
set -euo pipefail

SRC="node_modules/onnxruntime-web/dist"
DST="public/onnx"

mkdir -p "$DST"
cp "$SRC"/ort-wasm-simd-threaded*.{wasm,mjs} "$DST"/ 2>/dev/null || true

echo "✅ ONNX Runtime files copied to $DST/"
ls -la "$DST"/
