/**
 * Quick sanity test for the LangGraph workflow.
 *
 * Post-Phase-6 architecture:
 *   TravelAgent (ReAct with bound tools) → FollowUp (rule-based + suggestions)
 *
 * The LLM picks tools — no more intent-based code routing. Test cases below
 * exercise the typical paths the agent will take.
 */

import { graph } from '#modules/ai/agentic-trip-workflow/graph.js';
import { closeRedis } from '#lib/redis.js';

async function main(): Promise<void> {
    const userId = 'ashwin';

    console.log('\n=== Test 1: planning, slots missing (expect no tool calls, elicit) ===');
    const out1 = await graph.invoke({
        userId,
        sessionId: 'test-1',
        userMessage: 'Plan a trip to Bangalore',
    });
    console.log('destination:', out1.destination);
    console.log('dates:', out1.dates);
    console.log('interests:', out1.interests);
    console.log('toolCalls:', out1.toolCalls.map((toolCall) => toolCall.name).join(', '));
    console.log('response:', out1.response?.slice(0, 120));
    console.log(
        'elicit fields:',
        out1.elicit ? Object.keys(out1.elicit.requestedSchema.properties) : undefined,
    );

    console.log('\n=== Test 2: planning, all slots present ===');
    const out2 = await graph.invoke({
        userId,
        sessionId: 'test-2',
        userMessage: 'Plan a foodie trip to Bangalore for May 20-24',
        interests: ['food', 'landmarks'],
    });
    console.log('toolCalls:', out2.toolCalls.map((toolCall) => toolCall.name).join(', '));
    console.log('pois count:', out2.pois.length);
    console.log('weather:', out2.weather?.condition);
    console.log('response:', out2.response?.slice(0, 160));
    console.log('elicit:', out2.elicit);

    console.log('\n=== Test 3: researching ===');
    const out3 = await graph.invoke({
        userId,
        sessionId: 'test-3',
        userMessage: 'What are some interesting places to explore in Mumbai?',
        destination: 'mumbai',
    });
    console.log('toolCalls:', out3.toolCalls.map((toolCall) => toolCall.name).join(', '));
    console.log('pois count:', out3.pois.length);
    console.log('weather (should be undefined):', out3.weather);
    console.log('response:', out3.response?.slice(0, 160));

    console.log('\n=== Test 4: trip prep ===');
    const out4 = await graph.invoke({
        userId,
        sessionId: 'test-4',
        userMessage: 'What should I pack for Barcelona in October?',
        destination: 'barcelona',
        dates: { start: '2026-10-10', end: '2026-10-15' },
    });
    console.log('toolCalls:', out4.toolCalls.map((toolCall) => toolCall.name).join(', '));
    console.log('pois count (should be 0 or low):', out4.pois.length);
    console.log('weather:', out4.weather?.condition);
    console.log('response:', out4.response?.slice(0, 160));

    console.log('\n=== Test 5: small talk ===');
    const out5 = await graph.invoke({
        userId,
        sessionId: 'test-5',
        userMessage: 'Thanks! Talk to you later.',
    });
    console.log('toolCalls:', out5.toolCalls.map((toolCall) => toolCall.name).join(', '));
    console.log('pois count (should be 0):', out5.pois.length);
    console.log('response:', out5.response?.slice(0, 160));

    await closeRedis();
    console.log('\nDone.');
}

main().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
