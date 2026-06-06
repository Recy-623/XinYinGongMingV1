/**
 * 心印共鸣系统核心数据处理与交互逻辑层 - 第三版（对齐间距 + 本地图片Base64头像上传）
 */

// 1. 全局核心状态机
let state = {
    globals: {
        userName: "用户名",
        userAvatar: "用户",
        contextLimit: 20,
        streamEnabled: true,
        selectedModel: ""
    },
    characters: [], 
    activeId: null, 
    models: []      
};

// 2. 本地持久化加载与初始化
function initSystem() {
    state.globals.userName = localStorage.getItem("user-name") || "用户名";
    state.globals.userAvatar = localStorage.getItem("user-avatar") || "用户";
    
    let localLimit = localStorage.getItem("context-limit");
    state.globals.contextLimit = localLimit !== null ? parseInt(localLimit, 10) : 20;
    if(isNaN(state.globals.contextLimit) || state.globals.contextLimit < 0) {
        state.globals.contextLimit = 20;
    }

    state.globals.streamEnabled = localStorage.getItem("stream-enabled") !== "false";
    state.globals.selectedModel = localStorage.getItem("selected-model") || "";

    let localChars = localStorage.getItem("characters");
    if (localChars) {
        state.characters = JSON.parse(localChars);
    } else {
        state.characters = [{
            id: Date.now(),
            name: "新伴侣",
            avatar: "新",
            systemPrompt: "你是一个温柔贴心的AI虚拟伴侣，会时刻聆听并感应主人的内心，用温柔细腻的话语给予回应。",
            customUserName: "",
            customUserAvatar: "",
            history: []
        }];
        saveCharactersToStorage();
    }
    state.activeId = state.characters[0].id;

    // 数据同步至入口UI
    document.getElementById("global-username").value = state.globals.userName;
    document.getElementById("global-avatar").value = state.globals.userAvatar;
    document.getElementById("global-context-limit").value = state.globals.contextLimit;
    document.getElementById("context-val").innerText = state.globals.contextLimit;
    document.getElementById("global-stream").checked = state.globals.streamEnabled;

    fetchLocalOllamaModels();
    renderChatList();
}

function saveGlobalsToStorage() {
    localStorage.setItem("user-name", state.globals.userName);
    localStorage.setItem("user-avatar", state.globals.userAvatar);
    localStorage.setItem("context-limit", state.globals.contextLimit);
    localStorage.setItem("stream-enabled", state.globals.streamEnabled);
    localStorage.setItem("selected-model", state.globals.selectedModel);
}

function saveCharactersToStorage() {
    localStorage.setItem("characters", JSON.stringify(state.characters));
}

// 3. 自动化抓取本地 Ollama 已有模型
async function fetchLocalOllamaModels() {
    const modelSelect = document.getElementById("global-model");
    try {
        const response = await fetch("http://localhost:11434/api/tags");
        if (!response.ok) throw new Error("API响应失败");
        const data = await response.json();
        state.models = data.models || [];
        
        modelSelect.innerHTML = "";
        if (state.models.length === 0) {
            modelSelect.innerHTML = `<option value="">⚠️ 本地已启动但无安装模型</option>`;
            return;
        }

        state.models.forEach(m => {
            let opt = document.createElement("option");
            opt.value = m.name;
            opt.innerText = m.name;
            if (m.name === state.globals.selectedModel) {
                opt.selected = true;
            }
            modelSelect.appendChild(opt);
        });

        if(!state.globals.selectedModel && state.models.length > 0) {
            state.globals.selectedModel = state.models[0].name;
            saveGlobalsToStorage();
        }
    } catch (e) {
        console.error(e);
        modelSelect.innerHTML = `<option value="">❌ 未能发现本地Ollama服务</option>`;
    }
}

