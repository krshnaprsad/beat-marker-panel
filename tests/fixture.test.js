// Private regression for a real, hat-heavy track with a beatless pad intro. The audio is not in the repo.
// Run with: BEAT_FIXTURE=/path/to/file.mp3 node tests/fixture.test.js   (skips when the file is missing)
const vm = require("vm"), sb = {}; vm.createContext(sb); vm.runInContext(require("fs").readFileSync(__dirname + "/../js/js-mp3.vendor.js", "utf8"), sb);
const fs = require("fs"), assert = require("assert"), D = require("../js/detect.js"), M = require("../js/mp3.js");
const p = process.env.BEAT_FIXTURE || __dirname + "/fixtures/videoplayback.mp3";
if (!fs.existsSync(p)) { console.log("fixture test skipped (no audio file)"); process.exit(0); }
const b = fs.readFileSync(p), dec = M.decodeMp3(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), sb.JsMp3);
const smp = dec.samples.subarray(2257); // the bundled decoder keeps the 2257 samples of encoder and decoder delay that ffmpeg trims
const fx = D.computeFlux(smp, dec.sampleRate), tp = D.estimateTempo(fx);
const bt = D.refineOnsets(D.trackBeats(fx, tp.bpm), smp, dec.sampleRate, 0.025);
assert.ok(Math.abs(tp.bpm - 122.5) < 2.5, "tempo " + tp.bpm);
assert.ok(bt.length >= 52 && bt.length <= 58, "beat count " + bt.length);
assert.ok(bt[0] > 2.4 && bt[0] < 3.1, "marks inside the pad intro: first at " + bt[0]);
// first beats from librosa's beat tracker on the same file; ours must sit within 45 ms of each
const ref = [2.79, 3.29, 3.77, 4.26, 4.75, 5.25, 5.74, 6.23, 6.72, 7.21, 7.71, 8.2, 8.68];
ref.forEach(r => assert.ok(bt.some(t => Math.abs(t - r) < 0.045), "no mark near " + r));
const iv = bt.slice(1).map((t, i) => t - bt[i]), steady = iv.filter(v => v > 0.44 && v < 0.54).length / iv.length;
assert.ok(steady > 0.9, "steady spacing share " + steady.toFixed(2));
// Kicks mode: all 50 kicks of this file, from its low-band flux (min gap 0.12 s, threshold 8x median), checked within 40 ms at the default slider
const gt = [0.21, 3.75, 3.99, 4.25, 4.40, 4.64, 4.98, 5.47, 5.71, 6.95, 7.19, 7.69, 7.93, 8.92, 9.40, 9.65, 10.88, 11.12, 11.38, 11.62, 11.87, 12.85, 13.34, 13.58, 14.81, 15.06, 15.56, 15.80, 16.79, 17.28, 17.52, 19.49, 19.74, 20.72, 21.21, 21.46, 22.69, 22.93, 23.42, 23.67, 24.66, 25.15, 25.39, 26.62, 26.87, 27.35, 27.60, 28.58, 29.08, 29.33];
const kk = D.refineOnsets(D.pickKicks(fx, 0.5), smp, dec.sampleRate, 0.02);
const found = gt.filter(x => kk.some(y => Math.abs(y - x) < 0.04)).length, prec = kk.filter(y => gt.some(x => Math.abs(y - x) < 0.04)).length / kk.length;
assert.ok(found >= 42, "kicks found " + found + "/50"); assert.ok(prec > 0.8, "kick precision " + prec.toFixed(2));
console.log("kicks", found + "/50", "precision", prec.toFixed(2), "marks", kk.length);
console.log("fixture ok: tempo", tp.bpm, "beats", bt.length, "first", bt[0].toFixed(2), "steady spacing", steady.toFixed(2));
