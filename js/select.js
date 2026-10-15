/* Pure helpers for choosing which beats become markers. Used by the panel and by the tests. */
(function (root) {
  // Insert k-1 evenly spaced extra points between neighbouring beats (k = 1 keeps the list).
  function subdivide(times, k) {
    k = Math.max(1, Math.round(k || 1));
    if (k === 1 || times.length < 2) return times.slice();
    var out = [], i, j;
    for (i = 0; i < times.length - 1; i++) { for (j = 0; j < k; j++) out.push(times[i] + (times[i + 1] - times[i]) * j / k); }
    out.push(times[times.length - 1]);
    return out;
  }

  function seeded(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // Pick n beats out of every group of m beats, the group starting at beat index `start` (0..m-1).
  // how: "first" (the first n of the group), "even" (spread over the group), "random" (seeded, repeatable).
  function selectPattern(times, n, m, start, how) {
    m = Math.max(1, Math.round(m || 1)); n = Math.max(1, Math.min(m, Math.round(n || 1))); start = ((Math.round(start || 0) % m) + m) % m;
    if (n >= m) return times.slice();
    var out = [], g, j, rnd = seeded(12345);
    for (g = start; g < times.length; g += m) {
      var pick = [];
      if (how === "even") { for (j = 0; j < n; j++) pick.push(Math.floor(j * m / n)); }
      else if (how === "random") {
        var pool = []; for (j = 0; j < m; j++) pool.push(j);
        while (pick.length < n && pool.length) pick.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
        pick.sort(function (a, b) { return a - b; });
      } else { for (j = 0; j < n; j++) pick.push(j); }
      for (j = 0; j < pick.length; j++) if (g + pick[j] < times.length) out.push(times[g + pick[j]]);
    }
    return out;
  }

  // Manual edits on top of a computed list. added: times to add. removed: times of computed beats to drop (matched within tol).
  function applyEdits(base, added, removed, tol) {
    tol = tol || 0.03;
    var out = base.filter(function (t) { for (var i = 0; i < removed.length; i++) if (Math.abs(removed[i] - t) <= tol) return false; return true; });
    for (var j = 0; j < added.length; j++) out.push(added[j]);
    return out.sort(function (a, b) { return a - b; });
  }

  function inRange(times, a, b) { return times.filter(function (t) { return t >= a && t <= b; }); }

  // Median beat spacing -> { bpm, len } (0 when fewer than 2 beats)
  function beatInfo(times) {
    if (times.length < 2) return { bpm: 0, len: 0 };
    var d = [], i; for (i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
    d.sort(function (a, b) { return a - b; });
    var med = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
    return { bpm: med > 0 ? Math.round(60 / med * 10) / 10 : 0, len: Math.round(med * 1000) / 1000 };
  }

  var api = { subdivide: subdivide, selectPattern: selectPattern, applyEdits: applyEdits, inRange: inRange, beatInfo: beatInfo };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Select = api;
})(typeof window !== "undefined" ? window : this);
