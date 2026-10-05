# CHORD HANDS

A webcam instrument. Shape a chord with one hand, colour it with the other, and
it plays. Runs entirely in the browser — camera in, synthesized chords out. No
backend, no install, no dependencies.

**Play it live:** https://webjohn7.github.io/hand-gesture-instrument/ — hit
**INITIALIZE**, allow the camera, both hands in frame. Desktop browser with a
webcam; headphones recommended.

![tech](https://img.shields.io/badge/MediaPipe-Hands-00e5ff) ![tech](https://img.shields.io/badge/Web%20Audio-6%20sounds-ffb340) ![tech](https://img.shields.io/badge/deps-0-brightgreen)

## How you play it

| Control | Gesture | Effect |
|---|---|---|
| **Chord hand — shape** | signs 1–7 | the root: C D E F G A B |
| **Chord hand — tilt** | lean inward / outward | major / minor |
| **Chord hand — fist** | ✊ | silence |
| **Colour hand — count** | 0–5 fingers | 7ths, sus, add9, 6ths |
| **Colour hand — height** | high / low | volume |
| **Sound** | chips, bottom left, or keys 1–6 | the instrument |

Roughly 84 chords between the two hands.

### The signs

Signs are read by **which** fingers are up, not how many — that is what puts 6
and 7 on a five-finger hand without asking the tracker to resolve a fingertip
pinch, which is the one thing it is bad at.

| Sign | Fingers | Root |
|---|---|---|
| 1 | index | C |
| 2 | index + middle | D |
| 3 | index + middle + ring | E |
| 4 | four fingers, thumb tucked | F |
| 5 | open hand | G |
| 6 | thumb + pinky 🤙 | A |
| 7 | thumb + index + pinky 🤟 | B |
| — | fist | silence |

Anything that is *not* in that table holds the current chord rather than cutting
it, because every transition between two signs passes through one.

### The colour hand

| Fingers | Adds | Major | Minor |
|---|---|---|---|
| 0 / hand away | triad | C | Cm |
| 1 | 7th, following the tilt | Cmaj7 | Cm7 |
| 2 | dominant 7th | C7 | C7 |
| 3 | sus4 | Csus4 | Csus4 |
| 4 | add9 | Cadd9 | Cm(add9) |
| 5 | 6th | C6 | Cm6 |

Two exceptions worth knowing: a **dominant 7th** needs a major third by
definition, so count 2 overrides the tilt (and stays audibly distinct from count
1 in minor); **sus4** has no third at all, so the tilt has nothing to change.

### The sounds

Six instruments, all synthesized on the spot — no samples ship with the page.
Click a chip in the bottom-left cluster or press `1`–`6`; the chord you are
holding carries across the change, so you can compare them under one voicing.
The choice is remembered.

| Key | Sound | What it is |
|---|---|---|
| 1 | **RHODES** | the original FM electric piano — the default |
| 2 | **BELLS** | FM at a ratio just off 3, so the partial beats; long tail, wet |
| 3 | **PAD** | three detuned saws that swell in over 0.6 s and drift under a held chord |
| 4 | **ORGAN** | additive drawbars at 1× 2× 3× 4×, instant on and off, light vibrato |
| 5 | **PLUCK** | sharp attack into a closing filter — harp-ish |
| 6 | **8-BIT** | two squares, deliberately dry |

Because a sign is held rather than struck, nothing here decays to silence: the
percussive patches fall to a low **sustain floor** instead, so the attack still
snaps but a chord you keep holding keeps sounding.

## Run it

Any static server; ES modules and `getUserMedia` both need `http://`, not
`file://`.

```bash
npx serve .          # or: py -m http.server 8123
```

Open the page, hit **INITIALIZE**, allow the camera. Both hands in frame, about
an arm's length back. Headphones are worth it — the tone sustains, and speakers
will just feed the room.

If the roles land on the wrong hands, or leaning inward gives you minor, the
buttons in the footer fix it in one click and the choice is remembered.

## Test

```bash
npm test
```

50 tests, no dependencies. `gestures.js` and `music.js` are pure — no DOM, no
camera, no Web Audio — so the whole instrument is verified in Node against
synthetic hands: every sign classifies correctly at ±40° of tilt, at three
distances and three positions in frame; 6 and 7 never collide with 2 and 3; a
brief flicker never commits; the debounce waits the same 100 ms at 15 fps as at
60; the quality latches through the deadzone; and `C E♭ G` is spelled with a
flat rather than a sharp.

## Layout

```
index.html      markup + HUD chrome
styles.css      the look
main.js         camera, the requestAnimationFrame loop, wiring
gestures.js     pure gesture maths (landmarks -> sign, tilt, volume)  <- tested
music.js        pure harmony (sign + tilt + count -> notes)           <- tested
audio.js        six switchable synth voices (the PATCHES table)
hud.js          all drawing: hand skeletons, tilt dial, readouts
```

The split is deliberate: `gestures.js` and `music.js` know nothing about the
browser, which is why they can be tested without a webcam.

## How it works

1. MediaPipe `HandLandmarker` returns 21 landmarks per hand, two hands per frame.
2. A finger counts as **extended** when its tip sits further from the wrist than
   its middle joint. Measuring from the wrist rather than comparing heights is
   what keeps this true when the hand is tilted — and here tilting the hand is
   itself a control. The thumb gets its own rule, since it swings sideways
   instead of curling.
3. The **tilt** is the angle of the wrist-to-middle-knuckle axis off vertical.
   Past ±15° it sets the quality; inside that deadzone the last quality holds,
   so crossing vertical mid-move never makes the chord flicker.
4. Signs and finger counts must hold steady for **100 ms** before they commit.
   This one rule is the difference between an instrument and a glitch
   generator. The wait is measured in milliseconds rather than frames on
   purpose — counting frames would make the instrument feel different on a
   machine running at 15 fps than at 60, and a debounce exists to give a
   predictable feel. The volume follower is eased on a time constant for the
   same reason.
5. Chords are built from a single table that produces both the notes and the
   printed name, so the readout cannot disagree with what you hear.
6. Notes common to the old and new chord **keep ringing** — going from a triad
   to a maj7 starts one voice instead of restarting four.

Tuning lives in `DEFAULTS` at the top of `gestures.js`; the tones live in
`PATCHES` at the top of `audio.js` — one entry per instrument, each carrying its
own envelope, filter cutoff, reverb send and `build()`. Adding a seventh sound is
one entry in that array: the chips, the number keys and the tests all read the
table, so there is no second place to register it.

### Which hand is which

MediaPipe labels handedness as though the image were mirrored, while the camera
delivers an unmirrored frame — so whether `"Left"` means your left hand depends
on the setup. Rather than assume, the page **learns** it from the first frame
that shows both hands: the view is mirrored, so your left hand is the one
further right in raw coordinates. After that the label carries the identity,
which is what keeps the roles put when one hand leaves the frame.

## Known limits

- Two hands only, one player.
- Fixed in C. The seven roots are the C major scale; the quality is yours, so
  you can play B major or F minor, but not a different key layout.
- The thresholds in `DEFAULTS` were tuned against synthetic hands. If a sign
  will not register, check the drawn skeleton first — it shows whether the
  tracker sees the hand at all — then nudge `extendRatio` or `thumbOut`.
  `gestures.test.mjs` builds a synthetic hand for every sign, so a change to
  those numbers can be verified without a camera.
- Needs the network on first load: the model and the MediaPipe runtime come from
  a CDN.
