import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Questions, SystemOneResult } from "@typesafe-ai/sdk";
import { typesafeApiKey } from "./env.js";

/**
 * Typed judgments for gates that used to burn a Cursor round-trip. Missing key
 * or a failed call returns undefined so callers keep the previous path.
 */
let client: TypeSafeClient | undefined;

export function hasTypesafe(): boolean {
  return Boolean(typesafeApiKey());
}

function getClient(): TypeSafeClient | undefined {
  const key = typesafeApiKey();
  if (!key) return undefined;
  if (!client) {
    client = new TypeSafeClient({
      apiKey: key,
      // Judgments are small; fail fast rather than hold the walk.
      timeout: 15_000,
    });
  }
  return client;
}

export async function systemOne<Q extends Questions>(
  state: unknown,
  questions: Q,
): Promise<SystemOneResult<Q> | undefined> {
  const c = getClient();
  if (!c) return undefined;
  try {
    return await c.systemOne({ state: state as never, questions });
  } catch (err) {
    // Never log the key or full state — state can hold reviewer prose and code.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[typesafe] systemOne failed: ${msg.slice(0, 200)}`);
    return undefined;
  }
}

/** Confidence floor for acting on a Choice without escalating to Cursor. */
export const ACT_CONFIDENCE = 0.55;
