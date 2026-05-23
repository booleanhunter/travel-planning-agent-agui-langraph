# Canonical graph sketch

Source-of-truth Mermaid for the new single-graph topology. The other diagrams elaborate on this.

## Top level

```mermaid
flowchart TD
      START([START]) --> RI[RouteIntent<br/><i>extract slots · hydrate AMS</i>]
      RI --> BR{slots filled?}
      BR -- yes --> FW[FetchWeather<br/><i>in-code lookup</i>]
      BR -- yes --> FR[FetchRecs<br/><i>hybrid FT.SEARCH</i>]
      BR -- no --> FE[FinalizeElicit<br/><i>return elicit spec as state</i>]
      FW --> FP[FinalizePlan<br/><i>summary + suggestedActions</i>]
      FR --> FP
      FE --> END([END])
      FP --> END
```

Each graph run is one-shot — no checkpointer, no `interrupt()`. When slots are missing, `FinalizeElicit` returns `{ elicit: { message, requestedSchema } }` as final state; the client renders a chip card and resubmits a new turn with the merged state.

## FetchRecs internal

```mermaid
flowchart LR
      IN([node enters]) --> EM[embed state.interests<br/>text-embedding-3-small]
      EM --> KNN["FT.SEARCH idx:pointsOfInterest<br/>(@city:{X}) =>[KNN @vector]"]
      KNN --> RANK[rank + diversify]
      RANK --> OUT([return pois])
```

The POI catalog was populated once by `scripts/seed-pois.ts` — Google Places API at seed time only. Runtime never calls Places.
