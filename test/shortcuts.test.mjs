import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = process.env.FOLIO_TEST_ROOT
  ? path.resolve(process.env.FOLIO_TEST_ROOT)
  : path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === "win32";
const directories = [];
const quote = (v) => "'" + String(v).replace(/'/g, "''") + "'";
async function ps(script) {
  const { stdout } = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(
        "[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); " +
          script,
        "utf16le",
      ).toString("base64"),
    ],
    { windowsHide: true, timeout: 20000 },
  );
  return JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
}
async function invoke(destination, desktop, programs, action = "Create") {
  return ps(
    `& ${quote(path.join(root, "scripts", "shortcuts.ps1"))} -Destination ${destination} -Action ${action} -DesktopDirectory ${quote(desktop)} -StartMenuDirectory ${quote(programs)}`,
  );
}
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "folio-shortcuts-"));
  directories.push(dir);
  return {
    dir,
    desktop: path.join(dir, "桌面"),
    programs: path.join(dir, "开始菜单"),
  };
}
after(async () => {
  for (const dir of directories) {
    // Only the exact temporary test directories created above are removable.
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("folio-shortcuts-"));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("generated icon is a valid seven-size ICO and optional entry is shipped", async () => {
  const b = await fs.readFile(path.join(root, "public", "icons", "folio.ico"));
  assert.equal(b.readUInt16LE(0), 0);
  assert.equal(b.readUInt16LE(2), 1);
  assert.equal(b.readUInt16LE(4), 7);
  let lastEnd = 6 + 16 * 7;
  [16, 24, 32, 48, 64, 128, 256].forEach((size, i) => {
    const offset = 6 + i * 16,
      length = b.readUInt32LE(offset + 8),
      start = b.readUInt32LE(offset + 12);
    assert.equal(b[offset] || 256, size);
    assert.equal(b[offset + 1] || 256, size);
    assert.equal(b.readUInt16LE(offset + 6), 32);
    assert.equal(start, lastEnd);
    assert.deepEqual(
      [...b.subarray(start, start + 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(b.readUInt32BE(start + 16), size);
    assert.equal(b.readUInt32BE(start + 20), size);
    assert.ok(start + length <= b.length);
    lastEnd = start + length;
  });
  assert.equal(lastEnd, b.length);
  assert.ok(
    (await fs.stat(path.join(root, "public", "icons", "folio.png"))).size >
      1000,
  );
  const cmd = await fs.readFile(path.join(root, "创建快捷方式.cmd"), "utf8");
  assert.match(cmd, /scripts\\shortcuts\.ps1/);
  const normal = await fs.readFile(path.join(root, "launch.ps1"), "utf8");
  assert.doesNotMatch(normal, /shortcuts\.ps1|CreateShortcut/);
});

test(
  "choosing no shortcuts changes nothing; desktop and menu creation are independent and repeatable",
  { skip: !windows },
  async () => {
    const { desktop, programs } = await fixture();
    const none = await invoke("None", desktop, programs);
    assert.deepEqual(none.created, []);
    await assert.rejects(fs.access(desktop));
    await assert.rejects(fs.access(programs));
    const first = await invoke("Desktop", desktop, programs);
    assert.equal(first.created.length, 1);
    await assert.rejects(fs.access(programs));
    const second = await invoke("Desktop", desktop, programs);
    assert.deepEqual(second.created, first.created);
    assert.equal((await fs.readdir(desktop)).length, 1);
    const meta = await ps(
      `. ${quote(path.join(root, "scripts", "shortcut-link.ps1"))}; $l=[Folio.ShortcutFile]::Read(${quote(first.created[0])}); @{target=$l.Target;work=$l.WorkingDirectory;icon=$l.Icon;style=$l.WindowStyle} | ConvertTo-Json -Compress`,
    );
    assert.equal(
      meta.target.toLowerCase(),
      path.join(root, "start.cmd").toLowerCase(),
    );
    assert.equal(meta.work.toLowerCase(), root.toLowerCase());
    assert.equal(
      meta.icon.toLowerCase(),
      (path.join(root, "public", "icons", "folio.ico") + ",0").toLowerCase(),
    );
    assert.equal(meta.style, 7);
    const both = await invoke("Both", desktop, programs);
    assert.equal(both.created.length, 2);
    const removal = await invoke("Both", desktop, programs, "Remove");
    assert.equal(removal.removed.length, 2);
    assert.deepEqual(await fs.readdir(desktop), []);
    assert.deepEqual(await fs.readdir(programs), []);
    await fs.access(path.join(root, "start.cmd"));
  },
);

test(
  "foreign shortcuts survive same-name creation and removal",
  { skip: !windows },
  async () => {
    const { desktop, programs } = await fixture();
    await fs.mkdir(desktop);
    const foreign = path.join(desktop, "拾页书柜.lnk");
    await ps(
      `. ${quote(path.join(root, "scripts", "shortcut-link.ps1"))}; [Folio.ShortcutFile]::Create(${quote(foreign)},(Join-Path $env:SystemRoot 'System32\\cmd.exe'),$env:SystemRoot,(Join-Path $env:SystemRoot 'System32\\shell32.dll'),4,'foreign fixture',1); @{ok=$true}|ConvertTo-Json -Compress`,
    );
    const before = await fs.readFile(foreign);
    const r = await invoke("Desktop", desktop, programs);
    assert.equal(path.basename(r.created[0]), "拾页书柜 (2).lnk");
    assert.deepEqual(await fs.readFile(foreign), before);
    assert.deepEqual(
      (await invoke("Desktop", desktop, programs)).created,
      r.created,
    );
    const removed = await invoke("Desktop", desktop, programs, "Remove");
    assert.equal(removed.removed.length, 1);
    assert.deepEqual(await fs.readFile(foreign), before);
    assert.deepEqual(await fs.readdir(desktop), ["拾页书柜.lnk"]);
  },
);
