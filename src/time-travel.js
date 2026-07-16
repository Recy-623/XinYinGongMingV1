const MAX_CHECKPOINTS = 40;
const MAX_BRANCHES = 50;
const MAX_BRANCH_HISTORY = 500;

export const BRANCH_MODES = Object.freeze({
  constrained: {
    label: "历史约束",
    guidance: "保持截至锚点时的人物、处境和关系逻辑。已知外部事实可以自然延续，但不得强行复刻真实时间线中的后续人际事件。",
  },
  free: {
    label: "自由改写",
    guidance: "只继承锚点时已经知道的人物与记忆；锚点后的关系和事件可以根据新对话自由发展。",
  },
  emotional: {
    label: "情感重演",
    guidance: "允许用户表达当时未说出口的话并探索修复可能，同时保持对方边界，不把模拟回应说成现实中的同意。",
  },
});

function text(value, max = 3000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value, maxItems = 20, maxLength = 500) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => text(item, maxLength)).filter(Boolean) : [];
}

function confidence(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_BRANCH_HISTORY).flatMap((message) => {
    const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : null;
    const content = text(message?.content, 20_000);
    return role && content ? [{ role, content }] : [];
  });
}

function normalizeMemory(memory) {
  const title = text(memory?.title, 150);
  const summary = text(memory?.summary, 2000);
  if (!title || !summary) return null;
  return {
    time: text(memory?.time, 100),
    title,
    summary,
    emotionalMeaning: text(memory?.emotionalMeaning, 1000),
    keywords: list(memory?.keywords, 20, 80),
    confidence: confidence(memory?.confidence),
  };
}

export function normalizeSnapshot(value) {
  const evidence = value?.relationshipEvidence || value?.evidence || {};
  return {
    personality: text(value?.personality, 6000),
    speechStyle: list(value?.speechStyle),
    relationshipSummary: text(value?.relationshipSummary, 6000),
    relationshipStage: text(value?.relationshipStage || evidence.observedStage, 300),
    relationshipEvidence: text(value?.relationshipEvidenceSummary || evidence.summary, 3000),
    interactionPatterns: list(value?.interactionPatterns),
    nicknames: list(value?.nicknames),
    sharedJokes: list(value?.sharedJokes),
    boundaries: list(value?.boundaries),
    uncertainties: list(value?.uncertainties),
    knownMemories: Array.isArray(value?.knownMemories) ? value.knownMemories.map(normalizeMemory).filter(Boolean).slice(0, 100) : [],
    openThreads: list(value?.openThreads, 20, 1000),
  };
}

export function normalizeCheckpoint(value, index = 0) {
  const cutoffTime = text(value?.cutoffTime || value?.at, 100);
  const title = text(value?.title, 150) || `时间锚点 ${index + 1}`;
  if (!cutoffTime) return null;
  const anchor = value?.anchor || {};
  return {
    id: text(value?.id, 100) || `checkpoint_${index + 1}`,
    cutoffTime,
    title,
    summary: text(value?.summary, 2000),
    anchor: {
      side: anchor.side === "before" ? "before" : "after",
      sender: ["self", "other", "system"].includes(anchor.sender) ? anchor.sender : "unknown",
      summary: text(anchor.summary, 600),
    },
    snapshot: normalizeSnapshot(value?.snapshot),
    confidence: confidence(value?.confidence),
    historical: value?.historical !== false,
  };
}

export function normalizeBranch(value, checkpointIds = new Set()) {
  const checkpointId = text(value?.checkpointId, 100);
  if (!checkpointIds.has(checkpointId)) return null;
  const mode = BRANCH_MODES[value?.mode] ? value.mode : "constrained";
  const history = normalizeHistory(value?.history);
  return {
    id: text(value?.id, 100) || `branch_${Date.now()}`,
    name: text(value?.name, 120) || "未命名分支",
    checkpointId,
    mode,
    createdAt: text(value?.createdAt, 100) || new Date().toISOString(),
    history,
    state: {
      turnCount: history.filter((message) => message.role === "user").length,
      statusSummary: text(value?.state?.statusSummary, 2000),
      lastUpdatedAt: text(value?.state?.lastUpdatedAt, 100),
      divergences: list(value?.state?.divergences, 30, 1000),
      newMemories: Array.isArray(value?.state?.newMemories) ? value.state.newMemories.map(normalizeMemory).filter(Boolean).slice(0, 100) : [],
    },
  };
}

