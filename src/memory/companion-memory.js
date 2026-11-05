function clean(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function unique(value, limit = 30, maxLength = 200) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, limit);
}

export function memoryTerms(value) {
  const source = String(value || "").toLowerCase();
  const terms = new Set(source.match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/gu) || []);
  for (const block of [...terms]) {
    if (/^[\u4e00-\u9fff]+$/u.test(block)) {
      for (let index = 0; index < block.length - 1; index += 1) terms.add(block.slice(index, index + 2));
      for (let index = 0; index < block.length - 2; index += 1) terms.add(block.slice(index, index + 3));
    }
  }
  return [...terms].slice(0, 120);
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value || "")) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function normalizeMemory(value, characterId = "") {
  const summary = clean(value?.summary);
  const memoryType = ["episodic", "relationship", "preference", "open_loop", "learned_guideline"]
    .includes(value?.memoryType) ? value.memoryType : "episodic";
  const subjectKey = clean(value?.subjectKey, 200);
  const fingerprint = clean(value?.fingerprint, 100)
    || hash(`${characterId}\n${memoryType}\n${subjectKey || memoryTerms(summary).slice(0, 10).sort().join("|")}`);
  return {
    id: clean(value?.id, 120) || `memory_${fingerprint}`,
    characterId: clean(value?.characterId, 120) || clean(characterId, 120),
    memoryType,
    summary,
    keywords: unique(value?.keywords),
    semanticTerms: unique(value?.semanticTerms?.length ? value.semanticTerms : memoryTerms(summary), 50),
    importance: Math.max(0, Math.min(1, Number(value?.importance) || 0.5)),
    confidence: Math.max(0, Math.min(1, Number(value?.confidence) || 0.5)),
    confirmed: Boolean(value?.confirmed),
    status: ["active", "resolved", "superseded", "expired"].includes(value?.status) ? value.status : "active",
    scope: ["scene", "long_term", "identity"].includes(value?.scope) ? value.scope : "long_term",
    mentionPolicy: ["relevant", "passive", "never"].includes(value?.mentionPolicy) ? value.mentionPolicy : "relevant",
    subjectKey,
    fingerprint,
    observedAt: clean(value?.observedAt, 100) || new Date().toISOString(),
  };
}

function overlap(left, right) {
  const a = new Set(left); const b = new Set(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((item) => b.has(item)).length / Math.sqrt(a.size * b.size);
}

export function rankRelevantMemories(memories, query, limit = 5, characterBudget = 1200) {
  const queryTerms = memoryTerms(query);
  let used = 0;
  return (Array.isArray(memories) ? memories : [])
    .map((raw) => {
      const memory = normalizeMemory(raw, raw?.characterId);
      if (memory.status !== "active" || memory.mentionPolicy === "never") return null;
      const semantic = overlap(queryTerms, memory.semanticTerms);
      const lexical = queryTerms.filter((term) => `${memory.summary} ${memory.keywords.join(" ")}`.toLowerCase().includes(term)).length;
      return { ...raw, ...memory, score: lexical * 2.2 + semantic * 8 + memory.importance * 2 + memory.confidence + (memory.confirmed ? 1.5 : 0) };
    })
    .filter((memory) => memory && (memory.score >= 1.2 || memory.importance >= 0.95))
    .sort((left, right) => right.score - left.score)
    .filter((memory) => {
      const length = memory.summary.length;
      if (used + length > characterBudget) return false;
      used += length; return true;
    })
    .slice(0, limit);
}

export function shouldExtractMemory({ userText = "", history = [], lastIndex = 0 } = {}) {
  const segment = history.slice(lastIndex);
  const text = String(userText || "");
  const explicit = /记住|别忘|以后|答应我|约定|下次|纠正|不是这个意思|不要再/u.test(text);
  const sceneBoundary = /先到这里|今天就到这里|晚安|明天见|这件事结束/u.test(text);
  const sizeReached = segment.length >= 16 || segment.reduce((sum, item) => sum + String(item?.content || "").length, 0) >= 10_000;
  return { shouldExtract: explicit || sceneBoundary || sizeReached, reasons: [
    explicit ? "explicit_or_correction" : "", sceneBoundary ? "scene_boundary" : "", sizeReached ? "context_threshold" : "",
  ].filter(Boolean) };
}

export function parseMemoryExtraction(raw, characterId) {
  const text = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const data = JSON.parse(text);
  return {
    summary: clean(data?.summary, 4000),
    memories: (Array.isArray(data?.memories) ? data.memories : [])
      .map((item) => normalizeMemory(item, characterId)).filter((item) => item.summary),
    relationshipProposal: clean(data?.relationshipProposal, 300),
  };
}
