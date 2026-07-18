```yaml
services:
  api:
    image: registry.example.com/shipping-api:1.8.0
    ports:
      - "8080:8080"
    user: "10001:10001"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    deploy:
      resources:
        limits:
          cpus: "0.50"
          memory: 512M
```

The service has a fixed non-root identity, no ambient capabilities, a read-only root filesystem, and explicit CPU and memory ceilings.
