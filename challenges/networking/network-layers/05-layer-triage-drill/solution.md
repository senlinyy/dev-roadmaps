```bash
$ cd /var/log/network/layer-checks
$ find . -type f
$ cat 01-ip-link.out 02-ip-neigh.out 03-ip-route.out 04-tcp-connect.out
$ grep "no healthy upstream" 05-gateway.log
```

The bottom layers are healthy: the interface is `LOWER_UP`, the gateway neighbor is `REACHABLE`, and the route points through `10.30.0.1`. TCP also connected to `checkout.internal` on port 443, so Layer 4 is clear. The first real failure is Layer 7: the endpoint returns `HTTP/2 503`, and the gateway log explains why with `no healthy upstream` for the inventory dependency.
