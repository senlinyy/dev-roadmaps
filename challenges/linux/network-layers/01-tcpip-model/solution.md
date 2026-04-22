```bash
$ cat /var/log/network/listeners.snapshot
$ grep "udp/" /var/log/network/listeners.snapshot
$ grep "tcp/443" /var/log/network/listeners.snapshot
$ grep -c "tcp/" /var/log/network/listeners.snapshot
```

`cat` shows the full mapping of services to transport+port. `grep "udp/"` isolates the three datagram services (DNS, NTP, STUN) that intentionally chose UDP for latency over reliability. `grep "tcp/443"` and `grep -c "tcp/"` confirm HTTPS is bound and produce a clean count of TCP-backed services.
