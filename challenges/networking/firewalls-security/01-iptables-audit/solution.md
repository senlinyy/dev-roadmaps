```bash
$ cat /etc/iptables/rules.v4
$ grep "dport 80" /etc/iptables/rules.v4
$ grep ":INPUT" /etc/iptables/rules.v4
$ grep -c "ACCEPT" /etc/iptables/rules.v4
```

`cat` reveals the full ruleset; the offending rule `-A INPUT -p tcp --dport 80 -j DROP` is the reason every port-80 connection silently dies. `grep ":INPUT"` confirms the chain defaults to `DROP`, so the explicit allow rules for ports 22 and 443 are the only inbound ports actually open. The `ACCEPT` count gives a quick sanity check that no allow rule was deleted by mistake.