// 4. 数据视图渲染层
function renderChatList() {
    const listContainer = document.getElementById("chat-list");
    listContainer.innerHTML = "";

    state.characters.forEach(char => {
        const li = document.createElement("li");
        li.className = `chat-item ${char.id === state.activeId ? 'active' : ''}`;
        li.setAttribute("data-id", char.id);

        let avatarHTML = isImageSource(char.avatar) 
            ? `<img src="${char.avatar}" class="avatar">` 
            : `<div class="avatar">${char.avatar.substring(0, 1)}</div>`;

        let lastMsg = "暂无聊天记录";
        if (char.history && char.history.length > 0) {
            lastMsg = char.history[char.history.length - 1].content;
        }

        li.innerHTML = `
            ${avatarHTML}
            <div class="chat-item-info">
                <div class="chat-item-name">${escapeHTML(char.name)}</div>
                <div class="chat-item-preview">${escapeHTML(lastMsg)}</div>
            </div>
            <button class="btn-delete-chat" title="删除对话">&times;</button>
        `;

        li.addEventListener("click", (e) => {
            if (e.target.classList.contains("btn-delete-chat")) return;
            state.activeId = char.id;
            renderChatList();
            renderChatBox();
        });

        li.querySelector(".btn-delete-chat").addEventListener("click", (e) => {
            e.stopPropagation();
            if (state.characters.length <= 1) {
                alert("系统限制：必须至少保留一个对话频道。");
                return;
            }
            if (confirm(`确定要彻底清除与“${char.name}”的所有设定和历史记忆吗？`)) {
                let index = state.characters.findIndex(c => c.id === char.id);
                state.characters.splice(index, 1);
                if (state.activeId === char.id) {
                    state.activeId = state.characters[0].id;
                }
                saveCharactersToStorage();
                renderChatList();
                renderChatBox();
            }
        });

        listContainer.appendChild(li);
    });
}

function renderChatBox() {
    const activeChar = state.characters.find(c => c.id === state.activeId);
    if (!activeChar) return;

    document.getElementById("current-chat-name").innerText = activeChar.name;
    const msgContainer = document.getElementById("chat-messages");
    msgContainer.innerHTML = "";

    activeChar.history.forEach(msg => {
        appendMessageBubble(msg.role, msg.content, activeChar);
    });
    scrollToBottom();
}

function appendMessageBubble(role, content, char, isPending = false) {
    const msgContainer = document.getElementById("chat-messages");
    const row = document.createElement("div");
    row.className = `msg-row ${role === 'user' ? 'user-row' : 'ai-row'}`;
    if (isPending) row.id = "pending-ai-bubble";

    let displayName = "";
    let displayAvatar = "";

    if (role === 'user') {
        displayName = char.customUserName || state.globals.userName || "用户";
        let rawAvat = char.customUserAvatar || state.globals.userAvatar || "我";
        displayAvatar = isImageSource(rawAvat) ? `<img src="${rawAvat}" class="avatar">` : `<div class="avatar">${rawAvat.substring(0,1)}</div>`;
    } else {
        displayName = char.name;
        displayAvatar = isImageSource(char.avatar) ? `<img src="${char.avatar}" class="avatar">` : `<div class="avatar">${char.avatar.substring(0,1)}</div>`;
    }

    row.innerHTML = `
        ${displayAvatar}
        <div class="msg-wrapper">
            <div class="msg-meta">${escapeHTML(displayName)}</div>
            <div class="msg-bubble">${isPending ? content : parseLineBreaks(escapeHTML(content))}</div>
        </div>
    `;
    msgContainer.appendChild(row);
}

// 5. 对话流网络传输核心控制层
async function handleSendMessage() {
    const inputArea = document.getElementById("chat-input");
    const text = inputArea.value.trim();
    if (!text) return;

    const activeChar = state.characters.find(c => c.id === state.activeId);
    if (!activeChar) return;

    inputArea.value = "";
    activeChar.history.push({ role: "user", content: text });
    saveCharactersToStorage();
    renderChatList(); 
    appendMessageBubble("user", text, activeChar);
    scrollToBottom();

    appendMessageBubble("assistant", "正在聆听感应...", activeChar, true);
    scrollToBottom();

    let payloadMessages = [{ role: "system", content: activeChar.systemPrompt }];
    let limit = state.globals.contextLimit;
    let slicedHistory = activeChar.history.slice(-limit);
    payloadMessages = payloadMessages.concat(slicedHistory);

    const pendingBubble = document.getElementById("pending-ai-bubble");

    try {
        const response = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: state.globals.selectedModel,
                messages: payloadMessages,
                stream: state.globals.streamEnabled
            })
        });

        if (!response.ok) throw new Error("网络连接失败");

        if (state.globals.streamEnabled) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let aiResponseBuffer = "";
            pendingBubble.querySelector(".msg-bubble").innerText = ""; 

            let partialLine = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = (partialLine + chunk).split("\n");
                partialLine = lines.pop(); 

                for (let line of lines) {
                    if (line.trim() === "") continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.message && json.message.content) {
                            aiResponseBuffer += json.message.content;
                            pendingBubble.querySelector(".msg-bubble").innerText = aiResponseBuffer;
                            scrollToBottom();
                        }
                    } catch (err) {
                        console.error("行流控解析异常", err);
                    }
                }
            }

            if (partialLine.trim() !== "") {
                try {
                    const json = JSON.parse(partialLine);
                    if (json.message && json.message.content) {
                        aiResponseBuffer += json.message.content;
                        pendingBubble.querySelector(".msg-bubble").innerText = aiResponseBuffer;
                    }
                } catch(e){}
            }

            pendingBubble.removeAttribute("id");
            activeChar.history.push({ role: "assistant", content: aiResponseBuffer });
            saveCharactersToStorage();
            renderChatList();
        } else {
            const data = await response.json();
            let aiText = data.message ? data.message.content : "未收到有效感应。";
            pendingBubble.querySelector(".msg-bubble").innerText = aiText;
            pendingBubble.removeAttribute("id");
            activeChar.history.push({ role: "assistant", content: aiText });
            saveCharactersToStorage();
            renderChatList();
            scrollToBottom();
        }

    } catch (error) {
        console.error(error);
        if (pendingBubble) {
            pendingBubble.querySelector(".msg-bubble").innerHTML = `<span style="color:#ff4d4f;">💔 共鸣传输中断：请确认本地后端 Ollama 已正常启动。</span>`;
            pendingBubble.removeAttribute("id");
        }
    }
}

