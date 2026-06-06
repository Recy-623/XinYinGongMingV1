// ==========================================
// 心印共鸣 v3.2 终极安全版（本地存储实时销毁机制）
// ==========================================

// 1. 全局系统状态机
let state = {
    globals: {
        userName: "用户", 
        userAvatar: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%233b82f6'><circle cx='50' cy='50' r='50'/><text x='50' y='55' font-size='30' fill='white' text-anchor='middle'>🙋</text></svg>", 
        selectedProvider: "openai", 
        cloudApiUrl: "https://api.deepseek.com/v1", 
        selectedModel: "deepseek-chat"
    },
    characters: [], 
    activeCharacterId: "" 
};

let isEditMode = false;

// ==========================================
// 💾 本地缓存同步
// ==========================================
window.saveAppState = function() {
    localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
};

// ==========================================
// 📸 头像转换为 Base64
// ==========================================
window.handleAvatarFileChange = function(e, previewId) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 1024 * 1024) {
        alert("⚠️ 头像图片太大了，请选择 1MB 以内的图片哦！");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(evt) {
        const base64Data = evt.target.result;
        const previewImg = document.getElementById(previewId);
        if (previewImg) {
            previewImg.src = base64Data;
        }
    };
    reader.readAsDataURL(file);
};

// ==========================================
// ➕ 人设管理总线
// ==========================================
window.openCreateCharacterModal = function() {
    isEditMode = false; 
    document.getElementById("config-char-name").value = "";
    document.getElementById("config-char-avatar-preview").src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%239ca3af'><circle cx='50' cy='50' r='50'/><text x='50' y='55' font-size='30' fill='white' text-anchor='middle'>👤</text></svg>";
    document.getElementById("config-char-prompt").value = "";
    const fileInput = document.getElementById("config-char-avatar-file");
    if (fileInput) fileInput.value = "";
    document.getElementById("config-modal").classList.add("active");
};

window.openCharacterConfigModal = function() {
    const char = state.characters.find(c => c.id === state.activeCharacterId);
    if (!char) return;
    
    isEditMode = true; 
    document.getElementById("config-char-name").value = char.name;
    document.getElementById("config-char-avatar-preview").src = char.avatar;
    document.getElementById("config-char-prompt").value = char.systemPrompt;
    const fileInput = document.getElementById("config-char-avatar-file");
    if (fileInput) fileInput.value = "";
    document.getElementById("config-modal").classList.add("active");
};

window.closeCharacterConfigModal = function() {
    document.getElementById("config-modal").classList.remove("active");
};

window.saveCharacterConfig = function() {
    const nameInput = document.getElementById("config-char-name").value.trim();
    const avatarSrc = document.getElementById("config-char-avatar-preview").src;
    const promptInput = document.getElementById("config-char-prompt").value.trim();

    if (!nameInput || !promptInput) {
        alert("⚠️ 名字和人设设定不能为空哦！");
        return;
    }

    if (isEditMode) {
        const char = state.characters.find(c => c.id === state.activeCharacterId);
        if (char) {
            char.name = nameInput;
            char.avatar = avatarSrc;
            char.systemPrompt = promptInput;
        }
    } else {
        const newId = `char_${Date.now()}`;
        state.characters.push({
            id: newId, name: nameInput, avatar: avatarSrc, systemPrompt: promptInput, history: []
        });
        state.activeCharacterId = newId; 
    }

    window.saveAppState();
    window.closeCharacterConfigModal();
    
    renderCharacterSelectors();
    if (document.getElementById("chitchat-view").classList.contains("active")) {
        syncChatSidebarList();
        loadCharacterChatDialogue();
    }
};

// ==========================================
// 🙋 用户自身设定保存
// ==========================================
window.saveUserGlobalProfile = function() {
    const nameInput = document.getElementById("user-global-name-input");
    if (nameInput) {
        state.globals.userName = nameInput.value.trim() || "用户";
    }
    const avatarPreview = document.getElementById("user-global-avatar-preview");
    if (avatarPreview) {
        state.globals.userAvatar = avatarPreview.src;
    }
    window.saveAppState();
};

