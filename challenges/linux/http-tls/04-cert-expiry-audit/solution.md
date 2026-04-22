```bash
$ cat /home/dev/certs/api-prod.txt
$ grep "Not After" /home/dev/certs/api-prod.txt
$ grep "Not After" /home/dev/certs/internal-ca.txt
$ grep "Issuer:|Subject:" /home/dev/certs/api-prod.txt
```

The leaf cert for `api.prod.example.com` (issued by Let's Encrypt R3) expires `Mar 5 2025`, while the internal CA is valid until 2033 — so the renewal ticket only needs to cover the Let's Encrypt leaf with both SANs from the cert dump.
