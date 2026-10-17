function matches(query, label) {
  const term = String(label || "").trim().toLowerCase();
  if (term.length < 2) return false;
  if (/[\u4e00-\u9fff]/u.test(term)) return query.includes(term);
  return (` ${query.replace(/[^a-z0-9_]+/gu, " ")} `).includes(` ${term.replace(/[^a-z0-9_]+/gu, " ")} `);
}

export function rankRelevantWorldEntries(worldbook, query, limit = 6, characterBudget = 1800) {
  if (!worldbook?.entries?.length || limit <= 0 || characterBudget <= 0) return [];
  const input = String(query || "").toLowerCase();
  const ranked = worldbook.entries.map((entry) => {
    const labels = [...new Set([entry.title, ...(entry.keywords || []), ...(entry.aliases || [])].filter(Boolean))];
    const hits = labels.filter((label) => matches(input, label));
    const relevance = hits.reduce((score, label) => score + Math.min(label.length, 8), 0);
    return { ...entry, score: entry.activation === "always" ? 1000 : relevance + Number(entry.importance || 0), relevant: hits.length > 0 };
  }).filter((entry) => entry.activation === "always" || entry.relevant)
    .sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));
  const selected = []; let used = 0;
  for (const { relevant, ...entry } of ranked) {
    if (selected.length >= limit) break;
    const length = String(entry.content || "").length;
    if (used + length > characterBudget) continue;
    used += length; selected.push(entry);
  }
  return selected;
}

export function worldbookStatus(character) {
  if (character?.worldbook?.entries?.length) return `已关联：${character.worldbook.title}（${character.worldbook.entries.length} 条）`;
  if (character?.worldbookRef?.id) return `待导入：${character.worldbookRef.title || character.worldbookRef.id}（只有引用，尚未加载资料）`;
  return "未关联世界观";
}

export function worldbookContext(worldbook, query) {
  const selected = rankRelevantWorldEntries(worldbook, query);
  if (!selected.length) return "";
  const precedence = (worldbook.precedence || []).join("；");
  return `\n\n【与当前话题相关的世界观资料】\n${selected.map((entry) => `- ${entry.title}（${entry.sourceTier || "来源未标明"}）：${entry.content}${entry.canonNotes ? `［资料边界：${entry.canonNotes}］` : ""}`).join("\n")}\n${precedence ? `取用规则：${precedence}。` : ""}未检索到的条目不得凭空补全；资料中的历史事件不等于本次聊天刚发生的事件。`;
}
