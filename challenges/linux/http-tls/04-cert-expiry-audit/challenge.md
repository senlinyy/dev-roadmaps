---
title: "Audit a Cert About to Expire"
sectionSlug: certificates-and-the-chain-of-trust
order: 4
---

The cert-monitor cron exported `openssl x509 -text` dumps for every cert in production this morning. Your job is to read the api.prod cert, find the exact expiry date, compare it against the internal CA expiry, and walk the chain of trust so you can file a renewal ticket with the right SAN list.

You start in `/home/dev`. Your job:

1. **Inspect the `api.prod` certificate dump** at `/home/dev/certs/api-prod.txt`.
2. **Surface the validity window** so you can quote the exact expiry in the renewal ticket.
3. **Compare that expiry with the internal CA dump** at `/home/dev/certs/internal-ca.txt` to rule out a CA-wide issue.
4. **Surface the issuer and subject information** so the renewal ticket includes the relevant chain-of-trust details.

The grader requires you to use `cat` and `grep`, and your combined output must contain `Not After`, `api.prod.example.com`, `Let's Encrypt`, and `Issuer:`.
