import { test } from "node:test";
import assert from "node:assert/strict";
import {
  H, DEFAULTS, SIGN_PATTERNS,
  fingerStates, signFromStates, fingerCount, tiltAngle,
  createLatch, createReader, nextVolume,
} from "./gestures.js";

const W = 1280, H_PX = 720;

/* ---------- a synthetic hand ----------

   Built in hand space: the wrist sits at the origin, +y runs along the
   fingers, and one unit is one palm width (wrist -> middle knuckle). The hand
   is then rotated by `tilt` degrees, scaled, placed in the frame, and finally
   normalised the way MediaPipe reports landmarks — so the module under test
   multiplies the coordinates back out to exactly the hand described here. */

const STRAIGHT = { pip: 0.38, dip: 0.62, tip: 0.80, spread: 0 };
const CURLED   = { pip: 0.34, dip: 0.30, tip: 0.05, spread: 0.12 };

const MCP = {                       // knuckles, in hand space
  index:  [-0.32, 0.92],
  middle: [ 0.00, 1.00],
  ring:   [ 0.28, 0.94],
  pinky:  [ 0.54, 0.84],
};
const LEN = { index: 1.0, middle: 1.1, ring: 1.0, pinky: 0.78 };

const THUMB_OUT = [[-0.35,0.25], [-0.62,0.45], [-0.85,0.62], [-1.05,0.78]];
const THUMB_IN  = [[-0.35,0.25], [-0.45,0.48], [-0.25,0.62], [ 0.05,0.66]];

/* fingers: [thumb, index, middle, ring, pinky] booleans */
function hand({ fingers, tilt = 0, palm = 160, cx = 640, cy = 420 }){
  const [t, i, m, r, p] = fingers;
  const pts = [];

  const push = (hx, hy) => {
    const a = tilt * Math.PI / 180;
    const rx =  hx * Math.cos(a) + hy * Math.sin(a);
    const ry = -hx * Math.sin(a) + hy * Math.cos(a);
    // +y is up the fingers, which is -y once it lands in image space
    pts.push({ x: (cx + rx * palm) / W, y: (cy - ry * palm) / H_PX, z: 0 });
  };

  push(0, 0);                                       // 0 wrist
  for (const [x, y] of (t ? THUMB_OUT : THUMB_IN)) push(x, y);   // 1-4 thumb

  for (const [name, up] of [["index",i],["middle",m],["ring",r],["pinky",p]]){
    const [mx, my] = MCP[name];
    const seg = up ? STRAIGHT : CURLED;
    const len = LEN[name];
    push(mx, my);                                                   // MCP
    push(mx + seg.spread * Math.sign(mx || 1), my + seg.pip * len);  // PIP
    push(mx + seg.spread * Math.sign(mx || 1), my + seg.dip * len);  // DIP
    push(mx + seg.spread * Math.sign(mx || 1), my + seg.tip * len);  // TIP
  }
  return pts;
}

const bits = s => s.split("").map(c => c === "1");
const read = (lms, opts) => fingerStates(lms, W, H_PX, opts);
const signOf = (pattern, tilt = 0, extra = {}) =>
  signFromStates(read(hand({ fingers: bits(pattern), tilt, ...extra })));

/* the synthetic hand has to be right before anything built on it means much */
test("the synthetic hand has 21 landmarks", () => {
  assert.equal(hand({ fingers: bits("11111") }).length, 21);
});

/* ---------- finger extension ---------- */

test("every sign pattern reads back as the fingers it was built from", () => {
  for (const pattern of Object.keys(SIGN_PATTERNS)){
    const states = read(hand({ fingers: bits(pattern) }));
    assert.deepEqual(states, bits(pattern), `pattern ${pattern}`);
  }
});

test("all eight signs classify correctly, upright", () => {
  for (const [pattern, sign] of Object.entries(SIGN_PATTERNS))
    assert.equal(signOf(pattern), sign, `pattern ${pattern}`);
});

test("signs survive a tilted hand — the point of measuring from the wrist", () => {
  for (const tilt of [-40, -30, -15, 15, 30, 40])
    for (const [pattern, sign] of Object.entries(SIGN_PATTERNS))
      assert.equal(signOf(pattern, tilt), sign, `pattern ${pattern} at ${tilt} deg`);
});

test("signs survive distance from the camera and position in frame", () => {
  for (const palm of [70, 160, 300])
    for (const [cx, cy] of [[220, 220], [640, 420], [1050, 600]])
      for (const [pattern, sign] of Object.entries(SIGN_PATTERNS))
        assert.equal(signOf(pattern, 0, { palm, cx, cy }), sign,
          `pattern ${pattern} at palm ${palm}, (${cx},${cy})`);
});

