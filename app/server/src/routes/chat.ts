import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { graph, APP_NODES } from "../agent/graph.js";

const router = Router();

interface ChatTurnRequest {
  userId: string;
  sessionId: string;
  userMessage: string;
  /** Accumulated client-side state from previous turns (filled slots, picked POIs, etc.) */
  state?: Record<string, unknown>;
}

router.post("/", async (req: Request<unknown, unknown, ChatTurnRequest>, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: object): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const { userId, sessionId, userMessage, state = {} } = req.body;
  const threadId = sessionId;
  const runId = randomUUID();
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
