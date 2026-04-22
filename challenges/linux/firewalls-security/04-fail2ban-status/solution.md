```bash
$ fail2ban-client status sshd
$ grep "203.0.113.42" /var/log/auth.log
$ cat /etc/fail2ban/jail.local
```

The status output names the two currently-banned IPs (`203.0.113.42` and `198.51.100.7`); grepping the first IP out of `auth.log` shows three `Failed password` lines in a few seconds, exactly the pattern the `[sshd]` jail watches for. `jail.local` confirms the thresholds: `maxretry = 3` failures within `findtime = 600` seconds triggers a `bantime = 3600`-second iptables drop.
