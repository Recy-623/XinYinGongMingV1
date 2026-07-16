import { defaultAvatar } from "./constants.js";
import { characterFootprint, removeCharacterFromState } from "./character-management.js";
import { parseChatFile, selectRepresentativeMessages } from "./chat-import.js";
import { distillRelationship } from "./distillation.js";
import { addOption, clear, downloadJson, element, readFileAsText, setAvatar } from "./dom.js";
import { chatWithCloud, chatWithOllama, listCloudModels, listOllamaModels, normalizeBaseUrl, testCloud } from "./providers.js";
import { isCustomRelationshipPreset, normalizeRelationshipPreset, relationshipPresetForPrompt, relationshipPresetHint } from "./relationship-presets.js";
import { loadState, readBackup, readCard, saveState, serializeBackup, serializeCard } from "./storage.js";
import { activeBranch, activeHistory, BRANCH_MODES, branchSystemPrompt, checkpointForBranch, compareBranches, createBranch, displayTime, forkBranchAtTurn, normalizeTimeline, recordBranchTurn, removeBranch, renameBranch, serializeBranch, timelineFromDistillation } from "./time-travel.js";

let state = loadState();
let isEditMode = false;
let sessionApiKey = ""; // Intentionally memory-only: never written to disk or backups.
let activeRequest = null;
let importSession = { parsed: null, result: null, controller: null };
let wxCliDetected = false;

const $ = (id) => document.getElementById(id);
const save = () => saveState(state);
const activeCharacter = () => state.characters.find((character) => character.id === state.activeCharacterId);
const activeConversationHistory = (character = activeCharacter()) => activeHistory(character);
const safeFileName = (value) => value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);

function renderCharacterSelectors() {
  const grid = $("character-selector-grid");
  $("delete-character-btn").disabled = !activeCharacter();
  clear(grid);
  if (!state.characters.length) {
    const empty = element("div", "empty-state", "角色矩阵空空如也");
    const create = element("button", "btn btn-primary", "创建专属新角色");
    create.type = "button";
    create.addEventListener("click", openCreateCharacterModal);
    empty.append(create);
    grid.append(empty);
    return;
  }
  state.characters.forEach((character) => {
    const card = element("button", `char-select-card ${character.id === state.activeCharacterId ? "selected" : ""}`);
    card.type = "button";
    const avatar = element("img"); setAvatar(avatar, character.avatar);
    card.append(avatar, element("div", "", character.name));
    card.addEventListener("click", () => { state.activeCharacterId = character.id; save(); renderCharacterSelectors(); });
    grid.append(card);
  });
  const create = element("button", "char-select-card create-card", "+\n新建角色");
  create.type = "button";
  create.addEventListener("click", openCreateCharacterModal);
  grid.append(create);
}

function deleteActiveCharacter() {
  const character = activeCharacter();
  if (!character) return;
  const { canonicalMessages, branches, branchMessages } = characterFootprint(character);
  const detail = canonicalMessages || branches || branchMessages
    ? `\n该角色包含 ${canonicalMessages} 条真实现在消息、${branches} 条时间分支和 ${branchMessages} 条分支消息。`
    : "";
  if (!confirm(`确定删除角色“${character.name}”吗？${detail}\n删除后无法恢复，除非你已经导出备份。`)) return;
  removeCharacterFromState(state, character.id);
  save();
  renderCharacterSelectors();
}

function syncChatSidebarList() {
  const list = $("sidebar-character-list"); clear(list);
  state.characters.forEach((character) => {
    const item = element("button", `sidebar-item ${character.id === state.activeCharacterId ? "active" : ""}`);
    item.type = "button";
    const avatar = element("img"); setAvatar(avatar, character.avatar);
    const branch = activeBranch(character);
    item.append(avatar, element("span", "", branch ? `${character.name} · 分支` : character.name));
    item.addEventListener("click", () => { state.activeCharacterId = character.id; save(); syncChatSidebarList(); loadCharacterChatDialogue(); });
    list.append(item);
  });
  const create = element("button", "btn btn-secondary sidebar-create", "＋ 新建虚拟角色");
  create.type = "button"; create.addEventListener("click", openCreateCharacterModal); list.append(create);
}

function appendChatBubble(role, content) {
  const character = activeCharacter();
  const row = element("div", `msg-row ${role}`);
  const avatar = element("img", "chat-bubble-avatar");
  setAvatar(avatar, role === "user" ? state.globals.userAvatar : character?.avatar);
  const contentZone = element("div", "chat-bubble-content-zone");
  contentZone.append(element("span", "chat-bubble-name", role === "user" ? state.globals.userName : character?.name || "角色"));
  contentZone.append(element("div", "bubble", content));
  row.append(avatar, contentZone);
  $("chat-box").append(row); $("chat-box").scrollTop = $("chat-box").scrollHeight;
  return row;
}

function loadCharacterChatDialogue() {
  const character = activeCharacter(); if (!character) return;
  character.timeline = normalizeTimeline(character.timeline, character);
  const branch = activeBranch(character); const history = activeConversationHistory(character);
  setAvatar($("chat-partner-avatar"), character.avatar);
  $("chat-partner-name").textContent = character.name;
  $("chat-partner-status").textContent = branch
    ? `刻舟分支 · ${branch.name} · ${BRANCH_MODES[branch.mode].label}`
    : `真实现在 · 与 ${state.globals.selectedModel || "未选择模型"} 共鸣中`;
  $("timeline-mode-badge").textContent = branch ? "模拟分支，不改变现实" : "真实历史只读";
  clear($("chat-box"));
  if (!history.length) {
    if (branch) {
      const checkpoint = checkpointForBranch(character, branch);
      appendChatBubble("ai", `时间停在 ${displayTime(checkpoint?.cutoffTime || "未知时刻")}。这是一条不会改写现实的模拟分支。`);
    } else appendChatBubble("ai", "静静地看着你，等待你的第一句话。");
  } else history.forEach((message) => appendChatBubble(message.role === "user" ? "user" : "ai", message.content));
}

