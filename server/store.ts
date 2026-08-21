import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectRoot } from "./env.js";

function sessionsDir(): string {
  return join(projectRoot(), "data", "sessions");
}

export async function writeSession(id: string, data: unknown): Promise<void> {
  const dir = sessionsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), JSON.stringify(data), "utf8");
}

export async function readAllSessions(): Promise<unknown[]> {
  try {
    const dir = sessionsDir();
    const names = await readdir(dir);
    const out: unknown[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, name), "utf8");
        out.push(JSON.parse(raw) as unknown);
      } catch {
        /* skip a corrupt file */
      }
    }
    return out;
  } catch {
    return [];
  }
}
