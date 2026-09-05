```bash
ip addr show dev eth0
ip route show
ip route get 192.168.50.40
ip route get 203.0.113.80
```

The connected route covers the cache. No route covers the external address, so the kernel reports it unreachable before a TCP test could begin.
