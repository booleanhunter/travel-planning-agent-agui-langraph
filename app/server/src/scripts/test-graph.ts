/**
 * Quick sanity test for the LangGraph workflow. Runs two invocations:
 *   1. "Plan a trip to Bangalore" — expects FinalizeElicit (dates + interests missing)
 *   2. Fully specified — expects FetchRecs ∥ FetchWeather → FinalizePlan
 */

import { graph } from "../agent/graph.js";
import { closeRedis } from "../lib/redis.js";

async function main(): Promise<void> {
  const userId = "ashwin";

  console.log("\n=== Test 1: partial prompt (expect FinalizeElicit) ===");
  const out1 = await graph.invoke({
    userId,
    sessionId: "test-session-1",
    userMessage: "Plan a trip to Bangalore",
  });
  console.log("intent:", out1.intent);
  console.log("destination:", out1.destination);
  console.log("dates:", out1.dates);
  console.log("interests:", out1.interests);
  console.log("elicit fields:", out1.elicit?.fields.map((f: { name: string }) => f.name));
  console.log("response (should be undefined):", out1.response);

  console.log("\n=== Test 2: fully specified (expect FetchRecs + FetchWeather → FinalizePlan) ===");
  const out2 = await graph.invoke({
    userId,
    sessionId: "test-session-2",
    userMessage: "Plan a foodie trip to Bangalore for May 20-24",
    interests: ["food", "landmarks"],
  });
  console.log("destination:", out2.destination);
  console.log("dates:", out2.dates);
  console.log("interests:", out2.interests);
  console.log("pois count:", out2.pois.length);
  console.log("first 3 pois:", out2.pois.slice(0, 3).map((p) => p.name));
  console.log("weather:", out2.weather?.condition, `${out2.weather?.high}°/${out2.weather?.low}°`);
  console.log("response:", out2.response?.slice(0, 200));
  console.log("suggestedActions:", out2.suggestedActions);
  console.log("elicit (should be undefined):", out2.elicit);

  await closeRedis();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
