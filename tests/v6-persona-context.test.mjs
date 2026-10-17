import assert from "node:assert/strict";
import test from "node:test";
import { rankRelevantWorldEntries, worldbookContext, worldbookStatus } from "../src/worldbook/retriever.js";
import { relationshipContext } from "../src/context/relationship.js";
import { cardMemorySeeds, normalizeMemory, rankRelevantMemories } from "../src/memory/companion-memory.js";
import { readCard, serializeCard, normalizeCharacter } from "../src/storage.js";
import { prepareCompanionAssets } from "../scripts/prepare-companion-assets.mjs";

const worldbook = { version: "xinyin-worldbook-v1", id: "test_book", title: "测试资料", precedence: ["推断不能当作事实"], entries: [
  { id: "teacher", title: "教师", keywords: ["顾先生", "师父"], aliases: ["顾师父"], content: "已确认的授业者。", importance: 0.8, sourceTier: "creator_defined" },
  { id: "lake", title: "湖边", keywords: ["镜湖"], content: "位于城外。", importance: 0.5, sourceTier: "inference", canonNotes: "具体距离未定。" },
  { id: "art", title: "画作", keywords: ["art"], content: "绘画。", importance: 1 },
] };

test("世界观从中文完整句子识别人名、地点与别名", () => {
  for (const query of ["顾先生今天会来吗", "回去看看师父", "顾师父在哪里"])
    assert.equal(rankRelevantWorldEntries(worldbook, query)[0].id, "teacher");
  assert.equal(rankRelevantWorldEntries(worldbook, "我想去镜湖散步")[0].id, "lake");
  assert.deepEqual(rankRelevantWorldEntries(worldbook, "早上好"), []);
  assert.deepEqual(rankRelevantWorldEntries(worldbook, "party"), []);
  assert.equal(rankRelevantWorldEntries(worldbook, "look at ART!")[0].id, "art");
});

test("世界观限制条数和正文预算，并把推断边界交给模型", () => {
  assert.equal(rankRelevantWorldEntries(worldbook, "师父和镜湖", 1).length, 1);
  assert.deepEqual(rankRelevantWorldEntries(worldbook, "师父", 6, 2), []);
  assert.match(worldbookContext(worldbook, "镜湖"), /具体距离未定/);
  assert.match(worldbookContext(worldbook, "镜湖"), /推断不能当作事实/);
  assert.match(worldbookStatus({ worldbookRef: { id: "test_book", title: "测试资料" } }), /尚未加载/);
  assert.match(worldbookStatus({ worldbook }), /3 条/);
});

test("V6 卡保留关系和基础记忆来源，不导出运行场景或伪造历史切片", () => {
  const input = { version: "xinyin-card-v6", experienceMode: "companion", id: "test", name: "角色", systemPrompt: "人设",
    relationship: { summary: "原作同伴", evidence: { sourceType: "canon", sourceRefs: ["https://example.com/story"] } },
    memories: [{ title: "旧事", summary: "经历", memoryType: "episodic", sourceType: "canon", sourceRefs: ["https://example.com/story"] }],
    timeline: { checkpoints: [], branches: [] },
  };
  const card = readCard(input);
  assert.match(relationshipContext(card), /原作设定中的关系起点/);
  assert.doesNotMatch(relationshipContext(card), /聊天证实的关系/);
  assert.match(relationshipContext({ relationship: { summary: "旧档案" } }), /来源未分类/);
  assert.match(relationshipContext({ relationship: { summary: "同学", evidence: { sourceType: "chat" } } }), /聊天记录支持/);
  assert.deepEqual(card.timeline.checkpoints, []);
  card.contextState.sceneSummary = "PRIVATE_RUNTIME_SCENE";
  const exported = JSON.parse(serializeCard(card));
  assert.equal(exported.memories[0].memoryType, "episodic");
  assert.equal(exported.relationship.evidence.sourceType, "canon");
  assert.deepEqual(exported.memories[0].sourceRefs, input.memories[0].sourceRefs);
  assert.equal("contextState" in exported, false);
  assert.deepEqual(exported.history, []);
  assert.deepEqual(normalizeCharacter(card).timeline.checkpoints, []);
});

test("基础记忆重新分类不产生重复 ID，不重新激活已停用条目", () => {
  const character = { id: "char_test", memories: [{ title: "旧事", summary: "校正后的经历", memoryType: "episodic", sourceType: "canon", confidence: 1 }] };
  const old = normalizeMemory({ memoryType: "relationship", subjectKey: "card:旧事", summary: "原经历", status: "superseded", mentionPolicy: "never" }, character.id);
  const first = cardMemorySeeds(character, [old]);
  assert.equal(first[0].id, old.id);
  assert.equal(first[0].memoryType, "episodic");
  assert.equal(first[0].status, "superseded");
  assert.equal(first[0].mentionPolicy, "never");
  assert.equal(cardMemorySeeds(character, first)[0].id, old.id);
  assert.equal(cardMemorySeeds(character)[0].id, old.id);
});

test("高重要度基础记忆仍须与当前话题有关", () => {
  const memory = normalizeMemory({ summary: "父亲留下旧琴", keywords: ["父亲", "旧琴"], importance: 1, confirmed: true, confidence: 1 });
  assert.deepEqual(rankRelevantMemories([memory], "早上好"), []);
  assert.deepEqual(rankRelevantMemories([memory], ""), []);
  assert.equal(rankRelevantMemories([memory], "说说那张旧琴吧").length, 1);
});

test("应用资产更新保留聊天、头像、运行阶段与真实历史分支", () => {
  const existing = { id: "test", name: "角色", experienceMode: "companion", systemPrompt: "旧设定", history: [{ role: "user", content: "保留" }],
    avatar: "local-avatar", contextState: { sceneSummary: "真实阶段" }, timeline: { checkpoints: [
      { id: "checkpoint_migrated_current", historical: false }, { id: "real", historical: true },
    ], branches: [{ id: "branch", checkpointId: "real" }] } };
  const card = { version: "xinyin-card-v6", experienceMode: "companion", id: "test", name: "角色", systemPrompt: "新设定", worldbookRef: { id: worldbook.id } };
  const result = prepareCompanionAssets({ card, worldbook, existing });
  assert.deepEqual(result.character.history, existing.history);
  assert.deepEqual(result.character.contextState, existing.contextState);
  assert.equal(result.character.avatar, existing.avatar);
  assert.deepEqual(result.character.timeline.checkpoints, [{ id: "real", historical: true }]);
  assert.deepEqual(result.character.timeline.branches, existing.timeline.branches);
  assert.equal(result.character.worldbook.id, worldbook.id);
  assert.throws(() => prepareCompanionAssets({ card: { ...card, id: "different" }, worldbook, existing }), /身份不匹配/);
});
