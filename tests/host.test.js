// node tests/host.test.js - runs jsx/host.jsx against mock After Effects / Premiere objects.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../jsx/host.jsx", "utf8");
class Time { constructor() { this.seconds = 0; } get ticks() { return String(Math.round(this.seconds * 254016000000)); } }
function sandbox(app, extra) { const c = Object.assign({ app, parseFloat, parseInt, String, isNaN, Time, Math }, extra); vm.createContext(c); vm.runInContext(src, c); return c; }
const T = s => { const t = new Time(); t.seconds = s; return t; };

// ================= After Effects fake =================
function aeWorld(duration) {
  class CompItem {} class FootageItem {}
  const mkProp = () => { const keys = []; return { keys, get numKeys() { return keys.length; }, setValueAtTime(t, v) { keys.push({ t, v }); keys.sort((a, b) => a.t - b.t); }, keyValue(i) { return keys[i - 1].v; }, keyTime(i) { return keys[i - 1].t; }, removeKey(i) { keys.splice(i - 1, 1); } }; };
  const comp = Object.assign(new CompItem(), { name: "Main", time: 2.5, duration, workAreaStart: 1, workAreaDuration: 4, layers: [], selectedLayers: [], markerProperty: mkProp() });
  const song = Object.assign(new FootageItem(), { name: "song.wav", hasVideo: false, hasAudio: true, file: { fsName: "C:/m/song.wav", exists: true } });
  const v1 = Object.assign(new FootageItem(), { name: "a.mp4", hasVideo: true, duration: 10, mainSource: { isStill: false } });
  const v2 = Object.assign(new FootageItem(), { name: "b.mp4", hasVideo: true, duration: 10, mainSource: { isStill: false } });
  comp.layers.add = item => { const l = { source: item, name: item.name, startTime: 0, inPoint: 0, outPoint: 99, audioEnabled: true, mk: mkProp(), property() { return this.mk; } }; comp.layers.push(l); return l; };
  const app = { project: { activeItem: comp, selection: [v1, v2, song] }, beginUndoGroup() {}, endUndoGroup() {} };
  class MarkerValue { constructor(c) { this.comment = c; } }
  return { app, comp, song, extra: { CompItem, FootageItem, MarkerValue } };
}
let w = aeWorld(10), c = sandbox(w.app, w.extra);
assert.strictEqual(c.bmInfo(), "OK|AE|Main|2.5|10|1|5");
assert.strictEqual(c.bmAdd("0.5,1.0,1.5,12", "target=seq", "1", "0"), "OK|3|1|0");
assert.strictEqual(w.comp.markerProperty.keys[1].v.comment, "Beat 2");
w.comp.markerProperty.keys.push({ t: 9, v: { comment: "mine" } });
assert.strictEqual(c.bmAdd("2,3", "target=seq", "1", "1"), "OK|2|0|3");                 // clears old beats, keeps the user's marker
assert.ok(w.comp.markerProperty.keys.some(k => k.v.comment === "mine"));
assert.strictEqual(c.bmAdd("0.5,2,3,6", "target=seq;work=1", "1", "0"), "OK|2|2|0");     // work area 1..5 filters 0.5 and 6
assert.strictEqual(c.bmClear("target=seq;work=1"), "OK|4");                               // beats 2,3 (twice: old 2,3 + new 2,3) inside work area
// clip target needs a selected layer
assert.ok(c.bmAdd("1", "target=clip", "1", "0").startsWith("ERR|"));
assert.ok(c.bmClipInfo().startsWith("ERR|"));
const layer = w.comp.layers.add(w.song); layer.inPoint = 4; layer.startTime = 3; layer.outPoint = 8; w.comp.selectedLayers = [layer];
assert.strictEqual(c.bmClipInfo(), "OK|song.wav|C:/m/song.wav|4|1|5");
assert.strictEqual(c.bmAdd("4.5,5", "target=clip;path=C:/m/song.wav", "1", "1"), "OK|2|0|0"); assert.strictEqual(layer.mk.keys.length, 2);
assert.strictEqual(c.bmClear("target=clip"), "OK|2");
// auto-cut
w.comp.layers.length = 0;
assert.strictEqual(c.bmClips(), "OK|2|a.mp4~10^b.mp4~10");
let r = c.bmCut("0:0.000:1.0000:2.0000;1:0.000:2.0000:3.5000;0:1.000:3.5000:4.0000", "names=a.mp4^b.mp4;rmaudio=1");
assert.strictEqual(r, "OK|3|0|"); assert.strictEqual(w.comp.layers.length, 3);
assert.strictEqual(w.comp.layers[1].inPoint, 2); assert.strictEqual(w.comp.layers[1].startTime, 2); assert.strictEqual(w.comp.layers[2].startTime, 2.5); assert.strictEqual(w.comp.layers[0].audioEnabled, false);
assert.ok(c.bmCut("0:0:1:2", "names=a.mp4^other.mp4").startsWith("ERR|The Project panel selection changed"));
w.app.project.selection = []; assert.ok(c.bmClips().startsWith("ERR|"));
w = aeWorld(5); w.app.project.activeItem = null; c = sandbox(w.app, w.extra); assert.ok(c.bmAdd("1", "target=seq", "1", "0").startsWith("ERR|"));

