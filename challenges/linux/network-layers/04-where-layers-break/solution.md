```bash
$ ls /home/dev/postmortem/
$ grep -r "NO-CARRIER" /home/dev/postmortem/
$ grep -r "FAILED" /home/dev/postmortem/
$ grep -r "Destination Host Unreachable" /home/dev/postmortem/
$ grep -r "Connection refused" /home/dev/postmortem/
$ grep -r "certificate has expired" /home/dev/postmortem/
```

Each `grep -r` prints the file that owns one layer's failure marker: `01-link.txt` is Layer 1 (`NO-CARRIER`), `02-arp.txt` is Layer 2 (`FAILED` ARP entry), `03-route.txt` is Layer 3 (`Destination Host Unreachable`), `04-ports.txt` is Layer 4 (`Connection refused` because nothing is listening on 8080), and `05-tls.txt` is Layer 7 (the TCP socket succeeded but the TLS cert is expired).
