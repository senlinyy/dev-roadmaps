---
title: "Fix a proxy_pass Path Trap"
sectionSlug: how-does-nginx-reverse-proxy-to-an-application
order: 4
---

The upstream expects `/orders`, but Nginx forwards `/api/orders` and receives 502 from the authored backend boundary.

1. Capture the current response for `/api/orders`.
2. Correct `proxy_pass` so the `/api/` location prefix is replaced by `/`.
3. Test and reload Nginx.
4. Prove the request now reaches upstream `/orders`.
