```bash
$ cat /etc/ssl/audit/api-prod.peminfo
$ grep "Not After" /etc/ssl/audit/api-prod.peminfo
$ grep "Not After" /etc/ssl/audit/internal-ca.peminfo
$ grep "Issuer:|Subject:" /etc/ssl/audit/api-prod.peminfo
```

The leaf cert for `api.prod.example.com` (issued by Let's Encrypt R3) expires `Mar 5 2025`, while the internal CA is valid until 2033 — so the renewal ticket only needs to cover the Let's Encrypt leaf with both SANs from the cert dump.
