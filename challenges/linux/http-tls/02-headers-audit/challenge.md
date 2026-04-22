---
title: "Find the Missing CORS Header"
sectionSlug: headers-that-matter
order: 2
---

The frontend started erroring with "blocked by CORS policy" twenty minutes after the api-prod deploy. Your teammate exported the full response headers from staging (still working) and prod (broken) so you can compare them side-by-side and find which header disappeared.

You start in `/home/dev`. Your job:

1. **Inspect the prod response headers** at `/var/log/incidents/api-prod.headers`.
2. **Inspect the staging response headers** at `/var/log/incidents/api-staging.headers` so you have a working baseline to compare against.
3. **Confirm both environments still return JSON** before you focus on the browser-facing difference.
4. **Find the header that exists in staging but disappeared from prod** so the CORS regression is explicit.

The grader requires you to use `cat` and `grep`, and your combined output must contain `Content-Type: application/json`, `Access-Control-Allow-Origin: https://app.example.com`, and `staging`.
