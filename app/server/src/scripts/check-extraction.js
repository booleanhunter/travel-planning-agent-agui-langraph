/**
 * Quick check: search AMS long-term memory for a user.
 *
 * Use to verify auto-extraction is working. Send a preference-y message
 * via the chat UI (or directly to AMS working memory), wait ~10-30 seconds
 * for the background extractor to run, then:
 *
 *   node server/src/scripts/check-extraction.js ashwin "quiet slow destinations"
 *
 * Prints each matching memory with its id, text, topics, entities, type,
 * created timestamp, and similarity score.
 */

import 'dotenv/config';
import { MemoryAPIClient } from 'agent-memory-client';

const AMS_URL = process.env.AGENT_MEMORY_SERVER_URL ?? 'http://localhost:8000';
const userId = process.argv[2] ?? 'ashwin';
const query = process.argv[3] ?? 'travel preferences interests likes dislikes';
const limit = Number(process.argv[4] ?? 20);

const ams = new MemoryAPIClient({ baseUrl: AMS_URL });

console.log(`Long-term memory search`);
console.log(`  user_id: ${userId}`);
console.log(`  query:   "${query}"`);
console.log(`  limit:   ${limit}`);
console.log(`  ams_url: ${AMS_URL}`);
console.log('');

const result = await ams.searchLongTermMemory({
    text: query,
    userId: { eq: userId },
    limit,
});

if (!result.memories.length) {
    console.log('(no matches)');
    console.log('');
    console.log(
        "Tips:\n" +
            "- Auto-extraction is async — give AMS ~10-30s after the chat message lands\n" +
            "- Try a broader query like \"\" or \"preferences\"\n" +
            "- Check ENABLE_DISCRETE_MEMORY_EXTRACTION is on in docker-compose (default: true)",
    );
    process.exit(0);
}

console.log(`Found ${result.memories.length} match(es):`);
console.log('');

for (const m of result.memories) {
    const score = m.dist !== undefined ? m.dist.toFixed(3) : m.score?.toFixed?.(3) ?? '—';
    const topics = m.topics?.length ? m.topics.join(', ') : '(none)';
    const entities = m.entities?.length ? m.entities.join(', ') : '(none)';
    const created = m.created_at ? new Date(m.created_at).toLocaleString() : '—';
    console.log(`▸ ${m.id}`);
    console.log(`  text:     "${m.text}"`);
    console.log(`  type:     ${m.memory_type ?? 'semantic'}`);
    console.log(`  topics:   ${topics}`);
    console.log(`  entities: ${entities}`);
    console.log(`  created:  ${created}`);
    console.log(`  score:    ${score}`);
    console.log('');
}
