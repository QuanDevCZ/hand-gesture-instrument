/* audio.test.mjs — the patch registry.

   audio.js only touches `window` inside createSynth().start(), so the module
   imports cleanly in Node and the table can be checked without a browser.
   Nothing here can verify what a patch sounds like; what it can verify is that
   every patch is playable and that none of them silences a held chord. */

import test from "node:test";
import assert from "node:assert/strict";
import { PATCHES, DEFAULT_PATCH, findPatch } from "./audio.js";

test("every patch has an id, a label and a builder", () => {
  assert.ok(PATCHES.length >= 2, "a picker needs something to pick between");
  for (const p of PATCHES){
    assert.ok(p.id && typeof p.id === "string", `bad id: ${p.id}`);
    assert.ok(p.label && typeof p.label === "string", `${p.id} has no label`);
    assert.equal(typeof p.build, "function", `${p.id} has no build()`);
  }
});

test("patch ids are unique", () => {
  const ids = PATCHES.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id in ${ids.join(", ")}`);
});

test("every patch carries a complete, sane envelope and chain", () => {
  for (const p of PATCHES){
    for (const k of ["attack", "decay", "sustain", "release", "level", "cutoff", "wet", "drift"])
      assert.ok(Number.isFinite(p[k]), `${p.id}.${k} is not a number`);

    assert.ok(p.release > 0, `${p.id} would cut off instantly with release ${p.release}`);
    assert.ok(p.decay   > 0, `${p.id}.decay drives setTargetAtTime and must be > 0`);
    assert.ok(p.cutoff  > 0, `${p.id}.cutoff must be a positive frequency`);
    assert.ok(p.level   > 0, `${p.id} is inaudible at level ${p.level}`);
    assert.ok(p.wet >= 0 && p.wet <= 1, `${p.id}.wet out of range: ${p.wet}`);
    assert.ok(p.attack >= 0, `${p.id}.attack must not be negative`);
  }
});

/* The instrument holds a chord for as long as the sign is held and has no
   re-trigger source, so a patch that decays to zero would go silent under the
   player's hand. Percussive patches get a low sustain floor instead. */
test("no patch decays to silence — a held chord cannot die on its own", () => {
  for (const p of PATCHES)
    assert.ok(p.sustain > 0.05,
      `${p.id} sustains at ${p.sustain}; a held chord would fade out`);
});

test("levels stay inside the headroom five voices need", () => {
  for (const p of PATCHES)
    assert.ok(p.level <= 0.2, `${p.id} at level ${p.level} risks clipping five notes deep`);
});

test("DEFAULT_PATCH names a real patch", () => {
  assert.ok(PATCHES.some(p => p.id === DEFAULT_PATCH));
});

test("findPatch resolves ids and falls back rather than returning nothing", () => {
  assert.equal(findPatch("pad").id, "pad");
  // a stale localStorage value must not leave the instrument without a voice
  assert.equal(findPatch("a-patch-that-was-renamed").id, DEFAULT_PATCH);
  assert.equal(findPatch(undefined).id, DEFAULT_PATCH);
});