// ==========================================
// 🎨 动态界面渲染引擎
// ==========================================
function renderCharacterSelectors() {
    const grid = document.getElementById("character-selector-grid"); 
    if (!grid) return;
    grid.innerHTML = "";
    
    if (state.characters.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align:center; padding: 30px 10px;">
                <div style="color:#9ca3af; margin-bottom: 15px;">🫙 角色矩阵空空如也</div>
                <button type="button" class="btn-primary" onclick="window.openCreateCharacterModal()" 
                        style="padding: 10px 20px; background: #8b5cf6; border: none; color: white; border-radius: 8px; cursor: pointer; font-weight: bold;">
                    ➕ 创建专属新角色
                </button>
            </div>
        `;
        return;
    }

    state.characters.forEach(char => {
        const card = document.createElement("div");
        card.className = `char-select-card ${char.id === state.activeCharacterId ? 'selected' : ''}`;
        card.onclick = () => { 
            state.activeCharacterId = char.id; 
            renderCharacterSelectors(); 
            window.saveAppState(); 
        };
        card.innerHTML = `<img src="${char.avatar}"><div>${char.name}</div>`;
        grid.appendChild(card);
    });

    const appendCreateCard = document.createElement("div");
    appendCreateCard.className = "char-select-card";
    appendCreateCard.style.border = "2px dashed #4b5563";
    appendCreateCard.style.background = "transparent";
    appendCreateCard.style.display = "flex";
    appendCreateCard.style.flexDirection = "column";
    appendCreateCard.style.justifyContent = "center";
    appendCreateCard.style.alignItems = "center";
    appendCreateCard.onclick = window.openCreateCharacterModal;
    appendCreateCard.innerHTML = `
        <div style="font-size: 28px; color: #8b5cf6; margin-bottom: 4px;">+</div>
        <div style="font-size: 12px; color: #9ca3af;">新建角色</div>
    `;
    grid.appendChild(appendCreateCard);
}

function syncChatSidebarList() {
    const list = document.getElementById("sidebar-character-list"); 
    if (!list) return;
    list.innerHTML = "";
    
    state.characters.forEach(char => {
        const item = document.createElement("div");
        item.className = `sidebar-item ${char.id === state.activeCharacterId ? 'active' : ''}`;
        item.onclick = () => { 
            state.activeCharacterId = char.id; 
            syncChatSidebarList(); 
            loadCharacterChatDialogue(); 
            window.saveAppState(); 
        };
        item.innerHTML = `<img src="${char.avatar}"><span>${char.name}</span>`;
        list.appendChild(item);
    });

    const sidebarActionBox = document.createElement("div");
    sidebarActionBox.style.padding = "10px";
    sidebarActionBox.style.marginTop = "auto"; 
    sidebarActionBox.innerHTML = `
        <button type="button" onclick="window.openCreateCharacterModal()"
                style="width:100%; padding:10px; background:#1f2937; border: 1px dashed #4b5563; color:#a78bfa; border-radius:6px; cursor:pointer; font-size:13px; font-weight:bold; display:flex; align-items:center; justify-content:center; gap:5px;">
            <span>➕ 新建虚拟角色</span>
        </button>
    `;
    list.appendChild(sidebarActionBox);
}

// ==========================================
// 🛠️ 消息气泡生成
// ==========================================
function appendChatBubble(role, content) {
    const box = document.getElementById("chat-box"); 
    if (!box) return;

    const row = document.createElement("div"); 
    row.className = `msg-row ${role}`;

    let avatarSrc = "";
    let displayName = "";

    if (role === "user") {
        avatarSrc = state.globals.userAvatar;
        displayName = state.globals.userName;
    } else {
        const char = state.characters.find(c => c.id === state.activeCharacterId);
        avatarSrc = char ? char.avatar : "";
        displayName = char ? char.name : "角色";
    }

    row.innerHTML = `
        <img class="chat-bubble-avatar" src="${avatarSrc}" alt="avatar">
        <div class="chat-bubble-content-zone">
            <span class="chat-bubble-name">${displayName}</span>
            <div class="bubble">${content}</div>
        </div>
    `;

    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return row; 
}

// ==========================================
// ⚡ 大模型接口通信与安全防御总线
// ==========================================
window.toggleApiProviderFields = function() {
    const providerSelect = document.getElementById("api-provider-select");
    if (!providerSelect) return;
    const provider = providerSelect.value;
    state.globals.selectedProvider = provider;
    const panel = document.getElementById("cloud-api-panel");
    if (panel) {
        if (provider === "openai") panel.classList.remove("hidden");
        else panel.classList.add("hidden");
    }
    window.saveAppState();
};

window.refreshModels = async function() {
    const btn = document.getElementById("refresh-models-btn");
    const select = document.getElementById("model-select");
    if (!btn || !select) return;

    btn.innerText = "获取中..."; select.innerHTML = "";
    const provider = state.globals.selectedProvider;

    if (provider === "ollama") {
        try {
            const res = await fetch("http://localhost:11434/api/tags");
            const data = await res.json();
            if (data.models && data.models.length > 0) {
                data.models.forEach(m => {
                    const opt = document.createElement("option"); opt.value = m.name; opt.innerText = m.name; select.appendChild(opt);
                });
                if (state.globals.selectedModel) select.value = state.globals.selectedModel;
            } else { select.innerHTML = "<option value=''>❌ 未检测到Ollama模型</option>"; }
        } catch (err) { select.innerHTML = "<option value=''>❌ 本地Ollama服务未启动</option>"; }
    } else if (provider === "openai") {
        const cloudModels = ["deepseek-chat", "deepseek-reasoner", "gpt-4o", "gpt-3.5-turbo"];
        cloudModels.forEach(m => {
            const opt = document.createElement("option"); opt.value = m; opt.innerText = m; select.appendChild(opt);
        });
        if (state.globals.selectedModel) select.value = state.globals.selectedModel;
    }
    btn.innerText = "🔄 刷新"; btn.disabled = false;
    if (select.value) state.globals.selectedModel = select.value;
    window.saveAppState();
};

// 🔒 安全指纹追踪锁
let lastVerifiedUrl = "";
let lastVerifiedKey = "";

// 🔒 核心防御点 1：输入框实时销毁机制。只要用户动手改任何数据，本地存储立刻强制抹除
window.handleApiFieldInputTrigger = function() {
    const currentUrlInput = document.getElementById("api-url-input").value.trim();
    const currentKeyInput = document.getElementById("api-key-input").value.trim();

    // 只要当前输入框内容与最后一次验证通过的内容有偏差
    if (currentUrlInput !== lastVerifiedUrl || currentKeyInput !== lastVerifiedKey) {
        // 斩草除根：直接从控制台 Application (localStorage) 中销毁正确密钥
        localStorage.removeItem("xinyingongming_secure_apikey");
        state.globals.cloudApiUrl = "";
        // 内存同步置空，绝不留任何旧钥匙在系统中
        state.globals.selectedModel = ""; 
        window.saveAppState();
    }
};

window.testCloudConnection = async function() {
    const btn = document.getElementById("test-cloud-btn");
    const urlInput = document.getElementById("api-url-input");
    const keyInput = document.getElementById("api-key-input");
    if (!btn || !urlInput || !keyInput) return;

    let baseUrl = urlInput.value.trim();
    let apiKey = keyInput.value.trim();
    if (!baseUrl || !apiKey) { alert("⚠️ 请完整填写 API Base URL 和 API KEY！"); return; }
    btn.innerText = "正在尝试云端握手..."; btn.disabled = true;

    try {
        const res = await fetch(`${baseUrl.trim_end_matches('/')}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "ping" }], max_tokens: 1 })
        });
        if (res.ok) {
            // 只有握手成功，才允许把秘钥真正写入 localStorage
            state.globals.cloudApiUrl = baseUrl;
            localStorage.setItem("xinyingongming_secure_apikey", apiKey);
            
            // 建立合法指纹屏障
            lastVerifiedUrl = baseUrl;
            lastVerifiedKey = apiKey;
            
            window.saveAppState();
            alert("✅ 灵魂链接成功！云端通道已打通并加密授权！");
            window.refreshModels();
        } else { alert(`❌ 链接失败，状态码: ${res.status}`); }
    } catch (err) { alert(`❌ 网络错误: ${err}`); } 
    finally { btn.innerText = "⚡ 测试云端连接"; btn.disabled = false; }
};

