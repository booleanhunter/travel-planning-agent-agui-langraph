/**
 * Smoke test for the itinerary-workflow graph wiring + data-layer adapters.
 *
 * Always-on slices (Redis + AMS + OpenAI required):
 *   1. boot         — compile the singleton graph, list node names
 *   2. mutations    — pin/unpin POI + mark/unmark trip essential against real Redis
 *   3. chitchat     — full graph invocation, verifies agent returns without side effects
 *   4. poiIndex     — ensureIndex idempotency + cache + abundance + hybrid search
 *
 * Gated slices (skipped if the relevant key is missing):
 *   5. places       — GOOGLE_MAPS_API_KEY → searchPlacesParallel + getPlaceDetails
 *   6. tavily       — TAVILY_API_KEY → lookupWeather + searchProducts
 *   7. planAgent    — GOOGLE+TAVILY → end-to-end planning turn: the single
 *                     itinerary_agent ReAct loop populates state.itinerary
 *
 * Prereqs: Redis Stack + Agent Memory Server (`npm run docker:up`) and
 * OPENAI_API_KEY in env. Run via: `npm run smoke` from `server/`.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HumanMessage } from '@langchain/core/messages';
import { getItineraryGraph } from '../src/modules/ai/itinerary-workflow/graph.ts';
import {
    pinPointOfInterest,
    unpinPointOfInterest,
    markTripEssential,
    unmarkTripEssential,
    type ItineraryState,
} from '../src/modules/ai/itinerary-workflow/state.ts';
import {
    ensureIndex,
    cachePointOfInterest,
    hasSufficientPointsOfInterest,
    searchPointsOfInterest,
    getRedisClient,
} from '../src/modules/points-of-interest/data/redis-points-of-interest-index.ts';
import { embed } from '../src/modules/infrastructure/openai-embeddings-client.ts';
import {
    searchPlacesParallel,
    getPlaceDetails,
} from '../src/modules/points-of-interest/data/google-places-client.ts';
import {
    lookupWeather,
    searchProducts,
} from '../src/modules/infrastructure/web-search-client.ts';

const log = (slice: string, msg: string) => console.log(`[smoke:${slice}] ${msg}`);
const ok = (slice: string, msg: string) => console.log(`[smoke:${slice}] ✓ ${msg}`);

async function bootSmoke() {
    log('boot', 'compiling itinerary graph singleton…');
    const graph = await getItineraryGraph();
    const nodes = Object.keys((graph as unknown as { nodes: Record<string, unknown> }).nodes ?? {});
    log('boot', `node names: ${nodes.join(', ')}`);
    // createAgent's compiled graph exposes its agent + tool nodes; the exact
    // names are an implementation detail (currently `model` + `tools`), so we
    // only assert that the graph compiled and has at least one node.
    assert.ok(nodes.length > 0, 'expected compiled graph to expose at least one node');
    ok('boot', 'graph compiled');
}

async function mutationsSmoke() {
    const threadId = `smoke-mut-${randomUUID()}`;
    log('mutations', `thread ${threadId}`);

    // pin × 2 (second should dedupe)
    const pinned = await pinPointOfInterest(threadId, {
        dayId: 'day-1',
        date: '2026-05-20',
        timeOfDay: 'morning',
        pointOfInterestId: 'ChIJsmoke',
        pointOfInterestName: 'Cubbon Park',
    });
    ok('mutations', `pinned entry id=${pinned.id}`);

    const pinnedAgain = await pinPointOfInterest(threadId, {
        dayId: 'day-1',
        timeOfDay: 'morning',
        pointOfInterestId: 'ChIJsmoke',
        pointOfInterestName: 'Cubbon Park',
    });
    assert.equal(pinnedAgain.id, pinned.id, 'pin dedupe should return existing entry');
    ok('mutations', 'pin dedupes on (timeOfDay, pointOfInterestId)');

    await unpinPointOfInterest(threadId, 'day-1', pinned.id);
    ok('mutations', 'unpinned the entry');

    // trip essentials round-trip
    const essential = await markTripEssential(threadId, {
        id: 'ess-1',
        label: 'rain jacket',
        owned: false,
    });
    assert.equal(essential.id, 'ess-1');
    ok('mutations', `marked essential ${essential.id}`);

    await unmarkTripEssential(threadId, 'ess-1');
    ok('mutations', 'unmarked essential');
}

async function chitchatSmoke() {
    const threadId = `smoke-chat-${randomUUID()}`;
    log('chitchat', `thread ${threadId}`);
    const graph = await getItineraryGraph();
    const result = await graph.invoke(
        {
            userId: 'smoke-user',
            sessionId: threadId,
            messages: [new HumanMessage('hi')],
        },
        { configurable: { thread_id: threadId } },
    );
    assert.equal(result.pendingElicitation, undefined, 'chitchat must not elicit');
    assert.equal(result.itinerary, undefined, 'chitchat must not touch itinerary');
    assert.equal(result.tripEssentials, undefined, 'chitchat must not touch tripEssentials');
    ok('chitchat', 'invoked, agent returned without side effects');
}

async function poiIndexSmoke() {
    log('poiIndex', 'ensureIndex × 2 (must be idempotent)');
    await ensureIndex().catch(() => {}); // tolerated only because getRedisClient races it
    await getRedisClient(); // triggers internal ensureIndex
    await ensureIndex(); // second call should no-op via "Index already exists" catch
    ok('poiIndex', 'index present and second FT.CREATE swallowed');

    const placeId = `smoke-${randomUUID()}`;
    const bangalore = { latitude: 12.9716, longitude: 77.5946 };
    const embedding = await embed('quiet indie coffee shop with books');
    await cachePointOfInterest({
        placeId,
        name: 'Smoke Test Cafe',
        latitude: bangalore.latitude,
        longitude: bangalore.longitude,
        rating: 4.5,
        userRatingCount: 12,
        types: ['cafe', 'restaurant'],
        description: 'A cozy indie cafe.',
        embedding,
    });
    ok('poiIndex', `cached pointsOfInterest:${placeId}`);

    const enough = await hasSufficientPointsOfInterest(bangalore, 5, 1);
    assert.equal(enough, true, 'abundance gate should see our one cached entry within radius');
    ok('poiIndex', 'hasSufficientPointsOfInterest returns true at threshold=1');

    const queryVec = await embed('cozy bookshop cafe');
    const hits = await searchPointsOfInterest(queryVec, bangalore, 5, ['cafe'], 5);
    assert.ok(
        hits.some((h) => h.placeId === placeId),
        `hybrid search should return our seeded entry; got ${hits.map((h) => h.placeId).join(',')}`,
    );
    ok('poiIndex', `hybrid GEO + TAG + KNN returned ${hits.length} hits, our entry included`);

    const c = await getRedisClient();
    await c.del(`pointsOfInterest:${placeId}`);
}

async function placesSmoke() {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
        log('places', 'skipped (GOOGLE_MAPS_API_KEY not set)');
        return;
    }
    const found = await searchPlacesParallel(['museums in Bangalore']);
    assert.ok(found.length > 0, 'expected at least one place from text search');
    ok('places', `searchPlacesParallel returned ${found.length} unique places`);

    const details = await getPlaceDetails([found[0].placeId]);
    assert.equal(details.length, 1, 'expected one place from details lookup');
    assert.equal(details[0].placeId, found[0].placeId);
    ok('places', `getPlaceDetails round-tripped placeId=${details[0].placeId}`);
}

async function tavilySmoke() {
    if (!process.env.TAVILY_API_KEY) {
        log('tavily', 'skipped (TAVILY_API_KEY not set)');
        return;
    }
    const weather = await lookupWeather('Bangalore', [
        { date: '2026-05-20' },
        { date: '2026-05-21' },
    ]);
    assert.equal(weather.length, 2, 'expected one forecast row per day');
    assert.ok(weather[0].conditions.length > 0, 'forecast must carry a non-empty narrative');
    ok('tavily', `lookupWeather → 2 days, summary "${weather[0].conditions.slice(0, 60)}…"`);

    const products = await searchProducts('compact travel umbrella', 2);
    assert.ok(products.length > 0, 'expected at least one product result');
    assert.ok(products[0].url.startsWith('http'), 'product url must be a URL');
    ok('tavily', `searchProducts → ${products.length} results (${products[0].vendor})`);
}

async function planAgentSmoke() {
    if (!process.env.GOOGLE_MAPS_API_KEY || !process.env.TAVILY_API_KEY) {
        log('planAgent', 'skipped (GOOGLE_MAPS_API_KEY or TAVILY_API_KEY not set)');
        return;
    }

    const threadId = `smoke-plan-${randomUUID()}`;
    log('planAgent', `thread ${threadId}`);
    const graph = await getItineraryGraph();
    const config = { configurable: { thread_id: threadId } };

    // Single fully-specified prompt — the agent extracts destination/dates/
    // interests from the message itself (no state slots, no extraction node),
    // calls searchAndRankPointsOfInterest + lookupWeather, then composes the
    // plan via addPointOfInterestToItinerary. Real LLM + Places + Tavily + Redis.
    // Tight recursionLimit cap — a healthy planner finishes in ~5 LLM turns.
    // If it loops on search+weather without progressing to add* we want to
    // fail in seconds, not minutes.
    log('planAgent', 'running itinerary_agent (real LLM + tools)…');
    const toolCounts: Record<string, number> = {};
    let llmTurns = 0;
    try {
        const events = graph.streamEvents(
            {
                userId: 'smoke-user',
                sessionId: threadId,
                messages: [
                    new HumanMessage(
                        'plan a trip to Bangalore for 3 days starting May 20 2026',
                    ),
                ],
            },
            {
                ...config,
                recursionLimit: 18,
                version: 'v2',
            },
        );
        for await (const event of events) {
            if (event.event === 'on_tool_start') {
                toolCounts[event.name] = (toolCounts[event.name] ?? 0) + 1;
                log('planAgent', `tool#${toolCounts[event.name]} ${event.name}`);
            } else if (event.event === 'on_chat_model_end') {
                llmTurns += 1;
                const msg = event.data?.output as
                    | { tool_calls?: Array<{ name: string }>; content?: unknown }
                    | undefined;
                const calls = msg?.tool_calls?.map((c) => c.name).join(', ') ?? '';
                log('planAgent', `llm#${llmTurns} → [${calls || 'no-tool-call'}]`);
            }
        }
    } catch (e) {
        console.error(
            `[smoke:planAgent] failed after ${llmTurns} LLM turn(s); tool counts: ${JSON.stringify(toolCounts)}`,
        );
        throw e;
    }
    const afterPlan = (await graph.getState(config)).values as ItineraryState;

    const days = afterPlan.itinerary ?? [];
    assert.ok(days.length > 0, `expected itinerary days, got ${days.length}`);
    const totalEntries = days.reduce((n, d) => n + d.entries.length, 0);
    assert.ok(
        totalEntries > 0,
        `expected at least one pinned point of interest, got ${totalEntries} across ${days.length} day(s)`,
    );
    ok(
        'planAgent',
        `itinerary composed: ${days.length} day(s), ${totalEntries} pinned entry(s)`,
    );

    if (afterPlan.candidatePois?.results.length) {
        ok(
            'planAgent',
            `candidatePois cached: ${afterPlan.candidatePois.results.length} for "${afterPlan.candidatePois.destination}"`,
        );
    } else {
        log('planAgent', 'candidatePois not populated (planner skipped searchAndRankPointsOfInterest this turn)');
    }

    if (afterPlan.weather?.forecast.length) {
        ok(
            'planAgent',
            `weather cached: ${afterPlan.weather.forecast.length} day(s) for "${afterPlan.weather.destination}"`,
        );
    } else {
        log('planAgent', 'weather not populated (planner skipped lookupWeather this turn)');
    }
}

async function main() {
    await bootSmoke();
    await mutationsSmoke();
    await chitchatSmoke();
    await poiIndexSmoke();
    await placesSmoke();
    await tavilySmoke();
    await planAgentSmoke();
    console.log('\n[smoke] all slices passed ✓');
    process.exit(0);
}

main().catch((e) => {
    console.error('\n[smoke] FAILED:', e);
    process.exit(1);
});
