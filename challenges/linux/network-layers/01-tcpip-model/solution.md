```bash
$ cat /home/dev/audit/service-inventory.txt
$ grep "udp/" /home/dev/audit/service-inventory.txt
$ grep "tcp/443" /home/dev/audit/service-inventory.txt
$ grep -c "tcp/" /home/dev/audit/service-inventory.txt
```

`cat` shows the full mapping of services to transport+port. `grep "udp/"` isolates the three datagram services (DNS, NTP, STUN) that intentionally chose UDP for latency over reliability. `grep "tcp/443"` and `grep -c "tcp/"` confirm HTTPS is bound and produce a clean count of TCP-backed services.
