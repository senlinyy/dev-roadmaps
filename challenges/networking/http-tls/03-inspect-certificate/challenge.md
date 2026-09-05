---
title: "Inspect Certificate Identity"
sectionSlug: how-does-a-certificate-chain-establish-server-identity
order: 3
---

A certificate-renewal ticket names `shop.example.com`, but the load balancer hosts several domains. Inspect the certificate selected for that exact hostname.

1. Connect to `shop.example.com:443` with SNI set to `shop.example.com`.
2. Retain the subject, issuer, validity interval, SANs, protocol, ALPN, and verification result.
3. Do not bypass trust or hostname verification.