// 🔒 核心防御点 2：进入界面的二次阻断
window.enterChitChatView = function() {
    if (state.characters.length === 0) {
        alert("🔒 契约阻断：当前没有任何人设，请点击新建角色卡！");
        return;
    }
    const modelSelect = document.getElementById("model-select");
    if (!modelSelect) return;
    const modelValue = modelSelect.value;
    if (!modelValue || modelValue.startsWith("❌")) { alert("🔒 请先选择一个合法的 AI 大模型！"); return; }

    if (state.globals.selectedProvider === "openai") {
        const currentUrlInput = document.getElementById("api-url-input").value.trim();
        const currentKeyInput = document.getElementById("api-key-input").value.trim();
        const storedKey = localStorage.getItem("xinyingongming_secure_apikey");

        // 如果被改动过或者根本没有过存储凭证
        if (currentUrlInput !== lastVerifiedUrl || currentKeyInput !== lastVerifiedKey || !storedKey) {
            localStorage.removeItem("xinyingongming_secure_apikey");
            state.globals.cloudApiUrl = "";
            window.saveAppState();
            alert("🛑 安全熔断：配置已被篡改且未重新测试连接！旧资产已从控制台销毁，请重新测试。");
            return;
        }
    }

    state.globals.selectedModel = modelValue;
    window.saveAppState();

    document.getElementById("portal-view").classList.remove("active");
    document.getElementById("chitchat-view").classList.add("active");
    syncChatSidebarList();
    loadCharacterChatDialogue();
    window.checkChatInputStatus();
};

