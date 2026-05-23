/**
 * Quick sanity test for the LangGraph workflow.
 *
 * Runs three invocations:
 *   1. Partial prompt → expect TravelAgent → FollowUp (with elicit).
 *   2. Fully specified prompt → expect TravelAgent → FetchRecs ∥ FetchWeather → FollowUp.
 *   3. Continue intent (filling form) → expect TravelAgent → FollowUp.
 */

import { graph } from "../agent/graph.js";
import { closeRedis } from "../lib/redis.js";

async function main(): Promise<void> {
  const userId = "ashwin";

  console.log("\n=== Test 1: partial prompt (expect TravelAgent → FollowUp with elicit) ===");
  const out1 = await graph.invoke({
    userId,
    sessionId: "test-elicit",
    userMessage: "Plan a trip to Bangalore",
  });
  console.log("intent:", out1.intent);
  console.log("destination:", out1.destination);
  console.log("dates:", out1.dates);
  console.log("interests:", out1.interests);
  console.log("response:", out1.response?.slice(0, 120));
  console.log("elicit fields:", out1.elicit?.fields.map((f: { name: string }) => f.name));

  console.log("\n=== Test 2: fully specified (expect TravelAgent → FetchRecs+FetchWeather → FollowUp) ===");
  const out2 = await graph.invoke({
    userId,
    sessionId: "test-plan",
    userMessage: "Plan a foodie trip to Bangalore for May 20-24",
    interests: ["food", "landmarks"],
  });
  console.log("intent:", out2.intent);
  console.log("destination:", out2.destination);
  console.log("dates:", out2.dates);
  console.log("interests:", out2.interests);
  console.log("pois count:", out2.pois.length);
  console.log("weather:", out2.weather?.condition, `${out2.weather?.high}°/${out2.weather?.low}°`);
  console.log("response:", out2.response?.slice(0, 160));
  console.log("suggestedActions:", out2.suggestedActions);
  console.log("elicit (should be undefined):", out2.elicit);

  console.log("\n=== Test 3: continue intent (form submission) ===");
  const out3 = await graph.invoke({
    userId,
    sessionId: "test-continue",
    userMessage: "Here's what I picked from the form.",
    destination: "bangalore",
    dates: { start: "2026-05-20", end: "2026-05-24" },
    interests: ["food", "culture"],
  });
  console.log("intent:", out3.intent);
  console.log("response:", out3.response?.slice(0, 160));
  console.log("suggestedActions:", out3.suggestedActions);
  console.log("elicit (should be undefined):", out3.elicit);

  await closeRedis();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
