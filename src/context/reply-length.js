import { DEFAULT_REPLY_TARGET_CHARS, MAX_REPLY_TARGET_CHARS, MIN_REPLY_TARGET_CHARS } from "../constants.js";

export function normalizeReplyTargetChars(value) {
  return Math.round(Math.max(MIN_REPLY_TARGET_CHARS, Math.min(MAX_REPLY_TARGET_CHARS, Number(value) || DEFAULT_REPLY_TARGET_CHARS)));
}

export function replyLengthPlan(value, random = Math.random) {
  const standard = normalizeReplyTargetChars(value);
  const minimum = Math.max(MIN_REPLY_TARGET_CHARS, Math.round(standard * 0.9));
  const maximum = Math.min(MAX_REPLY_TARGET_CHARS + 200, Math.round(standard * 1.2));
  const sample = Math.max(0, Math.min(0.999999, Number(random()) || 0));
  const target = minimum + Math.floor(sample * (standard - minimum + 1));
  return {
    standard, minimum, maximum, target,
    maxOutputTokens: Math.max(192, Math.min(3000, Math.ceil(maximum * 2.1) + 128)),
    thinkingMaxOutputTokens: Math.max(1024, Math.min(4096, Math.ceil(maximum * 2.1) + 768)),
    instruction: `本轮回复以约 ${target} 个中文可见字符为自然目标，不少于约 ${minimum} 字。接近 ${standard} 字时必须开始收束，只完成已开始的句子、动作和段落，不得开启新话题、新动作、新人物、新地点、时间跳转或新悬念；必要时最多延伸到 ${maximum} 字完成自然结尾。不要解释字数要求，也不要为了凑字重复。`,
  };
}
