---
title: "Unblock a Failed Deploy"
sectionSlug: when-nginx-breaks
order: 5
---

The deploy pipeline failed at the `nginx -t` step with `[emerg] unknown directive`, so this config never went live. The stderr was captured to a file. Read the validator output to find the offending file and line, open that file, and write the exact fix the developer needs to apply before the deploy can be retried.

You start in `/home/dev`. Your job:

1. **Inspect the saved `nginx -t` output** at `/var/log/nginx/nginx-t.err` to find which file and line failed validation.
2. **Open the referenced config file** at `/etc/nginx/sites-available/api.conf` and inspect the bad line in context.
3. **Write `/home/dev/reports/nginx-deploy-fix.note`** naming the bad file/line and the corrected directive.
4. **Print the remediation note** so the deploy fix is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note records `api.conf:14`, `proxy_passs`, and the corrected line `proxy_pass http://127.0.0.1:3001;`.
