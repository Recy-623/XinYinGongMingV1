const LABELS = { main_generation:"角色回复", main_rewrite:"质量纠正重写", reply_audit:"回复质量验收", narrative_rewrite:"视角边界重写", feedback_generation:"评价重写", feedback_audit:"评价重写验收", memory_extraction:"阶段记忆整理", connection_test:"连接测试" };
const number = (value) => Math.max(0, Number(value) || 0);
export const tokenPurposeLabel = (value) => LABELS[value] || String(value || "其他请求");
export async function shortHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,"0")).join("").slice(0,16);
}
export async function buildTokenDebugEntry({ character, provider, model, messages, purpose, groupId, metadata={}, durationMs=0, status="success", errorMessage="" }) {
  const system = (messages || []).find((message) => message?.role === "system")?.content || "";
  return { requestGroupId:String(groupId||""), characterId:String(character?.id||""), provider:String(provider||""), model:String(metadata.returnedModel||model||""), requestedModel:String(metadata.requestedModel||model||""), purpose:String(purpose||"unknown"), messageCount:(messages||[]).length, promptChars:(messages||[]).reduce((sum,item)=>sum+String(item?.content||"").length,0), stablePrefixHash:await shortHash(system), promptTokens:number(metadata.promptTokens), cacheHitTokens:number(metadata.cacheHitTokens), cacheMissTokens:number(metadata.cacheMissTokens), completionTokens:number(metadata.completionTokens), totalTokens:number(metadata.totalTokens), reasoningTokens:number(metadata.reasoningTokens), cacheMetricsAvailable:Boolean(metadata.cacheMetricsAvailable), finishReason:String(metadata.finishReason||""), durationMs:number(durationMs), status:String(status), errorMessage:String(errorMessage||"").slice(0,500), createdAt:new Date().toISOString() };
}
export function summarizeTokenDebug(entries) {
  const output={requests:0,promptTokens:0,cacheHitTokens:0,cacheMissTokens:0,completionTokens:0,cacheMeasuredRequests:0};
  for(const item of entries||[]){output.requests++;output.promptTokens+=number(item.promptTokens);output.cacheHitTokens+=number(item.cacheHitTokens);output.cacheMissTokens+=number(item.cacheMissTokens);output.completionTokens+=number(item.completionTokens);if(item.cacheMetricsAvailable)output.cacheMeasuredRequests++;}
  const measured=output.cacheHitTokens+output.cacheMissTokens;output.cacheRate=measured?output.cacheHitTokens/measured:0;return output;
}
