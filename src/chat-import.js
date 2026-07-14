const DATE = String.raw`(?:20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)`;
const TIME = String.raw`(?:\d{1,2}:\d{2}(?::\d{2})?)`;

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
}

function normalizeTime(value) {
  return clean(value).replace(/[年月]/g, "-").replace(/日/g, "").replace(/\//g, "-");
}

function validMessage(sender, content) {
  if (!sender || !content || sender.length > 100 || content.length > 20_000) return false;
  return !/^(系统消息|消息分组|消息对象|日期|时间)$/i.test(sender);
}

function findMessageArray(root) {
  if (Array.isArray(root)) return root;
  const queue = [{ value: root, depth: 0 }];
  const preferred = ["messages", "messageList", "results", "records", "data", "items", "msgList"];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || depth > 4) continue;
    for (const key of preferred) {
      const child = value[key];
      if (Array.isArray(child) && child.some((item) => item && typeof item === "object" && ("content" in item || "message" in item || "msg" in item || "elements" in item))) return child;
      if (child && typeof child === "object" && !Array.isArray(child)) queue.push({ value: child, depth: depth + 1 });
    }
  }
  return [];
}

function structuredContent(item) {
  const direct = item?.content ?? item?.text ?? item?.message ?? item?.msg ?? item?.content_text ?? item?.msgContent;
  if (typeof direct === "string" || typeof direct === "number") return clean(direct);
  if (!Array.isArray(item?.elements)) return "";
  return clean(item.elements.map((element) => element?.textElement?.content ?? element?.replyElement?.text ?? element?.faceElement?.faceText ?? element?.marketFaceElement?.faceName ?? element?.fileElement?.fileName ?? element?.picElement?.summary ?? "").filter(Boolean).join(" "));
}

function parseStructured(root) {
  const candidates = findMessageArray(root);
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((item) => {
    const senderObject = item?.sender && typeof item.sender === "object" ? item.sender : {};
    const scalarSender = typeof item?.sender === "string" || typeof item?.sender === "number" ? item.sender : "";
    const sender = clean(item?.is_sender === true || item?.isSelf === true ? "我" : item?.senderName ?? item?.sender_display ?? item?.sendMemberName ?? item?.sendNickName ?? senderObject.cardName ?? senderObject.nickname ?? senderObject.memberName ?? senderObject.uin ?? item?.nickname ?? item?.name ?? item?.from ?? item?.senderUin ?? scalarSender);
    const content = structuredContent(item);
    const rawTime = item?.time ?? item?.timestamp ?? item?.createTime ?? item?.date ?? item?.time_str ?? item?.msgTime ?? "";
    const time = typeof rawTime === "number" ? new Date(rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime).toISOString() : normalizeTime(rawTime);
    return validMessage(sender, content) ? [{ sender, content, time }] : [];
  });
}

function declaredParticipants(root, messages) {
  if (!root || typeof root !== "object" || !Array.isArray(root.participants)) return [];
  const messageCounts = new Map();
  messages.forEach((message) => messageCounts.set(message.sender, (messageCounts.get(message.sender) || 0) + 1));
  return root.participants.flatMap((participant) => {
    if (!participant || typeof participant !== "object") return [];
    const name = clean(participant.name ?? participant.nickname ?? participant.displayName);
    const role = participant.role === "self" || participant.role === "other" ? participant.role : "";
    return name && messageCounts.has(name) ? [{ name, count: messageCounts.get(name), role }] : [];
  });
}

function htmlToText(source) {
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  documentNode.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  documentNode.querySelectorAll("p,div,li,tr").forEach((node) => node.append("\n"));
  return documentNode.body?.textContent || "";
}

