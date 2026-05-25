/**
 * Streamable HTTP transport for the MCP server. Mounts as an Express Router
 * at `/mcp`. Each client gets its own session-id-tracked transport instance.
 *
 * Spec: https://modelcontextprotocol.io/specification/draft/server/transports/streamable-http
 */

import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './mcp-server.js';

const transports = new Map<string, StreamableHTTPServerTransport>();

const mcpRouter = Router();

// POST /mcp — initial init + every client→server message after.
mcpRouter.post('/', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => {
                transports.set(sid, transport);
                console.log(`🔌 [mcp-http] session opened — id=${sid.slice(0, 8)}…`);
            },
        });
        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
                console.log(
                    `🔌 [mcp-http] session closed — id=${transport.sessionId.slice(0, 8)}…`,
                );
            }
        };
        const server = createMcpServer();
        await server.connect(transport);
    } else {
        res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: missing or invalid session id' },
            id: null,
        });
        return;
    }

    await transport.handleRequest(req, res, req.body);
});

// GET /mcp — server-initiated messages over SSE (elicitation requests live here).
// DELETE /mcp — explicit session termination.
async function handleSessionRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
        res.status(400).send('Invalid or missing session ID');
        return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
}

mcpRouter.get('/', handleSessionRequest);
mcpRouter.delete('/', handleSessionRequest);

export default mcpRouter;
