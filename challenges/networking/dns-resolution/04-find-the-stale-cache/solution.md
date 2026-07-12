```bash
$ cat /etc/bind/zones/db.example.com.current
$ grep "app.example.com" /etc/bind/zones/db.example.com.current
$ cat /var/log/change/app-cutover.log
$ grep "TTL" /var/log/change/app-cutover.log
$ cat /var/log/dns/cache-survey.log
$ grep "93.184.216.34" /var/log/dns/cache-survey.log | wc -l
2
```

- The zone shows `app.example.com` still carries a TTL of `3600`, which means resolvers worldwide cache its answer for an hour. The runbook shows step 2 (lower the TTL 24 hours ahead) was `SKIPPED`, so the old `3600` is exactly what got cached when the IP changed. The survey confirms two resolvers (`208.67.222.222` and `9.9.9.9`) are still serving the old IP, which lines up with the customer reports of stale behavior.