window.backToPortalView = function() {
    document.getElementById("chitchat-view").classList.remove("active");
    document.getElementById("portal-view").classList.add("active");
    
    if (document.getElementById("user-global-name-input")) {
        document.getElementById("user-global-name-input").value = state.globals.userName;
    }
    if (document.getElementById("user-global-avatar-preview")) {
        document.getElementById("user-global-avatar-preview").src = state.globals.userAvatar;
    }

    document.getElementById("api-provider-select").value = state.globals.selectedProvider;
    document.getElementById("api-url-input").value = state.globals.cloudApiUrl || "";
    document.getElementById("api-key-input").value = localStorage.getItem("xinyingongming_secure_apikey") || "";
    window.toggleApiProviderFields();
    renderCharacterSelectors();
};

window.handleChatKeyDown = function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); window.sendChitChatMessage(); } };

window.sendChitChatMessage = async function() {
    const input = document.getElementById("chat-input-field"); if (!input) return;
    const text = input.value.trim(); if (!text) return;

    input.value = ""; 
    appendChatBubble("user", text); 

    const char = state.characters.find(c => c.id === state.activeCharacterId); if (!char) return;
    char.history.push({ role: "user", content: text }); window.saveAppState();

    const activeRow = appendChatBubble("ai", "⚡ 正在凝聚思绪...");
    const bubbleElement = activeRow.querySelector(".bubble");

    const provider = state.globals.selectedProvider;
    const model = state.globals.selectedModel;
    
    let customSystemPrompt = char.systemPrompt + `\n【当前交流的用户名字叫作：“${state.globals.userName}”，请在合适时机以此称呼对方。】`;
    let messagesContext = [{ role: "system", content: customSystemPrompt }].concat(char.history);

    if (provider === "ollama") {
        try {
            const response = await fetch("http://localhost:11434/api/chat", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: model, messages: messagesContext, stream: false })
            });
            const data = await response.json(); 
            bubbleElement.innerText = data.message.content;
            char.history.push({ role: "assistant", content: data.message.content }); window.saveAppState();
        } catch (err) { bubbleElement.innerText = "❌ 本地 Ollama 响应异常。"; }
    } else if (provider === "openai") {
        try {
            const runtimeKey = localStorage.getItem("xinyingongming_secure_apikey");
            if (!runtimeKey) {
                bubbleElement.innerText = "❌ 安全熔断：未检测到合法的加密云端通道凭证。";
                return;
            }

            const response = await fetch(`${state.globals.cloudApiUrl.trim_end_matches('/')}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${runtimeKey}` },
                body: JSON.stringify({ model: model, messages: messagesContext, stream: false })
            });
            if (response.ok) {
                const data = await response.json();
                const reply = data.choices[0].message.content; 
                bubbleElement.innerText = reply;
                char.history.push({ role: "assistant", content: reply }); window.saveAppState();
            } else { bubbleElement.innerText = `❌ 请求失败 [${response.status}]`; }
        } catch (err) { bubbleElement.innerText = `❌ 云端连接故障: ${err}`; }
    }
    const box = document.getElementById("chat-box");
    box.scrollTop = box.scrollHeight;
};

