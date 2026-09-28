/**
 * One long-lived `git cat-file --batch` per repo.
 * Pattern from Whiteboard's BlobBatchReader (/dev/fast, MIT) —
 * see docs/whiteboard-credit.md. Avoids N process starts when wiring/chase
 * hydrate many paths. Idle-retires after 30s; respawns on next read.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

const IDLE_MS = 30_000;
const MAX_BLOB = 10 * 1024 * 1024;
const KILL_MS = 2_000;
const NL = 0x0a;
const HEADER = /^[0-9a-f]+ ([a-z]+) (\d+)$/;

export type BlobAnswer =
  | { found: "blob"; text: string }
  | { found: "other" | "nothing" };

interface Pending {
  resolve: (v: BlobAnswer) => void;
  reject: (e: Error) => void;
}

interface Session {
  child: ChildProcessByStdio<Writable, Readable, null>;
  pending: Pending[];
  buffered: Buffer;
  expected: number | null;
  chunks: Buffer[] | null;
  writes: Promise<void>;
  exit: Promise<void>;
  skipKind?: "other" | "nothing";
}

const readers = new Map<string, BlobBatchReader>();

/** Shared reader for a checkout root. */
export function blobReaderFor(repoPath: string): BlobBatchReader {
  let r = readers.get(repoPath);
  if (!r) {
    r = new BlobBatchReader(repoPath);
    readers.set(repoPath, r);
  }
  return r;
}

export class BlobBatchReader {
  private session: Session | null = null;
  private starting: Promise<Session | null> | null = null;
  private idle: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly repoPath: string) {}

  /** Read `commit:path` (default HEAD). Returns null when missing / oversized. */
  async read(path: string, commit = "HEAD"): Promise<string | null> {
    const ans = await this.readObject(commit, path);
    return ans.found === "blob" ? ans.text : null;
  }

  async readObject(commit: string, relativePath: string): Promise<BlobAnswer> {
    const request = `${commit}:${relativePath}`;
    if (this.closed || request.includes("\n")) {
      return { found: "nothing" };
    }
    const session = await this.start();
    if (!session) return { found: "nothing" };

    const answer = new Promise<BlobAnswer>((resolve, reject) => {
      session.pending.push({ resolve, reject });
      session.writes = session.writes.then(() =>
        this.write(session, `${request}\n`),
      );
    });
    this.armIdle(session);
    return answer;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearIdle();
    await this.starting?.catch(() => null);
    const session = this.session;
    if (!session) return;
    await session.writes.catch(() => null);
    this.retire(session);
    await Promise.race([
      session.exit,
      new Promise<void>((r) => setTimeout(r, KILL_MS)),
    ]);
    if (readers.get(this.repoPath) === this) readers.delete(this.repoPath);
  }

  private start(): Promise<Session | null> {
    if (this.session) return Promise.resolve(this.session);
    this.starting ??= this.spawn().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async spawn(): Promise<Session | null> {
    const child = spawn("git", ["-C", this.repoPath, "cat-file", "--batch"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    const session: Session = {
      child,
      pending: [],
      buffered: Buffer.alloc(0),
      expected: null,
      chunks: null,
      writes: Promise.resolve(),
      exit: new Promise((resolve) => {
        child.once("close", () => resolve());
      }),
    };
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk: Buffer) => this.consume(session, chunk));
    child.once("error", () =>
      this.fail(session, "git cat-file --batch could not start"),
    );
    child.once("exit", () => {
      if (this.session === session) this.session = null;
      this.fail(session, "git cat-file --batch stopped");
    });
    this.session = session;
    this.armIdle(session);
    return session;
  }

  private consume(session: Session, chunk: Buffer): void {
    session.buffered =
      session.buffered.length > 0
        ? Buffer.concat([session.buffered, chunk])
        : chunk;

    for (;;) {
      if (session.expected === null) {
        const end = session.buffered.indexOf(NL);
        if (end < 0) break;
        const header = session.buffered.subarray(0, end).toString("utf8");
        session.buffered = session.buffered.subarray(end + 1);
        if (header.endsWith(" missing")) {
          this.settle(session, { found: "nothing" });
          continue;
        }
        const m = HEADER.exec(header);
        if (!m) {
          this.fail(session, `bad cat-file header: ${header.slice(0, 80)}`);
          return;
        }
        const size = Number(m[2]);
        if (m[1] !== "blob" || size > MAX_BLOB) {
          session.expected = size + 1;
          session.chunks = [];
          session.skipKind = m[1] !== "blob" ? "other" : "nothing";
          continue;
        }
        session.expected = size + 1;
        session.chunks = [];
        continue;
      }

      if (session.buffered.length < session.expected) break;
      const body = session.buffered.subarray(0, session.expected - 1);
      session.buffered = session.buffered.subarray(session.expected);
      session.expected = null;
      if (session.skipKind) {
        const kind = session.skipKind;
        session.skipKind = undefined;
        session.chunks = null;
        this.settle(session, { found: kind });
        continue;
      }
      session.chunks = null;
      this.settle(session, {
        found: "blob",
        text: body.toString("utf8"),
      });
    }
  }

  private settle(session: Session, answer: BlobAnswer): void {
    const next = session.pending.shift();
    next?.resolve(answer);
  }

  private fail(session: Session, message: string): void {
    const err = new Error(message);
    while (session.pending.length) {
      session.pending.shift()?.reject(err);
    }
    if (this.session === session) this.session = null;
  }

  private write(session: Session, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      session.child.stdin.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  private armIdle(session: Session): void {
    this.clearIdle();
    this.idle = setTimeout(() => {
      if (this.session === session && session.pending.length === 0) {
        this.retire(session);
      }
    }, IDLE_MS);
    this.idle.unref?.();
  }

  private clearIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  private retire(session: Session): void {
    this.clearIdle();
    if (this.session === session) this.session = null;
    try {
      session.child.stdin.end();
    } catch {
      /* ignore */
    }
    session.child.kill("SIGTERM");
  }
}

/**
 * True when `needle` appears as a line (or substring) in the blob — Whiteboard's
 * hydrate check that a grep hit still matches pinned content.
 */
export function blobContainsHit(blob: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  if (blob.includes(n)) return true;
  // Import lines often differ only by whitespace / semicolon.
  const compact = (s: string) => s.replace(/\s+/g, " ").trim();
  const want = compact(n);
  return blob.split("\n").some((line) => compact(line).includes(want));
}
