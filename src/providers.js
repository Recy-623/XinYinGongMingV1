import { invoke } from "@tauri-apps/api/core";

export function normalizeBaseUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:") throw new Error("移动版只允许 HTTPS API 地址");
  if (url.username || url.password || url.search || url.hash) throw new Error("API 地址不能包含账号、密码、查询参数或片段");
  return url.href.replace(/\/$/, "");
}

function config(mode, baseUrl, apiKey, model) {
  return {
    mode,
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: String(apiKey || "").trim(),
    model: String(model || "").trim(),
  };
}

export async function listCloudModels(baseUrl, apiKey) {
  return invoke("api_list_models", { baseUrl: normalizeBaseUrl(baseUrl), apiKey: String(apiKey || "").trim() });
}

export async function testCloud(mode, baseUrl, apiKey, model) {
  return invoke("api_test", { config: config(mode, baseUrl, apiKey, model) });
}

export async function chatWithCloud(mode, baseUrl, apiKey, model, messages, signal) {
  if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
  const requestId = crypto.randomUUID();
  const cancel = () => { invoke("api_cancel_request", { requestId }).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const reply = await invoke("api_generate", {
      requestId,
      config: config(mode, baseUrl, apiKey, model),
      messages,
    });
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    return reply?.text || "服务没有返回有效内容。";
  } catch (error) {
    if (signal?.aborted || String(error).includes("请求已取消")) throw new DOMException("请求已取消", "AbortError");
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
