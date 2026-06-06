// ==========================================
// 心印共鸣 v3.0 跨云端架构引擎核心线程（工业防死锁版）
// 严格执行个人隐私红线：默认代称为通用"用户"与"我"
// ==========================================

// 1. 全局系统状态机
let state = {
    globals: {
        userName: "用户",
        userAvatar: "我",
        selectedProvider: "ollama",
        cloudApiUrl: "",
        selectedModel: ""
    },
    characters: [
        {
            id: "char_01",
            name: "希露菲",
            avatar: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%238b5cf6'><circle cx='50' cy='50' r='50'/><text x='50' y='55' font-size='30' fill='white' text-anchor='middle'>🧚</text></svg>",
            systemPrompt: "你叫希露菲，是一个温柔体贴、容易害羞的森林精灵。你对用户极度信任、有着朦胧的爱意。说话喜欢使用‘……’，语气柔软内敛。绝对不能暴露自己是AI大模型。",
            history: []
        },
        {
            id: "char_02",
            name: "雷恩大佐",
            avatar: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23374151'><circle cx='50' cy='50' r='50'/><text x='50' y='55' font-size='30' fill='white' text-anchor='middle'>⚔️</text></svg>",
            systemPrompt: "你是雷恩大佐，一位经历过无数次战火洗礼的冷酷帝国军人。性格沉稳、不苟言笑、铁血果断，但唯独对用户有着极其坚定的守护克制。回话简短，绝不拖泥带水。",
            history: []
        }
    ],
    activeCharacterId: "char_01"
};

// 2. 核心控制函数直接绑定至最高域 window
window.toggleApiProviderFields = function() {
    const providerSelect = document.getElementById("api-provider-select");
    if (!providerSelect) return;
    
    const provider = providerSelect.value;
    state.globals.selectedProvider = provider;
    
    const panel = document.getElementById("cloud-api-panel");
    if (panel) {
        if (provider === "openai") {
            panel.classList.remove("hidden");
        } else {
            panel.classList.add("hidden");
        }
    }
    
    // 🚨 核心联动修复：当驱动提供商发生变更时，立刻清空上一次残留的错误模型
    // 并根据新选择的通道，自动、静默地在后台刷新并重组可选的 AI 心智模组！
    const select = document.getElementById("model-select");
    if (select) {
        select.innerHTML = "<option value=''>正在自适应同步驱动源...</option>";
    }
    
    // 自动调用原有的刷新机制
    window.refreshModels();
    
    localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
};

window.refreshModels = async function() {
    const btn = document.getElementById("refresh-models-btn");
    const select = document.getElementById("model-select");
    if (!btn || !select) return;

    btn.innerText = "获取中...";
    btn.disabled = true;
    select.innerHTML = "";

    const provider = state.globals.selectedProvider;

    if (provider === "openai") {
        const urlInput = document.getElementById("api-url-input");
        const keyInput = document.getElementById("api-key-input");
        
        // 🚨 核心修正：每一次点击刷新/测试，都将当前输入框的值实时覆盖到沙箱中
        // 如果用户改错了，沙箱里的正确密钥就会立刻被这张“错的纸”覆盖掉！
        if (urlInput) state.globals.cloudApiUrl = urlInput.value.trim();
        if (keyInput) localStorage.setItem("xinyingongming_secure_apikey", keyInput.value.trim());
    }

    if (provider === "ollama") {
        try {
            const res = await fetch("http://localhost:11434/api/tags");
            const data = await res.json();
            if (data.models && data.models.length > 0) {
                data.models.forEach(m => {
                    const opt = document.createElement("option");
                    opt.value = m.name;
                    opt.innerText = m.name;
                    select.appendChild(opt);
                });
                if (state.globals.selectedModel) select.value = state.globals.selectedModel;
                alert("🔄 Ollama 本地模型驱动同步刷新成功！");
            } else {
                const opt = document.createElement("option");
                opt.value = "";
                opt.innerText = "❌ 本地Ollama未检测到任何装载的模型";
                select.appendChild(opt);
            }
        } catch (err) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.innerText = "❌ 未能发现本地Ollama服务，请确认其正常开启";
            select.appendChild(opt);
        }
    } else if (provider === "openai") {
        if (!state.globals.cloudApiUrl) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.innerText = "⚠️ 请先填写API Base URL地址";
            select.appendChild(opt);
        } else {
            // 🚨 核心修正：如果是云端 API，不要直接默认“就绪”
            // 如果刚刚输入框被改动了，需要提醒用户进行测试联通
            const cloudModels = ["deepseek-chat", "deepseek-reasoner", "gpt-4o", "gpt-3.5-turbo"];
            cloudModels.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m;
                opt.innerText = m;
                select.appendChild(opt);
            });
            
            // 如果当前输入框的Key和测试成功存入的Key不一致，这里可以做预警
            console.log("云端 API 载入备选心智模组。");
        }
    }
    
    btn.innerText = "🔄 刷新";
    btn.disabled = false;
    localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
};

