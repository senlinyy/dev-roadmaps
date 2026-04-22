---
title: "Unblock a Failed Deploy"
sectionSlug: when-nginx-breaks
order: 5
---

The deploy pipeline failed at the `nginx -t` step with `[emerg] unknown directive`. The stderr was captured to a file. Read the validator output to find the offending file and line, open that file, and confirm the typo so you can hand the fix back to the dev who shipped it. While you're there, check the live error log for the user-facing impact.

You start in `/home/dev`. Your job:

1. **Read the saved `nginx -t` output** at `/home/dev/postmortem/nginx-t.txt` to find which file and line failed validation.
2. **Open that file** at `/etc/nginx/sites-available/api.conf` to see the bad directive in context.
3. **Confirm the typo** by running `grep -n "proxy_passs" /etc/nginx/sites-available/api.conf` (three s's — that's the bug).
4. **Check user-facing impact** by running `tail -n 3 /var/log/nginx/access.log` to see the 502s users were getting on `/api/v2/users` while the bad config sat in the tree.

The grader requires you to use `cat`, `grep`, and `tail`, and your combined output must contain `[emerg]`, `proxy_passs`, `api.conf:14`, and `502`.