function currentCheckpoint(fallback = {}) {
  const at = text(fallback?.sourceMetadata?.distilledAt, 100) || new Date().toISOString();
  return normalizeCheckpoint({
    id: "checkpoint_migrated_current",
    cutoffTime: at,
    title: "V4 迁移时刻（仅当前状态）",
    summary: "旧版角色卡没有历史切片。这个锚点只代表导入时的最终状态，不能用于可靠地回到更早时间。",
    historical: false,
    confidence: 1,
    snapshot: {
      personality: fallback?.profile?.personality,
      speechStyle: fallback?.profile?.speechStyle,
      relationshipSummary: fallback?.relationship?.summary,
      relationshipStage: fallback?.relationship?.evidence?.observedStage,
      relationshipEvidenceSummary: fallback?.relationship?.evidence?.summary,
      interactionPatterns: fallback?.relationship?.interactionPatterns,
      nicknames: fallback?.relationship?.nicknames,
      sharedJokes: fallback?.relationship?.sharedJokes,
      boundaries: fallback?.profile?.boundaries,
      uncertainties: [...(fallback?.profile?.uncertainties || []), "该切片由 V4 最终状态迁移，可能包含晚于所选历史时刻形成的认识。"],
      knownMemories: fallback?.memories,
      openThreads: [],
    },
  }, 0);
}

export function normalizeTimeline(value, fallback = {}) {
  let checkpoints = Array.isArray(value?.checkpoints)
    ? value.checkpoints.map(normalizeCheckpoint).filter(Boolean).slice(0, MAX_CHECKPOINTS)
    : [];
  if (!checkpoints.length) checkpoints = [currentCheckpoint(fallback)];
  checkpoints.sort((a, b) => a.cutoffTime.localeCompare(b.cutoffTime));
  const ids = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  const branches = Array.isArray(value?.branches)
    ? value.branches.map((branch) => normalizeBranch(branch, ids)).filter(Boolean).slice(0, MAX_BRANCHES)
    : [];
  const activeBranchId = text(value?.activeBranchId, 100);
  return {
    sourceStart: text(value?.sourceStart, 100),
    sourceEnd: text(value?.sourceEnd, 100),
    checkpoints,
    branches,
    activeBranchId: branches.some((branch) => branch.id === activeBranchId) ? activeBranchId : "",
  };
}

export function timelineFromDistillation(result) {
  return normalizeTimeline({
    sourceStart: result?.sourceMetadata?.sourceStart,
    sourceEnd: result?.sourceMetadata?.sourceEnd,
    checkpoints: result?.timelineCheckpoints,
    branches: [],
    activeBranchId: "",
  }, {
    profile: { personality: result?.personality, speechStyle: result?.speechStyle, boundaries: result?.boundaries, uncertainties: result?.uncertainties },
    relationship: {
      summary: result?.relationshipSummary,
      evidence: result?.relationshipEvidence,
      interactionPatterns: result?.interactionPatterns,
      nicknames: result?.nicknames,
      sharedJokes: result?.sharedJokes,
    },
    memories: result?.memories,
    sourceMetadata: result?.sourceMetadata,
  });
}

export function createBranch(timeline, checkpointId, mode, name) {
  if (!timeline || !Array.isArray(timeline.checkpoints) || !Array.isArray(timeline.branches)) throw new Error("时间线数据不完整");
  if (timeline.branches.length >= MAX_BRANCHES) throw new Error(`每个角色最多保留 ${MAX_BRANCHES} 条分支`);
  const checkpoint = timeline.checkpoints.find((item) => item.id === checkpointId);
  if (!checkpoint) throw new Error("所选时间锚点不存在");
  if (!checkpoint.historical) throw new Error("这个旧版迁移锚点不具备可靠的历史切片，不能创建过去分支。请重新导入聊天记录进行 V5 蒸馏。");
  const branch = normalizeBranch({
    id: `branch_${crypto.randomUUID()}`,
    name: text(name, 120) || `${checkpoint.title}的新分支`,
    checkpointId,
    mode,
    createdAt: new Date().toISOString(),
    history: [],
    state: {
      turnCount: 0,
      statusSummary: `从“${checkpoint.title}”之后开始，尚未产生新的偏离。`,
      lastUpdatedAt: new Date().toISOString(),
      divergences: [],
      newMemories: [],
    },
  }, new Set(timeline.checkpoints.map((item) => item.id)));
  timeline.branches.push(branch);
  timeline.activeBranchId = branch.id;
  return branch;
}

