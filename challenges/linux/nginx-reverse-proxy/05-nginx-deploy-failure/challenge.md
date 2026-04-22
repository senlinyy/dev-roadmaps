---
title: "Unblock a Failed Deploy"
sectionSlug: when-nginx-breaks
order: 5
---

The deploy pipeline failed at the `nginx -t` step with `[emerg] unknown directive`. The stderr was captured to a file. Read the validator output to find the offending file and line, open that file, and confirm the typo so you can hand the fix back to the dev who shipped it. While you're there, check the live error log for the user-facing impact.

You start in `/home/dev`. Your job:

1. **Inspect the saved `nginx -t` output** at `/home/dev/postmortem/nginx-t.txt` to find which file and line failed validation.
2. **Open the referenced config file** at `/etc/nginx/sites-available/api.conf` and inspect the bad line in context.
3. **Surface the malformed directive itself** so the typo is undeniable before you hand it back to the dev.
4. **Check the recent access log** and confirm the user-facing impact while that bad config was in the tree.

The grader requires you to use `cat`, `grep`, and `tail`, and your combined output must contain `[emerg]`, `proxy_passs`, `api.conf:14`, and `502`.
