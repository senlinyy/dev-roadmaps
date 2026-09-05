---
title: "Trace a Failed Request"
sectionSlug: how-do-you-read-nginx-access-and-error-logs
order: 3
---

One `/api/items` request failed at 10:21:13 UTC while other requests continued. You start in `/home/dev`. The evidence is in `/var/log/nginx/access.log`, `/var/log/nginx/error.log`, and `/var/log/app/app.jsonl`.

1. **Summarize client-facing status codes** from the complete access log as `status count`, sorted by status.
2. **Isolate the failed access record**, excluding successful requests.
3. **Follow its request ID into the proxy error log and application JSON log**, excluding unrelated application requests.
4. **Preserve all three source files.**

The grader checks the status summary and correlated evidence from each original source, not a written diagnosis.