function setModelOptions(models, placeholder) {
  const select = $("model-select"); clear(select);
  addOption(select, "", placeholder);
  models.forEach((model) => addOption(select, model));
  if (models.includes(state.globals.selectedModel)) select.value = state.globals.selectedModel;
}

function invalidateCloudCredentials() {
  sessionApiKey = "";
  state.globals.selectedModel = "";
  save();
}

function toggleApiProviderFields() {
  const provider = $("api-provider-select").value;
  if (provider !== state.globals.selectedProvider) { state.globals.selectedModel = ""; }
  state.globals.selectedProvider = provider;
  $("cloud-api-panel").classList.toggle("hidden", provider !== "openai");
  setModelOptions([], "请刷新模型列表"); save();
}

async function refreshModels() {
  const button = $("refresh-models-btn"); button.disabled = true; button.textContent = "获取中…";
  try {
    let models = [];
    if (state.globals.selectedProvider === "ollama") models = await listOllamaModels();
    else if (sessionApiKey) models = await listCloudModels(normalizeBaseUrl($("api-url-input").value), sessionApiKey);
    else throw new Error("请先测试并验证云端连接");
    setModelOptions(models, models.length ? "请选择模型" : "未发现可用模型");
  } catch (error) {
    setModelOptions([], error.message || "无法获取模型列表");
  } finally { button.disabled = false; button.textContent = "刷新"; }
}

async function testCloudConnection() {
  const button = $("test-cloud-btn");
  try {
    const baseUrl = normalizeBaseUrl($("api-url-input").value);
    const key = $("api-key-input").value.trim();
    const model = $("manual-model-input").value.trim() || "deepseek-chat";
    if (!key) throw new Error("请输入 API Key");
    button.disabled = true; button.textContent = "验证中…";
    await testCloud(baseUrl, key, model);
    state.globals.cloudApiUrl = baseUrl; sessionApiKey = key; save();
    alert("连接成功。密钥仅在本次应用运行期间保留。");
    await refreshModels();
  } catch (error) { invalidateCloudCredentials(); alert(error.message || "无法连接云端服务"); }
  finally { button.disabled = false; button.textContent = "测试云端连接"; }
}

function enterChitChatView(event) {
  event?.preventDefault();
  try {
    const model = $("model-select")?.value || $("manual-model-input")?.value?.trim() || "";
    if (!state.characters.length) return alert("请先创建至少一个角色。");
    if (!activeCharacter()) state.activeCharacterId = state.characters[0].id;
    if (!model) return alert("请先选择或填写模型。");
    if (state.globals.selectedProvider === "openai" && !sessionApiKey) return alert("云端密钥仅在本次运行中有效，请重新测试连接。");
    state.globals.selectedModel = model; save();
    $("portal-view").classList.remove("active");
    $("chitchat-view").classList.add("active");
    syncChatSidebarList(); loadCharacterChatDialogue();
  } catch (error) {
    console.error("Unable to enter chat view", error);
    alert(`无法进入聊天：${error?.message || "界面初始化失败"}`);
  }
}

function backToPortalView() {
  $("chitchat-view").classList.remove("active"); $("portal-view").classList.add("active");
  $("user-global-name-input").value = state.globals.userName;
  setAvatar($("user-global-avatar-preview"), state.globals.userAvatar);
  $("api-provider-select").value = state.globals.selectedProvider;
  $("api-url-input").value = state.globals.cloudApiUrl;
  $("api-key-input").value = "";
  $("cloud-api-panel").classList.toggle("hidden", state.globals.selectedProvider !== "openai");
  renderCharacterSelectors();
}

function openCreateCharacterModal() {
  isEditMode = false; $("config-char-name").value = ""; $("config-char-prompt").value = "";
  setAvatar($("config-char-avatar-preview"), defaultAvatar); $("config-char-avatar-file").value = "";
  $("config-modal").classList.add("active");
}

function openCharacterConfigModal() {
  const character = activeCharacter(); if (!character) return;
  isEditMode = true; $("config-char-name").value = character.name; $("config-char-prompt").value = character.systemPrompt;
  setAvatar($("config-char-avatar-preview"), character.avatar); $("config-char-avatar-file").value = "";
  $("config-modal").classList.add("active");
}

function saveCharacterConfig() {
  const name = $("config-char-name").value.trim(); const systemPrompt = $("config-char-prompt").value.trim();
  if (!name || !systemPrompt) return alert("名字和人设不能为空。");
  const avatar = $("config-char-avatar-preview").src;
  if (isEditMode) Object.assign(activeCharacter(), { name, systemPrompt, avatar });
  else {
    const id = `char_${crypto.randomUUID()}`;
    const character = { id, name, avatar, systemPrompt, history: [], profile: {}, relationship: {}, memories: [], sourceMetadata: null };
    character.timeline = normalizeTimeline(null, character); state.characters.push(character); state.activeCharacterId = id;
  }
  save(); $("config-modal").classList.remove("active"); renderCharacterSelectors();
  if ($("chitchat-view").classList.contains("active")) { syncChatSidebarList(); loadCharacterChatDialogue(); }
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
  return canvas.toDataURL("image/webp", 0.82);
}

