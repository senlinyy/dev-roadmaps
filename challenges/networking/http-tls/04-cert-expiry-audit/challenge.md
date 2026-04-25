---
title: "Audit a Cert About to Expire"
sectionSlug: certificates-and-the-chain-of-trust
order: 4
---

The cert-monitor cron exported `openssl x509 -text` dumps for every cert in production this morning. Your job is to read the api.prod cert, find the exact expiry date, compare it against the internal CA expiry, and walk the chain of trust so you can file a renewal ticket with the right SAN list.

You start in `/home/dev`. Your job:

1. **Inspect the `api.prod` certificate dump** at `/etc/ssl/audit/api-prod.peminfo`.
2. **Surface the leaf certificate expiry, issuer, and SAN list** so you know what must be renewed.
3. **Compare that expiry with the internal CA dump** at `/etc/ssl/audit/internal-ca.peminfo` to rule out a CA-wide issue.
4. **Surface the SAN entries** that must remain covered by the renewed certificate.
5. **Leave the matching evidence visible in the terminal history** so the renewal ticket has exact values.

The grader requires you to use `cat` and `grep`, and checks that your terminal output includes the leaf expiry `Mar  5 09:14:01 2025 GMT`, the CA expiry `Jan  1 00:00:00 2033 GMT`, and the SAN `DNS:api.example.com`.
