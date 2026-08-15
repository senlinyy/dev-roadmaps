---
title: "Build an Idempotent Order Handler"
sectionSlug: timeout-and-retries
order: 3
---

Complete the event handler in `handler.js`. It must require a CloudEvent `id`, create an order only once through `dependencies.orders.create`, and remember the event only after the create call succeeds. A repeated event must return `{ duplicate: true }` without creating another order. Run the visible tests to check retry, duplicate, and invalid-event behavior.

The grader executes the submitted project with Node.js.
