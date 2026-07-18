```yaml
services:
  web:
    image: registry.example.com/notes-web:3.0.0
    ports:
      - "8080:80"
    networks:
      - public
      - backend
  api:
    image: registry.example.com/notes-api:3.0.0
    networks:
      - backend
    volumes:
      - ./config/api.yaml:/etc/notes/api.yaml:ro
  db:
    image: postgres:17-alpine
    networks:
      - backend
    volumes:
      - postgres-data:/var/lib/postgresql/data

networks:
  public:
  backend:

volumes:
  postgres-data:
```

Only web receives host traffic. API configuration is immutable at runtime, and PostgreSQL data survives container replacement.