async function compactStoredAvatars() {
  let changed = false;
  const compact = async (value) => {
    try {
      const next = await optimizeAvatarSource(value);
      if (next !== value) changed = true;
      return next;
    } catch { return value; }
  };
  state.globals.userAvatar = await compact(state.globals.userAvatar);
  for (const character of state.characters) character.avatar = await compact(character.avatar);
  if (changed) save();
}

async function handleAvatarFileChange(event, previewId) {
  const file = event.target.files[0]; if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 1024 * 1024) return alert("请选择 1MB 以内的图片文件。");
  const result = await optimizeAvatarSource(await fileToDataUrl(file)); setAvatar($(previewId), result);
  if (previewId === "user-global-avatar-preview") saveUserGlobalProfile();
}

function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }
function saveUserGlobalProfile() { state.globals.userName = $("user-global-name-input").value.trim().slice(0, 80) || "用户"; state.globals.userAvatar = $("user-global-avatar-preview").src; save(); }

function exportSingleCharacterCard() { const character = activeCharacter(); if (character) downloadJson(`${safeFileName(character.name)}-角色卡.json`, serializeCard(character)); }
async function handleSingleCardImport(event) { try { const card = readCard(JSON.parse(await readFileAsText(event.target.files[0]))); if (!card) throw new Error("角色卡内容不完整"); card.id = `char_${crypto.randomUUID()}`; state.characters.push(card); state.activeCharacterId = card.id; save(); isEditMode = false; $("config-modal").classList.remove("active"); renderCharacterSelectors(); if ($("chitchat-view").classList.contains("active")) { syncChatSidebarList(); loadCharacterChatDialogue(); } alert(`已导入角色：${card.name}`); } catch (error) { alert(error.message || "导入失败"); } finally { event.target.value = ""; } }
function triggerSystemExport() { downloadJson(`心印共鸣-备份-${new Date().toISOString().slice(0, 10)}.json`, serializeBackup(state)); }
async function handleSystemImport(event) { try { const nextState = readBackup(JSON.parse(await readFileAsText(event.target.files[0]))); if (!confirm("导入会覆盖当前的角色与聊天记录，继续吗？")) return; state = nextState; save(); backToPortalView(); alert("备份已恢复。API Key 不会包含在备份中。"); } catch (error) { alert(error.message || "恢复失败"); } finally { event.target.value = ""; } }

function clearCharacterHistory() {
  const character = activeCharacter(); if (!character) return;
  const branch = activeBranch(character); const label = branch ? `分支“${branch.name}”` : `“${character.name}”的真实现在`;
  if (!confirm(`确定清空${label}的所有聊天记录吗？`)) return;
  if (branch) {
    branch.history = []; branch.state.turnCount = 0; branch.state.divergences = []; branch.state.newMemories = [];
    branch.state.statusSummary = "分支已清空，尚未产生新的偏离。"; branch.state.lastUpdatedAt = new Date().toISOString();
  } else character.history = [];
  save(); loadCharacterChatDialogue();
}
function cancelChatRequest() { activeRequest?.abort(); }

function lines(value) { return String(value || "").split(/\n/).map((item) => item.trim()).filter(Boolean); }
function listText(value) { return Array.isArray(value) ? value.filter(Boolean).join("\n") : ""; }

function presetFromFields(selectId, customId) {
  return normalizeRelationshipPreset({ id: $(selectId).value, customContext: $(customId).value });
}

function syncPresetFields(selectId, customFieldId, customId, noteId) {
  const preset = presetFromFields(selectId, customId);
  $(customFieldId).hidden = !isCustomRelationshipPreset(preset);
  $(noteId).textContent = relationshipPresetHint(preset);
  return preset;
}

function importRelationshipPreset() {
  return presetFromFields("relationship-preset-select", "relationship-preset-custom");
}

function reviewRelationshipPreset() {
  return presetFromFields("review-relationship-preset-select", "review-relationship-preset-custom");
}

function syncImportRelationshipPreset() {
  return syncPresetFields("relationship-preset-select", "relationship-preset-custom-field", "relationship-preset-custom", "relationship-preset-note");
}

function syncReviewRelationshipPreset() {
  return syncPresetFields("review-relationship-preset-select", "review-relationship-preset-custom-field", "review-relationship-preset-custom", "review-relationship-preset-note");
}

function validRelationshipPreset(preset) {
  if (isCustomRelationshipPreset(preset) && !preset.customContext) {
    alert("选择“自定义相处背景”时，请补充希望如何相处。");
    return false;
  }
  return true;
}

function resetImportWizard() {
  importSession.controller?.abort();
  importSession = { parsed: null, result: null, controller: null };
  $("relationship-chat-file").value = ""; $("import-file-summary").textContent = "尚未选择记录";
  $("identity-fields").hidden = true; $("relationship-preset-fields").hidden = true; $("relationship-preset-select").value = "unspecified"; $("relationship-preset-custom").value = ""; syncImportRelationshipPreset(); $("start-distill-btn").disabled = true;
  wxCliDetected = false; $("wx-consent-check").checked = false; $("wx-sessions-btn").disabled = true; $("wx-history-fields").hidden = true; $("wx-status").textContent = ""; $("qq-status").textContent = "";
  $("import-file-step").hidden = false; $("import-progress-step").hidden = true; $("import-review-step").hidden = true;
}

function openRelationshipImport() { resetImportWizard(); $("relationship-import-modal").classList.add("active"); }
function closeRelationshipImport() { importSession.controller?.abort(); $("relationship-import-modal").classList.remove("active"); }

