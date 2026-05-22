/** OpenAI clients used across LangGraph nodes. */

import { ChatOpenAI } from '@langchain/openai';
import { config } from '../../../config.ts';

/** Moderate temperature — for variant generation, narration, vibe interpretation. */
export const creativeLlm = new ChatOpenAI({
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    temperature: 0.7,
});

/** Low temperature — for structured-output extraction, classification, ranking. */
export const deterministicLlm = new ChatOpenAI({
    apiKey: config.openai.apiKey,
    model: config.openai.model,
    temperature: 0.2,
});
