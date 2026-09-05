---
title: "Reload Without a Full Restart"
sectionSlug: how-do-start-stop-enable-restart-and-reload-differ
order: 4
---

The orders backend now listens on port `4000`, while Nginx still forwards requests to port `3000`. Apply only the proxy configuration change using the existing Nginx reload workflow. You start in `/home/dev`.

Your job:

1. Preserve `/etc/nginx/nginx.conf` as `/etc/nginx/nginx.conf.bak`.
2. Change only the proxy destination to `http://127.0.0.1:4000`.
3. Validate the saved configuration, reload Nginx, and inspect its status.

The grader checks the backup, saved and active configuration, validation, reload, and final status inspection. This training environment requires a successful test of the exact saved file before reload; that extra guard is not normal systemctl behavior.
