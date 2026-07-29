import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { readBackup, readCard, serializeCard } = await import("../src/storage.js");
const { messagesAtOrBefore } = await import("../src/distillation.js");
const { activeBranch, activeHistory, branchSystemPrompt, compareBranches, createBranch, forkBranchAtTurn, normalizeTimeline, recordBranchTurn, removeBranch, renameBranch, serializeBranch, timelineFromDistillation } = await import("../src/time-travel.js");

function checkpoint(id, cutoffTime, marker) {
  return {
    id,
    cutoffTime,
    title: marker,
    summary: `${marker}摘要`,
    anchor: { side: "after", sender: "other", summary: `${marker}锚点` },
    snapshot: {
      personality: `${marker}人格`,
      speechStyle: [`${marker}语气`],
      relationshipSummary: `${marker}关系`,
      relationshipStage: `${marker}阶段`,
      relationshipEvidenceSummary: `${marker}证据`,
      interactionPatterns: [`${marker}模式`],
      knownMemories: [{ time: cutoffTime, title: `${marker}记忆`, summary: `${marker}已知故事`, confidence: 1 }],
      openThreads: [`${marker}待办`],
      boundaries: ["不虚构承诺"],
      uncertainties: [],
    },
    confidence: 0.9,
  };
}

function v5Character() {
  return {
    id: "char_test",
    name: "测试角色",
    avatar: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    systemPrompt: "FINAL_SYSTEM_FUTURE_SECRET",
    history: [{ role: "user", content: "真实现在消息" }],
    profile: { personality: "FINAL_PROFILE_FUTURE_SECRET", speechStyle: [], boundaries: [], uncertainties: [] },
    relationship: { summary: "FINAL_RELATIONSHIP_FUTURE_SECRET", preset: { id: "unspecified" }, evidence: {}, interactionPatterns: [], nicknames: [], sharedJokes: [] },
    memories: [{ time: "2026", title: "未来", summary: "FUTURE_MEMORY_SECRET" }],
    sourceMetadata: { distilledAt: "2026-07-15T00:00:00+08:00" },
    timeline: normalizeTimeline({
      sourceStart: "2025-01-01T00:00:00+08:00",
      sourceEnd: "2025-02-01T00:00:00+08:00",
      checkpoints: [checkpoint("cp_early", "2025-01-03T17:00:00+08:00", "EARLY_ONLY"), checkpoint("cp_late", "2025-01-20T21:00:00+08:00", "LATE_FUTURE_SECRET")],
      branches: [],
    }),
  };
}

test("V4 card migrates to V5 current-only checkpoint and cannot fabricate a past branch", () => {
  const card = readCard({
    version: "xinyin-card-v4",
    id: "legacy",
    name: "旧角色",
    avatar: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    systemPrompt: "旧人设",
    profile: { personality: "最终人格", speechStyle: [], boundaries: [], uncertainties: [] },
    relationship: { summary: "最终关系", preset: { id: "unspecified" }, evidence: {}, interactionPatterns: [], nicknames: [], sharedJokes: [] },
    memories: [{ time: "2025", title: "故事", summary: "内容" }],
    sourceMetadata: { distilledAt: "2025-12-31T00:00:00+08:00" },
  });
  assert.equal(card.timeline.checkpoints.length, 1);
  assert.equal(card.timeline.checkpoints[0].historical, false);
  assert.throws(() => createBranch(card.timeline, card.timeline.checkpoints[0].id, "constrained", "错误过去"), /不能创建过去分支/);
});

test("long character prompts are preserved up to the 50000 character card limit", () => {
  const prompt = "长".repeat(49_500);
  const card = readCard({
    version: "xinyin-card-v4",
    name: "长人设",
    systemPrompt: prompt,
    profile: {},
    relationship: {},
  });
  assert.equal(card.systemPrompt, prompt);
  const oversized = readCard({
    version: "xinyin-card-v4",
    name: "超长人设",
    systemPrompt: "界".repeat(50_500),
    profile: {},
    relationship: {},
  });
  assert.equal(oversized.systemPrompt.length, 50_000);
});

