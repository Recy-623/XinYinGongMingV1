import { createDefaultState, defaultAvatar, MAX_SYSTEM_PROMPT_LENGTH } from "./constants.js";
import { parseChatFile, selectRepresentativeMessages } from "./chat-import.js";
import { distillRelationship } from "./distillation.js";
import { prepareDirectorTurn } from "./director-protocol.js";
import { addOption, clear, downloadJson, element, readFileAsText, setAvatar } from "./dom.js";
import { chatWithCloud, listCloudModels, normalizeBaseUrl, testCloud } from "./providers.js";
import { loadState, readBackup, readCard, saveState, serializeBackup, serializeCard } from "./storage.js";
import { lockVault, removeApiKey, saveApiKey, unlockApiKey } from "./vault.js";

let state = createDefaultState();
let isEditMode = false;
let sessionApiKey = "";
let apiVerified = false;
let activeRequest = null;
let importSession = { parsed: null, result: null, controller: null };
let saveQueue = Promise.resolve();

const $ = (id) => document.getElementById(id);
const activeCharacter = () => state.characters.find((character) => character.id === state.activeCharacterId);
const safeFileName = (value) => value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
const selectedModel = () => $("model-select").value || $("manual-model-input").value.trim();

function save() {
  const snapshot = structuredClone(state);
  saveQueue = saveQueue.then(() => saveState(snapshot)).catch((error) => console.error("保存本地状态失败", error));
  return saveQueue;
}

function errorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error?.message?.trim()) return error.message.trim();
  return fallback;
}

function setApiStatus(message, connected = false) {
  $("api-status").textContent = message;
  const badge = $("api-connection-badge");
  badge.textContent = connected ? "已连接" : "未连接";
  badge.classList.toggle("online", connected);
  badge.classList.toggle("offline", !connected);
}

function markApiChanged() {
  apiVerified = false;
  setApiStatus("配置已更改，请重新测试 API。", false);
}

function requireCloudConsent() {
  if (!$("cloud-consent-check").checked) throw new Error("请先确认云端数据发送说明");
}

function currentApiConfig() {
  const model = selectedModel();
  if (!sessionApiKey) throw new Error("请先输入、解锁或测试 API Key");
  if (!model) throw new Error("请填写或选择模型 ID");
  return {
    mode: $("api-mode-select").value,
    baseUrl: normalizeBaseUrl($("api-url-input").value),
    apiKey: sessionApiKey,
    model,
  };
}

function persistApiFields() {
  state.globals.apiMode = $("api-mode-select").value;
  try { state.globals.cloudApiUrl = normalizeBaseUrl($("api-url-input").value); } catch { /* Save only valid URLs. */ }
  state.globals.selectedModel = selectedModel();
  save();
}

function setModelOptions(models, placeholder = "可手动填写模型 ID") {
  const select = $("model-select");
  const previous = state.globals.selectedModel;
  clear(select);
  addOption(select, "", placeholder);
  models.forEach((model) => addOption(select, model));
  if (models.includes(previous)) select.value = previous;
}

async function testCloudConnection() {
  const button = $("test-cloud-btn");
  try {
    requireCloudConsent();
    const key = $("api-key-input").value.trim() || sessionApiKey;
    const model = selectedModel();
    if (!key) throw new Error("请输入 API Key，或先解锁保险箱");
    if (!model) throw new Error("请填写或选择模型 ID");
    const mode = $("api-mode-select").value;
    const baseUrl = normalizeBaseUrl($("api-url-input").value);
    button.disabled = true;
    button.textContent = "验证中…";
    await testCloud(mode, baseUrl, key, model);
    sessionApiKey = key;
    apiVerified = true;
    state.globals.apiMode = mode;
    state.globals.cloudApiUrl = baseUrl;
    state.globals.selectedModel = model;
    await save();
    setApiStatus(`连接成功 · ${new URL(baseUrl).host} · ${model}`, true);
  } catch (error) {
    apiVerified = false;
    setApiStatus(errorMessage(error, "无法连接 API"), false);
  } finally {
    button.disabled = false;
    button.textContent = "测试 API";
  }
}

