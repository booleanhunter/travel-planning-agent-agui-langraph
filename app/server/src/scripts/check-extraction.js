/**
 * Quick check: search Agent Memory long-term memory for a user.
 *
 * Use to confirm records are stored and searchable. Seed (or run the app),
 * then:
 *
 *   node server/src/scripts/check-extraction.js ashwin "quiet slow destinations"
 *
 * Prints each matching memory with its id, text, topics, memory type, and
 * created timestamp.
 *
 * Requires (in .env): AGENT_MEMORY_SERVER_URL, AGENT_MEMORY_STORE_ID,
 * AGENT_MEMORY_API_KEY.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AgentMemory } from '@redis-iris/agent-memory';

const HERE = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(HERE, '../../../.env'), quiet: true });

const serverURL = process.env.AGENT_MEMORY_SERVER_URL;
const storeId = process.env.AGENT_MEMORY_STORE_ID;
const apiKey = process.env.AGENT_MEMORY_API_KEY;

if (!serverURL || !storeId || !apiKey) {
    console.error(
        'Missing Agent Memory env vars: set AGENT_MEMORY_SERVER_URL, ' +
            'AGENT_MEMORY_STORE_ID, and AGENT_MEMORY_API_KEY in .env',
    );
    process.exit(1);
}

const userId = process.argv[2] ?? 'ashwin';
const query = process.argv[3] ?? 'travel preferences interests likes dislikes';
const limit = Number(process.argv[4] ?? 20);

const agentMemory = new AgentMemory({ serverURL, storeId, apiKey });

console.log('Long-term memory search (Agent Memory)');
console.log(`  owner_id: ${userId}`);
console.log(`  query:    "${query}"`);
console.log(`  limit:    ${limit}`);
console.log('');

const result = await agentMemory.searchLongTermMemory({
    text: query,
    filter: { ownerId: { eq: userId } },
    limit,
});

const memories = result.items ?? [];

if (!memories.length) {
    console.log('(no matches)');
    console.log('');
    console.log(
        'Tips:\n' +
            '- Run `npm run seed:users -w server` to (re)write the seeded personas\n' +
            '- Try a broader query like "preferences"\n' +
            '- Confirm the AGENT_MEMORY_* values in .env point at your store',
    );
    process.exit(0);
}

console.log(`Found ${memories.length} match(es):`);
console.log('');

for (const memory of memories) {
    const topics = memory.topics?.length ? memory.topics.join(', ') : '(none)';
    const created = memory.createdAt ? new Date(memory.createdAt).toLocaleString() : '—';
    console.log(`▸ ${memory.id}`);
    console.log(`  text:     "${memory.text}"`);
    console.log(`  type:     ${memory.memoryType ?? 'default'}`);
    console.log(`  topics:   ${topics}`);
    console.log(`  created:  ${created}`);
    console.log('');
}
