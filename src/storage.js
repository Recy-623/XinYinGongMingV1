import { BACKUP_VERSION, CARD_VERSION, createDefaultState, defaultAvatar, LEGACY_STORAGE_KEY, STORAGE_KEY } from "./constants.js";

const MAX_CHARACTERS = 100;
const MAX_HISTORY_PER_CHARACTER = 500;

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

export function normalizeCharacter(value) {
  const name = text(value?.name, 80);
  const systemPrompt = text(value?.systemPrompt, 12_000);
  if (!name || !systemPrompt) return null;
  return {
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
      interactionPatterns: stringList(value.relationship?.interactionPatterns),
      nicknames: stringList(value.relationship?.nicknames),
      sharedJokes: stringList(value.relationship?.sharedJokes),
    },
    memories: normalizeMemories(value.memories),
    sourceMetadata: value.sourceMetadata && typeof value.sourceMetadata === "object" ? {
      platform: text(value.sourceMetadata.platform, 50), fileName: text(value.sourceMetadata.fileName, 260),
      totalMessages: Number(value.sourceMetadata.totalMessages) || 0,
      analyzedMessages: Number(value.sourceMetadata.analyzedMessages) || 0,
      selfName: text(value.sourceMetadata.selfName, 100), otherName: text(value.sourceMetadata.otherName, 100),
      distilledAt: text(value.sourceMetadata.distilledAt, 100),
    } : null,
  };
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
    version: 4,
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
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
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
  if (!value || value.version !== BACKUP_VERSION) throw new Error("不是受支持的完整备份文件");
  return normalizeState(value.state);
}

export function serializeCard(character) {
  const normalized = normalizeCharacter(character);
  if (!normalized) throw new Error("角色数据不完整");
  return JSON.stringify({ version: CARD_VERSION, ...normalized, history: [] }, null, 2);
}

export function readCard(value) {
  if (!value || ![CARD_VERSION, "xinyin-card-v3"].includes(value.version)) throw new Error("不是受支持的角色卡文件");
  return normalizeCharacter({ ...value, history: [] });
}
