// ExtendScript for Premiere Pro (PPRO) and After Effects (AEFT). ES3 only.
// Every function returns "OK|..." or "ERR|message". The panel does the audio analysis, this only writes markers.
var BM_LABEL = "Beat ";

// Premiere has no CompItem class; After Effects does. (app.name is not reliable in AE.)
function bmIsAE() { return typeof CompItem !== "undefined"; }
function bmErr(m) { return "ERR|" + m; }

function bmComp() {
  var it = app.project ? app.project.activeItem : null;
  return (it && it instanceof CompItem) ? it : null;
}
function bmSeq() { return app.project ? app.project.activeSequence : null; }

// "OK|AE|<name>|<current time s>|<duration s>"
function bmInfo() {
  try {
    if (bmIsAE()) {
      var c = bmComp();
      if (!c) return bmErr("Open a composition and click on it first.");
      return "OK|AE|" + c.name + "|" + c.time + "|" + c.duration;
    }
    var s = bmSeq();
    if (!s) return bmErr("Open a sequence and click on its timeline first.");
    var pos = 0; try { pos = s.getPlayerPosition().seconds; } catch (e) {}
    var dur = 0; try { dur = (s.end - 0) / 254016000000; } catch (e2) {}
    return "OK|PP|" + s.name + "|" + pos + "|" + dur;
  } catch (e3) { return bmErr(e3.toString() + " (line " + e3.line + ")"); }
}

function bmParse(csv) {
  var parts = String(csv).split(","), out = [], i;
  for (i = 0; i < parts.length; i++) { var v = parseFloat(parts[i]); if (!isNaN(v)) out.push(v); }
  return out;
}

function bmClearAE(comp) {
  var p = comp.markerProperty, k, n = 0;
  for (k = p.numKeys; k >= 1; k--) {
    var v = p.keyValue(k);
    if (v && String(v.comment).indexOf(BM_LABEL) === 0) { p.removeKey(k); n++; }
  }
  return n;
}
function bmClearPP(seq) {
  var list = [], m = seq.markers.getFirstMarker(), n = 0, i;
  while (m) { if (String(m.name).indexOf(BM_LABEL) === 0) list.push(m); m = seq.markers.getNextMarker(m); }
  for (i = 0; i < list.length; i++) { seq.markers.deleteMarker(list[i]); n++; }
  return n;
}

// timesCsv: beat times in seconds from the start of the audio. offset: where the audio starts in the comp/sequence.
// firstIndex: number of the first beat in this batch (for names). clear: "1" removes earlier "Beat N" markers first.
function bmAdd(timesCsv, offset, firstIndex, clear) {
  var started = false;
  try {
    var times = bmParse(timesCsv), off = parseFloat(offset) || 0, idx = parseInt(firstIndex, 10) || 1, i, added = 0, skipped = 0, removed = 0;
    if (bmIsAE()) {
      var comp = bmComp();
      if (!comp) return bmErr("Open a composition and click on it first.");
      app.beginUndoGroup("Add beat markers"); started = true;
      if (String(clear) === "1") removed = bmClearAE(comp);
      for (i = 0; i < times.length; i++) {
        var t = times[i] + off;
        if (t < 0 || t > comp.duration) { skipped++; continue; }
        comp.markerProperty.setValueAtTime(t, new MarkerValue(BM_LABEL + (idx + i)));
        added++;
      }
      app.endUndoGroup(); started = false;
    } else {
      var seq = bmSeq();
      if (!seq) return bmErr("Open a sequence and click on its timeline first.");
      if (String(clear) === "1") removed = bmClearPP(seq);
      for (i = 0; i < times.length; i++) {
        var tt = times[i] + off;
        if (tt < 0) { skipped++; continue; }
        var mk = seq.markers.createMarker(tt);
        if (mk) { try { mk.name = BM_LABEL + (idx + i); } catch (e) {} added++; } else skipped++;
      }
    }
    return "OK|" + added + "|" + skipped + "|" + removed;
  } catch (e2) {
    if (started) { try { app.endUndoGroup(); } catch (e3) {} }
    return bmErr(e2.toString() + " (line " + e2.line + ")");
  }
}

function bmClear() {
  try {
    if (bmIsAE()) {
      var c = bmComp();
      if (!c) return bmErr("Open a composition and click on it first.");
      app.beginUndoGroup("Clear beat markers");
      var n = bmClearAE(c);
      app.endUndoGroup();
      return "OK|" + n;
    }
    var s = bmSeq();
    if (!s) return bmErr("Open a sequence and click on its timeline first.");
    return "OK|" + bmClearPP(s);
  } catch (e) { return bmErr(e.toString() + " (line " + e.line + ")"); }
}
