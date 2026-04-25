```bash
$ cd /var/log/network
$ grep "10.0.5.7" lb-handshake.capture
$ grep "10.0.0.5.52314" lb-handshake.capture
$ grep "10.0.5.7" lb-handshake.capture | wc -l
```

The first grep shows four SYNs from `10.0.5.7.51000` to port 80 with no `Flags [S.]` reply, Layer 4 black hole, almost certainly a firewall silently dropping inbound 80. The second grep shows the full SYN / SYN-ACK / ACK handshake plus the `GET /api/users` payload from `10.0.0.5`, proving the LB itself is healthy. `wc -l` quantifies the retransmit count for the postmortem.
