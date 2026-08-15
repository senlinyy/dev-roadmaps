---
title: "Implement an Idempotent Lambda Handler"
sectionSlug: triggers-retries-and-idempotency
order: 2
---

Implement createHandler for an at-least-once Lambda trigger. Validate that each event has a nonempty eventId, atomically claim that ID before publishing, return a duplicate result when another invocation already owns it, and release the claim if the downstream publish fails so a later retry can recover. Keep AWS access behind the injected store and publisher adapters. The tests cover duplicate delivery, concurrent delivery, invalid input, and retry after downstream failure.
