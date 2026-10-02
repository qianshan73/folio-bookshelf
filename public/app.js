import { cleanMarkdown } from "/reading.js";
import DOMPurify from "/vendor/purify.js";

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  books: '<path d="M4 4h5v15H4zM12 3l4-1 5 16-4 1zM2 22h20"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  broken:
    '<path d="m8 12-2 2a4 4 0 0 0 6 6l2-2m-2-6 2-2a4 4 0 0 0-6-6L6 6M3 3l18 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/>',
  settings:
    '<path d="m9 3-.8 3-2 .9-2.9-.8-2 3.5 2.1 2.1v2.6L1.3 16l2 3.5 2.9-.8 2 .9.8 3h4l.8-3 2-.9 2.9.8 2-3.5-2.1-2.1v-2.6l2.1-2.1-2-3.5-2.9.8-2-.9L13 3Z" transform="translate(1 -1) scale(.95)"/><circle cx="12" cy="12" r="3"/>',
  harddrive: '<path d="m5 4-3 10v6h20v-6L19 4ZM2 14h20M6 17h.01M10 17h.01"/>',
  moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  refresh:
    '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  leaf: '<path d="M20 3s-14-1-16 8a7 7 0 0 0 10 8c7-4 6-16 6-16ZM4 21l11-11"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  folder: '<path d="M3 7V4h6l3 3h9v14H3Z"/>',
  link: '<path d="m9 15 6-6m-7 3-3 3a4 4 0 0 0 6 6l3-3m-2-6 3-3a4 4 0 0 1 6 6l-3 3"/>',
  file: '<path d="M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8m-8 4h6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m4 16 11-11 4 4L8 20H4ZM14 6l4 4M14 21h7"/>',
  external: '<path d="M14 3h7v7m0-7L11 13M10 3H3v18h18v-7"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const CODE = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "cpp",
  "c",
  "h",
  "hpp",
  "py",
  "java",
  "rs",
  "go",
  "json",
  "css",
  "html",
  "xml",
  "yaml",
  "yml",
  "sql",
  "sh",
  "bat",
  "ini",
  "toml",
  "vue",
  "svelte",
]);
const TEXT = new Set(["md", "markdown", "txt", "csv", "log", ...CODE]);
const NOTE_FORMATS = [
  ["md", "Markdown"],
  ["txt", "纯文本"],
  ["js", "JavaScript"],
  ["cpp", "C++"],
  ["ts", "TypeScript"],
  ["py", "Python"],
  ["c", "C"],
  ["h", "C / C++ 头文件"],
  ["java", "Java"],
  ["rs", "Rust"],
  ["go", "Go"],
  ["json", "JSON"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["xml", "XML"],
  ["yaml", "YAML"],
  ["sql", "SQL"],
  ["csv", "CSV"],
  ["log", "日志"],
  ["tex", "LaTeX"],
  ["custom", "自定义文本扩展名"],
];
let nativePickerActive = false,
  pickerFocusAt = 0;
let state = { books: [], collections: [], stats: {} },
  view = "all",
  searchIds = null,
  searchSequence = 0,
  detailId = null,
  detailTab = "read",
  importTab = "upload",
  selectedFiles = [],
  dragId = null;
let manageFiles = false,
  selectedIds = new Set(),
  moveIds = [],
  movePlan = null,
  moving = false;
let shelfView = localStorage.getItem("folio-view") || "shelf",
  editing = false,
  previewText = "",
  previewTruncated = false;
const colors = [
  "#42594d",
  "#c48665",
  "#4b6374",
  "#c1a35d",
  "#6f667d",
  "#b35e51",
  "#677a71",
  "#393f42",
];
const kindName = {
  copy: "文件副本",
  path: "路径引用",
  url: "网络收藏",
  note: "原创笔记",
};
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const formatDate = (t) =>
  t ? new Date(t).toLocaleDateString("zh-CN") : "还未翻阅";
const due = (b) => !b.trashed && b.review_date && b.review_date <= localDate();
const collectionName = (id) =>
  state.collections.find((c) => c.id === id)?.name || "待整理";
const activeBook = () => state.books.find((b) => b.id === detailId);
async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Folio-Token": state.token || "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error("响应格式异常，请重新启动应用");
  }
  if (!res.ok) throw Error(data.error || "操作未完成");
  return data;
}
function toast(message, error = false, action) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.innerHTML =
    icon(error ? "broken" : "check") + `<span>${esc(message)}</span>`;
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => {
      action.run();
      el.remove();
    };
    el.append(b);
  }
  $("#toasts").append(el);
  while ($("#toasts").children.length > 3)
    $("#toasts").firstElementChild.remove();
  setTimeout(() => el.remove(), error ? 10000 : 5000);
}
async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}
async function refresh() {
  state = await api("/api/state");
  render();
  $("#data-path").textContent = state.dataPath;
  $("#footer-status").textContent = "已保存在这台电脑";
  if ($("#search").value.trim()) await search();
}
function collectionOptions(selected) {
  return state.collections
    .map(
      (c) =>
        `<option value="${esc(c.id)}"${c.id === selected ? " selected" : ""}>${esc(c.name)}</option>`,
    )
    .join("");
}
function cover(b) {
  const pattern = ["lines", "orbit", "plain", "grid"].includes(b.pattern)
      ? b.pattern
      : "lines",
    color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : colors[0];
  return `<div class="book-cover pattern-${pattern}${b.cover ? " with-image" : ""}" style="--book-color:${color}">${b.cover ? `<img src="/covers/${encodeURIComponent(b.cover)}" alt="${esc(b.title)}的封面">` : `<span class="cover-type">${esc(b.kind === "url" ? "WEB ARCHIVE" : b.extension || "FOLIO")}</span><span class="cover-title">${esc(b.title)}</span><span class="cover-rule"></span><span class="cover-decoration"></span><span class="cover-bottom"><span>拾页 · FOLIO</span><span>${String(new Date(b.created).getFullYear()).slice(-2)}</span></span>`}</div>`;
}
function visibleBooks() {
  let books = state.books.filter((b) =>
    view === "trash" ? b.trashed : !b.trashed,
  );
  if (view === "favorite") books = books.filter((b) => b.favorite);
  else if (view === "recent") books = books.filter((b) => b.last_opened);
  else if (view === "review") books = books.filter(due);
  else if (view === "missing")
    books = books.filter((b) => state.stats[b.id] === "missing");
  else if (view === "local") books = books.filter((b) => b.kind === "path");
  else if (!["all", "trash"].includes(view))
    books = books.filter((b) => b.collection_id === view);
  const type = $("#type-filter").value;
  if (type === "text")
    books = books.filter((b) =>
      ["md", "markdown", "txt", "log", "csv"].includes(b.extension),
    );
  else if (type === "code") books = books.filter((b) => CODE.has(b.extension));
  else if (type === "url") books = books.filter((b) => b.kind === "url");
  else if (type === "other")
    books = books.filter((b) => !TEXT.has(b.extension) && b.kind !== "url");
  const q = $("#search").value.trim().toLocaleLowerCase();
  if (q)
    books = books.filter(
      (b) =>
        searchIds?.includes(b.id) ||
        [b.title, b.file_name, b.note, b.source, ...b.tags].some((v) =>
          String(v).toLocaleLowerCase().includes(q),
        ),
    );
  const sort = $("#sort").value;
  if (sort === "new") books.sort((a, b) => b.created - a.created);
  else if (sort === "title")
    books.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  else if (sort === "opened" || view === "recent")
    books.sort((a, b) => b.last_opened - a.last_opened);
  else books.sort((a, b) => b.position - a.position);
  return books;
}
function render() {
  const alive = state.books.filter((b) => !b.trashed);
  $("#total-count").textContent = alive.length;
  $("#local-count").textContent = alive.filter((b) => b.kind === "path").length;
  selectedIds = new Set(
    [...selectedIds].filter((id) =>
      alive.some((b) => b.id === id && b.kind === "path"),
    ),
  );
  $("#favorite-count").textContent = alive.filter((b) => b.favorite).length;
  $("#review-count").textContent = alive.filter(due).length;
  $("#missing-count").textContent = alive.filter(
    (b) => state.stats[b.id] === "missing",
  ).length;
  $("#collections").innerHTML = state.collections
    .map(
      (c) =>
        `<button class="nav-item ${view === c.id ? "active" : ""}" data-view="${esc(c.id)}" data-collection="${esc(c.id)}"><span class="collection-dot"></span>${esc(c.name)}<span class="count">${alive.filter((b) => b.collection_id === c.id).length}</span></button>`,
    )
    .join("");
  $$("#navigation [data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view),
  );
  const title =
    {
      all: "我的书柜",
      local: "本地原文件",
      favorite: "特别珍藏",
      recent: "最近翻阅",
      review: "等你回顾",
      missing: "需要重新定位",
      trash: "回收站",
    }[view] || collectionName(view);
  $("#view-title").innerHTML =
    esc(title) + '<span class="heading-dot">.</span>';
  $("#breadcrumb-title").textContent = view === "all" ? "全部藏品" : title;
  $("#view-description").textContent =
    {
      all: "散落的文件、喜欢的文字，在这里好好安放。",
      local: "不复制，不上传；阅读、定位、归拢原文件都在这里。",
      favorite: "那些值得放在心上的内容。",
      recent: "沿着上次的书签，继续翻阅。",
      review: "和过去收藏的好内容，再次相遇。",
      missing: "重新选择原文件，让收藏回到身边。",
      trash: "移除的只是记录，原文件和副本仍然保留。",
    }[view] || "把同一段旅程的内容，放在一起。";
  const books = visibleBooks();
  $("#result-count").textContent =
    `${books.length} 份${$("#search").value ? "搜索结果" : "藏品"}`;
  $("#books").classList.toggle("list-view", shelfView === "list");
  $$(".view-toggle button").forEach((b) =>
    b.classList.toggle(
      "active",
      b.dataset.action === (shelfView === "list" ? "list-view" : "shelf-view"),
    ),
  );
  $("#books").innerHTML = books
    .map(
      (b, i) =>
        `<article class="book-card" draggable="true" data-id="${esc(b.id)}" style="--delay:${Math.min(i * 0.035, 0.3)}s">${manageFiles && b.kind === "path" && !b.trashed ? `<label class="book-select"><input type="checkbox" data-select-book="${esc(b.id)}" ${selectedIds.has(b.id) ? "checked" : ""} aria-label="选择原文件 ${esc(b.title)}"><span>选择</span></label>` : ""}<a class="book-read-tab" href="/reader.html?book=${encodeURIComponent(b.id)}" target="_blank" rel="noopener" aria-label="独立阅读 ${esc(b.title)}" title="在新标签页独立阅读">${icon("external")}</a><button class="book-open" data-action="open-book" data-id="${esc(b.id)}" aria-label="翻阅 ${esc(b.title)}">${cover(b)}<h2 class="book-title" title="${esc(b.title)}">${esc(b.title)}</h2><div class="book-meta"><span class="file-badge">${esc(b.kind === "url" ? "LINK" : b.extension || "FILE")}</span><span class="meta-separator">·</span><span${state.stats[b.id] === "missing" ? ' class="missing-label"' : ""}>${state.stats[b.id] === "missing" ? "原文件失联" : due(b) ? "到了回顾日期" : esc(collectionName(b.collection_id))}</span></div></button><button class="icon-button book-favorite ${b.favorite ? "selected" : ""}" data-action="favorite" data-id="${esc(b.id)}" aria-label="${b.favorite ? "取消珍藏" : "特别珍藏"} ${esc(b.title)}">${icon("star")}</button></article>`,
    )
    .join("");
  renderOrganizer();
  $("#empty").hidden = !!books.length;
  const empty = $("#empty");
  empty.querySelector("h2").textContent = $("#search").value
    ? "还没有找到这份内容"
    : view === "all"
      ? "为重要的内容留个位置"
      : view === "review"
        ? "今天没有待回顾的内容"
        : view === "missing"
          ? "所有本地文件都在原处"
          : "这里还没有藏品";
  empty.querySelector("p").textContent = $("#search").value
    ? "试试文件名、标签或内容中的一句文字。"
    : view === "trash"
      ? "移除书柜记录后，可以在这里恢复。"
      : "把文件拖进来，或收藏一个值得再看的链接。";
  empty.querySelector("button").hidden = [
    "review",
    "missing",
    "trash",
  ].includes(view);
  $("#revisit").hidden = ["trash", "missing"].includes(view);
}
let searchTimer;
async function search() {
  const q = $("#search").value.trim(),
    seq = ++searchSequence;
  if (!q) {
    searchIds = null;
    render();
    return;
  }
  const result = await api("/api/search?q=" + encodeURIComponent(q));
  if (seq === searchSequence) {
    searchIds = result.ids;
    render();
  }
}
$("#search").addEventListener("input", () => {
  searchIds = null;
  render();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => attempt(search), 150);
});
$("#sort").addEventListener("change", render);
$("#type-filter").addEventListener("change", render);
function setView(v) {
  view = v;
  $("#search").value = "";
  searchIds = null;
  $("#type-filter").value = "all";
  render();
}
function showDialog(dialog) {
  dialog.showModal();
}
function confirmAction(title, message, label = "确定") {
  return new Promise((resolve) => {
    const d = $("#confirm-dialog");
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    $("#confirm-ok").textContent = label;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      d.close();
      resolve(result);
    };
    $("#confirm-ok").onclick = () => finish(true);
    $("#confirm-cancel").onclick = () => finish(false);
    d.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    showDialog(d);
  });
}
function showImport(
  tab = localStorage.getItem("folio-import-tab") ||
    (state.platform === "win32" ? "path" : "upload"),
) {
  importTab = tab;
  selectedFiles = [];
  $("#import-feedback").textContent = "原文件会保持不变";
  renderImport();
  showDialog($("#import-dialog"));
}
function renderImport() {
  $$("#import-tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.importTab === importTab),
  );
  const area = $("#import-content");
  if (importTab === "upload")
    area.innerHTML = `<label class="dropzone" for="upload-files">${icon("download")}<strong>点击选择文件，或拖放到书柜</strong><small>任何文件都可保存 · 每个副本最多 32 MB</small><input type="file" id="upload-files" multiple hidden></label><div id="file-selection" class="file-selection"></div><p class="helper">副本会留在书柜中。支持 Markdown、代码和文本预览，也可保存 PDF、图片及其他格式。</p>`;
  else if (importTab === "path" || importTab === "folder")
    area.innerHTML = `<div class="form-field"><label for="import-paths">${importTab === "folder" ? "文件夹" : "本地文件"}的绝对路径</label><div class="path-line"><textarea id="import-paths" placeholder="${esc(state.platform === "win32" ? "C:\\Users\\你的名字\\Documents\\资料" : "/Users/你的名字/Documents/资料")}" required></textarea>${state.platform === "win32" ? `<button type="button" class="secondary" data-action="browse-import">${icon("folder")}选择${importTab === "folder" ? "文件夹" : "文件"}</button>` : ""}</div><small>${importTab === "folder" ? "导入整个文件夹，每批最多 1000 个文件。自动跳过隐藏目录和 node_modules。" : "每行一条路径。引用大文件不受 32 MB 的副本上限影响。"}</small></div>${importTab === "folder" ? '<div class="radio-row"><label><input type="radio" name="path-mode" value="path" checked>保留路径引用</label><label><input type="radio" name="path-mode" value="copy">保存独立副本</label></div><label class="helper"><input type="checkbox" id="recursive" checked> 包含子文件夹</label>' : ""}<p class="helper">${importTab === "folder" ? "路径引用跟随原文件的内容更新；副本与原文件相互独立。" : "不复制、不上传。原文件移动后可重新定位，也可在「位置」里实际移动原文件。"}</p>`;
  else if (importTab === "link")
    area.innerHTML =
      '<div class="form-field"><label for="link-url">网络地址</label><input id="link-url" type="url" placeholder="https://…" required></div><div class="form-field"><label for="link-title">给它一个容易记住的名字</label><input id="link-title" placeholder="例如：我想再读一次的文章"></div><div class="form-field"><label for="link-note">为什么值得留存</label><textarea id="link-note" placeholder="写下一句自己的推荐语…"></textarea></div><p class="helper">这里只记录链接和笔记，不抓取网页快照。页面离线或删除后，原网页可能不再可访问。</p>';
  else
    area.innerHTML =
      '<div class="form-field"><label for="note-title">文件名称</label><input id="note-title" placeholder="给未来的自己" required maxlength="180"></div>' +
      `<div class="form-field"><label for="note-format">保存为文件类型</label><select id="note-format">${NOTE_FORMATS.map(([extension, label]) => `<option value="${extension}">${esc(label)}${extension === "custom" ? "" : ` (.${extension})`}</option>`).join("")}</select><div id="note-custom-field" hidden><label for="note-custom-extension">自定义扩展名</label><input id="note-custom-extension" placeholder="例如 rst、lua、ini" maxlength="13" pattern="\\.?[a-zA-Z0-9]{1,12}"></div><small id="note-format-hint">将保存为 .md 文件，支持 Markdown 阅读和编辑。</small></div>` +
      '<div class="form-field"><label for="note-content">粘贴或写下内容</label><textarea id="note-content" rows="8" placeholder="# 一个值得留下的想法\n\n支持 Markdown…" required></textarea></div>';
  const defaultCol = state.collections.some((c) => c.id === view)
    ? view
    : importTab === "link"
      ? "links"
      : importTab === "note"
        ? "notes"
        : "inbox";
  $("#import-collection").innerHTML = collectionOptions(defaultCol);
  const input = $("#upload-files");
  if (input)
    input.onchange = () => {
      selectedFiles = [...input.files];
      renderSelectedFiles();
    };
  if ($("#note-format")) {
    $("#note-format").onchange = () => {
      const extension = $("#note-format").value;
      $("#note-custom-field").hidden = extension !== "custom";
      $("#note-custom-extension").required = extension === "custom";
      $("#note-format-hint").textContent =
        extension === "custom"
          ? "填写文本或代码文件的扩展名，内容以 UTF-8 纯文本保存。"
          : `将保存为 .${extension} 文件，${extension === "md" ? "支持 Markdown 阅读和编辑。" : "保留你粘贴的原始文字，不执行代码。"}`;
      $("#note-content").placeholder =
        extension === "md"
          ? "# 一个值得留下的想法\n\n支持 Markdown…"
          : "粘贴文字或代码，按所选文件类型保存…";
    };
  }
}
function renderSelectedFiles() {
  const el = $("#file-selection");
  if (el)
    el.textContent = selectedFiles.length
      ? `已选择 ${selectedFiles.length} 个文件：${selectedFiles.map((f) => f.name).join("、")}`
      : "";
}
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(Error("文件读取失败"));
    r.readAsDataURL(file);
  });
}
async function uploadFiles(files, collection_id, onProgress) {
  let added = 0,
    skipped = 0;
  const errors = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.(i + 1, files.length);
    if (f.size > 32 * 1024 * 1024) {
      errors.push({ name: f.name, message: "超过 32 MB，请用路径引用" });
      continue;
    }
    const r = await api("/api/import", "POST", {
      files: [{ name: f.name, data: await fileBase64(f) }],
      collection_id,
    });
    added += r.added;
    skipped += r.skipped;
    errors.push(...r.errors);
  }
  return { added, skipped, errors };
}
function importReport(result) {
  toast(
    `已收进 ${result.added} 份内容${result.skipped ? `，跳过 ${result.skipped} 份重复内容` : ""}`,
  );
  if (result.errors?.length)
    toast(result.errors.map((e) => `${e.name}：${e.message}`).join("；"), true);
}
$("#import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#import-submit");
  btn.disabled = true;
  const col = $("#import-collection").value;
  try {
    let result;
    if (importTab === "upload") {
      if (!selectedFiles.length) throw Error("先选择一些文件吧");
      result = await uploadFiles(
        selectedFiles,
        col,
        (i, n) => ($("#import-feedback").textContent = `正在收进 ${i} / ${n}…`),
      );
    } else if (["path", "folder"].includes(importTab)) {
      const paths = $("#import-paths")
        .value.split(/\r?\n/)
        .map((p) => p.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      if (!paths.length) throw Error("请填写路径");
      $("#import-feedback").textContent = "正在整理文件，请稍候…";
      result = await api("/api/import-path", "POST", {
        paths,
        collection_id: col,
        mode:
          importTab === "folder"
            ? $('[name="path-mode"]:checked').value
            : "path",
        recursive: $("#recursive")?.checked !== false,
      });
    } else if (importTab === "link") {
      await api("/api/link", "POST", {
        url: $("#link-url").value,
        title: $("#link-title").value,
        note: $("#link-note").value,
        collection_id: col,
      });
      result = { added: 1 };
    } else {
      await api("/api/note", "POST", {
        title: $("#note-title").value,
        content: $("#note-content").value,
        extension:
          $("#note-format").value === "custom"
            ? $("#note-custom-extension").value
            : $("#note-format").value,
        collection_id: col,
      });
      result = { added: 1 };
    }
    await refresh();
    if (view !== "all" && view !== col) setView(col);
    if (result.errors?.length)
      $("#import-feedback").textContent = result.errors
        .map((e) => `${e.name}：${e.message}`)
        .join("；");
    else $("#import-dialog").close();
    importReport(result);
  } catch (e) {
    $("#import-feedback").textContent = e.message;
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});
async function openBook(id) {
  detailId = id;
  detailTab = "read";
  editing = false;
  await api(`/api/books/${id}/open`, "POST", {});
  const b = activeBook();
  if (!b) return;
  b.last_opened = Date.now();
  render();
  renderDetailHeader();
  showDialog($("#detail-dialog"));
  await renderDetail();
}
function renderDetailHeader() {
  const b = activeBook();
  if (!b) return;
  $("#detail-header").innerHTML =
    `<div class="detail-header">${cover(b)}<div><h2 class="detail-title">${esc(b.title)}</h2><div class="detail-kind">${esc(collectionName(b.collection_id))} · ${kindName[b.kind]} · ${esc(b.extension?.toUpperCase() || "LINK")}</div><div class="detail-header-actions"><a class="secondary" href="/reader.html?book=${encodeURIComponent(b.id)}" target="_blank" rel="noopener">${icon("external")}独立阅读</a>${b.kind === "path" && !b.trashed ? '<button class="secondary" data-action="organize-one">快捷归拢</button>' : ""}<button class="secondary" data-action="favorite" data-id="${esc(b.id)}">${icon("star")}${b.favorite ? "已珍藏" : "特别珍藏"}</button>${due(b) ? '<button class="secondary" data-action="reviewed">' + icon("check") + "已回顾</button>" : ""}</div></div></div>`;
}
async function renderDetail() {
  const b = activeBook();
  if (!b) return;
  const area = $("#detail-content");
  $$("#detail-tabs button").forEach((t) =>
    t.classList.toggle("active", t.dataset.detailTab === detailTab),
  );
  if (detailTab === "read") {
    if (b.kind === "url") {
      area.innerHTML = `<div class="link-preview"><span>${icon("link")}</span><h3>${esc(b.title)}</h3><p>${esc(b.source)}</p><a class="primary" href="${esc(b.source)}" target="_blank" rel="noopener noreferrer">打开原网页 ${icon("external")}</a></div>${b.note ? `<div class="reader"><p>${esc(b.note).replace(/\n/g, "<br>")}</p></div>` : ""}`;
      return;
    }
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(b.extension)) {
      area.innerHTML = `<div class="reader-controls"><a class="secondary" href="/api/books/${b.id}/content?download=1">下载文件</a></div><img class="reader-image" src="/api/books/${b.id}/content" alt="${esc(b.title)}">`;
      return;
    }
    if (b.extension === "pdf") {
      area.innerHTML = `<div class="reader"><iframe title="${esc(b.title)} PDF 预览" src="/api/books/${b.id}/content"></iframe><p class="helper">PDF 预览使用浏览器内置阅读器。<a href="/api/books/${b.id}/content?download=1">下载文件</a></p></div>`;
      return;
    }
    if (!TEXT.has(b.extension) && b.kind !== "note") {
      area.innerHTML = `<div class="preview-error">${icon("file")}<p>这份文件已妥善入柜。此格式请下载后用对应应用打开。</p><a class="secondary" href="/api/books/${b.id}/content?download=1">下载原文件</a><button class="secondary" data-action="reveal">在文件夹中查看</button></div>`;
      return;
    }
    area.innerHTML = '<div class="busy-state">正在翻开这份内容…</div>';
    const id = b.id;
    try {
      const data = await api(`/api/books/${b.id}/content?text=1`);
      if (detailId !== id || detailTab !== "read") return;
      previewText = data.text;
      previewTruncated = data.truncated;
      area.innerHTML = `<div class="reader-controls">${["copy", "note"].includes(b.kind) && !data.truncated ? '<button class="secondary" data-action="edit-content">' + icon("edit") + "编辑副本</button>" : ""}<a class="secondary" href="/api/books/${b.id}/content?download=1">${icon("download")}下载</a></div>${data.truncated ? '<p class="helper">预览显示前 2 MB，完整内容请下载。当前预览不支持编辑。</p>' : ""}<div class="reader">${["md", "markdown"].includes(b.extension) ? cleanMarkdown(data.text) : `<pre class="code-reader"><code>${data.highlighted ? DOMPurify.sanitize(data.highlighted) : esc(data.text)}</code></pre>`}</div>`;
    } catch (e) {
      if (detailId === id && detailTab === "read")
        area.innerHTML = `<div class="preview-error">${esc(e.message)}<p>到「位置」页重新选择原文件，或检查文件是否仍然存在。</p></div>`;
    }
    return;
  }
  if (detailTab === "info") {
    area.innerHTML = `<form id="info-form"><div class="info-grid"><div class="form-field span-two"><label for="book-title">书柜里的名称</label><input id="book-title" name="title" value="${esc(b.title)}" required maxlength="200"><small>只改变显示名称，不改变原文件名。</small></div><div class="form-field"><label for="book-collection">分类</label><select id="book-collection" name="collection_id">${collectionOptions(b.collection_id)}</select></div><div class="form-field"><label for="book-review">再次回顾的日期</label><input id="book-review" name="review_date" type="date" value="${esc(b.review_date)}"></div><div class="form-field span-two"><label for="book-tags">标签，用逗号分隔</label><input id="book-tags" name="tags" value="${esc(b.tags.join("，"))}" placeholder="灵感，重要，常用"></div><div class="form-field span-two"><label for="book-note">留给自己的备注</label><textarea id="book-note" name="note">${esc(b.note)}</textarea></div></div><p class="helper">${formatDate(b.created)} 入柜 · 最近翻阅：${formatDate(b.last_opened)}</p><button class="primary" type="submit">保存档案</button></form><div class="danger-zone"><p>${b.trashed ? "恢复后会回到原来的分类。" : "仅移入书柜回收站，不会删除原文件。"}</p><button class="secondary ${b.trashed ? "" : "destructive"}" data-action="${b.trashed ? "restore-book" : "trash-book"}">${icon(b.trashed ? "refresh" : "trash")}${b.trashed ? "恢复藏品" : "移入回收站"}</button></div>`;
    $("#info-form").onsubmit = async (e) => {
      e.preventDefault();
      await attempt(async () => {
        const f = new FormData(e.target);
        await api(`/api/books/${b.id}`, "PATCH", {
          title: f.get("title"),
          collection_id: f.get("collection_id"),
          review_date: f.get("review_date"),
          tags: String(f.get("tags"))
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
          note: f.get("note"),
        });
        await refresh();
        renderDetailHeader();
        toast("档案已保存");
      });
    };
    return;
  }
  if (detailTab === "cover") {
    area.innerHTML = `<div class="cover-editor"><div id="cover-preview">${cover(b)}</div><div class="cover-options"><label class="helper">选择封面颜色</label><div class="color-swatches">${colors.map((c) => `<button class="color-swatch ${c === b.color ? "selected" : ""}" style="--swatch:${c}" data-color="${c}" aria-label="封面颜色 ${c}"></button>`).join("")}<input type="color" id="custom-color" value="${esc(b.color)}" aria-label="自定义封面颜色"></div><p class="helper">封面纹理</p><div class="pattern-options">${[
      ["lines", "斜线"],
      ["orbit", "环形"],
      ["grid", "格纹"],
      ["plain", "纯色"],
    ]
      .map(
        ([p, label]) =>
          `<button class="secondary ${b.pattern === p ? "selected" : ""}" data-pattern="${p}">${label}</button>`,
      )
      .join(
        "",
      )}</div><div class="cover-upload"><label class="secondary file-label">${icon("download")}上传封面<input type="file" id="cover-file" accept="image/png,image/jpeg,image/webp" hidden></label>${b.cover ? '<button class="text-button" data-action="remove-cover">恢复文字封面</button>' : ""}</div><p class="helper">支持 PNG、JPEG、WebP，最多 5 MB。颜色和纹理即时保存；文字随书柜名称更新。</p></div></div>`;
    $("#custom-color").onchange = (e) =>
      attempt(() => patchCover({ color: e.target.value }));
    $("#cover-file").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      await attempt(async () => {
        if (f.size > 5 * 1024 * 1024) throw Error("封面请小于 5 MB");
        await api(`/api/books/${b.id}/cover`, "POST", {
          data: await fileBase64(f),
        });
        await refresh();
        renderDetailHeader();
        await renderDetail();
        toast("新封面已保存");
      });
    };
    return;
  }
  const p =
    b.kind === "path"
      ? b.source
      : b.kind === "url"
        ? b.source
        : state.dataPath +
          (state.platform === "win32" ? "\\files\\" : "/files/") +
          b.stored;
  area.innerHTML = `<div class="location-card"><h3>${kindName[b.kind]}</h3><code class="path-text">${esc(p)}</code><p class="helper">${b.kind === "path" ? "这里指向你的原文件。文件内容更改后可以刷新索引；移动到其他位置后可以重新定位。" : b.kind === "url" ? "记录网络地址，不保存原网页正文。" : "这是书柜保存的独立副本，原文件改动不会影响它。"}</p><div class="location-actions">${b.kind !== "url" ? `<button class="secondary" data-action="reveal">${icon("folder")}在文件夹中查看</button><a class="secondary" href="/api/books/${b.id}/content?download=1">${icon("download")}下载 / 另存</a>` : ""}${b.kind === "path" ? '<button class="secondary" data-action="refresh-index">' + icon("refresh") + "刷新内容索引</button>" : ""}</div></div>${b.kind === "path" ? `<div class="form-field"><label for="relink-path">原文件不见了？重新定位</label><div class="path-line"><input id="relink-path" placeholder="原文件的新绝对路径">${state.platform === "win32" ? '<button class="secondary" data-action="browse-relink">选择文件</button>' : ""}</div><button class="secondary" data-action="relink">更新引用位置</button></div><div class="location-card"><h3>移动本地原文件</h3><p class="helper">这会实际移动磁盘上的文件，并同步更新书柜引用。已有同名文件不会被覆盖。移动后可撤销。</p><div class="form-field"><label for="move-directory">目标文件夹</label><div class="path-line"><input id="move-directory" placeholder="选择或填写现有文件夹的绝对路径">${state.platform === "win32" ? '<button class="secondary" data-action="browse-move">选择文件夹</button>' : ""}</div></div><div class="form-field"><label for="move-name">目标文件名</label><input id="move-name" value="${esc(b.file_name)}"></div><div class="location-actions"><button class="primary" data-action="move">移动原文件</button><button class="secondary" data-action="undo-move">撤销上次移动</button></div></div>` : ""}`;
}
async function patchCover(values) {
  const id = detailId;
  await api(`/api/books/${id}`, "PATCH", values);
  await refresh();
  if (detailId === id) {
    renderDetailHeader();
    await renderDetail();
  }
}
function renderOrganizer() {
  $("#file-organizer").hidden = !manageFiles;
  $("#selected-count").textContent = `已选 ${selectedIds.size} 份`;
  $("#recent-moves").innerHTML = (state.moveBatches || [])
    .map(
      (b) =>
        `<div class="recent-move"><span>${formatDate(b.created)} · 移动 ${b.total} 份到 <code>${esc(b.name)}</code>${b.remaining ? "" : " · 已全部撤销"}</span>${b.remaining ? `<button class="text-button" data-action="undo-batch" data-batch="${esc(b.id)}">撤销这批移动 (${b.remaining})</button>` : ""}</div>`,
    )
    .join("");
  const recent = state.books
    .filter(
      (b) => !b.trashed && b.last_opened && state.stats[b.id] !== "missing",
    )
    .sort((a, b) => b.last_opened - a.last_opened)[0];
  $("#continue-reading").hidden = !recent || view === "trash";
  $("#continue-reading").innerHTML = recent
    ? `<span>上次翻阅：<b>${esc(recent.title)}</b></span><a class="text-button" href="/reader.html?book=${encodeURIComponent(recent.id)}" target="_blank" rel="noopener">继续独立阅读 ${icon("external")}</a>`
    : "";
}
function renderPlaces() {
  $("#places-list").innerHTML =
    (state.places || [])
      .map(
        (p) =>
          `<div class="place-item"><div><strong>${esc(p.name)}</strong><code>${esc(p.directory)}</code></div><button class="text-button" data-action="rename-place" data-place="${esc(p.id)}">改名</button><button class="text-button" data-action="forget-place" data-place="${esc(p.id)}">忘记去处</button></div>`,
      )
      .join("") ||
    '<p class="helper">还没有常用去处。保存一个文件夹，下次不用再找。</p>';
}
function placeOptions(selected = "") {
  $("#move-place").innerHTML =
    '<option value="">选择其他文件夹…</option>' +
    (state.places || [])
      .map(
        (p) =>
          `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}</option>`,
      )
      .join("");
}
function invalidatePlan() {
  movePlan = null;
  $("#execute-move").disabled = true;
  $("#move-preview").replaceChildren();
  $("#move-status").textContent = "去处更改后请重新预览；文件尚未移动。";
}
function showMove(ids) {
  moveIds = [...new Set(ids)].filter((id) =>
    state.books.some((b) => b.id === id && b.kind === "path" && !b.trashed),
  );
  if (!moveIds.length)
    throw Error("先勾选本地原文件；副本和链接不参与实际移动");
  if (moveIds.length > 200) throw Error("一次最多归拢 200 份，请分批选择");
  $("#move-selection").textContent =
    `这次归拢 ${moveIds.length} 份原文件。分类、封面、备注不变。`;
  const remembered = localStorage.getItem("folio-last-place"),
    p =
      (state.places || []).find((p) => p.id === remembered) ||
      state.places?.[0];
  placeOptions(p?.id);
  $("#batch-directory").value = p?.directory || "";
  $("[data-action='browse-batch']").hidden = state.platform !== "win32";
  invalidatePlan();
  showDialog($("#move-dialog"));
}
function moveRows(entries) {
  return entries
    .map(
      (e) =>
        `<div class="move-row status-${esc(e.status)}"><strong>${esc(e.title)}</strong><small>${esc(e.message)}</small><code>${esc(e.source)}</code>${e.destination ? `<span>↓</span><code>${esc(e.destination)}</code>` : ""}</div>`,
    )
    .join("");
}
$("#move-place").onchange = () => {
  const p = (state.places || []).find((p) => p.id === $("#move-place").value);
  $("#batch-directory").value = p?.directory || "";
  invalidatePlan();
};
$("#batch-directory").oninput = () => {
  $("#move-place").value = "";
  invalidatePlan();
};
$("#move-dialog").addEventListener("cancel", (e) => {
  if (moving) e.preventDefault();
});
document.addEventListener("change", (e) => {
  const id = e.target.dataset.selectBook;
  if (id) {
    if (e.target.checked && selectedIds.size >= 200) {
      e.target.checked = false;
      toast("这批已选 200 份，先归拢这一批，再继续选择", true);
      return;
    }
    e.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
    renderOrganizer();
  }
});
$("#place-form").onsubmit = (e) => {
  e.preventDefault();
  attempt(async () => {
    const p = await api("/api/places", "POST", {
      name: $("#place-name").value,
      directory: $("#place-directory").value.trim().replace(/^"|"$/g, ""),
    });
    localStorage.setItem("folio-last-place", p.id);
    await refresh();
    renderPlaces();
    e.target.reset();
    toast("常用去处已记住，下次直接选择");
  });
};
async function undoBatch(id) {
  if (
    !(await confirmAction(
      "撤销这批移动？",
      "这批原文件会回到之前的位置。之后又移动过的文件、或原位置已有同名文件的项目会跳过，并保留结果供你检查。",
      "撤销这批",
    ))
  )
    return;
  const r = await api(`/api/move-batches/${id}/undo`, "POST", {});
  await refresh();
  if ($("#detail-dialog").open) await renderDetail();
  toast(
    `已撤销 ${r.undone} 份移动${r.errors.length ? `，${r.errors.length} 份待处理` : ""}`,
  );
  if ($("#move-dialog").open) {
    invalidatePlan();
    $("#move-preview").innerHTML = r.errors
      .map(
        (e) =>
          `<div class="move-row status-error"><strong>${esc(e.title)}</strong><small>${esc(e.message)}</small></div>`,
      )
      .join("");
    $("#move-status").textContent =
      `已撤销 ${r.undone} 份；${r.errors.length} 份待处理。`;
  }
  if (r.errors.length)
    toast(r.errors.map((e) => `${e.title}：${e.message}`).join("；"), true);
}
async function organizerAction(action, button) {
  if (action === "manage-files") {
    manageFiles = !manageFiles;
    render();
  } else if (action === "select-local") {
    for (const b of visibleBooks())
      if (b.kind === "path" && !b.trashed && selectedIds.size < 200)
        selectedIds.add(b.id);
    if (
      visibleBooks().filter((b) => b.kind === "path" && !b.trashed).length > 200
    )
      toast("先选中 200 份原文件，归拢后可继续下一批");
    render();
  } else if (action === "clear-selection") {
    selectedIds.clear();
    render();
  } else if (action === "organize-selected") showMove([...selectedIds]);
  else if (action === "organize-one") showMove([detailId]);
  else if (action === "places") {
    await refresh();
    renderPlaces();
    $("[data-action='browse-place']").hidden = state.platform !== "win32";
    showDialog($("#places-dialog"));
  } else if (action === "rename-place") {
    const p = state.places.find((p) => p.id === button.dataset.place);
    $("#place-name").value = p.name;
    $("#place-directory").value = p.directory;
    $("#place-name").focus();
  } else if (action === "forget-place") {
    await api("/api/places/" + button.dataset.place, "DELETE");
    await refresh();
    renderPlaces();
  } else if (action === "browse-place" || action === "browse-batch") {
    await chooseNativePaths(
      "folder",
      action === "browse-place" ? "#place-directory" : "#batch-directory",
      button,
    );
    if (action === "browse-batch") {
      $("#move-place").value = "";
      invalidatePlan();
    }
  } else if (action === "save-current-place") {
    const p = await api("/api/places", "POST", {
      directory: $("#batch-directory").value.trim().replace(/^"|"$/g, ""),
    });
    localStorage.setItem("folio-last-place", p.id);
    await refresh();
    placeOptions(p.id);
    invalidatePlan();
    toast("这个去处已记住，名称可在「常用文件夹」中修改");
  } else if (action === "preview-move") {
    button.disabled = true;
    invalidatePlan();
    try {
      const plan = await api("/api/move-plan", "POST", {
        ids: moveIds,
        directory: $("#batch-directory").value.trim().replace(/^"|"$/g, ""),
        place_id: $("#move-place").value,
      });
      movePlan = plan;
      $("#move-preview").innerHTML = moveRows(plan.entries);
      const n = plan.entries.filter((e) => e.status === "ready").length;
      $("#execute-move").disabled = !n;
      $("#move-status").textContent =
        `待移动 ${n} 份 · 跳过 / 待处理 ${plan.entries.length - n} 份。请核对去处。`;
    } finally {
      button.disabled = false;
    }
  } else if (action === "execute-move") {
    if (!movePlan || moving) return true;
    moving = true;
    const id = movePlan.id;
    $("#move-status").textContent = "正在移动原文件，请稍候…";
    $$("#move-dialog button,#move-dialog input,#move-dialog select").forEach(
      (b) => (b.disabled = true),
    );
    try {
      const r = await api("/api/move-execute", "POST", {
        plan_id: id,
        confirm: true,
      });
      if ($("#move-place").value)
        localStorage.setItem("folio-last-place", $("#move-place").value);
      movePlan = null;
      for (const e of r.entries)
        if (e.status === "moved") selectedIds.delete(e.id);
      await refresh();
      if ($("#detail-dialog").open) await renderDetail();
      $("#move-preview").innerHTML =
        moveRows(r.entries) +
        (r.batch_id
          ? `<button class="secondary" data-action="undo-batch" data-batch="${esc(r.batch_id)}">撤销这批移动</button>`
          : "");
      $("#move-status").textContent =
        `完成：已移动 ${r.moved} 份；${r.entries.filter((e) => e.status === "error").length} 份待处理。`;
      toast(`已归拢 ${r.moved} 份原文件，书柜引用已同步`);
    } catch (e) {
      movePlan = null;
      $("#move-status").textContent =
        e.message + "；可重新预览，或在整理栏检查最近移动。";
      throw e;
    } finally {
      moving = false;
      $$("#move-dialog button,#move-dialog input,#move-dialog select").forEach(
        (b) => (b.disabled = false),
      );
      $("#execute-move").disabled = true;
    }
  } else if (action === "undo-batch") {
    button.disabled = true;
    try {
      await undoBatch(button.dataset.batch);
    } finally {
      button.disabled = false;
    }
  } else return false;
  return true;
}
async function focusNativePicker() {
  if (!nativePickerActive || Date.now() - pickerFocusAt < 200) return;
  pickerFocusAt = Date.now();
  try {
    const result = await api("/api/dialog/focus", "POST", {});
    // The initial /dialog request may still be arriving. Its own finally block
    // is the only owner of the pending state; a focus response must not clear it.
  } catch {
    // A network failure is handled by the outstanding picker request.
  }
}
async function chooseNativePaths(kind, target, button) {
  if (nativePickerActive) {
    await focusNativePicker();
    return;
  }
  nativePickerActive = true;
  const oldLabel = button.innerHTML;
  button.innerHTML = `${icon("folder")}返回选择窗口`;
  button.setAttribute("aria-busy", "true");
  const hint = document.createElement("div");
  hint.className = "native-picker-hint";
  hint.innerHTML =
    '<span>请在置顶的系统窗口完成选择。点击页面会重新置顶。</span><button type="button" class="text-button" data-action="cancel-picker">取消选择</button>';
  button.closest(".form-field")?.append(hint);
  try {
    const result = await api("/api/dialog", "POST", { kind });
    const input = $(target);
    if (input && result.paths.length && result.kind === kind)
      input.value =
        kind === "files" && target === "#import-paths"
          ? result.paths.join("\n")
          : result.paths[0];
  } finally {
    nativePickerActive = false;
    button.innerHTML = oldLabel;
    button.removeAttribute("aria-busy");
    hint.remove();
  }
}
// Keep page actions underneath the pending system picker from changing its target.
for (const event of ["pointerdown", "click"])
  document.addEventListener(
    event,
    (e) => {
      if (
        !nativePickerActive ||
        e.target.closest('[data-action="cancel-picker"]')
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void focusNativePicker();
    },
    true,
  );
document.addEventListener(
  "keydown",
  (e) => {
    if (!nativePickerActive) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape")
      void attempt(() => api("/api/dialog/cancel", "POST", {}));
    else void focusNativePicker();
  },
  true,
);
window.addEventListener("focus", () => {
  if (nativePickerActive) void focusNativePicker();
  else if (!document.querySelector("dialog[open]")) void attempt(refresh);
});
window.addEventListener("storage", (e) => {
  if (e.key === "folio-theme")
    document.body.classList.toggle("dark", e.newValue === "dark");
});
$("#name-form").onsubmit = (e) => {
  e.preventDefault();
  attempt(async () => {
    await api("/api/collections", "POST", {
      name: new FormData(e.target).get("name"),
    });
    e.target.reset();
    $("#name-dialog").close();
    await refresh();
    toast("新的分类已创建");
  });
};
document.addEventListener("click", (e) => {
  const button = e.target.closest(
    "[data-action],[data-view],[data-import-tab],[data-detail-tab],[data-color],[data-pattern]",
  );
  if (!button) return;
  if (button.dataset.view) {
    setView(button.dataset.view);
    return;
  }
  if (button.dataset.importTab) {
    importTab = button.dataset.importTab;
    localStorage.setItem("folio-import-tab", importTab);
    selectedFiles = [];
    renderImport();
    return;
  }
  if (button.dataset.detailTab) {
    attempt(async () => {
      if (
        editing &&
        !(await confirmAction("离开编辑？", "尚未保存的内容会被丢弃。", "离开"))
      )
        return;
      editing = false;
      detailTab = button.dataset.detailTab;
      await renderDetail();
    });
    return;
  }
  if (button.dataset.color) {
    attempt(() => patchCover({ color: button.dataset.color }));
    return;
  }
  if (button.dataset.pattern) {
    attempt(() => patchCover({ pattern: button.dataset.pattern }));
    return;
  }
  const action = button.dataset.action;
  attempt(async () => {
    if (action === "import") showImport(button.dataset.import || undefined);
    else if (action === "close-modal") {
      if (
        button.closest("#detail-dialog") &&
        editing &&
        !(await confirmAction("离开编辑？", "尚未保存的内容会被丢弃。", "离开"))
      )
        return;
      if (moving && button.closest("#move-dialog")) return;
      button.closest("dialog").close();
      editing = false;
    } else if (action === "new-collection") showDialog($("#name-dialog"));
    else if (action === "settings") showDialog($("#settings-dialog"));
    else if (await organizerAction(action, button)) return;
    else if (action === "theme") {
      document.body.classList.toggle("dark");
      localStorage.setItem(
        "folio-theme",
        document.body.classList.contains("dark") ? "dark" : "light",
      );
    } else if (action === "shelf-view" || action === "list-view") {
      shelfView = action === "list-view" ? "list" : "shelf";
      localStorage.setItem("folio-view", shelfView);
      render();
    } else if (action === "refresh") {
      button.disabled = true;
      try {
        await api("/api/reindex", "POST", {});
        await refresh();
        toast("文件位置与内容索引检查完成");
      } finally {
        button.disabled = false;
      }
    } else if (action === "open-book") await openBook(button.dataset.id);
    else if (action === "favorite") {
      const id = button.dataset.id,
        b = state.books.find((b) => b.id === id);
      await api(`/api/books/${id}`, "PATCH", { favorite: !b.favorite });
      await refresh();
      if (detailId === id && $("#detail-dialog").open) renderDetailHeader();
    } else if (action === "browse-import") {
      await chooseNativePaths(
        importTab === "folder" ? "folder" : "files",
        "#import-paths",
        button,
      );
    } else if (action === "cancel-picker") {
      await api("/api/dialog/cancel", "POST", {});
    } else if (action === "reviewed") {
      await api(`/api/books/${detailId}`, "PATCH", { review_date: "" });
      await refresh();
      renderDetailHeader();
      toast("这次相遇已记下，下次日期可以在档案里设置");
    } else if (action === "trash-book") {
      if (
        await confirmAction(
          "移入回收站？",
          "仅移除书柜记录，不会删除原文件或保存的副本。",
          "移入回收站",
        )
      ) {
        await api(`/api/books/${detailId}`, "PATCH", { trashed: true });
        $("#detail-dialog").close();
        await refresh();
        toast("已移入回收站，可以随时恢复");
      }
    } else if (action === "restore-book") {
      await api(`/api/books/${detailId}`, "PATCH", { trashed: false });
      $("#detail-dialog").close();
      await refresh();
      toast("藏品已回到书柜");
    } else if (action === "remove-cover") {
      await api(`/api/books/${detailId}/remove-cover`, "POST", {});
      await refresh();
      renderDetailHeader();
      await renderDetail();
    } else if (action === "reveal") {
      await api(`/api/books/${detailId}/reveal`, "POST", {});
      toast("已打开文件所在位置");
    } else if (action === "refresh-index") {
      await api(`/api/books/${detailId}/refresh`, "POST", {});
      toast("内容索引已更新");
    } else if (action === "browse-relink" || action === "browse-move") {
      await chooseNativePaths(
        action === "browse-move" ? "folder" : "files",
        action === "browse-move" ? "#move-directory" : "#relink-path",
        button,
      );
    } else if (action === "relink") {
      await api(`/api/books/${detailId}/relink`, "POST", {
        path: $("#relink-path").value.trim().replace(/^"|"$/g, ""),
      });
      await refresh();
      renderDetailHeader();
      await renderDetail();
      toast("引用位置已更新");
    } else if (action === "move") {
      const directory = $("#move-directory").value.trim().replace(/^"|"$/g, ""),
        filename = $("#move-name").value.trim();
      if (!directory) throw Error("请先选择目标文件夹");
      if (
        await confirmAction(
          "移动磁盘上的原文件？",
          `原位置：${activeBook().source}\n目标文件夹：${directory}\n文件名：${filename}\n\n书柜会更新引用，不会覆盖同名文件。`,
          "确认移动",
        )
      ) {
        await api(`/api/books/${detailId}/move`, "POST", {
          directory,
          filename,
          confirm: true,
        });
        await refresh();
        await renderDetail();
        const id = detailId;
        toast("原文件已移动，书柜位置已同步", false, {
          label: "撤销",
          run: () =>
            attempt(async () => {
              await api(`/api/books/${id}/undo-move`, "POST", {});
              await refresh();
              if (detailId === id) await renderDetail();
              toast("文件已回到原位置");
            }),
        });
      }
    } else if (action === "undo-move") {
      if (
        await confirmAction(
          "撤销上次移动？",
          "将原文件移回之前的位置。如原位置已有同名文件，操作会停止。",
          "撤销移动",
        )
      ) {
        await api(`/api/books/${detailId}/undo-move`, "POST", {});
        await refresh();
        await renderDetail();
        toast("文件已回到原位置");
      }
    } else if (action === "backup") {
      button.disabled = true;
      try {
        const res = await fetch("/api/backup");
        if (!res.ok) throw Error((await res.json()).error);
        const blob = await res.blob(),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = `拾页备份-${localDate()}.folio`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        toast("完整备份已导出，路径引用的原文件请另外备份");
      } finally {
        button.disabled = false;
      }
    } else if (action === "edit-content") {
      if (previewTruncated) throw Error("截断的预览不支持编辑");
      editing = true;
      $("#detail-content").innerHTML =
        `<p class="edit-note">编辑的是书柜副本，不会改变外部原文件。</p><textarea id="content-editor" class="reading-edit" aria-label="编辑文件内容">${esc(previewText)}</textarea><div class="modal-footer"><button class="secondary" data-action="cancel-edit">取消</button><button class="primary" data-action="save-content">保存内容</button></div>`;
    } else if (action === "cancel-edit") {
      if (
        await confirmAction("放弃编辑？", "未保存的更改将被丢弃。", "放弃编辑")
      ) {
        editing = false;
        await renderDetail();
      }
    } else if (action === "save-content") {
      await api(`/api/books/${detailId}/content`, "PUT", {
        content: $("#content-editor").value,
      });
      editing = false;
      await refresh();
      await renderDetail();
      toast("内容已保存");
    }
  });
});
$("#restore-file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  await attempt(async () => {
    if (f.size > 128 * 1024 * 1024)
      throw Error("备份超过 128 MB，请退出后恢复整个 data 文件夹");
    if (
      !(await confirmAction(
        "合并导入书柜备份？",
        "已有藏品不会被覆盖。路径引用仍需要原文件处于相同位置。",
        "导入备份",
      ))
    )
      return;
    const data = JSON.parse(await f.text());
    const r = await api("/api/restore", "POST", data);
    await refresh();
    toast(`备份已合并，恢复 ${r.added} 份内容`);
  });
  e.target.value = "";
};
$("#cover-size").value = localStorage.getItem("folio-size") || 174;
document.body.style.setProperty("--cover-width", $("#cover-size").value + "px");
$("#cover-size").oninput = (e) => {
  document.body.style.setProperty("--cover-width", e.target.value + "px");
  localStorage.setItem("folio-size", e.target.value);
};
if (localStorage.getItem("folio-theme") === "dark")
  document.body.classList.add("dark");
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!document.querySelector("dialog[open]")) {
      $("#search").focus();
      $("#search").select();
    }
  }
});
$("#detail-dialog").addEventListener("cancel", (e) => {
  if (editing) {
    e.preventDefault();
    attempt(async () => {
      if (
        await confirmAction("离开编辑？", "尚未保存的内容会被丢弃。", "离开")
      ) {
        editing = false;
        $("#detail-dialog").close();
      }
    });
  }
});
$$("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    ) {
      if (
        d.id === "confirm-dialog" ||
        (d.id === "detail-dialog" && editing) ||
        (d.id === "move-dialog" && moving)
      )
        return;
      d.close();
    }
  }),
);
document.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".book-card");
  if (!card) return;
  dragId = card.dataset.id;
  e.dataTransfer.setData("text/plain", dragId);
  e.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
});
document.addEventListener("dragend", () => {
  dragId = null;
  $$(".dragging,.drop-target,.drag-before").forEach((el) =>
    el.classList.remove("dragging", "drop-target", "drag-before"),
  );
});
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
document.addEventListener("dragleave", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    dragDepth--;
    if (dragDepth <= 0) $("#drop-overlay").hidden = true;
  }
});
document.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    return;
  }
  if (!dragId) return;
  const col = e.target.closest("[data-collection]"),
    card = e.target.closest(".book-card");
  if (col || card) {
    e.preventDefault();
    $$(".drop-target,.drag-before").forEach((el) =>
      el.classList.remove("drop-target", "drag-before"),
    );
    col?.classList.add("drop-target");
    if (card?.dataset.id !== dragId) card?.classList.add("drag-before");
  }
});
document.addEventListener("drop", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    $("#drop-overlay").hidden = true;
    dragDepth = 0;
    const files = [...e.dataTransfer.files];
    if (files.length) {
      if ($("#import-dialog").open && importTab === "upload") {
        selectedFiles = files;
        renderSelectedFiles();
      } else {
        showImport("upload");
        selectedFiles = files;
        renderSelectedFiles();
      }
    }
    return;
  }
  if (!dragId) return;
  const col = e.target.closest("[data-collection]"),
    card = e.target.closest(".book-card"),
    id = dragId;
  if (col) {
    e.preventDefault();
    attempt(async () => {
      await api(`/api/books/${id}`, "PATCH", {
        collection_id: col.dataset.collection,
      });
      await refresh();
      toast(`已归档到「${collectionName(col.dataset.collection)}」`);
    });
  } else if (card && card.dataset.id !== id) {
    e.preventDefault();
    attempt(async () => {
      const ids = state.books
          .filter((b) => !b.trashed)
          .sort((a, b) => b.position - a.position)
          .map((b) => b.id),
        from = ids.indexOf(id);
      if (from < 0) return;
      ids.splice(from, 1);
      ids.splice(ids.indexOf(card.dataset.id), 0, id);
      await api("/api/reorder", "POST", { ids });
      $("#sort").value = "manual";
      await refresh();
      toast("书架顺序已保存");
    });
  }
});
if ("modelContext" in navigator) {
  try {
    navigator.modelContext.registerTool({
      name: "search_bookshelf",
      description:
        "Search this local bookshelf by title, tags, notes, path or indexed text.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      execute: async ({ query }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await api("/api/search?q=" + encodeURIComponent(query)),
            ),
          },
        ],
      }),
    });
  } catch {
    /* Experimental WebMCP is optional. */
  }
}
attempt(async () => {
  await refresh();
  const q = new URLSearchParams(location.search);
  if (q.get("book") && state.books.some((b) => b.id === q.get("book"))) {
    await openBook(q.get("book"));
    if (q.get("tab") === "location") {
      detailTab = "location";
      await renderDetail();
    }
    history.replaceState(null, "", "/");
  }
});
