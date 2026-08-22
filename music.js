/* music.js — pure harmony. No DOM, no Web Audio, no MediaPipe.
   Sign + tilt + extension go in; note names and frequencies come out. */

/* Signs 1-7 walk up the C major scale. Quality comes from the tilt, so nothing
   here is locked to the key — sign 1 outward really is C minor. */
export const ROOT_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
export const ROOT_NAMES     = ["C", "D", "E", "F", "G", "A", "B"];

export const BASE_MIDI = 60;   // sign 1 puts its root on middle C
export const BASS_DROP = 12;   // and a second root an octave down for weight

/* Right-hand finger count -> what gets layered onto the triad.
   `intervals` is a function of the tilt quality so one table drives both the
   notes and the printed name, and the readout can never disagree with the ear. */
export const EXTENSIONS = [
  {
    count: 0, label: "TRIAD",
    intervals: q => (q === "minor" ? [0, 3, 7] : [0, 4, 7]),
    suffix:    q => (q === "minor" ? "m" : ""),
  },
  {
    count: 1, label: "7th",
    intervals: q => (q === "minor" ? [0, 3, 7, 10] : [0, 4, 7, 11]),
    suffix:    q => (q === "minor" ? "m7" : "maj7"),
  },
  {
    // The one place the right hand outranks the tilt: a dominant 7th needs a
    // major third by definition, and forcing it keeps count 2 audibly distinct
    // from count 1 when the left hand is tilted to minor.
    count: 2, label: "DOM 7",
    intervals: () => [0, 4, 7, 10],
    suffix:    () => "7",
  },
  {
    count: 3, label: "SUS4",
    intervals: () => [0, 5, 7],       // no third at all, so the tilt is moot
    suffix:    () => "sus4",
  },
  {
    count: 4, label: "ADD9",
    intervals: q => (q === "minor" ? [0, 3, 7, 14] : [0, 4, 7, 14]),
    suffix:    q => (q === "minor" ? "m(add9)" : "add9"),
  },
  {
    count: 5, label: "6th",
    intervals: q => (q === "minor" ? [0, 3, 7, 9] : [0, 4, 7, 9]),
    suffix:    q => (q === "minor" ? "m6" : "6"),
  },
];

/* ---------------------------------------------------------------- spelling */

const LETTERS     = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_SEMI = [0, 2, 4, 5, 7, 9, 11];

/* How many letter names an interval travels: a third moves C->E (2 letters),
   a fifth C->G (4), and so on. Spelling by letter first and accidental second
   is what gets F minor right as F A-flat C instead of F G-sharp C. */
const LETTER_STEP = { 0:0, 3:2, 4:2, 5:3, 7:4, 9:5, 10:6, 11:6, 14:1 };

const ACCIDENTAL = { "-2":"\u266D\u266D", "-1":"\u266D", "0":"", "1":"\u266F", "2":"\u00D7" };

export function spell(rootName, interval){
  const li   = LETTERS.indexOf(rootName);
  const step = LETTER_STEP[interval];
  if (li < 0 || step === undefined) return "?";

  const target  = (li + step) % 7;
  const natural = (LETTER_SEMI[target] - LETTER_SEMI[li] + 12) % 12;
  // Wrap into -6..+5 so a flat reads as -1 rather than +11.
  const acc     = ((interval % 12) - natural + 18) % 12 - 6;

  return LETTERS[target] + (ACCIDENTAL[String(acc)] ?? "?");
}

export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------------ chord */

/* sign: 1-7 (0 or null means silence)
   quality: "major" | "minor"
   extension: 0-5 (the right hand's finger count)
   Returns null for silence, so callers can treat "no chord" as one case. */
export function buildChord(sign, quality = "major", extension = 0){
  if (!sign || sign < 1 || sign > 7) return null;

  const ext = EXTENSIONS[Math.max(0, Math.min(5, extension | 0))];
  const rootSemi  = ROOT_SEMITONES[sign - 1];
  const rootName  = ROOT_NAMES[sign - 1];
  const intervals = ext.intervals(quality);
  const root      = BASE_MIDI + rootSemi;

  return {
    sign, quality,
    extension: ext.count,
    extLabel:  ext.label,
    root:      rootName,
    name:      rootName + ext.suffix(quality),
    intervals,
    notes: intervals.map(i => spell(rootName, i)),
    midi:  [root - BASS_DROP, ...intervals.map(i => root + i)],
    get freqs(){ return this.midi.map(mtof); },
  };
}