function useParsedChat(parsed) {
  importSession.parsed = parsed;
  const selfSelect = $("import-self-select"); const otherSelect = $("import-other-select"); clear(selfSelect); clear(otherSelect);
  parsed.participants.slice(0, 20).forEach((participant) => { addOption(selfSelect, participant.name, `${participant.name}（${participant.count}条）`); addOption(otherSelect, participant.name, `${participant.name}（${participant.count}条）`); });
  const declaredSelf = parsed.participants.find((participant) => participant.role === "self");
  const declaredOther = parsed.participants.find((participant) => participant.role === "other");
  if (declaredSelf) selfSelect.value = declaredSelf.name;
  if (declaredOther) otherSelect.value = declaredOther.name;
  else if (parsed.participants[1]) otherSelect.value = parsed.participants[1].name;
  $("import-file-summary").textContent = `识别为 ${parsed.platform} 记录：${parsed.messages.length} 条消息，${parsed.participants.length} 位发言者。`;
  $("identity-fields").hidden = false; $("relationship-preset-fields").hidden = false; syncImportRelationshipPreset(); $("start-distill-btn").disabled = parsed.participants.length < 2;
}

async function handleRelationshipFile(event) {
  try { useParsedChat(await parseChatFile(event.target.files[0])); }
  catch (error) { importSession.parsed = null; $("import-file-summary").textContent = error.message || "无法识别聊天记录"; $("identity-fields").hidden = true; $("start-distill-btn").disabled = true; }
}

async function invokeWx(command, args = {}) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error("微信本机连接器只能在已安装的桌面应用中使用。");
  return invoke(command, args);
}

function errorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return fallback;
}

function refreshWxSessionButton() {
  $("wx-sessions-btn").disabled = !wxCliDetected || !$("wx-consent-check").checked;
}

async function detectWxCli() {
  const status = $("wx-status"); status.textContent = "正在检测已安装的 wx-cli…";
  try { const path = await invokeWx("detect_wx_cli"); wxCliDetected = true; status.textContent = `已检测到受支持的 EXE：${String(path).trim()}`; refreshWxSessionButton(); }
  catch (error) { wxCliDetected = false; refreshWxSessionButton(); status.textContent = errorMessage(error, "未检测到 wx-cli。"); }
}

function sessionItems(payload) {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload; const list = Array.isArray(data) ? data : data?.results || data?.sessions || data?.data || [];
  return Array.isArray(list) ? list.map((item) => {
    const name = String(item.display || item.display_name || item.name || item.session_name || item.contact_display || item.nickname || item.username || "").trim();
    const label = String(item.display || item.display_name || item.contact_display || item.name || item.session_name || item.username || name).trim();
    return name ? { name, label, chatType: item.chat_type || "" } : null;
  }).filter(Boolean) : [];
}

async function loadWxSessions() {
  if (!$("wx-consent-check").checked) return alert("请先确认授权声明。");
  const status = $("wx-status"); status.textContent = "正在读取 wx-cli 的会话列表…";
  try {
    const sessions = sessionItems(await invokeWx("wx_sessions")); if (!sessions.length) throw new Error("没有读取到可用会话。请先在 wx-cli 中完成初始化。");
    const select = $("wx-session-select"); clear(select); sessions.filter((item) => item.chatType !== "official_account" && item.chatType !== "folded").forEach((item) => addOption(select, item.name, `${item.label}${item.chatType ? `（${item.chatType}）` : ""}`));
    if (!select.options.length) throw new Error("没有可导入的个人或群聊会话。");
    $("wx-history-fields").hidden = false; status.textContent = `已读取 ${select.options.length} 个可导入会话。`;
  } catch (error) { status.textContent = errorMessage(error, "读取会话失败。"); }
}

async function importWxHistory() {
  if (!$("wx-consent-check").checked) return alert("请先确认授权声明。");
  const session = $("wx-session-select").value; const limit = Number($("wx-limit-input").value);
  const status = $("wx-status"); status.textContent = "正在读取指定会话，不会在心印共鸣中保存原始记录…";
  try {
    const result = await invokeWx("wx_history", { session, since: $("wx-since-input").value || null, until: $("wx-until-input").value || null, limit });
    const json = JSON.stringify(result); const parsed = await parseChatFile({ name: `微信-${session}.json`, size: new Blob([json]).size, text: async () => json }); parsed.platform = "微信（wx-cli 本机连接器）"; useParsedChat(parsed); status.textContent = "会话读取完成，请确认双方身份后开始蒸馏。";
  } catch (error) { status.textContent = errorMessage(error, "读取聊天记录失败。"); }
}

async function detectQqExporter() {
  const status = $("qq-status"); status.textContent = "正在检测本机回环服务…";
  try { const running = await invokeWx("detect_qq_exporter"); status.textContent = running ? "检测到 qq-chat-exporter，可在其本机页面完成导出后选择 JSON。" : "未检测到 127.0.0.1:40653 上的 QQ 导出器。仍可直接选择已导出的文件。"; }
  catch (error) { status.textContent = error.message || "检测失败。"; }
}

