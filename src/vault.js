import { invoke } from "@tauri-apps/api/core";

export async function unlockApiKey(vaultPassword) {
  return invoke("vault_load", { password: String(vaultPassword || "") });
}

export async function saveApiKey(vaultPassword, apiKey) {
  return invoke("vault_save", { password: String(vaultPassword || ""), apiKey: String(apiKey || "").trim() });
}

export async function removeApiKey(vaultPassword) {
  return invoke("vault_remove", { password: String(vaultPassword || "") });
}

export function lockVault() {
  // The decrypted key lives only in main.js memory and is discarded on app exit.
}
