```bash
iptables -L INPUT -n -v --line-numbers
ss -lntp
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
nc -vz 10.90.0.10 443
nc -vz 10.90.0.10 9000
iptables -L INPUT -n -v --line-numbers
```

The narrow HTTPS allow restores the intended edge. Default deny continues to filter the internal admin listener.