test("a card accidentally pasted into systemPrompt is recovered on import or load", () => {
  const embedded = JSON.stringify({
    systemPrompt: "真正的人设正文",
    history: [],
    profile: { boundaries: ["不应混进正文"] },
  }).slice(1);
  const card = readCard({
    version: "xinyin-card-v4",
    name: "可修复角色",
    systemPrompt: embedded,
    profile: {},
    relationship: {},
  });
  assert.equal(card.systemPrompt, "真正的人设正文");
});

test("early branch prompt never reads final character state or later checkpoints", () => {
  const character = v5Character();
  const branch = createBranch(character.timeline, "cp_early", "constrained", "早期分支");
  const prompt = branchSystemPrompt(character, branch, "用户");
  assert.match(prompt, /EARLY_ONLY/);
  for (const secret of ["FINAL_SYSTEM_FUTURE_SECRET", "FINAL_PROFILE_FUTURE_SECRET", "FINAL_RELATIONSHIP_FUTURE_SECRET", "FUTURE_MEMORY_SECRET", "LATE_FUTURE_SECRET"]) {
    assert.equal(prompt.includes(secret), false, `future leak: ${secret}`);
  }
  assert.match(prompt, /不得使用、猜中、暗示或承认锚点之后/);
});

test("multiple branches keep independent histories and can return to real history", () => {
  const character = v5Character();
  const first = createBranch(character.timeline, "cp_early", "constrained", "选择一");
  first.history.push({ role: "user", content: "新的回答一" }); recordBranchTurn(first);
  const second = createBranch(character.timeline, "cp_early", "free", "选择二");
  second.history.push({ role: "user", content: "新的回答二" }); recordBranchTurn(second);
  assert.equal(character.timeline.branches.length, 2);
  assert.deepEqual(activeHistory(character), second.history);
  assert.equal(first.history[0].content, "新的回答一");
  assert.equal(second.history[0].content, "新的回答二");
  assert.equal(first.state.turnCount, 1);
  assert.equal(first.state.divergences.length, 1);
  character.timeline.activeBranchId = "";
  assert.deepEqual(activeHistory(character), character.history);
  assert.equal(activeBranch(character), null);
});

test("branch deletion never changes canonical history or other branches", () => {
  const character = v5Character();
  const first = createBranch(character.timeline, "cp_early", "emotional", "可删除");
  const second = createBranch(character.timeline, "cp_late", "constrained", "保留");
  assert.equal(removeBranch(character.timeline, first.id), true);
  assert.equal(character.timeline.branches.length, 1);
  assert.equal(character.timeline.branches[0].id, second.id);
  assert.equal(character.history[0].content, "真实现在消息");
});

test("V5.1 branch rename validates names without changing branch identity", () => {
  const character = v5Character();
  const branch = createBranch(character.timeline, "cp_early", "free", "旧名称");
  const id = branch.id;
  renameBranch(character.timeline, id, "  新名称  ");
  assert.equal(branch.id, id);
  assert.equal(branch.name, "新名称");
  assert.throws(() => renameBranch(character.timeline, id, "   "), /不能为空/);
});

test("V5.2 rewind forks an independent branch at a user turn boundary", () => {
  const character = v5Character();
  const source = createBranch(character.timeline, "cp_early", "constrained", "原分支");
  source.history.push(
    { role: "user", content: "第一轮选择" },
    { role: "assistant", content: "第一轮回应" },
    { role: "user", content: "第二轮选择" },
    { role: "assistant", content: "第二轮回应" },
  );
  recordBranchTurn(source);
  const fork = forkBranchAtTurn(character.timeline, source.id, 1, "从第二轮重选");
  assert.equal(fork.state.turnCount, 1);
  assert.deepEqual(fork.history.map((message) => message.content), ["第一轮选择", "第一轮回应"]);
  fork.history.push({ role: "user", content: "新的第二轮" });
  assert.equal(source.history.some((message) => message.content === "新的第二轮"), false);
  assert.equal(character.timeline.activeBranchId, fork.id);
  assert.throws(() => forkBranchAtTurn(character.timeline, source.id, 99, "错误轮次"), /不能超过/);
});

