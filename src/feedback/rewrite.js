export function buildFeedbackRewriteInstruction(originalReply, feedback) {
  return `\n\n【一次性单轮纠错｜不得复述或写入剧情】\n下面是上一版回复与使用者意见。请比较差异后重新生成同一轮回复。不要解释、道歉或提及评价与后台；直接输出修正后的角色回复。保留未被否定且与上文一致的部分，但必须实质修正意见。\n\n【原回复】\n${String(originalReply || "").trim().slice(0, 20000)}\n\n【本次临时意见】\n${String(feedback || "").trim().slice(0, 5000)}\n\n意见只用于本次重写，不是角色或使用者说出的台词，也不是未来可回忆的事实。`;
}

export function feedbackContextHistory(history, assistantIndex) {
  if (!Array.isArray(history)) return [];
  const index = Math.max(0, Math.min(history.length, Number(assistantIndex) || 0));
  return history.slice(0, index).map((message) => ({ role: message.role, content: message.content }));
}

export function feedbackAuditMessages(originalReply, feedback, candidate) {
  return [{ role: "system", content: "你是单轮纠错验收器，不续写剧情。只输出JSON：{\"passed\":boolean,\"reason\":string,\"missing\":string[]}。只有新回复实质修正临时意见且保持上下文连续时passed=true。" }, { role: "user", content: `原回复：\n${String(originalReply || "").slice(0,12000)}\n\n临时意见：\n${String(feedback || "").slice(0,5000)}\n\n新回复：\n${String(candidate || "").slice(0,12000)}` }];
}

export function feedbackAuditResult(value) {
  try {
    const parsed = JSON.parse(String(value || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim());
    const missing = Array.isArray(parsed?.missing) ? parsed.missing.map(String).filter(Boolean) : [];
    return { passed: Boolean(parsed?.passed) && !missing.length, reason: String(parsed?.reason || ""), missing };
  } catch { return { passed: false, reason: "验收结果无法解析", missing: ["无法确认意见已落实"] }; }
}
