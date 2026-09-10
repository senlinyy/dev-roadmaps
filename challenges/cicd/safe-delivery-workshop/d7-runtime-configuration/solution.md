## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### Dockerfile

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node","dist/server.js"]
```

### ecs/task.json

```json
{
  "family": "orders",
  "networkMode": "awsvpc",
  "requiresCompatibilities": [
    "FARGATE"
  ],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::222222222222:role/orders-execution",
  "taskRoleArn": "arn:aws:iam::222222222222:role/orders-task",
  "containerDefinitions": [
    {
      "name": "orders",
      "image": "222222222222.dkr.ecr.eu-west-1.amazonaws.com/orders@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "stopTimeout": 30,
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "node -e \"fetch('http://localhost:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""
        ],
        "interval": 10,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 30
      },
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "LOG_LEVEL",
          "value": "info"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:eu-west-1:222222222222:secret:orders/database-AbCdEf:database_url::"
        }
      ]
    }
  ]
}
```

### iam/execution-secret-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:eu-west-1:222222222222:secret:orders/database-AbCdEf"
    }
  ]
}
```

## Why this works

Runtime configuration changes independently of image content. ECS uses the execution role to inject secrets at startup; the task role governs application AWS calls. Rotation does not mutate existing process environments. A safe rotation therefore includes replacement and a period during which old and new credentials remain compatible with the database.

## Verification and expected evidence

Rotate any genuinely exposed credential and restrict old image access. Register the new task definition and deploy under the rolling safety policy. After rotating the secret, force replacement of tasks using the same image, check task start times and database operations without printing credentials. A customer-managed KMS key additionally needs scoped decrypt authorization.

## Self-review

- [ ] Dockerfile contains no environment-specific credentials.
- [ ] Task definition refers to the approved secret without embedding its value.
- [ ] Rotation uses task replacement and connection verification without rebuilding.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
