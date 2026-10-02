import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let dir, child, base, token, copyId, pathId, backup;
async function launch(dataDir) {
  const p = spawn(process.execPath, [path.join(root, "server.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      FOLIO_DATA_DIR: dataDir,
      FOLIO_NO_SEED: "1",
      FOLIO_OPEN: "0",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  p.stderr.on("data", (c) => (logs += c));
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Server timeout: " + logs)),
      10000,
    );
    p.stdout.on("data", (c) => {
      const match = String(c).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    p.on("exit", (code) => {
      clearTimeout(timeout);
      reject(Error("Server exited " + code + ": " + logs));
    });
  });
  return { p, url };
}
async function call(route, method = "GET", body, options = {}) {
  const r = await fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Folio-Token": token || "",
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-test-"));
  const r = await launch(path.join(dir, "data"));
  child = r.p;
  base = r.url;
  token = (await call("/api/state")).data.token;
});
after(async () => {
  if (child) {
    child.kill();
    await once(child, "exit").catch(() => {});
  }
  await fs.rm(dir, { recursive: true, force: true });
});

test("health, static app and loopback origin/token enforcement", async () => {
  assert.equal((await call("/api/health")).data.app, "folio-bookshelf");
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/vendor/marked.js")).status, 200);
  assert.equal((await fetch(base + "/vendor/purify.js")).status, 200);
  assert.equal(
    (
      await call(
        "/api/note",
        "POST",
        { title: "bad", content: "x" },
        { headers: { "X-Folio-Token": "" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/state", "GET", undefined, {
        headers: { Origin: "https://example.org" },
      })
    ).status,
    403,
  );
});
test("copy import, duplicate detection, full text search and literal LIKE characters", async () => {
  const f = {
    name: "项目笔记.md",
    data: Buffer.from(
      "# 测试\n\n忘记名字也能搜到：青石桥下的回声。\n100% complete",
    ).toString("base64"),
  };
  assert.equal(
    (await call("/api/import", "POST", { files: [f] })).data.added,
    1,
  );
  assert.equal(
    (await call("/api/import", "POST", { files: [f] })).data.skipped,
    1,
  );
  copyId = (await call("/api/state")).data.books[0].id;
  assert.ok(
    (
      await call("/api/search?q=" + encodeURIComponent("青石桥"))
    ).data.ids.includes(copyId),
  );
  assert.ok(
    (
      await call("/api/search?q=" + encodeURIComponent("100%"))
    ).data.ids.includes(copyId),
  );
  assert.deepEqual(
    (await call("/api/search?q=" + encodeURIComponent("100_"))).data.ids,
    [],
  );
});
test("display rename, tags, collection, favorite, cover and content editing persist", async () => {
  const { data: c } = await call("/api/collections", "POST", {
    name: "长期参考",
  });
  assert.equal(
    (
      await call("/api/books/" + copyId, "PATCH", {
        title: "重新命名",
        tags: ["重要", "文学"],
        favorite: true,
        collection_id: c.id,
        color: "#42594d",
        pattern: "orbit",
        review_date: "2026-10-02",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/api/books/" + copyId + "/content", "PUT", {
        content: "# 新正文\n索引更新标记：星河",
      })
    ).status,
    200,
  );
  assert.ok(
    (
      await call("/api/search?q=" + encodeURIComponent("星河"))
    ).data.ids.includes(copyId),
  );
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhzsAAAAASUVORK5CYII=";
  assert.equal(
    (await call("/api/books/" + copyId + "/cover", "POST", { data: png }))
      .status,
    200,
  );
  const b = (await call("/api/state")).data.books.find((b) => b.id === copyId);
  assert.equal(b.title, "重新命名");
  assert.equal(b.file_name, "项目笔记.md");
  assert.deepEqual(b.tags, ["重要", "文学"]);
  assert.ok(b.cover);
  assert.equal((await fetch(base + "/covers/" + b.cover)).status, 200);
});
test("network links accept HTTP(S) only and never execute file content", async () => {
  assert.equal(
    (
      await call("/api/link", "POST", {
        url: "javascript:alert(1)",
        title: "bad",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/link", "POST", {
        url: "https://example.com/article",
        title: "网络文章",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("/api/note", "POST", {
        title: "笔记",
        content: "# 笔记\n原创内容",
      })
    ).status,
    200,
  );
  const r = await fetch(base + "/api/books/" + copyId + "/content");
  assert.match(r.headers.get("content-disposition"), /^attachment/);
});
test("reference import, preview, actual move, no-overwrite and two-level undo", async () => {
  const source = path.join(dir, "原文.txt"),
    target = path.join(dir, "target"),
    target2 = path.join(dir, "target2");
  await fs.mkdir(target);
  await fs.mkdir(target2);
  await fs.writeFile(source, "重要的本地内容");
  assert.equal(
    (await call("/api/import-path", "POST", { paths: [source] })).data.added,
    1,
  );
  assert.equal(
    (await call("/api/import-path", "POST", { paths: [source] })).data.skipped,
    1,
  );
  pathId = (await call("/api/state")).data.books.find(
    (b) => b.kind === "path",
  ).id;
  assert.equal(
    (await call(`/api/books/${pathId}/content?text=1`)).data.text,
    "重要的本地内容",
  );
  assert.equal(
    (await call(`/api/books/${pathId}/content`, "PUT", { content: "bad" }))
      .status,
    400,
  );
  assert.equal(
    (await call(`/api/books/${pathId}/move`, "POST", { directory: target }))
      .status,
    400,
  );
  await fs.writeFile(path.join(target, "collision.txt"), "existing");
  assert.equal(
    (
      await call(`/api/books/${pathId}/move`, "POST", {
        directory: target,
        filename: "collision.txt",
        confirm: true,
      })
    ).status,
    400,
  );
  assert.equal(await fs.readFile(source, "utf8"), "重要的本地内容");
  assert.equal(
    await fs.readFile(path.join(target, "collision.txt"), "utf8"),
    "existing",
  );
  assert.equal(
    (
      await call(`/api/books/${pathId}/move`, "POST", {
        directory: target,
        filename: "搬家.txt",
        confirm: true,
      })
    ).status,
    200,
  );
  await assert.rejects(fs.access(source));
  assert.equal(
    await fs.readFile(path.join(target, "搬家.txt"), "utf8"),
    "重要的本地内容",
  );
  assert.equal(
    (
      await call(`/api/books/${pathId}/move`, "POST", {
        directory: target2,
        confirm: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(`/api/books/${pathId}/undo-move`, "POST", {})).status,
    200,
  );
  assert.equal(
    (await call(`/api/books/${pathId}/undo-move`, "POST", {})).status,
    200,
  );
  assert.equal(await fs.readFile(source, "utf8"), "重要的本地内容");
});
test("missing detection, relinking and index refresh", async () => {
  const b = (await call("/api/state")).data.books.find((b) => b.id === pathId),
    newPath = path.join(dir, "新地址.txt");
  await fs.rename(b.source, newPath);
  assert.equal((await call("/api/state")).data.stats[pathId], "missing");
  assert.equal(
    (await call(`/api/books/${pathId}/relink`, "POST", { path: newPath }))
      .status,
    200,
  );
  await fs.writeFile(newPath, "新的正文：稻香");
  assert.equal((await call("/api/reindex", "POST", {})).status, 200);
  assert.ok(
    (
      await call("/api/search?q=" + encodeURIComponent("稻香"))
    ).data.ids.includes(pathId),
  );
});
test("recursive folder import excludes hidden and node_modules", async () => {
  const folder = path.join(dir, "folder");
  await fs.mkdir(path.join(folder, "child"), { recursive: true });
  await fs.mkdir(path.join(folder, "node_modules"));
  await fs.writeFile(path.join(folder, "a.js"), "const a=1;");
  await fs.writeFile(path.join(folder, "child", "b.cpp"), "int b=2;");
  await fs.writeFile(path.join(folder, "node_modules", "ignore.txt"), "ignore");
  await fs.writeFile(path.join(folder, ".hidden"), "hidden");
  const r = await call("/api/import-path", "POST", {
    paths: [folder],
    mode: "path",
  });
  assert.equal(r.data.added, 2);
  assert.equal(r.data.errors.length, 0);
});
test("reorder and trash operate on records, not original files", async () => {
  assert.equal(
    (await call("/api/reorder", "POST", { ids: [copyId, pathId] })).status,
    200,
  );
  assert.equal((await call("/api/state")).data.books[0].id !== undefined, true);
  assert.equal(
    (await call("/api/books/" + pathId, "PATCH", { trashed: true })).status,
    200,
  );
  const b = (await call("/api/state")).data.books.find((b) => b.id === pathId);
  await fs.access(b.source);
  assert.equal(b.trashed, 1);
  assert.equal(
    (await call("/api/books/" + pathId, "PATCH", { trashed: false })).status,
    200,
  );
});
test("complete backup, merge restore, idempotence and traversal validation", async () => {
  backup = (await call("/api/backup")).data;
  assert.equal(backup.format, "folio-backup");
  assert.ok(Object.keys(backup.files).length >= 2);
  const beforeFiles = (await fs.readdir(path.join(dir, "data", "files")))
    .length;
  assert.equal((await call("/api/restore", "POST", backup)).data.added, 0);
  assert.equal(
    (await fs.readdir(path.join(dir, "data", "files"))).length,
    beforeFiles,
  );
  const evil = structuredClone(backup);
  evil.files["files/../../bad.txt"] = "eA==";
  assert.equal((await call("/api/restore", "POST", evil)).status, 400);
  const evilTags = structuredClone(backup);
  evilTags.books[0].tags = "{}";
  assert.equal((await call("/api/restore", "POST", evilTags)).status, 400);
  const other = await launch(path.join(dir, "restored"));
  const oldBase = base,
    oldToken = token;
  base = other.url;
  token = (await call("/api/state")).data.token;
  try {
    const r = await call("/api/restore", "POST", backup);
    assert.equal(r.data.added, backup.books.length);
    const restored = (await call("/api/state")).data.books;
    assert.equal(restored.length, backup.books.length);
    assert.deepEqual(restored.find((b) => b.id === copyId).tags, [
      "重要",
      "文学",
    ]);
    assert.match(
      (await call(`/api/books/${copyId}/content?text=1`)).data.text,
      /星河/,
    );
    assert.equal((await call("/api/restore", "POST", backup)).data.added, 0);
  } finally {
    base = oldBase;
    token = oldToken;
    other.p.kill();
    await once(other.p, "exit");
  }
});
test("pasted text selects extension, normalizes filename and indexes custom text formats", async () => {
  for (const extension of ["txt", "js", "cpp", "lua"]) {
    const r = await call("/api/note", "POST", {
      title: "类型测试." + extension,
      extension,
      content: "粘贴选择检索词_" + extension,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.extension, extension);
    assert.equal(r.data.file_name, "类型测试." + extension);
    assert.equal(
      (await call(`/api/books/${r.data.id}/content?text=1`)).data.text,
      "粘贴选择检索词_" + extension,
    );
    assert.equal(
      (
        await call(`/api/books/${r.data.id}/content`, "PUT", {
          content: "修改_" + extension,
        })
      ).status,
      200,
    );
    assert.ok(
      (
        await call("/api/search?q=" + encodeURIComponent("修改_" + extension))
      ).data.ids.includes(r.data.id),
    );
  }
  assert.equal(
    (
      await call("/api/note", "POST", {
        title: "bad",
        extension: "../js",
        content: "bad",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/note", "POST", {
        title: "bad",
        extension: "pdf",
        content: "bad",
      })
    ).status,
    400,
  );
  assert.equal((await call("/api/dialog/state")).data.active, false);
  assert.equal(
    (await call("/api/dialog/focus", "POST", {})).data.active,
    false,
  );
});
test("state survives a complete server restart", async () => {
  child.kill();
  await once(child, "exit");
  const r = await launch(path.join(dir, "data"));
  child = r.p;
  base = r.url;
  token = (await call("/api/state")).data.token;
  const b = (await call("/api/state")).data.books.find((b) => b.id === copyId);
  assert.equal(b.title, "重新命名");
  assert.equal(b.favorite, 1);
  assert.equal(b.color, "#42594d");
});
