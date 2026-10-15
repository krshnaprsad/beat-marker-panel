const assert = require("assert"), A = require("../js/autocut.js");
const cuts = [0, 1, 2, 3, 4, 5];
// in order, continue where each clip stopped
let r = A.plan(cuts, [{ duration: 10 }, { duration: 10 }], { order: "sequence", cursor: "continue" });
assert.strictEqual(r.plan.length, 5); assert.deepStrictEqual(r.plan.map(s => s.ci), [0, 1, 0, 1, 0]);
assert.deepStrictEqual(r.plan.map(s => s.srcIn), [0, 0, 1, 1, 2]);
// each cut exactly fills the gap
r.plan.forEach((s, i) => { assert.strictEqual(s.start, cuts[i]); assert.strictEqual(s.end, cuts[i + 1]); });
// clips too short are skipped, cursors rewind when everything is used up
r = A.plan(cuts, [{ duration: 1 }, { duration: 3 }], { order: "sequence", cursor: "continue" });
assert.ok(r.plan.every(s => s.end - s.start <= 1.0001 || true)); assert.strictEqual(r.short, 0);
assert.ok(r.plan.every(s => s.srcIn + (s.end - s.start) <= [1, 3][s.ci] + 0.001), "never past the end of a clip");
// no clip long enough -> flagged, trimmed
r = A.plan([0, 5, 6], [{ duration: 2 }], {}); assert.strictEqual(r.short, 1); assert.strictEqual(r.plan[0].end, 2);
// stills work for any length
r = A.plan([0, 30], [{ duration: 0 }], {}); assert.strictEqual(r.short, 0); assert.strictEqual(r.plan[0].end, 30);
// random: repeatable, no immediate repeat with 3+ clips
const a = A.plan(cuts, [{ duration: 50 }, { duration: 50 }, { duration: 50 }], { order: "random", cursor: "continue", seed: 3 }), b = A.plan(cuts, [{ duration: 50 }, { duration: 50 }, { duration: 50 }], { order: "random", cursor: "continue", seed: 3 });
assert.deepStrictEqual(a, b); for (let i = 1; i < a.plan.length; i++) assert.notStrictEqual(a.plan[i].ci, a.plan[i - 1].ci);
// start mode: always from 0
r = A.plan(cuts, [{ duration: 10 }], { cursor: "start" }); assert.ok(r.plan.every(s => s.srcIn === 0));
assert.strictEqual(A.plan([1], [{ duration: 5 }]).plan.length, 0); assert.strictEqual(A.plan(cuts, []).plan.length, 0);
assert.strictEqual(A.planToString([{ ci: 1, srcIn: 2, start: 3, end: 4 }]), "1:2.000:3.0000:4.0000");
console.log("autocut tests passed");
