```bash
$ grep -c " A " /etc/bind/zones/db.example.com
$ grep "MX" /etc/bind/zones/db.example.com
$ grep "CNAME" /etc/bind/zones/db.example.com
$ grep "v=spf1" /etc/bind/zones/db.example.com
```

`grep -c " A "` counts only the rows whose record type is exactly `A` (the surrounding spaces avoid catching `AAAA` or `CNAME`). The `MX` filter shows that `mail1.example.com` is priority 10 and `mail2.example.com` is priority 20. The `CNAME` filter shows the `www` alias points at `app.example.com`. Grepping `v=spf1` extracts the SPF policy that authorizes `93.184.216.0/24` to send mail for the domain.
