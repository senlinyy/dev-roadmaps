---
title: "Find The Caller And Audit Record"
sectionSlug: audit-records-tell-you-what-happened
order: 4
---

The `devpolaris-orders-api` service failed while reading `/devpolaris/orders-api/prod/database-url` with `GetSecretValue`. Before deciding what to change, collect the caller and audit evidence.

Your job:

1. **Ask AWS who the CLI is acting as** in this simulated session.
2. **Find the matching audit event** for the failed `GetSecretValue` secret read.

The grader checks that your terminal output includes the caller, account, event name, and failure evidence.
