import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import hljs from "highlight.js";
import { NativePicker } from "./lib/native-dialog.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(
  process.env.FOLIO_DATA_DIR || path.join(ROOT, "data"),
);
const PORT = Number(process.env.PORT || 4173);
const TOKEN = randomBytes(32).toString("hex");
const MAX_FILE = 32 * 1024 * 1024;
const MAX_BODY = 128 * 1024 * 1024;
const TEXT_EXT = new Set([
  "md",
  "markdown",
  "txt",
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
  "csv",
  "log",
  "sql",
  "sh",
  "bat",
  "ini",
  "toml",
  "vue",
  "svelte",
]);
await fsp.mkdir(path.join(DATA, "files"), { recursive: true });
await fsp.mkdir(path.join(DATA, "covers"), { recursive: true });
const db = new DatabaseSync(path.join(DATA, "library.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,title TEXT NOT NULL,file_name TEXT,extension TEXT,kind TEXT NOT NULL,source TEXT,stored TEXT,color TEXT,pattern TEXT,cover TEXT,collection_id TEXT,tags TEXT DEFAULT '[]',note TEXT DEFAULT '',created INTEGER,updated INTEGER,last_opened INTEGER DEFAULT 0,review_date TEXT DEFAULT '',favorite INTEGER DEFAULT 0,excerpt TEXT DEFAULT '',position INTEGER DEFAULT 0,hash TEXT,trashed INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS moves(id TEXT PRIMARY KEY,book_id TEXT,before_path TEXT,after_path TEXT,created INTEGER,undone INTEGER DEFAULT 0);`);
const collections = [
  ["reading", "文学与阅读"],
  ["code", "代码与技术"],
  ["notes", "笔记与灵感"],
  ["links", "网络收藏"],
  ["inbox", "待整理"],
];
for (const [id, name] of collections)
  db.prepare("INSERT OR IGNORE INTO collections VALUES(?,?)").run(id, name);
const colors = [
  "#42594d",
  "#c48665",
  "#4b6374",
  "#c1a35d",
  "#6f667d",
  "#b35e51",
  "#677a71",
];
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const getBook = (id) => {
  const b = db.prepare("SELECT * FROM books WHERE id=?").get(id);
  if (!b) throw fail("这本书已经不在书柜里了", 404);
  return b;
};
const filePath = (b) =>
  b.kind === "path"
    ? b.source
    : b.stored
      ? path.join(DATA, "files", b.stored)
      : null;
function cleanName(name) {
  const s = String(name || "未命名")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim()
    .slice(0, 180);
  if (
    !s ||
    /^\.+$/.test(s) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)
  )
    throw fail("请使用有效的文件名");
  return s;
}
function title(s) {
  const v = String(s || "")
    .trim()
    .slice(0, 200);
  if (!v) throw fail("请填写名称");
  return v;
}
function httpURL(s) {
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol)) throw 0;
    return u.href;
  } catch {
    throw fail("请输入以 http:// 或 https:// 开头的链接");
  }
}
const ext = (s) => path.extname(s).slice(1).toLowerCase();
function decode(buffer) {
  const text = new TextDecoder("utf-8").decode(buffer);
  return text.includes("\ufffd")
    ? new TextDecoder("gb18030").decode(buffer)
    : text;
}
function excerpt(buffer, extension) {
  return TEXT_EXT.has(extension) ? decode(buffer.subarray(0, 512 * 1024)) : "";
}
function addBook(v) {
  const id = randomUUID(),
    now = Date.now();
  db.prepare(
    `INSERT INTO books(id,title,file_name,extension,kind,source,stored,color,pattern,collection_id,tags,note,created,updated,excerpt,position,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    title(v.title),
    v.file_name || "",
    v.extension || "",
    v.kind,
    v.source || "",
    v.stored || "",
    v.color ||
      colors[
        db.prepare("SELECT COUNT(*) AS n FROM books").get().n % colors.length
      ],
    v.pattern || "lines",
    v.collection_id || "inbox",
    JSON.stringify(v.tags || []),
    v.note || "",
    now,
    now,
    v.excerpt || "",
    now,
    v.hash || "",
  );
  return getBook(id);
}
async function saveCopy(buffer, name, options = {}) {
  if (buffer.length > MAX_FILE)
    throw fail("单个文件上限为 32 MB；大文件请选择本地路径方式");
  const file_name = cleanName(name),
    extension = ext(file_name),
    hash = createHash("sha256").update(buffer).digest("hex");
  if (
    !options.allowDuplicate &&
    db
      .prepare(
        "SELECT id FROM books WHERE hash=? AND trashed=0 AND kind IN ('copy','note')",
      )
      .get(hash)
  )
    return null;
  const stored = randomUUID() + (extension ? "." + extension : "");
  await fsp.writeFile(path.join(DATA, "files", stored), buffer, { flag: "wx" });
  try {
    return addBook({
      ...options,
      kind: options.kind || "copy",
      title: options.title || path.parse(file_name).name,
      file_name,
      extension,
      stored,
      hash,
      excerpt:
        options.kind === "note"
          ? decode(buffer.subarray(0, 512 * 1024))
          : excerpt(buffer, extension),
    });
  } catch (e) {
    await fsp.unlink(path.join(DATA, "files", stored));
    throw e;
  }
}
async function seed() {
  if (
    process.env.FOLIO_NO_SEED === "1" ||
    db.prepare("SELECT COUNT(*) AS n FROM books").get().n
  )
    return;
  const demos = [
    [
      "从这里开始.md",
      "从这里开始",
      "notes",
      "# 欢迎来到拾页\n\n给重要的文件，一个记得住的位置。\n\n## 五种入柜方式\n- 上传文件：保存一份副本，原文件不变。\n- 本地路径：引用原文件，适合大文件。\n- 导入文件夹：批量复制或引用。\n- 收藏链接：记住网页地址和自己的笔记。\n- 粘贴内容：把灵感保存为 Markdown。\n\n## 整理与找回\n点击书籍可以阅读、改名、加标签和定制封面。将书拖到左边的分类，只改变书柜分类。\n\n真正移动原文件请使用详情里的「移动本地文件」，移动后可撤销。\n\n按 Ctrl / ⌘ + K 快速搜索。搜索也会查找文本文件内容。定期从设置导出完整备份。",
    ],
    [
      "阅读札记.md",
      "阅读，是另一种旅行",
      "reading",
      "# 阅读，是另一种旅行\n\n一段值得留存的文字，常常比一整本书更接近当时的自己。\n\n## 我的阅读方法\n1. 留下喜欢的句子。\n2. 写下此刻的想法。\n3. 设定一个再次翻阅的日期。\n\n> 不必记住一切，只需留下重新找到它的路。\n\n这是项目自带的原创示例，可以自由修改。",
    ],
    [
      "algorithm.cpp",
      "算法的日常",
      "code",
      "// 示例：二分查找\n#include <vector>\nint search(const std::vector<int>& a, int key) {\n    int left = 0, right = (int)a.size() - 1;\n    while (left <= right) {\n        int mid = left + (right - left) / 2;\n        if (a[mid] == key) return mid;\n        if (a[mid] < key) left = mid + 1;\n        else right = mid - 1;\n    }\n    return -1;\n}\n",
    ],
    [
      "ideas.txt",
      "一些未完成的想法",
      "notes",
      "窗外下雨的时候，整理了一下桌面。\n\n想做的事：\n为收藏的文章写一句自己的推荐语。\n把散落在下载文件夹的资料放到同一个地方。\n每个月回顾一次过去的笔记。\n\n此文件为原创示例。",
    ],
    [
      "garden.md",
      "我的数字花园",
      "notes",
      "# 我的数字花园\n\n知识不必是一个完美的体系，它也可以慢慢生长。\n\n- 正在学习：JavaScript\n- 正在阅读：散文\n- 想要保留：那些突然出现的想法\n",
    ],
    [
      "hello.js",
      "写给未来的自己",
      "code",
      '// 文件可以被找到，想法就不会被遗忘。\nconst reminder = {\n  title: "给重要内容一个位置",\n  tags: ["灵感", "长期保存"],\n};\nconsole.log(reminder);\n',
    ],
  ];
  for (const [name, t, c, content] of demos)
    await saveCopy(Buffer.from(content), name, {
      title: t,
      collection_id: c,
      tags: ["示例"],
      allowDuplicate: true,
    });
  addBook({
    title: "MDN · Web 开发参考",
    kind: "url",
    source: "https://developer.mozilla.org/zh-CN/",
    collection_id: "links",
    tags: ["示例", "参考资料"],
    note: "学习 Web 时随手查阅的参考资料。",
    pattern: "orbit",
  });
}
await seed();

async function jsonBody(req) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw fail("请求过大，请分批导入", 413);
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString() || "{}");
  } catch {
    throw fail("请求格式无效");
  }
}
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function browseDirectory(
  directory,
  recursive = true,
  depth = 0,
  entries = [],
) {
  if (depth > 12) return entries;
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (entries.length >= 1000)
      throw fail("一次最多导入 1000 个文件，请选择更小的文件夹");
    if (
      entry.name.startsWith(".") ||
      ["node_modules", "data", "dist"].includes(entry.name)
    )
      continue;
    const p = path.join(directory, entry.name);
    if (entry.isFile()) entries.push(p);
    else if (entry.isDirectory() && recursive)
      await browseDirectory(p, recursive, depth + 1, entries);
  }
  return entries;
}
const nativePicker = new NativePicker();
async function refreshExcerpt(b) {
  const p = filePath(b);
  if (p && (TEXT_EXT.has(b.extension) || b.kind === "note")) {
    const st = await fsp.stat(p);
    const f = await fsp.open(p, "r");
    try {
      const buf = Buffer.alloc(Math.min(st.size, 512 * 1024));
      await f.read(buf, 0, buf.length, 0);
      db.prepare("UPDATE books SET excerpt=?,updated=? WHERE id=?").run(
        b.kind === "note" ? decode(buf) : excerpt(buf, b.extension),
        Date.now(),
        b.id,
      );
    } finally {
      await f.close();
    }
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "";
    if (!/^127\.0\.0\.1:\d+$/.test(host) && !/^localhost:\d+$/.test(host))
      throw fail("请从本机地址访问", 403);
    const u = new URL(req.url, "http://" + host),
      route = u.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (route.startsWith("/api/")) {
      if (req.headers.origin && req.headers.origin !== "http://" + host)
        throw fail("请求来源不匹配", 403);
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers["x-folio-token"] !== TOKEN
      )
        throw fail("请刷新页面后重试", 403);
      if (route === "/api/health" && req.method === "GET")
        return json(res, { app: "folio-bookshelf", version: "1.0.1" });
      if (route === "/api/reindex" && req.method === "POST") {
        const books = db
          .prepare("SELECT * FROM books WHERE trashed=0 AND kind='path'")
          .all();
        let updated = 0;
        const errors = [];
        for (const b of books)
          try {
            await refreshExcerpt(b);
            updated++;
          } catch (e) {
            errors.push(b.title);
          }
        return json(res, { updated, missing: errors.length });
      }
      if (route === "/api/state" && req.method === "GET") {
        const books = db
          .prepare("SELECT * FROM books ORDER BY position DESC")
          .all()
          .map(({ excerpt, hash, ...b }) => ({
            ...b,
            tags: JSON.parse(b.tags),
          }));
        const stats = {};
        for (const b of books) {
          if (b.kind === "url") {
            stats[b.id] = "link";
            continue;
          }
          try {
            await fsp.access(filePath(b));
            stats[b.id] = "ok";
          } catch {
            stats[b.id] = "missing";
          }
        }
        return json(res, {
          books,
          collections: db.prepare("SELECT * FROM collections").all(),
          stats,
          token: TOKEN,
          platform: process.platform,
          dataPath: DATA,
        });
      }
      if (route === "/api/search" && req.method === "GET") {
        const q = String(u.searchParams.get("q") || "").slice(0, 300);
        const like = "%" + q.replace(/[!%_]/g, "!$&") + "%";
        return json(res, {
          ids: db
            .prepare(
              "SELECT id FROM books WHERE title LIKE ? ESCAPE '!' OR file_name LIKE ? ESCAPE '!' OR tags LIKE ? ESCAPE '!' OR note LIKE ? ESCAPE '!' OR excerpt LIKE ? ESCAPE '!' OR source LIKE ? ESCAPE '!'",
            )
            .all(like, like, like, like, like, like)
            .map((b) => b.id),
        });
      }
      if (route === "/api/dialog" && req.method === "POST") {
        const body = await jsonBody(req);
        return json(res, await nativePicker.choose(body.kind));
      }
      if (route === "/api/dialog/state" && req.method === "GET")
        return json(res, {
          active: nativePicker.state.active,
          kind: nativePicker.state.kind,
        });
      if (route === "/api/dialog/focus" && req.method === "POST")
        return json(res, { active: nativePicker.focus() });
      if (route === "/api/dialog/cancel" && req.method === "POST")
        return json(res, { active: nativePicker.cancel() });
      if (route === "/api/import" && req.method === "POST") {
        const body = await jsonBody(req);
        if (!Array.isArray(body.files) || body.files.length > 100)
          throw fail("一次最多上传 100 个文件");
        let added = 0,
          skipped = 0;
        const errors = [];
        for (const f of body.files)
          try {
            const b = await saveCopy(
              Buffer.from(String(f.data || ""), "base64"),
              f.name,
              { collection_id: body.collection_id },
            );
            b ? added++ : skipped++;
          } catch (e) {
            errors.push({ name: f.name, message: e.message });
          }
        return json(res, { added, skipped, errors });
      }
      if (route === "/api/import-path" && req.method === "POST") {
        const body = await jsonBody(req);
        if (!Array.isArray(body.paths) || body.paths.length > 1000)
          throw fail("路径列表无效");
        const files = [];
        for (const p of body.paths) {
          if (!path.isAbsolute(p)) throw fail("请填写绝对路径");
          const st = await fsp.lstat(p);
          if (st.isSymbolicLink())
            throw fail("请直接选择原文件，不导入符号链接");
          if (st.isDirectory())
            files.push(...(await browseDirectory(p, body.recursive !== false)));
          else if (st.isFile()) files.push(path.resolve(p));
        }
        if (files.length > 1000) throw fail("一次最多导入 1000 个文件");
        let added = 0,
          skipped = 0;
        const errors = [];
        for (const p of files)
          try {
            if (body.mode === "copy") {
              const st = await fsp.stat(p);
              if (st.size > MAX_FILE) throw fail("超过 32 MB，请改用路径引用");
              const b = await saveCopy(
                await fsp.readFile(p),
                path.basename(p),
                { collection_id: body.collection_id, source: p },
              );
              b ? added++ : skipped++;
            } else {
              if (
                db
                  .prepare(
                    "SELECT id FROM books WHERE kind='path' AND source=? AND trashed=0",
                  )
                  .get(p)
              ) {
                skipped++;
                continue;
              }
              const b = addBook({
                kind: "path",
                title: path.parse(p).name,
                file_name: path.basename(p),
                extension: ext(p),
                source: p,
                collection_id: body.collection_id,
              });
              await refreshExcerpt(b);
              added++;
            }
          } catch (e) {
            errors.push({ name: path.basename(p), message: e.message });
          }
        return json(res, { added, skipped, errors });
      }
      if (route === "/api/link" && req.method === "POST") {
        const b = await jsonBody(req);
        return json(
          res,
          addBook({
            kind: "url",
            title: b.title || new URL(httpURL(b.url)).hostname,
            source: httpURL(b.url),
            collection_id: b.collection_id || "links",
            note: String(b.note || "").slice(0, 10000),
            tags: b.tags || [],
          }),
        );
      }
      if (route === "/api/note" && req.method === "POST") {
        const b = await jsonBody(req);
        const extension = String(b.extension ?? "md")
          .trim()
          .toLowerCase()
          .replace(/^\./, "");
        if (!/^[a-z0-9]{1,12}$/.test(extension))
          throw fail("文件扩展名请使用 1–12 个英文字母或数字");
        if (
          [
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "epub",
            "doc",
            "docx",
            "xls",
            "xlsx",
            "ppt",
            "pptx",
            "zip",
            "rar",
            "7z",
            "exe",
            "dll",
            "bin",
            "sqlite",
          ].includes(extension)
        )
          throw fail("此格式不是纯文本格式，请选择文字或代码文件类型");
        const noteTitle = title(b.title || "新笔记");
        const baseName = cleanName(noteTitle).replace(
          new RegExp("\\." + extension + "$", "i"),
          "",
        );
        return json(
          res,
          await saveCopy(
            Buffer.from(String(b.content || "")),
            baseName + "." + extension,
            {
              title: noteTitle,
              kind: "note",
              collection_id: b.collection_id || "notes",
              allowDuplicate: true,
            },
          ),
        );
      }
      if (route === "/api/collections" && req.method === "POST") {
        const b = await jsonBody(req),
          id = randomUUID();
        db.prepare("INSERT INTO collections VALUES(?,?)").run(
          id,
          title(b.name),
        );
        return json(res, { id });
      }
      if (route === "/api/reorder" && req.method === "POST") {
        const b = await jsonBody(req);
        if (!Array.isArray(b.ids) || b.ids.length > 10000)
          throw fail("排序格式无效");
        const stmt = db.prepare("UPDATE books SET position=? WHERE id=?");
        db.exec("BEGIN");
        try {
          b.ids.forEach((id, i) => stmt.run(b.ids.length - i, id));
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        return json(res, { ok: true });
      }
      if (route === "/api/backup" && req.method === "GET") {
        const books = db.prepare("SELECT * FROM books").all(),
          files = {};
        let total = 0;
        for (const b of books)
          for (const [dir, name] of [
            ["files", b.stored],
            ["covers", b.cover],
          ])
            if (name) {
              const key = dir + "/" + name;
              if (files[key]) continue;
              try {
                const buf = await fsp.readFile(path.join(DATA, dir, name));
                total += buf.length;
                if (total > 256 * 1024 * 1024)
                  throw fail("备份超过 256 MB，请直接复制 data 文件夹");
                files[key] = buf.toString("base64");
              } catch (e) {
                if (e.code === "ENOENT")
                  throw fail(
                    `备份中缺少「${b.title}」的本地副本或封面，请先检查文件`,
                  );
                throw e;
              }
            }
        const backup = {
          format: "folio-backup",
          version: 1,
          created: new Date().toISOString(),
          collections: db.prepare("SELECT * FROM collections").all(),
          books,
          files,
        };
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="folio-backup.folio"',
        );
        return json(res, backup);
      }
      if (route === "/api/restore" && req.method === "POST") {
        const b = await jsonBody(req);
        if (
          b.format !== "folio-backup" ||
          b.version !== 1 ||
          !Array.isArray(b.books) ||
          !Array.isArray(b.collections) ||
          typeof b.files !== "object" ||
          !b.files ||
          b.books.length > 10000
        )
          throw fail("请选择有效的 .folio 备份文件");
        // Merge restore never overwrites existing records or original paths.
        const mapping = new Map(),
          created = [],
          needed = new Set();
        let count = 0;
        for (const book of b.books) {
          if (
            !["copy", "note", "path", "url"].includes(book.kind) ||
            typeof book.id !== "string" ||
            typeof book.title !== "string"
          )
            throw fail("备份书籍格式无效");
          let tags;
          try {
            tags = JSON.parse(book.tags || "[]");
          } catch {
            throw fail("备份标签格式无效");
          }
          if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))
            throw fail("备份标签格式无效");
          if (book.kind === "url") httpURL(book.source);
          if (
            book.kind === "path" &&
            (typeof book.source !== "string" || !path.isAbsolute(book.source))
          )
            throw fail("备份本地路径无效");
          if (
            ["copy", "note"].includes(book.kind) &&
            !Object.hasOwn(b.files, "files/" + book.stored)
          )
            throw fail("备份缺少文件副本");
          if (book.cover && !Object.hasOwn(b.files, "covers/" + book.cover))
            throw fail("备份缺少封面");
          if (!db.prepare("SELECT id FROM books WHERE id=?").get(book.id)) {
            if (book.stored) needed.add("files/" + book.stored);
            if (book.cover) needed.add("covers/" + book.cover);
          }
        }
        for (const [key, value] of Object.entries(b.files)) {
          if (
            !/^(files|covers)\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]+)?$/.test(key) ||
            typeof value !== "string"
          )
            throw fail("备份包含无效文件路径");
          if (!needed.has(key)) continue;
          const [dir, old] = key.split("/"),
            name = randomUUID() + path.extname(old),
            buf = Buffer.from(value, "base64");
          if (buf.length > MAX_FILE) throw fail("备份单个文件超过上限");
          mapping.set(key, name);
          created.push([path.join(DATA, dir, name), buf]);
        }
        for (const [p, buf] of created)
          await fsp.writeFile(p, buf, { flag: "wx" });
        db.exec("BEGIN");
        try {
          for (const c of b.collections)
            db.prepare("INSERT OR IGNORE INTO collections VALUES(?,?)").run(
              String(c.id),
              title(c.name),
            );
          for (const v of b.books) {
            if (db.prepare("SELECT id FROM books WHERE id=?").get(v.id))
              continue;
            const n = addBook({
              ...v,
              tags: JSON.parse(v.tags || "[]"),
              stored: mapping.get("files/" + v.stored) || "",
              excerpt: v.excerpt || "",
            });
            db.prepare(
              "UPDATE books SET favorite=?,review_date=?,cover=?,trashed=? WHERE id=?",
            ).run(
              v.favorite ? 1 : 0,
              String(v.review_date || ""),
              mapping.get("covers/" + v.cover) || "",
              v.trashed ? 1 : 0,
              n.id,
            );
            db.prepare(
              "UPDATE books SET id=?,created=?,updated=?,last_opened=?,position=? WHERE id=?",
            ).run(
              String(v.id),
              Number(v.created) || Date.now(),
              Number(v.updated) || Date.now(),
              Number(v.last_opened) || 0,
              Number(v.position) || Number(v.created) || Date.now(),
              n.id,
            );
            count++;
          }
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          for (const [p] of created) await fsp.unlink(p).catch(() => {});
          throw e;
        }
        return json(res, { added: count });
      }
      const match = route.match(/^\/api\/books\/([^/]+)(?:\/(\w[\w-]*))?$/);
      if (match) {
        const b = getBook(match[1]),
          action = match[2];
        if (!action && req.method === "PATCH") {
          const v = await jsonBody(req),
            allowed = [
              "title",
              "collection_id",
              "tags",
              "note",
              "color",
              "pattern",
              "favorite",
              "review_date",
              "trashed",
            ];
          const updates = [];
          const vals = [];
          for (const key of allowed)
            if (key in v) {
              let value = v[key];
              if (key === "title") value = title(value);
              if (key === "tags") {
                if (!Array.isArray(value) || value.length > 30)
                  throw fail("最多添加 30 个标签");
                value = JSON.stringify(
                  value.map((t) => String(t).slice(0, 40)),
                );
              }
              if (key === "color" && !/^#[0-9a-f]{6}$/i.test(value))
                throw fail("封面颜色无效");
              if (
                key === "pattern" &&
                !["lines", "orbit", "plain", "grid"].includes(value)
              )
                throw fail("封面样式无效");
              if (key === "note") value = String(value).slice(0, 20000);
              if (key === "favorite" || key === "trashed")
                value = value ? 1 : 0;
              if (
                key === "collection_id" &&
                !db.prepare("SELECT id FROM collections WHERE id=?").get(value)
              )
                throw fail("分类不存在");
              if (
                key === "review_date" &&
                value &&
                !/^\d{4}-\d{2}-\d{2}$/.test(value)
              )
                throw fail("回顾日期无效");
              updates.push(key + "=?");
              vals.push(value);
            }
          if (updates.length)
            db.prepare(
              "UPDATE books SET " + updates.join(",") + ",updated=? WHERE id=?",
            ).run(...vals, Date.now(), b.id);
          return json(res, { ok: true });
        }
        if (action === "cover" && req.method === "POST") {
          const v = await jsonBody(req),
            buf = Buffer.from(String(v.data || ""), "base64");
          if (buf.length > 5 * 1024 * 1024) throw fail("封面图片请小于 5 MB");
          let extension;
          if (
            buf
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          )
            extension = "png";
          else if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255)
            extension = "jpg";
          else if (
            buf.subarray(0, 4).toString() === "RIFF" &&
            buf.subarray(8, 12).toString() === "WEBP"
          )
            extension = "webp";
          else throw fail("支持 PNG、JPEG 和 WebP 图片");
          const cover = randomUUID() + "." + extension;
          await fsp.writeFile(path.join(DATA, "covers", cover), buf);
          db.prepare("UPDATE books SET cover=?,updated=? WHERE id=?").run(
            cover,
            Date.now(),
            b.id,
          );
          return json(res, { ok: true });
        }
        if (action === "remove-cover" && req.method === "POST") {
          db.prepare("UPDATE books SET cover='' WHERE id=?").run(b.id);
          return json(res, { ok: true });
        }
        if (action === "open" && req.method === "POST") {
          db.prepare("UPDATE books SET last_opened=? WHERE id=?").run(
            Date.now(),
            b.id,
          );
          return json(res, { ok: true });
        }
        if (action === "refresh" && req.method === "POST") {
          await refreshExcerpt(b);
          return json(res, { ok: true });
        }
        if (action === "relink" && req.method === "POST") {
          if (b.kind !== "path") throw fail("仅路径引用支持重新定位");
          const v = await jsonBody(req);
          if (!path.isAbsolute(v.path)) throw fail("请填写绝对路径");
          const st = await fsp.stat(v.path);
          if (!st.isFile()) throw fail("请选择文件");
          const p = path.resolve(v.path);
          db.prepare(
            "UPDATE books SET source=?,file_name=?,extension=?,updated=? WHERE id=?",
          ).run(p, path.basename(p), ext(p), Date.now(), b.id);
          await refreshExcerpt(getBook(b.id));
          return json(res, { ok: true });
        }
        if (action === "move" && req.method === "POST") {
          const v = await jsonBody(req);
          if (b.kind !== "path")
            throw fail("仅路径引用可移动原文件，副本可通过下载另存");
          if (v.confirm !== true) throw fail("请先确认移动原文件");
          if (!path.isAbsolute(v.directory))
            throw fail("目标文件夹必须是绝对路径");
          const targetDir = await fsp.realpath(v.directory),
            st = await fsp.stat(targetDir);
          if (!st.isDirectory()) throw fail("目标应为文件夹");
          const source = await fsp.realpath(b.source),
            dest = path.join(
              targetDir,
              cleanName(v.filename || path.basename(source)),
            );
          if (source === dest) throw fail("文件已经在这个位置");
          await fsp.copyFile(source, dest, fs.constants.COPYFILE_EXCL);
          try {
            await fsp.unlink(source);
          } catch (e) {
            await fsp.unlink(dest).catch(() => {});
            throw e;
          }
          const moveId = randomUUID();
          try {
            db.exec("BEGIN");
            db.prepare(
              "UPDATE books SET source=?,file_name=?,extension=?,updated=? WHERE id=?",
            ).run(dest, path.basename(dest), ext(dest), Date.now(), b.id);
            db.prepare("INSERT INTO moves VALUES(?,?,?,?,?,0)").run(
              moveId,
              b.id,
              source,
              dest,
              Date.now(),
            );
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            await fsp.copyFile(dest, source, fs.constants.COPYFILE_EXCL);
            await fsp.unlink(dest);
            throw e;
          }
          return json(res, { ok: true, moveId, path: dest });
        }
        if (action === "undo-move" && req.method === "POST") {
          const m = db
            .prepare(
              "SELECT * FROM moves WHERE book_id=? AND undone=0 ORDER BY created DESC LIMIT 1",
            )
            .get(b.id);
          if (!m) throw fail("没有可撤销的移动");
          if (b.source !== m.after_path)
            throw fail("文件位置已改变，请重新定位");
          await fsp.copyFile(
            m.after_path,
            m.before_path,
            fs.constants.COPYFILE_EXCL,
          );
          try {
            await fsp.unlink(m.after_path);
          } catch (e) {
            await fsp.unlink(m.before_path).catch(() => {});
            throw e;
          }
          db.exec("BEGIN");
          try {
            db.prepare(
              "UPDATE books SET source=?,file_name=?,extension=?,updated=? WHERE id=?",
            ).run(
              m.before_path,
              path.basename(m.before_path),
              ext(m.before_path),
              Date.now(),
              b.id,
            );
            db.prepare("UPDATE moves SET undone=1 WHERE id=?").run(m.id);
            db.exec("COMMIT");
          } catch (e) {
            db.exec("ROLLBACK");
            await fsp.copyFile(
              m.before_path,
              m.after_path,
              fs.constants.COPYFILE_EXCL,
            );
            await fsp.unlink(m.before_path);
            throw e;
          }
          return json(res, { ok: true });
        }
        if (action === "reveal" && req.method === "POST") {
          const p = filePath(b);
          if (!p) throw fail("链接没有本地文件");
          await fsp.access(p);
          if (process.platform === "win32")
            spawn("explorer.exe", ["/select,", p], {
              windowsHide: true,
              detached: true,
              stdio: "ignore",
            }).unref();
          else if (process.platform === "darwin")
            spawn("open", ["-R", p], { stdio: "ignore" }).unref();
          else
            spawn("xdg-open", [path.dirname(p)], { stdio: "ignore" }).unref();
          return json(res, { ok: true });
        }
        if (action === "content" && req.method === "PUT") {
          const v = await jsonBody(req);
          if (
            !["copy", "note"].includes(b.kind) ||
            (!TEXT_EXT.has(b.extension) && b.kind !== "note")
          )
            throw fail("只支持编辑书柜中的文本副本");
          const content = Buffer.from(String(v.content || ""));
          if (content.length > MAX_FILE) throw fail("文本内容过大");
          const p = filePath(b),
            temp = p + ".tmp";
          await fsp.writeFile(temp, content);
          await fsp.rename(temp, p);
          db.prepare(
            "UPDATE books SET excerpt=?,hash=?,updated=? WHERE id=?",
          ).run(
            b.kind === "note"
              ? decode(content.subarray(0, 512 * 1024))
              : excerpt(content, b.extension),
            createHash("sha256").update(content).digest("hex"),
            Date.now(),
            b.id,
          );
          return json(res, { ok: true });
        }
        if (action === "content" && req.method === "GET") {
          const p = filePath(b);
          if (!p) throw fail("网络链接请在浏览器中打开");
          let st;
          try {
            st = await fsp.stat(p);
          } catch {
            throw fail("原文件已移动或删除，请重新定位", 404);
          }
          if (!st.isFile()) throw fail("路径不再指向文件");
          if (u.searchParams.get("text") === "1") {
            if (!TEXT_EXT.has(b.extension) && b.kind !== "note")
              throw fail("此格式请下载或用系统应用打开");
            const f = await fsp.open(p, "r");
            try {
              const length = Math.min(st.size, 2 * 1024 * 1024),
                buf = Buffer.alloc(length);
              await f.read(buf, 0, length, 0);
              const text = decode(buf),
                language =
                  {
                    js: "javascript",
                    jsx: "javascript",
                    ts: "typescript",
                    tsx: "typescript",
                    h: "cpp",
                    hpp: "cpp",
                    html: "xml",
                    vue: "xml",
                    py: "python",
                    sh: "bash",
                  }[b.extension] || b.extension;
              const highlighted =
                hljs.getLanguage(language) && text.length < 300000
                  ? hljs.highlight(text, { language, ignoreIllegals: true })
                      .value
                  : null;
              return json(res, {
                text,
                highlighted,
                truncated: st.size > length,
              });
            } finally {
              await f.close();
            }
          }
          const mime =
            {
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              webp: "image/webp",
              gif: "image/gif",
              pdf: "application/pdf",
            }[b.extension] || "application/octet-stream";
          const download =
            u.searchParams.has("download") ||
            mime === "application/octet-stream";
          if (mime === "application/pdf") {
            res.setHeader(
              "Content-Security-Policy",
              "default-src 'none'; frame-ancestors 'self'",
            );
          }
          res.writeHead(200, {
            "Content-Type": mime,
            "Content-Length": st.size,
            "Content-Disposition":
              (download ? "attachment" : "inline") +
              `; filename*=UTF-8''${encodeURIComponent(b.file_name || b.title)}`,
          });
          fs.createReadStream(p)
            .on("error", () => res.destroy())
            .pipe(res);
          return;
        }
      }
      throw fail("请求不存在", 404);
    }
    let target;
    if (route.startsWith("/covers/")) {
      const name = route.slice(8);
      if (!/^[\w-]+\.(png|jpg|webp)$/.test(name)) throw fail("图片不存在", 404);
      target = path.join(DATA, "covers", name);
    } else if (route.startsWith("/vendor/")) {
      const vendors = {
        "/vendor/marked.js": "marked/lib/marked.esm.js",
        "/vendor/purify.js": "dompurify/dist/purify.es.mjs",
        "/vendor/highlight.js": "highlight.js/es/common.js",
      };
      if (vendors[route])
        target = path.join(ROOT, "node_modules", vendors[route]);
      else throw fail("资源不存在", 404);
    } else {
      const decoded = decodeURIComponent(route);
      target = path.resolve(
        ROOT,
        "public",
        "." + (decoded === "/" ? "/index.html" : decoded),
      );
      if (!target.startsWith(path.join(ROOT, "public") + path.sep))
        throw fail("资源不存在", 404);
    }
    const types = {
      ".html": "text/html; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
    };
    const buf = await fsp.readFile(target);
    res.writeHead(200, {
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message =
      e.code === "ENOENT"
        ? "文件或文件夹不存在"
        : e.code === "EEXIST"
          ? "目标已有同名文件，未覆盖，请换一个名称"
          : e.code === "EACCES" || e.code === "EPERM"
            ? "文件正在使用或没有写入权限，请关闭占用程序后重试"
            : e.status
              ? e.message
              : "操作未完成，请重试";
    json(
      res,
      { error: message },
      e.status || (e.code === "ENOENT" ? 404 : 400),
    );
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Folio ready: http://127.0.0.1:${server.address().port}`);
  if (process.env.FOLIO_OPEN === "1") {
    const address = `http://127.0.0.1:${server.address().port}`;
    if (process.platform === "win32")
      spawn("cmd.exe", ["/c", "start", "", address], {
        windowsHide: true,
        stdio: "ignore",
      }).unref();
    else
      spawn(process.platform === "darwin" ? "open" : "xdg-open", [address], {
        stdio: "ignore",
      }).unref();
  }
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    nativePicker.dispose();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
