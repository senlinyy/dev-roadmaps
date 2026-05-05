---
title: "Runtime Configuration and Health Checks"
description: "Start deployed application code safely with runtime configuration, secret injection, logs, startup checks, and health checks."
overview: "A deployed service is not ready just because ECS started a task. Learn how runtime configuration, logs, readiness, liveness, and ALB health checks work together before traffic should trust the app."
tags: ["ecs", "health-checks", "cloudwatch", "configuration"]
order: 6
id: article-cloud-providers-aws-compute-application-hosting-runtime-configuration-health-checks
---

## Table of Contents

1. [The Gap Between Deployed And Trusted](#the-gap-between-deployed-and-trusted)
2. [Runtime Configuration: Same Image, Different Settings](#runtime-configuration-same-image-different-settings)
3. [Secret Injection And IAM: Access Before Startup](#secret-injection-and-iam-access-before-startup)
4. [Logs: The First Proof Of Runtime Truth](#logs-the-first-proof-of-runtime-truth)
5. [Startup Checks, Readiness, And Liveness](#startup-checks-readiness-and-liveness)
6. [The Health Endpoint Contract](#the-health-endpoint-contract)
7. [ALB Target Health In Practice](#alb-target-health-in-practice)
8. [Failure Modes And Diagnosis](#failure-modes-and-diagnosis)
9. [Tradeoffs And A Shipping Checklist](#tradeoffs-and-a-shipping-checklist)

## The Gap Between Deployed And Trusted

A deployment tool can put new code in the right place, but that does not mean the code is ready for users.

The container image might exist in Amazon ECR.
The ECS service might launch a new Fargate task.
The task might show `RUNNING`.
Those facts are useful, but they only prove that AWS started something.
They do not prove that the application has the configuration, permissions, network access, logs, and dependencies it needs to serve real traffic.

Runtime configuration is the set of values and permissions that are attached to the app when it starts.
That includes environment variables, secret references, IAM roles, port settings, log settings, and startup behavior.
The same image can run in staging or production because the runtime provides different values around it.
Think of the image as the app package and the runtime configuration as the room it wakes up in.

Health checks are the tests that decide whether the running process should be trusted.
A health check is usually a small request, such as `GET /health`, that asks the app, "Can you receive traffic now?"
On ECS with an Application Load Balancer, usually shortened to ALB, the ALB uses this answer to decide whether a task target should receive customer requests.

Our running example is `devpolaris-orders-api`.
It is a Node.js backend that handles order creation for DevPolaris.
It runs as an ECS service on Fargate behind an ALB.
The public URL is `https://orders.devpolaris.com`.
The container listens on port `3000`.
The ALB checks `GET /health` before it forwards real order traffic.

This article answers this question:

> What must be true after the code is deployed, but before traffic should trust it?

For `devpolaris-orders-api`, the first answer looks like this:

| Runtime Trust Check | What Good Looks Like |
|---------------------|----------------------|
| Image exists | `devpolaris-orders-api:2026-05-02-1` is available |
| Runtime config exists | `NODE_ENV`, `PORT`, and `ORDER_TIMEOUT_MS` are set |
| Secrets are injected | `DATABASE_URL` and `STRIPE_WEBHOOK_SECRET` are present |
| Permissions work | ECS can read startup secrets and the app can call needed AWS APIs |
| Logs are visible | CloudWatch log group `/ecs/devpolaris-orders-api` receives events |
| Health proves readiness | `GET /health` returns `200` only when the API can handle orders |
| ALB trusts the target | Target health is healthy for `10.0.42.18:3000` |

Notice what is not on the list.
There is no "the container started, therefore ship it."
Starting is only the beginning.
A production service earns traffic by proving the right runtime facts.

Here is the big picture:

```mermaid
flowchart TD
    IMAGE["Packaged app<br/>(container image)"] --> TASK["Running container<br/>(ECS task on Fargate)"]
    TASK --> APP["Running backend<br/>(Node.js process)"]
    APP --> LOGS["Runtime evidence<br/>(CloudWatch Logs)"]
    CUSTOMER["Allowed customer traffic<br/>(after target is healthy)"] --> ALB["Traffic gate<br/>(Application Load Balancer)"]
    ALB --> HEALTH["Readiness check<br/>(GET /health)"]
    HEALTH --> APP
    SUPPORT["Runtime inputs and permissions<br/>(config, secrets, roles)"] -.-> TASK
```

The dotted line is not customer traffic.
It is the runtime support system around the app.
When a deployment fails, one of those support lines is often the real problem.

## Runtime Configuration: Same Image, Different Settings

The safest first mental model is this:
the image should be boring, and the runtime should choose the environment.

Your container image should contain the Node.js code, production dependencies, and the command that starts the server.
It should not contain the production database password, a copied `.env` file, or one hardcoded public URL that only works in one environment.
If the image contains those values, you have to rebuild the image every time a setting changes.
You also make it easier to leak a private value through the image registry.

Runtime configuration solves that problem.
ECS starts the same image with different values depending on the service environment.
Staging can use the staging database.
Production can use the production database.
The app code still reads `process.env.DATABASE_URL`.
The difference is where the value comes from.

Split runtime values into two groups.
Non-secret config is safe to show to teammates and logs when needed.
Secret config gives access, proves identity, signs data, or lets another system trust the app.
Both are runtime configuration, but they should not be stored or logged the same way.

For `devpolaris-orders-api`, a first split looks like this:

| Runtime Value | Secret? | Why The App Needs It |
|---------------|---------|----------------------|
| `NODE_ENV=production` | No | Enables production behavior in the Node.js app |
| `PORT=3000` | No | Tells the HTTP server where to listen |
| `ORDER_TIMEOUT_MS=2500` | No | Keeps outbound order work from hanging forever |
| `PUBLIC_BASE_URL=https://orders.devpolaris.com` | No | Lets generated links point at the right host |
| `DATABASE_URL` | Yes | Contains database access details |
| `STRIPE_WEBHOOK_SECRET` | Yes | Lets the app verify payment webhooks |

The non-secret values can live directly in the ECS task definition.
The secret values should be referenced from Secrets Manager or Systems Manager Parameter Store.
This keeps the task definition useful without making it a secret document.

Here is a small task definition snippet.
It is not the full task definition.
It only shows the runtime fields that matter for this article.

```json
{
  "family": "devpolaris-orders-api",
  "executionRoleArn": "arn:aws:iam::111122223333:role/devpolaris-orders-ecs-execution",
  "taskRoleArn": "arn:aws:iam::111122223333:role/devpolaris-orders-task",
  "containerDefinitions": [
    {
      "name": "orders-api",
      "image": "111122223333.dkr.ecr.us-east-1.amazonaws.com/devpolaris-orders-api:2026-05-02-1",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "3000"
        },
        {
          "name": "ORDER_TIMEOUT_MS",
          "value": "2500"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-a1b2c3"
        },
        {
          "name": "STRIPE_WEBHOOK_SECRET",
          "valueFrom": "arn:aws:ssm:us-east-1:111122223333:parameter/prod/orders/STRIPE_WEBHOOK_SECRET"
        }
      ]
    }
  ]
}
```

The important detail is the difference between `environment` and `secrets`.
`environment` contains literal values.
`secrets` contains names or ARNs that ECS will read before the container starts.
Inside the Node.js process, both become environment variables.

That last sentence is useful and dangerous.
It is useful because the app has one simple interface: `process.env`.
It is dangerous because a secret injected into the environment is still plaintext inside the running process.
The app must not print it, return it from debug endpoints, or include it in crash reports.

A startup config check should fail fast when required values are missing.
Fail fast means the process exits during startup instead of running in a broken half-state.
For a backend service, this is kinder than accepting traffic and failing every order.

This is the shape of a good startup message:

```text
2026-05-02T09:12:03.441Z INFO  boot service=devpolaris-orders-api image_tag=2026-05-02-1
2026-05-02T09:12:03.442Z INFO  config NODE_ENV=production PORT=3000 ORDER_TIMEOUT_MS=2500
2026-05-02T09:12:03.443Z INFO  config required_secrets_present=DATABASE_URL,STRIPE_WEBHOOK_SECRET
2026-05-02T09:12:03.918Z INFO  http listening address=0.0.0.0 port=3000
```

This log proves the app found the values it needs.
It does not print the secret values.
That is the balance you want.
Operators need enough evidence to debug startup, but not enough to leak credentials.

## Secret Injection And IAM: Access Before Startup

Secret injection happens before your application code can save you.

When ECS starts a task, ECS reads the task definition.
If the container has `secrets` entries, ECS uses the task execution role to fetch those values.
Only after ECS has the values can it build the container environment and start your Node.js process.
If ECS cannot read a secret, the app may never reach its first line of code.

This is why the execution role matters.
The task execution role is for ECS setup work: pulling images, writing logs with the selected log driver, and retrieving secrets referenced by the task definition.
The task role is for the app code after it starts.
If the orders API later calls S3, DynamoDB, or another AWS API, that is usually task role territory.

Beginners often mix these up.
The result is frustrating because the secret exists, the ARN is correct, and the app code looks fine, but tasks still fail during initialization.
The missing piece is permission for the role that ECS uses before the app starts.

Here is the permission shape for this service:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-*"
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetParameters",
      "Resource": "arn:aws:ssm:us-east-1:111122223333:parameter/prod/orders/STRIPE_WEBHOOK_SECRET"
    },
    {
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab"
    }
  ]
}
```

The `kms:Decrypt` line is only part of the path when the secret or parameter uses a customer managed KMS key that requires it.
The beginner lesson is not to paste broad KMS access into every role.
The beginner lesson is to trace the whole read path:
secret permission first, key permission when the key policy requires it.

There is another important runtime truth.
If you update a secret value in Secrets Manager or Parameter Store, an already running task keeps the environment variable value it received at startup.
Environment variables are created when the process starts.
For ECS services, you normally force a new deployment or stop and replace tasks so new tasks read the new value.

Here is the failure shape when the secret exists but ECS cannot read it:

```text
2026-05-02T09:18:44Z service devpolaris-orders-api was unable to place a task because
ResourceInitializationError: unable to retrieve secret from asm:
AccessDeniedException: User:
arn:aws:sts::111122223333:assumed-role/devpolaris-orders-ecs-execution/ecs-task
is not authorized to perform: secretsmanager:GetSecretValue
on resource:
arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-a1b2c3
```

The app has not started, so the first checks are not the database query code or Express routing.
The next move is to inspect the task execution role, the secret ARN, the account and Region, and the KMS key if a customer managed key is involved.

Use safe metadata commands first.
You can check that a secret exists without printing the secret value:

```bash
$ aws secretsmanager describe-secret \
  --secret-id prod/orders/DATABASE_URL \
  --region us-east-1 \
  --query '{Name:Name,ARN:ARN,KmsKeyId:KmsKeyId}'
{
  "Name": "prod/orders/DATABASE_URL",
  "ARN": "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-a1b2c3",
  "KmsKeyId": "alias/aws/secretsmanager"
}
```

This proves the secret metadata exists in the expected Region.
It does not prove the ECS execution role can read it.
For that, you inspect the role policy and the ECS service events.
Keep the actual secret value out of copied tickets and chat messages.

## Logs: The First Proof Of Runtime Truth

Logs are how the app tells you what happened after the image started.
Without logs, every runtime problem feels like guessing.
With useful logs, you can separate "the app never started" from "the app started but failed readiness" from "the app is healthy but a customer request failed."

On ECS with Fargate, the common first setup is the `awslogs` log driver.
It sends container output to CloudWatch Logs.
CloudWatch Logs organizes events into log groups and log streams.
A log group is the shared bucket for a service, such as `/ecs/devpolaris-orders-api`.
A log stream is one source inside that group, often one container task.

Here is the log configuration part of the task definition:

```json
{
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/devpolaris-orders-api",
      "awslogs-region": "us-east-1",
      "awslogs-stream-prefix": "ecs"
    }
  }
}
```

This small block is operationally important.
If it is missing or wrong, the task can fail with no useful application evidence in the place your team expects.
That makes every later health check failure harder to diagnose.

Good startup logs answer a few careful questions:
which version started, which environment started, which port is listening, which config names were present, and whether startup checks passed.
They should not print secrets.
They should not dump the full `process.env` object.
Dumping every environment variable may feel useful during an incident, but it can leak credentials into a durable log system.

This is a safe startup log:

```text
2026-05-02T09:26:10.114Z INFO  boot service=devpolaris-orders-api version=2026.05.02.1 node_env=production
2026-05-02T09:26:10.115Z INFO  config port=3000 order_timeout_ms=2500 public_base_url=https://orders.devpolaris.com
2026-05-02T09:26:10.116Z INFO  config secrets_present=DATABASE_URL,STRIPE_WEBHOOK_SECRET
2026-05-02T09:26:10.301Z INFO  db startup_check=ok latency_ms=42
2026-05-02T09:26:10.318Z INFO  http listening address=0.0.0.0 port=3000
```

This one is not safe:

```text
2026-05-02T09:27:55.004Z INFO  boot service=devpolaris-orders-api
2026-05-02T09:27:55.005Z INFO  env DATABASE_URL=postgresql://orders_app:prod-password@orders-prod.cluster-example.us-east-1.rds.amazonaws.com:5432/orders
2026-05-02T09:27:55.005Z INFO  env STRIPE_WEBHOOK_SECRET=whsec_live_example
```

If a log like that appears, the fix has two parts.
First, remove the logging behavior so the app reports secret presence, not secret values.
Second, rotate the leaked values because CloudWatch Logs is now one place where those values were exposed.
Deleting one log event does not prove that nobody, no alerting tool, and no log export read it first.

Logs should also make health checks visible enough to debug without flooding the log group.
A beginner service can log health transitions and failed health checks, not every successful health request forever.
If the ALB checks often and every success prints a line, your logs can become noisy and expensive.

Useful health logs look like this:

```text
2026-05-02T09:31:02.910Z WARN  health ready=false reason=db_connect_failed duration_ms=96
2026-05-02T09:31:08.441Z INFO  health ready=true reason=startup_checks_passed duration_ms=41
2026-05-02T09:31:09.002Z INFO  readiness_changed from=false to=true
```

The first line tells you why the app is not ready.
The second line tells you the app became ready.
The third line gives a clean transition marker.
When you compare these logs with ALB target health, the timing becomes much easier to understand.

## Startup Checks, Readiness, And Liveness

Startup is the period between "the process began" and "the process can serve traffic."
That period may be short, but it is not empty.
The app loads configuration, validates required environment variables, opens network clients, checks database access, prepares caches, and starts the HTTP server.

A startup check asks whether the app has enough runtime facts to continue.
For `devpolaris-orders-api`, the process should exit if `DATABASE_URL` is missing.
It should exit if `PORT` is not a valid number.
It should not keep running while every request is guaranteed to fail.

Readiness asks whether the app should receive traffic now.
A ready process has passed startup checks and can handle the kind of request the load balancer will send.
If the orders API requires the database for every order, readiness should include a fast database check or a recent successful database connection state.
If the database is down and the app returns `200` from `/health`, the ALB will send customer traffic to a task that cannot create orders.

Liveness asks whether the process should keep running.
A live process may not be ready yet.
For example, the process might still be warming up or waiting for a dependency to recover.
If you treat every short readiness failure as a liveness failure, you restart tasks that could have recovered.
If you never restart a stuck process, a deadlocked app can sit there forever.

On ECS, there are two health ideas you may use together:

| Check | Who Runs It | What It Proves |
|-------|-------------|----------------|
| Container health check | ECS runs a command inside the container | The container can prove basic local health |
| ALB target health check | ALB sends HTTP to the target IP and port | The load balancer can reach a ready app |

The ALB health check is the traffic gate in our example.
It asks the same private network path that real requests will use:
`http://10.0.42.18:3000/health`.
That makes it better than only checking whether a process exists.

An ECS container health check can still be useful.
It runs inside the container and can catch local failures before the ALB path is involved.
The command must use tools that actually exist in the image.
If your image does not include `curl`, a health check that calls `curl` will fail even if the app is fine.

Here is a task definition snippet that keeps the local container check small:

```json
{
  "healthCheck": {
    "command": [
      "CMD-SHELL",
      "node /app/scripts/local-health-check.js"
    ],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

The key idea is the `startPeriod`.
It gives the container time to start before failures count in the same way.
Do not use it to hide a broken app.
Use it to match honest startup time.

Slow startup is a common health check failure.
The app might load a large dependency, run a database migration check, or build an in-memory cache.
The ALB starts checking before the app is ready, sees timeouts or `500` responses, and ECS replaces the task.
The replacement starts the same slow path, fails the same way, and the service loops.

Java is worth mentioning only because startup timing can change the operational decision.
A Java service may need extra time for JVM warmup or for Spring Actuator readiness to become true after the application context and dependency checks finish.
In that case, tune the startup grace period and health check path to the real readiness signal.
Do not copy timing from a small Node.js service just because both services run on ECS.

The best first rule is:
fail fast on impossible startup, wait honestly for normal startup, and only return ready when traffic can succeed.

## The Health Endpoint Contract

`/health` is a contract between your app and the system that sends traffic to it.
For `devpolaris-orders-api`, the ALB calls `/health`.
If the app returns an accepted success code in time, the target can become healthy.
If it times out or returns the wrong status, the target stays unhealthy.

The health endpoint should be deep enough to protect users and shallow enough to stay reliable.
That tension is the main design choice.

A health check that is too shallow might only return `200` because the Node.js event loop is alive.
That proves the process can answer one route.
It does not prove the app can create orders.
If the database is down, users still get failures.

A health check that is too deep might call the database, Stripe, the email provider, a recommendation service, and a reporting API.
Now one slow optional dependency can pull every task out of rotation.
The health endpoint becomes more fragile than the app itself.

For the orders API, a practical first contract is:

| Check | Include In `/health`? | Reason |
|-------|------------------------|--------|
| Required env vars loaded | Yes | Missing config means every request is unsafe |
| HTTP server listening | Yes | The ALB must reach the process |
| Database reachable with a short timeout | Yes | Orders cannot be created without it |
| Stripe webhook secret present | Yes | Webhook route cannot safely verify events without it |
| Third-party payment API live call | Usually no | A remote vendor blip should not always remove the API from traffic |
| Long database migration | No | Do this before readiness or as a separate release step |

That table is a judgment for this service.
If another service can serve cached reads while the database is temporarily down, its readiness check might be different.
Tie the check to what traffic needs, not to every system the app has ever heard of.

A useful health response can give humans a little detail while keeping the ALB focused on status code:

```text
HTTP/1.1 200 OK
content-type: application/json

{
  "status": "ok",
  "service": "devpolaris-orders-api",
  "version": "2026.05.02.1",
  "ready": true,
  "checks": {
    "config": "ok",
    "database": "ok"
  }
}
```

When the database is down, the response should not pretend everything is fine:

```text
HTTP/1.1 503 Service Unavailable
content-type: application/json

{
  "status": "error",
  "service": "devpolaris-orders-api",
  "ready": false,
  "checks": {
    "config": "ok",
    "database": "failed"
  }
}
```

The ALB does not need the JSON body.
It mainly checks the status code and timeout.
The body helps humans and logs.
Keep the body free of secrets, connection strings, stack traces, and raw exception messages.

Also be careful with success codes.
If your target group matcher accepts `200-499`, then an app returning `401`, `403`, or `404` might still look healthy.
That can hide a broken path or auth middleware mistake.
For a beginner service, use a narrow success code such as `200` unless you have a clear reason to accept more.

## ALB Target Health In Practice

The ALB health check is the outside proof.
It proves that the load balancer can reach the task IP and port, send the request, and receive an accepted response.
That is different from "the process exists."

For the orders API, the target group points at Fargate task IPs on port `3000`.
The health check path is `/health`.
The target group expects a successful HTTP response.

Here is a realistic target health snapshot during a deployment:

```bash
$ aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:111122223333:targetgroup/orders-api-tg/8f3d2b9a1c0e44aa
{
  "TargetHealthDescriptions": [
    {
      "Target": {
        "Id": "10.0.42.18",
        "Port": 3000,
        "AvailabilityZone": "us-east-1a"
      },
      "HealthCheckPort": "3000",
      "TargetHealth": {
        "State": "healthy"
      }
    },
    {
      "Target": {
        "Id": "10.0.43.27",
        "Port": 3000,
        "AvailabilityZone": "us-east-1b"
      },
      "HealthCheckPort": "3000",
      "TargetHealth": {
        "State": "unhealthy",
        "Reason": "Target.ResponseCodeMismatch",
        "Description": "Health checks failed with these codes: [503]"
      }
    }
  ]
}
```

This output says one task is trusted and one task is not.
The failing task did answer, but it answered with `503` while the target group expected success.
That points you toward the app readiness logic and app logs, not first toward security groups.

Now compare that with a timeout:

```text
Target health detail

Target: 10.0.43.27:3000
State: unhealthy
Reason: Target.Timeout
Description: Request timed out
```

Timeouts are less specific.
They might mean the app is not listening yet.
They might mean the task security group does not allow the ALB security group on port `3000`.
They might mean the app is CPU-starved during startup and cannot answer quickly.
They might mean the process listens on `127.0.0.1` instead of `0.0.0.0`, so the health check cannot reach it from outside the container.

The target health state translates like this:

| State | Plain Meaning | First Place To Look |
|-------|---------------|---------------------|
| `initial` | ALB is still checking a new target | Deployment timing and recent service events |
| `healthy` | Health checks are passing | App logs and normal request metrics |
| `unhealthy` | Health checks are failing | Reason code, `/health` logs, network path |
| `unused` | Target is not used by the listener path | Listener rule and target group attachment |
| `draining` | Target is being removed | ECS deployment or scale-in activity |

The ALB and ECS service cooperate during deployments.
ECS starts a new task, registers it with the target group, waits for health, and then traffic can move to the new target.
If the task never becomes healthy, ECS may stop it and try another task.
That replacement loop is useful when the problem is temporary.
It is noisy when every new task has the same missing config or broken health endpoint.

There is one subtle safety note.
Health checks are a routing signal, not a complete incident shield.
If all registered targets become unhealthy in some ALB situations, the load balancer can still route to targets rather than having no path at all.
That means health checks should be part of your protection, not the only protection.
Your app still needs timeouts, clear errors, logs, and dependency handling.

## Failure Modes And Diagnosis

Runtime failures repeat.
Once you know the shape, the problem becomes much less mysterious.
Start with the symptom, then prove which layer owns it.

The first failure is a missing environment variable.
This is an app startup failure because ECS successfully started the container, but the app refused to run without required config.

```text
2026-05-02T10:03:11.208Z INFO  boot service=devpolaris-orders-api version=2026.05.02.1
2026-05-02T10:03:11.211Z ERROR config missing required environment variable DATABASE_URL
2026-05-02T10:03:11.212Z ERROR startup aborted code=CONFIG_MISSING
```

The fix direction is not to make `/health` return `500` forever.
The better fix is to set the missing variable or secret reference, deploy a corrected task definition, and let broken tasks exit quickly.
The log should name the missing variable, not the value.

The second failure is a secret that exists but cannot be read.
This often appears in ECS service events before app logs exist:

```text
ResourceInitializationError: unable to retrieve secret from ssm:
AccessDeniedException: User:
arn:aws:sts::111122223333:assumed-role/devpolaris-orders-ecs-execution/ecs-task
is not authorized to perform: ssm:GetParameters
on resource:
arn:aws:ssm:us-east-1:111122223333:parameter/prod/orders/STRIPE_WEBHOOK_SECRET
```

The fix direction is to check the task execution role.
Do not start by editing Node.js code.
The app did not receive the variable because ECS could not inject it.
Check the secret or parameter ARN, the Region, the role policy, and KMS permissions if a customer managed key protects the value.

The third failure is a health endpoint that is too shallow.
It returns `200` even when the database is down:

```text
2026-05-02T10:08:22.004Z INFO  health status=200 check=process_alive
2026-05-02T10:08:27.991Z ERROR request path=/v1/orders status=500 reason=db_connect_failed
2026-05-02T10:08:28.114Z ERROR request path=/v1/orders status=500 reason=db_connect_failed
```

The ALB sees a healthy target.
Customers see failed orders.
The fix direction is to make readiness include a fast check for required database access, or to track recent database connectivity in the app and return not ready when the app cannot create orders.
Do not add slow or optional dependency calls just because one check was too shallow.

The fourth failure is a health endpoint that is too deep.
It calls a payment provider or reporting service that is not required for the API to accept basic orders.
A brief vendor delay causes every task to fail health checks.

```text
2026-05-02T10:12:40.812Z WARN  health ready=false reason=analytics_api_timeout duration_ms=5000
2026-05-02T10:12:45.916Z WARN  health ready=false reason=analytics_api_timeout duration_ms=5000
2026-05-02T10:12:46.002Z INFO  ecs service event="task failed ELB health checks"
```

The fix direction is to separate required readiness from optional dependency status.
The health endpoint can expose optional dependency warnings in the JSON body or metrics, but it should not remove the app from traffic for work that is not required to serve the main path.

The fifth failure is slow startup.
The task is valid, but the ALB starts checking before the app can honestly answer.

```text
2026-05-02T10:17:01.003Z INFO  boot service=devpolaris-orders-api
2026-05-02T10:17:04.128Z INFO  startup loading_exchange_rates=true
2026-05-02T10:17:10.044Z WARN  health ready=false reason=startup_in_progress
2026-05-02T10:17:20.051Z WARN  health ready=false reason=startup_in_progress
2026-05-02T10:17:31.880Z INFO  startup complete ready=true
```

If ECS stops the task before `10:17:31`, the health check timing is stricter than the real startup time.
The fix direction is to remove unnecessary startup work, make required startup work faster, or adjust the container `startPeriod` and ECS service health check grace period to match honest startup.
Do not make `/health` return `200` while startup is still incomplete.

The sixth failure is logging secret values.
The service might technically work, but the deployment created a security problem.

```text
2026-05-02T10:21:33.118Z INFO  env DATABASE_URL=postgresql://orders_app:prod-password@orders-prod.cluster-example.us-east-1.rds.amazonaws.com:5432/orders
```

The fix direction is to remove the unsafe log line, rotate the leaked secret, and redeploy.
The lesson is:
logs are production data, not private scratch space.

A practical diagnostic path keeps you from changing random settings:

1. Check ECS service events.
2. Check whether the task reached `RUNNING` or stopped during initialization.
3. Check CloudWatch Logs for startup evidence.
4. Check target health state and reason code.
5. Compare `/health` logs with ALB target health timing.
6. Check security groups and port mapping when health checks time out.
7. Check task execution role permissions when secrets fail before app startup.
8. Check task role permissions when app code starts but AWS API calls fail later.

The order matters.
If the task never started because a secret could not be injected, changing ALB health settings will not help.
If the ALB cannot reach port `3000`, changing database code will not help.
If `/health` lies about database readiness, adding more tasks will only create more broken targets.

## Tradeoffs And A Shipping Checklist

There is no perfect health check.
There is only a check that matches the service's real responsibility.

The main tradeoff is confidence versus fragility.
A shallow check is fast and stable, but it may trust a task that cannot do useful work.
A deep check gives more confidence, but it can make optional dependency noise look like total service failure.
For `devpolaris-orders-api`, the right middle is to check required configuration, HTTP readiness, and fast database access because those are needed for the main order path.

The second tradeoff is environment variables versus runtime fetches.
ECS secret injection into environment variables is simple.
The app starts with the values it needs and does not need AWS SDK code just to read them.
The cost is that values are fixed for the life of the process and can leak if the app logs or exposes its environment.
Fetching secrets at runtime can support refresh patterns, but it adds application code, IAM calls, caching, and failure paths.
Use the simple injection pattern first unless the service truly needs live secret refresh.

The third tradeoff is startup strictness.
Failing fast on missing required config is good.
Failing fast because an optional analytics endpoint is slow is usually bad.
The line should match what users need from the service.
For an orders API, database access is core.
Analytics export is usually not core to accepting the order.

The same ideas appear on other AWS runtime shapes, but the details move.
On EC2 with `systemd`, environment values may live in a unit file or an `EnvironmentFile`, logs may go through `journald` and the CloudWatch Agent, and IAM usually comes from an instance profile.
The ALB health check still calls the instance or service port.
On Lambda, environment variables are part of the function configuration, secret values are often fetched by the function or an extension, and there is no long-running ALB target health loop unless you put Lambda behind a supported front door.
The runtime shape changes where you configure things, not the need to prove them.

Before you trust a deployment of `devpolaris-orders-api`, use a checklist like this:

| Area | Pre-Traffic Check |
|------|-------------------|
| Task definition | Image points at the intended release tag or digest |
| Task definition | `PORT` matches the container port and target group port |
| Task definition | Non-secret environment values are present |
| Task definition | Secret references use production names and ARNs |
| Task definition | `awslogs` sends output to `/ecs/devpolaris-orders-api` |
| IAM | Task execution role can read startup secrets |
| IAM | Task execution role can decrypt customer managed KMS keys if needed |
| IAM | Task role has only the AWS permissions app code needs after startup |
| Application startup | Required config is validated |
| Application startup | Missing config exits with a clear log |
| Application startup | Secret values are never printed |
| Application startup | Startup time fits health check timing |
| Health | `/health` returns `200` only when the main order path can work |
| Health | `/health` returns a non-success status when required dependencies fail |
| Health | `/health` does not call slow optional systems |
| Health | ALB target health is healthy for new task IPs on port `3000` |
| Logs | CloudWatch log stream contains startup evidence |
| Logs | Health transitions are visible |
| Logs | Failures name the missing condition without exposing private values |

This checklist gives you a repeatable way to read a deployment.
You are not asking whether AWS says something is running.
You are asking whether the running app has earned trust.

When a task passes that checklist, traffic can move to it with much less guesswork.
When it fails, you know which layer to inspect first.

---

**References**

- [Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html) - Official ECS guide for injecting secrets from Secrets Manager or Parameter Store into containers.
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html) - Explains the role ECS uses for setup work such as pulling images, writing logs, and retrieving referenced secrets.
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Explains the role application code uses when a running task calls other AWS services.
- [Determine Amazon ECS task health using container health checks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/healthcheck.html) - Official ECS documentation for container health checks, exit codes, and task health.
- [Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html) - Official ALB documentation for target health checks, states, reason codes, and successful response matching.
- [Example Amazon ECS task definition: Route logs to CloudWatch](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specify-log-config.html) - Shows how the `awslogs` driver is configured in an ECS task definition.
