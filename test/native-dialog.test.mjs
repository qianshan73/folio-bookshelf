import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NativePicker } from "../lib/native-dialog.mjs";

function fixture(timeoutMs = 10000) {
  const children = [];
  const picker = new NativePicker({
    platform: "win32",
    timeoutMs,
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.pid = 123;
      child.kill = () => {
        setImmediate(() => child.emit("close", 1));
        return true;
      };
      children.push(child);
      return child;
    },
  });
  return { picker, children };
}
test("concurrent picker requests join one process and focus the existing window", async () => {
  const { picker, children } = fixture();
  const first = picker.choose("files"),
    signal = picker.session.signalPath;
  const second = picker.choose("files");
  assert.equal(first, second);
  assert.equal(children.length, 1);
  assert.match(fs.readFileSync(signal, "utf8"), /^focus:/);
  assert.ok(picker.state.active);
  const selected = path.join(os.tmpdir(), "中文选择.txt");
  children[0].stdout.end(JSON.stringify([selected]));
  children[0].emit("close", 0);
  assert.deepEqual((await first).paths, [selected]);
  assert.equal(picker.state.active, false);
  assert.equal(fs.existsSync(path.dirname(signal)), false);
});
test("cancelled picker releases lock and opens again without a stale busy error", async () => {
  const { picker, children } = fixture();
  const first = picker.choose();
  assert.equal(picker.cancel(), true);
  assert.match(fs.readFileSync(picker.session.signalPath, "utf8"), /^cancel:/);
  children[0].stdout.end("[]");
  children[0].emit("close", 0);
  assert.deepEqual(await first, { paths: [], kind: "files" });
  const next = picker.choose("folder");
  assert.equal(children.length, 2);
  children[1].stdout.end("[]");
  children[1].emit("close", 0);
  await next;
  assert.equal(picker.focus(), false);
});
test("process failure and timeout release the picker lock", async () => {
  const { picker, children } = fixture(30);
  const first = picker.choose();
  children[0].emit("error", Error("spawn failed"));
  await assert.rejects(first, /启动失败/);
  assert.equal(picker.state.active, false);
  await assert.rejects(picker.choose(), /超时/);
  assert.equal(picker.state.active, false);
});
test("single path output is normalized, malformed output never leaves a stuck session", async () => {
  const { picker, children } = fixture();
  const p = path.join(os.tmpdir(), "one.txt"),
    first = picker.choose();
  children[0].stdout.end(JSON.stringify(p));
  children[0].emit("close", 0);
  assert.deepEqual((await first).paths, [p]);
  const second = picker.choose();
  children[1].stdout.end("{}");
  children[1].emit("close", 0);
  await assert.rejects(second, /有效路径/);
  assert.equal(picker.state.active, false);
});

const exec = promisify(execFile);
async function inspect(pid, action = "inspect") {
  const { stdout } = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.resolve("test/picker-window.ps1"),
      "-TargetPid",
      String(pid),
      "-Action",
      action,
    ],
    { windowsHide: true, timeout: 10000 },
  );
  return JSON.parse(stdout);
}
async function waitVisible(picker) {
  for (let i = 0; i < 10; i++) {
    if (!picker.state.active)
      throw Error("Native helper exited before its window opened");
    const s = await inspect(picker.state.pid);
    if (s.visible && s.topmost && s.foreground) return s;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Native file dialog did not open");
}
for (const kind of ["files", "folder"])
  test(
    `real Windows ${kind} picker opens, focuses, cancels and reopens`,
    {
      skip: process.platform !== "win32" || process.env.FOLIO_GUI_TESTS !== "1",
      timeout: 60000,
    },
    async () => {
      const picker = new NativePicker({ timeoutMs: 45000 });
      try {
        const result = picker.choose(kind);
        result.catch(() => {});
        const initial = await waitVisible(picker);
        assert.ok(initial.topmost);
        assert.ok(initial.foreground);
        const second = picker.choose(kind);
        assert.equal(result, second);
        await new Promise((r) => setTimeout(r, 2000));
        const lowered = await inspect(picker.state.pid, "lower");
        assert.equal(lowered.topmost, false);
        picker.focus();
        await new Promise((r) => setTimeout(r, 300));
        const raised = await inspect(picker.state.pid);
        assert.ok(raised.topmost);
        assert.ok(raised.foreground);
        picker.cancel();
        assert.deepEqual((await result).paths, []);
        assert.equal(picker.state.active, false);
        const reopened = picker.choose(kind);
        reopened.catch(() => {});
        assert.ok((await waitVisible(picker)).visible);
        picker.cancel();
        await reopened;
        assert.equal(picker.state.active, false);
      } finally {
        picker.dispose();
      }
    },
  );
