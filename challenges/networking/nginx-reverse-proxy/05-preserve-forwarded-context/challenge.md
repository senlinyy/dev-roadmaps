---
title: "Preserve Forwarded Request Context"
sectionSlug: how-does-nginx-reverse-proxy-to-an-application
order: 5
---

The application rejects requests because Nginx replaces the original host and scheme with fixed values.

1. Capture the current 502 response.
2. Change the Host header value to `$host` and X-Forwarded-Proto to `$scheme`.
3. Test and reload the configuration.
4. Prove the backend now accepts the forwarded request context.
