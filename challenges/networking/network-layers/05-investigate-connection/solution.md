```bash
nc -vz 203.0.113.25 443
nc -vz 203.0.113.25 8443
ss -nt
sudo tcpdump -i eth0 -n host 203.0.113.25 and port 443 -c 4
sudo tcpdump -i eth0 -n host 203.0.113.25 and port 8443 -c 3
```

The legacy probe exits unsuccessfully. Unanswered SYNs do not distinguish filtering, endpoint failure, or a missing return path. The working capture does not expose decrypted HTTPS content.
