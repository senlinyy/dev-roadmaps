```bash
curl -v https://expired.example.com/health
curl -v https://wrong-name.example.com/health
curl -v https://untrusted.example.com/health
```

All three complete TCP connection but stop during TLS verification for different reasons. No HTTP response is available yet.
