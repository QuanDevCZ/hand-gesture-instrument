/* gestures.js — pure landmark reading. No DOM, no canvas, no MediaPipe.
   Kept separate so every sign, threshold and debounce can be tested in Node
   without a camera. */

/* MediaPipe hand landmarks (21) */
export const H = {
  wrist: 0,
  thumbCMC: 1, thumbMCP: 2, thumbIP: 3, thumbTip: 4,
  indexMCP: 5, indexPIP: 6, indexTip: 8,
  middleMCP: 9, middlePIP: 10, middleTip: 12,
  ringMCP: 13, ringPIP: 14, ringTip: 16,
  pinkyMCP: 17, pinkyPIP: 18, pinkyTip: 20,
};

export const DEFAULTS = {
  extendRatio: 1.15,  // tip must sit this much further from the wrist than the PIP
  thumbOut:    1.05,  // thumb tip -> pinky knuckle, measured in palm widths
  thumbStraight: 150, // ...and the thumb joint itself must be this straight (deg)
  tiltDeg:      15,   // past this many degrees off vertical the quality flips
  tiltTauMs:    90,   // time constant of the tilt smoothing
  stableMs:    100,   // how long a sign must hold before it commits
  volTauMs:    140,   // time constant of the volume follower
  volFloor:    0.20,  // a low hand goes quiet, never silent
  volDefault:  0.70,  // where volume rests when the right hand is away
  volTop:      0.15,  // frame fraction that already counts as all the way up
  volBottom:   0.85,  // ...and as all the way down
  invertTilt: false,  // flip if inward/outward come out backwards on your camera
};

/* Finger order used everywhere: thumb, index, middle, ring, pinky. */
export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];

/* Signs are keyed by WHICH fingers are extended rather than how many — that is
   what lets 6 and 7 live on a five-finger hand without asking the tracker to
   resolve a fingertip pinch. */
export const SIGN_PATTERNS = {
  "01000": 1,   // index
  "01100": 2,   // index + middle
  "01110": 3,   // index + middle + ring
  "01111": 4,   // four fingers, thumb tucked
  "11111": 5,   // open hand
  "10001": 6,   // thumb + pinky
  "11001": 7,   // thumb + index + pinky
  "00000": 0,   // fist -> silence
};

/* ---------------------------------------------------------------- geometry */

/* Distances are taken in pixel space so the 16:9 aspect ratio does not stretch
   them — the same reason analysis.js in dojang-hud measures angles in pixels. */
const dist = (a, b, w, h) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);

function angleAt(a, b, c, w, h){
  const v1x = (a.x-b.x)*w, v1y = (a.y-b.y)*h;
  const v2x = (c.x-b.x)*w, v2y = (c.y-b.y)*h;
  const mag = Math.hypot(v1x,v1y) * Math.hypot(v2x,v2y);
  if (!mag) return 0;
  const dot = v1x*v2x + v1y*v2y;
  return Math.acos(Math.max(-1, Math.min(1, dot/mag))) * 180 / Math.PI;
}

/* Wrist to middle knuckle: the hand's own yardstick, so nothing below depends
   on how near the camera you are standing. */
export const palmSize = (lms, w, h) => dist(lms[H.wrist], lms[H.middleMCP], w, h);

/* ---------------------------------------------------------------- fingers */

/* [thumb, index, middle, ring, pinky] booleans, or null without a hand. */
export function fingerStates(lms, w, h, opts = {}){
  if (!lms || lms.length < 21) return null;
  const cfg = { ...DEFAULTS, ...opts };

  const wrist = lms[H.wrist];
  const palm  = palmSize(lms, w, h);
  if (!palm) return null;

  // A straight finger puts its tip further from the wrist than its middle
  // joint; a curled one folds the tip back toward the palm. Measuring from the
  // wrist rather than comparing y-coordinates is what keeps this true when the
  // hand is tilted — and here tilting the hand is itself a control.
  const straight = (tip, pip) =>
    dist(lms[tip], wrist, w, h) > dist(lms[pip], wrist, w, h) * cfg.extendRatio;

  // The thumb abducts sideways instead of curling, so the rule above misreads
  // it. Distance from the pinky knuckle catches a thumb held out; the joint
  // angle rejects a thumb wrapped across a fist, which can be just as far away.
  const thumbOut =
    dist(lms[H.thumbTip], lms[H.pinkyMCP], w, h) / palm > cfg.thumbOut &&
    angleAt(lms[H.thumbMCP], lms[H.thumbIP], lms[H.thumbTip], w, h) > cfg.thumbStraight;

  return [
    thumbOut,
    straight(H.indexTip,  H.indexPIP),
    straight(H.middleTip, H.middlePIP),
    straight(H.ringTip,   H.ringPIP),
    straight(H.pinkyTip,  H.pinkyPIP),
  ];
}