export function activeBranch(character) {
  return character?.timeline?.branches?.find((branch) => branch.id === character.timeline.activeBranchId) || null;
}

export function activeHistory(character) {
  return activeBranch(character)?.history || character?.history || [];
}

export function checkpointForBranch(character, branch) {
  return character?.timeline?.checkpoints?.find((checkpoint) => checkpoint.id === branch?.checkpointId) || null;
}

export function branchSystemPrompt(character, branch, userName) {
  const checkpoint = checkpointForBranch(character, branch);
  if (!checkpoint) throw new Error("分支对应的时间锚点已丢失");
  const snapshot = checkpoint.snapshot;
  const knownMemories = snapshot.knownMemories.map((memory) => `- [${memory.time || "时间未知"}] ${memory.title}：${memory.summary}`).join("\n") || "无可用历史记忆";
  const mode = BRANCH_MODES[branch.mode] || BRANCH_MODES.constrained;
  return `你正在参与“刻舟求剑”历史分支模拟。你是基于已授权聊天记录生成的关系角色，不是现实中的本人。\n\n【不可违反的时间边界】\n当前锚点：${checkpoint.cutoffTime}（${checkpoint.anchor.side === "before" ? "锚点消息之前" : "锚点消息之后"}）。\n你只能知道下方切片明确列出的信息。不得使用、猜中、暗示或承认锚点之后真实时间线中的事件；即使用户提到未来，也只能把它当作用户此刻提出的新信息、假设或预言，不能声称自己原本知道。真实历史不会被本对话改变。\n\n【模拟模式：${mode.label}】\n${mode.guidance}\n\n【截至锚点的人物切片】\n人格：${snapshot.personality || "尚未形成稳定结论"}\n表达习惯：${snapshot.speechStyle.join("；") || "尚未形成稳定结论"}\n当时的关系：${snapshot.relationshipSummary || "尚未形成稳定结论"}\n当时的关系阶段：${snapshot.relationshipStage || "未定义"}\n当时可用的关系证据：${snapshot.relationshipEvidence || "未记录"}\n相处模式：${snapshot.interactionPatterns.join("；") || "未记录"}\n当时已有称呼与梗：${[...snapshot.nicknames, ...snapshot.sharedJokes].join("；") || "未记录"}\n未解决的话题：${snapshot.openThreads.join("；") || "未记录"}\n边界：${snapshot.boundaries.join("；") || "尊重拒绝，不虚构承诺"}\n不确定项：${snapshot.uncertainties.join("；") || "未记录"}\n\n【截至锚点已经发生的共同记忆】\n${knownMemories}\n\n当前交流的用户名字是：${userName}。自然地从这个时间点继续互动，不要解释系统设定，除非用户询问模拟边界。`;
}

export function recordBranchTurn(branch) {
  branch.state.turnCount = branch.history.filter((message) => message.role === "user").length;
  branch.state.lastUpdatedAt = new Date().toISOString();
  if (branch.state.turnCount === 1 && !branch.state.divergences.length) {
    branch.state.divergences.push("用户在时间锚点后给出了新的第一项选择，分支自此与真实历史分离。");
    branch.state.statusSummary = "分支已经产生第一处偏离；关系将依据新对话继续发展。";
  } else if (branch.state.turnCount > 1) {
    branch.state.statusSummary = `分支已进行 ${branch.state.turnCount} 轮用户互动，当前变化由分支对话历史持续承载。`;
  }
}

export function removeBranch(timeline, branchId) {
  const index = timeline.branches.findIndex((branch) => branch.id === branchId);
  if (index < 0) return false;
  timeline.branches.splice(index, 1);
  if (timeline.activeBranchId === branchId) timeline.activeBranchId = "";
  return true;
}

