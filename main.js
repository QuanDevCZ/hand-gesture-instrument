/* main.js — camera, the frame loop, and wiring.
   Gesture maths lives in gestures.js, harmony in music.js, sound in audio.js,
   drawing in hud.js. */

import { HandLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { createReader } from "./gestures.js";
import { buildChord } from "./music.js";
import { createSynth, PATCHES, DEFAULT_PATCH, findPatch } from "./audio.js";
import * as hud from "./hud.js";

const TASKS_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker" +
  "/float16/1/hand_landmarker.task";

const video  = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx    = canvas.getContext("2d");

const synth = createSynth();
let reader  = createReader();

let landmarker    = null;
let lastVideoTime = -1;
let frameTimes    = [];
let sounding      = "";      // the note set currently ringing
let lastVolume    = -1;

const prefs = {
  chordHand:  localStorage.getItem("ch.chordHand") ?? "left",
  invertTilt: localStorage.getItem("ch.invertTilt") === "1",
  // through findPatch, so a stored id from a renamed patch falls back to the
  // default rather than leaving the instrument silent
  patch:      findPatch(localStorage.getItem("ch.patch") ?? DEFAULT_PATCH).id,
};

/* MediaPipe labels handedness as though the image were mirrored, while
   getUserMedia hands over the raw unmirrored frame — so whether "Left" means
   your left hand depends on the camera. Rather than assume a convention, the
   meaning is learned from geometry the first time both hands are in shot (see
   splitHands), and this holds whichever label turned out to be yours. */
let leftLabel = null;

/* ---------------------------------------------------------------- boot */

document.getElementById("start").addEventListener("click", start, { once:true });

document.getElementById("swap").addEventListener("click", () => {
  prefs.chordHand = prefs.chordHand === "left" ? "right" : "left";
  localStorage.setItem("ch.chordHand", prefs.chordHand);
  panic();
  applyPrefs();
});

document.getElementById("flip").addEventListener("click", () => {
  prefs.invertTilt = !prefs.invertTilt;
  localStorage.setItem("ch.invertTilt", prefs.invertTilt ? "1" : "0");
  applyPrefs();
});

document.getElementById("panic").addEventListener("click", panic);

/* Unlike SWAP HANDS, this deliberately does not panic(): the chord carries
   across a sound change, which is the whole point of hearing them compared. */
function pickPatch(id){
  prefs.patch = findPatch(id).id;
  localStorage.setItem("ch.patch", prefs.patch);
  synth.setPatch(prefs.patch);
  hud.setPatch(prefs.patch);
}

hud.buildPatchPicker(PATCHES, pickPatch);
hud.setPatch(prefs.patch);

// 1–6 select a sound; nothing else on the page reads the keyboard.
addEventListener("keydown", e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const i = Number(e.key) - 1;
  if (Number.isInteger(i) && PATCHES[i]) pickPatch(PATCHES[i].id);
});

function applyPrefs(){
  reader = createReader({ invertTilt: prefs.invertTilt });
  hud.setAssign(prefs.chordHand, prefs.invertTilt);
}

function panic(){
  synth.allOff();
  sounding = "";
  reader.reset();
  hud.setChord(null);
}

applyPrefs();

async function start(){
  const btn = document.getElementById("start");
  btn.disabled = true;

  try {
    // The AudioContext has to be created inside the click, or it comes up
    // suspended and the first chord never sounds.
    await synth.start(prefs.patch);

    hud.setStatus("REQUESTING CAMERA…");
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width:{ideal:1280}, height:{ideal:720}, facingMode:"user" },
      audio: false,
    });
    await video.play();

    hud.setStatus("LOADING HAND MODEL…");
    landmarker = await createLandmarker();

    hud.setStatus("TRACKING");
    hud.hideBoot();
    requestAnimationFrame(loop);

  } catch (err){
    console.error(err);
    hud.setStatus(explain(err), true);
    btn.disabled = false;
    btn.addEventListener("click", start, { once:true });
  }
}

