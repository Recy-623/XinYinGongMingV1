import assert from "node:assert/strict";
import test from "node:test";
import { readCard, serializeCard } from "../src/storage.js";
import {
  normalizeMemory, rankRelevantMemories, shouldExtractMemory,
} from "../src/memory/companion-memory.js";

test("V6 长期陪伴卡声明 companion 且拒绝 session_roleplay", () => {
  const card = { version: "xinyin-card-v6", experienceMode: "companion", name: "测试角色", systemPrompt: "稳定人设" };
  const imported = readCard(card);
  const exported = JSON.parse(serializeCard(imported));
  assert.equal(exported.experienceMode, "companion");
  assert.throws(
    () => readCard({ ...card, experienceMode: "session_roleplay" }),
    /短期语C模式/,
  );
});

test("长期记忆只检索相关有效条目并遵守 never", () => {
  const memories = [
    normalizeMemory({ summary: "用户喜欢在雨天散步", keywords: ["雨天"], importance: 0.8 }, "char_test"),
    normalizeMemory({ summary: "不应再提及的旧信息", keywords: ["雨天"], mentionPolicy: "never", importance: 1 }, "char_test"),
    normalizeMemory({ summary: "完全无关的信息", keywords: ["烹饪"], importance: 0.2 }, "char_test"),
  ];
  const selected = rankRelevantMemories(memories, "今天下雨了");
  assert.equal(selected.length, 1);
  assert.match(selected[0].summary, /雨天散步/);
});

test("记忆整理由明确记忆信号、场景边界或上下文阈值触发", () => {
  assert.equal(shouldExtractMemory({ userText: "请记住这件事" }).shouldExtract, true);
  assert.equal(shouldExtractMemory({ userText: "晚安，明天见" }).shouldExtract, true);
  assert.equal(shouldExtractMemory({ userText: "嗯", history: [] }).shouldExtract, false);
});
