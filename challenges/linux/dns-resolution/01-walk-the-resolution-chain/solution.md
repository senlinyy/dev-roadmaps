```bash
$ head -n 20 /var/log/dns/api.example.com.trace
$ grep "NS" /var/log/dns/api.example.com.trace
$ tail -n 10 /var/log/dns/api.example.com.trace
```

`head` shows the root referral (`a.root-servers.net.`). `grep "NS"` collects every delegation line so you can see the chain hop from `.` to `com.` to `example.com.` in one view. `tail` reveals the final A record `api.example.com. 300 IN A 93.184.216.34`, which is the authoritative answer the chain converged on.
