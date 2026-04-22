---
title: "Audit a Cert About to Expire"
sectionSlug: certificates-and-the-chain-of-trust
order: 4
---

The cert-monitor cron exported `openssl x509 -text` dumps for every cert in production this morning. Your job is to read the api.prod cert, find the exact expiry date, compare it against the internal CA expiry, and walk the chain of trust so you can file a renewal ticket with the right SAN list.

You start in `/home/dev`. Your job:

1. **Read the api.prod cert dump** at `/home/dev/certs/api-prod.txt`.
2. **Pull just the validity window** by running `grep "Not After" /home/dev/certs/api-prod.txt` so you can quote the expiry in the renewal ticket.
3. **Compare with the internal CA** by running `grep "Not After" /home/dev/certs/internal-ca.txt` to confirm the CA itself is not the problem.
4. **Walk the chain** by running `grep "Issuer:|Subject:" /home/dev/certs/api-prod.txt` to record who signed the leaf and who it was issued to.

The grader requires you to use `cat` and `grep`, and your combined output must contain `Not After`, `api.prod.example.com`, `Let's Encrypt`, and `Issuer:`.
