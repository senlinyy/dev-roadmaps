---
title: "Route Incident Snapshots to the Right OSI Layer"
sectionSlug: the-osi-model-as-a-debugging-map
order: 2
---

You are the on-call engineer triaging a queue of half-described incidents from the previous shift. None of them include a layer label — only the raw symptom and what the user tried first. Your job is to pick the layer that owns each problem so the ticket lands with the right team without bouncing.

Each scenario describes a realistic production failure. Pick the **single best** OSI layer (or for multi-answer questions, **all** layers that genuinely participate). Treat "best" as the layer whose primitives the next responder needs to inspect first — not the layer that happens to be mentioned in the alert text.
