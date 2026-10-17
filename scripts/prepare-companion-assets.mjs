import { readCard, normalizeWorldbook } from "../src/storage.js";
import { cardMemorySeeds } from "../src/memory/companion-memory.js";

export function prepareCompanionAssets({ card: rawCard, worldbook: rawWorldbook, existing, memories = [] }) {
  const card = readCard(rawCard);
  const worldbook = normalizeWorldbook(rawWorldbook);
  if (!worldbook || card.worldbookRef?.id !== worldbook.id) throw new Error("角色卡与世界观引用不匹配");
  if (!existing || existing.id !== card.id || existing.name !== card.name) throw new Error("更新目标与卡片身份不匹配");
  if (existing.experienceMode !== "companion") throw new Error("只能更新长期陪伴角色");
  const branches = existing.timeline?.branches || [];
  const timeline = existing.timeline ? {
    ...existing.timeline,
    checkpoints: (existing.timeline.checkpoints || []).filter((checkpoint) =>
      !(checkpoint.id === "checkpoint_migrated_current" && checkpoint.historical === false
        && !branches.some((branch) => branch.checkpointId === checkpoint.id))),
  } : card.timeline;
  const character = {
    ...existing,
    systemPrompt: card.systemPrompt, profile: card.profile,
    relationship: card.relationship, memories: card.memories,
    worldbook, worldbookRef: card.worldbookRef, timeline,
  };
  return { character, memories: cardMemorySeeds(character, memories) };
}

if (process.argv.includes("--stdin")) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  process.stdout.write(JSON.stringify(prepareCompanionAssets(JSON.parse(raw))));
}
