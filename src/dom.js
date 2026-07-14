import { defaultAvatar } from "./constants.js";

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setAvatar(image, source) {
  image.src = source || defaultAvatar;
  image.onerror = () => { image.onerror = null; image.src = defaultAvatar; };
}

export function clear(node) {
  node.replaceChildren();
}

export function addOption(select, value, label = value) {
  const option = element("option", "", label);
  option.value = value;
  select.append(option);
}

export function downloadJson(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readFileAsText(file, maxBytes = 5 * 1024 * 1024) {
  if (!file || file.size > maxBytes) return Promise.reject(new Error("文件为空或超过 5MB 限制"));
  return file.text();
}
