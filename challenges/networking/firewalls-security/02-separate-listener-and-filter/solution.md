```bash
ss -lntp sport = :8443
iptables -L INPUT -n -v --line-numbers
nc -vz 10.20.5.10 8443
iptables -L INPUT -n -v --line-numbers
```

The process owns a listener on the interface address. The probe times out, and the DROP rule counter increases.
