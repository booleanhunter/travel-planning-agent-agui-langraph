import { Router, type Request, type Response } from 'express';
import { EventType } from '@ag-ui/core';
import { streamPlannerTurn } from '../agentic-trip-workflow/runtime.js';

const router = Router();

interface RunAgentInputBody {
    threadId: string;
    runId: string;
    state?: Record<string, unknown> & { userId?: string };
    messages?: Array<{ role: string; content: string }>;
}

router.post('/', async (req: Request<unknown, unknown, RunAgentInputBody>, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: object): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const { threadId, runId, state = {}, messages = [] } = req.body;
    const tripId = threadId;
    const userId = (state.userId as string) ?? 'ashwin';
    const userMessage =
        [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';

    console.log(`\n========= [chat] turn — tripId=${tripId} runId=${runId.slice(0, 8)}…`);
    console.log(`[chat] user msg: "${userMessage.slice(0, 100)}"`);
    console.log(
        `[chat] client state: destination=${state.destination ?? '—'} dates=${state.dates ? JSON.stringify(state.dates) : '—'} interests=[${Array.isArray(state.interests) ? (state.interests as string[]).join(',') : ''}] pickedPoiIds=${Array.isArray(state.pickedPoiIds) ? (state.pickedPoiIds as string[]).length : 0}`,
    );

    try {
        await streamPlannerTurn(
            { userId, tripId, userMessage, state },
            {
                onStart: () => send({ type: EventType.RUN_STARTED, threadId, runId }),
                onNodeStart: (nodeName) =>
                    send({ type: EventType.STEP_STARTED, stepName: nodeName }),
                onNodeUpdate: (_nodeName, delta) =>
                    send({ type: EventType.STATE_SNAPSHOT, snapshot: delta }),
                onNodeFinish: (nodeName) =>
                    send({ type: EventType.STEP_FINISHED, stepName: nodeName }),
                onFinish: () => send({ type: EventType.RUN_FINISHED, threadId, runId }),
                onError: (err) =>
                    send({
                        type: EventType.RUN_ERROR,
                        message: err.message ?? 'Unknown error',
                        code: 'GRAPH_ERROR',
                    }),
            },
        );
    } catch {
        // streamPlannerTurn already invoked `onError` before re-throwing —
        // RUN_ERROR has been emitted; nothing more to do here.
    } finally {
        res.end();
    }
});

export default router;
