(function () {
  function $(s) { return document.querySelector(s); }
  function num(el, d) { var v = parseFloat(String(el.value).replace(",", ".")); return isNaN(v) ? d : v; }
  var canvas = $("#wave"), statusEl = $("#status"), warnEl = $("#warn"), playBtn = $("#play"), addBtn = $("#add"), autoBtn = $("#auto"), cutBtn = $("#cutBtn");
  var modeBtns = document.querySelectorAll("#mode button"), subBtns = document.querySelectorAll("#sub button");
  var NAMES = { PPRO: "Premiere Pro", AEFT: "After Effects", none: "Demo" };
  var HOSTWORD = function () { return Bridge.hostName() === "AEFT" ? "composition" : "sequence"; };

  // ---------- state ----------
  var audio = null;        // { samples, sampleRate, buffer, duration, flux, tempo, peaks, name }
  var src = null;          // { kind: "file" | "clip", path, srcIn, srcOut }  clip = taken from a timeline clip
  var off = 0;             // timeline time of audio t = 0
  var mode = "beats", bpm = 0, subK = 1;
  var added = [], removed = [];       // manual edits, in audio seconds
  var range = null;                   // { a, b } in audio seconds
  var view = { start: 0, span: 1 };
  var cursor = 0;                     // play position, audio seconds
  var ctx = null, node = null, gain = null, playStart = 0, playFrom = 0, raf = 0;
  var baseBeats = [], edited = [], selected = [], finalBeats = [];

  function setStatus(t) { statusEl.textContent = t; }
  function setWarn(t) { warnEl.textContent = t || ""; }
  function audioCtx() { if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } return ctx; }
  function fmt(t) { t = Math.max(0, t); var m = Math.floor(t / 60); return m + ":" + (t - m * 60 < 10 ? "0" : "") + (t - m * 60).toFixed(1); }

  // ---------- decoding ----------
  function toMono(buf) {
    var n = buf.length, out = new Float32Array(n), c, i, ch = buf.numberOfChannels;
    for (c = 0; c < ch; c++) { var d = buf.getChannelData(c); for (i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  }
  function looksMp3(arrayBuf, name) {
    if (arrayBuf.byteLength < 4) return false; var u = new Uint8Array(arrayBuf, 0, 3);
    return /\.mp3$/i.test(name) || (u[0] === 0x49 && u[1] === 0x44 && u[2] === 0x33) || (u[0] === 0xFF && (u[1] & 0xE0) === 0xE0);
  }
  function decode(arrayBuf, name, cb) {
    var c = audioCtx(), isWav = /\.wav$/i.test(name) || (arrayBuf.byteLength > 4 && String.fromCharCode.apply(null, new Uint8Array(arrayBuf, 0, 4)) === "RIFF"), isMp3 = !isWav && looksMp3(arrayBuf, name);
    function viaWav(why) {
      try { var w = Wav.decodeWav(arrayBuf); cb(null, { samples: w.samples, sampleRate: w.sampleRate }); }
      catch (e) { cb(why ? "This file could not be decoded here (" + why + "). Convert it to a WAV file and try again." : e.message); }
    }
    function viaMp3() {   // built-in pure JS decoder, used when the app's own audio engine can not read MP3
      setStatus("Decoding MP3 with the built-in decoder (a few seconds)...");
      setTimeout(function () {
        try { var m = Mp3Dec.decodeMp3(arrayBuf); cb(null, { samples: m.samples, sampleRate: m.sampleRate }); }
        catch (e) { cb("This MP3 could not be decoded (" + (e.message || e) + "). Try another copy of the file, or convert it to WAV."); }
      }, 30);
    }
    if (!c || !c.decodeAudioData) return isWav ? viaWav("") : isMp3 ? viaMp3() : cb("This host cannot decode audio. Use a WAV or MP3 file.");
    var done = false;
    function ok(buf) { if (done) return; done = true; cb(null, { samples: toMono(buf), sampleRate: buf.sampleRate }); }
    function fail() { if (done) return; done = true; if (isWav) viaWav(""); else if (isMp3) viaMp3(); else viaWav("format not supported by this app's audio engine"); }
    try { var p = c.decodeAudioData(arrayBuf.slice(0), ok, fail); if (p && p.then) p.then(ok, fail); } catch (e) { fail(e); }
  }

  // ---------- analysis ----------
  function analyze(decoded, name, source, newOff) {
    setStatus("Analyzing...");
    setTimeout(function () {
      try {
        var smp = decoded.samples, sr = decoded.sampleRate;
        if (source && source.kind === "clip") {   // keep only the part of the file the clip actually shows
          var a = Math.max(0, Math.floor(source.srcIn * sr)), b = Math.min(smp.length, Math.ceil(source.srcOut * sr));
          if (b - a < sr) throw new Error("The clip's visible range is under one second long.");
          smp = smp.subarray(a, b);
        }
        var fx = Detect.computeFlux(smp, sr), c = audioCtx(), buf = null;
        if (c) { buf = c.createBuffer(1, smp.length, sr); buf.getChannelData(0).set(smp); }
        stop();
        audio = { samples: smp, sampleRate: sr, buffer: buf, duration: fx.duration, flux: fx, tempo: Detect.estimateTempo(fx), peaks: Detect.waveformPeaks(smp, 16384), name: name };
        src = source || { kind: "file" }; off = newOff || 0;
        added = []; removed = []; range = null; cursor = 0; view = { start: 0, span: audio.duration }; bpm = audio.tempo.bpm;
        $("#zoom").value = 0; $("#scroll").value = 0; $("#rangeOn").checked = false;
        $("#fileLabel").textContent = name;
        setOffUI();
        playBtn.disabled = false; addBtn.disabled = false; autoBtn.disabled = false; cutBtn.disabled = false;
        recompute();
        setStatus(audio.duration.toFixed(1) + " s analyzed. Check the beats, then Add markers or Cut clips to beats.");
      } catch (e) { setStatus("Something went wrong."); setWarn(e.message || String(e)); }
    }, 30);
  }
  function setOffUI() {
    var clip = src && src.kind === "clip";
    $("#offset").value = String(Math.round(off * 1000) / 1000); $("#offset").disabled = clip; $("#playhead").disabled = clip;
    $("#offLabel").textContent = clip ? "Clip starts at" : "Audio starts at";
  }

  // ---------- beat pipeline: detect -> subdivide -> manual edits -> N of M -> range ----------
  function recompute(keepTempo) {
    if (!audio) { draw(); return; }
    var n, m, s;
    if (mode === "beats") {
      if (!keepTempo) bpm = audio.tempo.bpm;
      $("#bpmIn").value = bpm ? String(Math.round(bpm * 10) / 10) : "";
      baseBeats = bpm ? Detect.trackBeats(audio.flux, bpm) : [];
    } else baseBeats = Detect.pickBeats(audio.flux, $("#sens").value / 100, 1);
    edited = Select.applyEdits(Select.subdivide(baseBeats, subK), added, removed);
    m = Math.max(1, Math.round(num($("#selM"), 1))); n = Math.max(1, Math.min(m, Math.round(num($("#selN"), 1)))); s = Math.round(num($("#selS"), 1)) - 1;
    selected = Select.selectPattern(edited, n, m, s, $("#how").value);
    finalBeats = ($("#rangeOn").checked && range) ? Select.inRange(selected, range.a, range.b) : selected;
    updateInfo(); draw();
  }
  function updateInfo() {
    var bi = Select.beatInfo(edited);
    $("#iSong").textContent = edited.length ? edited.length + " beats" : (audio ? "no steady beat" : "-");
    $("#iBpm").textContent = bi.bpm ? bi.bpm + " BPM (median)" : "-";
    $("#iLen").textContent = bi.len ? bi.len + " s (median)" : "-";
    $("#iSel").textContent = audio ? finalBeats.length + " beats" : "-";
    $("#iRange").textContent = range ? fmt(range.a) + " - " + fmt(range.b) + ($("#rangeOn").checked ? "" : " (off)") : "whole song";
    if (audio && mode === "beats" && audio.tempo.confidence < 0.15) setWarn("Weak rhythm found. Check the tempo, or try Every hit.");
  }
  function setMode(m) {
    mode = m;
    for (var i = 0; i < modeBtns.length; i++) modeBtns[i].className = modeBtns[i].getAttribute("data-m") === m ? "on" : "";
    $("#sensRow").style.display = m === "hits" ? "flex" : "none"; $("#tempoRow").style.display = m === "beats" ? "flex" : "none";
    added = []; removed = []; recompute();
  }

  // ---------- waveform ----------
  var W = 0, H = 0;
  function xOf(t) { return (t - view.start) / view.span * W; }
  function tOf(x) { return view.start + x / W * view.span; }
  function draw() {
    W = canvas.width; H = canvas.height;
    var g = canvas.getContext("2d"), i, rulerH = 26, mid = rulerH + (H - rulerH) / 2;
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    if (!audio) { g.fillStyle = "#555"; g.font = "26px sans-serif"; g.textAlign = "center"; g.fillText("Load music to see the waveform", W / 2, H / 2 + 8); return; }
    // range
    if (range) { g.fillStyle = "rgba(255,255,255,0.10)"; g.fillRect(xOf(range.a), rulerH, xOf(range.b) - xOf(range.a), H - rulerH); }
    // ruler
    var steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600], step = steps[steps.length - 1];
    for (i = 0; i < steps.length; i++) if (steps[i] / view.span * W >= 90) { step = steps[i]; break; }
    g.font = "20px sans-serif"; g.textAlign = "left"; g.fillStyle = "#888"; g.strokeStyle = "#333"; g.lineWidth = 1;
    for (var t = Math.ceil(view.start / step) * step; t < view.start + view.span; t += step) {
      var x = Math.round(xOf(t)) + 0.5; g.beginPath(); g.moveTo(x, rulerH - 8); g.lineTo(x, H); g.stroke(); g.fillText(fmt(t).replace(/\.0$/, ""), x + 4, 18);
    }
    // waveform: from the peak table when zoomed out, from the samples when zoomed in
    var sr = audio.sampleRate, sm = audio.samples, ph = (H - rulerH) / 2 - 6, spp = view.span * sr / W, bucket = sm.length / (audio.peaks.length / 2), px, mn, mx, j;
    g.fillStyle = "#6d8fb8";
    for (px = 0; px < W; px++) {
      var s0 = (view.start * sr) + px * spp, s1 = s0 + spp; mn = 0; mx = 0;
      if (s1 < 0 || s0 >= sm.length) continue;
      if (spp >= bucket * 1.5) { var b0 = Math.max(0, Math.floor(s0 / bucket)), b1 = Math.min(audio.peaks.length / 2, Math.ceil(s1 / bucket)); for (j = b0; j < b1; j++) { if (audio.peaks[j * 2] < mn) mn = audio.peaks[j * 2]; if (audio.peaks[j * 2 + 1] > mx) mx = audio.peaks[j * 2 + 1]; } }
      else { var a0 = Math.max(0, Math.floor(s0)), a1 = Math.min(sm.length, Math.max(a0 + 1, Math.ceil(s1))); for (j = a0; j < a1; j++) { if (sm[j] < mn) mn = sm[j]; if (sm[j] > mx) mx = sm[j]; } }
      var top = mid - Math.min(1, mx) * ph, bot = mid - Math.max(-1, mn) * ph; g.fillRect(px, top, 1, Math.max(1, bot - top));
    }
    // beats: all beats dim, the ones that will become markers bright
    var sel = {}, k; for (k = 0; k < finalBeats.length; k++) sel[finalBeats[k].toFixed(4)] = 1;
    for (i = 0; i < edited.length; i++) {
      var bx = xOf(edited[i]); if (bx < -2 || bx > W + 2) continue;
      var on = sel[edited[i].toFixed(4)]; g.fillStyle = on ? "#ffd23f" : "rgba(255,210,63,0.28)"; g.fillRect(Math.round(bx) - 1, rulerH, on ? 2 : 1, H - rulerH);
    }
    // cursor
    var cx = xOf(cursor); if (cx >= 0 && cx <= W) { g.fillStyle = "#fff"; g.fillRect(Math.round(cx) - 1, 0, 2, H); }
    $("#time").textContent = fmt(cursor) + " / " + fmt(audio.duration);
  }
  function clampView() {
    view.span = Math.max(0.2, Math.min(audio.duration, view.span));
    view.start = Math.max(0, Math.min(audio.duration - view.span, view.start));
    $("#scroll").value = audio.duration > view.span ? Math.round(view.start / (audio.duration - view.span) * 1000) : 0;
  }
  function setZoomFromSlider() {
    if (!audio) return; var z = num($("#zoom"), 0) / 100, centre = view.start + view.span / 2;
    view.span = audio.duration * Math.pow(0.2 / audio.duration > 1 ? 1 : 0.2 / audio.duration, z);   // log zoom down to 0.2 s
    view.start = centre - view.span / 2; clampView(); draw();
  }
  $("#zoom").addEventListener("input", setZoomFromSlider);
  $("#scroll").addEventListener("input", function () { if (!audio) return; view.start = num($("#scroll"), 0) / 1000 * (audio.duration - view.span); draw(); });
  canvas.addEventListener("wheel", function (e) {
    if (!audio) return; e.preventDefault();
    if (e.ctrlKey || e.altKey) { var t = tOf(e.offsetX / canvas.clientWidth * W), f = e.deltaY > 0 ? 1.25 : 0.8; view.span *= f; view.start = t - (t - view.start) * f; clampView(); syncZoom(); }
    else { view.start += (e.deltaX || e.deltaY) / canvas.clientWidth * view.span; clampView(); }
    draw();
  }, { passive: false });
  function syncZoom() { var z = Math.log(view.span / audio.duration) / Math.log(Math.min(1, 0.2 / audio.duration) || 1); $("#zoom").value = Math.max(0, Math.min(100, Math.round(z * 100))); }

  // mouse: click = move play position, drag = draw range; in Edit mode click adds / removes a beat and a drag moves one
  var drag = null;
  function evT(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, px: e.clientX - r.left }; }
  function nearest(t) { var best = -1, bd = 1e9; for (var i = 0; i < edited.length; i++) { var d = Math.abs(edited[i] - t); if (d < bd) { bd = d; best = i; } } return { i: best, d: bd }; }
  function dropBeat(t) { // remove a beat: undo a manual add if it is one, else mark the detected beat removed
    var i; for (i = 0; i < added.length; i++) if (Math.abs(added[i] - t) < 0.0005) { added.splice(i, 1); return; }
    removed.push(t);
  }
  canvas.addEventListener("mousedown", function (e) {
    if (!audio) return; var p = evT(e), t = tOf(p.x), nb = nearest(t), tol = 8 / canvas.clientWidth * view.span;
    if ($("#edit").checked) { drag = { kind: nb.i >= 0 && nb.d <= tol ? "beat" : "new", t0: t, beat: nb.i >= 0 ? edited[nb.i] : 0, x0: p.px, moved: false }; }
    else drag = { kind: "range", t0: t, x0: p.px, moved: false };
    e.preventDefault();
  });
  window.addEventListener("mousemove", function (e) {
    if (!drag || !audio) return; var p = evT(e), t = Math.max(0, Math.min(audio.duration, tOf(p.x)));
    if (Math.abs(p.px - drag.x0) > 4) drag.moved = true;
    if (drag.kind === "range" && drag.moved) { range = { a: Math.min(drag.t0, t), b: Math.max(drag.t0, t) }; draw(); }
    if (drag.kind === "beat" && drag.moved) { drag.cur = t; draw(); var g = canvas.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(Math.round(xOf(t)) - 1, 26, 2, H - 26); }
  });
  window.addEventListener("mouseup", function (e) {
    if (!drag || !audio) { drag = null; return; }
    var p = evT(e), t = Math.max(0, Math.min(audio.duration, tOf(p.x))), d = drag; drag = null;
    if (d.kind === "range") {
      if (d.moved) { $("#rangeOn").checked = true; recompute(true); } else { seek(t); }
    } else if (d.kind === "beat") {
      dropBeat(d.beat); if (d.moved) added.push(t); recompute(true);
    } else { added.push(t); recompute(true); }
  });

  // ---------- playback ----------
  function stop() { if (node) { try { node.stop(); } catch (e) {} node = null; } cancelAnimationFrame(raf); playBtn.textContent = "Play"; }
  function seek(t) { cursor = Math.max(0, Math.min(audio.duration, t)); if (node) { stop(); play(); } else draw(); }
  function play() {
    if (node) { stop(); draw(); return; }
    var c = audioCtx(); if (!audio || !audio.buffer || !c) { setWarn("Playback is not available for this file here."); return; }
    try { if (c.state === "suspended") c.resume(); } catch (e) {}
    if (cursor >= audio.duration - 0.05) cursor = 0;
    node = c.createBufferSource(); node.buffer = audio.buffer;
    gain = c.createGain(); gain.gain.value = num($("#vol"), 80) / 100; node.connect(gain); gain.connect(c.destination);
    var me = node; me.onended = function () { if (node === me) { stop(); draw(); } };
    playFrom = cursor; playStart = c.currentTime; me.start(0, cursor); playBtn.textContent = "Stop";
    (function tick() { if (node !== me) return; cursor = Math.min(audio.duration, playFrom + c.currentTime - playStart); if (cursor > view.start + view.span || cursor < view.start) { view.start = Math.max(0, Math.min(audio.duration - view.span, cursor - view.span * 0.1)); clampView(); } draw(); raf = requestAnimationFrame(tick); })();
  }
  $("#vol").addEventListener("input", function () { if (gain) gain.gain.value = num($("#vol"), 80) / 100; });
  playBtn.addEventListener("click", play);
  $("#toStart").addEventListener("click", function () { if (audio) { view.start = 0; clampView(); seek(0); } });
  document.addEventListener("keydown", function (e) { if (e.code === "Space" && audio && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); play(); } });

  // ---------- host helpers ----------
  function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  function call(fn, args, ok, fail) {
    Bridge.evalScript(fn + "(" + args.join(",") + ")", function (res) {
      var r = String(res || "").split("|");
      if (r[0] === "OK") ok(r.slice(1));
      else { setStatus("Something went wrong."); setWarn(r.slice(1).join("|") || ("The host did not answer (" + res + ")")); if (fail) fail(); }
    });
  }
  function needHost() { if (!Bridge.hasHost) { setStatus("Demo mode: open this panel inside Premiere Pro or After Effects."); return false; } return true; }
  function target() { return $("#mtype").value; }
  function optStr(work) {
    var o = "target=" + target() + ";work=" + (work ? 1 : 0);
    if (target() === "clip") o += ";cs=" + off + ";si=" + (src && src.kind === "clip" ? src.srcIn : 0) + ";path=" + (src && src.path ? src.path : "");
    return o;
  }
  function clipOk() {
    if (target() === "clip" && !(src && src.kind === "clip")) { setStatus("Clip markers need a timeline clip."); setWarn("Select the audio clip in your timeline, press Use selected clip, then try again. Or switch the dropdown to Sequence / Comp Markers."); return false; }
    return true;
  }

  // ---------- add / delete markers ----------
  function addMarkers() {
    if (!audio || !finalBeats.length) { setWarn("There are no beats selected."); return; }
    if (!needHost() || !clipOk()) return;
    setWarn(""); addBtn.disabled = true;
    var times = finalBeats.map(function (t) { return off + t; }), i = 0, added_ = 0, skipped = 0, removed_ = 0, CH = 150, clr = ($("#rangeOn").checked && range) ? 0 : 1;
    (function next() {
      if (i >= times.length) {
        addBtn.disabled = false; setStatus(added_ + " markers added" + (removed_ ? " (" + removed_ + " older beat markers replaced)" : "") + ".");
        setWarn(skipped ? skipped + " beats fell outside the " + HOSTWORD() + " and were skipped." : "");
        return;
      }
      var chunk = times.slice(i, i + CH).map(function (t) { return t.toFixed(3); }).join(",");
      call("bmAdd", [q(chunk), q(optStr(false)), i + 1, i === 0 ? clr : 0], function (r) { added_ += +r[0]; skipped += +r[1]; removed_ += +r[2]; i += CH; next(); }, function () { addBtn.disabled = false; });
    })();
  }
  addBtn.addEventListener("click", addMarkers);
  $("#clear").addEventListener("click", function (e) {
    if (!needHost() || !clipOk()) return;
    var wa = e.shiftKey || $("#waOnly").checked; setWarn("");
    call("bmClear", [q(optStr(wa))], function (r) { setStatus(r[0] + " beat markers deleted" + (wa ? " (work area only)." : ".")); });
  });

  // ---------- load audio ----------
  function loadFile(f) {
    if (!f) return;
    stop(); setWarn(""); setStatus("Reading " + f.name + "...");
    var fr = new FileReader();
    fr.onerror = function () { setStatus("Something went wrong."); setWarn("Could not read that file."); };
    fr.onload = function () {
      setStatus("Decoding...");
      decode(fr.result, f.name, function (err, d) { if (err) { setStatus("Something went wrong."); setWarn(err); return; } analyze(d, f.name, { kind: "file" }, num($("#offset"), 0)); });
    };
    fr.readAsArrayBuffer(f);
  }
  $("#file").addEventListener("change", function () { loadFile($("#file").files[0]); });
  var drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.className = "btn over"; }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.className = "btn"; }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

  function readLocal(path, cb) {   // file:// via XHR first, then the CEP file API as a fallback
    var url = "file:///" + encodeURI(path.replace(/\\/g, "/").replace(/^\//, "")), done = false;
    function viaCep() {
      try {
        var cep = window.cep; if (!cep || !cep.fs) return cb("The app would not let the panel read that file.");
        var r = cep.fs.readFile(path, cep.encoding.Base64);
        if (r.err) return cb("Could not read the file (error " + r.err + ").");
        var bin = atob(r.data), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); cb(null, u.buffer);
      } catch (e) { cb("Could not read the file: " + e.message); }
    }
    try {
      var x = new XMLHttpRequest(); x.open("GET", url, true); x.responseType = "arraybuffer";
      x.onload = function () { if (done) return; done = true; if ((x.status === 200 || x.status === 0) && x.response && x.response.byteLength) cb(null, x.response); else viaCep(); };
      x.onerror = function () { if (done) return; done = true; viaCep(); };
      x.send();
    } catch (e) { viaCep(); }
  }
  $("#useClip").addEventListener("click", function () {
    if (!needHost()) return; setWarn(""); setStatus("Reading the selected clip...");
    call("bmClipInfo", [], function (r) {
      var name = r[0], path = r[1], cs = parseFloat(r[2]), si = parseFloat(r[3]), so = parseFloat(r[4]);
      if (!path) { setStatus("That clip has no file."); setWarn("The selected item has no media file path (a nested sequence or a generated layer). Select an audio or video clip."); return; }
      if (isNaN(cs) || isNaN(si) || isNaN(so) || so <= si) { setStatus("Something went wrong."); setWarn("The host returned an unreadable clip range: " + r.join("|")); return; }
      setStatus("Loading " + name + "...");
      readLocal(path, function (err, buf) {
        if (err) { setStatus("Something went wrong."); setWarn(err + " Path: " + path); return; }
        if (buf.byteLength > 400 * 1048576) setWarn("That file is large (" + Math.round(buf.byteLength / 1048576) + " MB). Decoding can be slow or fail. A WAV or MP3 of the song works better.");
        setStatus("Decoding..."); stop();
        decode(buf, name, function (e2, d) {
          if (e2) { setStatus("Something went wrong."); setWarn(e2); return; }
          analyze(d, name + " (selected clip)", { kind: "clip", path: path, srcIn: si, srcOut: so }, cs);
        });
      });
    });
  });
  $("#offset").addEventListener("change", function () { off = num($("#offset"), 0); });
  $("#playhead").addEventListener("click", function () {
    if (!needHost()) return; setWarn("");
    call("bmInfo", [], function (r) { var t = parseFloat(r[2]); off = isNaN(t) ? 0 : Math.round(t * 1000) / 1000; setOffUI(); setStatus("Audio start set to " + off + " s."); });
  });

  // ---------- controls ----------
  $("#sens").addEventListener("input", function () { $("#sensVal").textContent = $("#sens").value; added = []; removed = []; recompute(true); });
  for (var mi = 0; mi < modeBtns.length; mi++) (function (b) { b.addEventListener("click", function () { setMode(b.getAttribute("data-m")); }); })(modeBtns[mi]);
  for (var si = 0; si < subBtns.length; si++) (function (b) { b.addEventListener("click", function () {
    subK = parseInt(b.getAttribute("data-k"), 10); for (var i = 0; i < subBtns.length; i++) subBtns[i].className = subBtns[i] === b ? "on" : ""; added = []; removed = []; recompute(true); }); })(subBtns[si]);
  function setBpm(v) { if (!audio || !(v >= 30 && v <= 300)) return; bpm = v; added = []; removed = []; recompute(true); }
  $("#bpmIn").addEventListener("change", function () { setBpm(num($("#bpmIn"), 0)); });
  $("#half").addEventListener("click", function () { setBpm(bpm / 2); });
  $("#dbl").addEventListener("click", function () { setBpm(bpm * 2); });
  ["#selN", "#selM", "#selS", "#how", "#rangeOn"].forEach(function (s) { $(s).addEventListener("change", function () { recompute(true); }); });
  $("#bar").addEventListener("click", function () {
    if (!audio || !edited.length) return; var m = Math.max(1, Math.round(num($("#selM"), 4)));
    var k = m === 1 ? 0 : Detect.barStart(edited, audio.flux, m); $("#selS").value = String(k + 1); recompute(true); setStatus("Bar start: beat " + (k + 1) + " of every " + m + ".");
  });
  $("#rangeClr").addEventListener("click", function () { range = null; $("#rangeOn").checked = false; recompute(true); });
  $("#wa").addEventListener("click", function () {
    if (!audio) return; if (!needHost()) return;
    call("bmInfo", [], function (r) {
      var a = parseFloat(r[5]), b = parseFloat(r[6]); if (isNaN(a) || isNaN(b) || b <= a) { setWarn("The work area could not be read. Draw a range on the waveform instead."); return; }
      range = { a: Math.max(0, a - off), b: Math.min(audio.duration, b - off) };
      if (range.b <= range.a) { range = null; setWarn("The work area does not overlap the audio."); return; }
      $("#rangeOn").checked = true; recompute(true); setStatus("Range set to the work area.");
    });
  });

  // ---------- auto-cut ----------
  function autoCut() {
    if (!audio) { setWarn("Load music first."); return; }
    if (finalBeats.length < 2) { setWarn("Auto-cut needs at least 2 selected beats. Each clip fills the gap between two beats."); return; }
    if (!needHost()) return; setWarn(""); setStatus("Reading the clips selected in the Project panel..."); cutBtn.disabled = true; autoBtn.disabled = true;
    function free() { cutBtn.disabled = false; autoBtn.disabled = false; }
    call("bmClips", [], function (r) {
      var n = parseInt(r[0], 10), list = (r[1] || "").split("^").map(function (s) { var p = s.split("~"); return { name: p[0], duration: parseFloat(p[1]) || 0 }; });
      if (!n || !list.length) { setStatus("No clips selected."); setWarn("Select the clips in the Project panel first."); free(); return; }
      var cuts = finalBeats.map(function (t) { return off + t; }), res = AutoCut.plan(cuts, list, { order: $("#order").value, cursor: $("#cursor").value });
      if (!res.plan.length) { setStatus("Nothing to place."); free(); return; }
      var names = list.map(function (c) { return c.name; }).join("^");
      setStatus("Placing " + res.plan.length + " clips from " + list.length + " source clip(s)...");
      call("bmCut", [q(AutoCut.planToString(res.plan)), q("names=" + names + ";rmaudio=" + ($("#rmaudio").checked ? 1 : 0))], function (o) {
        free(); var placed = +o[0], bad = +o[1];
        setStatus(placed + " clips placed on the beats" + (bad ? ", " + bad + " could not be placed" : "") + ".");
        var w = []; if (res.short) w.push(res.short + " beat gaps were longer than any clip, so those clips were shortened."); if (o[2]) w.push(o.slice(2).join("|"));
        setWarn(w.join(" "));
      }, free);
    }, free);
  }
  cutBtn.addEventListener("click", autoCut); autoBtn.addEventListener("click", autoCut);

  // ---------- demo ----------
  function demoTrack() {
    var sr = 44100, n = sr * 16, x = new Float32Array(n), t, i, seed = 5;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; }
    for (i = 0; i < n; i++) x[i] = rnd() * 0.02;
    for (t = 0.5; t < 15.5; t += 0.5) {
      var s0 = Math.floor(t * sr), k = Math.round(t / 0.5) % 4 === 0 ? 1 : 0.7;
      for (i = 0; i < 0.12 * sr; i++) { var tt = i / sr; x[s0 + i] += k * 0.8 * Math.exp(-tt * 30) * Math.sin(2 * Math.PI * (120 * tt + 40 * (1 - Math.exp(-tt * 40)))) + 0.15 * rnd() * Math.exp(-tt * 80); }
    }
    return { samples: x, sampleRate: sr };
  }
  var demo = $("#demo"); demo.style.display = "block";
  demo.addEventListener("click", function () { setWarn(""); analyze(demoTrack(), "demo-120bpm.wav", { kind: "file" }, 0); });

  $("#host").textContent = NAMES[Bridge.hostName()] || Bridge.hostName();
  draw();
  window.onerror = function (m) { setStatus("Something went wrong."); setWarn(String(m)); };
  window.BeatPanel = { demo: function () { analyze(demoTrack(), "demo-120bpm.wav", { kind: "file" }, 0); }, setMode: setMode, setSens: function (v) { $("#sens").value = v; $("#sensVal").textContent = v; recompute(true); },
    state: function () { return { beats: edited.length, selected: finalBeats.length, bpm: bpm }; },
    set: function (id, v) { $(id).value = v; recompute(true); }, range: function (a, b) { range = { a: a, b: b }; $("#rangeOn").checked = true; recompute(true); } };
})();
