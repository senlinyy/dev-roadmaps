---
title: "Find the Missing CORS Header"
sectionSlug: headers-that-matter
order: 2
---

The frontend started erroring with "blocked by CORS policy" twenty minutes after the api-prod deploy. Your teammate exported the full response headers from staging (still working) and prod (broken) so you can compare them side-by-side and find which header disappeared.

You start in `/home/dev`. Your job:

1. **Read the prod headers** at `/home/dev/postmortem/api-prod-headers.txt` to see exactly what prod is returning.
2. **Read the staging headers** at `/home/dev/postmortem/api-staging-headers.txt` to see what a working response looks like.
3. **Confirm both endpoints return JSON** by running `grep -i "Content-Type" /home/dev/postmortem/api-prod-headers.txt /home/dev/postmortem/api-staging-headers.txt`.
4. **Spot the missing header** by running `grep -i "Access-Control-Allow-Origin" /home/dev/postmortem/api-prod-headers.txt /home/dev/postmortem/api-staging-headers.txt` — only the staging file should match.

The grader requires you to use `cat` and `grep`, and your combined output must contain `Content-Type: application/json`, `Access-Control-Allow-Origin: https://app.example.com`, and `staging`.
