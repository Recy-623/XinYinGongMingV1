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

export async function chatWithOllamaDetailed(model, messages, signal, overrides = {}) {
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
  return { content: data?.message?.content || "服务没有返回有效内容。", metadata: {
    requestedModel:model, returnedModel:data?.model||model, finishReason:data?.done_reason||(data?.done?"stop":"unknown"),
    promptTokens:Number(data?.prompt_eval_count)||0, completionTokens:Number(data?.eval_count)||0,
    totalTokens:(Number(data?.prompt_eval_count)||0)+(Number(data?.eval_count)||0), reasoningTokens:0,
    cacheMetricsAvailable:false,
  } };
}

export async function chatWithOllama(model, messages, signal, overrides = {}) {
  return (await chatWithOllamaDetailed(model, messages, signal, overrides)).content;
}

export async function chatWithCloudDetailed(baseUrl, apiKey, model, messages, signal, overrides = {}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: false, ...overrides }),
  });
  if (!response.ok) throw new Error(`云端服务返回 ${response.status}`);
  const data = await response.json();
  const choice=data?.choices?.[0]||{}; const usage=data?.usage||{};
  const available=Object.hasOwn(usage,"prompt_cache_hit_tokens")||Object.hasOwn(usage,"prompt_cache_miss_tokens")||Number.isFinite(Number(usage?.prompt_tokens_details?.cached_tokens));
  const promptTokens=Number(usage?.prompt_tokens)||0;
  const cacheHitTokens=Number(usage?.prompt_cache_hit_tokens??usage?.prompt_tokens_details?.cached_tokens)||0;
  const cacheMissTokens=Number(usage?.prompt_cache_miss_tokens)||(available?Math.max(0,promptTokens-cacheHitTokens):0);
  return { content:choice?.message?.content||"服务没有返回有效内容。", metadata:{ responseId:data?.id||"", requestedModel:model, returnedModel:data?.model||model, finishReason:choice?.finish_reason||"unknown", promptTokens, cacheHitTokens, cacheMissTokens, completionTokens:Number(usage?.completion_tokens)||0, totalTokens:Number(usage?.total_tokens)||0, reasoningTokens:Number(usage?.completion_tokens_details?.reasoning_tokens)||0, cacheMetricsAvailable:available } };
}

export async function chatWithCloud(baseUrl, apiKey, model, messages, signal, overrides = {}) {
  return (await chatWithCloudDetailed(baseUrl, apiKey, model, messages, signal, overrides)).content;
}
