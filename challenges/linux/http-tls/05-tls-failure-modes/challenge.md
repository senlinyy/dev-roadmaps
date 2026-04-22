---
title: "Classify Two TLS Handshake Failures"
sectionSlug: when-http-and-tls-break
order: 5
---

The synthetic monitor lit up two alerts in five minutes: `api.example.com` and `legacy.example.com` both stopped responding to HTTPS. SRE captured the failing `curl -v` output for each. Your job is to classify the failure mode for each host and confirm nginx logged matching upstream errors so you can route the ticket to the right team.

You start in `/home/dev`. Your job:

1. **Read the api.example.com handshake dump** at `/home/dev/postmortem/api-handshake.txt` to identify the TLS error.
2. **Read the legacy.example.com handshake dump** at `/home/dev/postmortem/legacy-handshake.txt` to identify a different TLS error.
3. **Pull the exact OpenSSL error strings** by running `grep "verify|subjectAltName" /home/dev/postmortem/api-handshake.txt /home/dev/postmortem/legacy-handshake.txt`.
4. **Confirm the upstream impact** by running `tail -n 5 /var/log/nginx/error.log` to see the nginx-side errors that fired during the same window.

The grader requires you to use `cat`, `grep`, and `tail`, and your combined output must contain `certificate verify failed`, `subjectAltName does not match`, `upstream prematurely closed`, and `legacy.example.com`.
