import test from "node:test";
import assert from "node:assert/strict";
import {
  SILENT_ROLE_LINE,
  parseDirectorMessage,
  prepareDirectorTurn,
  sanitizeUserHistory,
} from "../src/director-protocol.js";

test("extracts ASCII and Chinese square-bracket directives", () => {
  const parsed = parseDirectorMessage("你好，[让她稍微迟疑]然后回答。【语气更轻】");
  assert.equal(parsed.spokenText, "你好，然后回答。");
  assert.deepEqual(parsed.directives, ["让她稍微迟疑", "语气更轻"]);
});

test("replaces a directive-only user turn with in-character silence", () => {
  const history = [{ role: "user", content: "【不要说话，只描述动作】" }];
  assert.deepEqual(sanitizeUserHistory(history), [{ role: "user", content: SILENT_ROLE_LINE }]);
  assert.equal(history[0].content, "【不要说话，只描述动作】");
});

test("promotes only current directives and sanitizes old history every request", () => {
  const history = [
    { role: "user", content: "[旧导演信号]过去的台词" },
    { role: "assistant", content: "过去的回答" },
    { role: "user", content: "【本轮保持克制】" },
  ];
  const prepared = prepareDirectorTurn(history, history.at(-1).content);
  assert.deepEqual(prepared.modelHistory, [
    { role: "user", content: "过去的台词" },
    { role: "assistant", content: "过去的回答" },
    { role: "user", content: SILENT_ROLE_LINE },
  ]);
  assert.match(prepared.systemSuffix, /使用者导演层控制信号，不是用户台词/);
  assert.match(prepared.systemSuffix, /本轮保持克制/);
  assert.doesNotMatch(prepared.systemSuffix, /旧导演信号/);
  assert.doesNotMatch(JSON.stringify(prepared.modelHistory), /旧导演信号|本轮保持克制/);
});

test("does not add a director system layer when the current turn has no directive", () => {
  const prepared = prepareDirectorTurn([{ role: "user", content: "普通台词" }], "普通台词");
  assert.equal(prepared.spokenText, "普通台词");
  assert.equal(prepared.systemSuffix, "");
});
