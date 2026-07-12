```bash
$ grep " IN      A " /etc/bind/zones/db.example.com | wc -l
$ grep "MX" /etc/bind/zones/db.example.com
$ grep "CNAME" /etc/bind/zones/db.example.com
$ grep "v=spf1" /etc/bind/zones/db.example.com
$ cat /var/log/dns/provider-import-check.log
$ grep "WARN" /var/log/dns/provider-import-check.log
$ grep "ERROR" /var/log/dns/provider-import-check.log
```

- The address-record count should be three when you filter on the exact `A` field and pipe to `wc -l`; this avoids counting the `AAAA` row. The `MX` filter shows that `mail1.example.com` is priority 10 and `mail2.example.com` is priority 20. The `CNAME` filter shows the `www` alias points at `app.example.com`, while `v=spf1` captures the SPF policy. The provider dry-run adds migration risk evidence: one external CNAME needs owner verification, and one TXT record is missing from the import manifest.
