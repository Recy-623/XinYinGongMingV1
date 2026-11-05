export const STORAGE_KEY = "xinyingongming_v49_state";
export const V4_STORAGE_KEY = "xinyingongming_v4_state";
export const LEGACY_STORAGE_KEY = "xinyingongming_v3_core";
export const CARD_VERSION = "xinyin-card-v4";
export const BACKUP_VERSION = "xinyin-backup-v4.9";
export const MAX_SYSTEM_PROMPT_LENGTH = 50_000;

export const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%239ca3af'><circle cx='50' cy='50' r='50'/><text x='50' y='60' font-size='42' fill='white' text-anchor='middle'>?</text></svg>";
export const userAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%233b82f6'><circle cx='50' cy='50' r='50'/><text x='50' y='60' font-size='42' fill='white' text-anchor='middle'>U</text></svg>";

export function createDefaultState() {
  return {
    version: 4.9,
    globals: {
      userName: "用户",
      userAvatar,
      apiMode: "openai-responses",
      cloudApiUrl: "https://api.openai.com/v1",
      selectedModel: "",
    },
    characters: [],
    activeCharacterId: "",
  };
}
