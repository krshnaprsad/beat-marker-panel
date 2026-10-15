// ExtendScript for Premiere Pro (PPRO) and After Effects (AEFT). ES3 only.
// Every function returns "OK|..." or "ERR|message". The panel analyses audio; this file only reads the
// timeline and writes markers / clips. Every step checks that what it needs exists and says so when it does not.
var BM_LABEL = "Beat ";
var BM_TICKS = 254016000000;

function bmIsAE() { return typeof CompItem !== "undefined"; }
function bmErr(m) { return "ERR|" + m; }
function bmNum(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
function bmOpts(s) {
  var o = {}, p = String(s || "").split(";"), i;
  for (i = 0; i < p.length; i++) { var k = p[i].indexOf("="); if (k > 0) o[p[i].substr(0, k)] = p[i].substr(k + 1); }
  return o;
}
function bmClean(s) { return String(s).replace(/[|^~;,\r\n]/g, "_"); }
function bmTime(sec) { var t = new Time(); t.seconds = sec; return t; }
function bmParse(csv) {
  var parts = String(csv).split(","), out = [], i;
  for (i = 0; i < parts.length; i++) { var v = parseFloat(parts[i]); if (!isNaN(v)) out.push(v); }
  return out;
}
function bmComp() { var it = app.project ? app.project.activeItem : null; return (it && it instanceof CompItem) ? it : null; }
function bmSeq() { return app.project ? app.project.activeSequence : null; }
function bmNoHost() { return bmIsAE() ? "Open a composition and click on it first." : "Open a sequence and click on its timeline first."; }

/* ---------- selection helpers ---------- */
function ppSelectedClips(seq) {            // timeline clips the user selected
  var out = [], i, j, sel = null;
  try { sel = seq.getSelection(); } catch (e) {}
  if (sel) { for (i = 0; i < sel.length; i++) if (sel[i] && sel[i].projectItem) out.push(sel[i]); }
  if (!out.length) {
    for (i = 0; i < seq.audioTracks.numTracks; i++) {
      var tr = seq.audioTracks[i];
      for (j = 0; j < tr.clips.numItems; j++) { try { if (tr.clips[j].isSelected()) out.push(tr.clips[j]); } catch (e2) {} }
    }
  }
  return out;
}
function ppMediaPath(item) { try { return String(item.getMediaPath()); } catch (e) { return ""; } }
function ppFindClip(seq, path) {
  var cl = ppSelectedClips(seq), i;
  for (i = 0; i < cl.length; i++) if (!path || ppMediaPath(cl[i].projectItem) === path) return cl[i];
  return null;
}
function aeSelLayer(comp, path) {
  var sl = comp.selectedLayers, i;
  for (i = 0; i < sl.length; i++) { try { if (!path || (sl[i].source && sl[i].source.file && sl[i].source.file.fsName === path)) return sl[i]; } catch (e) {} }
  return sl.length ? sl[0] : null;
}
function aeLayerMarkers(layer) {
  var p = null;
  try { p = layer.property("ADBE Marker"); } catch (e) {}
  if (!p) { try { p = layer.marker; } catch (e2) {} }
  return p;
}

// work area in timeline seconds: [start, end]
function bmWork() {
  if (bmIsAE()) { var c = bmComp(); return [c.workAreaStart, c.workAreaStart + c.workAreaDuration]; }
  var s = bmSeq(), a = 0, b = 0;
  try { a = s.getInPointAsTime().seconds; b = s.getOutPointAsTime().seconds; } catch (e) {}
  if (!(b > a)) { try { b = (s.end - 0) / BM_TICKS; } catch (e2) {} a = 0; }
  return [a, b];
}

/* ---------- info ---------- */
// "OK|AE|<name>|<current time>|<duration>|<work start>|<work end>"
function bmInfo() {
  try {
    var w;
    if (bmIsAE()) {
      var c = bmComp(); if (!c) return bmErr(bmNoHost());
      w = bmWork();
      return "OK|AE|" + bmClean(c.name) + "|" + c.time + "|" + c.duration + "|" + w[0] + "|" + w[1];
    }
    var s = bmSeq(); if (!s) return bmErr(bmNoHost());
    var pos = 0; try { pos = s.getPlayerPosition().seconds; } catch (e) {}
    var dur = 0; try { dur = (s.end - 0) / BM_TICKS; } catch (e2) {}
    w = bmWork();
    return "OK|PP|" + bmClean(s.name) + "|" + pos + "|" + dur + "|" + w[0] + "|" + w[1];
  } catch (e3) { return bmErr(e3.toString() + " (line " + e3.line + ")"); }
}

// The selected audio clip / layer: "OK|<name>|<media path>|<timeline start>|<source in>|<source out>"
function bmClipInfo() {
  try {
    if (bmIsAE()) {
      var c = bmComp(); if (!c) return bmErr(bmNoHost());
      var l = aeSelLayer(c, "");
      if (!l) return bmErr("Select the audio layer in the timeline first.");
      if (!l.source || !l.source.file) return bmErr("The selected layer has no file behind it. Select a layer made from an audio or video file.");
      if (l.source.hasAudio === false) return bmErr("The selected layer has no audio.");
      var f = l.source.file;
      if (!f.exists) return bmErr("The media file is missing: " + f.fsName);
      var srcIn = l.inPoint - l.startTime, srcOut = l.outPoint - l.startTime;   // 100% speed assumed
      return "OK|" + bmClean(l.name) + "|" + f.fsName + "|" + l.inPoint + "|" + srcIn + "|" + srcOut;
    }
    var s = bmSeq(); if (!s) return bmErr(bmNoHost());
    var cl = ppSelectedClips(s), i;
    if (!cl.length) return bmErr("Select the audio clip in the timeline first.");
    for (i = 0; i < cl.length; i++) {
      var path = ppMediaPath(cl[i].projectItem);
      if (!path) continue;
      return "OK|" + bmClean(cl[i].name) + "|" + path + "|" + cl[i].start.seconds + "|" + cl[i].inPoint.seconds + "|" + cl[i].outPoint.seconds;
    }
    return bmErr("The selected clip has no media file (it may be a nested sequence or a title).");
  } catch (e) { return bmErr(e.toString() + " (line " + e.line + ")"); }
}

/* ---------- beat markers ---------- */
function bmMarkerName(k) { return BM_LABEL + k; }
function bmIsBeat(name) { return String(name).indexOf(BM_LABEL) === 0; }

function bmClearAEProp(p, lo, hi) {
  var k, n = 0;
  for (k = p.numKeys; k >= 1; k--) {
    var v = p.keyValue(k), t = p.keyTime(k);
    if (v && bmIsBeat(v.comment) && t >= lo && t <= hi) { p.removeKey(k); n++; }
  }
  return n;
}
function bmClearPPColl(coll, toTl, lo, hi) {
  var list = [], m = coll.getFirstMarker(), n = 0, i;
  while (m) { var t = toTl(m.start.seconds); if (bmIsBeat(m.name) && t >= lo && t <= hi) list.push(m); m = coll.getNextMarker(m); }
  for (i = 0; i < list.length; i++) { coll.deleteMarker(list[i]); n++; }
  return n;
}

// opts: target=seq|clip; work=0|1; cs=<clip timeline start>; si=<clip source in>; path=<media path>
function bmAdd(timesCsv, optStr, firstIndex, clear) {
  var started = false;
  try {
    var o = bmOpts(optStr), times = bmParse(timesCsv), idx = parseInt(firstIndex, 10) || 1, i, added = 0, skipped = 0, removed = 0;
    var work = o.work === "1" ? bmWork() : null, lo = work ? work[0] : -1e12, hi = work ? work[1] : 1e12, clip = o.target === "clip";
    var cs = bmNum(o.cs, 0), si = bmNum(o.si, 0);
    if (bmIsAE()) {
      var comp = bmComp(); if (!comp) return bmErr(bmNoHost());
      var prop = comp.markerProperty;
      if (clip) {
        var layer = aeSelLayer(comp, o.path);
        if (!layer) return bmErr("Select the audio layer in the timeline first (layer markers go on the selected layer).");
        prop = aeLayerMarkers(layer);
        if (!prop) return bmErr("This layer has no marker property.");
      }
      app.beginUndoGroup("Add beat markers"); started = true;
      if (String(clear) === "1") removed = bmClearAEProp(prop, lo, hi);
      for (i = 0; i < times.length; i++) {
        var t = times[i];
        if (t < lo || t > hi || t < 0 || t > comp.duration) { skipped++; continue; }
        prop.setValueAtTime(t, new MarkerValue(bmMarkerName(idx + i)));
        added++;
      }
      app.endUndoGroup(); started = false;
    } else {
      var seq = bmSeq(); if (!seq) return bmErr(bmNoHost());
      var coll = seq.markers, conv = function (x) { return x; };
      if (clip) {
        var tc = ppFindClip(seq, o.path);
        if (!tc) return bmErr("Select the audio clip in the timeline first (clip markers go on the selected clip).");
        coll = tc.projectItem.getMarkers();
        if (!coll) return bmErr("Premiere would not give access to this clip's markers.");
        conv = function (x) { return x - si + cs; };    // source time -> timeline time
      }
      if (String(clear) === "1") removed = bmClearPPColl(coll, conv, lo, hi);
      for (i = 0; i < times.length; i++) {
        var tl = times[i], at = clip ? tl - cs + si : tl;
        if (tl < lo || tl > hi || at < 0) { skipped++; continue; }
        var mk = coll.createMarker(at);
        if (mk) { try { mk.name = bmMarkerName(idx + i); } catch (e) {} added++; } else skipped++;
      }
    }
    return "OK|" + added + "|" + skipped + "|" + removed;
  } catch (e2) {
    if (started) { try { app.endUndoGroup(); } catch (e3) {} }
    return bmErr(e2.toString() + " (line " + e2.line + ")");
  }
}

function bmClear(optStr) {
  try {
    var o = bmOpts(optStr), work = o.work === "1" ? bmWork() : null, lo = work ? work[0] : -1e12, hi = work ? work[1] : 1e12, clip = o.target === "clip", n = 0;
    if (bmIsAE()) {
      var c = bmComp(); if (!c) return bmErr(bmNoHost());
      var p = c.markerProperty;
      if (clip) { var l = aeSelLayer(c, o.path); if (!l) return bmErr("Select the audio layer first."); p = aeLayerMarkers(l); if (!p) return bmErr("This layer has no marker property."); }
      app.beginUndoGroup("Clear beat markers"); n = bmClearAEProp(p, lo, hi); app.endUndoGroup();
      return "OK|" + n;
    }
    var s = bmSeq(); if (!s) return bmErr(bmNoHost());
    if (clip) {
      var tc = ppFindClip(s, o.path); if (!tc) return bmErr("Select the audio clip first.");
      var cs = bmNum(o.cs, 0), si = bmNum(o.si, 0);
      return "OK|" + bmClearPPColl(tc.projectItem.getMarkers(), function (x) { return x - si + cs; }, lo, hi);
    }
    return "OK|" + bmClearPPColl(s.markers, function (x) { return x; }, lo, hi);
  } catch (e) { return bmErr(e.toString() + " (line " + e.line + ")"); }
}

/* ---------- auto-cut ---------- */
function ppExpand(item, out, seen) {        // clips inside selected bins, recursively
  var i;
  if (!item) return;
  if (item.type === 2) { for (i = 0; i < item.children.numItems; i++) ppExpand(item.children[i], out, seen); return; }
  var path = ppMediaPath(item);
  try { if (item.isSequence && item.isSequence()) return; } catch (e) {}
  if (!path || seen[path]) return;
  seen[path] = 1; out.push(item);
}
function ppSelectedItems() {
  var sel = null, ids, i;
  try { if (app.getCurrentProjectViewSelection) sel = app.getCurrentProjectViewSelection(); } catch (e) {}
  if ((!sel || !sel.length) && app.getProjectViewIDs) {
    try { ids = app.getProjectViewIDs(); for (i = 0; ids && i < ids.length && (!sel || !sel.length); i++) sel = app.getProjectViewSelection(ids[i]); } catch (e2) {}
  }
  var out = [], seen = {};
  for (i = 0; sel && i < sel.length; i++) ppExpand(sel[i], out, seen);
  return out;
}
function ppDuration(item) {
  var a = 0, b = 0;
  try { a = item.getInPoint().seconds; } catch (e) {}
  try { b = item.getOutPoint().seconds; } catch (e2) {}
  if (b > a) return b - a;
  try { var t = item.getOutPoint(1); if (t && t.seconds > 0) return t.seconds; } catch (e3) {}
  return 0;
}
function aeSelectedItems() {
  var sel = app.project.selection, out = [], i;
  for (i = 0; i < sel.length; i++) {
    var it = sel[i];
    if (it instanceof CompItem || (it instanceof FootageItem && it.hasVideo !== false)) out.push(it);
  }
  return out;
}

// Selected project items usable as footage: "OK|<n>|name~duration^name~duration..." (duration 0 = still image)
function bmClips() {
  try {
    var list = bmIsAE() ? aeSelectedItems() : ppSelectedItems(), i, parts = [];
    if (!bmIsAE() && !bmSeq()) return bmErr(bmNoHost());
    if (bmIsAE() && !bmComp()) return bmErr(bmNoHost());
    if (!list.length) return bmErr("Select the clips (or a bin of clips) you want to cut in the Project panel first.");
    for (i = 0; i < list.length; i++) {
      var d = bmIsAE() ? (list[i].mainSource && list[i].mainSource.isStill ? 0 : list[i].duration) : ppDuration(list[i]);
      parts.push(bmClean(list[i].name) + "~" + d);
    }
    return "OK|" + list.length + "|" + parts.join("^");
  } catch (e) { return bmErr(e.toString() + " (line " + e.line + ")"); }
}

function ppFindPlaced(track, start) {
  var c;
  for (c = 0; c < track.clips.numItems; c++) if (Math.abs(track.clips[c].start.seconds - start) < 0.02) return track.clips[c];
  return null;
}
function ppSetIO(item, a, b) {
  try { item.setInPoint(bmTime(a).ticks, 4); item.setOutPoint(bmTime(b).ticks, 4); return true; } catch (e) {}
  try { item.setInPoint(a, 4); item.setOutPoint(b, 4); return true; } catch (e2) {}
  return false;
}

// plan: "clipIndex:srcIn:start:end;..."  opts: names=<name^name..> (must match the current selection), rmaudio=0|1
function bmCut(plan, optStr) {
  var started = false;
  try {
    var o = bmOpts(optStr), steps = String(plan).split(";"), i, placedOK = 0, bad = 0, detail = "";
    if (!plan) return bmErr("Nothing to place: there are fewer than two cut points.");
    var items = bmIsAE() ? aeSelectedItems() : ppSelectedItems();
    var names = String(o.names || "").split("^");
    if (items.length !== names.length) return bmErr("The Project panel selection changed (" + names.length + " clips before, " + items.length + " now). Select the clips again and click Cut again.");
    for (i = 0; i < items.length; i++) if (bmClean(items[i].name) !== names[i]) return bmErr("The Project panel selection changed. Select the clips again and click Cut again.");

    if (bmIsAE()) {
      var comp = bmComp(); if (!comp) return bmErr(bmNoHost());
      app.beginUndoGroup("Auto-cut to beats"); started = true;
      for (i = 0; i < steps.length; i++) {
        var f = steps[i].split(":"), ci = parseInt(f[0], 10), sIn = parseFloat(f[1]), st = parseFloat(f[2]), en = parseFloat(f[3]);
        if (isNaN(ci) || !items[ci] || isNaN(st) || isNaN(en)) { bad++; detail = "bad step " + (i + 1); continue; }
        var layer = comp.layers.add(items[ci]);
        layer.startTime = st - sIn;
        layer.inPoint = st; layer.outPoint = en;
        if (String(o.rmaudio) === "1") { try { layer.audioEnabled = false; } catch (e) {} }
        if (Math.abs(layer.inPoint - st) < 0.03 && Math.abs(layer.outPoint - en) < 0.03) placedOK++; else { bad++; detail = "cut " + (i + 1) + " came out " + layer.inPoint + "-" + layer.outPoint + ", wanted " + st + "-" + en; }
      }
      app.endUndoGroup(); started = false;
      return "OK|" + placedOK + "|" + bad + "|" + detail;
    }

    var seq = bmSeq(); if (!seq) return bmErr(bmNoHost());
    // A free video track on top, so nothing of the user's is overwritten.
    var before = seq.videoTracks.numTracks;
    try { app.enableQE(); qe.project.getActiveSequence().addTracks(1, before, 0, 0, 0, 0, 0, 0); } catch (eq) {}
    var track = seq.videoTracks[seq.videoTracks.numTracks - 1];
    if (seq.videoTracks.numTracks === before && track.clips.numItems > 0) return bmErr("Could not add a free video track. Add an empty video track above all others and click Cut again.");
    var orig = [];
    for (i = 0; i < items.length; i++) { var oi = null, oo = null; try { oi = items[i].getInPoint(); oo = items[i].getOutPoint(); } catch (e0) {} orig.push([oi, oo]); }
    var usedAudio = {};
    for (i = 0; i < steps.length; i++) {
      var g = steps[i].split(":"), c2 = parseInt(g[0], 10), si2 = parseFloat(g[1]), s2 = parseFloat(g[2]), e2 = parseFloat(g[3]);
      if (isNaN(c2) || !items[c2] || isNaN(s2) || isNaN(e2)) { bad++; detail = "bad step " + (i + 1); continue; }
      var dur = e2 - s2, ioSet = si2 > 0 || dur > 0 ? ppSetIO(items[c2], si2, si2 + dur) : false;
      try { track.overwriteClip(items[c2], bmTime(s2)); } catch (ep) { try { track.overwriteClip(items[c2], s2); } catch (ep2) { bad++; detail = "Premiere refused to place clip " + (i + 1) + ": " + ep2; continue; } }
      var pl = ppFindPlaced(track, s2);
      if (!pl) { bad++; detail = "clip " + (i + 1) + " was not found on the track after placing it"; continue; }
      var okLen = Math.abs((pl.end.seconds - pl.start.seconds) - dur) < 0.05 && Math.abs(pl.inPoint.seconds - si2) < 0.05;
      if (!okLen) { // fall back to trimming the placed clip
        try { pl.inPoint = bmTime(si2); } catch (et) {}
        try { pl.end = bmTime(e2); } catch (et2) {}
        okLen = Math.abs((pl.end.seconds - pl.start.seconds) - dur) < 0.05;
      }
      if (okLen) placedOK++; else { bad++; detail = "clip " + (i + 1) + " is " + (pl.end.seconds - pl.start.seconds) + " s long, wanted " + dur; }
      try { usedAudio[items[c2].nodeId] = 1; } catch (en) {}
    }
    for (i = 0; i < items.length; i++) { if (orig[i][0] && orig[i][1]) { try { items[i].setInPoint(orig[i][0].ticks, 4); items[i].setOutPoint(orig[i][1].ticks, 4); } catch (er) {} } }
    var removedAudio = 0;
    if (String(o.rmaudio) === "1") {
      var a, b;
      for (a = 0; a < seq.audioTracks.numTracks; a++) {
        var at = seq.audioTracks[a], doomed = [];
        for (b = 0; b < at.clips.numItems; b++) { try { if (usedAudio[at.clips[b].projectItem.nodeId]) doomed.push(at.clips[b]); } catch (ea) {} }
        for (b = 0; b < doomed.length; b++) { try { doomed[b].remove(false, false); removedAudio++; } catch (ed) {} }
      }
    }
    return "OK|" + placedOK + "|" + bad + "|" + detail + (removedAudio ? " (removed " + removedAudio + " footage audio clips)" : "");
  } catch (e5) {
    if (started) { try { app.endUndoGroup(); } catch (e6) {} }
    return bmErr(e5.toString() + " (line " + e5.line + ")");
  }
}
