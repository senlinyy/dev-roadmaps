```yaml
services:
  api:
    image: registry.example.com/payments-api:4.2.0
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
```

The health check proves PostgreSQL can accept connections. The dependency prevents premature API startup, while restart policies handle unexpected process exits.