// 6. 弹窗管理与 Live Sync
let openModalCharRef = null; 

function openConfigModal() {
    const activeChar = state.characters.find(c => c.id === state.activeId);
    if (!activeChar) return;
    openModalCharRef = activeChar;

    document.getElementById("modal-char-name").value = activeChar.name;
    document.getElementById("modal-char-avatar").value = activeChar.avatar;
    document.getElementById("modal-system-prompt").value = activeChar.systemPrompt;
    document.getElementById("modal-custom-name").value = activeChar.customUserName || "";
    document.getElementById("modal-custom-avatar").value = activeChar.customUserAvatar || "";

    document.getElementById("config-modal").classList.remove("hidden");
}

function closeConfigModal() {
    document.getElementById("config-modal").classList.add("hidden");
    openModalCharRef = null;
}

function bindLiveSyncListeners() {
    document.getElementById("modal-char-name").addEventListener("input", (e) => {
        if (openModalCharRef) {
            openModalCharRef.name = e.target.value || "未命名";
            renderChatList();
            document.getElementById("current-chat-name").innerText = openModalCharRef.name;
        }
    });

    document.getElementById("modal-char-avatar").addEventListener("input", (e) => {
        if (openModalCharRef) {
            openModalCharRef.avatar = e.target.value || "新";
            renderChatList();
        }
    });
    
    document.getElementById("modal-system-prompt").addEventListener("input", (e) => {
        if (openModalCharRef) openModalCharRef.systemPrompt = e.target.value;
    });
    document.getElementById("modal-custom-name").addEventListener("input", (e) => {
        if (openModalCharRef) openModalCharRef.customUserName = e.target.value;
    });
    document.getElementById("modal-custom-avatar").addEventListener("input", (e) => {
        if (openModalCharRef) openModalCharRef.customUserAvatar = e.target.value;
    });
}

// 7. 核心需求②：处理本地图片上传并转换为 Base64 存储
function handleImageUpload(fileInputId, targetInputId, callback) {
    const fileInput = document.getElementById(fileInputId);
    const targetInput = document.getElementById(targetInputId);
    
    const file = fileInput.files[0];
    if (!file) return;

    // 限制图片大小防止 LocalStorage 超载 (控制在 1MB 以内最佳)
    if (file.size > 1.5 * 1024 * 1024) {
        alert("为了本地流畅存储，请选择小于 1.5MB 的图片。");
        fileInput.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Str = e.target.result;
        targetInput.value = base64Str;
        // 触发对应的内存同步回调
        callback(base64Str);
    };
    reader.readAsDataURL(file);
    fileInput.value = ""; // 清空以便下次重复选择
}

