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
  function lowBinFor(sampleRate, n) { return Math.max(3, Math.floor(180 / (sampleRate / n))); }
  function computeFlux(samples, sampleRate) {
    var n = FFT_SIZE, fft = makeFFT(n), re = new Float32Array(n), im = new Float32Array(n), win = new Float32Array(n), i, f;
    for (i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    var maxBin = Math.min(n / 2, Math.floor(10000 / (sampleRate / n))), minBin = 2;
    var frames = Math.max(0, Math.floor((samples.length - n) / HOP) + 1), flux = new Float32Array(frames), low = new Float32Array(frames), mid = new Float32Array(frames), high = new Float32Array(frames), prev = new Float32Array(maxBin);
    // mel-like bands (log-spaced, about 40 Hz to 10 kHz): each band's log energy rise, averaged over bands
    var NB = 32, bandOf = new Int16Array(maxBin), bandCnt = new Float32Array(NB), bandE = new Float32Array(NB), bandPrev = new Float32Array(NB), mel = new Float32Array(frames), rms = new Float32Array(frames), binHz = sampleRate / n, mlo = 2595 * Math.log(1 + 40 / 700) / Math.LN10, mhi = 2595 * Math.log(1 + 10000 / 700) / Math.LN10;
    for (i = minBin; i < maxBin; i++) { var mm = 2595 * Math.log(1 + (i * binHz) / 700) / Math.LN10, bb = Math.floor((mm - mlo) / (mhi - mlo) * NB); bandOf[i] = Math.max(0, Math.min(NB - 1, bb)); bandCnt[bandOf[i]]++; }
    var midBin = Math.max(lowBinFor(sampleRate, n) + 1, Math.floor(2500 / (sampleRate / n)));
    var lowBin = lowBinFor(sampleRate, n);
    for (f = 0; f < frames; f++) {
      var off = f * HOP, e2 = 0;
      for (i = 0; i < n; i++) { re[i] = samples[off + i] * win[i]; im[i] = 0; e2 += samples[off + i] * samples[off + i]; }
      rms[f] = Math.sqrt(e2 / n);
      fft(re, im);
      var sum = 0, lsum = 0, msum = 0, hsum = 0; bandE.fill(0);
      for (i = minBin; i < maxBin; i++) {
        var pw2 = re[i] * re[i] + im[i] * im[i]; bandE[bandOf[i]] += pw2;
        var mag = Math.log(1 + 40 * Math.sqrt(pw2) / n * 2);
        var d = mag - prev[i]; if (d > 0) { sum += d; if (i < lowBin) lsum += d; else if (i < midBin) msum += d; else hsum += d; } prev[i] = mag;
      }
      var msumv = 0, bq; for (bq = 0; bq < NB; bq++) { var bl = Math.log(1 + 40 * Math.sqrt(bandE[bq]) / n * 2), dd = bl - bandPrev[bq]; if (dd > 0) msumv += dd; bandPrev[bq] = bl; }
      mel[f] = f === 0 ? 0 : msumv / NB;
      flux[f] = f === 0 ? 0 : sum; low[f] = f === 0 ? 0 : lsum; mid[f] = f === 0 ? 0 : msum / Math.sqrt(midBin - lowBin); high[f] = f === 0 ? 0 : hsum / Math.sqrt(Math.max(1, maxBin - midBin));
    }
    return { flux: flux, rms: rms, mel: mel, low: low, mid: mid, high: high, hop: HOP / sampleRate, duration: samples.length / sampleRate };
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

  // Onset curve for the beat grid: the three bands are normalised separately and then mixed, so rows of quiet hi-hats
  // do not outweigh the kick and snare that define where the beat is.
  function beatEnv(fx) {
    if (fx._be) return fx._be;
    var hop = fx.hop, base, out, i;
    if (!fx.mid) { fx._be = envelope(fx); return fx._be; }
    var l = envelope({ flux: fx.low, hop: hop }), m = envelope({ flux: fx.mid, hop: hop }), h = envelope({ flux: fx.high, hop: hop });
    out = new Float32Array(l.length);
    for (i = 0; i < out.length; i++) out[i] = 1.0 * l[i] + 0.9 * m[i] + 0.35 * h[i];
    var pe = new Float32Array(l.length); for (i = 0; i < pe.length; i++) pe[i] = 1.0 * l[i] + 0.6 * m[i] + 0.1 * h[i]; fx._pe = pe;
    fx._be = out; fx._bands = [[l, 1.0], [m, 0.9], [h, 0.35]]; return out;
  }
  // 3-tap smoothing, so a hit that falls between two frames still lines up with its neighbours at the next beat
  function smooth3(a) { var o = new Float32Array(a.length), i; for (i = 0; i < a.length; i++) o[i] = 0.25 * (a[i > 0 ? i - 1 : 0]) + 0.5 * a[i] + 0.25 * (a[i < a.length - 1 ? i + 1 : i]); return o; }
  function percentile(arr, p) { var c = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; }); return c.length ? c[Math.min(c.length - 1, Math.floor(p * c.length))] : 0; }
  // Beat strength in raw (not normalised) flux: tells real hits from a pad or silence, which normalisation would blow up.
  function strongEnough(fx) {
    if (fx._se) return fx._se;
    // local activity = mean raw flux over ~1.2 s; a section well below the song's usual level is a pad, a break or silence
    var f = fx.flux, n = f.length, w = Math.max(2, Math.round(0.6 / fx.hop)), pre = new Float64Array(n + 1), i, loc = new Float64Array(n);
    for (i = 0; i < n; i++) pre[i + 1] = pre[i] + f[i];
    for (i = 0; i < n; i++) { var lo = Math.max(0, i - w), hi = Math.min(n, i + w + 1); loc[i] = (pre[hi] - pre[lo]) / (hi - lo); }
    var thr = 0.5 * percentile(loc, 0.6), r = fx.rms, lr = new Float64Array(n), rp = new Float64Array(n + 1);
    if (r) { for (i = 0; i < n; i++) rp[i + 1] = rp[i] + r[i]; for (i = 0; i < n; i++) { var a2 = Math.max(0, i - w), b2 = Math.min(n, i + w + 1); lr[i] = (rp[b2] - rp[a2]) / (b2 - a2); } }
    var rthr = r ? 0.4 * percentile(lr, 0.6) : 0;
    fx._se = function (frame) { var q = Math.max(0, Math.min(n - 1, frame)); return loc[q] >= thr && (!r || lr[q] >= rthr); };
    return fx._se;
  }

  // Comb score: how well do onsets sit on a grid with period L (frames)? Best phase wins. Returns { score, phase }.
  function comb(o, m, L, mean) {
    var n = o.length, best = -1e9, bestPh = 0, ph, k, step = Math.max(1, Math.floor(L / 24));
    for (ph = 0; ph < L; ph += step) {
      var sum = 0, cnt = 0;
      for (var t = ph; t < n - 1; t += L) { sum += m[Math.round(t)]; cnt++; }
      if (cnt > 2) { var v = sum / cnt - mean; if (v > best) { best = v; bestPh = ph; } }
    }
    return { score: best, phase: bestPh };
  }

  // Tempo: candidates from the autocorrelation of the onset curve plus their octaves, each judged by how well a beat grid
  // of that tempo sits on the onsets (best phase), with a soft preference for tempos in the 90-190 range. Returns { bpm, confidence 0..1 }.
  function estimateTempo(fx) {
    var o = beatEnv(fx), n = o.length, hop = fx.hop, i, lag;
    var minLag = Math.floor(60 / 220 / hop), maxLag = Math.ceil(60 / 40 / hop);
    if (n < maxLag * 2.5) return { bpm: 0, confidence: 0 };
    var mean = 0; for (i = 0; i < n; i++) mean += o[i]; mean /= n;
    var ac = new Float64Array(maxLag * 2 + 2), zero = 0;
    for (i = 0; i < n; i++) zero += (o[i] - mean) * (o[i] - mean); zero /= n;
    if (zero < 1e-6) return { bpm: 0, confidence: 0 };
    for (lag = minLag; lag <= Math.min(maxLag * 2, n - 10); lag++) { var s = 0; for (i = 0; i + lag < n; i++) s += (o[i] - mean) * (o[i + lag] - mean); ac[lag] = s / (n - lag); }
    // candidate lags: local maxima of the harmonic-summed autocorrelation, plus half and double
    var cand = {}, sc = new Float64Array(maxLag + 2), acMax = 1e-9;
    for (lag = minLag; lag <= maxLag; lag++) { sc[lag] = ac[lag] + 0.5 * ac[lag * 2] + (lag % 2 === 0 && lag / 2 >= minLag ? 0.25 * ac[lag / 2] : 0); if (sc[lag] > acMax) acMax = sc[lag]; }
    var peaks = []; for (lag = minLag + 1; lag < maxLag; lag++) if (sc[lag] > sc[lag - 1] && sc[lag] >= sc[lag + 1] && sc[lag] > 0.1 * acMax) peaks.push(lag);
    peaks.sort(function (a, b) { return sc[b] - sc[a]; }); peaks = peaks.slice(0, 6);
    peaks.forEach(function (p) { [p, p * 2, p / 2, p * 1.5, p * 2 / 3].forEach(function (L) { L = Math.round(L); if (L >= minLag && L <= maxLag) cand[L] = 1; }); });
    // max over +-1 frame, so a hit that lands between two frames still counts
    var m = new Float32Array(n); for (i = 0; i < n; i++) m[i] = Math.max(o[i], i > 0 ? o[i - 1] : 0, i < n - 1 ? o[i + 1] : 0);
    var bestL = 0, bestV = -1e9;
    Object.keys(cand).forEach(function (key) {
      var L = +key, bpm = 60 / (L * hop), prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / 135) / Math.LN2 / 0.6, 2));
      var a = Math.max(0, sc[L] || ac[L] || 0) / acMax;
      var v = a * (0.35 + 0.65 * prior);
      if (v > bestV) { bestV = v; bestL = L; }
    });
    if (!bestL || bestV <= 0) return { bpm: 0, confidence: 0 };
    // refine: search +-3% around the winner for the grid period that fits the onsets best
    var refL = bestL, refV = -1e9, f;
    for (f = 0.97; f <= 1.0301; f += 0.001) { var Lf = bestL * f, cs = comb(o, m, Lf, mean).score - Math.abs(f - 1) * 0.02; if (cs > refV) { refV = cs; refL = Lf; } }
    return { bpm: Math.round(60 / (refL * hop) * 10) / 10, confidence: Math.max(0, Math.min(1, (ac[bestL] || 0) / zero * 1.5)) };
  }

  // Dynamic-programming beat tracker (Ellis 2007): beats should land on onsets and stay about one period apart.
  // Returns beat times in seconds.
  function trackBeats(fx, bpm, tightness) {
    var o0 = beatEnv(fx), n = o0.length, hop = fx.hop, T = 60 / bpm / hop, i, tau, lam = tightness || 400, real = strongEnough(fx);
    // only the parts that really have beats take part in the search, so a quiet intro cannot set the grid phase for the whole song
    var o = new Float32Array(n); for (i = 0; i < n; i++) o[i] = real(i) ? o0[i] : 0;
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
    for (i = first - T; i >= 0; i -= T) { var ci = Math.round(i), ev = 0, kk; for (kk = Math.max(0, ci - 2); kk <= Math.min(n - 1, ci + 2); kk++) ev = Math.max(ev, o[kk]); if (!real(ci) || ev < 1.5) break; out.unshift(i); }
    for (i = 0; i < idx.length; i++) out.push(idx[i]);
    // snap each beat to the strongest envelope frame within +-2 frames, then convert to seconds
    var times = [], strength = [], shift = (FFT_SIZE / 4) * (hop / HOP);
    for (i = 0; i < out.length; i++) {
      var c = Math.round(out[i]), bi = c, bv = -1, k;
      for (k = Math.max(0, c - 2); k <= Math.min(n - 1, c + 2); k++) if (o[k] > bv) { bv = o[k]; bi = k; }
      if (real(bi)) { times.push(bi * hop + shift); strength.push(bv); }   // no beats where there is only a pad or silence
    }
    // the grid must not run past the real start or end of the music: trim leading and trailing beats with no onset under them
    var lim = 0.4 * percentile(strength, 0.5);
    while (times.length && strength[0] < lim) { times.shift(); strength.shift(); }
    while (times.length && strength[strength.length - 1] < lim) { times.pop(); strength.pop(); }
    return times;
  }

  // Move each time onto the actual attack in the audio: the point within +-win seconds where short-term energy rises the most.
  // The spectral-flux frames used for detection are 23 ms long, so their peaks sit a little before or after the real attack.
  function refineOnsets(times, x, sr, win) {
    win = win || 0.045; var w = Math.max(8, Math.round(0.003 * sr)), out = [], k, j;
    for (k = 0; k < times.length; k++) {
      var c = Math.round(times[k] * sr), a = Math.max(w, c - Math.round(win * sr)), b = Math.min(x.length - w - 1, c + Math.round(win * sr));
      if (b - a < 4 * w) { out.push(times[k]); continue; }
      var len = b - a + 2 * w + 1, pre = new Float64Array(len + 1);
      for (j = 0; j < len; j++) { var v = x[a - w + j]; pre[j + 1] = pre[j] + v * v; }
      var best = -1, bestJ = c - a, sum = 0, cnt = 0;
      for (j = w; j <= b - a + w; j++) {
        var right = pre[j + w] - pre[j], left = pre[j] - pre[j - w], rise = right - left; sum += right; cnt++;
        if (rise > best) { best = rise; bestJ = j - w; }
      }
      var meanE = sum / Math.max(1, cnt);
      out.push(best > 1.5 * meanE ? (a + bestJ) / sr : times[k]);
    }
    return out;
  }

  // Which of the first m beats starts a group of m (bar start)? The one where the summed envelope is strongest.
  function barStart(times, fx, m) {
    m = Math.max(1, Math.round(m || 4));
    if (m === 1 || times.length < m) return 0;
    var o = envelope(fx), lo = envelope({ flux: fx.low || fx.flux, hop: fx.hop }), k, j, best = -1, bestK = 0, hop = fx.hop, shift = (FFT_SIZE / 4) * (hop / HOP);
    for (k = 0; k < m; k++) {
      var sum = 0;
      for (j = k; j < times.length; j += m) { var fi = Math.round((times[j] - shift) / hop); if (fi >= 0 && fi < o.length) sum += o[fi] + 1.5 * lo[fi]; }
      if (sum > best) { best = sum; bestK = k; }
    }
    return bestK;
  }
  // Keep every Nth beat, starting at the bar start.
  function everyNth(times, fx, n) {
    n = Math.max(1, Math.round(n || 1));
    if (n === 1 || times.length < n) return times.slice();
    var k = barStart(times, fx, n), out = [], j; for (j = k; j < times.length; j += n) out.push(times[j]); return out;
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

  var api = { barStart: barStart, estimateTempo: estimateTempo, beatEnv: beatEnv, refineOnsets: refineOnsets, trackBeats: trackBeats, everyNth: everyNth, envelope: envelope, computeFlux: computeFlux, pickBeats: pickBeats, estimateBPM: estimateBPM, waveformPeaks: waveformPeaks, HOP: HOP, FFT_SIZE: FFT_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Detect = api;
})(typeof window !== "undefined" ? window : this);
