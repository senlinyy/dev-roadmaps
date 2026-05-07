---
title: "Find The First Useful Error"
sectionSlug: a-practical-log-analytics-review
order: 4
---

A checkout incident mentions operation ID `checkout-5001`. Use Log Analytics workspace `law-devpolaris-prod` to inspect app and gateway log evidence for the failure.

Your job:

1. **Query** app runtime logs for the operation.
2. **Query** gateway resource logs for the same incident window or operation.
3. **Collect** the first useful error text and status evidence.

The grader checks that your output includes the runtime failure, gateway status, and shared operation ID.
