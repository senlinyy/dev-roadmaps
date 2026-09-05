---
title: "Repair the Proxy Boundary"
order: 3
---

HTTPS now reaches Nginx, but checkout returns 502 because the upstream rejects fixed Host and scheme values. Repair only the proxy context and deploy it safely.

1. Capture the current 502 response.
2. Forward the request host with `$host` and scheme with `$scheme`.
3. Test the saved Nginx file before reload.
4. Reload Nginx.
5. Prove the same HTTPS health request returns 200 with upstream identity.