test("6 and 7 never collide with 2 or 3", () => {
  const seen = new Map();
  for (const pattern of Object.keys(SIGN_PATTERNS)){
    const sign = signOf(pattern);
    assert.equal(seen.has(sign), false, `${pattern} duplicates sign ${sign}`);
    seen.set(sign, pattern);
  }
  assert.equal(seen.get(6), "10001");   // thumb + pinky
  assert.equal(seen.get(7), "11001");   // thumb + index + pinky
});

test("a shape outside the table is unrecognised, not a wrong chord", () => {
  for (const pattern of ["00100", "00010", "01010", "10100", "11110", "10010"])
    assert.equal(signOf(pattern), null, `pattern ${pattern}`);
});

test("a thumb wrapped over a fist does not read as extended", () => {
  const states = read(hand({ fingers: bits("00000") }));
  assert.equal(states[0], false);
  assert.equal(fingerCount(states), 0);
});

test("no hand means no states and no sign", () => {
  assert.equal(read(null), null);
  assert.equal(read([{x:0,y:0}]), null);
  assert.equal(signFromStates(null), null);
  assert.equal(fingerCount(null), 0);
});

/* ---------- tilt ---------- */

test("tiltAngle reports the lean in signed degrees", () => {
  for (const tilt of [-45, -20, 0, 20, 45]){
    const a = tiltAngle(hand({ fingers: bits("11111"), tilt }), W, H_PX);
    assert.ok(Math.abs(a - tilt) < 0.5, `${tilt} deg read back as ${a}`);
  }
});

/* ---------- the debounce latch ---------- */

test("a value must hold for stableMs before it commits", () => {
  const l = createLatch(100, 0);
  assert.equal(l.push(5, 0),   0);
  assert.equal(l.push(5, 60),  0);
  assert.equal(l.push(5, 130), 5);
});

test("a brief flicker never commits", () => {
  const l = createLatch(100, 1);
  l.push(1, 0); l.push(1, 200);
  assert.equal(l.push(9, 233), 1);   // flicker
  assert.equal(l.push(9, 266), 1);   // still inside the hold
  assert.equal(l.push(1, 300), 1);   // back to reality, nothing changed
});

/* The reason the latch counts milliseconds and not frames. */
test("the debounce takes the same wall time at 15fps as at 60fps", () => {
  // How long the value was actually held before it committed. It can only be
  // rounded up to the next frame, so the wait lands in [hold, hold + 1 frame).
  const heldFor = stepMs => {
    const l = createLatch(100, 0);
    let t = stepMs;
    l.push(5, t);                       // first frame the new value appears
    const appeared = t;
    while (l.value !== 5 && t < 2000){ t += stepMs; l.push(5, t); }
    return t - appeared;
  };
  for (const step of [66, 33, 16]){
    const held = heldFor(step);
    assert.ok(held >= 100 && held < 100 + step,
      `at ${step}ms/frame the latch waited ${held}ms, not ~100ms`);
  }
  assert.ok(Math.abs(heldFor(66) - heldFor(16)) <= 66,
    "the feel must not change by more than one frame between frame rates");
});

/* ---------- the reader ---------- */

/* Drive the reader with a clock, the way the frame loop does. */
let clock = 0;
const frames = (reader, n, args, stepMs = 33) => {
  let out;
  for (let i = 0; i < n; i++){
    clock += stepMs;
    out = reader.read({ w: W, h: H_PX, now: clock, ...args });
  }
  return out;
};

test("holding a sign commits it; the chord hand alone is enough", () => {
  const r = createReader();
  const out = frames(r, 5, { chord: hand({ fingers: bits("01100"), tilt: 30 }) });
  assert.equal(out.sign, 2);
  assert.equal(out.extension, 0);
});

test("an unrecognised shape holds the chord instead of cutting it", () => {
  const r = createReader();
  frames(r, 5, { chord: hand({ fingers: bits("01110") }) });
  const out = frames(r, 5, { chord: hand({ fingers: bits("00100") }) });
  assert.equal(out.sign, 3, "mid-transition shapes must not silence the chord");
});

test("a fist silences, and so does the hand leaving frame", () => {
  const r = createReader();
  frames(r, 5, { chord: hand({ fingers: bits("01111") }) });
  assert.equal(frames(r, 5, { chord: hand({ fingers: bits("00000") }) }).sign, 0);

  frames(r, 5, { chord: hand({ fingers: bits("01111") }) });
  assert.equal(frames(r, 5, { chord: null }).sign, 0);
});

test("a single dropped frame does not cut the note", () => {
  const r = createReader();
  frames(r, 6, { chord: hand({ fingers: bits("01000") }) });
  assert.equal(frames(r, 1, { chord: null }).sign, 1);
  assert.equal(frames(r, 1, { chord: hand({ fingers: bits("01000") }) }).sign, 1);
});

