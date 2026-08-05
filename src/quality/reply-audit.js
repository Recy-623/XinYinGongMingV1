function cleanJson(value) { return String(value || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim(); }

export function replyAuditMessages({ characterName, personaPrompt, userInput, recentHistory, draft, lengthPlan }) {
  const history = (recentHistory || []).slice(-8).map((item) => ({ role: item.role, content: String(item.content || "").slice(0, 2500) }));
  return [{ role: "system", content: `你是长期陪伴角色回复质量验收器，不续写对话，只输出JSON：{"passed":boolean,"reason":string,"violations":[{"id":string,"evidence":string,"correction":string}]}。
仅在存在实质错误时失败。检查：忠实理解用户原话；不擅自定性为抱怨、嫉妒、害怕、撒娇、同意或拒绝；不代写用户未表达的心理、情绪、反应、台词、动作或选择；不捏造无依据的命名人物、辈分、共同经历和既成事实；当前角色以第一人称或省略主语描写自己；符合人设和关系事实；回应本轮并保持上下文连续；自然收束且不明显截断。` },
  { role: "system", content: `角色与关系约束：\n${String(personaPrompt || "").slice(0, 20000)}` },
  { role: "user", content: JSON.stringify({ characterName, userInput: String(userInput || "").slice(0, 6000), recentHistory: history, expectedLength: lengthPlan, draft: String(draft || "").slice(0, 20000) }) }];
}

export function replyAuditResult(value) {
  try {
    const parsed = JSON.parse(cleanJson(value));
    const violations = Array.isArray(parsed.violations) ? parsed.violations.map((item) => ({ id: String(item?.id || "quality"), evidence: String(item?.evidence || "").slice(0, 500), correction: String(item?.correction || "").slice(0, 1000) })).filter((item) => item.correction).slice(0, 12) : [];
    return { passed: parsed.passed === true && !violations.length, reason: String(parsed.reason || "").slice(0, 1500), violations };
  } catch { return { passed: false, reason: "验收结果无法解析", violations: [{ id: "invalid_audit", evidence: "", correction: "重新核对用户原话、角色事实和叙事边界后完整重写。" }] }; }
}

export function replyAuditCorrection(audit, draft, lengthPlan) {
  return `【回复质量纠正｜整轮重写】
上一稿未通过：${audit?.reason || "存在理解或边界错误"}
${(audit?.violations || []).map((item) => `- ${item.id}：${item.correction}${item.evidence ? `（问题片段：${item.evidence}）` : ""}`).join("\n")}
请从本轮用户输入重新作答，不解释验收过程；保留无问题且与上下文兼容的内容，不得把上一稿新增的错误事实当作历史。
${lengthPlan?.instruction || ""}
【上一稿，仅供定位错误】\n${String(draft || "").slice(0, 20000)}\n只输出新的角色回复。`;
}
