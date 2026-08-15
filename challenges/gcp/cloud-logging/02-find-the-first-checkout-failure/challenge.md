---
title: "Find the First Checkout Failure"
sectionSlug: queries-that-answer-incident-questions
order: 2
---

Production `orders-api` began returning checkout failures after a revision rollout. Read Cloud Run error logs for the service and gather the trace, revision, order ID, error code, and dependency named by the first useful failure.

Use a narrow log query based on resource type and severity. Do not search every project or dump unrelated informational logs.
