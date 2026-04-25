---
title: "Fix a SPA Deep-Link 404"
sectionSlug: serving-static-files
order: 2
---

The docs SPA loads fine at `/`, but deep links like `https://docs.example.com/guides/getting-started` return 404 after the latest Nginx rollout. You need to inspect the serving config, confirm the SPA shell exists on disk, and write the remediation note for the `try_files` fallback the site actually needs.

You start in `/home/dev`. Your job:

1. **Inspect the docs site config** at `/etc/nginx/sites-available/docs.conf` to find the `root` and `try_files` directives.
2. **Inspect the webroot contents** under `/var/www/docs/` so you can confirm the SPA shell is present.
3. **Surface the access-log evidence** for the failing deep link `/guides/getting-started`.
4. **Write `/home/dev/reports/docs-spa-fix.note`** with the corrected `try_files` line that would serve the SPA shell on deep links.
5. **Print the remediation note** so the fix is visible in the terminal history.

The grader requires you to use `cat`, `ls`, `grep`, and `echo`, and checks that your note records `docs.example.com`, `/guides/getting-started`, and `try_files $uri $uri/ /index.html`.
