---
title: "Apply Safe Default Deny"
sectionSlug: how-do-you-expose-web-traffic-without-exposing-every-service
order: 3
---

A new HTTPS host still has an ACCEPT-by-default INPUT policy. Preserve established sessions and HTTPS, then close every unintended inbound port without locking out the service.

1. Insert an established and related traffic rule at position 1.
2. Insert an HTTPS allow rule at position 2.
3. Only after both safeguards exist, change the INPUT policy to DROP.
4. Prove HTTPS on `10.30.4.10:443` still connects and admin port `9000` times out.
5. List the final numbered INPUT chain.
