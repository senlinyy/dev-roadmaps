```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist/
USER node
CMD ["node", "dist/server.js"]
```

The cache mount speeds repeated installs without becoming an image layer. The runtime stage contains only the compiled application.
