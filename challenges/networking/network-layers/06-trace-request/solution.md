```bash
dig +short app.example.com
ip route get 203.0.113.25
nc -vz app.example.com 443
curl -v -I https://app.example.com/health
```

HTTP 503 follows successful TCP and TLS. curl exits successfully by default for HTTP error statuses; that does not mean the service is healthy.