window.enterChitChatView = function() {
    const modelSelect = document.getElementById("model-select");
    if (!modelSelect) return;
    const modelValue = modelSelect.value;
    
    // 1. 基础校验：必须选择了一个模型
    if (!modelValue || modelValue.startsWith("❌") || modelValue.startsWith("⚠️")) {
        alert("🔒 契约唤醒失败：请先选择一个合法的 AI 大模型驱动心智！");
        return;
    }

    // 🚨 2. 核心防御拦截：如果是云端提供商，必须检查沙箱里有没有通过测试存储的合法Key
    if (state.globals.selectedProvider === "openai") {
        const secureKey = localStorage.getItem("xinyingongming_secure_apikey");
        const currentInputKey = document.getElementById("api-key-input")?.value.trim();

        // 如果沙箱里没Key，或者用户改动了输入框导致当前输入的Key跟测试通过的Key对不上
        if (!secureKey || secureKey !== currentInputKey) {
            alert("🛑 契约阻断：检测到云端 API 密钥未经过正确连接测试，或已被篡改！\n\n请在当前页面重新点击【⚡ 测试云端连接】，通过验证后再进入。");
            return; 
        }
    }

    // 3. 校验通过，允许通行
    state.globals.selectedModel = modelValue;
    localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));

    document.getElementById("portal-view").classList.remove("active");
    document.getElementById("chitchat-view").classList.add("active");

    syncChatSidebarList();
    loadCharacterChatDialogue();
    
    // 🚨 4. 第二层防御：在进入聊天室后，双重确保输入框状态安全
    window.checkChatInputStatus();
};
window.backToPortalView = function() {
    document.getElementById("chitchat-view").classList.remove("active");
    document.getElementById("portal-view").classList.add("active");
    initPortalUi();
};

window.handleChatKeyDown = function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        window.sendChitChatMessage();
    }
};

