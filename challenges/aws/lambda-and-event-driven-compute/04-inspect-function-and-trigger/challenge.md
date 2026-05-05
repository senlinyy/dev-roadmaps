---
title: "Inspect Function And Trigger"
sectionSlug: events-handlers-and-invocations
order: 4
---

The receipt email helper `devpolaris-receipt-email` in Region `us-east-1` is not a web server. It runs when the `devpolaris-receipt-email-queue` event source invokes it, so inspect both the function and the trigger.

Your job:

1. **Inspect the function configuration** for runtime, handler, role, timeout, memory, environment, and log group.
2. **Inspect the event source mapping** so you know what invokes the function.

The grader checks that you looked at both the handler shape and the event trigger.
