/* hud.js — everything that draws. No gesture logic and no audio live here.

   Nothing here imports the harmony or gesture tables any more: with the cheat
   sheet and the numeric readouts gone, the only text this module writes is the
   chord name the caller hands it. */

const CY = "0,229,255";     // the quality hand
const AM = "255,179,64";    // the chord hand
const DIM = "91,115,133";

const el = id => document.getElementById(id);
const $ = {
  status: el("status"), boot: el("boot"), fps: el("fps"), assign: el("assign"),
  chordName: el("chordName"), chordNotes: el("chordNotes"),
  volFill: el("volFill"), volLabel: el("volLabel"), patches: el("patches"),
};

/* ---------------------------------------------------------------- chrome */

export function setStatus(text, isError = false){
  $.status.textContent = text;
  $.status.classList.toggle("err", isError);
}

export const hideBoot = () => $.boot.classList.add("hidden");

export function setFps(fps){
  $.fps.innerHTML = `${String(Math.round(fps)).padStart(2,"0")}&nbsp;FPS`;
}

export function setAssign(chordHand, inverted){
  $.assign.textContent =
    `CHORD: ${chordHand.toUpperCase()} · COLOUR: ${chordHand === "left" ? "RIGHT" : "LEFT"}` +
    (inverted ? " · TILT FLIPPED" : "");
}

/* One chip per patch, generated from whatever list the caller hands over — this
   module knows nothing about audio, only about {id, label}. A seventh patch is
   one entry in PATCHES and no markup. */
export function buildPatchPicker(patches, onPick){
  $.patches.replaceChildren(...patches.map((p, i) => {
    const b = document.createElement("button");
    b.className = "ghost chip";
    b.dataset.patch = p.id;
    b.textContent = p.label;
    b.title = `${p.label} — key ${i + 1}`;
    b.addEventListener("click", () => onPick(p.id));
    return b;
  }));
}

export function setPatch(id){
  for (const b of $.patches.children)
    b.classList.toggle("on", b.dataset.patch === id);
}

/* -------------------------------------------------------------- readouts */

export function setChord(chord){
  $.chordName.textContent  = chord ? chord.name : "—";
  $.chordNotes.textContent = chord ? chord.notes.join("  ") : "make a sign";
  $.chordName.classList.toggle("silent", !chord);
  if (chord) flash($.chordName);
}

export function setVolume(v){
  const pct = Math.round(v * 100);
  $.volFill.style.height = `${pct}%`;
  $.volLabel.textContent = `${pct}%`;
}

function flash(node){
  node.classList.remove("flash");
  void node.offsetWidth;            // restart the animation on a repeat chord
  node.classList.add("flash");
}

/* ---------------------------------------------------------------- canvas */

export function sizeCanvas(canvas, video){
  // Match the video's intrinsic resolution. Both sit in the same box with the
  // same aspect ratio and object-fit:cover, so they crop identically and the
  // skeleton lands on the hand with no letterbox maths.
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight){
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

export const clear = ctx => ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

export function drawHand(ctx, lms, connections, role){
  const { width: w, height: h } = ctx.canvas;
  const scale = h / 720;
  const rgb = role === "chord" ? AM : CY;
  const px = lm => [lm.x * w, lm.y * h];

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = `rgba(${rgb},.9)`;

  for (const c of connections){
    const a = lms[c.start ?? c[0]], b = lms[c.end ?? c[1]];
    if (!a || !b) continue;
    const [ax, ay] = px(a), [bx, by] = px(b);
    ctx.shadowBlur  = 14 * scale;
    ctx.strokeStyle = `rgba(${rgb},.95)`;
    ctx.lineWidth   = 3.5 * scale;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

  ctx.shadowBlur = 10 * scale;
  ctx.fillStyle  = `rgba(${rgb},1)`;
  for (const lm of lms){
    const [x, y] = px(lm);
    ctx.beginPath(); ctx.arc(x, y, 3.5 * scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* A dial at the chord wrist: the grey wedge is the deadzone where the quality
   holds, the needle is where the hand actually points. */
export function drawTiltDial(ctx, lms, tilt, quality, deadzoneDeg){
  if (tilt === null || !lms) return;
  const { width: w, height: h } = ctx.canvas;
  const scale = h / 720;
  const cx = lms[0].x * w, cy = lms[0].y * h;
  const r  = 54 * scale;

  // canvas angles run clockwise from +x; the dial reads 0 as straight up
  const toCanvas = deg => (deg - 90) * Math.PI / 180;
  const rgb = quality === "minor" ? CY : AM;

  ctx.save();
  ctx.lineCap = "round";

  ctx.strokeStyle = `rgba(${DIM},.75)`;
  ctx.lineWidth = 7 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, r, toCanvas(-deadzoneDeg), toCanvas(deadzoneDeg));
  ctx.stroke();

  ctx.strokeStyle = `rgba(${rgb},.35)`;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.arc(cx, cy, r, toCanvas(-62), toCanvas(62));
  ctx.stroke();

  const a = toCanvas(Math.max(-62, Math.min(62, tilt)));
  ctx.strokeStyle = `rgba(${rgb},1)`;
  ctx.shadowColor = `rgba(${rgb},.9)`;
  ctx.shadowBlur  = 12 * scale;
  ctx.lineWidth   = 4 * scale;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * (r - 16 * scale), cy + Math.sin(a) * (r - 16 * scale));
  ctx.lineTo(cx + Math.cos(a) * (r + 10 * scale), cy + Math.sin(a) * (r + 10 * scale));
  ctx.stroke();

  // the view is mirrored, so text has to be flipped back to stay readable
  ctx.translate(cx, cy + r + 24 * scale);
  ctx.scale(-1, 1);
  ctx.shadowBlur = 8 * scale;
  ctx.fillStyle = `rgba(${rgb},1)`;
  ctx.font = `600 ${Math.round(15 * scale)}px "Inter Tight",system-ui,sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(quality === "minor" ? "MINOR" : "MAJOR", 0, 0);
  ctx.restore();
}