function fillReview(result) {
  const preset = normalizeRelationshipPreset(result.relationshipPreset);
  const evidence = result.relationshipEvidence && typeof result.relationshipEvidence === "object" ? result.relationshipEvidence : {};
  $("review-role-name").value = result.name || $("import-other-select").value;
  $("review-personality").value = result.personality || ""; $("review-speech-style").value = listText(result.speechStyle);
  $("review-relationship").value = result.relationshipSummary || ""; $("review-patterns").value = listText(result.interactionPatterns);
  $("review-evidence-stage").value = typeof evidence.observedStage === "string" ? evidence.observedStage : "";
  $("review-evidence-summary").value = typeof evidence.summary === "string" ? evidence.summary : "";
  $("review-evidence-confidence").value = String(Math.max(0, Math.min(1, Number(evidence.confidence) || 0)));
  $("review-relationship-preset-select").value = preset.id; $("review-relationship-preset-custom").value = preset.customContext; syncReviewRelationshipPreset();
  $("review-nicknames").value = listText(result.nicknames); $("review-jokes").value = listText(result.sharedJokes);
  $("review-boundaries").value = listText(result.boundaries); $("review-uncertainties").value = listText(result.uncertainties);
  $("review-memories").value = JSON.stringify(Array.isArray(result.memories) ? result.memories : [], null, 2);
  $("review-timeline-checkpoints").value = JSON.stringify(Array.isArray(result.timelineCheckpoints) ? result.timelineCheckpoints : [], null, 2);
  const source = result.sourceMetadata;
  const checkpointCount = Array.isArray(result.timelineCheckpoints) ? result.timelineCheckpoints.length : 0;
  $("review-coverage").textContent = `来源：${source.platform} · 原记录 ${source.totalMessages} 条 · 本次均匀抽取分析 ${source.analyzedMessages} 条 · 历史锚点 ${checkpointCount} 个。原始聊天不会保存到角色卡。${result.timelineWarning ? `\n警告：${result.timelineWarning}` : ""}`;
}

async function startDistillation() {
  const parsed = importSession.parsed; const selfName = $("import-self-select").value; const otherName = $("import-other-select").value;
  if (!parsed || !selfName || !otherName || selfName === otherName) return alert("请正确选择“我”和“对方”。");
  const relationshipPreset = importRelationshipPreset();
  if (!validRelationshipPreset(relationshipPreset)) return;
  const model = $("model-select").value || $("manual-model-input").value.trim();
  if (!model) return alert("请先在主界面选择或填写用于蒸馏的模型。");
  if (state.globals.selectedProvider === "openai" && !sessionApiKey) return alert("请先测试云端连接。为了隐私，建议优先使用本地 Ollama。 ");
  // Large local models are commonly constrained by VRAM. A uniformly sampled
  // 800-message pass keeps the full timeline represented while avoiding a
  // very long 16-call first run on 30B+ models.
  const largeLocalModel = state.globals.selectedProvider === "ollama" && /(?:^|[:_-])(?:30|32|34|40)b(?:$|[:_-])/i.test(model);
  const messages = selectRepresentativeMessages(parsed.messages, selfName, otherName, largeLocalModel ? 800 : 1600);
  if (messages.length < 3) return alert("选中的双方没有足够对话。");
  $("import-file-step").hidden = true; $("import-progress-step").hidden = false;
  const controller = new AbortController(); importSession.controller = controller;
  try {
    const result = await distillRelationship({ messages, selfName, otherName, relationshipPreset, source: { platform: parsed.platform, fileName: parsed.fileName, totalMessages: parsed.messages.length }, config: { provider: state.globals.selectedProvider, model, baseUrl: state.globals.cloudApiUrl, apiKey: sessionApiKey }, signal: controller.signal, onProgress: (text) => { $("distill-progress-text").textContent = text; } });
    importSession.result = result; fillReview(result); $("import-progress-step").hidden = true; $("import-review-step").hidden = false;
  } catch (error) { $("import-progress-step").hidden = true; $("import-file-step").hidden = false; if (error.name !== "AbortError") alert(`蒸馏失败：${error.message || "未知错误"}`); }
  finally { importSession.controller = null; }
}

function createDistilledRole() {
  const name = $("review-role-name").value.trim(); const personality = $("review-personality").value.trim(); const relationshipSummary = $("review-relationship").value.trim();
  if (!name || !personality || !relationshipSummary) return alert("姓名、稳定人格和关系摘要不能为空。");
  const relationshipPreset = reviewRelationshipPreset();
  if (!validRelationshipPreset(relationshipPreset)) return;
  let memories; try { memories = JSON.parse($("review-memories").value); if (!Array.isArray(memories)) throw new Error(); } catch { return alert("共同故事 JSON 格式不正确，请修正或填写 []。"); }
  let timelineCheckpoints; try { timelineCheckpoints = JSON.parse($("review-timeline-checkpoints").value); if (!Array.isArray(timelineCheckpoints)) throw new Error(); } catch { return alert("历史锚点 JSON 格式不正确，请修正或填写 []。"); }
  const id = `char_${crypto.randomUUID()}`;
  const speechStyle = lines($("review-speech-style").value); const interactionPatterns = lines($("review-patterns").value);
  const relationshipEvidence = {
    observedStage: $("review-evidence-stage").value.trim(),
    summary: $("review-evidence-summary").value.trim(),
    confidence: Math.max(0, Math.min(1, Number($("review-evidence-confidence").value) || 0)),
  };
  const distillationResult = { ...(importSession.result || {}), name, personality, speechStyle, relationshipSummary, relationshipEvidence, interactionPatterns, memories, timelineCheckpoints,
    nicknames: lines($("review-nicknames").value), sharedJokes: lines($("review-jokes").value), boundaries: lines($("review-boundaries").value), uncertainties: lines($("review-uncertainties").value) };
  const character = { id, name, avatar: defaultAvatar, history: [],
    systemPrompt: `你正在延续一段基于双方真实聊天记录整理出的关系。请保持自然，不声称自己是现实中的本人，也不要编造档案之外的事实。\n稳定人格：${personality}\n语言风格：${speechStyle.join("；")}\n聊天记录可证实的关系：${relationshipSummary}\n证据阶段：${relationshipEvidence.observedStage || "未记录"}\n证据摘要：${relationshipEvidence.summary || "未记录"}\n\n【相处预设（用户偏好，不是现实事实）】\n${relationshipPresetForPrompt(relationshipPreset)}`,
    profile: { personality, speechStyle, boundaries: distillationResult.boundaries, uncertainties: distillationResult.uncertainties },
    relationship: { summary: relationshipSummary, preset: relationshipPreset, evidence: relationshipEvidence, interactionPatterns, nicknames: distillationResult.nicknames, sharedJokes: distillationResult.sharedJokes },
    memories, sourceMetadata: importSession.result?.sourceMetadata || null,
  };
  character.timeline = timelineFromDistillation(distillationResult); state.characters.push(character);
  state.activeCharacterId = id; save(); renderCharacterSelectors(); closeRelationshipImport(); alert(`已创建关系角色：${name}`);
}