async function refreshModels() {
  const button = $("refresh-models-btn");
  try {
    requireCloudConsent();
    const key = $("api-key-input").value.trim() || sessionApiKey;
    if (!key) throw new Error("请先输入或解锁 API Key");
    const baseUrl = normalizeBaseUrl($("api-url-input").value);
    button.disabled = true;
    button.textContent = "读取中…";
    const models = await listCloudModels(baseUrl, key);
    setModelOptions(models, models.length ? "请选择模型" : "服务没有返回模型列表");
    setApiStatus(models.length ? `已读取 ${models.length} 个模型；仍需测试所选模型。` : "服务没有返回模型列表，可手动填写模型 ID。", false);
  } catch (error) {
    setApiStatus(errorMessage(error, "无法读取模型列表"), false);
  } finally {
    button.disabled = false;
    button.textContent = "读取模型列表";
  }
}

async function unlockVault() {
  const status = $("vault-status");
  try {
    status.textContent = "正在解锁…";
    sessionApiKey = (await unlockApiKey($("vault-password-input").value)).trim();
    $("api-key-input").value = "";
    $("api-key-input").placeholder = "已从加密保险箱读入当前运行内存";
    apiVerified = false;
    status.textContent = "保险箱已解锁，Key 已读入内存；请测试 API。";
    setApiStatus("密钥已解锁，请测试 API。", false);
  } catch (error) {
    sessionApiKey = "";
    lockVault();
    status.textContent = errorMessage(error, "保险箱解锁失败");
  }
}

async function saveCurrentKey() {
  const status = $("vault-status");
  try {
    const key = $("api-key-input").value.trim() || sessionApiKey;
    if (!key) throw new Error("请先输入 API Key");
    status.textContent = "正在加密保存…";
    await saveApiKey($("vault-password-input").value, key);
    sessionApiKey = key;
    $("api-key-input").value = "";
    $("api-key-input").placeholder = "Key 已加密保存并读入当前运行内存";
    status.textContent = "API Key 已加密保存；保险箱口令不会保存。";
  } catch (error) {
    status.textContent = errorMessage(error, "保存失败");
  }
}

async function forgetSavedKey() {
  if (!confirm("确认删除保险箱中保存的 API Key？本机角色和聊天不会删除。")) return;
  const status = $("vault-status");
  try {
    await removeApiKey($("vault-password-input").value);
    sessionApiKey = "";
    apiVerified = false;
    lockVault();
    $("api-key-input").placeholder = "仅在当前运行内存中使用";
    status.textContent = "已删除保险箱中的 API Key。";
    setApiStatus("密钥已删除。", false);
  } catch (error) {
    status.textContent = errorMessage(error, "删除失败；请确认保险箱口令");
  }
}

function renderCharacterSelectors() {
  const grid = $("character-selector-grid");
  const deleteButton = $("delete-character-btn");
  clear(grid);
  if (!state.characters.length) {
    deleteButton.disabled = true;
    const empty = element("div", "empty-state", "还没有角色");
    const create = element("button", "btn btn-primary", "创建第一个角色");
    create.type = "button";
    create.addEventListener("click", openCreateCharacterModal);
    empty.append(create);
    grid.append(empty);
    return;
  }
  deleteButton.disabled = !activeCharacter();
  state.characters.forEach((character) => {
    const card = element("button", `char-select-card ${character.id === state.activeCharacterId ? "selected" : ""}`);
    card.type = "button";
    const avatar = element("img");
    setAvatar(avatar, character.avatar);
    card.append(avatar, element("div", "", character.name));
    card.addEventListener("click", () => {
      state.activeCharacterId = character.id;
      save();
      renderCharacterSelectors();
    });
    grid.append(card);
  });
  const create = element("button", "char-select-card create-card", "+\n新建角色");
  create.type = "button";
  create.addEventListener("click", openCreateCharacterModal);
  grid.append(create);
}

async function deleteActiveCharacter() {
  const character = activeCharacter();
  if (!character) return;
  const historyCount = character.history?.length || 0;
  const historyNotice = historyCount ? `，以及 ${historyCount} 条本地聊天消息` : "";
  if (!confirm(`确认永久删除角色“${character.name}”${historyNotice}？\n\n此操作无法撤销。`)) return;
  const index = state.characters.findIndex((item) => item.id === character.id);
  state.characters.splice(index, 1);
  state.activeCharacterId = state.characters[Math.min(index, state.characters.length - 1)]?.id || "";
  await save();
  renderCharacterSelectors();
}

