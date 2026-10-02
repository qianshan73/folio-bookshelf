import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-ui-"));
const child = spawn(process.execPath, ["server.mjs"], {
  env: {
    ...process.env,
    PORT: "0",
    FOLIO_DATA_DIR: path.join(dir, "data"),
    FOLIO_OPEN: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const base = await new Promise((resolve, reject) => {
  child.stdout.on("data", (c) => {
    const m = String(c).match(/http:\/\/127\.0\.0\.1:\d+/);
    if (m) resolve(m[0]);
  });
  child.on("exit", () => reject(Error("Server exited")));
});
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await fs.mkdir("docs/screenshots", { recursive: true });
try {
  await page.goto(base);
  await page.waitForSelector(".book-card");
  await page.waitForTimeout(800);
  assert.equal(await page.locator(".book-card").count(), 7);
  await page.screenshot({
    path: "docs/screenshots/bookshelf.png",
    fullPage: true,
  });
  await page.locator("#search").fill("二分查找");
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".book-card").count(), 1);
  await page.locator("#search").fill("");
  await page.waitForTimeout(250);
  await page.locator(".book-open").filter({ hasText: "从这里开始" }).click();
  await page.waitForSelector(".reader h1");
  await page.screenshot({
    path: "docs/screenshots/reader.png",
    fullPage: true,
  });
  await page.locator('[data-detail-tab="info"]').click();
  await page.locator("#book-title").fill("用户的第一本书");
  await page.locator("#book-tags").fill("重要，复习");
  await page.locator("#book-review").fill("2026-10-02");
  await page.getByRole("button", { name: "保存档案", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator(".detail-title").textContent(),
    "用户的第一本书",
  );
  await page.locator('[data-detail-tab="cover"]').click();
  await page.locator('[data-color="#4b6374"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-pattern="grid"]').click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator("#cover-preview .pattern-grid").count());
  await page.locator('[data-detail-tab="read"]').click();
  await page.waitForSelector(".reader");
  await page.getByRole("button", { name: "编辑副本", exact: true }).click();
  await page.locator("#content-editor").fill("# 测试笔记\n\n前端保存的内容。");
  await page.getByRole("button", { name: "保存内容", exact: true }).click();
  await page.waitForSelector(".reader h1");
  assert.equal(await page.locator(".reader h1").textContent(), "测试笔记");
  await page.locator('#detail-dialog [data-action="close-modal"]').click();
  // Exercise actual browser file upload, link bookmarking and backup download/restore.
  await page
    .getByRole("button", { name: "收进书柜", exact: true })
    .first()
    .click();
  await page.locator('[data-import-tab="upload"]').click();
  await page.locator("#upload-files").setInputFiles({
    name: "browser-upload.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 浏览器上传\n\n独有检索词：云杉林"),
  });
  await page.locator("#import-submit").click();
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  await page.locator("#search").fill("云杉林");
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".book-card").count(), 1);
  await page.locator("#search").fill("");
  await page.waitForTimeout(250);
  await page
    .getByRole("button", { name: "收进书柜", exact: true })
    .first()
    .click();
  await page.locator('[data-import-tab="link"]').click();
  await page.locator("#link-url").fill("https://example.org/article");
  await page.locator("#link-title").fill("浏览器网络收藏");
  await page.locator("#import-submit").click();
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  await page
    .locator(".book-open")
    .filter({ hasText: "浏览器网络收藏" })
    .click();
  assert.equal(
    await page.locator(".link-preview a").getAttribute("href"),
    "https://example.org/article",
  );
  await page.locator('#detail-dialog [data-action="close-modal"]').click();
  await page.locator('[data-action="settings"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-action="backup"]').click();
  const download = await downloadPromise,
    backupFile = path.join(dir, "browser-backup.folio");
  await download.saveAs(backupFile);
  assert.equal(
    JSON.parse(await fs.readFile(backupFile, "utf8")).format,
    "folio-backup",
  );
  await page.locator("#restore-file").setInputFiles(backupFile);
  await page.locator("#confirm-ok").click();
  await page.waitForTimeout(400);
  await page.locator('#settings-dialog [data-action="close-modal"]').click();
  await page.keyboard.press("Control+k");
  assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  await page.locator("#search").blur();
  await page
    .getByRole("button", { name: "收进书柜", exact: true })
    .first()
    .click();
  await page.locator('[data-import-tab="note"]').click();
  await page.locator("#note-title").fill("前端新笔记");
  await page.locator("#note-format").selectOption("js");
  await page.locator("#note-content").fill("# 新内容\n\n防止遗忘。");
  await page.locator("#import-submit").click();
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  assert.equal(await page.locator(".book-card").count(), 10);
  assert.equal(
    await page
      .locator(".book-card")
      .filter({ hasText: "前端新笔记" })
      .locator(".file-badge")
      .textContent(),
    "js",
  );
  await page.locator('[data-action="list-view"]').click();
  assert.ok(await page.locator("#books.list-view").count());
  await page.locator('[data-action="shelf-view"]').click();
  await page.locator(".book-open").filter({ hasText: "前端新笔记" }).click();
  await page.locator('[data-detail-tab="info"]').click();
  await page.locator('[data-action="trash-book"]').click();
  await page.locator("#confirm-ok").click();
  await page.waitForFunction(
    () => !document.querySelector("#detail-dialog").open,
  );
  await page.locator('[data-view="trash"]').click();
  await page.locator(".book-open").filter({ hasText: "前端新笔记" }).click();
  await page.locator('[data-detail-tab="info"]').click();
  await page.locator('[data-action="restore-book"]').click();
  await page.waitForFunction(
    () => !document.querySelector("#detail-dialog").open,
  );
  await page.locator('[data-view="all"]').click();
  // Browser drag & drop exercises both shelf reorder and collection assignment.
  const cards = page.locator(".book-card");
  await cards.nth(0).dragTo(cards.nth(3));
  await page.waitForTimeout(300);
  await cards.nth(0).dragTo(page.locator('[data-collection="reading"]'));
  await page.waitForTimeout(300);
  const original = path.join(dir, "original.txt"),
    target = path.join(dir, "moved");
  await fs.mkdir(target);
  await fs.writeFile(
    original,
    Array.from(
      { length: 160 },
      (_, i) => `第 ${i + 1} 段：来自本地的文件，阅读时自动记住位置。\n`,
    ).join("\n"),
  );
  await page
    .getByRole("button", { name: "收进书柜", exact: true })
    .first()
    .click();
  await page.locator('[data-import-tab="path"]').click();
  await page.locator("#import-paths").fill(original);
  await page.locator("#import-submit").click();
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  await page.locator(".book-open").filter({ hasText: "original" }).click();
  await page.locator('[data-detail-tab="location"]').click();
  await page.locator("#move-directory").fill(target);
  await page.getByRole("button", { name: "移动原文件", exact: true }).click();
  await page.locator("#confirm-ok").click();
  await page.waitForTimeout(400);
  await fs.access(path.join(target, "original.txt"));
  await assert.rejects(fs.access(original));
  await page.getByRole("button", { name: "撤销上次移动", exact: true }).click();
  await page.locator("#confirm-ok").click();
  await page.waitForTimeout(400);
  await fs.access(original);
  await page.locator('#detail-dialog [data-action="close-modal"]').click();
  // A normal link opens a dedicated tab with per-book progress and preferences.
  const readerPopup = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "独立阅读 original", exact: true })
    .click();
  const readingPage = await readerPopup;
  readingPage.on("pageerror", (e) => errors.push(e.message));
  await readingPage.waitForSelector("#reading-content .code-reader");
  assert.equal(
    await readingPage.locator("#reading-title").textContent(),
    "original",
  );
  await readingPage.locator("#reading-size").fill("24");
  await readingPage.locator("#reading-width").selectOption("860");
  await readingPage.evaluate(() =>
    scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.48),
  );
  await readingPage.waitForTimeout(400);
  assert.match(
    await readingPage.locator("#reading-progress").textContent(),
    /4[7-9]%/,
  );
  await readingPage.reload();
  await readingPage.waitForSelector("#reading-content .code-reader");
  await readingPage.waitForTimeout(350);
  assert.ok(await readingPage.evaluate(() => scrollY > 500));
  assert.equal(await readingPage.locator("#reading-size").inputValue(), "24");
  await readingPage.locator("#reading-top").click();
  await readingPage.screenshot({
    path: "docs/screenshots/standalone-reader.png",
  });
  // Save a friendly destination, select multiple references, preview real paths,
  // keep an existing namesake intact, then undo the whole batch.
  const secondDir = path.join(dir, "second-source"),
    bulkTarget = path.join(dir, "reading-home");
  await fs.mkdir(secondDir);
  await fs.mkdir(bulkTarget);
  const secondOriginal = path.join(secondDir, "original.txt");
  await fs.writeFile(secondOriginal, "另一份同名原文件");
  await fs.writeFile(
    path.join(bulkTarget, "original.txt"),
    "existing occupant",
  );
  await page
    .getByRole("button", { name: "收进书柜", exact: true })
    .first()
    .click();
  await page.locator('[data-import-tab="path"]').click();
  await page.locator("#import-paths").fill(secondOriginal);
  await page.locator("#import-submit").click();
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  await page.locator('[data-action="manage-files"]').first().click();
  await page.locator('[data-action="places"]').click();
  await page.locator("#place-name").fill("我的阅读角");
  await page.locator("#place-directory").fill(bulkTarget);
  await page
    .getByRole("button", { name: "记住这个文件夹", exact: true })
    .click();
  await page.waitForSelector(".place-item");
  await page.locator('#places-dialog [data-action="close-modal"]').click();
  await page.locator('[data-view="local"]').click();
  await page.locator('[data-action="select-local"]').click();
  assert.match(await page.locator("#selected-count").textContent(), /2/);
  await page.locator('[data-action="organize-selected"]').click();
  assert.equal(await page.locator("#batch-directory").inputValue(), bulkTarget);
  assert.equal(await page.locator("#execute-move").isDisabled(), true);
  await page.locator('[data-action="preview-move"]').click();
  await page.waitForSelector(".move-row.status-ready");
  assert.equal(await page.locator(".move-row.status-ready").count(), 2);
  await fs.access(original);
  await fs.access(secondOriginal);
  await page.screenshot({
    path: "docs/screenshots/file-organizer.png",
    fullPage: true,
  });
  await page.locator("#execute-move").click();
  await page.waitForSelector(".move-row.status-moved");
  assert.equal(await page.locator(".move-row.status-moved").count(), 2);
  assert.equal(
    await fs.readFile(path.join(bulkTarget, "original.txt"), "utf8"),
    "existing occupant",
  );
  await assert.rejects(fs.access(original));
  await assert.rejects(fs.access(secondOriginal));
  await readingPage.reload();
  await readingPage.waitForSelector("#reading-content .code-reader");
  assert.match(
    await readingPage.locator("#reading-content").textContent(),
    /第 160 段/,
  );
  await page.locator('#move-dialog [data-action="undo-batch"]').click();
  await page.locator("#confirm-ok").click();
  await page.waitForFunction(() =>
    document.querySelector("#move-status").textContent.includes("已撤销 2"),
  );
  await fs.access(original);
  await fs.access(secondOriginal);
  await page.locator('#move-dialog [data-action="close-modal"]').click();
  await page.reload();
  await page.waitForSelector(".book-card");
  await page.locator('[data-action="manage-files"]').first().click();
  await page.locator('[data-action="organize-selected"]').click();
  assert.ok(
    await page
      .locator("#toasts")
      .textContent()
      .then((s) => s.includes("先勾选")),
  );
  await page.locator('[data-action="manage-files"]').last().click();
  await readingPage.close();
  // Standalone Markdown gets a real chapter list and the same sanitizer as the
  // modal reader; mobile reading must stay within the viewport.
  const chapterId = await page.evaluate(async () => {
    const { token } = await (await fetch("/api/state")).json();
    const r = await fetch("/api/note", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Folio-Token": token },
      body: JSON.stringify({
        title: "章节阅读测试",
        extension: "md",
        content:
          '# 第一章\n\n这是正文。\n\n## 第二章\n\n<img src="x" onerror="window.bad=1"><script>window.bad=1</script>\n\n[错误链接](javascript:alert(1))',
      }),
    });
    return (await r.json()).id;
  });
  const chapterPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  chapterPage.on("pageerror", (e) => errors.push(e.message));
  await chapterPage.goto(base + "/reader.html?book=" + chapterId);
  await chapterPage.waitForSelector("#reading-content h1");
  await chapterPage.locator("#reading-outline summary").click();
  assert.equal(await chapterPage.locator("#reading-toc a").count(), 2);
  assert.equal(await chapterPage.locator("#reading-content script").count(), 0);
  assert.equal(
    await chapterPage
      .locator('#reading-content a[href^="javascript:"]')
      .count(),
    0,
  );
  assert.ok(
    await chapterPage.evaluate(
      () => !window.bad && document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await chapterPage.locator("#reading-toc a").last().click();
  assert.match(chapterPage.url(), /#chapter-1$/);
  await chapterPage.close();
  await page.locator('[data-action="refresh"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-action="theme"]').first().click();
  await page.evaluate(() =>
    document.querySelector("#toasts").replaceChildren(),
  );
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/dark.png", fullPage: true });
  await page.locator('[data-action="theme"]').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "docs/screenshots/mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator('[data-action="settings"]').click();
  await page.screenshot({
    path: "docs/screenshots/mobile-settings.png",
    fullPage: true,
  });
  await page.locator('#settings-dialog [data-action="close-modal"]').click();
  // Keep a pending native request open via a mock: background clicks must focus
  // it, not switch import tabs. Cancel and retry must leave the form usable.
  await page.setViewportSize({ width: 1440, height: 1080 });
  let finishPicker,
    opens = 0,
    focuses = 0;
  await page.route("**/api/dialog", async (route) => {
    opens++;
    await new Promise((resolve) => (finishPicker = () => resolve()));
    await route.fulfill({ json: { paths: [], kind: "files" } });
  });
  await page.route("**/api/dialog/focus", async (route) => {
    focuses++;
    await route.fulfill({ json: { active: true } });
  });
  await page.route("**/api/dialog/cancel", async (route) => {
    finishPicker?.();
    await route.fulfill({ json: { active: true } });
  });
  await page
    .getByRole("button", { name: "收进书柜", exact: true })
    .first()
    .click();
  await page.locator('[data-import-tab="path"]').click();
  await page.locator('[data-action="browse-import"]').click();
  await page.waitForSelector(".native-picker-hint");
  await page.locator('[data-import-tab="link"]').click();
  await page.waitForTimeout(300);
  assert.ok(focuses > 0);
  assert.equal(opens, 1);
  assert.equal(
    await page.locator('[data-import-tab="path"]').getAttribute("class"),
    "active",
  );
  await page.locator('[data-action="cancel-picker"]').click();
  await page.waitForFunction(
    () => !document.querySelector(".native-picker-hint"),
  );
  await page.locator('[data-action="browse-import"]').click();
  await page.waitForSelector(".native-picker-hint");
  assert.equal(opens, 2);
  await page.locator('[data-action="cancel-picker"]').click();
  await page.waitForFunction(
    () => !document.querySelector(".native-picker-hint"),
  );
  await page.locator('[data-import-tab="note"]').click();
  await page.locator("#note-format").selectOption("custom");
  await page.locator("#note-custom-extension").fill("lua");
  await page.locator("#note-title").fill("自定义格式");
  await page.locator("#note-content").fill('print("自定义文本格式")');
  await page.locator("#import-submit").click();
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  await page.locator(".book-open").filter({ hasText: "自定义格式" }).click();
  await page.waitForSelector(".code-reader");
  assert.match(
    await page.locator(".code-reader").textContent(),
    /自定义文本格式/,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser QA passed: shelf, search, metadata, covers, editing, imports, native picker lifecycle, trash/restore, drag, real move/undo, standalone tabs/progress/chapters/sanitization/mobile, saved folders and batch move/undo.",
  );
} finally {
  await browser.close();
  child.kill();
  await once(child, "exit");
  await fs.rm(dir, { recursive: true, force: true });
}
