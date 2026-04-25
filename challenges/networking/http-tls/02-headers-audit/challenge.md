---
title: "Find the Missing CORS Header"
sectionSlug: headers-that-matter
order: 2
---

The frontend started erroring with "blocked by CORS policy" twenty minutes after the api-prod deploy. Your teammate exported the full response headers from staging (still working) and prod (broken) so you can compare them side-by-side and find which header disappeared.

You start in `/home/dev`. Your job:

1. **Inspect the prod response headers** at `/var/log/incidents/api-prod.headers`.
2. **Inspect the staging response headers** at `/var/log/incidents/api-staging.headers` so you have a working baseline to compare against.
3. **Compare one shared header family and one traceability header** so you can prove the environments are otherwise similar.
4. **Find the header family that exists in staging but disappeared from prod** so the CORS regression is explicit.
5. **Write `/home/dev/reports/api-header-diff.note`** summarizing the missing prod header and the request IDs you compared.
6. **Print the completed diff note** so the comparison is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note records `prod missing access-control-allow-origin`, `prod x-request-id 7f2c-prod-9911`, and `staging x-request-id 7f2c-staging-4471`.
