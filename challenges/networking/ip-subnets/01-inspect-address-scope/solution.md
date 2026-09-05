```bash
ip addr show dev lo
ip addr show dev eth0
```

Loopback addresses stay on the host. The `fe80::/10` address is link-local, while the documentation prefix on `eth0` is shown with global scope.
