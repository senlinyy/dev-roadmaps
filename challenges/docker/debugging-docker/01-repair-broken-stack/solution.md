```yaml
services:
  api:
    image: registry.example.com/orders-api:5.0.0
    ports:
      - "8080:8080"
    environment:
      DB_HOST: db
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:17-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
```

The API now uses Compose DNS, and PostgreSQL stays private to the application network. Healthy dependency evidence prevents the original startup race.
