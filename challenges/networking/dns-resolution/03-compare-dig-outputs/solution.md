```bash
$ grep "api.example.com" /var/log/dns/api.example.com.fresh
$ grep "api.example.com" /var/log/dns/api.example.com.stale
$ grep "SERVER:" /var/log/dns/api.example.com.fresh
$ grep "SERVER:" /var/log/dns/api.example.com.stale
$ echo "fresh 1.1.1.1 -> 93.184.216.99" > /home/dev/reports/dns-mismatch.note
$ echo "stale 192.0.2.53 -> 93.184.216.34" >> /home/dev/reports/dns-mismatch.note
$ cat /home/dev/reports/dns-mismatch.note
```

The fresh response from `1.1.1.1` returns the new IP `93.184.216.99`, while the stale response from `192.0.2.53` still serves the old IP `93.184.216.34`. Writing the mismatch note makes that resolver-to-answer mapping explicit.
