// Pad intro is left unmarked, hat-heavy material keeps a sane density, and refined beats land on the attack.
const assert = require("assert"), D = require("../js/detect.js");
const SR = 44100;
function rng(s) { return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function make(bpm, dur, introSec) {
  const r = rng(5), x = new Float32Array(dur * SR), q = 60 / bpm, truth = [];
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] = (r() - 0.5) * 0.01 + (t < introSec ? 0.12 * Math.sin(2 * Math.PI * 220 * t) * Math.min(1, t) : 0.0); }
  const add = (t, f) => { const s0 = Math.round(t * SR); for (let i = 0; s0 + i < x.length && i < 0.25 * SR; i++) x[s0 + i] += f(i / SR); };
  let k = 0;
  for (let t = introSec + 0.2; t < dur - 0.3; t += q / 4, k++) {
    if (k % 4 === 0) { add(t, tt => 0.8 * Math.exp(-tt * 28) * Math.sin(2 * Math.PI * (55 * tt + 10 * (1 - Math.exp(-tt * 40))) * 3)); truth.push(t); }
    const rr = rng(k + 11); add(t, tt => 0.25 * (rr() - 0.5) * 2 * Math.exp(-tt * 120));
  }
  return { x, truth };
}
const m = make(120, 30, 4), fx = D.computeFlux(m.x, SR), tp = D.estimateTempo(fx);
assert.ok([1, 2, 0.5].some(f => Math.abs(tp.bpm - 120 * f) / (120 * f) < 0.04), "tempo " + tp.bpm);
const bt = D.refineOnsets(D.trackBeats(fx, tp.bpm), m.x, SR, 0.025);
const early = bt.filter(t => t < 3.5).length;
assert.ok(early <= 1, "beats inside the pad intro: " + early);
const dens = bt.length / 30; assert.ok(dens < 4.5, "density " + dens);
let near = 0; bt.forEach(t => { if (m.truth.some(u => Math.abs(u - t) < 0.025)) near++; });
assert.ok(near / bt.length > 0.8 || tp.bpm < 100, "on-attack rate " + (near / bt.length).toFixed(2));
console.log("robust ok: tempo", tp.bpm, "beats", bt.length, "intro beats", early, "on-attack", (near / bt.length).toFixed(2));
// Kicks mode: syncopated kicks (a double hit 0.24 s apart) among loud hats; every kick found, hats not marked.
{
  const r2 = rng(9), x = new Float32Array(20 * SR), kicks = [];
  for (let i = 0; i < x.length; i++) x[i] = (r2() - 0.5) * 0.01;
  const add = (t, f) => { const s0 = Math.round(t * SR); for (let i = 0; s0 + i < x.length && i < 0.25 * SR; i++) x[s0 + i] += f(i / SR); };
  for (let bar = 0; bar < 9; bar++) { const b0 = 1 + bar * 2; [0, 0.5, 0.74, 1.5].forEach(o => kicks.push(b0 + o)); }
  kicks.forEach(t => add(t, tt => 0.8 * Math.exp(-tt * 25) * Math.sin(2 * Math.PI * (50 * tt + 10 * (1 - Math.exp(-tt * 40))) * 3)));
  for (let t = 1; t < 19; t += 0.12) { const rr = rng(Math.round(t * 1000)); add(t, tt => 0.12 * (rr() - 0.5) * 2 * Math.exp(-tt * 110)); }
  const f2 = D.computeFlux(x, SR), kk = D.refineOnsets(D.pickKicks(f2, 0.7), x, SR, 0.02);
  const kin = kicks.filter(t => t < 19), got = kin.filter(t => kk.some(y => Math.abs(y - t) < 0.03)).length;
  assert.ok(got >= 0.85 * kin.length, "kicks found " + got + "/" + kin.length);
  assert.ok(kk.length <= kin.length * 1.3, "extra marks: " + kk.length + " for " + kin.length + " kicks");
  console.log("kicks ok", got + "/" + kin.length, "marks", kk.length);
}