/* ---------- tilt -> quality, with the deadzone ---------- */

test("tilting past the threshold picks the quality", () => {
  const r = createReader();
  assert.equal(frames(r, 6, { chord: hand({ fingers: bits("01000"), tilt:  30 }) }).quality, "major");
  assert.equal(frames(r, 6, { chord: hand({ fingers: bits("01000"), tilt: -30 }) }).quality, "minor");
});

test("the quality latches inside the deadzone instead of flickering", () => {
  const r = createReader();
  frames(r, 8, { chord: hand({ fingers: bits("01000"), tilt: -30 }) });
  assert.equal(r.quality, "minor");

  // drift back through vertical without committing to the far side
  for (const tilt of [-10, -3, 0, 3, 8, 0, -5]){
    const out = r.read({ chord: hand({ fingers: bits("01000"), tilt }), w: W, h: H_PX });
    assert.equal(out.quality, "minor", `deadzone tilt ${tilt} flipped the quality`);
  }
});

test("invertTilt flips inward and outward for a camera that reads backwards", () => {
  const normal   = createReader();
  const inverted = createReader({ invertTilt: true });
  const lms = hand({ fingers: bits("01000"), tilt: 30 });
  assert.equal(frames(normal,   8, { chord: lms }).quality, "major");
  assert.equal(frames(inverted, 8, { chord: lms }).quality, "minor");
});

/* ---------- the quality hand ---------- */

test("the right hand's finger count becomes the extension", () => {
  const r = createReader();
  const chord = hand({ fingers: bits("01000"), tilt: 30 });
  for (const [pattern, count] of [["00000",0],["01000",1],["01100",2],["01110",3],["01111",4],["11111",5]]){
    const out = frames(r, 5, { chord, quality: hand({ fingers: bits(pattern) }) });
    assert.equal(out.extension, count, `pattern ${pattern}`);
  }
});

test("no right hand means a plain triad", () => {
  const r = createReader();
  const chord = hand({ fingers: bits("01000"), tilt: 30 });
  frames(r, 5, { chord, quality: hand({ fingers: bits("11111") }) });
  assert.equal(frames(r, 5, { chord, quality: null }).extension, 0);
});

/* ---------- volume ---------- */

test("a high hand is louder than a low hand", () => {
  const high = hand({ fingers: bits("11111"), cy: 120 });
  const low  = hand({ fingers: bits("11111"), cy: 660 });
  let vh = 0.5, vl = 0.5;
  for (let i = 0; i < 200; i++){ vh = nextVolume(high, vh); vl = nextVolume(low, vl); }
  assert.ok(vh > vl, `high ${vh} should exceed low ${vl}`);
  assert.ok(vh > 0.95);
});

test("volume never falls to silence, however low the hand goes", () => {
  const floor = hand({ fingers: bits("11111"), cy: 715 });
  let v = 1;
  for (let i = 0; i < 400; i++) v = nextVolume(floor, v);
  assert.ok(v >= DEFAULTS.volFloor - 1e-6, `${v} dipped under the floor`);
  assert.ok(v > 0);
});

test("volume drifts back to the default when the hand leaves", () => {
  let v = 1;
  for (let i = 0; i < 300; i++) v = nextVolume(null, v);
  assert.ok(Math.abs(v - DEFAULTS.volDefault) < 1e-3, `settled at ${v}`);
});

test("volume eases rather than jumping, so it cannot click", () => {
  const high = hand({ fingers: bits("11111"), cy: 100 });
  const first = nextVolume(high, DEFAULTS.volFloor);
  assert.ok(first - DEFAULTS.volFloor < 0.2, "one frame moved the level too far");
});

test("a volume swell takes the same time at any frame rate", () => {
  const high = hand({ fingers: bits("11111"), cy: 100 });
  const rampMs = stepMs => {
    let v = DEFAULTS.volFloor, t = 0;
    while (v < 0.9 && t < 3000){ v = nextVolume(high, v, DEFAULTS, stepMs); t += stepMs; }
    return t;
  };
  const slow = rampMs(66), fast = rampMs(16);
  assert.ok(Math.abs(slow - fast) < 80, `15fps took ${slow}ms, 60fps took ${fast}ms`);
});

/* ---------- end to end ---------- */

test("a I-V-vi-IV run reads as signs 1, 5, 6, 4 with the right qualities", () => {
  const r = createReader();
  const played = [];
  for (const [pattern, tilt] of [["01000",30],["11111",30],["10001",-30],["01111",30]]){
    const out = frames(r, 6, { chord: hand({ fingers: bits(pattern), tilt }) });
    played.push(`${out.sign}${out.quality === "minor" ? "m" : ""}`);
  }
  assert.deepEqual(played, ["1", "5", "6m", "4"]);
});
