import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChord, spell, mtof, ROOT_NAMES, EXTENSIONS } from "./music.js";

const notes = c => c.notes.join(" ");

/* ---------- roots ---------- */

test("signs 1-7 walk up the C major scale", () => {
  const roots = [1,2,3,4,5,6,7].map(s => buildChord(s).root);
  assert.deepEqual(roots, ["C","D","E","F","G","A","B"]);
  assert.deepEqual(roots, ROOT_NAMES);
});

test("a fist, a zero, or an out-of-range sign is silence", () => {
  for (const s of [0, null, undefined, -1, 8]) assert.equal(buildChord(s), null);
});

/* ---------- tilt: major vs minor ---------- */

test("sign 1 tilted inward is C major, tilted outward is C minor", () => {
  assert.equal(notes(buildChord(1, "major", 0)), "C E G");
  assert.equal(notes(buildChord(1, "minor", 0)), "C E\u266D G");
  assert.equal(buildChord(1, "minor", 0).name, "Cm");
});

test("minor thirds are spelled as flats, never as sharps", () => {
  assert.equal(notes(buildChord(4, "minor", 0)), "F A\u266D C");   // not G-sharp
  assert.equal(notes(buildChord(5, "minor", 0)), "G B\u266D D");
});

test("sharp keys keep their sharps", () => {
  assert.equal(notes(buildChord(7, "major", 0)), "B D\u266F F\u266F");
  assert.equal(notes(buildChord(7, "minor", 0)), "B D F\u266F");
});

/* ---------- extensions ---------- */

test("extension 1 follows the tilt", () => {
  assert.equal(buildChord(1, "major", 1).name, "Cmaj7");
  assert.equal(buildChord(1, "minor", 1).name, "Cm7");
  assert.equal(notes(buildChord(1, "major", 1)), "C E G B");
  assert.equal(notes(buildChord(1, "minor", 1)), "C E\u266D G B\u266D");
});

test("extension 2 forces a major third, overriding the tilt", () => {
  const maj = buildChord(1, "major", 2), min = buildChord(1, "minor", 2);
  assert.equal(maj.name, "C7");
  assert.equal(min.name, "C7");
  assert.deepEqual(min.intervals, [0, 4, 7, 10]);
  // and that is what keeps it audibly distinct from extension 1 in minor
  assert.notDeepEqual(min.intervals, buildChord(1, "minor", 1).intervals);
});

test("extension 3 drops the third entirely, so tilt cannot change it", () => {
  assert.equal(notes(buildChord(1, "major", 3)), "C F G");
  assert.equal(notes(buildChord(1, "minor", 3)), "C F G");
  assert.equal(buildChord(1, "minor", 3).name, "Csus4");
});

test("extensions 4 and 5 stack on whichever triad the tilt chose", () => {
  assert.equal(buildChord(1, "major", 4).name, "Cadd9");
  assert.equal(buildChord(1, "minor", 4).name, "Cm(add9)");
  assert.equal(notes(buildChord(1, "major", 4)), "C E G D");
  assert.equal(buildChord(1, "major", 5).name, "C6");
  assert.equal(buildChord(1, "minor", 5).name, "Cm6");
  assert.equal(notes(buildChord(1, "minor", 5)), "C E\u266D G A");
});

test("every extension is reachable and every one names itself", () => {
  assert.equal(EXTENSIONS.length, 6);
  for (const q of ["major", "minor"]){
    const names = EXTENSIONS.map(e => buildChord(1, q, e.count).name);
    assert.equal(new Set(names).size >= 5, true, `${q}: ${names.join(" ")}`);
    for (const n of names) assert.match(n, /^C/);
  }
});

test("an out-of-range extension clamps instead of throwing", () => {
  assert.equal(buildChord(1, "major", 99).extension, 5);
  assert.equal(buildChord(1, "major", -3).extension, 0);
});

/* ---------- voicing ---------- */

test("every chord carries a bass root an octave below the triad", () => {
  const c = buildChord(1, "major", 0);
  assert.deepEqual(c.midi, [48, 60, 64, 67]);
  assert.equal(c.midi[0], c.midi[1] - 12);
});

test("midi and freqs line up, and A4 is 440 Hz", () => {
  assert.equal(mtof(69), 440);
  const c = buildChord(6, "minor", 1);
  assert.equal(c.freqs.length, c.midi.length);
  c.midi.forEach((m, i) => assert.ok(Math.abs(c.freqs[i] - mtof(m)) < 1e-9));
});

test("notes and midi always describe the same chord", () => {
  for (let s = 1; s <= 7; s++)
    for (const q of ["major", "minor"])
      for (let e = 0; e <= 5; e++){
        const c = buildChord(s, q, e);
        assert.equal(c.notes.length, c.intervals.length);
        assert.equal(c.midi.length, c.intervals.length + 1);
        assert.ok(!c.notes.includes("?"), `${c.name} spelled ${c.notes.join(" ")}`);
      }
});

/* ---------- spelling helper ---------- */

test("spell walks letters, not semitones", () => {
  assert.equal(spell("C", 4), "E");
  assert.equal(spell("C", 3), "E\u266D");
  assert.equal(spell("E", 10), "D");      // E7 -> E G-sharp B D
  assert.equal(spell("B", 3), "D");
  assert.equal(spell("C", 14), "D");      // the 9th is a D, not an octave-up note
});
