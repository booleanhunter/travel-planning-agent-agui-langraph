import { Router, type Request, type Response } from "express";
import { EventType } from "@ag-ui/core";
import { graph, APP_NODES } from "../agent/graph.js";

const router = Router();

interface RunAgentInputBody {
  threadId: string;
  runId: string;
  state?: Record<string, unknown> & { userId?: string };
  messages?: Array<{ role: string; content: string }>;
}

router.post("/", async (req: Request<unknown, unknown, RunAgentInputBody>, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: object): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const { threadId, runId, state = {}, messages = [] } = req.body;
  const sessionId = threadId;
  const userId = (state.userId as string) ?? "ashwin";
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userMessage = lastUser?.content ?? "";

  const appNodeSet = new Set<string>(APP_NODES);

  try {
    send({ type: EventType.RUN_STARTED, threadId, runId });

    const stream = await graph.stream(
      { userId, sessionId, userMessage, ...state },
      { streamMode: "updates" },
    );

    for await (const chunk of stream) {
      // chunk has shape { [nodeName]: stateDelta }
      for (const [nodeName, delta] of Object.entries(chunk as Record<string, unknown>)) {
        if (!appNodeSet.has(nodeName)) continue;
        send({ type: EventType.STEP_STARTED, stepName: nodeName });
        if (delta && typeof delta === "object") {
          send({ type: EventType.STATE_SNAPSHOT, snapshot: delta });
        }
        send({ type: EventType.STEP_FINISHED, stepName: nodeName });
      }
    }

    send({ type: EventType.RUN_FINISHED, threadId, runId });
  } catch (err) {
    send({
      type: EventType.RUN_ERROR,
      message: (err as Error).message ?? "Unknown error",
      code: "GRAPH_ERROR",
    });
  } finally {
    res.end();
  }
});

export default router;
