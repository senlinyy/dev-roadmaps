---
title: "Postmortem a 502 at Checkout"
sectionSlug: status-codes-what-the-server-tells-you-back
order: 1
---

A customer DM'd support: "I clicked Pay and got 502 Bad Gateway." The on-call engineer captured the failing `curl -v` output before the request stopped reproducing. Now you have to confirm the status, count how widespread the problem was, and pin it to a specific endpoint before you write the incident report.

You start in `/home/dev`. Your job:

1. **Read the captured curl output** at `/home/dev/postmortem/checkout-502.txt` to confirm the response status and reason phrase the customer saw.
2. **List every 502 response** in `/var/log/nginx/access.log` by running `grep " 502 " /var/log/nginx/access.log`.
3. **Count just the 502 responses** with `grep -c " 502 " /var/log/nginx/access.log` so you can quote the blast radius in the postmortem.
4. **Confirm which endpoint failed** by running `grep "/api/checkout" /var/log/nginx/access.log` to scope the impact to checkout.

The grader requires you to use `cat` and `grep`, and your combined output must contain `502 Bad Gateway`, `/api/checkout`, and `upstream`.
