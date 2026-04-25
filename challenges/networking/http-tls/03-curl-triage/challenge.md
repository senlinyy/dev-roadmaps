---
title: "Triage Three curl Runs"
sectionSlug: inspecting-http-with-curl
order: 3
---

The payments API is intermittently returning 503. SRE captured three `curl -v` runs at 09:01, 09:05, and 09:09 so you can compare a successful request against the failing one and pull the request id of the bad call for the postmortem timeline.

You start in `/home/dev`. Your job:

1. **Inventory the saved `curl -v` runs** under `/var/log/incidents/curl-runs/`.
2. **Inspect the failing run** at `/var/log/incidents/curl-runs/run-2-09-05.curl` so you understand the full request/response pair.
3. **Compare the HTTP status lines across all three captures** so the good and bad runs are visible together.
4. **Surface the request IDs from all three captures** so the failing call can be pinned to the timeline.

The grader requires you to use `ls`, `cat`, and `grep`, and your combined output must contain `HTTP/2 503`, `HTTP/2 200`, `X-Request-Id`, and `req-9-05-fail`.
