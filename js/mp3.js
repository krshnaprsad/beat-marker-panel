/* MP3 decoding fallback for hosts whose built-in audio engine can not read MP3.
   Wraps the bundled js-mp3 decoder (js/js-mp3.vendor.js, MIT). Output: mono Float32 samples + sample rate. */
(function (root) {
  function decodeMp3(buf, lib) {
    lib = lib || root.JsMp3;
    if (!lib) throw new Error("The MP3 decoder is missing.");
    var d = lib.newDecoder(buf);
    if (!d) throw new Error("This does not look like a readable MP3 file.");
    var chunks = [d.buf], total = d.buf ? d.buf.byteLength : 0, r;
    d.buf = null;
    for (;;) {                       // read frame by frame and keep each frame's PCM, so long songs do not get re-copied
      r = d.readFrame();
      if (r.err) break;
      chunks.push(d.buf); total += d.buf.byteLength; d.buf = null;
    }
    if (total < 4) throw new Error("No audio found in this MP3.");
    var nch = d.frame.header.numberOfChannels() === 1 ? 1 : 2;   // this decoder writes mono frames as 16-bit mono, not duplicated
    var n = total / (2 * nch) | 0, out = new Float32Array(n), o = 0, i, k;
    for (k = 0; k < chunks.length; k++) {
      var c = chunks[k], s = new Int16Array(c.buffer || c, c.byteOffset || 0, c.byteLength >> 1), m = s.length / nch | 0;
      for (i = 0; i < m; i++) out[o++] = nch === 1 ? s[i] / 32768 : (s[2 * i] + s[2 * i + 1]) / 65536;
    }
    return { samples: o === n ? out : out.subarray(0, o), sampleRate: d.sampleRate };
  }
  var api = { decodeMp3: decodeMp3 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Mp3Dec = api;
})(typeof window !== "undefined" ? window : this);