function syncChatSidebarList() {
  const list = $("sidebar-character-list");
  clear(list);
  state.characters.forEach((character) => {
    const item = element("button", `sidebar-item ${character.id === state.activeCharacterId ? "active" : ""}`);
    item.type = "button";
    const avatar = element("img");
    setAvatar(avatar, character.avatar);
    item.append(avatar, element("span", "", character.name));
    item.addEventListener("click", () => {
      state.activeCharacterId = character.id;
      save();
      syncChatSidebarList();
      loadCharacterChatDialogue();
      closeSidebar();
    });
    list.append(item);
  });
  const create = element("button", "btn btn-secondary sidebar-create", "＋ 新建角色");
  create.type = "button";
  create.addEventListener("click", openCreateCharacterModal);
  list.append(create);
}

function openSidebar() {
  $("chat-sidebar").classList.add("open");
  $("sidebar-backdrop").hidden = false;
}

function closeSidebar() {
  $("chat-sidebar").classList.remove("open");
  $("sidebar-backdrop").hidden = true;
}

function appendChatBubble(role, content) {
  const character = activeCharacter();
  const row = element("div", `msg-row ${role}`);
  const avatar = element("img", "chat-bubble-avatar");
  setAvatar(avatar, role === "user" ? state.globals.userAvatar : character?.avatar);
  const zone = element("div", "chat-bubble-content-zone");
  zone.append(element("span", "chat-bubble-name", role === "user" ? state.globals.userName : character?.name || "角色"));
  zone.append(element("div", "bubble", content));
  row.append(avatar, zone);
  $("chat-box").append(row);
  $("chat-box").scrollTop = $("chat-box").scrollHeight;
  return row;
}

function loadCharacterChatDialogue() {
  const character = activeCharacter();
  if (!character) return;
  setAvatar($("chat-partner-avatar"), character.avatar);
  $("chat-partner-name").textContent = character.name;
  $("chat-partner-status").textContent = `${state.globals.selectedModel || "未选择模型"} · API`;
  clear($("chat-box"));
  if (!character.history.length) appendChatBubble("ai", "静静地看着你，等待你的第一句话。");
  else character.history.forEach((message) => appendChatBubble(message.role === "user" ? "user" : "ai", message.content));
}

function enterChat() {
  try {
    requireCloudConsent();
    const model = selectedModel();
    if (!state.characters.length) throw new Error("请先创建或导入至少一个角色");
    if (!activeCharacter()) state.activeCharacterId = state.characters[0].id;
    if (!model) throw new Error("请先填写或选择模型 ID");
    if (!sessionApiKey || !apiVerified) throw new Error("请先测试并验证 API 连接");
    state.globals.selectedModel = model;
    persistApiFields();
    $("portal-view").classList.remove("active");
    $("chitchat-view").classList.add("active");
    syncChatSidebarList();
    loadCharacterChatDialogue();
    closeSidebar();
    if (!history.state?.xinyinChat) history.pushState({ xinyinChat: true }, "");
  } catch (error) {
    alert(errorMessage(error, "无法进入聊天"));
  }
}

function backToPortal(useHistory = true) {
  if (useHistory && history.state?.xinyinChat) {
    history.back();
    return;
  }
  activeRequest?.abort();
  closeSidebar();
  $("chitchat-view").classList.remove("active");
  $("portal-view").classList.add("active");
  renderCharacterSelectors();
}

function showModal(id) {
  $(id).classList.add("active");
  history.pushState({ xinyinModal: id, xinyinChat: $("chitchat-view").classList.contains("active") }, "");
}

function hideModal(id, useHistory = true) {
  $(id).classList.remove("active");
  if (useHistory && history.state?.xinyinModal === id) history.back();
}

function openCreateCharacterModal() {
  isEditMode = false;
  $("config-char-name").value = "";
  $("config-char-prompt").value = "";
  $("config-char-avatar-file").value = "";
  setAvatar($("config-char-avatar-preview"), defaultAvatar);
  updateSystemPromptCounter();
  showModal("config-modal");
}

function openCharacterConfigModal() {
  const character = activeCharacter();
  if (!character) return;
  isEditMode = true;
  $("config-char-name").value = character.name;
  $("config-char-prompt").value = character.systemPrompt;
  $("config-char-avatar-file").value = "";
  setAvatar($("config-char-avatar-preview"), character.avatar);
  updateSystemPromptCounter();
  showModal("config-modal");
}

