---
title: "Trace a Static 404"
sectionSlug: serving-static-files
order: 2
---

Marketing flagged that `https://legacy.example.com/about.html` is returning 404 even though it "definitely shipped." You need to confirm where nginx is rooted, list what's actually in that webroot, prove the file is missing on disk, and then point at the exact 404 line in the access log.

You start in `/home/dev`. Your job:

1. **Read the legacy site config** at `/etc/nginx/sites-available/legacy.conf` to find the `root` and `index` directives.
2. **List the webroot** with `ls /var/www/legacy/` so you can see which files are actually being served.
3. **Confirm `about.html` is not on disk** by running `find /var/www/legacy -name "about.html"` (no output = no file).
4. **Prove the 404** by running `grep " 404 " /var/log/nginx/access.log` to find the matching access-log line for `/about.html`.

The grader requires you to use `cat`, `ls`, `find`, and `grep`, and your combined output must contain `root /var/www/legacy`, `index.html`, `/about.html`, and ` 404 `.