function syncCheckpointDescription() {
  const character = activeCharacter(); const checkpoint = character?.timeline?.checkpoints?.find((item) => item.id === $("time-checkpoint-select").value);
  if (!checkpoint) { $("time-checkpoint-description").textContent = "没有可用时间锚点。"; return; }
  const reliability = checkpoint.historical ? `置信度 ${Math.round(checkpoint.confidence * 100)}%` : "仅为旧版最终状态，禁止历史分支";
  $("time-checkpoint-description").textContent = `${displayTime(checkpoint.cutoffTime)} · ${checkpoint.anchor.side === "before" ? "消息之前" : "消息之后"} · ${reliability}\n${checkpoint.summary || checkpoint.anchor.summary || "没有补充摘要"}`;
}

function renderBranchList() {
  const character = activeCharacter(); const list = $("time-branch-list"); clear(list);
  const branches = character?.timeline?.branches || [];
  if (!branches.length) { list.append(element("p", "branch-empty", "还没有平行分支。真实历史不会被修改。")); syncBranchTools(); return; }
  branches.forEach((branch) => {
    const checkpoint = checkpointForBranch(character, branch);
    const item = element("article", `branch-list-item ${character.timeline.activeBranchId === branch.id ? "active" : ""}`);
    const info = element("div", "branch-list-info");
    info.append(element("strong", "", branch.name), element("small", "", `${BRANCH_MODES[branch.mode].label} · ${displayTime(checkpoint?.cutoffTime || "未知时刻")} · ${branch.state.turnCount}轮`), element("p", "", branch.state.statusSummary));
    const actions = element("div", "branch-list-actions");
    const enter = element("button", "btn btn-secondary", character.timeline.activeBranchId === branch.id ? "正在使用" : "进入"); enter.type = "button"; enter.disabled = character.timeline.activeBranchId === branch.id;
    enter.addEventListener("click", () => { character.timeline.activeBranchId = branch.id; save(); $("time-travel-modal").classList.remove("active"); syncChatSidebarList(); loadCharacterChatDialogue(); });
    const rename = element("button", "btn btn-secondary", "重命名"); rename.type = "button";
    rename.addEventListener("click", () => {
      const nextName = prompt("新的分支名称", branch.name);
      if (nextName === null) return;
      try { renameBranch(character.timeline, branch.id, nextName); save(); renderBranchList(); syncChatSidebarList(); }
      catch (error) { alert(error.message || "无法重命名分支"); }
    });
    const exportButton = element("button", "btn btn-secondary", "导出"); exportButton.type = "button";
    exportButton.addEventListener("click", () => {
      try { downloadJson(`${safeFileName(character.name)}-${safeFileName(branch.name)}-模拟分支.json`, serializeBranch(character, branch.id)); }
      catch (error) { alert(error.message || "无法导出分支"); }
    });
    const remove = element("button", "btn btn-danger", "删除"); remove.type = "button";
    remove.addEventListener("click", () => { if (!confirm(`删除分支“${branch.name}”及其独立聊天记录？真实历史不会受影响。`)) return; removeBranch(character.timeline, branch.id); save(); renderBranchList(); syncChatSidebarList(); loadCharacterChatDialogue(); });
    actions.append(enter, rename, exportButton, remove); item.append(info, actions); list.append(item);
  });
  syncBranchTools();
}

function fillBranchSelect(select, branches, selectedId = "") {
  clear(select);
  branches.forEach((branch) => addOption(select, branch.id, `${branch.name}（${branch.state.turnCount}轮）`));
  if (branches.some((branch) => branch.id === selectedId)) select.value = selectedId;
}

function syncForkTurnLimit() {
  const character = activeCharacter();
  const source = character?.timeline?.branches?.find((branch) => branch.id === $("time-fork-source").value);
  const input = $("time-fork-turn");
  const max = source?.state?.turnCount || 0;
  input.max = String(max);
  input.value = String(Math.min(Math.max(0, Number(input.value) || 0), max));
  $("time-fork-hint").textContent = source
    ? `保留前 0–${max} 轮；新分支会继承此前对话，下一次输入形成新的选择。`
    : "请先创建一条分支。";
}