function saveCharacterConfig() {
  const name = $("config-char-name").value.trim();
  const systemPrompt = $("config-char-prompt").value.trim();
  if (!name || !systemPrompt) return alert("名字和人设不能为空。");
  if (systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) return alert("System Prompt 不能超过 50,000 字符。");
  const avatar = $("config-char-avatar-preview").src;
  if (isEditMode) Object.assign(activeCharacter(), { name, systemPrompt, avatar });
  else {
    const id = `char_${crypto.randomUUID()}`;
    state.characters.push({ id, name, avatar, systemPrompt, history: [] });
    state.activeCharacterId = id;
  }
  save();
  hideModal("config-modal");
  renderCharacterSelectors();
  if ($("chitchat-view").classList.contains("active")) {
    syncChatSidebarList();
    loadCharacterChatDialogue();
  }
}

function updateSystemPromptCounter() {
  const length = $("config-char-prompt").value.length;
  $("system-prompt-counter").textContent = `${length.toLocaleString("zh-CN")} / ${MAX_SYSTEM_PROMPT_LENGTH.toLocaleString("zh-CN")}`;
}

async function optimizeAvatarSource(source, maxSide = 256) {
  if (!source?.startsWith("data:image/") || source.length < 180_000) return source;
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = source; });
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", .82);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleAvatarFileChange(event, previewId) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 1024 * 1024) return alert("请选择 1MB 以内的图片文件。");
  const result = await optimizeAvatarSource(await fileToDataUrl(file));
  setAvatar($(previewId), result);
  if (previewId === "user-global-avatar-preview") saveUserProfile();
}

function saveUserProfile() {
  state.globals.userName = $("user-global-name-input").value.trim().slice(0, 80) || "用户";
  state.globals.userAvatar = $("user-global-avatar-preview").src;
  save();
}

async function exportSingleCharacterCard() {
  const character = activeCharacter();
  if (character) await downloadJson(`${safeFileName(character.name)}-角色卡.json`, serializeCard(character));
}

async function handleSingleCardImport(event) {
  try {
    const card = readCard(JSON.parse(await readFileAsText(event.target.files[0])));
    card.id = `char_${crypto.randomUUID()}`;
    state.characters.push(card);
    state.activeCharacterId = card.id;
    await save();
    renderCharacterSelectors();
    alert(`已导入角色：${card.name}`);
  } catch (error) {
    alert(errorMessage(error, "导入失败"));
  } finally {
    event.target.value = "";
  }
}

async function exportSystemBackup() {
  await downloadJson(`心印共鸣-V4.9-备份-${new Date().toISOString().slice(0, 10)}.json`, serializeBackup(state));
}

async function handleSystemImport(event) {
  try {
    const nextState = readBackup(JSON.parse(await readFileAsText(event.target.files[0])));
    if (!confirm("导入会覆盖当前角色和聊天记录，继续吗？")) return;
    state = nextState;
    await save();
    backToPortal(false);
    alert("备份已恢复。API Key 不包含在备份中。");
  } catch (error) {
    alert(errorMessage(error, "恢复失败"));
  } finally {
    event.target.value = "";
  }
}

function clearCharacterHistory() {
  const character = activeCharacter();
  if (character && confirm(`确定清空“${character.name}”的所有聊天记录吗？`)) {
    character.history = [];
    save();
    loadCharacterChatDialogue();
  }
}

function lines(value) { return String(value || "").split(/\n/).map((item) => item.trim()).filter(Boolean); }
function listText(value) { return Array.isArray(value) ? value.filter(Boolean).join("\n") : ""; }

function resetImportWizard() {
  importSession.controller?.abort();
  importSession = { parsed: null, result: null, controller: null };
  $("relationship-chat-file").value = "";
  $("import-file-summary").textContent = "尚未选择记录";
  $("identity-fields").hidden = true;
  $("start-distill-btn").disabled = true;
  $("import-file-step").hidden = false;
  $("import-progress-step").hidden = true;
  $("import-review-step").hidden = true;
}

function openRelationshipImport() { resetImportWizard(); showModal("relationship-import-modal"); }
function closeRelationshipImport() { importSession.controller?.abort(); hideModal("relationship-import-modal"); }

