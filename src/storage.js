import { BACKUP_VERSION, CARD_VERSION, createDefaultState, defaultAvatar, EXPERIENCE_MODE, LEGACY_STORAGE_KEYS, MAX_SYSTEM_PROMPT_LENGTH, STORAGE_KEY } from "./constants.js";
import { normalizeRelationshipPreset } from "./relationship-presets.js";
import { normalizeTimeline } from "./time-travel.js";

const MAX_CHARACTERS = 100;
const MAX_HISTORY_PER_CHARACTER = 500;

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeSystemPrompt(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  const looksLikeEmbeddedCard = raw.startsWith("{") || /^"systemPrompt"\s*:/.test(raw);
  if (looksLikeEmbeddedCard) {
    try {
      const embedded = JSON.parse(raw.startsWith("{") ? raw : `{${raw}`);
      const recovered = text(embedded?.systemPrompt, MAX_SYSTEM_PROMPT_LENGTH);
      if (recovered) return recovered;
    } catch {
      // Keep ordinary brace-led prompts and incomplete pasted text unchanged.
    }
  }
  return text(raw, MAX_SYSTEM_PROMPT_LENGTH);
}

export function isSafeAvatar(value) {
  if (typeof value !== "string" || value.length > 1_500_000) return false;
  return value.startsWith("data:image/") || /^https:\/\//i.test(value);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_HISTORY_PER_CHARACTER).flatMap((message) => {
    const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : null;
    const content = text(message?.content, 20_000);
    return role && content ? [{ role, content }] : [];
  });
}

function stringList(value, maxItems = 20, maxLength = 500) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => text(item, maxLength)).filter(Boolean) : [];
}

function normalizeMemories(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((memory) => {
    const title = text(memory?.title, 150);
    const summary = text(memory?.summary, 2000);
    if (!title || !summary) return [];
    return [{
      time: text(memory.time, 100), title, summary,
      emotionalMeaning: text(memory.emotionalMeaning, 1000),
      keywords: stringList(memory.keywords, 20, 80),
      confidence: Math.max(0, Math.min(1, Number(memory.confidence) || 0)),
    }];
  });
}

function normalizeRelationshipEvidence(value) {
  return {
    observedStage: text(value?.observedStage, 300),
    summary: text(value?.summary, 3000),
    confidence: Math.max(0, Math.min(1, Number(value?.confidence) || 0)),
  };
}

export function normalizeWorldbook(value) {
  if (!value || typeof value !== "object" || value.version !== "xinyin-worldbook-v1") return null;
  const id = text(value.id, 120); const title = text(value.title, 200);
  if (!id || !title) return null;
  const entries = Array.isArray(value.entries) ? value.entries.slice(0, 500).flatMap((entry) => {
    const entryId = text(entry?.id, 120); const entryTitle = text(entry?.title, 200); const content = text(entry?.content, 4000);
    if (!entryId || !entryTitle || !content) return [];
    return [{
      id: entryId, title: entryTitle, content,
      keywords: stringList(entry.keywords, 30, 80),
      aliases: stringList(entry.aliases, 30, 80),
      activation: entry.activation === "always" ? "always" : "relevant",
      importance: Math.max(0, Math.min(1, Number(entry.importance) || 0.5)),
      sourceTier: text(entry.sourceTier, 80) || "creator_defined",
      sourceRefs: stringList(entry.sourceRefs, 10, 1000),
      canonNotes: text(entry.canonNotes, 1000),
    }];
  }) : [];
  if (!entries.length) return null;
  return {
    version: "xinyin-worldbook-v1", id, title,
    description: text(value.description, 2000),
    precedence: stringList(value.precedence, 20, 500),
    characterIds: stringList(value.characterIds, 30, 120),
    entries,
  };
}

