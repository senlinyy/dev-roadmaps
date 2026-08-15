---
title: "Build an Idempotent Pub/Sub Handler"
sectionSlug: retry-and-idempotency
order: 2
---

Complete `handler.js` for a CloudEvent delivered through Pub/Sub. Require the event `id`, decode `event.data.message.data` from base64 JSON, and call `dependencies.receipts.create` only once per event. Mark the event processed only after the receipt is created so a failed attempt can retry. Run the visible tests.

The grader executes the submitted project with Node.js.
