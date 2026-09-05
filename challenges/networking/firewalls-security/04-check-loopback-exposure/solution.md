```bash
ss -lntp sport = :9100
iptables -L INPUT -n -v --line-numbers
nc -vz 127.0.0.1 9100
nc -vz 10.40.2.10 9100
```

INPUT accepts traffic, but the process is bound only to loopback. An extra firewall allow rule would not create an interface listener.