test("V5.2 comparison finds the shared prefix and first different choices locally", () => {
  const character = v5Character();
  const first = createBranch(character.timeline, "cp_early", "free", "选择甲");
  first.history.push({ role: "user", content: "共同第一句" }, { role: "assistant", content: "共同回应" }, { role: "user", content: "甲的选择" });
  recordBranchTurn(first);
  const second = createBranch(character.timeline, "cp_early", "emotional", "选择乙");
  second.history.push({ role: "user", content: "共同第一句" }, { role: "assistant", content: "共同回应" }, { role: "user", content: "乙的选择" });
  recordBranchTurn(second);
  const comparison = compareBranches(character.timeline, first.id, second.id);
  assert.equal(comparison.sameCheckpoint, true);
  assert.equal(comparison.commonMessages, 2);
  assert.equal(comparison.first.firstDifferentChoice, "甲的选择");
  assert.equal(comparison.second.firstDifferentChoice, "乙的选择");
});

test("V5.2 branch export contains only its checkpoint and simulated history", () => {
  const character = v5Character();
  const branch = createBranch(character.timeline, "cp_early", "free", "可导出");
  branch.history.push({ role: "user", content: "分支内消息" }); recordBranchTurn(branch);
  const exportedText = serializeBranch(character, branch.id);
  const exported = JSON.parse(exportedText);
  assert.equal(exported.version, "xinyin-branch-v5.2");
  assert.equal(exported.branch.history[0].content, "分支内消息");
  assert.equal(exported.checkpoint.id, "cp_early");
  for (const secret of ["真实现在消息", "FINAL_SYSTEM_FUTURE_SECRET", "FINAL_PROFILE_FUTURE_SECRET", "LATE_FUTURE_SECRET"]) {
    assert.equal(exportedText.includes(secret), false, `branch export leak: ${secret}`);
  }
});

test("distillation timeline produces historical checkpoints and no branches", () => {
  const timeline = timelineFromDistillation({
    personality: "最终人格",
    relationshipSummary: "最终关系",
    memories: [],
    sourceMetadata: { sourceStart: "2025-01-01", sourceEnd: "2025-01-31", distilledAt: "2025-02-01" },
    timelineCheckpoints: [checkpoint("cp", "2025-01-03T17:00:00+08:00", "当时")],
  });
  assert.equal(timeline.checkpoints[0].historical, true);
  assert.equal(timeline.branches.length, 0);
  assert.equal(timeline.sourceStart, "2025-01-01");
});

test("single-card export keeps checkpoints but strips canonical and branch histories", () => {
  const character = readCard({ version: "xinyin-card-v5", ...v5Character() });
  const branch = createBranch(character.timeline, "cp_early", "free", "隐私分支");
  branch.history.push({ role: "user", content: "不应导出" }); character.history.push({ role: "user", content: "也不应导出" });
  const exported = JSON.parse(serializeCard(character));
  assert.equal(exported.version, "xinyin-card-v6");
  assert.equal(exported.experienceMode, "companion");
  assert.deepEqual(exported.history, []);
  assert.deepEqual(exported.timeline.branches, []);
  assert.equal(exported.timeline.checkpoints.length, 2);
});

test("V4 full backup is accepted and migrated to state version 6", () => {
  const state = readBackup({ version: "xinyin-backup-v4", state: { version: 4, globals: {}, characters: [] } });
  assert.equal(state.version, 6);
});

test("snapshot prefix filtering structurally excludes messages after the cutoff", () => {
  const messages = [
    { time: "2025-01-03T10:00:00+08:00", content: "已知" },
    { time: "2025-01-03T17:00:00+08:00", content: "锚点" },
    { time: "2025-01-20T21:00:00+08:00", content: "FUTURE_SECRET" },
  ];
  const prefix = messagesAtOrBefore(messages, "2025-01-03T17:00:00+08:00");
  assert.equal(prefix.length, 2);
  assert.equal(prefix.some((message) => message.content === "FUTURE_SECRET"), false);
});
