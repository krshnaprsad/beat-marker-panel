(function () {
  function $(s) { return document.querySelector(s); }
  var fileIn = $("#file"), fileLabel = $("#fileLabel"), canvas = $("#wave"), sens = $("#sens"), sensVal = $("#sensVal"), nth = $("#nth"),
      offsetIn = $("#offset"), bpmIn = $("#bpmIn"), sensRow = $("#sensRow"), tempoRow = $("#tempoRow"), modeBtns = document.querySelectorAll("#mode button"), playBtn = $("#play"), addBtn = $("#add"), statusEl = $("#status"), warnEl = $("#warn"), countEl = $("#count");
  var NAMES = { PPRO: "Premiere Pro", AEFT: "After Effects", none: "Demo" };
  var audio = null;       // { samples, sampleRate, duration, buffer, peaks, flux, bpm, name }
  var mode = "beats", beats = [], ctx = null, src = null, playStart = 0, raf = 0;

  function setStatus(t) { statusEl.textContent = t; }
  function setWarn(t) { warnEl.textContent = t || ""; }
  function audioCtx() { if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } return ctx; }

  // ---------- decoding ----------
  function toMono(buf) {
    var n = buf.length, out = new Float32Array(n), c, i, ch = buf.numberOfChannels;
    for (c = 0; c < ch; c++) { var d = buf.getChannelData(c); for (i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  }
  function decode(arrayBuf, name, cb) {
    var c = audioCtx(), isWav = /\.wav$/i.test(name) || String.fromCharCode.apply(null, new Uint8Array(arrayBuf, 0, 4)) === "RIFF";
    function viaWav(why) {
      try {
        var w = Wav.decodeWav(arrayBuf);
        var buf = null; if (c) { buf = c.createBuffer(1, w.samples.length, w.sampleRate); buf.getChannelData(0).set(w.samples); }
        cb(null, { samples: w.samples, sampleRate: w.sampleRate, buffer: buf });
      } catch (e) {
        cb(why ? "This file could not be decoded here (" + why + "). Convert it to a WAV file and try again." : e.message);
      }
    }
    if (!c || !c.decodeAudioData) return isWav ? viaWav("") : cb("This host cannot decode audio. Use a WAV file.");
    var done = false;
    function ok(buf) { if (done) return; done = true; cb(null, { samples: toMono(buf), sampleRate: buf.sampleRate, buffer: buf }); }
    function fail(e) { if (done) return; done = true; if (isWav) viaWav(""); else viaWav("format not supported by this app's audio engine"); }
    try { var p = c.decodeAudioData(arrayBuf.slice(0), ok, fail); if (p && p.then) p.then(ok, fail); } catch (e) { fail(e); }
  }

  // ---------- analysis ----------
  function analyze(decoded, name) {
    setStatus("Analyzing...");
    setTimeout(function () {
      try {
        var fx = Detect.computeFlux(decoded.samples, decoded.sampleRate);
        audio = { samples: decoded.samples, sampleRate: decoded.sampleRate, buffer: decoded.buffer, duration: fx.duration, flux: fx, tempo: Detect.estimateTempo(fx), peaks: Detect.waveformPeaks(decoded.samples, 640), name: name };
        fileLabel.textContent = name;
        playBtn.disabled = false; addBtn.disabled = false;
        recompute();
        setStatus(audio.duration.toFixed(1) + " s analyzed. Check the tempo, then Add markers.");
      } catch (e) { setStatus("Something went wrong."); setWarn(String(e)); }
    }, 30);
  }
  var bpm = 0;
  function recompute(keepTempo) {
    if (!audio) return;
    var n = parseInt(nth.value, 10);
    if (mode === "beats") {
      if (!keepTempo) bpm = audio.tempo.bpm;
      bpmIn.value = bpm ? String(Math.round(bpm * 10) / 10) : "";
      if (!bpm) { beats = []; countEl.textContent = "No steady beat found. Try Every hit."; draw(0); return; }
      beats = Detect.everyNth(Detect.trackBeats(audio.flux, bpm), audio.flux, n);
    } else {
      beats = Detect.pickBeats(audio.flux, sens.value / 100, n);
    }
    countEl.textContent = beats.length + (mode === "beats" ? " beats" : " hits") + (mode === "beats" && audio.tempo.confidence < 0.15 ? "  (weak rhythm, check the tempo)" : "");
    if (beats.length === 1) countEl.textContent = countEl.textContent.replace("beats", "beat").replace("hits", "hit");
    draw(0);
  }
  function setMode(m) {
    mode = m;
    for (var i = 0; i < modeBtns.length; i++) modeBtns[i].className = modeBtns[i].getAttribute("data-m") === m ? "on" : "";
    sensRow.style.display = m === "hits" ? "flex" : "none"; tempoRow.style.display = m === "beats" ? "flex" : "none";
    recompute();
  }

  // ---------- drawing ----------
  function draw(playPos) {
    var g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, mid = H / 2, i;
    g.clearRect(0, 0, W, H); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    if (!audio) { g.fillStyle = "#555"; g.font = "20px sans-serif"; g.textAlign = "center"; g.fillText("waveform appears here", W / 2, mid + 7); return; }
    var p = audio.peaks, buckets = p.length / 2, top = 0;
    for (i = 0; i < buckets; i++) { top = Math.max(top, -p[i * 2], p[i * 2 + 1]); }
    var sc = top > 0 ? (H / 2 - 8) / top : 1;
    g.fillStyle = "#6d8fb8";
    for (i = 0; i < buckets; i++) { var x = i * W / buckets, y1 = mid - p[i * 2 + 1] * sc, y2 = mid - p[i * 2] * sc; g.fillRect(x, y1, Math.max(1, W / buckets), Math.max(1, y2 - y1)); }
    g.fillStyle = "#ffd23f";
    for (i = 0; i < beats.length; i++) { var bx = Math.round(beats[i] / audio.duration * W); g.fillRect(bx - 1, 0, 2, H); }
    if (playPos > 0) { var px = playPos / audio.duration * W; g.fillStyle = "#ffffff"; g.fillRect(px - 1.5, 0, 3, H); }
  }

  // ---------- playback ----------
  function stop() { if (src) { try { src.stop(); } catch (e) {} src = null; } cancelAnimationFrame(raf); playBtn.textContent = "Play"; draw(0); }
  function play() {
    if (src) { stop(); return; }
    var c = audioCtx(); if (!audio || !audio.buffer || !c) { setWarn("Playback is not available for this file here."); return; }
    try { if (c.state === "suspended") c.resume(); } catch (e) {}
    src = c.createBufferSource(); src.buffer = audio.buffer; src.connect(c.destination);
    src.onended = function () { if (src) stop(); };
    playStart = c.currentTime; src.start(0); playBtn.textContent = "Stop";
    (function tick() { if (!src) return; draw(c.currentTime - playStart); raf = requestAnimationFrame(tick); })();
  }

  // ---------- host ----------
  function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function run(fn, args, cb) {
    Bridge.evalScript(fn + "(" + args.join(",") + ")", function (res) {
      var r = String(res || "").split("|");
      if (r[0] === "OK") cb(r.slice(1));
      else { setStatus("Something went wrong."); setWarn(r.slice(1).join("|") || String(res)); }
    });
  }
  function offsetValue() { var v = parseFloat(String(offsetIn.value).replace(",", ".")); return isNaN(v) ? 0 : v; }
  function addMarkers() {
    if (!audio || !beats.length) { setWarn("Pick a song first."); return; }
    if (!Bridge.hasHost) { setStatus("Demo: " + beats.length + " markers would be added."); return; }
    setWarn(""); addBtn.disabled = true;
    var off = offsetValue(), i = 0, added = 0, skipped = 0, removed = 0, CH = 150;
    (function next() {
      if (i >= beats.length) {
        addBtn.disabled = false; setStatus(added + " markers added" + (removed ? " (" + removed + " older beat markers replaced)" : "") + ".");
        setWarn(skipped ? skipped + " beats fell outside the " + (Bridge.hostName() === "AEFT" ? "composition" : "sequence") + " and were skipped." : "");
        return;
      }
      var chunk = beats.slice(i, i + CH).map(function (t) { return t.toFixed(3); }).join(",");
      Bridge.evalScript("bmAdd(" + q(chunk) + "," + off + "," + (i + 1) + "," + (i === 0 ? 1 : 0) + ")", function (res) {
        var r = String(res || "").split("|");
        if (r[0] !== "OK") { addBtn.disabled = false; setStatus("Something went wrong."); setWarn(r.slice(1).join("|") || String(res)); return; }
        added += +r[1]; skipped += +r[2]; removed += +r[3]; i += CH; next();
      });
    })();
  }

  // ---------- wiring ----------
  function loadFile(f) {
    if (!f) return;
    stop(); setWarn(""); setStatus("Reading " + f.name + "...");
    var fr = new FileReader();
    fr.onerror = function () { setStatus("Something went wrong."); setWarn("Could not read that file."); };
    fr.onload = function () {
      setStatus("Decoding...");
      decode(fr.result, f.name, function (err, d) { if (err) { setStatus("Something went wrong."); setWarn(err); return; } analyze(d, f.name); });
    };
    fr.readAsArrayBuffer(f);
  }
  fileIn.addEventListener("change", function () { loadFile(fileIn.files[0]); });
  var drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.className = "file over"; }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.className = "file"; }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  sens.addEventListener("input", function () { sensVal.textContent = sens.value; recompute(true); });
  for (var mi = 0; mi < modeBtns.length; mi++) (function (b) { b.addEventListener("click", function () { setMode(b.getAttribute("data-m")); }); })(modeBtns[mi]);
  function setBpm(v) { if (!audio || !(v >= 30 && v <= 300)) return; bpm = v; recompute(true); }
  bpmIn.addEventListener("change", function () { setBpm(parseFloat(String(bpmIn.value).replace(",", "."))); });
  $("#half").addEventListener("click", function () { setBpm(bpm / 2); });
  $("#dbl").addEventListener("click", function () { setBpm(bpm * 2); });
  nth.addEventListener("change", function () { recompute(true); });
  playBtn.addEventListener("click", play);
  addBtn.addEventListener("click", addMarkers);
  $("#clear").addEventListener("click", function () {
    if (!Bridge.hasHost) { setStatus("Demo: beat markers would be cleared."); return; }
    setWarn(""); run("bmClear", [], function (r) { setStatus(r[0] + " beat markers cleared."); });
  });
  $("#playhead").addEventListener("click", function () {
    if (!Bridge.hasHost) { setStatus("Demo: would use the current time indicator."); return; }
    setWarn(""); run("bmInfo", [], function (r) { var t = parseFloat(r[2]); offsetIn.value = isNaN(t) ? 0 : (Math.round(t * 1000) / 1000); setStatus("Audio start set to " + offsetIn.value + " s."); });
  });

  // demo track: 120 BPM kicks + hats, so the panel can be tried without a song
  function demoTrack() {
    var sr = 44100, n = sr * 16, x = new Float32Array(n), t, i, seed = 5;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; }
    for (i = 0; i < n; i++) x[i] = rnd() * 0.02;
    for (t = 0.5; t < 15.5; t += 0.5) {
      var s0 = Math.floor(t * sr), k = Math.round(t / 0.5) % 4 === 0 ? 1 : 0.7;
      for (i = 0; i < 0.12 * sr; i++) { var tt = i / sr; x[s0 + i] += k * 0.8 * Math.exp(-tt * 30) * Math.sin(2 * Math.PI * (120 * tt + 40 * (1 - Math.exp(-tt * 40)))) + 0.15 * rnd() * Math.exp(-tt * 80); }
    }
    var c = audioCtx(), buf = null; if (c) { buf = c.createBuffer(1, n, sr); buf.getChannelData(0).set(x); }
    return { samples: x, sampleRate: sr, buffer: buf };
  }
  var demo = $("#demo"); demo.style.display = "block";
  demo.addEventListener("click", function () { stop(); setWarn(""); analyze(demoTrack(), "demo-120bpm.wav"); });

  $("#host").textContent = NAMES[Bridge.hostName()] || Bridge.hostName();
  draw(0);
  if (!Bridge.hasHost) { addBtn.title = "Open this panel inside Premiere Pro or After Effects to write markers"; }
  window.onerror = function (m) { setStatus("Something went wrong."); setWarn(String(m)); };
  window.BeatPanel = { demo: function () { analyze(demoTrack(), "demo-120bpm.wav"); }, setSens: function (v) { sens.value = v; sensVal.textContent = v; recompute(true); }, setMode: setMode };
})();
