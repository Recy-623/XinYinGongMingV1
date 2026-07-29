let saveChain = Promise.resolve();

function invoke() {
  return window.__TAURI__?.core?.invoke || null;
}

export async function loadDatabaseState() {
  const call = invoke();
  if (!call) return null;
  const raw = await call("db_load_state");
  return raw ? JSON.parse(raw) : null;
}

export function queueDatabaseStateSave(state) {
  const call = invoke();
  if (!call) return Promise.resolve();
  const stateJson = JSON.stringify(state);
  saveChain = saveChain.catch(() => {}).then(() => call("db_save_state", { stateJson }));
  return saveChain;
}

export async function upsertMemories(items) {
  const call = invoke();
  if (call && items?.length) await call("db_upsert_memories", { items });
}

export async function listMemories(characterId, limit = 300) {
  const call = invoke();
  return call ? call("db_list_memories", { characterId, limit }) : [];
}

export async function markMemoriesUsed(ids) {
  const call = invoke();
  if (call && ids?.length) await call("db_mark_memories_used", { ids });
}

export async function updateMemoryLifecycle(id, status, mentionPolicy) {
  const call = invoke();
  if (call) await call("db_update_memory_lifecycle", { id, status, mentionPolicy });
}

export async function deleteMemory(id) {
  const call = invoke();
  if (call) await call("db_delete_memory", { id });
}

export async function clearMemories(characterId) {
  const call = invoke();
  if (call) await call("db_clear_memories", { characterId });
}

export async function deleteCharacterData(characterId) {
  const call = invoke();
  if (call) await call("db_delete_character_data", { characterId });
}