window.sendChitChatMessage = async function() {
    const input = document.getElementById("chat-input-field");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    appendChatBubble("user", text);

    const char = state.characters.find(c => c.id === state.activeCharacterId);
    char.history.push({ role: "user", content: text });
    localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));

    const box = document.getElementById("chat-box");
    const row = document.createElement("div");
    row.className = "msg-row ai";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerText = "⚡ 正在凝聚思绪...";
    row.appendChild(bubble);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;

    const provider = state.globals.selectedProvider;
    const model = state.globals.selectedModel;
    let messagesContext = [{ role: "system", content: char.systemPrompt }].concat(char.history);

    if (provider === "ollama") {
        try {
            const response = await fetch("http://localhost:11434/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: model, messages: messagesContext, stream: false })
            });
            const data = await response.json();
            bubble.innerText = data.message.content;
            char.history.push({ role: "assistant", content: data.message.content });
            localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
        } catch (err) {
            bubble.innerText = "❌ 精神共鸣断开：本地 Ollama 响应异常。";
        }
    } else if (provider === "openai") {
        try {
            const apiKey = localStorage.getItem("xinyingongming_secure_apikey") || "";
            const response = await fetch(`${state.globals.cloudApiUrl}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                body: JSON.stringify({ model: model, messages: messagesContext, stream: false })
            });
            const data = await response.json();
            if (data.choices && data.choices[0]) {
                const reply = data.choices[0].message.content;
                bubble.innerText = reply;
                char.history.push({ role: "assistant", content: reply });
                localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
            } else {
                bubble.innerText = `❌ 云端返回异常：${JSON.stringify(data)}`;
            }
        } catch (err) {
            bubble.innerText = "❌ 精神共鸣断开：云端 API 网络连接失败。";
        }
    }
    box.scrollTop = box.scrollHeight;
};

window.openCharacterConfigModal = function() {
    const char = state.characters.find(c => c.id === state.activeCharacterId);
    document.getElementById("config-char-name").value = char.name;
    document.getElementById("config-char-avatar-preview").src = char.avatar;
    document.getElementById("config-char-prompt").value = char.systemPrompt;
    document.getElementById("config-modal").classList.add("active");
};

window.closeCharacterConfigModal = function() {
    document.getElementById("config-modal").classList.remove("active");
};

window.handleAvatarImageUpload = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) { document.getElementById("config-char-avatar-preview").src = evt.target.result; };
    reader.readAsDataURL(file);
};

window.saveCharacterConfig = function() {
    const char = state.characters.find(c => c.id === state.activeCharacterId);
    char.name = document.getElementById("config-char-name").value.trim();
    char.avatar = document.getElementById("config-char-avatar-preview").src;
    char.systemPrompt = document.getElementById("config-char-prompt").value.trim();
    localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
    window.closeCharacterConfigModal();
    loadCharacterChatDialogue();
};

window.exportSingleCharacterCard = function() {
    const char = state.characters.find(c => c.id === state.activeCharacterId);
    const pureCard = { version: "xinyin-card-v3", name: char.name, avatar: char.avatar, systemPrompt: char.systemPrompt };
    const blob = new Blob([JSON.stringify(pureCard, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `伴侣人设卡_${char.name}.json`; a.click();
    URL.revokeObjectURL(url);
};

window.triggerSingleCardImport = function() { document.getElementById("single-card-import-file").click(); };

window.handleSingleCardImport = function(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const card = JSON.parse(evt.target.result);
            if (card.version === "xinyin-card-v3" && card.name && card.systemPrompt) {
                const newId = `char_${Date.now()}`;
                state.characters.push({ id: newId, name: `${card.name}(导入)`, avatar: card.avatar, systemPrompt: card.systemPrompt, history: [] });
                state.activeCharacterId = newId;
                localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
                alert(`🎉 成功载入外部伴侣：【${card.name}】！`);
                window.closeCharacterConfigModal();
                window.backToPortalView();
            }
        } catch (err) { alert("❌ 导入异常"); }
    };
    reader.readAsText(file);
};

window.triggerSystemExport = function() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `心印共鸣_全量数据备份.json`; a.click();
};

window.triggerSystemImport = function() { alert("恢复全量数据在第二阶段由Rust重写"); };

// 初始化辅助函数
function initPortalUi() {
    const saved = localStorage.getItem("xinyingongming_v3_core");
    if (saved) { try { const p = JSON.parse(saved); if (p.globals) state.globals = p.globals; if (p.characters) state.characters = p.characters; } catch (e) {} }
    
    document.getElementById("api-provider-select").value = state.globals.selectedProvider;
    document.getElementById("api-url-input").value = state.globals.cloudApiUrl || "";
    document.getElementById("api-key-input").value = localStorage.getItem("xinyingongming_secure_apikey") || "";
    window.toggleApiProviderFields();
    renderCharacterSelectors();
}

function renderCharacterSelectors() {
    const grid = document.getElementById("character-selector-grid"); if (!grid) return;
    grid.innerHTML = "";
    state.characters.forEach(char => {
        const card = document.createElement("div");
        card.className = `char-select-card ${char.id === state.activeCharacterId ? 'selected' : ''}`;
        card.onclick = () => { state.activeCharacterId = char.id; renderCharacterSelectors(); };
        card.innerHTML = `<img src="${char.avatar}"><div>${char.name}</div>`;
        grid.appendChild(card);
    });
}

function syncChatSidebarList() {
    const list = document.getElementById("sidebar-character-list"); if (!list) return;
    list.innerHTML = "";
    state.characters.forEach(char => {
        const item = document.createElement("div");
        item.className = `sidebar-item ${char.id === state.activeCharacterId ? 'active' : ''}`;
        item.onclick = () => { state.activeCharacterId = char.id; syncChatSidebarList(); loadCharacterChatDialogue(); };
        item.innerHTML = `<img src="${char.avatar}"><span>${char.name}</span>`;
        list.appendChild(item);
    });
}

function loadCharacterChatDialogue() {
    const char = state.characters.find(c => c.id === state.activeCharacterId);
    document.getElementById("chat-partner-avatar").src = char.avatar;
    document.getElementById("chat-partner-name").innerText = char.name;
    document.getElementById("chat-partner-status").innerText = `与 ${state.globals.selectedModel} 共鸣中`;
    const box = document.getElementById("chat-box"); box.innerHTML = "";
    if (char.history.length === 0) { appendChatBubble("ai", `（静静地看着你...）`); } 
    else { char.history.forEach(msg => appendChatBubble(msg.role === "user" ? "user" : "ai", msg.content)); }
    box.scrollTop = box.scrollHeight;
}

function appendChatBubble(role, content) {
    const box = document.getElementById("chat-box"); if (!box) return;
    const row = document.createElement("div"); row.className = `msg-row ${role}`;
    row.innerHTML = `<div class="bubble">${content}</div>`; box.appendChild(row);
    box.scrollTop = box.scrollHeight;
}

window.addEventListener("DOMContentLoaded", () => { initPortalUi(); setTimeout(() => { window.refreshModels(); }, 100); });

// ==========================================
// 🌐 核心扩展：云端 API 联通性高精度探测器
// ==========================================
window.testCloudConnection = async function() {
    const btn = document.getElementById("test-cloud-btn");
    const urlInput = document.getElementById("api-url-input");
    const keyInput = document.getElementById("api-key-input");
    
    if (!btn || !urlInput || !keyInput) return;

    let baseUrl = urlInput.value.trim();
    const apiKey = keyInput.value.trim();

    if (!baseUrl) {
        alert("⚠️ 探测失败：请先填写 API Base URL 地址。");
        return;
    }
    if (!apiKey) {
        alert("⚠️ 探测失败：请先填写 API Key 密钥。");
        return;
    }

    if (baseUrl.endsWith("/")) {
        baseUrl = baseUrl.slice(0, -1);
    }

    btn.innerText = "正在握手探测...";
    btn.disabled = true;

    try {
        const response = await fetch(`${baseUrl}/models`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            }
        });

        if (response.ok) {
            // 🌟 只有真正 200 OK 握手成功，才锁死保存有效密钥
            localStorage.setItem("xinyingongming_secure_apikey", apiKey);
            state.globals.cloudApiUrl = baseUrl;
            localStorage.setItem("xinyingongming_v3_core", JSON.stringify(state));
            
            alert("✅ 灵魂链接成功！云端 API 握手鉴权通过，模型驱动就绪。");
            window.refreshModels();
        } else {
            const errData = await response.json().catch(() => ({}));
            
            // 🚨 熔断：测试失败，立刻从底层沙箱中抹除任何历史有效密钥！
            localStorage.removeItem("xinyingongming_secure_apikey");
            
            alert(`❌ 链接失败 (状态码: ${response.status})\n服务器反馈: ${JSON.stringify(errData)}`);
        }
    } catch (err) {
        console.error("网络层异常:", err);
        // 🚨 熔断：发生阻断异常，同样立刻抹除密钥，防止卡Bug越权
        localStorage.removeItem("xinyingongming_secure_apikey");
        alert("❌ 连接遭遇阻断，已执行安全熔断。");
    } finally {
        btn.innerText = "⚡ 测试云端连接";
        btn.disabled = false;
    }
};
// ==========================================
// 🛡️ 输入层熔断器：根据当前的连接状态，强行锁死或释放输入框
// ==========================================
window.checkChatInputStatus = function() {
    const inputField = document.getElementById("chat-input-field");
    const sendBtn = document.getElementById("chat-send-btn");
    const statusEl = document.getElementById("chat-partner-status");
    
    if (!inputField || !sendBtn) return;

    if (state.globals.selectedProvider === "openai") {
        const secureKey = localStorage.getItem("xinyingongming_secure_apikey");
        
        // 再次兜底检查：如果由于任何未知 Bug 绕过了大门，只要这里没密钥，立刻物理锁死输入框
        if (!secureKey) {
            inputField.disabled = true;
            inputField.value = "";
            inputField.placeholder = "❌ 精神共鸣已彻底断开（API 认证失效，请返回主页重新测试连接）";
            
            if (sendBtn) sendBtn.disabled = true;
            if (statusEl) {
                statusEl.innerText = "断开连接";
                statusEl.style.background = "#ef4444"; // 变红
            }
            return;
        }
    }

    // 如果状态正常（Ollama 或 已验证的 OpenAI），则恢复正常输入状态
    inputField.disabled = false;
    inputField.placeholder = "对你的伴侣倾诉吧... (Enter发送，Shift+Enter换行)";
    if (sendBtn) sendBtn.disabled = false;
    if (statusEl) {
        statusEl.style.background = ""; // 恢复默认颜色
    }
};