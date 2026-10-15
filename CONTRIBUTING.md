# Developer notes

The panel is plain HTML, CSS and JavaScript (CEP). There is no build step. The only bundled third-party code is `js/js-mp3.vendor.js` (see THIRD-PARTY-LICENSES.md).

## Tests

Run with Node 18 or newer, from the repo root:

```
node tests/detect.test.js     # onset detection and the WAV decoder
node tests/accuracy.test.js   # beat tracking accuracy on generated songs
node tests/select.test.js     # subdivide, N of M, manual edits, ranges
node tests/autocut.test.js    # auto-cut planning
node tests/host.test.js       # jsx/host.jsx against mock After Effects and Premiere objects
node tests/mp3.test.js        # MP3 decoder vs ffmpeg (skipped if ffmpeg is not installed)
```

`jsx/host.jsx` must stay old ExtendScript (ES3): no `let`, `const`, arrow functions or JSON.

## Trying the panel in a browser

Open `index.html` in Chrome. Outside Adobe apps it runs in demo mode: press "Try with a demo beat". Host actions are disabled there.

## Reporting issues

Include the panel's error text, your Premiere / After Effects version, your OS, and what was selected.