async function createLandmarker(){
  const fileset = await FilesetResolver.forVisionTasks(TASKS_CDN);
  const opts = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  };
  try {
    return await HandLandmarker.createFromOptions(fileset, opts);
  } catch {
    // Some integrated GPUs reject the WebGL delegate — CPU still manages 25+ fps.
    opts.baseOptions.delegate = "CPU";
    return await HandLandmarker.createFromOptions(fileset, opts);
  }
}

function explain(err){
  if (err?.name === "NotAllowedError") return "CAMERA PERMISSION DENIED";
  if (err?.name === "NotFoundError")   return "NO CAMERA FOUND";
  if (String(err).includes("fetch"))   return "MODEL DOWNLOAD FAILED — CHECK CONNECTION";
  return "INITIALIZATION FAILED — SEE CONSOLE";
}

/* ------------------------------------------------------------- the loop */

function loop(){
  requestAnimationFrame(loop);
  if (video.readyState < 2) return;

  hud.sizeCanvas(canvas, video);

  // detectForVideo needs a fresh frame and a monotonic timestamp; re-running it
  // on the same frame wastes GPU and confuses the tracker.
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  render(landmarker.detectForVideo(video, performance.now()));
  tickFps();
}

/* Split the detections into the chord hand and the colour hand. */
function splitHands(res){
  const hands  = res?.landmarks ?? [];
  const labels = (res?.handedness ?? res?.handednesses ?? [])
    .map(h => h?.[0]?.categoryName ?? null);

  // Learn what the labels mean from the first frame showing both hands: the
  // view is mirrored, so your left hand is the one further RIGHT in raw
  // coordinates. After that the label carries the identity, which is what
  // keeps the roles put when you cross your hands or one drops out of frame.
  if (!leftLabel && hands.length === 2)
    leftLabel = labels[hands[0][0].x > hands[1][0].x ? 0 : 1];

  const wantLeft = prefs.chordHand === "left";
  const isChordHand = (lms, label) =>
    (leftLabel && label) ? (label === leftLabel) === wantLeft
                         : (lms[0].x > 0.5) === wantLeft;

  let chord = null, colour = null;
  hands.forEach((lms, i) => {
    if (isChordHand(lms, labels[i])) chord ??= lms; else colour ??= lms;
  });

  // Both hands labelled the same is a tracker slip, not two of one hand —
  // give the leftover detection the role that went unfilled.
  if (hands.length === 2 && !chord !== !colour){
    const taken = chord ?? colour;
    const spare = hands.find(l => l !== taken);
    if (chord) colour = spare; else chord = spare;
  }
  return { chord, colour };
}

function render(res){
  hud.clear(ctx);

  const { chord: chordHand, colour: colourHand } = splitHands(res);
  const state = reader.read({
    chord: chordHand, quality: colourHand,
    w: canvas.width, h: canvas.height, now: performance.now(),
  });

  if (chordHand)  hud.drawHand(ctx, chordHand,  HandLandmarker.HAND_CONNECTIONS, "chord");
  if (colourHand) hud.drawHand(ctx, colourHand, HandLandmarker.HAND_CONNECTIONS, "quality");
  hud.drawTiltDial(ctx, chordHand, state.tilt, state.quality, reader.cfg.tiltDeg);

  const chord = buildChord(state.sign, state.quality, state.extension);

  // Only touch the synth when the notes actually change: the voices are reused
  // across a change, so a triad becoming a maj7 adds one note instead of
  // restarting the chord.
  const key = chord ? chord.midi.join(",") : "";
  if (key !== sounding){
    synth.setNotes(chord ? chord.midi : []);
    sounding = key;
    hud.setChord(chord);
  }

  if (Math.abs(state.volume - lastVolume) > 0.004){
    synth.setVolume(state.volume);
    hud.setVolume(state.volume);
    lastVolume = state.volume;
  }
}

function tickFps(){
  frameTimes.push(performance.now());
  while (frameTimes.length > 30) frameTimes.shift();
  if (frameTimes.length < 2) return;
  const span = frameTimes.at(-1) - frameTimes[0];
  hud.setFps((frameTimes.length - 1) * 1000 / span);
}
