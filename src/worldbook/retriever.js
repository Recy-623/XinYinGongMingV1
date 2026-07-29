function terms(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/gu) || [])];
}

export function rankRelevantWorldEntries(worldbook, query, limit = 6, characterBudget = 1800) {
  if (!worldbook?.entries?.length) return [];
  const queryTerms = terms(query);
  let used = 0;
  return worldbook.entries.map((entry) => {
    const labels = [entry.title, ...(entry.keywords || []), ...(entry.aliases || [])].join(" ").toLowerCase();
    const score = entry.activation === "always" ? 100 : queryTerms.reduce((total, term) => total + (labels.includes(term) ? 2 : 0), 0) + Number(entry.importance || 0);
    return { ...entry, score };
  }).filter((entry) => entry.activation === "always" || entry.score >= 2)
    .sort((left, right) => right.score - left.score)
    .filter((entry) => {
      if (used + entry.content.length > characterBudget) return false;
      used += entry.content.length; return true;
    }).slice(0, limit);
}

export function worldbookContext(worldbook, query) {
  const selected = rankRelevantWorldEntries(worldbook, query);
  if (!selected.length) return "";
  return `\n\n【与当前话题相关的世界观资料】\n${selected.map((entry) => `- ${entry.title}：${entry.content}`).join("\n")}\n资料优先级按世界观文件定义；未检索到的条目不得凭空补全。`;
}
