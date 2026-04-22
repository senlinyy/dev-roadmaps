```bash
$ grep "api.example.com" /var/log/dns/api.example.com.fresh
$ grep "api.example.com" /var/log/dns/api.example.com.stale
$ grep "SERVER:" /var/log/dns/api.example.com.fresh
$ grep "SERVER:" /var/log/dns/api.example.com.stale
$ echo "stale 93.184.216.34 fresh 93.184.216.99 mismatch confirmed" > /home/dev/reports/dns-mismatch.note
$ cat /home/dev/reports/dns-mismatch.note
```

The fresh response from `1.1.1.1` returns the new IP `93.184.216.99` with a young TTL of 60, meaning the resolver just fetched it from the authoritative server. The stale response from the customer-side resolver (`192.0.2.53`) returns the old IP `93.184.216.34` with a TTL of 2418, meaning it cached the answer roughly 20 minutes ago and will keep serving it until the original 3600-second TTL expires.
