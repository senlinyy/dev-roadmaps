```bash
dig checkout.example.com A
ip route get 10.90.0.10
ss -lntp sport = :443
iptables -L INPUT -n -v --line-numbers
curl -v https://checkout.example.com/health
```

DNS, routing, and the Nginx listener are present. INPUT defaults to DROP with no HTTPS allow, and the request times out before TLS or HTTP.
