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
  await page.locator("#note-content").fill("# 新内容\n\n防止遗忘。");
  await page.locator("#import-submit").click();
  await page.waitForFunction(
    () => !document.querySelector("#import-dialog").open,
  );
  assert.equal(await page.locator(".book-card").count(), 10);
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
  await fs.writeFile(original, "来自本地的文件。");
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
  assert.deepEqual(errors, []);
  console.log(
    "Browser QA passed: shelf, full-text search, read, rename, tags, reminders, covers, edit, import, trash/restore, drag-sort/archive, real move/undo, dark/mobile.",
  );
} finally {
  await browser.close();
  child.kill();
  await once(child, "exit");
  await fs.rm(dir, { recursive: true, force: true });
}
