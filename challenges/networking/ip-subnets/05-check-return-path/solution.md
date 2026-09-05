```bash
ip addr show
ip route show
ip route get 10.60.8.44
ip route get 10.70.8.44
```

The working office has a return route through `eth1`. The failing office has no matching route, so the API cannot select a reply path.