// ================= Premiere fake =================
function ppWorld() {
  const mkColl = () => { const list = []; return { list, createMarker(t) { const m = { start: T(t), name: "" }; list.push(m); return m; }, getFirstMarker: () => list[0] || null, getNextMarker: m => list[list.indexOf(m) + 1] || null, deleteMarker(m) { list.splice(list.indexOf(m), 1); } }; };
  const mkItem = (name, path, dur) => ({ name, type: 1, nodeId: "n_" + name, _path: path, _dur: dur, _in: 0, _out: dur, markers: mkColl(),
    getMediaPath() { return this._path; }, getMarkers() { return this.markers; }, isSequence: () => false,
    getInPoint() { return T(this._in); }, getOutPoint() { return T(this._out); },
    setInPoint(ticks) { this._in = Number(ticks) / 254016000000; }, setOutPoint(ticks) { this._out = Number(ticks) / 254016000000; } });
  const song = mkItem("song.wav", "C:/m/song.wav", 200), a = mkItem("a.mp4", "C:/m/a.mp4", 10), b = mkItem("b.mp4", "C:/m/b.mp4", 8);
  const mkTrack = () => { const t = { _c: [], clips: null }; t.clips = new Proxy({ get numItems() { return t._c.length; } }, { get: (o, k) => (k in o ? o[k] : t._c[k]) });
    t.overwriteClip = function (item, time) { const s = typeof time === "number" ? time : time.seconds, d = item._out - item._in;
      const cl = { name: item.name, projectItem: item, start: T(s), end: T(s + d), inPoint: T(item._in), outPoint: T(item._out), remove() { t._c.splice(t._c.indexOf(this), 1); }, isSelected: () => false }; t._c.push(cl); }; return t; };
  const vt = [mkTrack()], at = [mkTrack()];
  const sel = [];
  const songClip = { name: "song.wav", projectItem: song, start: T(10), inPoint: T(5), outPoint: T(65), remove() {}, isSelected: () => sel.indexOf(songClip) >= 0 };
  sel.push(songClip); at[0]._c.push(songClip);
  const seqMarkers = mkColl();
  const seq = { name: "Seq 1", markers: seqMarkers, end: String(100 * 254016000000), getPlayerPosition: () => T(4), getInPointAsTime: () => T(2), getOutPointAsTime: () => T(20),
    getSelection: () => sel, videoTracks: new Proxy({ get numTracks() { return vt.length; } }, { get: (o, k) => (k in o ? o[k] : vt[k]) }), audioTracks: new Proxy({ get numTracks() { return at.length; } }, { get: (o, k) => (k in o ? o[k] : at[k]) }) };
  const rootItem = { type: 2, children: { numItems: 3, 0: song, 1: a, 2: b } };
  let projSel = [a, b];
  const app = { project: { activeSequence: seq, rootItem }, getCurrentProjectViewSelection: () => projSel, enableQE() {} };
  const qe = { project: { getActiveSequence: () => ({ addTracks() { const t = mkTrack(); vt.push(t); } }) } };
  return { app, seq, vt, at, song, a, b, songClip, seqMarkers, setSel: s => { sel.length = 0; s.forEach(x => sel.push(x)); }, setProj: s => { projSel = s; }, extra: { qe } };
}
let p = ppWorld(); c = sandbox(p.app, p.extra);
assert.strictEqual(c.bmInfo(), "OK|PP|Seq 1|4|100|2|20");
assert.strictEqual(c.bmClipInfo(), "OK|song.wav|C:/m/song.wav|10|5|65");
assert.strictEqual(c.bmAdd("11,12,13", "target=seq", "5", "0"), "OK|3|0|0");
assert.deepStrictEqual(p.seqMarkers.list.map(m => [m.start.seconds, m.name]), [[11, "Beat 5"], [12, "Beat 6"], [13, "Beat 7"]]);
p.seqMarkers.list.push({ start: T(9), name: "keep me" });
assert.strictEqual(c.bmAdd("1,15,25", "target=seq;work=1", "1", "1"), "OK|1|2|3");        // work area 2..20: only 15 is placed, old beats 11-13 cleared, user marker kept
assert.deepStrictEqual(p.seqMarkers.list.map(m => m.name).sort(), ["Beat 2", "keep me"]);
// clip markers go on the selected clip's source item, in SOURCE time (timeline 12 -> clip starts at 10, source in 5 -> 7)
assert.strictEqual(c.bmAdd("12,14", "target=clip;cs=10;si=5;path=C:/m/song.wav", "1", "0"), "OK|2|0|0");
assert.deepStrictEqual(p.song.markers.list.map(m => m.start.seconds), [7, 9]);
assert.strictEqual(c.bmClear("target=clip;cs=10;si=5;work=1"), "OK|2");                       // timeline 12 and 14 are inside 2..20
p.setSel([]); assert.ok(c.bmClipInfo().startsWith("ERR|")); assert.ok(c.bmAdd("1", "target=clip", "1", "0").startsWith("ERR|Select the audio clip"));
p.setSel([p.songClip]);
// auto-cut
assert.strictEqual(c.bmClips(), "OK|2|a.mp4~10^b.mp4~8");
const r2 = c.bmCut("0:0.000:20.0000:21.5000;1:2.000:21.5000:23.0000;0:1.500:23.0000:24.0000", "names=a.mp4^b.mp4;rmaudio=1");
assert.strictEqual(r2, "OK|3|0|"); assert.strictEqual(p.vt.length, 2);
const cl = p.vt[1]._c; assert.strictEqual(cl.length, 3);
assert.deepStrictEqual(cl.map(x => [x.start.seconds, x.end.seconds, x.inPoint.seconds]), [[20, 21.5, 0], [21.5, 23, 2], [23, 24, 1.5]]);
assert.strictEqual(p.a._in, 0); assert.strictEqual(p.a._out, 10);                           // source in/out restored
assert.strictEqual(p.at[0]._c.length, 1);                                                    // the song is still there
assert.ok(c.bmCut("0:0:1:2", "names=a.mp4").startsWith("ERR|The Project panel selection changed"));
p.setProj([]); assert.ok(c.bmClips().startsWith("ERR|Select the clips"));
// bin selection expands to clips
p.setProj([p.app.project.rootItem]); assert.strictEqual(c.bmClips().split("|")[1], "3");
const p2 = ppWorld(); p2.app.project.activeSequence = null; const c3 = sandbox(p2.app, p2.extra); assert.ok(c3.bmAdd("1", "target=seq", "1", "0").startsWith("ERR|"));
console.log("host.jsx logic tests passed");
