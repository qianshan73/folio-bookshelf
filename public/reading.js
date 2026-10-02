import { marked } from "/vendor/marked.js";
import DOMPurify from "/vendor/purify.js";

export function cleanMarkdown(text) {
  const html = DOMPurify.sanitize(marked.parse(text, { gfm: true }), {
    FORBID_TAGS: [
      "style",
      "iframe",
      "form",
      "input",
      "button",
      "video",
      "audio",
      "object",
    ],
    FORBID_ATTR: ["style"],
  });
  const temp = document.createElement("div");
  temp.innerHTML = html;
  temp.querySelectorAll("a").forEach((a) => {
    try {
      const u = new URL(a.getAttribute("href"), location.href);
      if (!["http:", "https:"].includes(u.protocol)) {
        a.removeAttribute("href");
        return;
      }
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } catch {
      a.removeAttribute("href");
    }
  });
  temp.querySelectorAll("img").forEach((img) => {
    const p = document.createElement("span");
    p.className = "helper";
    p.textContent = "[图片：" + (img.alt || "外部图片未加载") + "]";
    img.replaceWith(p);
  });
  return temp.innerHTML;
}
