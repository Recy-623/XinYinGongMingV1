import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SYSTEM_PROMPT_LENGTH } from "../src/constants.js";
import { normalizeCharacter } from "../src/storage.js";

test("keeps up to 50000 System Prompt characters", () => {
  const prompt = "人".repeat(MAX_SYSTEM_PROMPT_LENGTH);
  const character = normalizeCharacter({ id: "test", name: "测试角色", systemPrompt: prompt });
  assert.equal(character.systemPrompt.length, MAX_SYSTEM_PROMPT_LENGTH);
  assert.equal(character.systemPrompt, prompt);
});

test("truncates imported System Prompts beyond 50000 characters", () => {
  const character = normalizeCharacter({
    id: "test",
    name: "测试角色",
    systemPrompt: "人".repeat(MAX_SYSTEM_PROMPT_LENGTH + 1),
  });
  assert.equal(character.systemPrompt.length, MAX_SYSTEM_PROMPT_LENGTH);
});
