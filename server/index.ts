import express from "express";
import { authStatus } from "./agent.js";
import { cursorApiKey, serverPort } from "./env.js";
import {
  chooseLarge,
  continueAfterQuestion,
  createAnnotation,
  getSession,
  probeFunction,
  suggestProbeArgs,
  quit,
  cancelWork,
  replyAnnotation,
  resolveAnnotation,
  restoreBranch,
  skipFile,
  stashAndContinue,
  startFiles,
  startSession,
  submitTeachback,
} from "./session.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

function sessionId(req: express.Request): string {
  const id = req.params.id;
  if (typeof id !== "string") throw new Error("Missing session id.");
  return id;
}

app.get("/api/auth", async (_req, res) => {
  const status = await authStatus();
  res.json({
    ...status,
    hasKey: Boolean(cursorApiKey()),
  });
});

app.post("/api/sessions", async (req, res) => {
  try {
    const { repoPath, pr, allowStash } = req.body as {
      repoPath?: string;
      pr?: string;
      allowStash?: boolean;
    };
    if (!repoPath || !pr) {
      res.status(400).json({ error: "repoPath and pr are required." });
      return;
    }
    const session = await startSession({ repoPath, pr, allowStash });
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/sessions/:id", (req, res) => {
  try {
    res.json(getSession(sessionId(req), req.query.lite === "1"));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/stash", async (req, res) => {
  try {
    res.json(await stashAndContinue(sessionId(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/large", async (req, res) => {
  try {
    const choice = (req.body as { choice?: string }).choice;
    if (choice !== "quit" && choice !== "core" && choice !== "all") {
      res.status(400).json({ error: "choice must be quit, core, or all." });
      return;
    }
    res.json(await chooseLarge(sessionId(req), choice));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/start", async (req, res) => {
  try {
    res.json(await startFiles(sessionId(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/teachback", async (req, res) => {
  try {
    const text = (req.body as { text?: string }).text ?? "";
    res.json(await submitTeachback(sessionId(req), text));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/next", async (req, res) => {
  try {
    res.json(await continueAfterQuestion(sessionId(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/skip", async (req, res) => {
  try {
    res.json(await skipFile(sessionId(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/restore", async (req, res) => {
  try {
    res.json(await restoreBranch(sessionId(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/quit", async (req, res) => {
  try {
    res.json(await quit(sessionId(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/cancel", async (req, res) => {
  try {
    res.json(await cancelWork(sessionId(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/annotations", async (req, res) => {
  try {
    const body = req.body as {
      kind?: string;
      path?: string;
      startLine?: number;
      endLine?: number;
      selectedText?: string;
      body?: string;
    };
    if (body.kind !== "question" && body.kind !== "comment") {
      res.status(400).json({ error: "kind must be question or comment." });
      return;
    }
    if (!body.path || !body.body) {
      res.status(400).json({ error: "path and body are required." });
      return;
    }
    res.json(
      await createAnnotation(sessionId(req), {
        kind: body.kind,
        path: body.path,
        startLine: Number(body.startLine) || 1,
        endLine: Number(body.endLine) || Number(body.startLine) || 1,
        selectedText: body.selectedText ?? "",
        body: body.body,
      }),
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/annotations/:annId/reply", async (req, res) => {
  try {
    const text = (req.body as { text?: string }).text ?? "";
    res.json(await replyAnnotation(sessionId(req), req.params.annId as string, text));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/sessions/:id/annotations/:annId/resolve", async (req, res) => {
  try {
    res.json(resolveAnnotation(sessionId(req), req.params.annId as string));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/sessions/:id/probe-args", async (req, res) => {
  const ac = new AbortController();
  const onClose = () => ac.abort();
  req.on("close", onClose);
  try {
    const line = Number(req.query.line) || 1;
    res.json(await suggestProbeArgs(sessionId(req), line, ac.signal));
  } catch (err) {
    if (ac.signal.aborted) return;
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    req.off("close", onClose);
  }
});

app.post("/api/sessions/:id/probe", async (req, res) => {
  try {
    const body = req.body as { line?: number; args?: unknown };
    const args = Array.isArray(body.args) ? body.args : [];
    res.json(
      await probeFunction(sessionId(req), {
        line: Number(body.line) || 1,
        args,
      }),
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(serverPort(), () => {
  console.log(`Walkthrough API on http://127.0.0.1:${serverPort()}`);
});
