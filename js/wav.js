/* Pure-JS WAV decoder (PCM 8/16/24/32-bit and float32). Used when the browser cannot decode a file itself. */
(function (root) {
  function decodeWav(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    function tag(o) { return String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]); }
    if (buf.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
    var pos = 12, fmt = null, dataOff = -1, dataLen = 0;
    while (pos + 8 <= buf.byteLength) {
      var id = tag(pos), len = dv.getUint32(pos + 4, true);
      if (id === "fmt ") fmt = { format: dv.getUint16(pos + 8, true), channels: dv.getUint16(pos + 10, true), rate: dv.getUint32(pos + 12, true), bits: dv.getUint16(pos + 22, true) };
      else if (id === "data") { dataOff = pos + 8; dataLen = Math.min(len, buf.byteLength - dataOff); break; }
      pos += 8 + len + (len & 1);
    }
    if (!fmt || dataOff < 0) throw new Error("Broken WAV file");
    var ext = fmt.format === 0xFFFE ? dv.getUint16(pos + 8 + 24, true) : fmt.format; // WAVE_FORMAT_EXTENSIBLE sub-format
    var bytes = fmt.bits / 8, frames = Math.floor(dataLen / (bytes * fmt.channels)), out = new Float32Array(frames), i, c;
    if (!(ext === 1 || ext === 3)) throw new Error("Unsupported WAV encoding (" + ext + ")");
    for (i = 0; i < frames; i++) {
      var sum = 0;
      for (c = 0; c < fmt.channels; c++) {
        var o = dataOff + (i * fmt.channels + c) * bytes, v;
        if (ext === 3) v = fmt.bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
        else if (fmt.bits === 8) v = (u8[o] - 128) / 128;
        else if (fmt.bits === 16) v = dv.getInt16(o, true) / 32768;
        else if (fmt.bits === 24) { v = (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16)); if (v & 0x800000) v -= 0x1000000; v /= 8388608; }
        else v = dv.getInt32(o, true) / 2147483648;
        sum += v;
      }
      out[i] = sum / fmt.channels;
    }
    return { samples: out, sampleRate: fmt.rate };
  }
  var api = { decodeWav: decodeWav };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Wav = api;
})(typeof window !== "undefined" ? window : this);
