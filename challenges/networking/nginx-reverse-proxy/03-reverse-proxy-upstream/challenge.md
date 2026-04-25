---
title: "Fix a proxy_pass Path Prefix Bug"
sectionSlug: reverse-proxy-forwarding-to-your-app
order: 3
---

The backend app only exposes routes like `/users` and `/orders`, but requests coming through Nginx to `/api/users` are still returning 404. You need to inspect the reverse-proxy config, compare it to the backend's route manifest, and write the remediation note for the `proxy_pass` path handling bug.

You start in `/home/dev`. Your job:

1. **Inspect the API site config** at `/etc/nginx/sites-available/api.conf` so you can see how `/api/` is proxied.
2. **Inspect the backend route manifest** so you can see which paths the app actually serves.
3. **Inspect the failed request capture** at `/var/log/incidents/api-prefix-404.curl` so you can see which path the backend received.
4. **Write `/home/dev/reports/proxy-pass-fix.note`** with the corrected `proxy_pass` line that strips the `/api/` prefix before forwarding.
5. **Print the remediation note** so the fix is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note records `proxy_pass http://127.0.0.1:3000/`, `/api/users`, and `/users`.
