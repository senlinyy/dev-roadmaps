---
title: "Classify Two TLS Handshake Failures"
sectionSlug: when-http-and-tls-break
order: 5
---

The synthetic monitor lit up two alerts in five minutes: `api.example.com` and `legacy.example.com` both stopped responding to HTTPS. SRE captured the failing `curl -v` output for each. Your job is to classify the failure mode for each host and confirm nginx logged matching upstream errors so you can route the ticket to the right team.

You start in `/home/dev`. Your job:

1. **Inspect the `api.example.com` handshake dump** at `/home/dev/postmortem/api-handshake.txt` and identify the TLS failure mode.
2. **Inspect the `legacy.example.com` handshake dump** at `/home/dev/postmortem/legacy-handshake.txt` and identify the different TLS failure mode there.
3. **Surface the exact OpenSSL error strings from both captures** so the two failure classes are visible side by side.
4. **Check the recent nginx error log** and confirm the upstream impact that happened in the same window.

The grader requires you to use `cat`, `grep`, and `tail`, and your combined output must contain `certificate verify failed`, `subjectAltName does not match`, `upstream prematurely closed`, and `legacy.example.com`.
