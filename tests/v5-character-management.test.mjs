import assert from "node:assert/strict";
import test from "node:test";

const { characterFootprint, removeCharacterFromState } = await import("../src/character-management.js");

function character(id, canonical = 0, branches = []) {
  return { id, history: Array.from({ length: canonical }, () => ({ role: "user", content: "消息" })), timeline: { branches } };
}

test("V5.1 deleting the active character selects the adjacent survivor", () => {
  const first = character("first");
  const target = character("target", 2, [{ id: "branch", history: [{ role: "user", content: "分支消息" }] }]);
  const last = character("last");
  const state = { characters: [first, target, last], activeCharacterId: "target" };
  assert.deepEqual(characterFootprint(target), { canonicalMessages: 2, branches: 1, branchMessages: 1 });
  assert.equal(removeCharacterFromState(state, "target"), target);
  assert.deepEqual(state.characters.map((item) => item.id), ["first", "last"]);
  assert.equal(state.activeCharacterId, "last");
});

test("V5.1 deleting an inactive character preserves the active selection", () => {
  const state = { characters: [character("first"), character("active")], activeCharacterId: "active" };
  removeCharacterFromState(state, "first");
  assert.equal(state.activeCharacterId, "active");
  assert.deepEqual(state.characters.map((item) => item.id), ["active"]);
});

test("V5.1 deleting the final character leaves an empty valid state", () => {
  const state = { characters: [character("only")], activeCharacterId: "only" };
  removeCharacterFromState(state, "only");
  assert.deepEqual(state.characters, []);
  assert.equal(state.activeCharacterId, "");
  assert.equal(removeCharacterFromState(state, "missing"), null);
});