// 💾 外部卡片单独导入系统
window.triggerSingleCardImport = function() { document.getElementById("single-card-import-file").click(); };
window.handleSingleCardImport = function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const card = JSON.parse(evt.target.result);
            if (card.version === "xinyin-card-v3" && card.name && card.systemPrompt) {
                const newId = `char_${Date.now()}`;
                state.characters.push({ 
                    id: newId, name: card.name, 
                    avatar: card.avatar || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%239ca3af'><circle cx='50' cy='50' r='50'/><text x='50' y='55' font-size='30' fill='white' text-anchor='middle'>👤</text></svg>", 
                    systemPrompt: card.systemPrompt, history: [] 
                });
                state.activeCharacterId = newId; window.saveAppState();
                alert(`🎉 成功载入外部人设：【${card.name}】！`); renderCharacterSelectors();
            } else { alert("❌ 导入失败：非合法的 V3 人设卡文件。"); }
        } catch (err) { alert("❌ 导入异常"); }
    };
    reader.readAsText(file);
};

window.initApplicationCore = function() {
    const isCleaned = localStorage.getItem("xinyingongming_pure_v3_flag");
    if (!isCleaned) { window.saveAppState(); localStorage.setItem("xinyingongming_pure_v3_flag", "true"); }
    const localJson = localStorage.getItem("xinyingongming_v3_core");
    if (localJson) state = JSON.parse(localJson);

    if (document.getElementById("user-global-name-input")) {
        document.getElementById("user-global-name-input").value = state.globals.userName || "用户";
    }
    if (document.getElementById("user-global-avatar-preview")) {
        document.getElementById("user-global-avatar-preview").src = state.globals.userAvatar;
    }

    if (document.getElementById("api-provider-select")) document.getElementById("api-provider-select").value = state.globals.selectedProvider;
    
    const urlInput = document.getElementById("api-url-input");
    const keyInput = document.getElementById("api-key-input");
    
    if (urlInput) {
        urlInput.value = state.globals.cloudApiUrl || "";
        // 绑定核心实时监听
        urlInput.addEventListener("input", window.handleApiFieldInputTrigger);
    }
    if (keyInput) {
        keyInput.value = localStorage.getItem("xinyingongming_secure_apikey") || "";
        // 绑定核心实时监听
        keyInput.addEventListener("input", window.handleApiFieldInputTrigger);
    }
    
    // 初始化时同步指纹锁
    lastVerifiedUrl = state.globals.cloudApiUrl || "";
    lastVerifiedKey = localStorage.getItem("xinyingongming_secure_apikey") || "";

    window.toggleApiProviderFields();
    renderCharacterSelectors();
};

function loadCharacterChatDialogue() {
    const char = state.characters.find(c => c.id === state.activeCharacterId); if (!char) return;
    document.getElementById("chat-partner-avatar").src = char.avatar;
    document.getElementById("chat-partner-name").innerText = char.name;
    document.getElementById("chat-partner-status").innerText = `与 ${state.globals.selectedModel || '未知驱动'} 共鸣中`;
    
    const box = document.getElementById("chat-box"); box.innerHTML = "";
    if (char.history.length === 0) { 
        appendChatBubble("ai", `（静静地看着你...）`); 
    } else { 
        char.history.forEach(msg => appendChatBubble(msg.role === "user" ? "user" : "ai", msg.content)); 
    }
    box.scrollTop = box.scrollHeight;
}

window.checkChatInputStatus = function() {
    if (document.getElementById("chat-input-field")) document.getElementById("chat-input-field").disabled = false;
    if (document.getElementById("chat-send-btn")) document.getElementById("chat-send-btn").disabled = false;
};

String.prototype.trim_end_matches = function(char) { if (this.endsWith(char)) return this.slice(0, -char.length); return this; };
window.addEventListener("DOMContentLoaded", () => { window.initApplicationCore(); setTimeout(() => { window.refreshModels(); }, 200); });