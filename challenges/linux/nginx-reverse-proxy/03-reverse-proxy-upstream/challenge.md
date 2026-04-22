---
title: "Find the Broken Upstream"
sectionSlug: reverse-proxy-forwarding-to-your-app
order: 3
---

`/api/v2/users` started returning 502 right after the v2 service rolled out. `/api/v1/users` is fine. You need to read the nginx site, list every `proxy_pass` upstream defined, then compare the v1 (working) and v2 (broken) curl captures to confirm which port is unreachable.

You start in `/home/dev`. Your job:

1. **Read the api site config** at `/etc/nginx/sites-available/api.conf` to see both `location` blocks side-by-side.
2. **List every upstream** by running `grep "proxy_pass" /etc/nginx/sites-available/api.conf`.
3. **Compare the captures** at `/home/dev/postmortem/v1-200.txt` and `/home/dev/postmortem/v2-502.txt` to see the working vs broken response.
4. **Confirm which port is dead** by reading `/home/dev/postmortem/port-check.txt`, the saved output of the operator's `ss -tlnp` check.

The grader requires you to use `cat` and `grep`, and your combined output must contain `proxy_pass http://127.0.0.1:3000`, `proxy_pass http://127.0.0.1:3001`, `502 Bad Gateway`, and `LISTEN`.
