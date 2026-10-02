import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const fail = (message) => Object.assign(new Error(message), { status: 400 });
const key = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const fingerprint = (s) =>
  [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");
const message = (e) =>
  e.code === "ENOENT"
    ? "原文件或目标文件夹不存在，请重新定位"
    : e.code === "EEXIST"
      ? "目标已有同名文件，未覆盖；请重新预览"
      : ["EPERM", "EACCES"].includes(e.code)
        ? "文件被占用或没有权限，关闭占用程序后重试"
        : e.message;
async function exists(p) {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function regular(p) {
  const s = await fs.lstat(p);
  if (!s.isFile() || s.isSymbolicLink())
    throw fail("请选择普通原文件，符号链接不参与移动");
  return s;
}

// One queue covers single moves, batch moves, undo and relinking across tabs.
export class FileManager {
  constructor(db, getBook, cleanName) {
    this.db = db;
    this.getBook = getBook;
    this.cleanName = cleanName;
    this.queue = Promise.resolve();
    this.plans = new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY,name TEXT NOT NULL,directory TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS move_batches(id TEXT PRIMARY KEY,name TEXT,created INTEGER,moves TEXT);`);
  }
  lock(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  async directory(p) {
    if (typeof p !== "string" || !path.isAbsolute(p))
      throw fail("请选择现有文件夹，或填写完整路径");
    const resolved = await fs.realpath(p);
    if (!(await fs.stat(resolved)).isDirectory()) throw fail("目标应为文件夹");
    return resolved;
  }
  places() {
    return this.db.prepare("SELECT * FROM places ORDER BY rowid DESC").all();
  }
  async savePlace(v) {
    const directory = await this.directory(v.directory);
    const old = this.places().find((p) => key(p.directory) === key(directory));
    const name = String(v.name || path.basename(directory) || "常用文件夹")
      .trim()
      .slice(0, 80);
    if (!name) throw fail("给文件夹起个容易记住的名字");
    if (old) {
      this.db.prepare("UPDATE places SET name=? WHERE id=?").run(name, old.id);
      return { ...old, name };
    }
    if (this.places().length >= 50) throw fail("最多保存 50 个常用文件夹");
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO places VALUES(?,?,?)")
      .run(id, name, directory);
    return { id, name, directory };
  }
  batches() {
    return this.db
      .prepare(
        "SELECT * FROM move_batches ORDER BY created DESC,rowid DESC LIMIT 8",
      )
      .all()
      .map((b) => {
        const moves = JSON.parse(b.moves);
        return {
          id: b.id,
          name: b.name,
          created: b.created,
          total: moves.length,
          remaining: moves.filter((id) =>
            this.db
              .prepare("SELECT id FROM moves WHERE id=? AND undone=0")
              .get(id),
          ).length,
        };
      });
  }
  async plan(v) {
    if (
      !Array.isArray(v.ids) ||
      !v.ids.length ||
      v.ids.length > 200 ||
      v.ids.some((id) => typeof id !== "string")
    )
      throw fail("一次请选择 1–200 份本地原文件");
    const place = v.place_id && this.places().find((p) => p.id === v.place_id);
    if (v.place_id && !place) throw fail("常用文件夹已移除，请重新选择");
    const directory = await this.directory(
      place ? place.directory : v.directory,
    );
    const dirStat = await fs.stat(directory),
      parentStamp = `${dirStat.dev}:${dirStat.ino}`;
    const reserved = new Set(),
      entries = [];
    for (const id of new Set(v.ids)) {
      let b;
      try {
        b = this.getBook(id);
        if (b.kind !== "path" || b.trashed)
          throw fail("仅在柜的本地原文件参与移动，副本和链接不动");
        const st = await regular(b.source),
          source = await fs.realpath(b.source);
        if (key(path.dirname(source)) === key(directory)) {
          entries.push({
            id,
            title: b.title,
            source: b.source,
            status: "skip",
            message: "已经在目标文件夹，无需移动",
          });
          continue;
        }
        const filename = this.cleanName(path.basename(source)),
          parsed = path.parse(filename);
        let destination = path.join(directory, filename),
          n = 2;
        while (reserved.has(key(destination)) || (await exists(destination))) {
          if (n > 10000) throw fail("同名文件太多，请换一个目标文件夹");
          destination = path.join(
            directory,
            `${parsed.name} (${n++})${parsed.ext}`,
          );
        }
        reserved.add(key(destination));
        entries.push({
          id,
          title: b.title,
          source: b.source,
          physical: source,
          destination,
          stamp: fingerprint(st),
          parentStamp,
          status: "ready",
          message: n > 2 ? "同名文件：自动加序号，不覆盖" : "保留原文件名",
        });
      } catch (e) {
        entries.push({
          id,
          title: b?.title || "未知藏品",
          source: b?.source || "",
          status: "error",
          message: message(e),
        });
      }
    }
    for (const [id, p] of this.plans)
      if (p.expires < Date.now()) this.plans.delete(id);
    if (this.plans.size >= 30)
      this.plans.delete(this.plans.keys().next().value);
    const id = randomUUID(),
      expires = Date.now() + 10 * 60 * 1000;
    this.plans.set(id, { directory, entries, expires });
    return {
      id,
      directory,
      expires,
      entries: entries.map(({ stamp, physical, parentStamp, ...e }) => e),
    };
  }
  async transfer(source, destination, stamp) {
    const before = await regular(source);
    if (fingerprint(before) !== stamp)
      throw fail("原文件内容已变化，请重新预览后移动");
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
    try {
      await fs.utimes(destination, before.atime, before.mtime);
      if (fingerprint(await regular(source)) !== stamp)
        throw fail("移动期间原文件发生变化，原文件保留，请重试");
      await fs.unlink(source);
    } catch (e) {
      await fs.unlink(destination).catch(() => {});
      throw e;
    }
  }
  async moveEntry(e) {
    const b = this.getBook(e.id);
    if (b.kind !== "path" || b.trashed || b.source !== e.source)
      throw fail("书柜引用已变化，请重新预览");
    if (key(await fs.realpath(b.source)) !== key(e.physical))
      throw fail("文件位置已变化，请重新预览");
    // Re-resolve parent: a renamed/replaced target must not silently redirect a plan.
    if (
      key(await this.directory(path.dirname(e.destination))) !==
      key(path.dirname(e.destination))
    )
      throw fail("目标文件夹已变化，请重新预览");
    const ds = await fs.stat(path.dirname(e.destination));
    if (e.parentStamp && `${ds.dev}:${ds.ino}` !== e.parentStamp)
      throw fail("目标文件夹已被替换，请重新预览");
    await this.transfer(e.physical, e.destination, e.stamp);
    const id = randomUUID();
    try {
      this.db.exec("BEGIN");
      this.db
        .prepare(
          "UPDATE books SET source=?,file_name=?,extension=?,updated=? WHERE id=?",
        )
        .run(
          e.destination,
          path.basename(e.destination),
          path.extname(e.destination).slice(1).toLowerCase(),
          Date.now(),
          b.id,
        );
      this.db
        .prepare("INSERT INTO moves VALUES(?,?,?,?,?,0)")
        .run(id, b.id, e.physical, e.destination, Date.now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      await fs.copyFile(e.destination, e.physical, constants.COPYFILE_EXCL);
      await fs.unlink(e.destination);
      throw error;
    }
    return { id, book_id: b.id, path: e.destination };
  }
  execute(v) {
    return this.lock(async () => {
      if (v.confirm !== true) throw fail("请先预览并确认移动原文件");
      const plan = this.plans.get(v.plan_id);
      if (!plan || plan.expires < Date.now())
        throw fail("移动预览已过期，请重新预览");
      this.plans.delete(v.plan_id);
      const entries = [],
        moves = [],
        batchId = randomUUID();
      // Persist each success immediately, including if the process stops mid-batch.
      this.db
        .prepare("INSERT INTO move_batches VALUES(?,?,?,?)")
        .run(batchId, plan.directory, Date.now(), "[]");
      for (const e of plan.entries) {
        if (e.status !== "ready") {
          entries.push({ ...e, stamp: undefined, physical: undefined });
          continue;
        }
        try {
          const m = await this.moveEntry(e);
          moves.push(m.id);
          this.db
            .prepare("UPDATE move_batches SET moves=? WHERE id=?")
            .run(JSON.stringify(moves), batchId);
          entries.push({
            id: e.id,
            title: e.title,
            source: e.source,
            destination: e.destination,
            status: "moved",
            message: "已移动，书柜引用已同步",
          });
        } catch (error) {
          entries.push({
            id: e.id,
            title: e.title,
            source: e.source,
            destination: e.destination,
            status: "error",
            message: message(error),
          });
        }
      }
      if (!moves.length)
        this.db.prepare("DELETE FROM move_batches WHERE id=?").run(batchId);
      return {
        batch_id: moves.length ? batchId : null,
        moved: moves.length,
        entries,
      };
    });
  }
  singleMove(id, v) {
    return this.lock(async () => {
      const b = this.getBook(id);
      if (b.kind !== "path" || b.trashed)
        throw fail("仅路径引用可移动原文件，副本可通过下载另存");
      if (v.confirm !== true) throw fail("请先确认移动原文件");
      const directory = await this.directory(v.directory),
        st = await regular(b.source),
        physical = await fs.realpath(b.source);
      const destination = path.join(
        directory,
        this.cleanName(v.filename || path.basename(physical)),
      );
      if (key(physical) === key(destination)) throw fail("文件已经在这个位置");
      const m = await this.moveEntry({
        id,
        source: b.source,
        physical,
        destination,
        stamp: fingerprint(st),
      });
      return { ok: true, moveId: m.id, path: m.path };
    });
  }
  async undoEntry(m) {
    const b = this.getBook(m.book_id),
      latest = this.db
        .prepare(
          "SELECT * FROM moves WHERE book_id=? AND undone=0 ORDER BY created DESC,rowid DESC LIMIT 1",
        )
        .get(b.id);
    if (m.undone || latest?.id !== m.id || b.source !== m.after_path)
      throw fail("之后又移动过此文件；请先撤销较新的移动或重新定位");
    await this.transfer(
      m.after_path,
      m.before_path,
      fingerprint(await regular(m.after_path)),
    );
    try {
      this.db.exec("BEGIN");
      this.db
        .prepare(
          "UPDATE books SET source=?,file_name=?,extension=?,updated=? WHERE id=?",
        )
        .run(
          m.before_path,
          path.basename(m.before_path),
          path.extname(m.before_path).slice(1).toLowerCase(),
          Date.now(),
          b.id,
        );
      this.db.prepare("UPDATE moves SET undone=1 WHERE id=?").run(m.id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      await fs.copyFile(m.before_path, m.after_path, constants.COPYFILE_EXCL);
      await fs.unlink(m.before_path);
      throw e;
    }
  }
  undo(id) {
    return this.lock(async () => {
      const m = this.db
        .prepare(
          "SELECT * FROM moves WHERE book_id=? AND undone=0 ORDER BY created DESC,rowid DESC LIMIT 1",
        )
        .get(id);
      if (!m) throw fail("没有可撤销的移动");
      await this.undoEntry(m);
      return { ok: true };
    });
  }
  undoBatch(id) {
    return this.lock(async () => {
      const batch = this.db
        .prepare("SELECT * FROM move_batches WHERE id=?")
        .get(id);
      if (!batch) throw fail("没有找到这次移动记录");
      let undone = 0;
      const errors = [];
      for (const mid of JSON.parse(batch.moves).reverse()) {
        const m = this.db.prepare("SELECT * FROM moves WHERE id=?").get(mid);
        if (!m || m.undone) continue;
        try {
          await this.undoEntry(m);
          undone++;
        } catch (e) {
          errors.push({
            id: m.book_id,
            title: this.getBook(m.book_id).title,
            message: message(e),
          });
        }
      }
      return { undone, errors };
    });
  }
}
