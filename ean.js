'use strict';
/* Eigene EAN-13- und EAN-8-Erkennung ohne fremde Bibliothek.
   Liest mehrere Linien quer durch das Bild, wandelt sie in Strich-Breiten um
   und vergleicht sie mit den Mustern des Barcode-Standards. */
const GrammEAN = (() => {
  const L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
  const G = L.map(p => p.slice().reverse());
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const MAX_ERR = 0.34;

  function matchDigit(w, tables, mod) {
    const sum = w[0] + w[1] + w[2] + w[3];
    if (!sum) return null;
    if (mod && (sum < mod * 7 * 0.7 || sum > mod * 7 * 1.3)) return null;
    const n = w.map(x => (x * 7) / sum);
    let best = null;
    for (const [name, table] of tables) {
      for (let d = 0; d < 10; d++) {
        const p = table[d];
        const err = (Math.abs(n[0] - p[0]) + Math.abs(n[1] - p[1]) + Math.abs(n[2] - p[2]) + Math.abs(n[3] - p[3])) / 4;
        if (!best || err < best.err) best = { d, set: name, err };
      }
    }
    return best && best.err < MAX_ERR ? best : null;
  }
  function guardOk(runs, i, k, mod) {
    for (let j = 0; j < k; j++) { const r = runs[i + j] / mod; if (r < 0.45 || r > 1.9) return false; }
    return true;
  }
  function checksum(digits) {
    let s = 0;
    const n = digits.length;
    for (let i = 0; i < n - 1; i++) s += digits[n - 2 - i] * (i % 2 === 0 ? 3 : 1);
    return (10 - (s % 10)) % 10 === digits[n - 1];
  }
  // runs: Breiten; firstDark: ob runs[0] dunkel ist
  function decodeRuns(runs, firstDark) {
    for (let i = 1; i < runs.length - 42; i++) {
      const dark = ((i % 2 === 0) === firstDark);
      if (!dark) continue;
      const mod = (runs[i] + runs[i + 1] + runs[i + 2]) / 3;
      if (mod < 0.9) continue;
      if (runs[i - 1] < mod * 2.5) continue; // Ruhezone vor dem Code
      if (!guardOk(runs, i, 3, mod)) continue;
      const r13 = tryEAN13(runs, i, mod);
      if (r13) return r13;
      const r8 = tryEAN8(runs, i, mod);
      if (r8) return r8;
    }
    return null;
  }
  function tryEAN13(runs, i, mod) {
    if (i + 59 > runs.length) return null;
    let p = i + 3;
    const left = [];
    let parity = '';
    for (let k = 0; k < 6; k++, p += 4) {
      const m = matchDigit(runs.slice(p, p + 4), [['L', L], ['G', G]], mod);
      if (!m) return null;
      left.push(m.d); parity += m.set;
    }
    const mid = runs.slice(p, p + 5).reduce((a, b) => a + b, 0) / 5;
    if (!guardOk(runs, p, 5, mid) || Math.abs(mid / mod - 1) > 0.5) return null;
    p += 5;
    const right = [];
    for (let k = 0; k < 6; k++, p += 4) {
      const m = matchDigit(runs.slice(p, p + 4), [['R', L]], mod);
      if (!m) return null;
      right.push(m.d);
    }
    if (!guardOk(runs, p, 3, mod)) return null;
    if (runs[p + 3] !== undefined && runs[p + 3] < mod * 2.5) return null;
    const first = PARITY.indexOf(parity);
    if (first < 0) return null;
    const digits = [first, ...left, ...right];
    return checksum(digits) ? digits.join('') : null;
  }
  function tryEAN8(runs, i, mod) {
    if (i + 43 > runs.length) return null;
    let p = i + 3;
    const ds = [];
    for (let k = 0; k < 4; k++, p += 4) {
      const m = matchDigit(runs.slice(p, p + 4), [['L', L]], mod);
      if (!m) return null;
      ds.push(m.d);
    }
    const mid = runs.slice(p, p + 5).reduce((a, b) => a + b, 0) / 5;
    if (!guardOk(runs, p, 5, mid) || Math.abs(mid / mod - 1) > 0.5) return null;
    p += 5;
    for (let k = 0; k < 4; k++, p += 4) {
      const m = matchDigit(runs.slice(p, p + 4), [['R', L]], mod);
      if (!m) return null;
      ds.push(m.d);
    }
    if (!guardOk(runs, p, 3, mod)) return null;
    if (runs[p + 3] !== undefined && runs[p + 3] < mod * 2.5) return null;
    return checksum(ds) ? ds.join('') : null;
  }
  // Eine Linie in Läufe zerlegen. Kanten = stärkste Helligkeitssprünge, auf Bruchteile eines Pixels genau.
  // Das klappt auch bei unscharfen Fotos besser als ein fester Schwellwert.
  function rowToRuns(line) {
    const n = line.length;
    let gmin = 255, gmax = 0;
    for (let x = 0; x < n; x++) { if (line[x] < gmin) gmin = line[x]; if (line[x] > gmax) gmax = line[x]; }
    if (gmax - gmin < 30) return null;
    const d = new Float32Array(n);
    for (let x = 0; x < n - 1; x++) d[x] = line[x + 1] - line[x];
    const minStep = (gmax - gmin) * 0.06;
    const raw = [];
    for (let x = 1; x < n - 2; x++) {
      const v = d[x], av = Math.abs(v);
      if (av < minStep) continue;
      if (av >= Math.abs(d[x - 1]) && av > Math.abs(d[x + 1])) {
        const a = Math.abs(d[x - 1]), c = Math.abs(d[x + 1]);
        const den = a - 2 * av + c;
        const off = den ? 0.5 * (a - c) / den : 0;
        raw.push({ pos: x + 0.5 + Math.max(-0.5, Math.min(0.5, off)), s: Math.sign(v), m: av });
      }
    }
    // Vorzeichen müssen sich abwechseln, sonst die stärkere Kante behalten
    const edges = [];
    for (const e of raw) {
      const last = edges[edges.length - 1];
      if (last && last.s === e.s) { if (e.m > last.m) edges[edges.length - 1] = e; }
      else edges.push(e);
    }
    if (edges.length < 40) return null;
    const firstDark = edges[0].s < 0; // hell nach dunkel
    const runs = [edges[0].pos];
    // runs[0] ist der Bereich vor der ersten Kante, Farbe dort ist das Gegenteil
    for (let i = 1; i < edges.length; i++) runs.push(edges[i].pos - edges[i - 1].pos);
    runs.push(n - edges[edges.length - 1].pos);
    return { runs, firstDark: !firstDark };
  }
  function smooth(line) {
    const n = line.length, o = new Float32Array(n);
    for (let x = 0; x < n; x++) o[x] = (line[Math.max(0, x - 1)] + 2 * line[x] + line[Math.min(n - 1, x + 1)]) / 4;
    return o;
  }
  function decodeLine(line) {
    return decodeLineRaw(line) || decodeLineRaw(smooth(line));
  }
  function decodeLineRaw(line) {
    const r = rowToRuns(line);
    if (!r || r.runs.length < 45) return null;
    const fwd = decodeRuns(r.runs, r.firstDark);
    if (fwd) return fwd;
    const rev = r.runs.slice().reverse();
    const lastDark = (r.runs.length % 2 === 1) === r.firstDark;
    return decodeRuns(rev, lastDark);
  }
  // Graustufen aus ImageData
  function gray(img) {
    const { data, width, height } = img;
    const g = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    return { g, width, height };
  }
  // Durchsucht ein Bild, waagerecht und optional senkrecht
  function decodeImageData(img, { vertical = false, lines = 24, need = 2 } = {}) {
    const { g, width, height } = gray(img);
    const votes = new Map();
    const take = code => { const v = (votes.get(code) || 0) + 1; votes.set(code, v); return v >= need ? code : null; };
    const row = new Float32Array(width);
    for (let k = 0; k < lines; k++) {
      const y = Math.round(height * (0.15 + 0.7 * (k / Math.max(1, lines - 1))));
      // mehrere Zeilen mitteln: Striche sind senkrecht, Rauschen nicht
      const y0 = Math.max(0, y - 2), y1 = Math.min(height - 1, y + 2), cnt = y1 - y0 + 1;
      for (let x = 0; x < width; x++) { let s = 0; for (let yy = y0; yy <= y1; yy++) s += g[yy * width + x]; row[x] = s / cnt; }
      const c = decodeLine(row);
      if (c && take(c)) return c;
    }
    if (vertical) {
      const col = new Float32Array(height);
      for (let k = 0; k < lines; k++) {
        const x = Math.round(width * (0.15 + 0.7 * (k / Math.max(1, lines - 1))));
        const x0 = Math.max(0, x - 2), x1 = Math.min(width - 1, x + 2), cnt = x1 - x0 + 1;
        for (let y = 0; y < height; y++) { let s = 0; for (let xx = x0; xx <= x1; xx++) s += g[y * width + xx]; col[y] = s / cnt; }
        const c = decodeLine(col);
        if (c && take(c)) return c;
      }
    }
    return null;
  }
  function decodeCanvas(canvas, opts) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), opts);
  }
  return { decodeCanvas, decodeImageData, decodeLine, _checksum: checksum };
})();
if (typeof module !== 'undefined') module.exports = GrammEAN;