function useParsedChat(parsed) {
  importSession.parsed = parsed;
  const selfSelect = $("import-self-select");
  const otherSelect = $("import-other-select");
  clear(selfSelect); clear(otherSelect);
  parsed.participants.slice(0, 20).forEach((participant) => {
    addOption(selfSelect, participant.name, `${participant.name}（${participant.count}条）`);
    addOption(otherSelect, participant.name, `${participant.name}（${participant.count}条）`);
  });
  const declaredSelf = parsed.participants.find((participant) => participant.role === "self");
  const declaredOther = parsed.participants.find((participant) => participant.role === "other");
  if (declaredSelf) selfSelect.value = declaredSelf.name;
  if (declaredOther) otherSelect.value = declaredOther.name;
  else if (parsed.participants[1]) otherSelect.value = parsed.participants[1].name;
  $("import-file-summary").textContent = `识别为 ${parsed.platform}：${parsed.messages.length} 条消息，${parsed.participants.length} 位发言者。`;
  $("identity-fields").hidden = false;
  $("start-distill-btn").disabled = parsed.participants.length < 2;
}

async function handleRelationshipFile(event) {
  try {
    useParsedChat(await parseChatFile(event.target.files[0]));
  } catch (error) {
    importSession.parsed = null;
    $("import-file-summary").textContent = errorMessage(error, "无法识别聊天记录");
    $("identity-fields").hidden = true;
    $("start-distill-btn").disabled = true;
  }
}

function fillReview(result) {
  $("review-role-name").value = result.name || $("import-other-select").value;
  $("review-personality").value = result.personality || "";
  $("review-speech-style").value = listText(result.speechStyle);
  $("review-relationship").value = result.relationshipSummary || "";
  $("review-patterns").value = listText(result.interactionPatterns);
  $("review-nicknames").value = listText(result.nicknames);
  $("review-jokes").value = listText(result.sharedJokes);
  $("review-boundaries").value = listText(result.boundaries);
  $("review-uncertainties").value = listText(result.uncertainties);
  $("review-memories").value = JSON.stringify(Array.isArray(result.memories) ? result.memories : [], null, 2);
  const source = result.sourceMetadata;
  $("review-coverage").textContent = `来源：${source.platform} · 原记录 ${source.totalMessages} 条 · 本次抽取分析 ${source.analyzedMessages} 条。原始聊天不会写入角色卡。`;
}

async function startDistillation() {
  try {
    requireCloudConsent();
    if (!apiVerified) throw new Error("请先在主界面测试 API");
    const parsed = importSession.parsed;
    const selfName = $("import-self-select").value;
    const otherName = $("import-other-select").value;
    if (!parsed || !selfName || !otherName || selfName === otherName) throw new Error("请正确选择“我”和“对方”");
    const config = currentApiConfig();
    const messages = selectRepresentativeMessages(parsed.messages, selfName, otherName, 800);
    if (messages.length < 3) throw new Error("选中的双方没有足够对话");
    const host = new URL(config.baseUrl).host;
    if (!confirm(`将向 ${host} 发送最多 ${messages.length} 条均匀抽取的聊天片段，并进行多次 API 调用。继续吗？`)) return;
    $("import-file-step").hidden = true;
    $("import-progress-step").hidden = false;
    const controller = new AbortController();
    importSession.controller = controller;
    const result = await distillRelationship({
      messages, selfName, otherName,
      source: { platform: parsed.platform, fileName: parsed.fileName, totalMessages: parsed.messages.length },
      config,
      signal: controller.signal,
      onProgress: (text) => { $("distill-progress-text").textContent = text; },
    });
    importSession.result = result;
    fillReview(result);
    $("import-progress-step").hidden = true;
    $("import-review-step").hidden = false;
  } catch (error) {
    $("import-progress-step").hidden = true;
    $("import-file-step").hidden = false;
    if (error?.name !== "AbortError") alert(`蒸馏失败：${errorMessage(error, "未知错误")}`);
  } finally {
    importSession.controller = null;
  }
}