function exportSystemPrompt() {
    if (!openModalCharRef) return;
    const blob = new Blob([openModalCharRef.systemPrompt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${openModalCharRef.name}_核心设定.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function importSystemPrompt(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        document.getElementById("modal-system-prompt").value = text;
        if (openModalCharRef) {
            openModalCharRef.systemPrompt = text;
        }
    };
    reader.readAsText(file);
    event.target.value = ""; 
}

// 8. 全局与弹窗的事件绑定
function bindSystemEvents() {
    // 进入共鸣
    document.getElementById("btn-enter-system").addEventListener("click", () => {
        state.globals.userName = document.getElementById("global-username").value.trim() || "用户";
        state.globals.userAvatar = document.getElementById("global-avatar").value.trim() || "我";
        state.globals.selectedModel = document.getElementById("global-model").value;
        state.globals.streamEnabled = document.getElementById("global-stream").checked;
        
        let limitVal = parseInt(document.getElementById("global-context-limit").value, 10);
        state.globals.contextLimit = (isNaN(limitVal) || limitVal < 0) ? 20 : limitVal;

        saveGlobalsToStorage();
        
        document.getElementById("portal-view").classList.add("hidden");
        document.getElementById("workspace-view").classList.remove("hidden");
        
        renderChatBox();
    });

    // 退出共鸣
    document.getElementById("btn-exit-portal").addEventListener("click", () => {
        document.getElementById("workspace-view").classList.add("hidden");
        document.getElementById("portal-view").classList.remove("hidden");
        fetchLocalOllamaModels(); 
    });

    // 记忆限制条滑动
    document.getElementById("global-context-limit").addEventListener("input", (e) => {
        document.getElementById("context-val").innerText = e.target.value;
    });

    // 新建卡片
    document.getElementById("btn-new-chat").addEventListener("click", () => {
        let newChar = {
            id: Date.now(),
            name: "新伴侣",
            avatar: "新",
            systemPrompt: "你是一个温柔贴心的AI虚拟伴侣，会时刻聆听并感应主人的内心，用温柔细腻的话语给予回应。",
            customUserName: "",
            customUserAvatar: "",
            history: []
        };
        state.characters.push(newChar);
        state.activeId = newChar.id;
        saveCharactersToStorage();
        renderChatList();
        renderChatBox();
    });

    // 发送消息
    document.getElementById("btn-send").addEventListener("click", handleSendMessage);
    document.getElementById("chat-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // 清空聊天记录
    document.getElementById("btn-clear-history").addEventListener("click", () => {
        const activeChar = state.characters.find(c => c.id === state.activeId);
        if (!activeChar) return;
        if (confirm(`确认要彻底清空与“${activeChar.name}”的历史聊天记录吗？(不可恢复)`)) {
            activeChar.history = [];
            saveCharactersToStorage();
            renderChatList();
            renderChatBox();
        }
    });

    // 唤起和关闭弹窗
    document.getElementById("btn-open-config").addEventListener("click", openConfigModal);
    document.getElementById("btn-save-config").addEventListener("click", () => {
        saveCharactersToStorage();
        closeConfigModal();
        renderChatBox(); // 确保弹窗关闭后，聊天气泡区及时刷新最新上传的头像
    });
    document.getElementById("config-modal").addEventListener("click", (e) => {
        if (e.target.id === "config-modal") closeConfigModal();
    });

    // 核心设定文件导入导出
    document.getElementById("btn-export-prompt").addEventListener("click", exportSystemPrompt);
    document.getElementById("btn-trigger-import").addEventListener("click", () => {
        document.getElementById("import-file-input").click();
    });
    document.getElementById("import-file-input").addEventListener("change", importSystemPrompt);

    // ================= 核心需求②：三大本地图片头像上传事件监听 =================
    // 1. 全局控制页：上传我的默认头像
    document.getElementById("btn-upload-global-avatar").addEventListener("click", () => {
        document.getElementById("input-global-avatar-file").click();
    });
    document.getElementById("input-global-avatar-file").addEventListener("change", () => {
        handleImageUpload("input-global-avatar-file", "global-avatar", (base64) => {
            state.globals.userAvatar = base64;
        });
    });

    // 2. 弹窗页：上传伴侣头像
    document.getElementById("btn-upload-char-avatar").addEventListener("click", () => {
        document.getElementById("input-char-avatar-file").click();
    });
    document.getElementById("input-char-avatar-file").addEventListener("change", () => {
        handleImageUpload("input-char-avatar-file", "modal-char-avatar", (base64) => {
            if (openModalCharRef) {
                openModalCharRef.avatar = base64;
                renderChatList(); // 侧边栏立刻获得图片预览
            }
        });
    });

    // 3. 弹窗页：上传此频道我的专属头像
    document.getElementById("btn-upload-custom-avatar").addEventListener("click", () => {
        document.getElementById("input-custom-avatar-file").click();
    });
    document.getElementById("input-custom-avatar-file").addEventListener("change", () => {
        handleImageUpload("input-custom-avatar-file", "modal-custom-avatar", (base64) => {
            if (openModalCharRef) {
                openModalCharRef.customUserAvatar = base64;
            }
        });
    });

    bindLiveSyncListeners();
}

// 9. 底层工具防呆函数
function isImageSource(str) {
    if (!str) return false;
    return str.startsWith("http://") || str.startsWith("https://") || str.startsWith("data:image");
}
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function parseLineBreaks(str) {
    return str.replace(/\n/g, "<br>");
}
function scrollToBottom() {
    const msgContainer = document.getElementById("chat-messages");
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

window.addEventListener("DOMContentLoaded", () => {
    initSystem();
    bindSystemEvents();
});