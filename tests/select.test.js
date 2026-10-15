const assert = require("assert"), S = require("../js/select.js");
const t = [0, 1, 2, 3, 4, 5, 6, 7, 8];
assert.deepStrictEqual(S.subdivide([0, 1, 2], 2), [0, 0.5, 1, 1.5, 2]);
assert.deepStrictEqual(S.subdivide([0, 1, 2], 3).length, 7); assert.deepStrictEqual(S.subdivide([0, 1], 1), [0, 1]);
assert.deepStrictEqual(S.selectPattern(t, 1, 4, 0, "first"), [0, 4, 8]);
assert.deepStrictEqual(S.selectPattern(t, 1, 4, 1, "first"), [1, 5]);            // offset
assert.deepStrictEqual(S.selectPattern(t, 2, 4, 0, "first"), [0, 1, 4, 5, 8]);
assert.deepStrictEqual(S.selectPattern(t, 2, 4, 0, "even"), [0, 2, 4, 6, 8]);
assert.deepStrictEqual(S.selectPattern(t, 4, 4, 0, "first"), t);
const r1 = S.selectPattern(t, 2, 4, 0, "random"), r2 = S.selectPattern(t, 2, 4, 0, "random");
assert.deepStrictEqual(r1, r2); assert.ok(r1.length >= 4 && r1.length <= 5);        // repeatable
assert.deepStrictEqual(S.applyEdits([0, 1, 2], [1.5], [1], 0.03), [0, 1.5, 2]);
assert.deepStrictEqual(S.applyEdits([0, 1, 2], [], [1.01], 0.03), [0, 2]);
assert.deepStrictEqual(S.inRange(t, 2, 4), [2, 3, 4]);
assert.deepStrictEqual(S.beatInfo([0, 0.5, 1, 1.5]), { bpm: 120, len: 0.5 }); assert.strictEqual(S.beatInfo([1]).bpm, 0);
console.log("select tests passed");