export function normalizeCharacter(value) {
  const name = text(value?.name, 80);
  const systemPrompt = normalizeSystemPrompt(value?.systemPrompt);
  if (!name || !systemPrompt) return null;
  const character = {
    experienceMode: EXPERIENCE_MODE,
    id: text(value.id, 100) || `char_${crypto.randomUUID()}`,
    name,
    avatar: isSafeAvatar(value.avatar) ? value.avatar : defaultAvatar,
    systemPrompt,
    history: normalizeHistory(value.history),
    profile: {
      personality: text(value.profile?.personality, 6000),
      speechStyle: stringList(value.profile?.speechStyle),
      boundaries: stringList(value.profile?.boundaries),
      uncertainties: stringList(value.profile?.uncertainties),
    },
    relationship: {
      summary: text(value.relationship?.summary, 6000),
      preset: normalizeRelationshipPreset(value.relationship?.preset),
      evidence: normalizeRelationshipEvidence(value.relationship?.evidence),
      interactionPatterns: stringList(value.relationship?.interactionPatterns),
      nicknames: stringList(value.relationship?.nicknames),
      sharedJokes: stringList(value.relationship?.sharedJokes),
    },
    memories: normalizeMemories(value.memories),
    worldbook: normalizeWorldbook(value.worldbook),
    worldbookRef: value.worldbookRef && typeof value.worldbookRef === "object" ? {
      id: text(value.worldbookRef.id, 120), title: text(value.worldbookRef.title, 200),
      version: text(value.worldbookRef.version, 50),
    } : null,
    contextState: {
      sceneSummary: text(value.contextState?.sceneSummary, 4000),
      lastMemoryIndex: Math.max(0, Number(value.contextState?.lastMemoryIndex) || 0),
      proposedRelationshipStage: text(value.contextState?.proposedRelationshipStage, 300),
      confirmedRelationshipStage: text(value.contextState?.confirmedRelationshipStage, 300),
      updatedAt: text(value.contextState?.updatedAt, 100),
    },
    sourceMetadata: value.sourceMetadata && typeof value.sourceMetadata === "object" ? {
      platform: text(value.sourceMetadata.platform, 50), fileName: text(value.sourceMetadata.fileName, 260),
      totalMessages: Number(value.sourceMetadata.totalMessages) || 0,
      analyzedMessages: Number(value.sourceMetadata.analyzedMessages) || 0,
      selfName: text(value.sourceMetadata.selfName, 100), otherName: text(value.sourceMetadata.otherName, 100),
      distilledAt: text(value.sourceMetadata.distilledAt, 100), sourceStart: text(value.sourceMetadata.sourceStart, 100), sourceEnd: text(value.sourceMetadata.sourceEnd, 100),
    } : null,
  };
  character.timeline = normalizeTimeline(value.timeline, character);
  return character;
}

export function normalizeState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== "object") return fallback;
  const globals = raw.globals || {};
  const characters = Array.isArray(raw.characters)
    ? raw.characters.slice(0, MAX_CHARACTERS).map(normalizeCharacter).filter(Boolean)
    : [];
  const selectedProvider = globals.selectedProvider === "openai" ? "openai" : "ollama";
  const activeCharacterId = text(raw.activeCharacterId, 100);
  return {
    version: 6,
    globals: {
      userName: text(globals.userName, 80) || fallback.globals.userName,
      userAvatar: isSafeAvatar(globals.userAvatar) ? globals.userAvatar : fallback.globals.userAvatar,
      selectedProvider,
      cloudApiUrl: text(globals.cloudApiUrl, 500),
      selectedModel: text(globals.selectedModel, 200),
    },
    characters,
    activeCharacterId: characters.some((character) => character.id === activeCharacterId)
      ? activeCharacterId
      : characters[0]?.id || "",
  };
}

export function loadState() {
  // V3 stored cloud credentials in WebView localStorage. Remove that legacy
  // plaintext value as soon as V4 starts; credentials are session-only now.
  localStorage.removeItem("xinyingongming_secure_apikey");
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch {
      // Ignore corrupt local data and start safely.
    }
  }
  return createDefaultState();
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

export function serializeBackup(state) {
  return JSON.stringify({ version: BACKUP_VERSION, exportedAt: new Date().toISOString(), state: normalizeState(state) }, null, 2);
}

export function readBackup(value) {
  if (!value || ![BACKUP_VERSION, "xinyin-backup-v5", "xinyin-backup-v4"].includes(value.version)) throw new Error("不是受支持的完整备份文件");
  return normalizeState(value.state);
}

export function serializeCard(character) {
  const normalized = normalizeCharacter(character);
  if (!normalized) throw new Error("角色数据不完整");
  const { worldbook, ...portable } = normalized;
  return JSON.stringify({
    version: CARD_VERSION, experienceMode: EXPERIENCE_MODE, ...portable,
    worldbookRef: worldbook
      ? { id: worldbook.id, title: worldbook.title, version: worldbook.version }
      : normalized.worldbookRef,
    history: [], timeline: { ...normalized.timeline, branches: [], activeBranchId: "" },
  }, null, 2);
}

export function readCard(value) {
  if (!value || ![CARD_VERSION, "xinyin-card-v5", "xinyin-card-v4", "xinyin-card-v3"].includes(value.version)) throw new Error("不是受支持的角色卡文件");
  if (value.version === CARD_VERSION && value.experienceMode && value.experienceMode !== EXPERIENCE_MODE) {
    throw new Error("这张角色卡属于短期语C模式，不能直接导入长期陪伴版本。请先导出 companion 模式角色卡。");
  }
  return normalizeCharacter({ ...value, history: [], timeline: value.timeline ? { ...value.timeline, branches: [], activeBranchId: "" } : null });
}
