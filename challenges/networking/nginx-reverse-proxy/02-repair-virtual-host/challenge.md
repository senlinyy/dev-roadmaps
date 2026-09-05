---
title: "Repair Virtual-Host Selection"
sectionSlug: how-do-server-and-location-blocks-select-a-request
order: 2
---

`app.example.com` reaches the default server instead of the application proxy after a hostname migration.

1. Capture the current 404 response.
2. Correct the application server name from `old-app.example.com` to `app.example.com`.
3. Test the current saved file, reload Nginx, and inspect service status.
4. Prove the same request now reaches the application upstream.