function parseLines(source) {
  const lines = source.split(/\n/).map(clean).filter(Boolean);
  const messages = [];
  let current = null;
  const inlinePatterns = [
    new RegExp(`^\\[?(${DATE}\\s+${TIME})\\]?\\s*[-—]?\\s*([^:：]{1,100})[:：]\\s*(.+)$`),
    new RegExp(`^([^:：]{1,100})\\s+[\\[(]?(${DATE}\\s+${TIME})[\\])]?[：:]?\\s*(.*)$`),
  ];
  const headerPatterns = [
    new RegExp(`^(${DATE}\\s+${TIME})\\s+(.{1,100})$`),
    new RegExp(`^(.{1,100})\\s+(${DATE}\\s+${TIME})$`),
  ];

  const flush = () => {
    if (current && validMessage(current.sender, current.parts.join("\n"))) {
      messages.push({ sender: current.sender, time: current.time, content: current.parts.join("\n") });
    }
    current = null;
  };

  for (const line of lines) {
    if (/^(消息分组|消息对象|导出时间|聊天记录)/.test(line)) continue;
    let matched = false;
    for (const pattern of inlinePatterns) {
      const match = line.match(pattern);
      if (!match) continue;
      flush();
      if (/^20\d{2}/.test(match[1])) current = { time: normalizeTime(match[1]), sender: clean(match[2]), parts: [clean(match[3])] };
      else current = { sender: clean(match[1]), time: normalizeTime(match[2]), parts: [clean(match[3])] };
      matched = true; break;
    }
    if (matched) continue;
    for (const pattern of headerPatterns) {
      const match = line.match(pattern);
      if (!match) continue;
      flush();
      if (/^20\d{2}/.test(match[1])) current = { time: normalizeTime(match[1]), sender: clean(match[2]), parts: [] };
      else current = { sender: clean(match[1]), time: normalizeTime(match[2]), parts: [] };
      matched = true; break;
    }
    if (!matched && current) current.parts.push(line);
  }
  flush();
  return messages;
}

function detectPlatform(fileName, content) {
  const sample = `${fileName}\n${content.slice(0, 5000)}`;
  if (/QQ|腾讯QQ|消息分组|消息对象/i.test(sample)) return "QQ";
  if (/微信|WeChat|wxid_/i.test(sample)) return "微信";
  return "微信/QQ";
}

export async function parseChatFile(file) {
  if (!file || file.size > 50 * 1024 * 1024) throw new Error("请选择 50MB 以内的微信或 QQ 导出文件");
  let content = await file.text();
  let messages = [];
  let structuredRoot = null;
  if (/\.json$/i.test(file.name) || /^[\s\r\n]*[\[{]/.test(content)) {
    try { structuredRoot = JSON.parse(content); messages = parseStructured(structuredRoot); } catch { /* fall through to text parser */ }
  }
  if (!messages.length) {
    if (/\.(html?|mht|mhtml)$/i.test(file.name) || /<html|<body|<div/i.test(content.slice(0, 1000))) content = htmlToText(content);
    messages = parseLines(content);
  }
  if (messages.length < 3) throw new Error("没有识别到足够的对话。请选择微信/QQ客户端导出或复制保存的聊天记录文件。");
  const declared = declaredParticipants(structuredRoot, messages);
  const declaredNames = new Set(declared.map((participant) => participant.name));
  const participants = declared.concat([...new Set(messages.map((message) => message.sender))]
    .filter((name) => !declaredNames.has(name))
    .map((name) => ({ name, count: messages.filter((message) => message.sender === name).length }))
    .sort((a, b) => b.count - a.count));
  const declaredPlatform = clean(structuredRoot?.platform);
  const platform = declaredPlatform && declaredPlatform.length <= 80 ? declaredPlatform : detectPlatform(file.name, content);
  return { platform, fileName: file.name, messages, participants };
}

export function selectRepresentativeMessages(messages, selfName, otherName, maxMessages = 1600) {
  const relevant = messages.filter((message) => message.sender === selfName || message.sender === otherName);
  if (relevant.length <= maxMessages) return relevant;
  const selected = [];
  const stride = relevant.length / maxMessages;
  for (let index = 0; index < maxMessages; index += 1) selected.push(relevant[Math.floor(index * stride)]);
  return selected;
}
