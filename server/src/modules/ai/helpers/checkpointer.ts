/**
 * LangGraph checkpointer — in-memory (`MemorySaver`), one singleton per process.
 */

import { MemorySaver } from '@langchain/langgraph';

let checkpointer: MemorySaver | null = null;

export async function getCheckpointer(): Promise<MemorySaver> {
    if (checkpointer) return checkpointer;
    checkpointer = new MemorySaver();
    return checkpointer;
}
