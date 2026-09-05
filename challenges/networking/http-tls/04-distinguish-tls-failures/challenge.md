---
title: "Distinguish TLS Verification Failures"
sectionSlug: how-do-you-diagnose-http-and-tls-failure-modes
order: 4
---

Three release endpoints fail before any HTTP status appears. Test each endpoint and preserve the distinct verification failure.

1. Request `https://expired.example.com/health`.
2. Request `https://wrong-name.example.com/health`.
3. Request `https://untrusted.example.com/health`.
4. Do not disable verification or change DNS.
