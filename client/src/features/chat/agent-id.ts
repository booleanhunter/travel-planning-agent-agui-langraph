// Shared agent identifier — must match the key on
// `CopilotRuntime({ agents: { ... } })` in server/src/index.ts. Without this,
// `useAgent` / `useInterrupt` resolve the implicit 'default' agent and throw
// "Agent 'default' not found".
export const AGENT_ID = 'itineraryPlanner';