function createDistilledRole() {
  const name = $("review-role-name").value.trim();
  const personality = $("review-personality").value.trim();
  const relationshipSummary = $("review-relationship").value.trim();
  if (!name || !personality || !relationshipSummary) return alert("姓名、稳定人格和关系摘要不能为空。");
  let memories;
  try {
    memories = JSON.parse($("review-memories").value);
    if (!Array.isArray(memories)) throw new Error();
  } catch {
    return alert("共同故事 JSON 格式不正确，请修正或填写 []。");
  }
  const id = `char_${crypto.randomUUID()}`;
  const speechStyle = lines($("review-speech-style").value);
  const interactionPatterns = lines($("review-patterns").value);
  state.characters.push({
    id, name, avatar: defaultAvatar, history: [],
    systemPrompt: `你在延续一段基于双方真实聊天证据整理出的关系。保持自然，但不得声称自己就是现实中的本人；不要编造档案之外的事实。\n稳定人格：${personality}\n语言风格：${speechStyle.join("；")}\n与用户的关系：${relationshipSummary}`,
    profile: { personality, speechStyle, boundaries: lines($("review-boundaries").value), uncertainties: lines($("review-uncertainties").value) },
    relationship: { summary: relationshipSummary, interactionPatterns, nicknames: lines($("review-nicknames").value), sharedJokes: lines($("review-jokes").value) },
    memories,
    sourceMetadata: importSession.result?.sourceMetadata || null,
  });
  state.activeCharacterId = id;
  save();
  renderCharacterSelectors();
  closeRelationshipImport();
  alert(`已创建关系角色：${name}`);
}