export function renameBranch(timeline, branchId, name) {
  const branch = timeline?.branches?.find((item) => item.id === branchId);
  if (!branch) throw new Error("要重命名的分支不存在");
  const nextName = text(name, 120);
  if (!nextName) throw new Error("分支名称不能为空");
  branch.name = nextName;
  branch.state.lastUpdatedAt = new Date().toISOString();
  return branch;
}

function historyThroughUserTurns(history, keepUserTurns) {
  const keep = Math.max(0, Math.floor(Number(keepUserTurns) || 0));
  const result = [];
  let userTurns = 0;
  for (const message of normalizeHistory(history)) {
    if (message.role === "user") {
      if (userTurns >= keep) break;
      userTurns += 1;
    }
    result.push({ ...message });
  }
  return result;
}

export function forkBranchAtTurn(timeline, sourceBranchId, keepUserTurns, name) {
  const source = timeline?.branches?.find((branch) => branch.id === sourceBranchId);
  if (!source) throw new Error("作为起点的分支不存在");
  const requestedTurns = Math.max(0, Math.floor(Number(keepUserTurns) || 0));
  if (requestedTurns > source.state.turnCount) throw new Error("保留轮数不能超过原分支已有轮数");
  if (timeline.branches.length >= MAX_BRANCHES) throw new Error(`每个角色最多保留 ${MAX_BRANCHES} 条分支`);
  const history = historyThroughUserTurns(source.history, requestedTurns);
  const branch = normalizeBranch({
    id: `branch_${crypto.randomUUID()}`,
    name: text(name, 120) || `${source.name} · 从第 ${requestedTurns + 1} 轮重选`,
    checkpointId: source.checkpointId,
    mode: source.mode,
    createdAt: new Date().toISOString(),
    history,
    state: {
      turnCount: requestedTurns,
      statusSummary: `从“${source.name}”保留前 ${requestedTurns} 轮后派生，下一次回答将形成新的偏离。`,
      lastUpdatedAt: new Date().toISOString(),
      divergences: [`由分支“${source.name}”回溯到第 ${requestedTurns} 轮结束处。`],
      newMemories: [],
    },
  }, new Set(timeline.checkpoints.map((checkpoint) => checkpoint.id)));
  timeline.branches.push(branch);
  timeline.activeBranchId = branch.id;
  return branch;
}

function firstUserTextAfter(history, commonMessages) {
  return history.slice(commonMessages).find((message) => message.role === "user")?.content || "尚无新的用户选择";
}

export function compareBranches(timeline, firstId, secondId) {
  const first = timeline?.branches?.find((branch) => branch.id === firstId);
  const second = timeline?.branches?.find((branch) => branch.id === secondId);
  if (!first || !second) throw new Error("请选择两条仍然存在的分支");
  if (first.id === second.id) throw new Error("请选择两条不同的分支");
  let commonMessages = 0;
  const limit = Math.min(first.history.length, second.history.length);
  while (commonMessages < limit) {
    const left = first.history[commonMessages];
    const right = second.history[commonMessages];
    if (left.role !== right.role || left.content !== right.content) break;
    commonMessages += 1;
  }
  return {
    sameCheckpoint: first.checkpointId === second.checkpointId,
    commonMessages,
    first: { id: first.id, name: first.name, mode: first.mode, turnCount: first.state.turnCount, firstDifferentChoice: firstUserTextAfter(first.history, commonMessages) },
    second: { id: second.id, name: second.name, mode: second.mode, turnCount: second.state.turnCount, firstDifferentChoice: firstUserTextAfter(second.history, commonMessages) },
  };
}

export function serializeBranch(character, branchId) {
  const branch = character?.timeline?.branches?.find((item) => item.id === branchId);
  if (!branch) throw new Error("要导出的分支不存在");
  const checkpoint = checkpointForBranch(character, branch);
  if (!checkpoint) throw new Error("分支对应的时间锚点已丢失");
  return JSON.stringify({
    version: "xinyin-branch-v5.2",
    exportedAt: new Date().toISOString(),
    notice: "这是模拟分支，不代表真实人物的同意、承诺或现实历史。",
    character: { name: text(character?.name, 80) },
    checkpoint,
    branch,
  }, null, 2);
}

export function displayTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