function syncBranchTools() {
  const character = activeCharacter(); const branches = character?.timeline?.branches || [];
  $("time-branch-tools").hidden = !branches.length;
  if (!branches.length) { $("time-compare-result").textContent = ""; return; }
  const activeId = character.timeline.activeBranchId || branches[0].id;
  fillBranchSelect($("time-fork-source"), branches, $("time-fork-source").value || activeId);
  fillBranchSelect($("time-compare-a"), branches, $("time-compare-a").value || branches[0].id);
  fillBranchSelect($("time-compare-b"), branches, $("time-compare-b").value || branches[1]?.id || branches[0].id);
  $("compare-time-branches-btn").disabled = branches.length < 2;
  syncForkTurnLimit();
}

function openTimeTravelModal() {
  const character = activeCharacter(); if (!character) return;
  character.timeline = normalizeTimeline(character.timeline, character);
  const select = $("time-checkpoint-select"); clear(select);
  character.timeline.checkpoints.forEach((checkpoint) => {
    const option = document.createElement("option"); option.value = checkpoint.id;
    option.textContent = `${displayTime(checkpoint.cutoffTime)} · ${checkpoint.title}${checkpoint.historical ? "" : "（旧版当前状态）"}`;
    select.append(option);
  });
  $("time-branch-name").value = ""; $("time-branch-mode").value = "constrained";
  syncCheckpointDescription(); renderBranchList(); $("time-travel-modal").classList.add("active");
}

function createTimeBranch() {
  const character = activeCharacter(); if (!character) return;
  try {
    const branch = createBranch(character.timeline, $("time-checkpoint-select").value, $("time-branch-mode").value, $("time-branch-name").value);
    save(); renderBranchList(); syncChatSidebarList(); loadCharacterChatDialogue();
    $("time-branch-name").value = ""; alert(`已创建分支：${branch.name}。角色只能读取锚点当时的切片。`);
  } catch (error) { alert(error.message || "无法创建时间分支"); }
}

function returnToRealTimeline() {
  const character = activeCharacter(); if (!character) return;
  character.timeline.activeBranchId = ""; save(); $("time-travel-modal").classList.remove("active"); syncChatSidebarList(); loadCharacterChatDialogue();
}

function forkSelectedBranch() {
  const character = activeCharacter(); if (!character) return;
  try {
    const branch = forkBranchAtTurn(character.timeline, $("time-fork-source").value, $("time-fork-turn").value, $("time-fork-name").value);
    $("time-fork-name").value = ""; save(); renderBranchList(); syncChatSidebarList(); loadCharacterChatDialogue();
    alert(`已派生分支：${branch.name}。下一条消息将成为新的选择。`);
  } catch (error) { alert(error.message || "无法派生分支"); }
}

function compareSelectedBranches() {
  const character = activeCharacter(); if (!character) return;
  try {
    const result = compareBranches(character.timeline, $("time-compare-a").value, $("time-compare-b").value);
    $("time-compare-result").textContent = `共同前缀：${result.commonMessages} 条消息\n同一历史锚点：${result.sameCheckpoint ? "是" : "否"}\n\n${result.first.name}（${BRANCH_MODES[result.first.mode].label}，${result.first.turnCount}轮）\n首次不同选择：${result.first.firstDifferentChoice}\n\n${result.second.name}（${BRANCH_MODES[result.second.mode].label}，${result.second.turnCount}轮）\n首次不同选择：${result.second.firstDifferentChoice}`;
  } catch (error) { $("time-compare-result").textContent = error.message || "无法比较分支"; }
}