function relationshipContext(character, userText) {
  const profile = character?.profile || {};
  const relationship = character?.relationship || {};
  if (!character?.relationship && !character?.profile) return "";
  const terms = [...new Set([...userText.matchAll(/[\p{L}\p{N}]{2,}/gu)].map((match) => match[0]))];
  const memories = (character.memories || []).map((memory) => {
    const haystack = `${memory.title} ${memory.summary} ${memory.emotionalMeaning} ${(memory.keywords || []).join(" ")}`;
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 2 : 0), 0)
      + (memory.keywords || []).reduce((total, keyword) => total + (userText.includes(keyword) ? 3 : 0), 0);
    return { memory, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
    .map(({ memory }) => `- [${memory.time || "时间未知"}] ${memory.title}：${memory.summary}${memory.emotionalMeaning ? `（意义：${memory.emotionalMeaning}）` : ""}`);
  return `\n\n【关系档案】\n人格：${profile.personality || "未记录"}\n表达习惯：${(profile.speechStyle || []).join("；")}\n关系：${relationship.summary || "未记录"}\n相处模式：${(relationship.interactionPatterns || []).join("；")}\n共同称呼与梗：${[...(relationship.nicknames || []), ...(relationship.sharedJokes || [])].join("；")}\n边界：${(profile.boundaries || []).join("；")}\n不确定信息不得当作事实：${(profile.uncertainties || []).join("；")}\n${memories.length ? `与当前话题相关的共同记忆：\n${memories.join("\n")}` : "当前没有检索到明确相关的共同记忆。"}`;
}

async function sendChatMessage() {
  const input = $("chat-input-field");
  const content = input.value.trim();
  const character = activeCharacter();
  if (!content || !character || activeRequest) return;
  try {
    requireCloudConsent();
    if (!apiVerified) throw new Error("API 连接尚未验证");
    const config = currentApiConfig();
    input.value = "";
    input.style.height = "auto";
    character.history.push({ role: "user", content });
    save();
    appendChatBubble("user", content);
    const pendingRow = appendChatBubble("ai", "正在思考…");
    const pendingBubble = pendingRow.querySelector(".bubble");
    const controller = new AbortController();
    activeRequest = controller;
    $("chat-send-btn").disabled = true;
    $("chat-cancel-btn").hidden = false;
    const directorTurn = prepareDirectorTurn(character.history.slice(-20), content);
    const messages = [
      {
        role: "system",
        content: `${character.systemPrompt}\n当前交流的用户名字是：${state.globals.userName}。${relationshipContext(character, directorTurn.spokenText)}${directorTurn.systemSuffix}`,
      },
      ...directorTurn.modelHistory,
    ];
    try {
      const reply = await chatWithCloud(config.mode, config.baseUrl, config.apiKey, config.model, messages, controller.signal);
      pendingBubble.textContent = reply;
      character.history.push({ role: "assistant", content: reply });
      save();
    } catch (error) {
      pendingBubble.textContent = error?.name === "AbortError" ? "已取消生成。" : `请求失败：${errorMessage(error, "未知错误")}`;
    } finally {
      activeRequest = null;
      $("chat-send-btn").disabled = false;
      $("chat-cancel-btn").hidden = true;
    }
  } catch (error) {
    alert(errorMessage(error, "无法发送消息"));
  }
}

function autoGrowInput() {
  const input = $("chat-input-field");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, innerHeight * .32)}px`;
}

function bindEvents() {
  $("user-avatar-button").addEventListener("click", () => $("user-global-avatar-file").click());
  $("user-global-avatar-file").addEventListener("change", (event) => handleAvatarFileChange(event, "user-global-avatar-preview"));
  $("user-global-name-input").addEventListener("input", saveUserProfile);
  $("api-mode-select").addEventListener("change", () => { markApiChanged(); persistApiFields(); });
  $("api-url-input").addEventListener("change", () => { markApiChanged(); persistApiFields(); });
  $("api-key-input").addEventListener("input", () => { sessionApiKey = $("api-key-input").value.trim(); markApiChanged(); });
  $("manual-model-input").addEventListener("input", () => { $("model-select").value = ""; markApiChanged(); persistApiFields(); });
  $("model-select").addEventListener("change", () => { if ($("model-select").value) $("manual-model-input").value = ""; markApiChanged(); persistApiFields(); });
  $("test-cloud-btn").addEventListener("click", testCloudConnection);
  $("refresh-models-btn").addEventListener("click", refreshModels);
  $("unlock-vault-btn").addEventListener("click", unlockVault);
  $("save-key-btn").addEventListener("click", saveCurrentKey);
  $("forget-key-btn").addEventListener("click", forgetSavedKey);
  $("enter-chat-btn").addEventListener("click", enterChat);
  $("delete-character-btn").addEventListener("click", deleteActiveCharacter);
  $("back-btn").addEventListener("click", () => backToPortal(true));
  $("sidebar-open-btn").addEventListener("click", openSidebar);
  $("sidebar-close-btn").addEventListener("click", closeSidebar);
  $("sidebar-backdrop").addEventListener("click", closeSidebar);
  $("character-config-btn").addEventListener("click", openCharacterConfigModal);
  $("modal-close-btn").addEventListener("click", () => hideModal("config-modal"));
  $("modal-cancel-btn").addEventListener("click", () => hideModal("config-modal"));
  $("modal-save-btn").addEventListener("click", saveCharacterConfig);
  $("config-char-prompt").addEventListener("input", updateSystemPromptCounter);
  $("config-char-avatar-file").addEventListener("change", (event) => handleAvatarFileChange(event, "config-char-avatar-preview"));
  $("single-card-export-btn").addEventListener("click", exportSingleCharacterCard);
  $("single-card-import-btn").addEventListener("click", () => $("single-card-import-file").click());
  $("single-card-import-file").addEventListener("change", handleSingleCardImport);
  $("system-export-btn").addEventListener("click", exportSystemBackup);
  $("system-import-btn").addEventListener("click", () => $("system-import-file").click());
  $("system-import-file").addEventListener("change", handleSystemImport);
  $("clear-history-btn").addEventListener("click", clearCharacterHistory);
  $("chat-send-btn").addEventListener("click", sendChatMessage);
  $("chat-cancel-btn").addEventListener("click", () => activeRequest?.abort());
  $("chat-input-field").addEventListener("input", autoGrowInput);
  $("chat-input-field").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && matchMedia("(pointer: fine)").matches) {
      event.preventDefault();
      sendChatMessage();
    }
  });
  $("relationship-import-btn").addEventListener("click", openRelationshipImport);
  $("import-close-btn").addEventListener("click", closeRelationshipImport);
  $("relationship-chat-file").addEventListener("change", handleRelationshipFile);
  $("start-distill-btn").addEventListener("click", startDistillation);
  $("cancel-distill-btn").addEventListener("click", () => importSession.controller?.abort());
  $("create-distilled-role-btn").addEventListener("click", createDistilledRole);
  window.addEventListener("popstate", (event) => {
    document.querySelectorAll(".modal-overlay.active").forEach((modal) => modal.classList.remove("active"));
    if ($("chitchat-view").classList.contains("active") && !event.state?.xinyinChat) backToPortal(false);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  state = await loadState();
  $("user-global-name-input").value = state.globals.userName;
  setAvatar($("user-global-avatar-preview"), state.globals.userAvatar);
  $("api-mode-select").value = state.globals.apiMode;
  $("api-url-input").value = state.globals.cloudApiUrl;
  $("manual-model-input").value = state.globals.selectedModel;
  setModelOptions([], "可手动填写或读取模型列表");
  $("manual-model-input").value = state.globals.selectedModel;
  setApiStatus("请输入 API Key 或解锁保险箱，然后测试连接。", false);
  renderCharacterSelectors();
});
