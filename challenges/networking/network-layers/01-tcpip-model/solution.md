```bash
$ cat /var/log/network/listeners.snapshot
$ grep "tcp/443" /var/log/network/listeners.snapshot
$ cat /var/log/network/edge01-egress.snapshot
$ grep "inet 10.24.8.14" /var/log/network/edge01-egress.snapshot
$ grep "default via" /var/log/network/edge01-egress.snapshot
$ grep "link/ether" /var/log/network/edge01-egress.snapshot
$ echo "Application HTTPS" > /home/dev/reports/https-stack.note
$ echo "Transport tcp/443" >> /home/dev/reports/https-stack.note
$ echo "Internet 10.24.8.14 via 10.24.0.1" >> /home/dev/reports/https-stack.note
$ echo "NetworkAccess eth0 52:54:00:24:08:14" >> /home/dev/reports/https-stack.note
$ cat /home/dev/reports/https-stack.note
```

The listener snapshot proves the application and transport layers (`HTTPS` over `tcp/443`). The interface snapshot adds the Internet-layer address and default gateway plus the network-access interface/MAC, which is the full TCP/IP stack for this service.
