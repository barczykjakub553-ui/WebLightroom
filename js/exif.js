/* Stopbath — minimal EXIF reader for JPEG files. */
(function () {
  'use strict';
  const LR = (window.LR = window.LR || {});

  const TAGS = {
    0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0132: 'dateTime', 0x0131: 'software', 0x013b: 'artist',
    0x829a: 'exposureTime', 0x829d: 'fNumber', 0x8827: 'iso', 0x9003: 'dateTimeOriginal', 0x9204: 'exposureBias',
    0x920a: 'focalLength', 0xa434: 'lensModel', 0xa405: 'focalLength35', 0x9209: 'flash', 0xa002: 'pixelX', 0xa003: 'pixelY',
  };

  function readIFD(view, tiff, offset, le, out, depth) {
    if (depth > 3 || offset + 2 > view.byteLength) return;
    const count = view.getUint16(offset, le);
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > view.byteLength) break;
      const tag = view.getUint16(e, le), type = view.getUint16(e + 2, le), n = view.getUint32(e + 4, le);
      if (tag === 0x8769) { readIFD(view, tiff, tiff + view.getUint32(e + 8, le), le, out, depth + 1); continue; }
      const name = TAGS[tag];
      if (!name) continue;
      try { out[name] = readValue(view, tiff, e, type, n, le); } catch (err) { /* ignore malformed tag */ }
    }
  }
  function readValue(view, tiff, e, type, n, le) {
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
    const p = size * n > 4 ? tiff + view.getUint32(e + 8, le) : e + 8;
    switch (type) {
      case 2: {
        let s = '';
        for (let i = 0; i < n - 1; i++) s += String.fromCharCode(view.getUint8(p + i));
        return s.replace(/\0+$/, '').trim();
      }
      case 3: return view.getUint16(p, le);
      case 4: return view.getUint32(p, le);
      case 9: return view.getInt32(p, le);
      case 5: return view.getUint32(p, le) / view.getUint32(p + 4, le);
      case 10: return view.getInt32(p, le) / view.getInt32(p + 4, le);
      default: return view.getUint8(p);
    }
  }

  async function read(blob) {
    const out = {};
    try {
      const buf = await blob.slice(0, 256 * 1024).arrayBuffer();
      const view = new DataView(buf);
      if (view.getUint16(0) !== 0xffd8) return out;
      let off = 2;
      while (off + 4 < view.byteLength) {
        const marker = view.getUint16(off);
        const len = view.getUint16(off + 2);
        if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966) {
          const tiff = off + 10;
          const le = view.getUint16(tiff) === 0x4949;
          readIFD(view, tiff, tiff + view.getUint32(tiff + 4, le), le, out, 0);
          break;
        }
        if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
        off += 2 + len;
      }
    } catch (e) { /* not fatal */ }
    return out;
  }

  function parseDate(s) {
    if (!s) return null;
    const m = s.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  function fmtShutter(t) {
    if (!t) return '';
    if (t >= 1) return t.toFixed(t % 1 ? 1 : 0) + ' s';
    return '1/' + Math.round(1 / t) + ' s';
  }

  LR.Exif = { read, parseDate, fmtShutter };
})();
