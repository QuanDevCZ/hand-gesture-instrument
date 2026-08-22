/* audio.js — the instrument. Six voices that each hold a chord for as long as
   the sign is held. Browser-only: everything below createSynth needs Web Audio,
   but the PATCHES table itself is plain data and imports cleanly in Node, which
   is what audio.test.mjs checks.

   The instrument sustains indefinitely and has no re-trigger source, so a
   percussive patch decays to a low SUSTAIN FLOOR rather than to silence — the
   attack still reads as a pluck, but a held chord cannot die on its own. */

import { mtof } from "./music.js";

/* Each patch owns its envelope, its share of the chain, and a build() that
   wires its oscillators. level keeps loudness matched across patches: three
   detuned saws five notes deep are far hotter than one FM sine.

     cutoff  the chain lowpass, Hz
     wet     convolver send, 0..1
     drift   slow LFO depth on the lowpass, cents (movement under a held chord)
     level   voice peak amplitude before the envelope's sustain fraction  */
export const PATCHES = [

  /* The original voice. An FM pair whose modulation index spikes on the attack
     and decays away gives the bell-like strike of an electric piano, settling
     into a near-sine that is easy to stack four or five deep. */
  { id:"rhodes", label:"RHODES",
    cutoff:2600, wet:.24, drift:0,
    attack:.008, decay:.220, sustain:.62, release:.400, level:.15,
    build(ctx, freq, t){
      const carrier = osc(ctx, "sine", freq);

      const mod = osc(ctx, "sine", freq * 2);
      const modIndex = ctx.createGain();
      modIndex.gain.setValueAtTime(freq * 3.2, t);
      modIndex.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.35), t + 0.45);
      mod.connect(modIndex).connect(carrier.frequency);

      // A detuned triangle underneath puts some body back under the sine.
      const body = osc(ctx, "triangle", freq, -6);
      const bodyGain = gain(ctx, .30);

      const amp = env(ctx, t, this);
      carrier.connect(amp);
      body.connect(bodyGain).connect(amp);
      return { amp, nodes:[carrier, mod, body] };
    } },

  /* A ratio just off 3 makes the partial beat slowly against the carrier —
     that shimmer is the difference between a bell and a plain sine. */
  { id:"bells", label:"BELLS",
    cutoff:5200, wet:.42, drift:0,
    attack:.004, decay:.900, sustain:.45, release:.900, level:.11,
    build(ctx, freq, t){
      const carrier = osc(ctx, "sine", freq);

      const mod = osc(ctx, "sine", freq * 3.01);
      const modIndex = ctx.createGain();
      modIndex.gain.setValueAtTime(freq * 2.2, t);
      modIndex.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.5), t + 1.6);
      mod.connect(modIndex).connect(carrier.frequency);

      const air = osc(ctx, "sine", freq * 2, 7);
      const airGain = gain(ctx, .12);

      const amp = env(ctx, t, this);
      carrier.connect(amp);
      air.connect(airGain).connect(amp);
      return { amp, nodes:[carrier, mod, air] };
    } },

  /* Three saws a few cents apart never quite line up, which is the whole sound.
     The per-voice filter opens across the attack so the swell brightens as it
     arrives instead of just getting louder. */
  { id:"pad", label:"PAD",
    cutoff:1300, wet:.40, drift:600,
    attack:.600, decay:.500, sustain:.85, release:1.200, level:.070,
    build(ctx, freq, t){
      const oscs = [-9, 0, 9].map(cents => osc(ctx, "sawtooth", freq, cents));

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.linearRampToValueAtTime(1300, t + this.attack + this.decay);

      const amp = env(ctx, t, this);
      for (const o of oscs) o.connect(lp);
      lp.connect(amp);
      return { amp, nodes:oscs };
    } },

  /* Additive drawbars: no filter movement at all, which is exactly why an organ
     sounds like one. The vibrato is shared by every partial so they stay locked. */
  { id:"organ", label:"ORGAN",
    cutoff:4000, wet:.16, drift:0,
    attack:.004, decay:.060, sustain:1, release:.120, level:.085,
    build(ctx, freq, t){
      const amp = env(ctx, t, this);
      const nodes = [];

      const vib = osc(ctx, "sine", 5.2);
      const vibDepth = gain(ctx, 4);          // cents
      vib.connect(vibDepth);
      nodes.push(vib);

      for (const [mult, drawbar] of [[1, 1], [2, .5], [3, .33], [4, .22]]){
        const o = osc(ctx, "sine", freq * mult);
        vibDepth.connect(o.detune);
        o.connect(gain(ctx, drawbar)).connect(amp);
        nodes.push(o);
      }
      return { amp, nodes };
    } },

  /* Percussive, but sustain sits at .14 rather than 0 — see the header note.
     The filter closing over half a second is what makes it read as a string
     rather than as a short organ note. */
  { id:"pluck", label:"PLUCK",
    cutoff:2400, wet:.28, drift:0,
    attack:.003, decay:.280, sustain:.14, release:.350, level:.14,
    build(ctx, freq, t){
      const tri = osc(ctx, "triangle", freq);
      const saw = osc(ctx, "sawtooth", freq, 4);
      const sawGain = gain(ctx, .35);

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(2200, t);
      lp.frequency.exponentialRampToValueAtTime(900, t + 0.5);

      const amp = env(ctx, t, this);
      tri.connect(lp);
      saw.connect(sawGain).connect(lp);
      lp.connect(amp);
      return { amp, nodes:[tri, saw] };
    } },

  /* Deliberately dry — reverb is the one thing that would stop this reading as
     a chip. The second square a semitone-ish sharp is the chorus every sound
     chip faked the same way. */
  { id:"8bit", label:"8-BIT",
    cutoff:7000, wet:.05, drift:0,
    attack:.002, decay:.050, sustain:.90, release:.050, level:.070,
    build(ctx, freq, t){
      const a = osc(ctx, "square", freq);
      const b = osc(ctx, "square", freq, 12);
      const bGain = gain(ctx, .5);

      const amp = env(ctx, t, this);
      a.connect(amp);
      b.connect(bGain).connect(amp);
      return { amp, nodes:[a, b] };
    } },
];

