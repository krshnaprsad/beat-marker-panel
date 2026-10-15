/* Beat / onset detection. Pure JS, no dependencies, runs in the panel (CEP Chromium) and in Node tests.
   Stage 1 (slow, once per file): computeFlux  -> spectral flux curve.
   Stage 2 (instant, per slider move): pickBeats -> beat times in seconds. */
(function (root) {
  var FFT_SIZE = 1024, HOP = 512;

  function makeFFT(n) {
    var levels = Math.round(Math.log(n) / Math.LN2), rev = new Uint32Array(n), cos = new Float32Array(n / 2), sin = new Float32Array(n / 2), i, j;
    for (i = 0; i < n; i++) { var r = 0; for (j = 0; j < levels; j++) r |= ((i >> j) & 1) << (levels - 1 - j); rev[i] = r; }
    for (i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    return function (re, im) {
      var k, a, b, size, half, step, t1, t2;
      for (k = 0; k < n; k++) { var q = rev[k]; if (q > k) { t1 = re[k]; re[k] = re[q]; re[q] = t1; t1 = im[k]; im[k] = im[q]; im[q] = t1; } }
      for (size = 2; size <= n; size *= 2) {
        half = size / 2; step = n / size;
        for (a = 0; a < n; a += size) {
          for (b = a, k = 0; b < a + half; b++, k += step) {
            t1 = re[b + half] * cos[k] + im[b + half] * sin[k];
            t2 = -re[b + half] * sin[k] + im[b + half] * cos[k];
            re[b + half] = re[b] - t1; im[b + half] = im[b] - t2; re[b] += t1; im[b] += t2;
          }
        }
      }
    };
  }

  // samples: Float32Array mono. Returns { flux: Float32Array, hop: seconds per frame, duration }
  function computeFlux(samples, sampleRate) {
    var n = FFT_SIZE, fft = makeFFT(n), re = new Float32Array(n), im = new Float32Array(n), win = new Float32Array(n), i, f;
    for (i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    var maxBin = Math.min(n / 2, Math.floor(10000 / (sampleRate / n))), minBin = 2;
    var frames = Math.max(0, Math.floor((samples.length - n) / HOP) + 1), flux = new Float32Array(frames), low = new Float32Array(frames), prev = new Float32Array(maxBin);
    var lowBin = Math.max(3, Math.floor(180 / (sampleRate / n)));
    for (f = 0; f < frames; f++) {
      var off = f * HOP;
      for (i = 0; i < n; i++) { re[i] = samples[off + i] * win[i]; im[i] = 0; }
      fft(re, im);
      var sum = 0, lsum = 0;
      for (i = minBin; i < maxBin; i++) {
        var mag = Math.log(1 + 40 * Math.sqrt(re[i] * re[i] + im[i] * im[i]) / n * 2);
        var d = mag - prev[i]; if (d > 0) { sum += d; if (i < lowBin) lsum += d; } prev[i] = mag;
      }
      flux[f] = f === 0 ? 0 : sum; low[f] = f === 0 ? 0 : lsum;
    }
    return { flux: flux, low: low, hop: HOP / sampleRate, duration: samples.length / sampleRate };
  }

  // sensitivity 0..1 (low = only strong beats, high = dense). everyNth: keep every Nth beat.
  function pickBeats(fx, sensitivity, everyNth) {
    var flux = fx.flux, n = flux.length, hop = fx.hop, i, k;
    if (n < 8) return [];
    var s = Math.max(0, Math.min(1, sensitivity));
    var T = 2.6 - 2.3 * s;                       // z-score threshold
    var minGap = (0.38 - 0.28 * s) / hop;        // frames
    // local mean / std over about +-0.75 s
    var w = Math.max(4, Math.round(0.75 / hop)), cs = new Float64Array(n + 1), cs2 = new Float64Array(n + 1);
    for (i = 0; i < n; i++) { cs[i + 1] = cs[i] + flux[i]; cs2[i + 1] = cs2[i] + flux[i] * flux[i]; }
    var z = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - w), b = Math.min(n, i + w + 1), cnt = b - a;
      var mean = (cs[b] - cs[a]) / cnt, v = (cs2[b] - cs2[a]) / cnt - mean * mean;
      z[i] = (flux[i] - mean) / (Math.sqrt(Math.max(v, 0)) + 1e-4 + 0.05 * mean);
    }
    var cand = [], pk = 3;
    for (i = 1; i < n - 1; i++) {
      if (z[i] < T) continue;
      var isMax = true;
      for (k = Math.max(0, i - pk); k <= Math.min(n - 1, i + pk); k++) if (z[k] > z[i]) { isMax = false; break; }
      if (isMax) cand.push(i);
    }
    // greedy: strongest first, drop neighbours closer than minGap
    var order = cand.slice().sort(function (p, q) { return z[q] - z[p]; }), taken = [], blocked = {};
    for (i = 0; i < order.length; i++) {
      var c = order[i], ok = true;
      for (k = 0; k < taken.length; k++) if (Math.abs(taken[k] - c) < minGap) { ok = false; break; }
      if (ok) taken.push(c);
    }
    taken.sort(function (p, q) { return p - q; });
    var step = Math.max(1, Math.round(everyNth || 1)), out = [];
    // frame f covers samples [f*HOP, f*HOP+FFT); an onset shows up in the frame that first contains it, so centre of its leading edge is ~f*HOP + FFT/4
    for (i = 0; i < taken.length; i += step) out.push(taken[i] * hop + (FFT_SIZE / 4) * (hop / HOP));
    return out;
  }

  // ---- tempo + beat tracking ----
  // Onset envelope used for tempo: flux, locally normalised, with the slow trend removed.
  function envelope(fx) {
    var f = fx.flux, n = f.length, out = new Float32Array(n), i, w = Math.max(4, Math.round(0.5 / fx.hop)), cs = new Float64Array(n + 1), cs2 = new Float64Array(n + 1);
    for (i = 0; i < n; i++) { cs[i + 1] = cs[i] + f[i]; cs2[i + 1] = cs2[i] + f[i] * f[i]; }
    for (i = 0; i < n; i++) {
      var a = Math.max(0, i - w), b = Math.min(n, i + w + 1), c = b - a, m = (cs[b] - cs[a]) / c, v = (cs2[b] - cs2[a]) / c - m * m;
      out[i] = Math.max(0, (f[i] - m) / (Math.sqrt(Math.max(v, 0)) + 1e-4 + 0.05 * m));
    }
    return out;
  }

  // Tempo from the autocorrelation of the onset envelope, with harmonic support (T, 2T, T/2) and a soft prior around 120 BPM.
  // Returns { bpm, confidence 0..1 }. bpm is 0 when the audio has no usable rhythm.
  function estimateTempo(fx) {
    var o = envelope(fx), n = o.length, hop = fx.hop, i, lag;
    var minLag = Math.floor(60 / 220 / hop), maxLag = Math.ceil(60 / 40 / hop);
    if (n < maxLag * 2.5) return { bpm: 0, confidence: 0 };
    var mean = 0; for (i = 0; i < n; i++) mean += o[i]; mean /= n;
    var ac = new Float64Array(maxLag * 2 + 2);
    for (lag = minLag; lag <= maxLag * 2; lag++) { var s = 0; for (i = 0; i + lag < n; i++) s += (o[i] - mean) * (o[i + lag] - mean); ac[lag] = s / (n - lag); }
    var zero = 0; for (i = 0; i < n; i++) zero += (o[i] - mean) * (o[i] - mean); zero /= n;
    if (zero < 1e-6) return { bpm: 0, confidence: 0 };
    var best = -1, bestLag = 0, second = 0, sc = new Float64Array(maxLag + 2);
    for (lag = minLag; lag <= maxLag; lag++) {
      var bpm = 60 / (lag * hop), prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / 118) / Math.LN2 / 0.85, 2));
      var v = ac[lag] + 0.5 * ac[lag * 2] + (lag % 2 === 0 && lag / 2 >= minLag ? 0.25 * ac[lag / 2] : 0);
      sc[lag] = v * (0.35 + 0.65 * prior);
      if (sc[lag] > best) { best = sc[lag]; bestLag = lag; }
    }
    if (best <= 0) return { bpm: 0, confidence: 0 };
    // parabolic refinement
    var l = bestLag, y0 = sc[l - 1] || 0, y1 = sc[l], y2 = sc[l + 1] || 0, den = y0 - 2 * y1 + y2, d = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
    if (Math.abs(d) > 1) d = 0;
    var refined = l + d;
    // very slow readings are usually half the felt tempo: go to double time when the half lag is nearly as strong
    var h = Math.round(l / 2);
    if (60 / (l * hop) < 95 && h >= minLag) { var hv = 0, k; for (k = h - 1; k <= h + 1; k++) hv = Math.max(hv, ac[k]); if (hv >= 0.6 * ac[l] && 60 / (h * hop) <= 190) { refined = h + 0; var m2 = h; var bb = ac[h]; for (k = h - 1; k <= h + 1; k++) if (ac[k] > bb) { bb = ac[k]; m2 = k; } refined = m2; l = m2; } }
    // octave check: if half the lag (double tempo) is almost as strong and lands in 100..180, prefer the faster one only when clearly better
    return { bpm: Math.round(60 / (refined * hop) * 10) / 10, confidence: Math.max(0, Math.min(1, ac[l] / zero * 1.5)) };
  }

  // Dynamic-programming beat tracker (Ellis 2007): beats should land on onsets and stay about one period apart.
  // Returns beat times in seconds.
  function trackBeats(fx, bpm, tightness) {
    var o = envelope(fx), n = o.length, hop = fx.hop, T = 60 / bpm / hop, i, tau, lam = tightness || 90;
    if (!(T > 2) || n < T * 3) return [];
    var C = new Float64Array(n), prev = new Int32Array(n), lo = Math.max(1, Math.round(T / 2)), hi = Math.round(T * 2);
    for (i = 0; i < n; i++) {
      var bestV = 0, bestP = -1;
      for (tau = lo; tau <= hi && tau <= i; tau++) {
        var lr = Math.log(tau / T), v = C[i - tau] - lam * lr * lr;
        if (bestP < 0 || v > bestV) { bestV = v; bestP = i - tau; }
      }
      if (bestP >= 0 && bestV > 0) { C[i] = o[i] + bestV; prev[i] = bestP; } else { C[i] = o[i]; prev[i] = -1; }
    }
    // end: best score within the last period
    var end = n - 1, bestEnd = -1, e;
    for (e = Math.max(0, n - Math.round(T)); e < n; e++) if (C[e] > bestEnd) { bestEnd = C[e]; end = e; }
    var idx = []; for (i = end; i >= 0; i = prev[i]) { idx.push(i); if (prev[i] < 0) break; }
    idx.reverse();
    // extend backwards to the start of the audio with the same period, so the grid covers the intro too
    var out = [], first = idx[0];
    for (i = first - T; i >= 0; i -= T) { var ci = Math.round(i), ev = 0, kk; for (kk = Math.max(0, ci - 2); kk <= Math.min(n - 1, ci + 2); kk++) ev = Math.max(ev, o[kk]); if (ev < 1.0) break; out.unshift(i); }
    for (i = 0; i < idx.length; i++) out.push(idx[i]);
    // snap each beat to the strongest envelope frame within +-2 frames, then convert to seconds
    var times = [], shift = (FFT_SIZE / 4) * (hop / HOP);
    for (i = 0; i < out.length; i++) {
      var c = Math.round(out[i]), bi = c, bv = -1, k;
      for (k = Math.max(0, c - 2); k <= Math.min(n - 1, c + 2); k++) if (o[k] > bv) { bv = o[k]; bi = k; }
      times.push(bi * hop + shift);
    }
    return times;
  }

  // Keep every Nth beat. The starting beat is the one where the summed envelope is strongest, so "every 4th" lands on bar starts.
  function everyNth(times, fx, n) {
    n = Math.max(1, Math.round(n || 1));
    if (n === 1 || times.length < n) return times.slice();
    var o = envelope(fx), k, j, best = -1, bestK = 0, hop = fx.hop, shift = (FFT_SIZE / 4) * (hop / HOP);
    // low-frequency hits (kick, bass) mark bar starts; blend them with the overall envelope
    var lo = envelope({ flux: fx.low || fx.flux, hop: hop });
    for (k = 0; k < n; k++) {
      var sum = 0;
      for (j = k; j < times.length; j += n) { var fi = Math.round((times[j] - shift) / hop); if (fi >= 0 && fi < o.length) sum += o[fi] + 1.5 * lo[fi]; }
      if (sum > best) { best = sum; bestK = k; }
    }
    var out = []; for (j = bestK; j < times.length; j += n) out.push(times[j]); return out;
  }

  // Back-compat: just the BPM number
  function estimateBPM(fx) { return estimateTempo(fx).bpm; }

  // Min/max per bucket for drawing a waveform
  function waveformPeaks(samples, buckets) {
    var out = new Float32Array(buckets * 2), size = samples.length / buckets, b, i;
    for (b = 0; b < buckets; b++) {
      var s = Math.floor(b * size), e = Math.max(s + 1, Math.floor((b + 1) * size)), mn = 0, mx = 0;
      for (i = s; i < e && i < samples.length; i++) { var v = samples[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      out[b * 2] = mn; out[b * 2 + 1] = mx;
    }
    return out;
  }

  var api = { estimateTempo: estimateTempo, trackBeats: trackBeats, everyNth: everyNth, envelope: envelope, computeFlux: computeFlux, pickBeats: pickBeats, estimateBPM: estimateBPM, waveformPeaks: waveformPeaks, HOP: HOP, FFT_SIZE: FFT_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Detect = api;
})(typeof window !== "undefined" ? window : this);
