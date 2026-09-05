```bash
openssl s_client -connect shop.example.com:443 -servername shop.example.com -showcerts
```

The SAN covers both the apex shop name and its `www` alias, and verification succeeds against the authored training CA.
