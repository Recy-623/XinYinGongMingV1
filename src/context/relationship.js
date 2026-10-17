import { relationshipPresetForPrompt } from "../relationship-presets.js";

export const EVIDENCE_LABELS = Object.freeze({
  canon: "原作设定中的关系起点（非本机聊天经历）",
  chat: "聊天记录支持的关系",
  user_defined: "用户明确设定的虚构关系",
  unspecified: "已记录的关系（来源未分类，不视为聊天已证实）",
});

export function relationshipContext(character) {
  if (!character?.relationship && !character?.profile) return "";
  const profile = character.profile || {}; const relationship = character.relationship || {};
  const evidence = relationship.evidence || {};
  const parts = ["【角色与关系档案】"];
  if (profile.personality) parts.push(`人格：${profile.personality}`);
  if (profile.speechStyle?.length) parts.push(`表达习惯：${profile.speechStyle.join("；")}`);
  if (relationship.summary) parts.push(`${EVIDENCE_LABELS[evidence.sourceType] || EVIDENCE_LABELS.unspecified}：${relationship.summary}`);
  if (evidence.observedStage) parts.push(`起点阶段：${evidence.observedStage}`);
  if (evidence.summary) parts.push(`依据：${evidence.summary}`);
  parts.push(`相处预设（用户偏好）：\n${relationshipPresetForPrompt(relationship.preset)}`);
  if (relationship.interactionPatterns?.length) parts.push(`相处模式：${relationship.interactionPatterns.join("；")}`);
  const familiar = [...(relationship.nicknames || []), ...(relationship.sharedJokes || [])];
  if (familiar.length) parts.push(`称呼与共同用语：${familiar.join("；")}`);
  if (profile.boundaries?.length) parts.push(`边界：${profile.boundaries.join("；")}`);
  if (profile.uncertainties?.length) parts.push(`不确定信息：${profile.uncertainties.join("；")}`);
  parts.push("新增经历与关系变化以当前对话和另行检索的已确认记忆为准；原作起点、用户偏好和实际互动不得混为一谈。");
  return `\n\n${parts.join("\n")}`;
}
