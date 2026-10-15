// node tests/mp3.test.js - decodes an MP3 made by ffmpeg (if installed) and compares it with ffmpeg's own decode.
const fs = require("fs"), cp = require("child_process"), vm = require("vm"), assert = require("assert"), os = require("os"), path = require("path");
const sandbox = {}; vm.createContext(sandbox); vm.runInContext(fs.readFileSync(__dirname + "/../js/js-mp3.vendor.js", "utf8"), sandbox);
const Mp3Dec = require("../js/mp3.js"), Wav = require("../js/wav.js");
try { cp.execSync("ffmpeg -version", { stdio: "ignore" }); } catch (e) { console.log("ffmpeg not installed, MP3 test skipped"); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp3t-"));
// 20 s of kicks every 0.5 s (120 BPM) plus a tone, 44.1 kHz and 48 kHz, CBR and VBR
const expr = "aevalsrc='0.6*sin(2*PI*55*t)*exp(-12*mod(t,0.5))+0.1*sin(2*PI*440*t)':d=20:s=44100";
function enc(name, args) { cp.execSync(`ffmpeg -y -loglevel error -f lavfi -i "${expr}" ${args} ${dir}/${name}`); }
enc("a.mp3", "-ac 2 -b:a 128k"); enc("b.mp3", "-ac 1 -ar 48000 -q:a 4"); enc("c.mp3", "-ac 2 -ar 32000 -b:a 96k");
for (const f of ["a", "b", "c"]) {
  cp.execSync(`ffmpeg -y -loglevel error -i ${dir}/${f}.mp3 -ac 1 -f wav ${dir}/${f}.ref.wav`);
  const t0 = Date.now(), mine = Mp3Dec.decodeMp3(fs.readFileSync(`${dir}/${f}.mp3`).buffer.slice(0), sandbox.JsMp3);
  const raw = fs.readFileSync(`${dir}/${f}.ref.wav`), ref = Wav.decodeWav(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  assert.strictEqual(mine.sampleRate, ref.sampleRate);
  // alignment: decoders differ by the encoder delay, so search a small lag range
  let best = 0, bestLag = 0;
  for (let lag = -3000; lag <= 3000; lag += 1) {
    let num = 0, da = 0, db = 0; for (let i = 20000; i < 60000; i += 3) { const a = mine.samples[i + lag] || 0, b = ref.samples[i]; num += a * b; da += a * a; db += b * b; }
    const c = num / Math.sqrt(da * db + 1e-12); if (c > best) { best = c; bestLag = lag; }
  }
  console.log(f + ".mp3", "rate", mine.sampleRate, "samples", mine.samples.length, "ref", ref.samples.length, "corr", best.toFixed(4), "lag", bestLag, (Date.now() - t0) + " ms");
  assert.ok(best > 0.99, "decoded audio does not match the reference");
  assert.ok(Math.abs(mine.samples.length - ref.samples.length) < 6000);
}
assert.throws(() => Mp3Dec.decodeMp3(new ArrayBuffer(1000), sandbox.JsMp3));
console.log("mp3 tests passed");
