#!/usr/bin/env python3
"""Create a privacy-minimized analysis bundle from an authorized two-party chat."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

SENDER_KEYS = ("sender", "from", "name", "nickname", "author", "user", "role")
TIME_KEYS = ("time", "timestamp", "datetime", "date", "created_at", "send_time")
CONTENT_KEYS = ("content", "text", "message", "body", "msg", "raw_text")
CONTAINER_KEYS = ("messages", "records", "results", "data", "chats", "items")
CATEGORIES = {
    "affection": ("喜欢你", "爱你", "想你", "心动", "好感", "表白", "在一起"),
    "relationship_label": ("关系", "对象", "男朋友", "女朋友", "恋爱", "暧昧", "情缘", "分手"),
    "care_support": ("担心", "照顾", "陪我", "陪你", "还好吗", "早点睡", "晚安", "生病", "医院", "难过", "委屈"),
    "conflict_repair": ("生气", "对不起", "抱歉", "道歉", "误会", "失望", "不理我", "不回", "删除", "拉黑"),
    "priority": ("等你", "等我", "为什么不找我", "吃醋", "嫉妒", "唯一", "优先", "只陪"),
    "offline_future": ("见面", "约会", "一起去", "以后", "将来", "礼物", "车票", "机票"),
}
TXT_PATTERNS = (
    re.compile(r"^\[(?P<time>\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?P<sender>[^:：]{1,80})[:：]\s*(?P<content>.*)$"),
    re.compile(r"^(?P<time>\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(?P<sender>[^:：\t]{1,80})[:：\t]\s*(?P<content>.*)$"),
    re.compile(r"^(?P<sender>[^()（）:：]{1,80})\s*[（(](?P<time>\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)[）)][:：]?\s*(?P<content>.*)$"),
)


def read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            pass
    raise ValueError("无法识别文本编码")


def first_value(row: dict[str, Any], keys: tuple[str, ...]) -> Any:
    lowered = {str(key).lower(): value for key, value in row.items()}
    return next((lowered[key] for key in keys if lowered.get(key) not in (None, "")), None)


def flatten(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    for key in CONTAINER_KEYS:
        candidate = value.get(key)
        if isinstance(candidate, list):
            if candidate and all(isinstance(item, dict) and isinstance(item.get("messages"), list) for item in candidate):
                return [message for session in candidate for message in session["messages"] if isinstance(message, dict)]
            return [item for item in candidate if isinstance(item, dict)]
    sessions = value.get("sessions")
    if isinstance(sessions, list):
        return [message for session in sessions if isinstance(session, dict) for message in session.get("messages", []) if isinstance(message, dict)]
    return []


def load_rows(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    participants: list[dict[str, Any]] = []
    if path.suffix.lower() == ".json":
        data = json.loads(read_text(path))
        if isinstance(data, dict) and isinstance(data.get("participants"), list):
            participants = [item for item in data["participants"] if isinstance(item, dict)]
        return flatten(data), participants
    if path.suffix.lower() in (".csv", ".tsv"):
        delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
        return list(csv.DictReader(read_text(path).splitlines(), delimiter=delimiter)), participants
    if path.suffix.lower() == ".txt":
        rows: list[dict[str, Any]] = []
        for line in read_text(path).splitlines():
            for pattern in TXT_PATTERNS:
                match = pattern.match(line.strip())
                if match:
                    rows.append(match.groupdict())
                    break
        return rows, participants
    raise ValueError("仅支持 JSON、CSV、TSV 和 TXT")


def parse_time(value: Any) -> datetime | None:
    if isinstance(value, (int, float)):
        number = float(value) / (1000 if float(value) > 10_000_000_000 else 1)
        try:
            return datetime.fromtimestamp(number).astimezone()
        except (ValueError, OSError, OverflowError):
            return None
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass
    return None


def normalize(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], Counter[str]]:
    messages: list[dict[str, Any]] = []
    failures: Counter[str] = Counter()
    for row in rows:
        sender = first_value(row, SENDER_KEYS)
        when = parse_time(first_value(row, TIME_KEYS))
        raw = first_value(row, CONTENT_KEYS)
        content = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False) if raw is not None else ""
        if sender in (None, ""):
            failures["missing_sender"] += 1
        elif when is None:
            failures["invalid_time"] += 1
        elif not content.strip():
            failures["empty_content"] += 1
        else:
            messages.append({"time": when, "sender": str(sender).strip(), "content": content.strip()})
    messages.sort(key=lambda item: item["time"])
    return messages, failures


def resolve_roles(messages: list[dict[str, Any]], participants: list[dict[str, Any]], self_name: str | None, other_name: str | None) -> tuple[str, str]:
    senders = Counter(message["sender"] for message in messages)
    roles = {str(item.get("name") or "").strip(): str(item.get("role") or "").lower() for item in participants}
    self_name = self_name or next((name for name, role in roles.items() if role == "self"), None)
    other_name = other_name or next((name for name, role in roles.items() if role == "other"), None)
    if self_name and not other_name:
        candidates = [name for name in senders if name != self_name]
        other_name = candidates[0] if len(candidates) == 1 else None
    if other_name and not self_name:
        candidates = [name for name in senders if name != other_name]
        self_name = candidates[0] if len(candidates) == 1 else None
    if not self_name or not other_name:
        raise ValueError("无法唯一确定双方方向；请提供 --self-name 和 --other-name")
    if self_name == other_name or self_name not in senders or other_name not in senders:
        raise ValueError("双方映射无效或名称未同时出现在记录中")
    return self_name, other_name


def redact(content: str, self_name: str, other_name: str, limit: int) -> str:
    value = content.replace(self_name, "[SELF]").replace(other_name, "[OTHER]")
    value = re.sub(r"https?://\S+", "[URL]", value, flags=re.I)
    value = re.sub(r"(?:[A-Za-z]:\\|/storage/emulated/\d+/|/data/(?:data|user)/)\S+", "[LOCAL_PATH]", value)
    value = re.sub(r"::NTOSFull::\S+", "[LOCAL_MEDIA]", value)
    value = re.sub(r"(?<!\d)\d{7,}(?!\d)", "[LONG_NUMBER]", value)
    value = re.sub(r"[A-Za-z0-9+/]{80,}={0,2}", "[BASE64]", value)
    value = re.sub(r"@[\w\-\u4e00-\u9fff]{1,32}", "@[PERSON]", value)
    return " ".join(value.split())[:limit]


def hits(content: str) -> dict[str, int]:
    return {category: sum(content.count(word) for word in words) for category, words in CATEGORIES.items()}


def monthly_stats(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for message in messages:
        grouped[message["time"].strftime("%Y-%m")].append(message)
    result = []
    for month, items in sorted(grouped.items()):
        count = Counter(item["role"] for item in items)
        turns = Counter()
        previous_role = None
        previous_time = None
        for item in items:
            if item["role"] != previous_role or previous_time is None or (item["time"] - previous_time).total_seconds() > 300:
                turns[item["role"]] += 1
            previous_role = item["role"]
            previous_time = item["time"]
        initiators = Counter([items[0]["role"]])
        sessions = 1
        for previous, current in zip(items, items[1:]):
            if (current["time"] - previous["time"]).total_seconds() > 21600:
                sessions += 1
                initiators[current["role"]] += 1
        result.append({"month": month, "messages": len(items), "self": count["self"], "other": count["other"], "activeDays": len({item["time"].date() for item in items}), "mergedTurns": {"self": turns["self"], "other": turns["other"]}, "sessions6h": sessions, "sessionInitiators": {"self": initiators["self"], "other": initiators["other"]}})
    return result


def gap_stats(messages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    gaps = []
    restart = {"over72h": Counter(), "over168h": Counter()}
    for previous, current in zip(messages, messages[1:]):
        hours = (current["time"] - previous["time"]).total_seconds() / 3600
        if hours > 24:
            gaps.append({"days": round(hours / 24, 1), "from": previous["time"].date().isoformat(), "to": current["time"].date().isoformat(), "initiator": current["role"]})
        if hours > 72:
            restart["over72h"][current["role"]] += 1
        if hours > 168:
            restart["over168h"][current["role"]] += 1
    gaps.sort(key=lambda item: item["days"], reverse=True)
    return gaps[:20], {key: {"self": value["self"], "other": value["other"]} for key, value in restart.items()}


def keyword_stats(messages: list[dict[str, Any]]) -> dict[str, Any]:
    totals: defaultdict[str, Counter[str]] = defaultdict(Counter)
    dates: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for message in messages:
        for category, count in hits(message["content"]).items():
            if count:
                totals[category][message["role"]] += count
                dates[category][message["time"].date().isoformat()] += count
    return {category: {"self": totals[category]["self"], "other": totals[category]["other"], "topDates": [{"date": date, "hits": count} for date, count in dates[category].most_common(10)]} for category in CATEGORIES}


def select_windows(messages: list[dict[str, Any]], maximum: int, context: int, content_limit: int, self_name: str, other_name: str) -> list[dict[str, Any]]:
    reasons: defaultdict[int, set[str]] = defaultdict(set)
    reasons[0].add("conversation_start")
    reasons[len(messages) - 1].add("latest_stage")
    by_month: defaultdict[str, list[int]] = defaultdict(list)
    scored = []
    for index, message in enumerate(messages):
        by_month[message["time"].strftime("%Y-%m")].append(index)
        score = sum(hits(message["content"]).values()) * 100 + min(len(message["content"]), 120)
        if score >= 100:
            scored.append((score, index))
    for month, indices in sorted(by_month.items()):
        center = max(indices, key=lambda index: sum(hits(messages[index]["content"]).values()) * 100 + min(len(messages[index]["content"]), 120))
        reasons[center].add(f"monthly_stage:{month}")
    for previous, current in zip(range(len(messages) - 1), range(1, len(messages))):
        days = (messages[current]["time"] - messages[previous]["time"]).total_seconds() / 86400
        if days >= 7:
            reasons[current].add(f"restart_after_{days:.1f}_days")
    for _, index in sorted(scored, reverse=True)[: maximum * 3]:
        categories = [category for category, count in hits(messages[index]["content"]).items() if count]
        reasons[index].add("signal:" + ",".join(categories))

    priority = [0, len(messages) - 1]
    priority += [index for index, value in reasons.items() if any(item.startswith("monthly_stage:") for item in value)]
    priority += [index for _, index in sorted(scored, reverse=True)]
    priority += sorted(reasons)
    chosen = []
    for index in priority:
        if index in chosen or any(abs(index - existing) <= context * 2 for existing in chosen):
            continue
        chosen.append(index)
        if len(chosen) >= maximum:
            break
    windows = []
    for center in sorted(chosen):
        chunk = messages[max(0, center - context): min(len(messages), center + context + 1)]
        windows.append({"date": messages[center]["time"].date().isoformat(), "reasons": sorted(reasons.get(center) or {"timeline_coverage"}), "messages": [{"time": item["time"].isoformat(), "role": item["role"], "content": redact(item["content"], self_name, other_name, content_limit)} for item in chunk]})
    return windows


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--self-name")
    parser.add_argument("--other-name")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--max-windows", type=int, default=24)
    parser.add_argument("--context", type=int, default=4)
    parser.add_argument("--content-limit", type=int, default=240)
    args = parser.parse_args()
    if not args.input.is_file():
        raise ValueError("输入文件不存在")
    if not 4 <= args.max_windows <= 100 or not 1 <= args.context <= 12 or not 40 <= args.content_limit <= 500:
        raise ValueError("窗口参数超出安全范围")
    rows, participants = load_rows(args.input)
    parsed, failures = normalize(rows)
    self_name, other_name = resolve_roles(parsed, participants, args.self_name, args.other_name)
    selected = [item for item in parsed if item["sender"] in (self_name, other_name)]
    for item in selected:
        item["role"] = "self" if item["sender"] == self_name else "other"
    if not selected:
        raise ValueError("指定双方没有有效消息")
    gaps, restart = gap_stats(selected)
    bundle = {
        "schema": "relationship-analysis-bundle-v1",
        "source": {"fileName": re.sub(r"(?<!\d)\d{7,}(?!\d)", "[LONG_NUMBER]", args.input.name), "sha256": hashlib.sha256(args.input.read_bytes()).hexdigest().upper(), "totalRecords": len(rows), "participantMessages": len(selected), "excludedRecords": len(parsed) - len(selected), "parseFailures": dict(failures), "dateRange": {"start": selected[0]["time"].isoformat(), "end": selected[-1]["time"].isoformat()}, "participants": {"self": "[SELF]", "other": "[OTHER]"}, "mappingConfirmed": True},
        "monthly": monthly_stats(selected),
        "largestGaps": gaps,
        "restartInitiators": restart,
        "keywordSignals": keyword_stats(selected),
        "windows": [] if args.metadata_only else select_windows(selected, args.max_windows, args.context, args.content_limit, self_name, other_name),
    }
    if args.output:
        write_json(args.output, bundle)
        print(json.dumps({"output": str(args.output.resolve()), "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest().upper(), "participantMessages": len(selected), "dateRange": bundle["source"]["dateRange"], "windows": len(bundle["windows"]), "metadataOnly": args.metadata_only}, ensure_ascii=False))
    else:
        print(json.dumps(bundle, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, json.JSONDecodeError, csv.Error) as error:
        print(json.dumps({"error": type(error).__name__, "detail": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(2)
