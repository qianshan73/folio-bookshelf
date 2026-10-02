import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(
  new URL("../scripts/file-picker.ps1", import.meta.url),
);
const pickerError = (message) =>
  Object.assign(new Error(message), { status: 400 });
function removePickerDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolved).startsWith("folio-picker-")
  )
    throw Error("Invalid picker temporary directory");
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

/** One managed native picker. Repeated requests focus and join the same result. */
export class NativePicker {
  constructor({
    spawnProcess = spawn,
    platform = process.platform,
    timeoutMs = 30 * 60 * 1000,
  } = {}) {
    this.spawnProcess = spawnProcess;
    this.platform = platform;
    this.timeoutMs = timeoutMs;
    this.session = null;
  }

  get state() {
    return {
      active: !!this.session,
      kind: this.session?.kind || null,
      pid: this.session?.child.pid || null,
    };
  }

  signal(command) {
    const s = this.session;
    if (!s) return false;
    try {
      fs.writeFileSync(
        s.signalPath,
        `${command}:${Date.now()}:${Math.random()}`,
        "utf8",
      );
      return true;
    } catch {
      return false;
    }
  }

  focus() {
    return this.signal("focus");
  }
  cancel() {
    return this.signal("cancel");
  }
  dispose() {
    if (this.session) this.session.child.kill();
  }

  choose(kind = "files") {
    if (this.platform !== "win32")
      return Promise.reject(pickerError("此系统请手动填写绝对路径"));
    if (this.session) {
      this.focus();
      return this.session.result;
    }
    kind = kind === "folder" ? "folder" : "files";
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "folio-picker-"));
    const signalPath = path.join(directory, "signal");
    fs.writeFileSync(signalPath, "focus:initial", "utf8");
    let child;
    try {
      child = this.spawnProcess(
        "powershell.exe",
        [
          "-NoProfile",
          "-STA",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helper,
          "-Kind",
          kind,
          "-SignalPath",
          signalPath,
          "-ParentPid",
          String(process.pid),
        ],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            FOLIO_PICKER_TITLE:
              kind === "folder" ? "拾页 - 选择文件夹" : "拾页 - 选择本地文件",
          },
        },
      );
    } catch (e) {
      removePickerDirectory(directory);
      throw pickerError("选择窗口启动失败，请重新点击选择");
    }
    const session = { child, directory, signalPath, kind, result: null };
    this.session = session;
    session.result = new Promise((resolve, reject) => {
      let output = "",
        finished = false,
        timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);
      const finish = (error, paths = []) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (this.session === session) this.session = null;
        // Only remove the exact directory this picker created, never any imported path.
        removePickerDirectory(directory);
        error ? reject(error) : resolve({ paths, kind });
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", () => {}); // PowerShell diagnostics are not user instructions.
      child.on("error", () =>
        finish(pickerError("选择窗口启动失败，请重新点击选择")),
      );
      child.on("close", (code) => {
        if (timedOut)
          return finish(pickerError("选择窗口等待超时，已关闭，可以重新选择"));
        if (code !== 0)
          return finish(
            pickerError("选择窗口已关闭或未能启动，请重新点击选择"),
          );
        try {
          const parsed = output.trim()
            ? JSON.parse(output.replace(/^\uFEFF/, "").trim())
            : [];
          const paths = typeof parsed === "string" ? [parsed] : parsed;
          if (
            !Array.isArray(paths) ||
            paths.some((p) => typeof p !== "string" || !path.isAbsolute(p))
          )
            throw Error("Invalid picker response");
          finish(null, paths);
        } catch {
          finish(pickerError("选择窗口没有返回有效路径，请重新选择"));
        }
      });
    });
    return session.result;
  }
}
