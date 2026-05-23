import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config.js";

let chatModel: ChatOpenAI | null = null;
let embeddings: OpenAIEmbeddings | null = null;

export function getChatModel(): ChatOpenAI {
  if (chatModel) return chatModel;
  chatModel = new ChatOpenAI({
    apiKey: config.openaiApiKey,
    model: config.modelName,
    temperature: 0.2,
  });
  return chatModel;
}

export function getEmbeddings(): OpenAIEmbeddings {
  if (embeddings) return embeddings;
  embeddings = new OpenAIEmbeddings({
    apiKey: config.openaiApiKey,
    model: config.embeddingModel,
  });
  return embeddings;
}

export async function embed(text: string): Promise<number[]> {
  return getEmbeddings().embedQuery(text);
}

/**
 * Embed a single string and return it as a Buffer of little-endian Float32 values,
 * matching Redis VECTOR field's FLOAT32 expectation.
 */
export async function embedToBuffer(text: string): Promise<Buffer> {
  const vec = await embed(text);
  const buf = Buffer.alloc(vec.length * 4);
  vec.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
}
