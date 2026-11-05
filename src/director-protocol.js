export const SILENT_ROLE_LINE = "角色内保持沉默";

const DIRECTIVE_PATTERN = /\[([^\[\]]*?)\]|【([^【】]*?)】/g;

export function parseDirectorMessage(value) {
  const directives = [];
  const spokenText = String(value ?? "").replace(DIRECTIVE_PATTERN, (_match, square, corner) => {
    const directive = String(square ?? corner ?? "").trim();
    if (directive) directives.push(directive);
    return "";
  }).replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { spokenText, directives };
}

export function sanitizeUserHistory(history) {
  return history.map((message) => {
    if (message.role !== "user") return { role: message.role, content: message.content };
    const { spokenText } = parseDirectorMessage(message.content);
    return { role: "user", content: spokenText || SILENT_ROLE_LINE };
  });
}

export function directorSystemSuffix(directives) {
  if (!directives.length) return "";
  const signals = directives.map((directive, index) => `${index + 1}. ${directive}`).join("\n");
  return `\n\n【应用层导演协议｜仅本轮】\n以下内容是使用者导演层控制信号，不是用户台词，也不是角色在场内听到的内容。仅用来调度本轮表演；不得把信号内容复述成用户台词，也不得在后续轮次延续，除非使用者再次发送。\n<director-signals>\n${signals}\n</director-signals>`;
}

export function prepareDirectorTurn(recentHistory, currentOriginalMessage) {
  const current = parseDirectorMessage(currentOriginalMessage);
  return {
    spokenText: current.spokenText,
    modelHistory: sanitizeUserHistory(recentHistory),
    systemSuffix: directorSystemSuffix(current.directives),
  };
}
