---
title: "Trace a Static 404"
sectionSlug: serving-static-files
order: 2
---

Marketing flagged that `https://legacy.example.com/about.html` is returning 404 even though it "definitely shipped." You need to confirm where nginx is rooted, list what's actually in that webroot, prove the file is missing on disk, and then point at the exact 404 line in the access log.

You start in `/home/dev`. Your job:

1. **Inspect the legacy site config** at `/etc/nginx/sites-available/legacy.conf` to find the `root` and `index` directives.
2. **Inspect the webroot contents** under `/var/www/legacy/` so you can see what nginx can actually serve.
3. **Verify whether `about.html` exists anywhere under that webroot**.
4. **Surface the matching 404 evidence from `/var/log/nginx/access.log`** for the failing `/about.html` request.

The grader requires you to use `cat`, `ls`, `find`, and `grep`, and your combined output must contain `root /var/www/legacy`, `index.html`, `/about.html`, and ` 404 `.
