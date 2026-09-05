```bash
curl -v https://api.example.com/orders
```

TLS verifies and the edge proxy returns HTTP 503 with a request ID. The next investigation belongs at the proxy and upstream boundary, not DNS or routing.
