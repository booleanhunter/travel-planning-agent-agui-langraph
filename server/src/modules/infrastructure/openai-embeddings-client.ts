/**
 * OpenAI embeddings wrapper. Used by:
 *   - Point-of-interest ingestion (embed enriched descriptions for interest search)
 *   - Interest-query interpretation (embed the joined interests phrase)
 *
 * Model: text-embedding-3-small (1536 dimensions, ~$0.02 / 1M tokens).
 */

import OpenAI from 'openai';
import { config } from '../../config.ts';
import { AppError, ErrorType } from '../../lib/errors.ts';

const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIM = 1536;

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export async function embed(text: string): Promise<number[]> {
    try {
        const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: text });
        return res.data[0].embedding;
    } catch (e) {
        throw new AppError(
            'OpenAIEmbeddingsError',
            `OpenAI embeddings: ${String(e)}`,
            ErrorType.EXTERNAL_SERVICE,
        );
    }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
    try {
        const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
        return res.data.map((d) => d.embedding);
    } catch (e) {
        throw new AppError(
            'OpenAIEmbeddingsError',
            `OpenAI embeddings (batch): ${String(e)}`,
            ErrorType.EXTERNAL_SERVICE,
        );
    }
}
