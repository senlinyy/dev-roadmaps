```bash
$ cat /etc/resolv.conf
$ cat /var/log/dns/resolved-forwarder.log
$ grep "ns1.example.com" /var/log/dns/api.example.com.trace
$ grep "api.example.com." /var/log/dns/api.example.com.trace
$ echo "stub 127.0.0.53" > /home/dev/reports/api-resolution-chain.note
$ echo "recursive 1.1.1.1" >> /home/dev/reports/api-resolution-chain.note
$ echo "authoritative ns1.example.com" >> /home/dev/reports/api-resolution-chain.note
$ echo "answer 93.184.216.34" >> /home/dev/reports/api-resolution-chain.note
$ cat /home/dev/reports/api-resolution-chain.note
```

This step mirrors the real resolution chain: the laptop talks to a local stub (`127.0.0.53`), that stub forwards to a recursive resolver (`1.1.1.1`), and the recursive walk eventually reaches the authoritative nameserver `ns1.example.com`, which returns `93.184.216.34`.
