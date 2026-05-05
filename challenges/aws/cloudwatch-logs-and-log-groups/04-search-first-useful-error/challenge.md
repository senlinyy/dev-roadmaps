---
title: "Search First Useful Error"
sectionSlug: searching-for-the-first-useful-error
order: 4
---

Checkout support has a failed request with correlation ID `req-7b91`. The relevant log group is `/aws/ecs/devpolaris-orders-api`, and the team wants the first useful `ERROR` event, not a full log dump.

Your job:

1. **Inspect the log group** that belongs to the orders API.
2. **Filter the events** for the error signal related to `req-7b91`.
3. **Keep the output visible** so the grader can see the error message and correlation fields.

The grader checks AWS log evidence, not a written explanation.
