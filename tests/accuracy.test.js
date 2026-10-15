// node tests/accuracy.test.js  - beat TRACKING accuracy on generated music with known beat grids.
// Music: kick on 1+3, snare on 2+4, hats on 8ths (optionally swung), a bass note per bar, noise floor. Beat = quarter note.
const assert = require("assert"), D = require("../js/detect.js");
const SR = 44100;
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function music(bpm, dur, o) {
  o = o || {}; const r = rng(o.seed || 11), x = new Float32Array(Math.floor(dur * SR)), beats = [];
  for (let i = 0; i < x.length; i++) x[i] = (r() - 0.5) * (o.noise || 0.03);
  const add = (t, f) => { const s0 = Math.floor(t * SR); for (let i = 0; s0 + i < x.length && i < 0.3 * SR; i++) x[s0 + i] += f(i / SR); };
  const kick = a => t => a * 0.8 * Math.exp(-t * 28) * Math.sin(2 * Math.PI * (55 * t + 12 * (1 - Math.exp(-t * 40))) * 3.2);
  const snare = a => { const rr = rng(5 + (a * 100 | 0)); return t => a * 0.5 * (rr() - 0.5) * 2 * Math.exp(-t * 35); };
  const hat = a => { const rr = rng(9 + (a * 100 | 0)); return t => a * 0.25 * (rr() - 0.5) * 2 * Math.exp(-t * 110); };
  const bass = (f, a) => t => a * 0.25 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 4);
  let t = o.start || 0.3, k = 0, period = 60 / bpm;
  while (t < dur - 0.4) {
    const per = o.drift ? period * (1 + o.drift * Math.sin(k / 24)) : period;
    beats.push(t);
    const pos = k % 4;
    if (!o.noKick || pos === 0) { if (pos === 0 || pos === 2) add(t, kick(pos === 0 ? 1 : 0.8)); }
    if (pos === 1 || pos === 3) add(t, snare(0.9));
    if (pos === 0) add(t, bass(55 * Math.pow(2, (k / 4 % 3) / 12), 1));
    if (!o.noHats) { add(t, hat(0.7)); add(t + per * (o.swing || 0.5), hat(0.5)); }
    t += per; k++;
  }
  return { x, beats };
}
function score(det, truth, tol) {
  let hit = 0; const used = new Set();
  truth.forEach(t => { let bi = -1, bd = tol; det.forEach((d, i) => { if (!used.has(i) && Math.abs(d - t) <= bd) { bd = Math.abs(d - t); bi = i; } }); if (bi >= 0) { used.add(bi); hit++; } });
  const p = det.length ? hit / det.length : 0, rc = truth.length ? hit / truth.length : 0;
  return { p, r: rc, f: p + rc ? 2 * p * rc / (p + rc) : 0 };
}
const cases = [
  ["70 BPM straight", 70, { }], ["90 BPM straight", 90, {}], ["100 BPM swung 62%", 100, { swing: 0.62 }], ["120 BPM straight", 120, {}],
  ["128 BPM swung 66%", 128, { swing: 0.66 }], ["140 BPM straight", 140, {}], ["150 BPM no hats", 150, { noHats: true }], ["174 BPM straight", 174, {}],
  ["110 BPM noisy", 110, { noise: 0.12 }], ["120 BPM drifting +-4%", 120, { drift: 0.04 }], ["95 BPM kick only on 1", 95, { noKick: true, noHats: true }],
];
let fsum = 0, worst = 1, tempoOK = 0; const rows = [];
for (const [name, bpm, o] of cases) {
  const m = music(bpm, 40, o), fx = D.computeFlux(m.x, SR), tp = D.estimateTempo(fx);
  const oct = [1, 2, 0.5].some(f => Math.abs(tp.bpm - bpm * f) / (bpm * f) < 0.03), exact = Math.abs(tp.bpm - bpm) / bpm < 0.03;
  if (exact) tempoOK++;
  const beats = D.trackBeats(fx, tp.bpm), sc = score(beats, m.beats, 0.07), scOct = score(D.trackBeats(fx, bpm), m.beats, 0.07);
  rows.push(`${name.padEnd(26)} tempo ${String(tp.bpm).padStart(6)} ${exact ? "ok " : oct ? "oct" : "BAD"}  F@70ms ${sc.f.toFixed(3)}  (given true tempo: ${scOct.f.toFixed(3)})`);
  fsum += sc.f; worst = Math.min(worst, sc.f);
  assert.ok(oct, name + ": tempo " + tp.bpm);
}
console.log(rows.join("\n"));
console.log("mean F", (fsum / cases.length).toFixed(3), "worst", worst.toFixed(3), "tempo exact", tempoOK + "/" + cases.length);
assert.ok(fsum / cases.length > 0.9, "mean F too low");
// every-Nth lands on bar starts (kick on beat 1)
const m = music(120, 40, {}), fx = D.computeFlux(m.x, SR), bt = D.trackBeats(fx, D.estimateTempo(fx).bpm), bars = D.everyNth(bt, fx, 4);
const bar = score(bars, m.beats.filter((_, i) => i % 4 === 0), 0.07); console.log("bar starts F", bar.f.toFixed(3)); assert.ok(bar.f > 0.85);
console.log("accuracy tests passed");
