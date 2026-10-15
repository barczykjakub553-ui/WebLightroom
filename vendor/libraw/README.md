# libraw-wasm 1.6.0

Vendored from https://www.npmjs.com/package/libraw-wasm (ISC, (c) ybouane and contributors),
a WebAssembly build of LibRaw (https://www.libraw.org/, LGPL-2.1 / CDDL-1.0).

Served from our own origin because the decoder starts module workers and uses
SharedArrayBuffer, which requires cross-origin isolation (see serve.py and coi-sw.js).