/* Pattern -> 1-7, 0 for a fist, or null for a shape that is not in the table. */
export function signFromStates(states){
  if (!states) return null;
  const key = states.map(b => (b ? "1" : "0")).join("");
  return key in SIGN_PATTERNS ? SIGN_PATTERNS[key] : null;
}

export const fingerCount = states => (states ? states.filter(Boolean).length : 0);

/* --------------------------------------------------------------- the tilt */

/* Signed degrees the hand leans off vertical, along wrist -> middle knuckle.
   0 is fingers straight up; positive leans one way, negative the other. */
export function tiltAngle(lms, w, h){
  if (!lms || lms.length < 21) return null;
  const dx = (lms[H.middleMCP].x - lms[H.wrist].x) * w;
  const dy = (lms[H.middleMCP].y - lms[H.wrist].y) * h;
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}

/* ------------------------------------------------------------- debouncing */

/* A value has to hold steady for `holdMs` before it counts. Without this the
   chord retriggers on every frame the tracker wobbles mid-transition.

   The wait is measured in milliseconds rather than frames on purpose: counting
   frames would make the instrument feel different on a machine running at 15fps
   than at 60, and the whole point of a debounce is a predictable feel. */
export function createLatch(holdMs, initial = null){
  let committed = initial, candidate = initial, since = -Infinity;
  return {
    push(v, now = 0){
      if (v !== candidate){ candidate = v; since = now; }
      if (now - since >= holdMs) committed = candidate;
      return committed;
    },
    get value(){ return committed; },
    reset(v = initial){ committed = candidate = v; since = -Infinity; },
  };
}

/* ------------------------------------------------------------- the reader */

/* Holds the frame-to-frame state: smoothing, the latches, and the quality that
   stays put while the hand passes through the tilt deadzone. */
export function createReader(opts = {}){
  const cfg = { ...DEFAULTS, ...opts };

  const signLatch = createLatch(cfg.stableMs, 0);
  const extLatch  = createLatch(cfg.stableMs, 0);
  let smoothTilt = null;
  let quality = "major";
  let volume  = cfg.volDefault;
  let lastNow = null;

  /* chord:   the chord hand's landmarks, or null
     quality: the quality hand's landmarks, or null
     now:     a monotonic timestamp in ms (performance.now() in the browser) */
  function read({ chord = null, quality: qHand = null, w = 1280, h = 720, now = 0 } = {}){
    const chordFingers   = fingerStates(chord, w, h, cfg);
    const qualityFingers = fingerStates(qHand, w, h, cfg);

    // A shape that is not in the table means "keep playing" — every transition
    // passes through one. A fist, or the hand leaving frame, means silence.
    const raw  = chord ? signFromStates(chordFingers) : 0;
    const sign = signLatch.push(raw === null ? signLatch.value : raw, now);

    const extension = extLatch.push(qHand ? Math.min(5, fingerCount(qualityFingers)) : 0, now);

    const dtMs = lastNow === null ? 33 : Math.max(1, Math.min(200, now - lastNow));
    lastNow = now;

    let tilt = null;
    if (chord){
      const rawTilt = tiltAngle(chord, w, h) * (cfg.invertTilt ? -1 : 1);
      // Smoothed on a time constant rather than a frame count, so the tilt lags
      // by the same moment whatever the frame rate.
      smoothTilt = smoothTilt === null
        ? rawTilt
        : smoothTilt + (rawTilt - smoothTilt) * (1 - Math.exp(-dtMs / cfg.tiltTauMs));
      tilt = smoothTilt;

      // Inside the deadzone the last quality latches. Flipping on the exact
      // vertical would make the chord flicker every time you crossed it.
      if (tilt >=  cfg.tiltDeg) quality = "major";
      if (tilt <= -cfg.tiltDeg) quality = "minor";
    } else {
      smoothTilt = null;
    }

    volume = nextVolume(qHand, volume, cfg, dtMs);

    return { sign, quality, tilt, extension, volume, chordFingers, qualityFingers };
  }

  function reset(){
    signLatch.reset(0); extLatch.reset(0);
    smoothTilt = null; quality = "major"; volume = cfg.volDefault; lastNow = null;
  }

  return { read, reset, cfg, get quality(){ return quality; } };
}

/* Right-hand height -> level, eased toward the target so tracking jitter does
   not buzz. Hand away drifts back to the resting default. The easing is a time
   constant rather than a per-frame weight, so a swell takes the same moment to
   arrive whatever the frame rate. */
export function nextVolume(qHand, current, cfg = DEFAULTS, dtMs = 33){
  let target = cfg.volDefault;
  if (qHand?.length >= 21){
    const y = qHand[H.wrist].y;
    const t = (cfg.volBottom - y) / (cfg.volBottom - cfg.volTop);
    target = cfg.volFloor + Math.max(0, Math.min(1, t)) * (1 - cfg.volFloor);
  }
  const alpha = 1 - Math.exp(-dtMs / cfg.volTauMs);
  return current + (target - current) * alpha;
}
