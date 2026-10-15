/* Auto-cut planning (pure JS). Given cut times and the footage the user selected, decide which clip and
   which part of it fills each gap between two cuts. The host scripts then place exactly this plan. */
(function (root) {
  function seeded(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // cuts: ascending times in seconds (timeline). clips: [{ duration }] (duration 0 = a still image, any length works).
  // opts: order "sequence" | "random", cursor "continue" (each clip carries on where it stopped) | "start" (always from the start).
  // Returns { plan: [{ ci, srcIn, start, end }], short: number }  short = cuts where no clip was long enough.
  function plan(cuts, clips, opts) {
    opts = opts || {};
    var out = [], cursor = [], i, k, rnd = seeded(opts.seed || 7), short = 0, last = -1, rr = 0;
    if (!clips.length || cuts.length < 2) return { plan: [], short: 0 };
    for (i = 0; i < clips.length; i++) cursor.push(0);
    for (i = 0; i < cuts.length - 1; i++) {
      var len = cuts[i + 1] - cuts[i], tries = 0, ci = -1;
      if (len <= 0) continue;
      function fits(c) { var d = clips[c].duration; return d === 0 || d - (opts.cursor === "start" ? 0 : cursor[c]) >= len - 0.001; }
      // choose the next clip, skipping ones that are used up or too short
      var order = [];
      if (opts.order === "random") { for (k = 0; k < clips.length; k++) order.push(k); for (k = order.length - 1; k > 0; k--) { var j = Math.floor(rnd() * (k + 1)), t = order[k]; order[k] = order[j]; order[j] = t; } if (clips.length > 1) order = order.filter(function (c) { return c !== last; }).concat(clips.length > 1 ? [] : [last]); }
      else { for (k = 0; k < clips.length; k++) order.push((rr + k) % clips.length); }
      for (k = 0; k < order.length; k++) if (fits(order[k])) { ci = order[k]; break; }
      if (ci < 0) { // everything used up: rewind the cursors once and try again
        for (k = 0; k < clips.length; k++) cursor[k] = 0;
        for (k = 0; k < order.length; k++) if (fits(order[k])) { ci = order[k]; break; }
      }
      if (ci < 0) { // no clip is long enough at all: use the longest one, trimmed to its length
        short++; ci = 0; for (k = 1; k < clips.length; k++) if (clips[k].duration > clips[ci].duration) ci = k;
        out.push({ ci: ci, srcIn: 0, start: cuts[i], end: cuts[i] + Math.min(len, clips[ci].duration || len) });
        last = ci; rr = (ci + 1) % clips.length; continue;
      }
      var srcIn = opts.cursor === "start" ? 0 : cursor[ci];
      out.push({ ci: ci, srcIn: Math.round(srcIn * 1000) / 1000, start: cuts[i], end: cuts[i + 1] });
      cursor[ci] = srcIn + len; last = ci; rr = (ci + 1) % clips.length;
    }
    return { plan: out, short: short };
  }

  function planToString(p) { return p.map(function (s) { return s.ci + ":" + s.srcIn.toFixed(3) + ":" + s.start.toFixed(4) + ":" + s.end.toFixed(4); }).join(";"); }

  var api = { plan: plan, planToString: planToString };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.AutoCut = api;
})(typeof window !== "undefined" ? window : this);
