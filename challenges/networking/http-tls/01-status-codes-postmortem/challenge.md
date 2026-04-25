---
title: "Postmortem a 502 at Checkout"
sectionSlug: status-codes-what-the-server-tells-you-back
order: 1
---

A customer DM'd support: "I clicked Pay and got 502 Bad Gateway." The on-call engineer captured the failing `curl -v` output before the request stopped reproducing. Now you have to confirm the status, count how widespread the problem was, and pin it to a specific endpoint before you write the incident report.

You start in `/home/dev`. Your job:

1. **Inspect the captured response** at `/var/log/incidents/checkout-502.curl` so you can confirm the status and reason phrase the customer saw.
2. **Surface every access-log entry with that failing status** from `/var/log/nginx/access.log`.
3. **Count how many responses had that status** so the blast radius is explicit in the postmortem.
4. **Identify which endpoint those failures hit** so the impact can be scoped to the right API path.

The grader requires you to use `cat` and `grep`, and your combined output must contain `502 Bad Gateway`, `/api/checkout`, and `upstream`.
