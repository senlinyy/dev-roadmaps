```bash
$ ls /var/log/incidents/
$ grep -r "NO-CARRIER" /var/log/incidents/
$ grep -r "FAILED" /var/log/incidents/
$ grep -r "Destination Host Unreachable" /var/log/incidents/
$ grep -r "Connection refused" /var/log/incidents/
$ grep -r "certificate has expired" /var/log/incidents/
```

Each `grep -r` prints the file that owns one layer's failure marker: `01-link.log` is Layer 1 (`NO-CARRIER`), `02-arp.log` is Layer 2 (`FAILED` ARP entry), `03-route.log` is Layer 3 (`Destination Host Unreachable`), `04-ports.log` is Layer 4 (`Connection refused` because nothing is listening on 8080), and `05-tls.log` is Layer 7 (the TCP socket succeeded but the TLS cert is expired).
