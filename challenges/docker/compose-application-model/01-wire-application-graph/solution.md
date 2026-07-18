```yaml
services:
  api:
    image: registry.example.com/catalog-api:2.1.0
    environment:
      DB_HOST: db
    networks:
      - backend
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:17-alpine
    networks:
      - backend
    volumes:
      - postgres-data:/var/lib/postgresql/data

networks:
  backend: {}

volumes:
  postgres-data: {}
```

The service name supplies stable internal discovery, while the named volume gives database files a lifecycle independent of the container.
