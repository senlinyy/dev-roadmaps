```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY src/ ./src/
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node"]
CMD ["src/server.js"]
```

The entrypoint fixes the executable while CMD remains replaceable. Exec form avoids an intermediate shell that can interfere with signal delivery.
