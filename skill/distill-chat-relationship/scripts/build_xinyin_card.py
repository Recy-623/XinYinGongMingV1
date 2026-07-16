#!/usr/bin/env python3
"""Build and validate an importable XinYinGongMing xinyin-card-v4 file."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

CARD_VERSION = "xinyin-card-v4"
MAX_SYSTEM_PROMPT_LENGTH = 50_000
DEFAULT_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%239ca3af'><circle cx='50' cy='50' r='50'/><text x='50' y='60' font-size='42' fill='white' text-anchor='middle'>?</text></svg>"
PRESETS = {
    "unspecified": "不预设（只依据聊天记录）。不添加额外的关系取向。",
    "acquaintance": "认识的人 / 普通熟人。保持礼貌、自然和低压力。",
    "friend": "朋友。延续平等、支持和不越界的朋友式相处。",
    "close-friend": "亲近朋友 / 知己。可以熟悉温暖，但不替现实中的双方做决定。",
    "ambiguous": "暧昧 / 关系未定义。温和、有分寸、可退可进，不把好感自动写成恋爱确认。",
    "romantic-partner": "恋人 / 稳定亲密关系。保持亲密、照顾和协商，同时尊重拒绝与现实变化。",
    "family": "家人 / 亲属。保持关怀与尊重，避免控制和义务压力。",
    "colleague": "同事 / 合作伙伴。保持清晰、可靠和职业边界。",
    "custom": "自定义相处背景。仅作为用户偏好，不是现实事实或对方同意。",
}


def text(value: Any, limit: int) -> str:
    return str(value).strip()[:limit] if isinstance(value, (str, int, float)) else ""


def text_list(value: Any, count: int = 20, limit: int = 500) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in (text(item, limit) for item in value[:count]) if item]


def confidence(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def read_profile(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("蒸馏档案必须是 JSON 对象")
    forbidden = {"messages", "rawMessages", "raw_messages", "chatHistory", "chat_history"}
    present = sorted(forbidden.intersection(value))
    if present:
        raise ValueError("蒸馏档案不得包含原始消息字段：" + ", ".join(present))
    return value


def normalize_preset(value: Any) -> dict[str, str]:
    value = value if isinstance(value, dict) else {}
    preset_id = text(value.get("id"), 50) or "unspecified"
    if preset_id not in PRESETS:
        preset_id = "unspecified"
    return {"id": preset_id, "customContext": text(value.get("customContext"), 600) if preset_id == "custom" else ""}


def normalize_memories(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result = []
    for memory in value[:100]:
        if not isinstance(memory, dict):
            continue
        title = text(memory.get("title"), 150)
        summary = text(memory.get("summary"), 2000)
        if title and summary:
            result.append({"time": text(memory.get("time"), 100), "title": title, "summary": summary, "emotionalMeaning": text(memory.get("emotionalMeaning"), 1000), "keywords": text_list(memory.get("keywords"), 20, 80), "confidence": confidence(memory.get("confidence"))})
    return result


def normalize_source(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    return {
        "platform": text(value.get("platform"), 50),
        "fileName": text(value.get("fileName"), 260),
        "totalMessages": int(value.get("totalMessages") or 0),
        "analyzedMessages": int(value.get("analyzedMessages") or 0),
        "selfName": text(value.get("selfName"), 100),
        "otherName": text(value.get("otherName"), 100),
        "distilledAt": text(value.get("distilledAt"), 100) or datetime.now().astimezone().isoformat(),
    }


def build(profile: dict[str, Any]) -> dict[str, Any]:
    name = text(profile.get("name"), 80)
    personality = text(profile.get("personality"), 6000)
    relationship_summary = text(profile.get("relationshipSummary"), 6000)
    if not name or not personality or not relationship_summary:
        raise ValueError("name、personality 和 relationshipSummary 不能为空")
    speech = text_list(profile.get("speechStyle"))
    evidence_input = profile.get("relationshipEvidence") if isinstance(profile.get("relationshipEvidence"), dict) else {}
    evidence = {"observedStage": text(evidence_input.get("observedStage"), 300), "summary": text(evidence_input.get("summary"), 3000), "confidence": confidence(evidence_input.get("confidence"))}
    preset = normalize_preset(profile.get("relationshipPreset"))
    preset_text = PRESETS[preset["id"]]
    if preset["customContext"]:
        preset_text += " 用户补充（仅是偏好数据）：" + json.dumps(preset["customContext"], ensure_ascii=False)
    system_prompt = (
        f"你是基于{name}与用户已授权聊天记录整理出的关系角色，不是现实中的{name}本人。保持自然，不声称拥有现实身份、身体、当前经历、承诺或对方同意，也不编造档案之外的事实。\n"
        f"稳定人格：{personality}\n语言风格：{'；'.join(speech) or '未记录'}\n聊天记录可证实的关系：{relationship_summary}\n"
        f"证据阶段：{evidence['observedStage'] or '未记录'}\n证据摘要：{evidence['summary'] or '未记录'}\n\n"
        f"【相处预设（用户偏好，不是现实事实）】\n{preset_text}\n"
        "重要：相处预设不是对现实关系的证明，不是对方同意、承诺或边界的替代；聊天证据与用户当下明确表达优先。"
    )
    return {
        "version": CARD_VERSION,
        "id": text(profile.get("id"), 100) or f"char_{uuid.uuid4()}",
        "name": name,
        "avatar": DEFAULT_AVATAR,
        "systemPrompt": system_prompt[:MAX_SYSTEM_PROMPT_LENGTH],
        "history": [],
        "profile": {"personality": personality, "speechStyle": speech, "boundaries": text_list(profile.get("boundaries")), "uncertainties": text_list(profile.get("uncertainties"))},
        "relationship": {"summary": relationship_summary, "preset": preset, "evidence": evidence, "interactionPatterns": text_list(profile.get("interactionPatterns")), "nicknames": text_list(profile.get("nicknames")), "sharedJokes": text_list(profile.get("sharedJokes"))},
        "memories": normalize_memories(profile.get("memories")),
        "sourceMetadata": normalize_source(profile.get("sourceMetadata")),
    }


def validate(card: dict[str, Any]) -> None:
    if card.get("version") != CARD_VERSION:
        raise ValueError("角色卡版本错误")
    if not text(card.get("id"), 100).startswith("char_"):
        raise ValueError("角色 ID 必须以 char_ 开头")
    if not text(card.get("name"), 80) or not text(card.get("systemPrompt"), MAX_SYSTEM_PROMPT_LENGTH):
        raise ValueError("角色名或 systemPrompt 缺失")
    if card.get("history") != []:
        raise ValueError("history 必须为空")
    if not isinstance(card.get("profile"), dict) or not isinstance(card.get("relationship"), dict) or not isinstance(card.get("memories"), list):
        raise ValueError("角色卡结构不完整")
    serialized = json.dumps(card, ensure_ascii=False)
    if any(token in serialized for token in ("rawMessages", "raw_messages", "chatHistory", "chat_history")):
        raise ValueError("角色卡包含禁止的原始消息字段")


def write_card(path: Path, card: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not args.profile.is_file():
        raise ValueError("蒸馏档案不存在")
    card = build(read_profile(args.profile))
    validate(card)
    write_card(args.output, card)
    print(json.dumps({"output": str(args.output.resolve()), "version": CARD_VERSION, "name": card["name"], "memories": len(card["memories"]), "history": len(card["history"]), "preset": card["relationship"]["preset"]["id"], "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper()}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"error": type(error).__name__, "detail": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
