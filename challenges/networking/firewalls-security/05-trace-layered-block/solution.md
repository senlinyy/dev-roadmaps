```bash
ip route get 10.55.4.20
ss -lntp sport = :443
iptables -L INPUT -n -v --line-numbers
nc -vz 10.55.4.20 443
iptables -L INPUT -n -v --line-numbers
```

The route and listener exist. The probe increments the explicit HTTPS DROP counter, localizing the failure to host filtering.
