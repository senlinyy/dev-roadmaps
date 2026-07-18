### Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
USER node
CMD ["npm", "start"]
```

### .dockerignore

```text
node_modules
.git
.env
coverage
```

Copying manifests first preserves the dependency layer when only source changes. The ignore file keeps local state and secrets outside the build context.
