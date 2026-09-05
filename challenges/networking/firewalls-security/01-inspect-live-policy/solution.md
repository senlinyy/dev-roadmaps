```bash
iptables -L -n -v --line-numbers
iptables -L INPUT -n -v --line-numbers
```

The policy is DROP. Earlier rules permit established traffic, administrative SSH from its management subnet, and HTTPS; the metrics port is explicitly rejected.
