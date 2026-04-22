```bash
$ grep -c " A " /home/dev/dns-debug/example-zone.txt
$ grep "MX" /home/dev/dns-debug/example-zone.txt
$ grep "CNAME" /home/dev/dns-debug/example-zone.txt
$ grep "v=spf1" /home/dev/dns-debug/example-zone.txt
```

`grep -c " A "` counts only the rows whose record type is exactly `A` (the surrounding spaces avoid catching `AAAA` or `CNAME`). The `MX` filter shows that `mail1.example.com` is priority 10 and `mail2.example.com` is priority 20. The `CNAME` filter shows the `www` alias points at `app.example.com`. Grepping `v=spf1` extracts the SPF policy that authorizes `93.184.216.0/24` to send mail for the domain.