export const DEFAULT_PATCH = "rhodes";

export const findPatch = id =>
  PATCHES.find(p => p.id === id) ?? PATCHES.find(p => p.id === DEFAULT_PATCH);

/* ----------------------------------------------------------------- synth */

export function createSynth(){
  let ctx = null, out = null, lowpass = null, master = null, wet = null, drift = null;
  let patch = findPatch(DEFAULT_PATCH);
  const voices = new Map();   // midi note -> voice
  let current = [];           // the note set as last requested, for setPatch

  /* Must be called from a real click: browsers refuse to start audio
     otherwise, and a context created too early comes up suspended. */
  async function start(patchId = DEFAULT_PATCH){
    patch = findPatch(patchId);
    if (ctx) { await ctx.resume(); return; }

    ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();

    // A compressor on the way out, so five voices plus reverb tails can never
    // clip however hard the right hand pushes the level.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value     = 6;
    comp.attack.value    = 0.004;
    comp.release.value   = 0.20;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0.0001;

    lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = patch.cutoff;
    lowpass.Q.value = 0.6;

    // One slow LFO for the whole chain, not one per voice: a shared drift keeps
    // a held pad moving without the voices phasing against each other.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.18;
    drift = ctx.createGain();
    drift.gain.value = patch.drift;
    lfo.connect(drift).connect(lowpass.detune);
    lfo.start();

    wet = ctx.createGain();
    wet.gain.value = patch.wet;
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.9, 2.6);

    lowpass.connect(master);
    master.connect(comp);          // dry
    master.connect(verb);
    verb.connect(wet).connect(comp);

    out = lowpass;
  }

  /* 0..1, eased so the right hand can swell without zipper noise. */
  function setVolume(v){
    if (!ctx) return;
    master.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.08);
  }

  /* Play exactly these MIDI notes. Notes already sounding keep ringing, so
     adding a 7th adds one voice rather than restarting the chord. */
  function setNotes(midi = []){
    current = [...midi];
    if (!ctx) return;
    const want = new Set(midi);

    for (const [note, v] of voices)
      if (!want.has(note)){ release(v, ctx.currentTime); voices.delete(note); }

    for (const note of want)
      if (!voices.has(note)) voices.set(note, attack(ctx, out, mtof(note), patch));
  }

  /* Swap the instrument under a chord that is already sounding. The note set
     never changes here — only the timbre — so main.js's `sounding` key stays
     valid and the caller does not have to re-issue the chord. */
  function setPatch(id){
    const next = findPatch(id);
    if (next === patch) return;
    patch = next;
    if (!ctx) return;

    const t = ctx.currentTime;
    lowpass.frequency.setTargetAtTime(patch.cutoff, t, 0.08);
    wet.gain.setTargetAtTime(patch.wet, t, 0.08);
    drift.gain.setTargetAtTime(patch.drift, t, 0.08);

    // Voices are built by the patch, so a change is a genuine re-strike.
    for (const [note, v] of voices){ release(v, t); voices.delete(note); }
    for (const note of current) voices.set(note, attack(ctx, out, mtof(note), patch));
  }

  const allOff = () => setNotes([]);

  return { start, setVolume, setNotes, setPatch, allOff,
           get ready(){ return !!ctx; },
           get patch(){ return patch.id; },
           get voiceCount(){ return voices.size; } };
}

/* ------------------------------------------------------------------ voice */

function attack(ctx, dest, freq, patch){
  const t = ctx.currentTime;
  const { amp, nodes } = patch.build(ctx, freq, t);
  amp.connect(dest);
  for (const n of nodes) n.start(t);
  // The release time travels with the voice: a pad's 1.2 s tail and 8-bit's
  // 50 ms cut are as much a part of the patch as its oscillators.
  return { amp, nodes, release: patch.release };
}

function release(v, t){
  v.amp.gain.cancelScheduledValues(t);
  v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), t);
  v.amp.gain.setTargetAtTime(0.0001, t, v.release / 3);
  for (const n of v.nodes) n.stop(t + v.release + 0.3);
}

/* The shared amp envelope, so each build() is only its oscillator wiring. */
function env(ctx, t, p){
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(p.level, t + p.attack);
  amp.gain.setTargetAtTime(p.level * p.sustain, t + p.attack, p.decay / 3);
  return amp;
}

function osc(ctx, type, freq, detune = 0){
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  return o;
}

function gain(ctx, value){
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/* ----------------------------------------------------------------- reverb */

/* Decaying noise makes a perfectly good small room, and generating it here
   keeps the project dependency-free — no impulse response file to ship. */
function impulse(ctx, seconds, decay){
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++){
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
