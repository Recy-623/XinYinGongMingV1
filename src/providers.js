const OLLAMA_BASE = "http://localhost:11434";

export function normalizeBaseUrl(value) {
  const url = new URL(value.trim());
  const localhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(localhost && url.protocol === "http:")) {
    throw new Error("云端 API 必须使用 HTTPS（本机服务可使用 HTTP）");
  }
  return url.href.replace(/\/$/, "");
}

async function request(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function listOllamaModels() {
  const response = await request(`${OLLAMA_BASE}/api/tags`, {}, 5_000);
  if (!response.ok) throw new Error(`Ollama 返回 ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.models) ? data.models.map((model) => model.name).filter(Boolean) : [];
}

export async function listCloudModels(baseUrl, apiKey) {
  const response = await request(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, 10_000);
  if (!response.ok) throw new Error(`模型列表返回 ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.data) ? data.data.map((model) => model.id).filter(Boolean) : [];
}

export async function testCloud(baseUrl, apiKey, model) {
  const response = await request(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
  });
  if (!response.ok) throw new Error(`连接失败，状态码: ${response.status}`);
}

export async function chatWithOllama(model, messages, signal, overrides = {}) {
  const options = {
    // Ollama otherwise uses the model's 32K context. For a 32B model that KV
    // cache alone can consume about 8GB and force weights back onto the CPU.
    // 8K is sufficient for this app's bounded prompts and keeps local inference
    // on the GPU on common 24GB cards.
    num_ctx: 8192,
    num_predict: 1024,
    temperature: 0.7,
    ...overrides,
  };
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, keep_alive: "30m", options }),
  });
  if (!response.ok) throw new Error(`Ollama 返回 ${response.status}`);
  const data = await response.json();
  return data?.message?.content || "服务没有返回有效内容。";
}

export async function chatWithCloud(baseUrl, apiKey, model, messages, signal) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!response.ok) throw new Error(`云端服务返回 ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || "服务没有返回有效内容。";
}
