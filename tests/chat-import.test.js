import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, selectRepresentativeMessages } from "../src/chat-import.js";

test("parses quoted Chinese CSV exports", () => {
  const messages = parseCsv('发送时间,发送者,消息内容\r\n2026-01-02 03:04:05,我,"你好, 世界"\r\n2026-01-02 03:05:00,树月,"第一行\n第二行"');
  assert.deepEqual(messages, [
    { sender: "我", content: "你好, 世界", time: "2026-01-02 03:04:05" },
    { sender: "树月", content: "第一行\n第二行", time: "2026-01-02 03:05:00" },
  ]);
});

test("uses a bounded evenly distributed relationship sample", () => {
  const input = Array.from({ length: 100 }, (_, index) => ({ sender: index % 2 ? "对方" : "我", content: String(index), time: "" }));
  const selected = selectRepresentativeMessages(input, "我", "对方", 10);
  assert.equal(selected.length, 10);
  assert.deepEqual(selected.map((message) => message.content), ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90"]);
});
