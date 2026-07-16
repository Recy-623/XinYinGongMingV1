import assert from "node:assert/strict";
import test from "node:test";

const { createDefaultState } = await import("../src/constants.js");
const { serializeBackup } = await import("../src/storage.js");

test("fresh V5.2 state contains no roles, history, or active character", () => {
  const state = createDefaultState();
  assert.deepEqual(state.characters, []);
  assert.equal(state.activeCharacterId, "");
});

test("fresh V5.2 backup is also empty and contains no credentials", () => {
  const exported = JSON.parse(serializeBackup(createDefaultState()));
  assert.deepEqual(exported.state.characters, []);
  assert.equal("apiKey" in exported.state.globals, false);
});
