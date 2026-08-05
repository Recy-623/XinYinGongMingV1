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

export async function downloadJson(filename, content) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      return await invoke("export_json_file", { filename, content });
    } catch (error) {
      alert(`导出失败：${error?.message || error || "无法写入所选位置"}`);
      return false;
    }
  }
  const file = new File([content], filename, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function readFileAsText(file, maxBytes = 5 * 1024 * 1024) {
  if (!file || file.size > maxBytes) return Promise.reject(new Error("文件为空或超过 5MB 限制"));
  return file.text();
}
