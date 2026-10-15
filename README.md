# Beat Marker Panel

A free panel for **Adobe After Effects** and **Premiere Pro**. Pick a music file, the panel finds the beats and drops a marker on every one. Cut your video to the rhythm without tapping the `M` key along to the song.

- **After Effects:** markers go on the active composition.
- **Premiere Pro:** markers go on the active sequence.
- **Beats mode:** finds the tempo, then tracks a steady beat grid that follows the music, including swung rhythms and gentle tempo drift. This is the one to use for cutting to music.
- **Every hit mode:** a marker on every drum hit or note start, with a Sensitivity slider (strong hits only, or everything).
- **Mark every 2nd / 4th / 8th beat.** "Every 4th" finds the bar starts (it picks the beat where the kick and bass land hardest).
- Tempo box with half and double buttons, because the tempo of any song can be read at half or double speed.
- Waveform preview with every beat drawn on it, plus a Play button with a moving playhead.
- Re-run as often as you like. Old "Beat N" markers are replaced. Your own markers are left alone.
- MIT licensed, no account, no internet, nothing leaves your computer.

![The panel](docs/panel.svg)

## Install (no coding needed)

You need Premiere Pro 2020 or newer and/or After Effects 2020 or newer. The panel is a CEP extension.

1. Click **Code > Download ZIP** on this page and unzip it.
2. **Windows:** double-click `install/install-win.bat`.
   **Mac:** open Terminal, type `bash ` (with a space), drag `install/install-mac.sh` into the window, press Enter.
3. Fully quit and reopen Premiere Pro / After Effects.
4. Open **Window > Extensions > Beat Markers** (in After Effects it may be under **Window > Extensions (Legacy)**).

The installer copies the panel to Adobe's per-user extensions folder and turns on "PlayerDebugMode", which Adobe requires for any panel that is not a signed `.zxp`. To uninstall, delete the folder `com.krshnaprsad.beatmarkerpanel` from:

- Windows: `%APPDATA%\Adobe\CEP\extensions\`
- Mac: `~/Library/Application Support/Adobe/CEP/extensions/`

## How to use

1. Open a composition (AE) or sequence (Premiere) and click on it so it is the active one.
2. In the panel, click the dashed box and choose your song. You can also drag a file onto it.
3. Wait a moment. The waveform appears with yellow lines on the beats.
4. Check **Tempo**. If the lines land on every other beat, or twice per beat, press **&frac12;&times;** or **2&times;**. You can also type a BPM.
5. Want one marker per bar? Set **Mark** to every 4th beat. Want every drum hit instead? Switch to **Every hit** and move **Sensitivity**.
6. Set **Audio starts at** to where the song begins in your timeline, in seconds. Leave it at 0 if the song starts at the very beginning. To use the current time indicator, move it to the start of the song and click **Playhead**.
7. Click **Add markers**. In After Effects they are composition markers (top of the timeline). In Premiere they appear on the sequence ruler.
8. **Clear beat markers** removes only the markers this panel made (named "Beat 1", "Beat 2", ...).

## How it works

Everything is analysed inside the panel, in JavaScript. The host (After Effects / Premiere) only receives a list of times and writes the markers.

1. The file is decoded to audio samples (the built-in Web Audio decoder, or a small WAV decoder as a fallback).
2. [`js/detect.js`](js/detect.js) takes a short-time Fourier transform and measures *spectral flux*: how much new energy shows up in each 12 ms step. Drum hits and note starts spike.
3. **Tempo:** the spikes are normalised against their surroundings and autocorrelated. Peaks at T, 2T and T/2 support each other, a soft preference for 118 BPM breaks ties, and the result is refined to a fraction of a BPM.
4. **Beat grid:** a dynamic-programming tracker (Ellis, 2007) picks the beats that sit on strong spikes while staying about one period apart. That gives a steady grid that survives missing hits and swing. Each beat is then snapped to the nearest spike.
5. **Bars:** for "every 4th beat" the panel tries each of the 4 starting points and keeps the one with the strongest low-frequency (kick and bass) hits.
6. **Every hit mode** skips the tempo step: an adaptive threshold on the spikes, with a minimum gap between hits (about 380 ms at the lowest sensitivity, 100 ms at the highest).

## Checked and not checked

I could not run After Effects or Premiere while building this, so it was checked this way:

- **Beat tracking accuracy** on generated music with known beat positions (`node tests/accuracy.test.js`). The test songs have kick, snare, hats and bass. A beat counts as found if it is within 70 ms of the true one. Results:

```
70 BPM straight            tempo   69.9  F 0.989
90 BPM straight            tempo   90.2  F 0.992
100 BPM swung 62%          tempo   99.7  F 0.992
120 BPM straight           tempo  120.1  F 0.994
128 BPM swung 66%          tempo  128.6  F 0.994
140 BPM straight           tempo  139.8  F 0.995
150 BPM, no hats           tempo  152.0  F 0.995
174 BPM straight           tempo  172.9  F 0.991
110 BPM, loud noise        tempo  110.0  F 1.000
120 BPM, tempo drifting 4% tempo  116.7  F 0.994
95 BPM, only a kick on 1   tempo   95.3  F 1.000
mean F 0.994, bar starts F 1.000
```

  These are clean, synthetic songs. Real music is harder: heavy compression, live drummers and long ambient parts will do worse. That is what the Tempo box and the half and double buttons are for.
- Every-hit detection and WAV decoding: `node tests/detect.test.js`.
- The marker code in `jsx/host.jsx` runs against mock After Effects and Premiere objects: `node tests/host.test.js`. It also parses as old ES3 ExtendScript.
- The panel runs in desktop Chrome (screenshot above), and decoding a generated WAV and MP3 works there.

Not verified: decoding inside Adobe's own embedded browser. WAV always works. MP3 and other compressed formats depend on the codecs in your version of the app. If you see "could not be decoded", export the song as WAV (for example with Audacity, or Adobe Media Encoder) and use that. Also not verified: the exact look of the markers in the apps.

If something fails, the panel shows the error text. Open an issue with that text and your app version.

## Roadmap (not in this version)

- Markers with colours and durations, separate marker types for beats, bars and hits.
- Reading audio straight from the selected clip or layer, so you do not pick the file twice.
- Tempo maps for songs that change tempo, and a "nudge all markers" control.
- Auto-cut: split the selected clips at the beats.
- Built-in MP3 decoder for apps that can not decode MP3.

## Files

```
index.html, css/        the panel
js/detect.js            tempo, beat tracking and hit detection (also used by the tests)
js/wav.js               WAV decoder fallback
js/main.js              panel logic
js/cep-bridge.js        talks to the host app
jsx/host.jsx            ExtendScript that writes markers
tests/                  node tests (accuracy, detection, host mocks)
install/                installers for Windows and Mac
```

## License

MIT
