```bash
$ grep "api.example.com" /home/dev/dns-debug/api-fresh.txt
$ grep "api.example.com" /home/dev/dns-debug/api-stale.txt
$ grep "SERVER:" /home/dev/dns-debug/api-fresh.txt
$ grep "SERVER:" /home/dev/dns-debug/api-stale.txt
$ echo "stale 93.184.216.34 fresh 93.184.216.99 mismatch confirmed" > /home/dev/dns-debug/mismatch.txt
$ cat /home/dev/dns-debug/mismatch.txt
```

The fresh response from `1.1.1.1` returns the new IP `93.184.216.99` with a young TTL of 60, meaning the resolver just fetched it from the authoritative server. The stale response from the customer-side resolver (`192.0.2.53`) returns the old IP `93.184.216.34` with a TTL of 2418, meaning it cached the answer roughly 20 minutes ago and will keep serving it until the original 3600-second TTL expires.
