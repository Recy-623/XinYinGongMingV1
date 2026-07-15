#!/usr/bin/env python3
"""Export one QQ Android NT C2C session from a plaintext snapshot.

This utility deliberately does not locate QQ, attach to a process, derive database
keys, or decrypt a live database.  It accepts a user-owned, already-decrypted
SQLite snapshot and writes only the readable conversation fields needed by
XinYinGongMing.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sqlite3
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, DefaultDict, Iterable


MAX_DATABASE_BYTES = 1024 * 1024 * 1024
MAX_MESSAGE_BLOB_BYTES = 8 * 1024 * 1024
MAX_FIELD_BYTES = 4 * 1024 * 1024
MAX_TEXT_LENGTH = 20_000
CHINA_TIMEZONE = timezone(timedelta(hours=8))
UID_PATTERN = re.compile(r"\bu_[A-Za-z0-9_-]{8,}\b")
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
XML_TEXT_PATTERN = re.compile(r"\b(?:txt|text|title|brief|desc|summary)=([\"'])(.*?)\1", re.IGNORECASE | re.DOTALL)
SAFE_JSON_TEXT_KEYS = {"title", "desc", "description", "prompt", "summary", "tag", "text", "content", "name"}

WIRE_VARINT = 0
WIRE_FIXED64 = 1
WIRE_BYTES = 2
WIRE_FIXED32 = 5


class ExportError(RuntimeError):
    """A safe, user-facing export failure."""


def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    for index in range(10):
        if offset >= len(data):
            raise ExportError("QQ 消息字段在读取整数时意外结束")
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << (index * 7)
        if not byte & 0x80:
            return value, offset
    raise ExportError("QQ 消息包含超出安全范围的整数")


def parse_protobuf(data: bytes) -> DefaultDict[int, list[tuple[int, Any]]]:
    if len(data) > MAX_MESSAGE_BLOB_BYTES:
        raise ExportError("单条 QQ 消息超过 8MB 安全上限")
    fields: DefaultDict[int, list[tuple[int, Any]]] = defaultdict(list)
    offset = 0
    while offset < len(data):
        key, offset = read_varint(data, offset)
        field_number, wire_type = key >> 3, key & 7
        if not field_number or field_number > 536_870_911:
            raise ExportError("QQ 消息包含无效字段编号")
        if wire_type == WIRE_VARINT:
            value, offset = read_varint(data, offset)
        elif wire_type == WIRE_FIXED64:
            end = offset + 8
            if end > len(data):
                raise ExportError("QQ 消息的 64 位字段不完整")
            value, offset = data[offset:end], end
        elif wire_type == WIRE_BYTES:
            size, offset = read_varint(data, offset)
            if size > MAX_FIELD_BYTES:
                raise ExportError("QQ 消息字段超过 4MB 安全上限")
            end = offset + size
            if end > len(data):
                raise ExportError("QQ 消息的文本字段不完整")
            value, offset = data[offset:end], end
        elif wire_type == WIRE_FIXED32:
            end = offset + 4
            if end > len(data):
                raise ExportError("QQ 消息的 32 位字段不完整")
            value, offset = data[offset:end], end
        else:
            raise ExportError(f"QQ 消息包含不受支持的字段类型 {wire_type}")
        fields[field_number].append((wire_type, value))
    return fields


def first_varint(fields: dict[int, list[tuple[int, Any]]], number: int) -> int | None:
    for wire_type, value in fields.get(number, []):
        if wire_type == WIRE_VARINT:
            return int(value)
    return None


def byte_values(fields: dict[int, list[tuple[int, Any]]], number: int) -> Iterable[bytes]:
    for wire_type, value in fields.get(number, []):
        if wire_type == WIRE_BYTES and isinstance(value, bytes):
            yield value


def safe_json_text(value: Any) -> list[str]:
    result: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in SAFE_JSON_TEXT_KEYS and isinstance(child, (str, int, float)):
                result.append(str(child))
            elif isinstance(child, (dict, list)):
                result.extend(safe_json_text(child))
    elif isinstance(value, list):
        for child in value:
            if isinstance(child, (dict, list)):
                result.extend(safe_json_text(child))
    return result


def sanitize_readable_text(value: str) -> str:
    stripped = value.strip()
    if stripped.startswith(("{", "[")):
        try:
            structured = json.loads(stripped)
        except json.JSONDecodeError:
            structured = None
        if structured is not None:
            stripped = unique_join(safe_json_text(structured)) or "[结构化分享消息]"
    if "<" in stripped and ">" in stripped:
        attributes = [html.unescape(match.group(2)) for match in XML_TEXT_PATTERN.finditer(stripped)]
        stripped = unique_join(attributes) or "[QQ 系统消息]"
    stripped = UID_PATTERN.sub("[QQ 用户]", stripped)
    stripped = URL_PATTERN.sub("[链接]", stripped)
    return " ".join(stripped.replace("\x00", " ").split())[:MAX_TEXT_LENGTH]


def readable_text(data: bytes) -> str:
    try:
        value = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return ""
    value = " ".join(value.replace("\x00", " ").split())
    if not value:
        return ""
    printable = sum(character.isprintable() for character in value)
    if printable / len(value) < 0.9:
        return ""
    return sanitize_readable_text(value)


def first_text(fields: dict[int, list[tuple[int, Any]]], number: int) -> str:
    for value in byte_values(fields, number):
        text = readable_text(value)
        if text:
            return text
    return ""


def nested_text(data: bytes, depth: int = 0) -> list[str]:
    """Recover readable notice/application text without retaining binary payloads."""
    direct = readable_text(data)
    if direct:
        return [direct]
    if depth >= 3 or len(data) > MAX_FIELD_BYTES:
        return []
    try:
        fields = parse_protobuf(data)
    except ExportError:
        return []
    values: list[str] = []
    for field_number, entries in fields.items():
        # QQ account identifiers live in the 40020/40021 and 474xx family. They
        # are routing metadata, not conversational content, so never export them.
        if field_number in {40020, 40021, 47403, 47411}:
            continue
        for wire_type, value in entries:
            if wire_type == WIRE_BYTES:
                values.extend(nested_text(value, depth + 1))
    return values


def unique_join(values: Iterable[str], separator: str = " ") -> str:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = " ".join(str(raw).split()).strip()
        if value and value not in seen:
            result.append(value)
            seen.add(value)
    return separator.join(result)[:MAX_TEXT_LENGTH]


def render_element(fields: dict[int, list[tuple[int, Any]]]) -> tuple[int, str]:
    message_type = first_varint(fields, 45002) or 0
    base_text = first_text(fields, 45101)

    if message_type == 1:
        return message_type, base_text or "[文本消息]"
    if message_type == 2:
        caption = unique_join([base_text, first_text(fields, 45815)])
        return message_type, unique_join(["[图片]", caption])
    if message_type == 3:
        file_name = first_text(fields, 45402)
        file_size = first_varint(fields, 45405)
        details = file_name or "未记录文件名"
        if file_size is not None:
            details += f"（{file_size} 字节）"
        return message_type, f"[文件] {details}"
    if message_type == 6:
        emoji = first_text(fields, 47602)
        return message_type, unique_join(["[表情]", emoji or base_text])
    if message_type == 7:
        reply_texts: list[str] = []
        for payload in byte_values(fields, 47423):
            reply_texts.extend(nested_text(payload))
        reply = unique_join(reply_texts)
        return message_type, unique_join(["[回复]", base_text, reply])
    if message_type == 8:
        notice_texts: list[str] = []
        for number in (48214, 48271):
            for payload in byte_values(fields, number):
                notice_texts.extend(nested_text(payload))
        return message_type, unique_join(["[系统提示]", base_text, *notice_texts])
    if message_type == 10:
        application_texts: list[str] = []
        for payload in byte_values(fields, 47901):
            application_texts.extend(nested_text(payload))
        return message_type, unique_join(["[分享/应用消息]", base_text, *application_texts])
    if message_type == 21:
        return message_type, unique_join([
            "[通话]",
            base_text,
            first_text(fields, 48153),
            first_text(fields, 48157),
        ])
    if message_type == 26:
        feed_text = [first_text(fields, number) for number in (48175, 48176, 48180, 48181, 48182, 48183, 48188)]
        return message_type, unique_join(["[动态]", base_text, *feed_text])

    # Types 4/5 occur in some QQ versions with ordinary text in 45101. Keep the
    # evidence but label unknown binary-only variants instead of guessing.
    if base_text:
        return message_type, base_text
    recovered: list[str] = []
    for field_number, entries in fields.items():
        if field_number < 45000 or field_number in {47403, 47411, 45802, 45803, 45804}:
            continue
        for wire_type, value in entries:
            if wire_type == WIRE_BYTES:
                recovered.extend(nested_text(value))
    label = f"[QQ 消息类型 {message_type}]" if message_type else "[无法识别的 QQ 消息]"
    return message_type, unique_join([label, *recovered])


def render_message_blob(blob: bytes) -> tuple[str, list[int], int]:
    top = parse_protobuf(blob)
    payloads = list(byte_values(top, 40800))
    if not payloads:
        return "[无法解析的 QQ 消息]", [], 1
    contents: list[str] = []
    message_types: list[int] = []
    failures = 0
    for payload in payloads:
        try:
            message_type, content = render_element(parse_protobuf(payload))
            message_types.append(message_type)
            if content:
                contents.append(content)
        except ExportError:
            failures += 1
            contents.append("[消息元素解析失败]")
    return unique_join(contents, "\n"), message_types, failures


def validate_name(value: str, label: str) -> str:
    value = " ".join(value.split()).strip()
    if not value or len(value) > 80 or any(unicodedata.category(character).startswith("C") for character in value):
        raise ExportError(f"{label}无效")
    return value


def validate_uid(value: str, label: str) -> str:
    value = value.strip()
    if not (3 <= len(value) <= 128) or any(character.isspace() or unicodedata.category(character).startswith("C") for character in value):
        raise ExportError(f"{label}无效")
    return value


def open_database(path: Path) -> sqlite3.Connection:
    resolved = path.expanduser().resolve(strict=True)
    if not resolved.is_file():
        raise ExportError("输入路径不是数据库文件")
    size = resolved.stat().st_size
    if size < 4096 or size > MAX_DATABASE_BYTES:
        raise ExportError("数据库大小不在 4KB 到 1GB 的安全范围内")
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    connection.execute("PRAGMA query_only = ON")
    required = {"40001", "40020", "40021", "40050", "40800"}
    try:
        columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(c2c_msg_table)")}
        if not required.issubset(columns):
            raise ExportError("数据库不是受支持的 QQ Android NT 消息快照")
        quick_check = connection.execute("PRAGMA quick_check").fetchone()
        if not quick_check or quick_check[0] != "ok":
            raise ExportError("数据库完整性检查失败，请重新复制快照")
    except sqlite3.DatabaseError as error:
        connection.close()
        raise ExportError("无法只读打开数据库；请确认它已经离线解密") from error
    return connection


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    resolved_parent = path.expanduser().resolve().parent
    resolved_parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=".xinyin-qq-", suffix=".json.tmp", dir=resolved_parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path.expanduser().resolve())
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def export_session(arguments: argparse.Namespace) -> dict[str, Any]:
    self_name = validate_name(arguments.self_name, "我的名称")
    peer_name = validate_name(arguments.peer_name, "对方名称")
    self_uid = validate_uid(arguments.self_uid, "我的 UID")
    peer_uid = validate_uid(arguments.peer_uid, "对方 UID")
    if self_uid == peer_uid or self_name == peer_name:
        raise ExportError("双方身份不能相同")

    connection = open_database(Path(arguments.database))
    try:
        rows = connection.execute(
            'SELECT [40001], [40020], [40050], [40800] FROM c2c_msg_table '
            'WHERE [40021] = ? ORDER BY [40050], [40001]',
            (peer_uid,),
        )
        messages: list[dict[str, Any]] = []
        sender_counts: Counter[str] = Counter()
        type_counts: Counter[int] = Counter()
        parse_failures = 0
        for _message_id, sender_uid, timestamp, blob in rows:
            if not isinstance(blob, bytes) or len(blob) > MAX_MESSAGE_BLOB_BYTES:
                content, message_types, failures = "[消息内容缺失或超过安全上限]", [], 1
            else:
                try:
                    content, message_types, failures = render_message_blob(blob)
                except ExportError:
                    content, message_types, failures = "[QQ 消息解析失败]", [], 1
            if sender_uid == self_uid:
                sender = self_name
            elif sender_uid == peer_uid:
                sender = peer_name
            else:
                sender = "QQ 系统"
            try:
                time_value = datetime.fromtimestamp(int(timestamp), CHINA_TIMEZONE).isoformat(timespec="seconds")
            except (OverflowError, OSError, TypeError, ValueError):
                time_value = ""
                failures += 1
            messages.append({"sender": sender, "time": time_value, "content": content[:MAX_TEXT_LENGTH]})
            sender_counts[sender] += 1
            type_counts.update(message_types)
            parse_failures += failures
    finally:
        connection.close()

    if len(messages) < 3:
        raise ExportError("没有找到足够的目标会话消息，请核对对方 UID")
    payload: dict[str, Any] = {
        "format": "xinyin.qq.android.nt.v1",
        "platform": "QQ Android NT",
        "participants": [
            {"name": self_name, "count": sender_counts[self_name], "role": "self"},
            {"name": peer_name, "count": sender_counts[peer_name], "role": "other"},
        ],
        "coverage": {
            "totalMessages": len(messages),
            "systemMessages": sender_counts["QQ 系统"],
            "parseFailures": parse_failures,
            "messageTypeCounts": {str(key): value for key, value in sorted(type_counts.items())},
        },
        "messages": messages,
    }
    write_json_atomic(Path(arguments.output), payload)
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="只读导出 QQ Android NT 单聊到心印共鸣格式")
    parser.add_argument("--database", required=True, help="已经离线解密的 nt_msg.db 快照")
    parser.add_argument("--self-uid", required=True, help="自己的 QQ NT UID")
    parser.add_argument("--peer-uid", required=True, help="对方的 QQ NT UID")
    parser.add_argument("--self-name", required=True, help="导出时显示的自己的名称")
    parser.add_argument("--peer-name", required=True, help="导出时显示的对方名称")
    parser.add_argument("--output", required=True, help="输出 JSON 文件")
    return parser


def main() -> int:
    try:
        payload = export_session(build_parser().parse_args())
    except (ExportError, FileNotFoundError, PermissionError, sqlite3.Error) as error:
        print(f"导出失败：{error}", file=sys.stderr)
        return 1
    coverage = payload["coverage"]
    print(
        f"导出完成：{coverage['totalMessages']} 条；"
        f"系统消息 {coverage['systemMessages']} 条；"
        f"解析异常 {coverage['parseFailures']} 处。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


