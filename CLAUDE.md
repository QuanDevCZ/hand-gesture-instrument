# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

`README.md` is the player-facing document — how to play, the sign table, the
chord table. Read it for *what* the instrument does. This file covers *how the
code is arranged* and which properties must not be broken.

## Commands

```bash
npm test                                        # node --test — the whole suite
node --test gestures.test.mjs                   # one file
node --test --test-name-pattern "brief flicker" # one test
npx serve .                                     # or: py -m http.server 8123
```

There is **no build, no bundler, no linter, and no install step** — zero runtime
dependencies, `package.json` has no `dependencies` block at all, and
`npm install` does nothing useful. The suite is 50 tests on `node --test`.

The page must be served over `http://`: ES modules and `getUserMedia` both
refuse `file://`. First load also needs the network — the MediaPipe runtime and
the `hand_landmarker.task` model are fetched from jsDelivr and Google Storage by
URL inside [main.js](main.js), not vendored.

## Module split — the load-bearing boundary

```
index.html    markup + HUD chrome
styles.css    the look (CSS custom properties in :root; cyan = colour hand, amber = chord hand)
main.js       camera, requestAnimationFrame loop, hand-role assignment, wiring   <- browser-only
gestures.js   landmarks -> sign, tilt, extension, volume                         <- PURE, tested
music.js      sign + quality + extension -> note names, MIDI, frequencies        <- PURE, tested
audio.js      Web Audio — the PATCHES table of six voices, and the synth                                        <- browser-only
hud.js        all canvas drawing and DOM readouts
```

`gestures.js` and `music.js` import **nothing** — no DOM, no `AudioContext`, no
MediaPipe. That is the entire reason the instrument can be verified in Node
against a **synthetic hand** (built in [gestures.test.mjs](gestures.test.mjs) in
palm-width units, rotated, scaled, placed in frame, then normalised the way
MediaPipe reports landmarks) with no webcam involved.

**Keep new logic on the pure side of that line.** If a function needs
`document`, `performance.now()` as a hidden global, or `AudioContext`, it
belongs in `main.js`, `hud.js`, or `audio.js` — pass time in as the `now`
argument instead, the way `createReader().read()` and `createLatch().push()` do.

Tuning constants live in one exported object at the top of the module they
govern: `DEFAULTS` in [gestures.js](gestures.js), `PATCHES` in [audio.js](audio.js).
Add tunables there rather than inlining numbers.

## Invariants the tests assert — do not "simplify" these away

- **Frame-rate independence.** Every temporal behaviour is a millisecond time
  constant, never a frame count: the 100 ms debounce (`stableMs`), the tilt
  smoothing (`tiltTauMs`), the volume follower (`volTauMs`), and the synth
  envelopes. Tests assert a swell and a debounce take the same wall time at
  15 fps as at 60. Replacing `1 - Math.exp(-dtMs / tau)` with a fixed per-frame
  alpha breaks them.
- **Hysteresis on the tilt.** Past `+tiltDeg` is major, past `-tiltDeg` is
  minor, and inside the deadzone the last quality *latches*. Do not collapse
  this to a single `tilt > 0` threshold — the chord would flicker every time the
  hand crossed vertical.
- **Ratio-based measurement.** Distances are normalised against the hand's own
  palm width (`palmSize`) and taken in pixel space, so 16:9 does not stretch
  them and nothing depends on distance from the camera. Tests cover three
  distances and three positions in frame.
- **Extension by which fingers, not how many.** `SIGN_PATTERNS` is keyed on the
  five-bit extended-finger string, which is what puts 6 (`10001`) and 7
  (`11001`) on a five-finger hand without asking the tracker to resolve a
  fingertip pinch — the one thing it is bad at. A test asserts 6 and 7 never
  collide with 2 and 3.
- **An unrecognised shape holds the chord; only a fist or an absent hand
  silences.** Every transition between two signs passes through a shape that is
  not in the table, so `signFromStates` returning `null` must mean "keep
  playing", not "stop".
- **One table drives both notes and name.** `EXTENSIONS[].intervals` and
  `.suffix` are both functions of the quality, so the printed chord name cannot
  disagree with what you hear. The on-page cheat sheet that `hud.buildSheet()`
  generated from `SIGN_PATTERNS` and `EXTENSIONS` went with the full-bleed
  layout — `README.md` is now the only sign table, so it has to be kept in step
  with those tables by hand.
- **No patch decays to silence.** A sign is *held*, not struck, and nothing
  re-triggers a voice — so a percussive patch falls to a low sustain floor
  (`pluck` sits at .14) rather than to zero. A `sustain` of 0 would let a chord
  fade out under the player's hand; `audio.test.mjs` asserts every patch stays
  above .05.
- **Spelling walks letters first, accidental second** (`LETTER_STEP` in
  music.js), so C minor is `C E♭ G`, not `C D♯ G`. A test checks the flat.

## Two things that surprise people

**Handedness is learned, not assumed.** MediaPipe labels hands as though the
image were mirrored, while `getUserMedia` delivers an unmirrored frame — so
whether `"Left"` means the player's left hand depends on the camera. `splitHands`
in [main.js](main.js) infers it from the first frame showing both hands (the view
is mirrored, so the left hand is the one further *right* in raw coordinates) and
then trusts the label, which is what keeps roles put when a hand leaves frame.
The `SWAP HANDS` / `FLIP TILT` buttons persist overrides in `localStorage` under
`ch.chordHand` / `ch.invertTilt`.

**The mirror is CSS, not maths.** `#video` and `#overlay` both carry
`transform:scaleX(-1)` in [styles.css](styles.css), and `sizeCanvas` matches the
canvas to the video's intrinsic resolution so the two crop identically. Drawing
code therefore works in raw landmark coordinates with no flip — except text,
which `drawTiltDial` flips back with `ctx.scale(-1,1)` to stay readable.

## Audio notes

`synth.start()` must be called from inside a real click handler or the
`AudioContext` comes up suspended and the first chord never sounds. `setNotes`
is diffed against the currently sounding voices, so a triad becoming a maj7
starts one oscillator instead of restarting four — `main.js` guards it with a
`sounding` key and only calls in when the MIDI set actually changes. The reverb
impulse is generated from decaying noise at runtime rather than shipped as a
file, which is part of staying dependency-free.

`setPatch` re-strikes: the patch owns `build()`, so swapping instruments means
releasing every voice and rebuilding it. It does that **inside audio.js**, against
a `current` note set it keeps for the purpose — the MIDI set never changes across
a patch swap, so `main.js`'s `sounding` key stays valid and the caller does not
re-issue the chord. Picking a sound deliberately does *not* `panic()` the way
`SWAP HANDS` does; the chord carries across so two voices can be compared under
one voicing. Voices also carry their own release time, since a pad's 1.2 s tail
and 8-bit's 50 ms cut are as much the patch as its oscillators.

## Sibling project

`../dojang-hud/` is the same architecture applied to taekwondo kicks (MediaPipe
Pose, `analysis.js` in place of `gestures.js`). Patterns established in one
should usually match the other.
