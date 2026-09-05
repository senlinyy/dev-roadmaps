```bash
curl -I https://cdn.example.com/manifest.json
curl -I -H 'If-None-Match: "release-42"' https://cdn.example.com/manifest.json
```

The first response supplies the ETag. The matching conditional request returns 304, so the client can reuse its cached representation.
