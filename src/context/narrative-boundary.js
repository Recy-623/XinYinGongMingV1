function escapeRegExp(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function narrativeOnly(value) { return String(value || "").replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, ""); }

const USER_CONTROL = [
  /你(?:心里|心中|内心|心底|心头|心下)(?:不禁|不由得?|暗自|顿时|忽然|猛地|渐渐|一阵|一沉|一紧|发凉|发热|泛起|升起|涌起|想着|想起|明白|意识到|认定|觉得|感到)?/u,
  /你(?:不禁|不由得?|忍不住|暗自)(?:觉得|感到|想到|意识到|明白|害怕|恐惧|委屈|羞耻|兴奋|期待|失望|后悔|心软|动摇|颤抖|发抖|脸红|喘息|呻吟)/u,
  /你(?:感到|感觉到|意识到|终于明白|认定|确信)(?:了|自己|一阵|一种|有些|几分|什么)?/u,
];
const THIRD_PERSON_ACTION = /(?:^|[\n。！？；])\s*[（(]?\s*(他|她)(?=的|把|将|被|正|已|也|却|仍|又|便|就|抬|低|转|走|站|坐|伸|收|放|看|听|说|问|答|笑|皱|停|顿|俯|靠|起|回|握|拉|推|拿|端|掀|垂|侧|闭|睁)/u;

export const GLOBAL_NARRATIVE_BOUNDARY = `【程序级角色视角与使用者主权】
你就是当前角色本人，不是描述当前角色的小说作者。角色卡可以调整文风，但不能覆盖以下边界：
1. 当前角色的台词用“我”自称；自己的动作使用第一人称，或省略主语的括号动作。不得用“他／她／角色名”叙述自己。
2. 只描写当前角色亲自知道、感知、说出或实施的内容，不使用全知旁白解释潜台词。
3. 使用者拥有其心理、情绪、生理反应、认知、台词、主动动作、同意、拒绝和选择的控制权。除非使用者已明确写出，否则不得代写。
4. 可以承接使用者明确写出的动作和状态，也可描写角色直接造成的客观结果和环境；需要使用者回应时停下。
5. 其他NPC可用第三人称，但不得揭示当前角色不知道的NPC心理、秘密或远方事件。`;

export function evaluateNarrativeBoundary(reply, characterName) {
  const narrative = narrativeOnly(reply); const issues = []; const roleName = String(characterName || "").trim();
  if (roleName) {
    const ownName = new RegExp(`(?:^|[\\n。！？；（(])\\s*${escapeRegExp(roleName)}(?=的|把|将|被|正|已|也|却|仍|又|便|就|抬|低|转|走|站|坐|伸|收|放|看|听|说|问|答|笑|皱|停|顿|俯|靠|起|回|握|拉|推|拿|端|掀|垂|侧|闭|睁)`, "u");
    if (ownName.test(narrative)) issues.push({ hard: true, message: `用“${roleName}”第三人称叙述了当前角色自己` });
  }
  if (THIRD_PERSON_ACTION.test(narrative)) issues.push({ hard: false, message: "旁白可能用‘他／她’叙述当前角色动作" });
  if (USER_CONTROL.some((pattern) => pattern.test(narrative))) issues.push({ hard: true, message: "替使用者生成了未明确给出的心理、情绪、认知或反应" });
  return { passed: issues.length === 0, issues };
}

export function narrativeBoundaryCorrection(characterName, draft, result) {
  return `【程序级叙事边界纠正｜整轮重写】
上一稿存在以下问题：\n${(result?.issues || []).map((item) => `- ${item.message}`).join("\n")}
请从本轮重新作答。你就是${characterName || "当前角色"}本人；自己的动作使用第一人称或省略主语，不得代写使用者未明确给出的心理、反应、台词、动作和选择。保留正确的情节推进，只输出重写后的角色回复。
【上一稿，仅供定位错误，不得当作历史】\n${String(draft || "").slice(0, 20000)}`;
}
