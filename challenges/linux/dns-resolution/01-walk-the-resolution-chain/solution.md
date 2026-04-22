```bash
$ head -n 20 /home/dev/dns-debug/api-trace.txt
$ grep "NS" /home/dev/dns-debug/api-trace.txt
$ tail -n 10 /home/dev/dns-debug/api-trace.txt
```

`head` shows the root referral (`a.root-servers.net.`). `grep "NS"` collects every delegation line so you can see the chain hop from `.` to `com.` to `example.com.` in one view. `tail` reveals the final A record `api.example.com. 300 IN A 93.184.216.34`, which is the authoritative answer the chain converged on.
