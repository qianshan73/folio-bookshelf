import DOMPurify from "/vendor/purify.js";
import { cleanMarkdown } from "/reading.js";

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const id = new URLSearchParams(location.search).get("book");
const progressKey = "folio-reading:" + id;
const textTypes = new Set(
  "md markdown txt log csv js jsx ts tsx cpp c h hpp py java rs go json css html xml yaml yml sql sh bat ini toml vue svelte".split(
    " ",
  ),
);
let ready = false,
  positionEnabled = true,
  token = "",
  timer;
function preference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Reading works even when browser storage is full. */
  }
}
if (preference("folio-theme", "light") === "dark")
  document.body.classList.add("dark");
const font = Math.max(
  16,
  Math.min(30, Number(preference("folio-reading-size", "20")) || 20),
);
$("#reading-size").value = font;
const width = preference("folio-reading-width", "680");
$("#reading-width").value = ["680", "860", "1120"].includes(width)
  ? width
  : "680";
let wrap = preference("folio-reading-wrap", "true") !== "false";
function style() {
  document.body.style.setProperty(
    "--reading-size",
    $("#reading-size").value + "px",
  );
  document.body.style.setProperty(
    "--reading-width",
    $("#reading-width").value + "px",
  );
  $("#size-label").value = $("#reading-size").value;
  document.body.classList.toggle("reading-nowrap", !wrap);
  $("#reading-wrap").setAttribute("aria-pressed", String(wrap));
}
function ratio() {
  const total = document.documentElement.scrollHeight - innerHeight;
  return total > 0 ? Math.min(1, Math.max(0, scrollY / total)) : 0;
}
function savePosition() {
  if (!ready || !positionEnabled) return;
  const p = ratio();
  store(progressKey, JSON.stringify({ ratio: p, updated: Date.now() }));
  $("#reading-progress").textContent =
    `已读 ${Math.round(p * 100)}% · 自动记住位置`;
}
function resume() {
  let saved;
  try {
    saved = JSON.parse(preference(progressKey, "null"));
  } catch {
    saved = null;
  }
  const p = Number(saved?.ratio);
  if (Number.isFinite(p) && p > 0 && p <= 1) {
    scrollTo(
      0,
      p * Math.max(0, document.documentElement.scrollHeight - innerHeight),
    );
    $("#reading-status").textContent += " 已回到上次阅读位置。";
  }
  ready = true;
  savePosition();
}
$("#reader-theme").onclick = () => {
  document.body.classList.toggle("dark");
  store(
    "folio-theme",
    document.body.classList.contains("dark") ? "dark" : "light",
  );
};
$("#reading-size").oninput = () => {
  style();
  store("folio-reading-size", $("#reading-size").value);
};
$("#reading-width").onchange = () => {
  style();
  store("folio-reading-width", $("#reading-width").value);
};
$("#reading-wrap").onclick = () => {
  wrap = !wrap;
  style();
  store("folio-reading-wrap", wrap);
};
$("#reading-top").onclick = () => {
  scrollTo(0, 0);
  savePosition();
};
window.addEventListener(
  "scroll",
  () => {
    clearTimeout(timer);
    timer = setTimeout(savePosition, 180);
  },
  { passive: true },
);
window.addEventListener("pagehide", savePosition);
window.addEventListener("storage", (e) => {
  if (e.key === "folio-theme")
    document.body.classList.toggle("dark", e.newValue === "dark");
});
style();
async function json(url, options) {
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "读取未完成");
  return data;
}
async function load() {
  if (!id) throw Error("请从书柜的「独立阅读」入口打开这份内容");
  const result = await json(`/api/books/${encodeURIComponent(id)}`),
    b = result.book;
  token = result.token;
  $("#reading-title").textContent = b.title;
  $("#reading-name").textContent = b.title;
  document.title = `${b.title} · 拾页阅读`;
  $("#reading-kind").textContent =
    `${b.kind === "path" ? "本地原文件 · 不复制，不修改正文" : b.kind === "url" ? "网络收藏" : "书柜副本"} · ${b.extension?.toUpperCase() || "LINK"}`;
  const url = `/api/books/${encodeURIComponent(id)}/content`,
    area = $("#reading-content");
  $("#reading-download").href = url + "?download=1";
  $("#reading-download").hidden = b.kind === "url";
  if (b.kind === "url") {
    positionEnabled = false;
    area.innerHTML = `<p>${esc(b.note).replace(/\n/g, "<br>")}</p><a class="primary" href="${esc(b.source)}" target="_blank" rel="noopener noreferrer">打开原网页 ↗</a><p class="helper">书柜保存的是链接和备注；阅读正文请打开原网页。</p>`;
  } else if (b.extension === "pdf") {
    positionEnabled = false;
    area.innerHTML = `<iframe class="standalone-pdf" title="${esc(b.title)} PDF 阅读" src="${url}"></iframe>`;
    $("#reading-progress").textContent =
      "PDF 的页码、缩放和搜索请使用内置阅读器";
    $("#reading-size").disabled = true;
    $("#reading-wrap").disabled = true;
  } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(b.extension)) {
    area.innerHTML = `<img class="reader-image" src="${url}" alt="${esc(b.title)}">`;
    const img = area.querySelector("img");
    await new Promise((resolve) => {
      if (img.complete) resolve();
      else {
        img.onload = resolve;
        img.onerror = resolve;
      }
    });
  } else if (textTypes.has(b.extension) || b.kind === "note") {
    const data = await json(url + "?text=1");
    area.innerHTML = ["md", "markdown"].includes(b.extension)
      ? cleanMarkdown(data.text)
      : `<pre class="code-reader${b.extension === "txt" ? " plain-reader" : ""}"><code>${data.highlighted ? DOMPurify.sanitize(data.highlighted) : esc(data.text)}</code></pre>`;
    if (data.truncated)
      $("#reading-status").textContent =
        "当前显示前 2 MB；完整内容请下载原文件。";
    const headings = [...area.querySelectorAll("h1,h2,h3")];
    $("#reading-outline").hidden = !headings.length;
    $("#reading-toc").replaceChildren(
      ...headings.map((h, i) => {
        h.id = "chapter-" + i;
        const a = document.createElement("a");
        a.href = "#" + h.id;
        a.textContent = h.textContent;
        a.className = "toc-" + h.tagName.toLowerCase();
        return a;
      }),
    );
  } else {
    positionEnabled = false;
    area.innerHTML = `<p>这份文件已入柜，请用对应应用阅读。</p><a class="primary" href="${url}?download=1">下载 / 另存原文件</a>`;
  }
  await json(`/api/books/${encodeURIComponent(id)}/open`, {
    method: "POST",
    headers: { "X-Folio-Token": token },
  });
  if (!positionEnabled && b.extension !== "pdf")
    $("#reading-progress").textContent = "独立阅读 · 书柜随时可返回";
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
  const chapter =
    location.hash && document.getElementById(location.hash.slice(1));
  if (chapter && area.contains(chapter)) {
    chapter.scrollIntoView();
    ready = true;
    savePosition();
  } else resume();
}
load().catch((e) => {
  $("#reading-status").innerHTML =
    `<p>${esc(e.message)}</p><a class="secondary" href="/?book=${encodeURIComponent(id || "")}&tab=location">回到书柜重新定位</a>`;
  $("#reading-progress").textContent = "尚未开始阅读";
});
