// node tests/detect.test.js  - runs beat detection on generated audio with known beat times.
const assert = require("assert");
const D = require("../js/detect.js"), W = require("../js/wav.js");
const SR = 44100;
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
// kick: decaying sine sweep; hat: noise burst; pad: constant tone + noise floor
function synth(times, dur, opts) {
  opts = opts || {}; const r = rng(7), x = new Float32Array(Math.floor(dur * SR));
  for (let i = 0; i < x.length; i++) x[i] = (opts.pad ? 0.08 * Math.sin(2 * Math.PI * 220 * i / SR) : 0) + (r() - 0.5) * (opts.noise || 0.02);
  times.forEach((t, k) => {
    const s0 = Math.floor(t * SR), strong = k % 4 === 0 ? 1 : 0.7;
    for (let i = 0; i < 0.12 * SR && s0 + i < x.length; i++) {
      const tt = i / SR; x[s0 + i] += strong * 0.8 * Math.exp(-tt * 30) * Math.sin(2 * Math.PI * (120 * tt + 40 * (1 - Math.exp(-tt * 40)) / 40 * 40));
      if (opts.hat) x[s0 + i] += 0.15 * (r() - 0.5) * Math.exp(-tt * 80);
    }
  });
  return x;
}
function score(det, truth, tol) {
  let hit = 0; const used = new Set();
  truth.forEach(t => { let bi = -1, bd = tol; det.forEach((d, i) => { if (!used.has(i) && Math.abs(d - t) <= bd) { bd = Math.abs(d - t); bi = i; } }); if (bi >= 0) { used.add(bi); hit++; } });
  const p = det.length ? hit / det.length : 0, rc = truth.length ? hit / truth.length : 0;
  return { p, r: rc, f: p + rc ? 2 * p * rc / (p + rc) : 0 };
}
// 1) steady 120 BPM, 16 s
let truth = []; for (let t = 0.5; t < 15.5; t += 0.5) truth.push(t);
let x = synth(truth, 16, { pad: true, hat: true }), fx = D.computeFlux(x, SR);
let det = D.pickBeats(fx, 0.5, 1), sc = score(det, truth, 0.05);
console.log("120bpm", det.length, "of", truth.length, JSON.stringify(sc)); assert.ok(sc.f > 0.9, "f-measure " + sc.f);
const bpm = D.estimateBPM(fx); console.log("bpm", bpm); assert.ok(Math.abs(bpm - 120) < 4 || Math.abs(bpm - 60) < 2 || Math.abs(bpm - 240) < 4, "bpm " + bpm);
// 2) irregular hits
const r = rng(3); truth = []; let t = 0.4; while (t < 18) { truth.push(t); t += 0.3 + r() * 0.7; }
x = synth(truth, 19, { noise: 0.04 }); fx = D.computeFlux(x, SR); det = D.pickBeats(fx, 0.6, 1); sc = score(det, truth, 0.05);
console.log("irregular", det.length, "of", truth.length, JSON.stringify(sc)); assert.ok(sc.f > 0.85, "irregular f " + sc.f);
// 3) sensitivity: low gives fewer or equal markers than high; everyNth thins out
const lo = D.pickBeats(fx, 0.1, 1).length, hi = D.pickBeats(fx, 0.9, 1).length, n2 = D.pickBeats(fx, 0.6, 2).length;
console.log("sens lo/hi", lo, hi, "every2", n2, "of", det.length); assert.ok(lo <= det.length && det.length <= hi && lo < hi + 1); assert.ok(n2 <= Math.ceil(det.length / 2));
// 4) silence -> no beats
assert.strictEqual(D.pickBeats(D.computeFlux(new Float32Array(SR * 5), SR), 1, 1).length, 0);
// 5) WAV roundtrip (16-bit stereo)
function wav16(x, ch) { const n = x.length, b = new ArrayBuffer(44 + n * 2 * ch), dv = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2 * ch, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2 * ch, true); dv.setUint16(32, 2 * ch, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 2 * ch, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) dv.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return b; }
const dec = W.decodeWav(wav16(x, 2)); assert.strictEqual(dec.sampleRate, SR); assert.strictEqual(dec.samples.length, x.length);
let err = 0; for (let i = 0; i < x.length; i += 997) err = Math.max(err, Math.abs(dec.samples[i] - x[i])); assert.ok(err < 1e-3, "wav err " + err);
det = D.pickBeats(D.computeFlux(dec.samples, dec.sampleRate), 0.6, 1); assert.ok(score(det, truth, 0.05).f > 0.85);
assert.throws(() => W.decodeWav(new ArrayBuffer(100)));
console.log("detect + wav tests passed");
