import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("every DOM id used by main.js exists exactly once", () => {
  const used = [...main.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const counts = new Map(ids.map((id) => [id, ids.filter((candidate) => candidate === id).length]));
  const missing = [...new Set(used)].filter((id) => !counts.has(id));
  const duplicate = [...counts].filter(([, count]) => count !== 1).map(([id]) => id);
  assert.deepEqual(missing, []);
  assert.deepEqual(duplicate, []);
});

test("V5 time-travel controls and review editor are present", () => {
  for (const id of ["time-travel-btn", "time-travel-modal", "time-checkpoint-select", "time-branch-mode", "create-time-branch-btn", "return-real-timeline-btn", "review-timeline-checkpoints", "time-fork-source", "time-fork-turn", "fork-time-branch-btn", "time-compare-a", "time-compare-b", "compare-time-branches-btn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("home character deletion and expanded prompt editor are present", () => {
  assert.match(html, /id="delete-character-btn"/);
  assert.match(html, /id="config-char-prompt"[^>]*maxlength="50000"/);
  assert.match(main, /function deleteActiveCharacter\(\)/);
});

test("V6 companion branding and branch management actions are wired", () => {
  assert.match(html, /心印共鸣 V6/);
  for (const handler of ["forkSelectedBranch", "compareSelectedBranches", "renameBranch", "serializeBranch"]) assert.match(main, new RegExp(handler));
});
