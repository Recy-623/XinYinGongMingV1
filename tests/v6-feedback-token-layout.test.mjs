import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { replyLengthPlan } from "../src/context/reply-length.js";
import { buildFeedbackRewriteInstruction, feedbackContextHistory } from "../src/feedback/rewrite.js";
import { buildTokenDebugEntry, summarizeTokenDebug } from "../src/debug/token-monitor.js";
import { evaluateNarrativeBoundary, GLOBAL_NARRATIVE_BOUNDARY } from "../src/context/narrative-boundary.js";
import { replyAuditMessages } from "../src/quality/reply-audit.js";

test("回复长度偏好在 50–1000 字间，并在标准值开始收束", () => {
  const plan = replyLengthPlan(100, () => 0.5);
  assert.equal(plan.standard, 100);
  assert.equal(plan.minimum, 90);
  assert.equal(plan.maximum, 120);
  assert.match(plan.instruction, /接近 100 字时必须开始收束/);
  assert.match(plan.instruction, /不得开启新话题/);
});

test("评价意见只进入一次性重写提示，不进入历史上下文", () => {
  const history = [
    { role: "user", content: "上一句" },
    { role: "assistant", content: "错误回复" },
    { role: "user", content: "后续消息" },
  ];
  assert.deepEqual(feedbackContextHistory(history, 1), [{ role: "user", content: "上一句" }]);
  const instruction = buildFeedbackRewriteInstruction("错误回复", "不要猜测我的心理");
  assert.match(instruction, /不是未来可回忆的事实/);
});

test("Token 调试条目只保存元数据，不含提示词正文、回复或密钥", async () => {
  const entry = await buildTokenDebugEntry({
    character: { id: "safe" }, provider: "openai", model: "model", purpose: "main_generation",
    messages: [{ role: "system", content: "PRIVATE_PROMPT" }, { role: "user", content: "PRIVATE_CHAT" }],
    metadata: { promptTokens: 100, cacheHitTokens: 80, cacheMissTokens: 20, completionTokens: 10, cacheMetricsAvailable: true },
  });
  const serialized = JSON.stringify(entry);
  assert.doesNotMatch(serialized, /PRIVATE_PROMPT|PRIVATE_CHAT|api.?key/i);
  assert.equal(summarizeTokenDebug([entry]).cacheRate, 0.8);
});

test("长期陪伴界面接入三个功能并为窄屏自适配", () => {
  const html = fs.readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const main = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  for (const id of ["reply-length-slider", "token-debug-btn", "feedback-modal", "feedback-regenerate-btn"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(main, /trackedModelRequest/);
  assert.match(main, /feedback-rewrite-action/);
  assert.match(css, /migration-btn-group[^}]*flex-wrap:wrap/s);
  assert.match(css, /modal-card[^}]*calc\(100vw - 2rem\)/s);
  assert.match(css, /body\s*\{\s*min-width:0/);
  assert.match(css, /\.chat-main\s*\{[^}]*min-height:0[^}]*overflow:hidden/s);
  assert.match(css, /\.chat-box\s*\{[^}]*min-height:0[^}]*flex:1 1 0/s);
  assert.match(css, /\.android-runtime\s*\{[^}]*--android-system-top:max\(24px[^}]*--android-system-bottom:max\(24px/s);
  assert.match(css, /\.android-runtime \.view-container\s*\{[^}]*100dvh - var\(--android-system-top\) - var\(--android-system-bottom\)[^}]*margin-top:var\(--android-system-top\)/s);
  assert.match(css, /\.chat-sidebar\s*\{[^}]*display:flex[^}]*max-height:none/s);
  assert.match(css, /scroll-snap-type:x mandatory/);
  assert.match(css, /\.sidebar-create\s*\{\s*display:none/);
  assert.match(main, /resetCompactChatScrollPositions/);
});

test("程序级边界阻止角色第三人称自述和代写用户心理", () => {
  assert.match(GLOBAL_NARRATIVE_BOUNDARY, /不得代写/);
  assert.equal(evaluateNarrativeBoundary("（示例角色放下书。）", "示例角色").passed, false);
  assert.equal(evaluateNarrativeBoundary("你心里一沉，我放下书。", "示例角色").passed, false);
  const audit = replyAuditMessages({ characterName: "示例角色", personaPrompt: "克制", userInput: "我只是陈述事实", recentHistory: [], draft: "看来你在抱怨。", lengthPlan: { standard: 100 } });
  assert.match(audit[0].content, /不擅自定性为抱怨/);
});

test("长期陪伴应用标识和数据库均与短期语C版隔离", () => {
  const tauri = JSON.parse(fs.readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const rust = fs.readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.equal(tauri.identifier, "com.xinying.gongming");
  assert.doesNotMatch(tauri.identifier, /r18/i);
  assert.match(rust, /xinyingongming-companion\.sqlite3/);
  assert.doesNotMatch(rust, /xinyingongming-r18\.sqlite3/);
});
