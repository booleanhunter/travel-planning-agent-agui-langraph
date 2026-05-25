import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { ensurePoiIndex } from './modules/places/domain/places-service.js';
import { closeRedis } from './lib/redis.js';
import chatRouter from './modules/ai/api/chat.js';
import mcpRouter from './modules/ai/api/mcp-http.js';
import tripsRouter from './modules/trips/api/trips-routes.js';

const app = express();

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use('/api/chat', chatRouter);
app.use('/api/user', tripsRouter);
app.use('/mcp', mcpRouter);

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'trip-itinerary-builder' });
});

async function start(): Promise<void> {
    await ensurePoiIndex();
    app.listen(config.serverPort, () => {
        console.log(`🚀 [server] listening on http://localhost:${config.serverPort}`);
    });
}

process.on('SIGTERM', async () => {
    await closeRedis();
    process.exit(0);
});

start().catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
});
