---
title: "Follow One Checkout Failure"
sectionSlug: traces-tell-you-where-time-went
order: 4
---

A support ticket names operation ID `checkout-5001`. Use Azure evidence from Application Insights component `appi-devpolaris-orders-prod` and Log Analytics workspace `law-devpolaris-prod` to follow the failed request.

Your job:

1. **Query** the request evidence for the operation.
2. **Query** dependency or exception evidence for the same operation.
3. **Query** workspace logs that mention the runtime failure.

The grader checks that your output connects the request, dependency, exception, and log evidence for `checkout-5001`.
