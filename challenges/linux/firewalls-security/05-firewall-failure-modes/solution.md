```bash
$ cat /etc/iptables/rules.v4
$ grep -n "dport 80" /etc/iptables/rules.v4
$ grep "203.0.113" /var/log/iptables-recent.log
$ grep "203.0.113.0/24" /etc/iptables/rules.v4
```

The broad `-A INPUT -p tcp --dport 80 -j ACCEPT` sits above the specific `-A INPUT -s 203.0.113.0/24 -p tcp --dport 80 -j DROP`, so the kernel matches and accepts every port-80 packet (including the abusive subnet) before it ever evaluates the DROP rule. The access log confirms `203.0.113.99` and `203.0.113.42` are still hitting nginx. Fix by reordering — move the subnet DROP above the broad ACCEPT, or insert it at position 1 with `iptables -I INPUT 1 -s 203.0.113.0/24 -p tcp --dport 80 -j DROP`.
