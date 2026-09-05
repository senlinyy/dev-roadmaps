```bash
sudo iptables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -I INPUT 2 -p tcp --dport 443 -j ACCEPT
sudo iptables -P INPUT DROP
nc -vz 10.30.4.10 443
nc -vz 10.30.4.10 9000
iptables -L INPUT -n -v --line-numbers
```

The allows are installed before default deny. HTTPS remains reachable, while the unlisted admin port is silently dropped.
