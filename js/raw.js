/* Stopbath — camera RAW support (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, …).
 *
 * Decoding uses LibRaw compiled to WebAssembly (vendor/libraw), which runs in its own worker.
 * The sensor data is demosaiced to 16-bit *linear* RGB with the camera white balance, then
 * rendered through a base tone curve that keeps highlight headroom: values above 1.0 survive
 * into a half-float texture, so Exposure / Highlights can still recover them in Develop.
 */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});

  const EXTS = '3fr ari arw bay cap cr2 cr3 crw dcr dcs dng drf eip erf fff gpr iiq k25 kdc mdc mef mos mrw nef nrw orf pef ptx raf raw rw2 rwl sr2 srf srw x3f'.split(' ');
  const EXT = new RegExp('\\.(' + EXTS.join('|') + ')$', 'i');
  const ACCEPT = EXTS.map((e) => '.' + e).join(','); // for <input type=file accept>
  const isRaw = (nameOrPhoto) => EXT.test(typeof nameOrPhoto === 'string' ? nameOrPhoto : nameOrPhoto.name || '');
  const supported = () => !!window.crossOriginIsolated && typeof WebAssembly === 'object';

  /* ---------- decoder instance (one worker, calls serialized) ---------- */
  let modP = null, inst = null, queue = Promise.resolve();
  async function decoder() {
    if (!supported()) throw new Error('RAW decoding needs cross-origin isolation — start Stopbath with "python serve.py"');
    if (!modP) modP = import(new URL('vendor/libraw/index.js', document.baseURI).href).then((m) => m.default);
    const LibRaw = await modP;
    if (!inst) inst = new LibRaw();
    return inst;
  }
  // Run fn(lr) exclusively: open() + imageData() pairs must not interleave.
  function exclusive(fn) {
    const run = queue.then(async () => {
      const lr = await decoder();
      try { return await fn(lr); } catch (e) {
        // a crashed worker is unusable: start fresh next time
        try { inst.dispose(); } catch (_) { /* already gone */ }
        inst = null;
        throw e;
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  /* ---------- tone rendering ---------- */
  const GAIN = 1.6; // ≈ +0.7 EV: camera-JPEG-like brightness for linear sensor data
  const enc = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  function base(x) { // gentle S on the display range, untouched above 1.0 (headroom)
    const e = enc(x);
    return e < 1 ? e + 0.6 * e * (1 - e) * (e - 0.5) : e;
  }
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function toHalf(v) {
    f32[0] = v;
    const x = u32[0], sign = (x >> 16) & 0x8000;
    const e = ((x >> 23) & 0xff) - 112;
    let m = x & 0x7fffff;
    if (e <= 0) { if (e < -10) return sign; m = (m | 0x800000) >> (1 - e); return sign | ((m + 0x1000) >> 13); }
    if (e >= 31) return sign | 0x7c00;
    return sign | (e << 10) | ((m + 0x1000) >> 13);
  }
  let LUT16 = null, LUT8 = null;
  function luts() {
    if (!LUT16) {
      LUT16 = new Uint16Array(65536);
      LUT8 = new Uint8Array(65536);
      for (let i = 0; i < 65536; i++) {
        const v = base((i / 65535) * GAIN);
        LUT16[i] = toHalf(v);
        LUT8[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }

  /** Area-average downscale of interleaved 16-bit RGB(+) data. */
  function downscale(src, w, h, ch, tw, th) {
    if (tw === w && th === h && ch === 3) return src;
    const out = new Uint16Array(tw * th * 3);
    const sx = w / tw, sy = h / th;
    for (let y = 0; y < th; y++) {
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < tw; x++) {
        const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let r = 0, g = 0, b = 0;
        for (let yy = y0; yy < y1; yy++) {
          let j = (yy * w + x0) * ch;
          for (let xx = x0; xx < x1; xx++, j += ch) { r += src[j]; g += src[j + 1]; b += src[j + 2]; }
        }
        const n = (y1 - y0) * (x1 - x0), o = (y * tw + x) * 3;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
      }
    }
    return out;
  }

  /** A decoded RAW ready for the engine: half-float RGBA + a lazily built 8-bit canvas. */
  function makeImage(rgb, w, h) {
    luts();
    const n = w * h;
    const half = new Uint16Array(n * 4), rgba8 = new Uint8ClampedArray(n * 4);
    const one = toHalf(1);
    for (let i = 0, j = 0, o = 0; i < n; i++, j += 3, o += 4) {
      const r = rgb[j], g = rgb[j + 1], b = rgb[j + 2];
      half[o] = LUT16[r]; half[o + 1] = LUT16[g]; half[o + 2] = LUT16[b]; half[o + 3] = one;
      rgba8[o] = LUT8[r]; rgba8[o + 1] = LUT8[g]; rgba8[o + 2] = LUT8[b]; rgba8[o + 3] = 255;
    }
    let canvas = null;
    return {
      isRaw: true, width: w, height: h, half,
      /** 8-bit sRGB canvas for 2D-canvas consumers (pickers, statistics). */
      get drawable() {
        if (!canvas) {
          canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').putImageData(new ImageData(rgba8, w, h), 0, 0);
        }
        return canvas;
      },
      close() { canvas = null; },
    };
  }

  /* ---------- public API ---------- */
  const OPEN = { outputBps: 16, outputColor: 1, useCameraWb: true, noAutoBright: true, gamm: [1, 1], highlight: 0, userQual: 3 };
  let full = null; // last full-resolution decode { key, w, h, ch, data }

  /** Decode `blob` to fit `maxLong` (long edge, px). `key` identifies the file for caching. */
  async function decode(blob, maxLong, key, size) {
    const long = size ? Math.max(size.w, size.h) : Infinity;
    const useHalf = maxLong * 2 <= long; // previews and thumbnails: fast half-size decode
    let src;
    if (!useHalf && full && full.key === key) src = full;
    else {
      src = await exclusive(async (lr) => {
        await lr.open(new Uint8Array(await blob.arrayBuffer()), Object.assign({ halfSize: useHalf }, OPEN));
        const img = await lr.imageData();
        if (!img || !img.data) throw new Error('The RAW decoder returned no image');
        const data = img.data instanceof Uint16Array ? img.data : new Uint16Array(img.data.buffer, img.data.byteOffset, img.data.byteLength >> 1);
        return { key, w: img.width, h: img.height, ch: img.colors || 3, data };
      });
      if (!useHalf) full = src;
    }
    const s = Math.min(1, maxLong / Math.max(src.w, src.h));
    const tw = Math.max(1, Math.round(src.w * s)), th = Math.max(1, Math.round(src.h * s));
    return makeImage(downscale(src.data, src.w, src.h, src.ch, tw, th), tw, th);
  }

  const pad = (n) => String(n).padStart(2, '0');
  /** Metadata for import: oriented size + EXIF in the same shape as LR.Exif.read. */
  async function inspect(blob) {
    const meta = await exclusive(async (lr) => {
      await lr.open(new Uint8Array(await blob.arrayBuffer()), {});
      return lr.metadata(true);
    });
    const swap = meta.flip === 5 || meta.flip === 6;
    const t = meta.timestamp instanceof Date && !isNaN(meta.timestamp) ? meta.timestamp : null;
    const exif = {
      make: meta.camera_make || undefined, model: meta.camera_model || undefined,
      iso: meta.iso_speed || undefined, exposureTime: meta.shutter || undefined,
      fNumber: meta.aperture || undefined, focalLength: meta.focal_len || undefined,
      lensModel: (meta.lens && (meta.lens.Lens || meta.lens.lens)) || undefined,
      artist: meta.artist || undefined,
      dateTimeOriginal: t ? `${t.getFullYear()}:${pad(t.getMonth() + 1)}:${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}` : undefined,
    };
    for (const k of Object.keys(exif)) {
      if (typeof exif[k] === 'string') exif[k] = exif[k].replace(/\s+/g, ' ').trim();
      if (exif[k] === undefined || exif[k] === '') delete exif[k];
    }
    return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height, exif };
  }

  LR.Raw = { EXT, ACCEPT, isRaw, supported, decode, inspect };
})();
