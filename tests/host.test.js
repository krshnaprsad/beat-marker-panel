// node tests/host.test.js - runs jsx/host.jsx against mock After Effects / Premiere objects.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../jsx/host.jsx", "utf8");
function sandbox(app, extra) { const c = Object.assign({ app, parseFloat, parseInt, String, isNaN }, extra); vm.createContext(c); vm.runInContext(src, c); return c; }

// ---- After Effects fake
function aeWorld(duration) {
  class CompItem {}
  const comp = Object.assign(new CompItem(), { name: "Main", time: 2.5, duration });
  const keys = [];
  comp.markerProperty = { get numKeys() { return keys.length; }, setValueAtTime(t, v) { keys.push({ t, v }); keys.sort((a, b) => a.t - b.t); }, keyValue(i) { return keys[i - 1].v; }, removeKey(i) { keys.splice(i - 1, 1); } };
  const log = []; const app = { project: { activeItem: comp }, beginUndoGroup: n => log.push("begin"), endUndoGroup: () => log.push("end") };
  class MarkerValue { constructor(c) { this.comment = c; } }
  return { app, keys, log, extra: { CompItem, MarkerValue } };
}
let w = aeWorld(10), c = sandbox(w.app, w.extra);
assert.strictEqual(c.bmInfo(), "OK|AE|Main|2.5|10");
assert.strictEqual(c.bmAdd("0.5,1.0,1.5,12", "0", "1", "0"), "OK|3|1|0");
assert.strictEqual(w.keys.length, 3); assert.strictEqual(w.keys[1].v.comment, "Beat 2");
w.keys.push({ t: 9, v: { comment: "my own marker" } });
assert.strictEqual(c.bmAdd("2,3", "1", "1", "1"), "OK|2|0|3");           // clears the old beats, keeps the user's marker
assert.deepStrictEqual(w.keys.map(k => k.v.comment).sort(), ["Beat 1", "Beat 2", "my own marker"]);
assert.strictEqual(w.keys.filter(k => k.v.comment === "Beat 1")[0].t, 3);  // offset applied
assert.strictEqual(c.bmClear(), "OK|2"); assert.strictEqual(w.keys.length, 1);
assert.ok(w.log.join() .includes("begin") && w.log.join().includes("end"));
w = aeWorld(5); w.app.project.activeItem = null; c = sandbox(w.app, w.extra); assert.ok(c.bmAdd("1", "0", "1", "0").startsWith("ERR|"));

// ---- Premiere fake (no CompItem)
function ppWorld() {
  const list = [];
  const markers = { createMarker(t) { const m = { start: t, name: "" }; list.push(m); return m; }, getFirstMarker: () => list[0] || null, getNextMarker: m => list[list.indexOf(m) + 1] || null, deleteMarker(m) { list.splice(list.indexOf(m), 1); } };
  const seq = { name: "Seq 1", markers, end: String(10 * 254016000000), getPlayerPosition: () => ({ seconds: 4 }) };
  return { app: { project: { activeSequence: seq } }, list };
}
const p = ppWorld(); c = sandbox(p.app, {});
assert.strictEqual(c.bmInfo(), "OK|PP|Seq 1|4|10");
assert.strictEqual(c.bmAdd("1,2,3", "0.5", "5", "0"), "OK|3|0|0");
assert.deepStrictEqual(p.list.map(m => [m.start, m.name]), [[1.5, "Beat 5"], [2.5, "Beat 6"], [3.5, "Beat 7"]]);
p.list.push({ start: 9, name: "keep me" });
assert.strictEqual(c.bmAdd("1", "0", "1", "1"), "OK|1|0|3"); assert.strictEqual(p.list.length, 2);
assert.strictEqual(c.bmClear(), "OK|1"); assert.deepStrictEqual(p.list.map(m => m.name), ["keep me"]);
console.log("host.jsx logic tests passed");
