```bash
$ cat /etc/ssl/audit/api-prod.peminfo
$ grep "Not After" /etc/ssl/audit/api-prod.peminfo
$ grep "Not After" /etc/ssl/audit/internal-ca.peminfo
$ grep "Issuer:" /etc/ssl/audit/api-prod.peminfo
$ grep "DNS:" /etc/ssl/audit/api-prod.peminfo
```

The Let's Encrypt leaf for `api.prod.example.com` expires in March 2025, while the internal CA remains valid until 2033. That means the renewal work is isolated to the leaf certificate, and the replacement still needs to cover both SANs listed in the current cert.
