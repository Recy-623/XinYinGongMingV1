import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("home exposes role deletion and System Prompt allows 50000 characters", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(html, /id="delete-character-btn"/);
  assert.match(html, /id="config-char-prompt"[^>]*maxlength="50000"/);
  assert.match(html, /id="system-prompt-counter"/);
});
