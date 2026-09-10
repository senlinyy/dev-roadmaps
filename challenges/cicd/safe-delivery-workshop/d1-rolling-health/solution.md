## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### src/server.js

```javascript
import http from 'node:http';
const port = Number(process.env.PORT || 3000);
let ready = true;
const server = http.createServer((req, res) => {
  if (req.url === '/ready') {
    res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : 'draining');
  } else if (req.url === '/version') {
    res.end(process.env.RELEASE_ID || 'development');
  } else if (req.url === '/orders') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({orders: []}));
  } else {
    res.writeHead(404).end();
  }
});
server.listen(port, '0.0.0.0');
process.on('SIGTERM', () => {
  ready = false;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 25000).unref();
});
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
      }
    }
  ]
}
```

### ecs/update.json

```json
{
  "cluster": "orders",
  "service": "orders",
  "healthCheckGracePeriodSeconds": 45,
  "deploymentConfiguration": {
    "strategy": "ROLLING",
    "maximumPercent": 200,
    "minimumHealthyPercent": 100,
    "deploymentCircuitBreaker": {
      "enable": true,
      "rollback": true
    }
  }
}
```

### alb/attributes.json

```json
[{"Key":"deregistration_delay.timeout_seconds","Value":"25"}]
```

## Why this works

Readiness removes an instance from traffic selection; graceful shutdown lets existing work finish. The application drains for at most 25 seconds and ECS allows 30 seconds before forced termination. ALB draining is separately bounded. A 100/200 rolling budget preserves desired healthy capacity while allowing replacement tasks, provided quotas and capacity can satisfy it. Health grace periods delay failure handling during startup, but must not make readiness always succeed.

## Verification and expected evidence

In the sandbox register ecs/task.json, update the service with the resulting ARN plus ecs/update.json, configure the target group's health-check path to /ready and apply alb/attributes.json with modify-target-group-attributes. Verify actual account capacity before rollout. Send bounded long-running requests in a workload-enabled build and replace tasks; check resets, healthy capacity and rollback for an unhealthy candidate. The minimal supplied HTTP fixture does not itself generate 20-second requests.

## Self-review

- [ ] Healthy capacity stays at the desired count while replacements start.
- [ ] The application stops accepting new requests and allows bounded in-flight work to finish.
- [ ] ALB drain, ECS stopTimeout and application timeout are coherent; unhealthy candidates trigger rollback.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)
- [Official reference 2](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html)