function relationshipContext(character, userText) {
  if (!character?.relationship && !character?.profile) return "";
  const profile = character.profile || {}; const relationship = character.relationship || {};
  const relationshipEvidence = relationship.evidence || {};
  const terms = [...new Set([...userText.matchAll(/[\p{L}\p{N}]{2,}/gu)].map((match) => match[0]))];
  const ranked = (character.memories || []).map((memory) => {
    const haystack = `${memory.title} ${memory.summary} ${memory.emotionalMeaning} ${(memory.keywords || []).join(" ")}`;
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 2 : 0), 0) + (memory.keywords || []).reduce((total, keyword) => total + (userText.includes(keyword) ? 3 : 0), 0);
    return { memory, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(({ memory }) => `- [${memory.time || "时间未知"}] ${memory.title}：${memory.summary}${memory.emotionalMeaning ? `（意义：${memory.emotionalMeaning}）` : ""}`);
  return `\n\n【关系档案】\n人格：${profile.personality || "未记录"}\n表达习惯：${(profile.speechStyle || []).join("；")}\n聊天证实的关系：${relationship.summary || "未记录"}\n证据阶段：${relationshipEvidence.observedStage || "未记录"}\n证据摘要：${relationshipEvidence.summary || "未记录"}\n相处预设（用户偏好，非现实事实）：\n${relationshipPresetForPrompt(relationship.preset)}\n相处模式：${(relationship.interactionPatterns || []).join("；")}\n共同称呼与梗：${[...(relationship.nicknames || []), ...(relationship.sharedJokes || [])].join("；")}\n边界：${(profile.boundaries || []).join("；")}\n不确定信息不得当作事实：${(profile.uncertainties || []).join("；")}\n${ranked.length ? `与当前话题相关的共同记忆：\n${ranked.join("\n")}` : "当前没有检索到明确相关的共同记忆。"}`;
}

async function sendChitChatMessage() {
  const input = $("chat-input-field"); const content = input.value.trim(); const character = activeCharacter();
  if (!content || !character || activeRequest) return;
  const branch = activeBranch(character); const history = activeConversationHistory(character);
  input.value = ""; history.push({ role: "user", content }); if (branch) recordBranchTurn(branch); save(); appendChatBubble("user", content);
  const pendingRow = appendChatBubble("ai", "正在思考…"); const pendingBubble = pendingRow.querySelector(".bubble");
  const controller = new AbortController(); activeRequest = controller; $("chat-send-btn").disabled = true; $("chat-cancel-btn").hidden = false;
  const systemPrompt = branch
    ? branchSystemPrompt(character, branch, state.globals.userName)
    : `${character.systemPrompt}\n当前交流的用户名字是：${state.globals.userName}。${relationshipContext(character, content)}`;
  const messages = [{ role: "system", content: systemPrompt }, ...history.slice(branch ? -30 : -20)];
  try {
    const reply = state.globals.selectedProvider === "ollama"
      ? await chatWithOllama(state.globals.selectedModel, messages, controller.signal)
      : await chatWithCloud(state.globals.cloudApiUrl, sessionApiKey, state.globals.selectedModel, messages, controller.signal);
    pendingBubble.textContent = reply; history.push({ role: "assistant", content: reply }); if (branch) recordBranchTurn(branch); save();
  } catch (error) { pendingBubble.textContent = error.name === "AbortError" ? "已取消生成。" : `请求失败：${error.message || "未知错误"}`; }
  finally { activeRequest = null; $("chat-send-btn").disabled = false; $("chat-cancel-btn").hidden = true; }
}

function bindEvents() {
  $("user-global-avatar-preview").addEventListener("click", () => $("user-global-avatar-file").click());
  $("user-global-avatar-file").addEventListener("change", (event) => handleAvatarFileChange(event, "user-global-avatar-preview"));
  $("user-global-name-input").addEventListener("input", saveUserGlobalProfile);
  $("api-provider-select").addEventListener("change", toggleApiProviderFields);
  $("test-cloud-btn").addEventListener("click", testCloudConnection); $("refresh-models-btn").addEventListener("click", refreshModels);
  $("delete-character-btn").addEventListener("click", deleteActiveCharacter);
  // Use a capture listener for this primary navigation action. WebView2 can
  // occasionally retain a focused button while its direct listener is stale
  // after a long-running modal or model refresh.
  document.addEventListener("click", (event) => {
    if (event.target.closest?.("#enter-chat-btn")) enterChitChatView(event);
  }, true);
  $("back-btn").addEventListener("click", backToPortalView);
  $("character-config-btn").addEventListener("click", openCharacterConfigModal); $("modal-close-btn").addEventListener("click", () => $("config-modal").classList.remove("active")); $("modal-cancel-btn").addEventListener("click", () => $("config-modal").classList.remove("active")); $("modal-save-btn").addEventListener("click", saveCharacterConfig);
  $("config-char-avatar-file").addEventListener("change", (event) => handleAvatarFileChange(event, "config-char-avatar-preview"));
  $("single-card-export-btn").addEventListener("click", exportSingleCharacterCard); $("single-card-import-btn").addEventListener("click", () => $("single-card-import-file").click()); $("single-card-import-file").addEventListener("change", handleSingleCardImport);
  $("system-export-btn").addEventListener("click", triggerSystemExport); $("system-import-btn").addEventListener("click", () => $("system-import-file").click()); $("system-import-file").addEventListener("change", handleSystemImport);
  $("clear-history-btn").addEventListener("click", clearCharacterHistory); $("chat-send-btn").addEventListener("click", sendChitChatMessage); $("chat-cancel-btn").addEventListener("click", cancelChatRequest);
  $("time-travel-btn").addEventListener("click", openTimeTravelModal); $("time-travel-close-btn").addEventListener("click", () => $("time-travel-modal").classList.remove("active"));
  $("time-checkpoint-select").addEventListener("change", syncCheckpointDescription); $("create-time-branch-btn").addEventListener("click", createTimeBranch); $("return-real-timeline-btn").addEventListener("click", returnToRealTimeline);
  $("time-fork-source").addEventListener("change", syncForkTurnLimit); $("fork-time-branch-btn").addEventListener("click", forkSelectedBranch); $("compare-time-branches-btn").addEventListener("click", compareSelectedBranches);
  $("chat-input-field").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendChitChatMessage(); } });
  $("relationship-import-btn").addEventListener("click", openRelationshipImport); $("import-close-btn").addEventListener("click", closeRelationshipImport);
  $("relationship-chat-file").addEventListener("change", handleRelationshipFile); $("start-distill-btn").addEventListener("click", startDistillation);
  $("cancel-distill-btn").addEventListener("click", () => importSession.controller?.abort()); $("create-distilled-role-btn").addEventListener("click", createDistilledRole);
  $("relationship-preset-select").addEventListener("change", syncImportRelationshipPreset); $("review-relationship-preset-select").addEventListener("change", syncReviewRelationshipPreset);
  $("wx-consent-check").addEventListener("change", refreshWxSessionButton);
  $("wx-detect-btn").addEventListener("click", detectWxCli); $("wx-sessions-btn").addEventListener("click", loadWxSessions); $("wx-history-btn").addEventListener("click", importWxHistory);
  $("qq-detect-btn").addEventListener("click", detectQqExporter); $("qq-select-export-btn").addEventListener("click", () => $("relationship-chat-file").click());
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await compactStoredAvatars();
  $("user-global-name-input").value = state.globals.userName;
  setAvatar($("user-global-avatar-preview"), state.globals.userAvatar);
  $("api-provider-select").value = state.globals.selectedProvider;
  $("api-url-input").value = state.globals.cloudApiUrl;
  $("cloud-api-panel").classList.toggle("hidden", state.globals.selectedProvider !== "openai");
  renderCharacterSelectors(); refreshModels();
});
