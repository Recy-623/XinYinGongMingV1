export const STORAGE_KEY = "xinyingongming_v6_companion_state";
export const LEGACY_STORAGE_KEY = "xinyingongming_v4_state";
export const LEGACY_STORAGE_KEYS = ["xinyingongming_v5_state", "xinyingongming_v4_state", "xinyingongming_v3_core"];
export const CARD_VERSION = "xinyin-card-v6";
export const BACKUP_VERSION = "xinyin-backup-v6";
export const EXPERIENCE_MODE = "companion";
export const MAX_SYSTEM_PROMPT_LENGTH = 50_000;
export const DEFAULT_REPLY_TARGET_CHARS = 300;
export const MIN_REPLY_TARGET_CHARS = 50;
export const MAX_REPLY_TARGET_CHARS = 1_000;

export const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%239ca3af'><circle cx='50' cy='50' r='50'/><text x='50' y='60' font-size='42' fill='white' text-anchor='middle'>?</text></svg>";
export const userAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%233b82f6'><circle cx='50' cy='50' r='50'/><text x='50' y='60' font-size='42' fill='white' text-anchor='middle'>U</text></svg>";

export function createDefaultState() {
  return {
    version: 6,
    globals: {
      userName: "用户",
      userAvatar,
      selectedProvider: "ollama",
      cloudApiUrl: "",
      selectedModel: "",
      replyTargetChars: DEFAULT_REPLY_TARGET_CHARS,
    },
    characters: [],
    activeCharacterId: "",
  };
}
