---
title: "Triage Three curl Runs"
sectionSlug: inspecting-http-with-curl
order: 3
---

The payments API is intermittently returning 503. SRE captured three `curl -v` runs at 09:01, 09:05, and 09:09 so you can compare a successful request against the failing one and pull the request id of the bad call for the postmortem timeline.

You start in `/home/dev`. Your job:

1. **List the captured runs** with `ls /home/dev/postmortem/curl-runs/` so you know which files exist.
2. **Read the failing run** at `/home/dev/postmortem/curl-runs/run-2-09-05.txt` to see the full request and response.
3. **Pull the status line from each run** by running `grep "< HTTP/" /home/dev/postmortem/curl-runs/run-1-09-01.txt /home/dev/postmortem/curl-runs/run-2-09-05.txt /home/dev/postmortem/curl-runs/run-3-09-09.txt`.
4. **Pull the request ids** by running `grep "X-Request-Id" /home/dev/postmortem/curl-runs/run-1-09-01.txt /home/dev/postmortem/curl-runs/run-2-09-05.txt /home/dev/postmortem/curl-runs/run-3-09-09.txt` so the failing id can go in the timeline.

The grader requires you to use `ls`, `cat`, and `grep`, and your combined output must contain `HTTP/2 503`, `HTTP/2 200`, `X-Request-Id`, and `req-9-05-fail`.
