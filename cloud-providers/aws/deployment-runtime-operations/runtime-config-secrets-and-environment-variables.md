---
title: "Runtime Config, Secrets, and Environment Variables"
description: "Separate normal runtime settings from sensitive secrets and understand why config changes must be treated like releases."
overview: "Most production bugs are not only code bugs. This article teaches how a Node backend receives runtime config in AWS, how secrets differ from ordinary settings, and how teams diagnose bad config safely."
tags: ["secrets", "env-vars", "ssm", "ecs"]
order: 3
id: article-cloud-providers-aws-deployment-runtime-operations-runtime-config-secrets-and-environment-variables
---

## Table of Contents

1. [Runtime Config Is A Startup Contract](#runtime-config-is-a-startup-contract)
2. [The Running Example: Orders API On ECS](#the-running-example-orders-api-on-ecs)
3. [Ordinary Values, Secrets, And Defaults](#ordinary-values-secrets-and-defaults)
4. [How ECS Delivers Values To The Container](#how-ecs-delivers-values-to-the-container)
5. [Why Config Changes Are Releases](#why-config-changes-are-releases)
6. [Where Secrets Must Not Travel](#where-secrets-must-not-travel)
7. [Validate Config Before Serving Traffic](#validate-config-before-serving-traffic)
8. [When A Good Image Fails](#when-a-good-image-fails)
9. [Diagnose Without Leaking Values](#diagnose-without-leaking-values)
10. [Rotate, Roll Back, And Record The Contract](#rotate-roll-back-and-record-the-contract)

## Runtime Config Is A Startup Contract

An application image is only part of what runs in production.

The image contains code, dependencies, and a startup command.
Runtime configuration is the set of values added around that image when the process starts.
That includes environment variables, secret references, port numbers, feature settings, timeout values, and the AWS roles that let the runtime fetch private values.

Runtime config exists because the same code needs to run in different places.
Your laptop may use a local database.
Staging may use a small shared database.
Production may use a highly protected database, a real payment webhook secret, stricter timeouts, and a public base URL.
Rebuilding the container image for every environment would mix packaging with operation.
It would also make secrets easier to leak into places that were never meant to store them.

In AWS, runtime config sits between a deployable artifact and a trusted running service.
For ECS on Fargate, the container image comes from Amazon ECR, but the task definition tells ECS what values to attach when it starts a task.
The task definition is the runtime contract that says, "this image expects these names to exist when it wakes up."

The running example in this article is a Node.js backend named `devpolaris-orders-api`.
It handles order creation for DevPolaris.
It runs on Amazon ECS with Fargate.
The app reads values from `process.env`.
The operational question is "did the image receive the runtime contract it needs?", not merely "did the image build?"

That contract can break a healthy image.
A task can run an image that passed tests yesterday and still fail today because `DATABASE_URL` points at the wrong database, `PAYMENT_WEBHOOK_SECRET` is missing, or the ECS role cannot read the secret.
That is why config changes deserve the same care as code releases.

> A container image says what code will run. Runtime config says what world that code is allowed to wake up in.

## The Running Example: Orders API On ECS

The `devpolaris-orders-api` service has a simple shape.
It exposes HTTP routes for orders.
It listens on port `3000`.
It writes logs to CloudWatch Logs.
It connects to a production database.
It verifies payment webhooks before trusting payment events.

On a developer laptop, the app might start with a local `.env` file.
That is useful for learning and local development.
The Node process still sees the same interface:

```ini
NODE_ENV=development
PORT=3000
ORDER_TIMEOUT_MS=2500
DATABASE_URL=postgresql://orders_app:local-password@localhost:5432/orders
PAYMENT_WEBHOOK_SECRET=whsec_local_example
```

Production needs the same names, but not the same storage habit.
The production database URL contains credentials.
The payment webhook secret is what lets the service decide whether a webhook really came from the payment system.
Those values should not be copied into Git, baked into a Docker image, pasted into tickets, or printed into logs.

The production contract is easier to understand as a map:

```mermaid
flowchart TD
    IMAGE["Code-only package<br/>(container image)"] --> TASKDEF["Runtime contract<br/>(task definition)"]
    TASKDEF --> ECS["Task startup<br/>(ECS)"]
    SM["Database URL secret<br/>(Secrets Manager)"] --> ECS
    SSM["Webhook secret<br/>(Parameter Store)"] --> ECS
    ECS --> NODE["Runtime variables<br/>(Node process.env)"]
    NODE --> LOGS["Runtime evidence<br/>(CloudWatch Logs)"]
```

The app still reads `process.env.DATABASE_URL`.
The difference is that production receives the value through ECS secret injection instead of from a local file.
The app code gets a simple interface.
The platform team gets a safer place to store and audit the sensitive values.

This separation also gives you a clean release story.
The same image can move from staging to production.
Only the runtime contract changes.
That is a strength, but it also means the runtime contract can break production even when the image is good.

## Ordinary Values, Secrets, And Defaults

Not every runtime value needs the same treatment.
A common beginner mistake is to call every environment variable a secret.
Another common mistake is to treat every environment variable as harmless.
Both shortcuts hide useful distinctions.

For `devpolaris-orders-api`, the first split looks like this:

| Value | Category | Why It Exists |
|-------|----------|---------------|
| `NODE_ENV=production` | Ordinary env var | Tells Node and libraries to use production behavior |
| `PORT=3000` | Ordinary env var | Tells the HTTP server where to listen |
| `ORDER_TIMEOUT_MS=2500` | Ordinary env var | Controls how long order work may wait |
| `PUBLIC_BASE_URL=https://orders.devpolaris.com` | Ordinary env var | Lets the app generate public links |
| `DATABASE_URL` | Secret | Contains database access details |
| `PAYMENT_WEBHOOK_SECRET` | Secret | Lets the app verify trusted webhook events |
| `DEFAULT_PAGE_SIZE=25` | App default | Safe fallback for optional behavior |

An ordinary environment variable is a runtime setting that changes behavior but does not grant access by itself.
You should still review it.
A wrong ordinary value can break production.
For example, `ORDER_TIMEOUT_MS=25` might make nearly every order fail because the timeout is too short.
But the value does not need to be hidden like a password.

A secret is different.
A secret gives access, proves identity, signs data, decrypts data, or lets another system trust your app.
The shape does not matter as much as the damage.
A database URL looks like a plain string, but if it contains a username and password, it is secret.
A webhook token may be short, but if it lets the service distinguish real payment events from fake ones, it is secret.

An app default is a value chosen in code when no runtime value is provided.
Defaults are useful for safe, optional settings.
They are dangerous for required production settings.
If production can accidentally run with `DATABASE_URL=localhost`, the app may fail in a confusing way.
For required production config, prefer a clear startup error over a quiet default.

The useful rule is:
ordinary values can be visible but must be intentional.
Secrets must be protected.
Required values should fail fast when missing.
Defaults belong only where the fallback is genuinely safe.

## How ECS Delivers Values To The Container

ECS task definitions separate literal environment values from secret references.
That separation is small in JSON, but it is large operationally.

Literal values go in `environment`.
These are the values you are willing to show in the task definition.
Secret references go in `secrets`.
Those entries name the environment variable that the container should receive, but they point ECS at Secrets Manager or Systems Manager Parameter Store for the real value.

Here is a short excerpt, not a full task definition:

```json
{
  "family": "devpolaris-orders-api",
  "executionRoleArn": "arn:aws:iam::111122223333:role/devpolaris-orders-ecs-execution",
  "containerDefinitions": [
    {
      "name": "orders-api",
      "image": "111122223333.dkr.ecr.us-east-1.amazonaws.com/devpolaris-orders-api:2026-05-02.3",
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
          "name": "PAYMENT_WEBHOOK_SECRET",
          "valueFrom": "arn:aws:ssm:us-east-1:111122223333:parameter/prod/orders/PAYMENT_WEBHOOK_SECRET"
        }
      ]
    }
  ]
}
```

Inside the container, both groups become environment variables.
The Node app sees `process.env.NODE_ENV`, `process.env.PORT`, `process.env.DATABASE_URL`, and `process.env.PAYMENT_WEBHOOK_SECRET`.
The app does not need to know the secret ARN.

The difference is what ECS had to do before the app started.
For `environment`, ECS copies the literal value from the task definition.
For `secrets`, ECS must call AWS APIs to retrieve the value.
That means the ECS task execution role needs permission to read the referenced secret or parameter.
If a customer managed KMS key protects the value, the read path may also need `kms:Decrypt`.

Secrets Manager and Parameter Store overlap, but they are not the same tool.
Secrets Manager is usually the first choice for secrets with a lifecycle, such as database credentials, API keys, and values that may need managed rotation.
Parameter Store is useful for namespaced configuration and can store encrypted `SecureString` values.
For a beginner service, it is reasonable to put the database connection string in Secrets Manager and a simpler webhook secret in Parameter Store as long as the team understands the lifecycle and permissions for both.

The task execution role is easy to confuse with the task role.
The task execution role is used by ECS for setup work before your app starts, including retrieving secrets referenced in the task definition.
The task role is used by application code after the container starts, for example when the Node app calls another AWS service.
For secret injection failures at startup, inspect the execution role first.

## Why Config Changes Are Releases

A code release changes what the process does.
A config release changes what the same process is connected to, allowed to read, and allowed to trust.
Those are both production changes.

Imagine the image `devpolaris-orders-api:2026-05-02.3` passed CI, deployed to staging, and served test orders successfully.
That image is healthy.
Now production changes only one value:

```text
before:
  DATABASE_URL -> prod/orders/DATABASE_URL

after:
  DATABASE_URL -> prod/order/DATABASE_URL
```

The image did not change.
The app code did not change.
But the task now points at the wrong secret name.
New tasks fail before the Node process can serve traffic.

Ordinary values can do the same kind of damage.
Changing `ORDER_TIMEOUT_MS` from `2500` to `25` may make the service technically start and still fail most orders.
Changing `PUBLIC_BASE_URL` to a staging hostname may generate broken customer links.
Changing `NODE_ENV` away from `production` may alter framework behavior.

That is why config changes need release habits:
record the intended source, review the diff, deploy a new task definition revision, watch startup evidence, and keep a rollback target.
The task definition revision is often the clean rollback boundary for ECS.
If revision `43` points at a bad parameter and revision `42` was healthy, rolling back the service to revision `42` can be faster and safer than guessing in the console.

A good release note does not include secret values.
It records names, versions, stages, and task revisions:

```text
release:
  service: devpolaris-orders-api
  image: devpolaris-orders-api:2026-05-02.3
  task_definition: devpolaris-orders-api:43
  config_contract:
    NODE_ENV: taskdef environment
    PORT: taskdef environment
    ORDER_TIMEOUT_MS: taskdef environment
    DATABASE_URL: secretsmanager prod/orders/DATABASE_URL stage AWSCURRENT
    PAYMENT_WEBHOOK_SECRET: ssm /prod/orders/PAYMENT_WEBHOOK_SECRET version 7
```

This record helps during incidents.
It tells you what the release believed the runtime contract was.
It gives you something to compare against the live task definition and secret metadata.
It does not leak the database password or webhook secret.

## Where Secrets Must Not Travel

Secrets are meant to be used by the running service, not spread through normal engineering tools.
Most secret leaks are not clever attacks.
They are private values copied into places that remember too much.

Secrets do not belong in Git.
Git history is durable.
If a real `DATABASE_URL` is committed and then removed, the old commit can still exist in clones, pull request diffs, build caches, forks, and backups.
The fix is usually rotation because deleting the line only changes the latest version of the file.

Secrets do not belong in container images.
A Dockerfile line like this turns the image registry into an accidental secret store:

```text
ENV DATABASE_URL=postgresql://orders_app:prod-password@orders-prod.example.us-east-1.rds.amazonaws.com:5432/orders
```

Anyone who can inspect or pull the image may be able to find that value.
The image also becomes tied to one environment.
You lose the clean separation between code package and runtime contract.

Secrets do not belong in logs.
Logs are designed to be copied, indexed, searched, retained, exported, and shared during debugging.
That is what makes CloudWatch Logs useful.
It is also what makes logs a dangerous place for secrets.

This log is a leak:

```text
2026-05-02T10:14:03.118Z INFO  boot service=devpolaris-orders-api
2026-05-02T10:14:03.119Z INFO  config DATABASE_URL=postgresql://orders_app:prod-password@orders-prod.example.us-east-1.rds.amazonaws.com:5432/orders
2026-05-02T10:14:03.120Z INFO  config PAYMENT_WEBHOOK_SECRET=whsec_live_example
```

This log is useful without exposing values:

```text
2026-05-02T10:15:41.441Z INFO  boot service=devpolaris-orders-api release=2026-05-02.3
2026-05-02T10:15:41.442Z INFO  config required_env_present=NODE_ENV,PORT,ORDER_TIMEOUT_MS
2026-05-02T10:15:41.443Z INFO  config required_secrets_present=DATABASE_URL,PAYMENT_WEBHOOK_SECRET
```

Secrets also do not belong in chat messages, tickets, screenshots, copied terminal history, or customer support notes.
Those systems are useful because people can search and share them.
That is exactly why they should contain names, symptoms, and redacted shapes, not private values.

## Validate Config Before Serving Traffic

The app should treat required runtime config as an input contract.
If the contract is missing or malformed, the process should fail early with a clear message.
That is kinder than letting the app accept traffic and fail every order.

In Node.js, the app usually reads environment variables during startup.
The validation can be done with a small helper, a schema library, or plain code.
The important behavior is not the library.
The important behavior is that missing required values are caught before the server announces readiness.

A safe startup check names missing variables without printing their values:

```text
2026-05-02T10:22:11.208Z INFO  boot service=devpolaris-orders-api release=2026-05-02.3
2026-05-02T10:22:11.211Z ERROR config missing required variable DATABASE_URL
2026-05-02T10:22:11.212Z ERROR startup aborted code=CONFIG_MISSING
```

That message gives an operator the next step.
Check the task definition secret reference.
Check whether ECS injected `DATABASE_URL`.
Check whether the secret exists in the expected account and Region.
Do not print the value to prove it exists.

A healthy startup log should include the safe parts of the contract:

```text
2026-05-02T10:24:33.081Z INFO  boot service=devpolaris-orders-api release=2026-05-02.3
2026-05-02T10:24:33.082Z INFO  config node_env=production port=3000 order_timeout_ms=2500
2026-05-02T10:24:33.083Z INFO  config secrets_present=DATABASE_URL,PAYMENT_WEBHOOK_SECRET
2026-05-02T10:24:33.401Z INFO  http listening address=0.0.0.0 port=3000
```

This log proves the app reached the point where config was loaded.
It does not prove the database password is correct.
That is why many services also run a short database startup check or let readiness stay false until the database connection succeeds.
The check should be fast and tied to the main service path.

The app should also avoid unsafe defaults for production secrets.
`DATABASE_URL` should not quietly default to `localhost`.
`PAYMENT_WEBHOOK_SECRET` should not default to a placeholder that makes verification meaningless.
If a value is required to serve real traffic safely, missing means stop.

## When A Good Image Fails

Runtime config failures have a recognizable shape.
The image may be correct, but the runtime contract around it is broken.
That distinction keeps you from editing app code when the deployment input is wrong.

The first failure is a missing secret reference.
The app starts, validates config, and exits:

```text
2026-05-02T10:31:12.004Z INFO  boot service=devpolaris-orders-api release=2026-05-02.3
2026-05-02T10:31:12.009Z ERROR config missing required variable PAYMENT_WEBHOOK_SECRET
2026-05-02T10:31:12.010Z ERROR startup aborted code=CONFIG_MISSING
```

This points at the task definition.
Maybe `PAYMENT_WEBHOOK_SECRET` was omitted from `secrets`.
Maybe it was renamed to `PAYMENTS_WEBHOOK_SECRET`.
Maybe the service is still running an older task definition revision.

The second failure happens before app logs exist.
ECS tries to retrieve the secret and cannot.
The service event gives the clue:

```text
service devpolaris-orders-api was unable to place a task because
ResourceInitializationError: unable to retrieve secret from asm:
AccessDeniedException: User:
arn:aws:sts::111122223333:assumed-role/devpolaris-orders-ecs-execution/ecs-task
is not authorized to perform: secretsmanager:GetSecretValue
on resource:
arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-a1b2c3
```

The app did not fail to connect to the database.
The app probably did not start.
ECS could not fetch the value needed to create the container environment.
The next place to inspect is the task execution role policy, the secret ARN, the Region, and the KMS key path if a customer managed key is used.

The third failure is a wrong value.
The task starts and the variable exists, but it points at the wrong target or contains the wrong secret.
For example, the database URL may use a stale password:

```text
2026-05-02T10:39:44.516Z INFO  config secrets_present=DATABASE_URL,PAYMENT_WEBHOOK_SECRET
2026-05-02T10:39:45.022Z ERROR db startup_check=failed error_name=AuthenticationFailed
2026-05-02T10:39:45.023Z ERROR startup aborted code=DB_AUTH_FAILED
```

The log does not print the password.
It tells you that the variable existed and the database rejected the credential.
That points toward the secret version, database user, password rotation, or environment mix-up.

The fourth failure appears after startup.
The payment webhook secret exists but is wrong for production.
The service can accept normal order requests, but webhook verification fails:

```text
2026-05-02T10:47:08.771Z WARN  webhook verification_failed provider=payments error_name=SignatureMismatch
2026-05-02T10:47:08.772Z INFO  webhook rejected status=400 reason=invalid_signature
```

This is still a runtime contract problem.
The code is doing the right thing by rejecting untrusted events.
The fix is to compare the configured secret source with the payment system's production webhook setting, then deploy corrected config.
Do not log the secret on either side to compare it.

## Diagnose Without Leaking Values

Good diagnosis starts with metadata and events.
You rarely need to print a secret value to understand whether AWS can find it.

First confirm the account and Region.
Many AWS config mistakes are wrong-workspace mistakes:

```bash
$ aws sts get-caller-identity
{
  "UserId": "AIDAEXAMPLEUSERID",
  "Account": "111122223333",
  "Arn": "arn:aws:iam::111122223333:user/maya"
}
```

If you expected a different account, stop.
If your commands are in `us-east-1` but the service runs in another Region, stop.
Fix the workspace before reading any deeper signal.

Next read ECS service events.
Service events often tell you whether the failure happened before the app started:

```bash
$ aws ecs describe-services \
  --cluster prod-orders \
  --services devpolaris-orders-api \
  --region us-east-1 \
  --query 'services[0].events[0].message'
"service devpolaris-orders-api was unable to place a task because ResourceInitializationError: unable to retrieve secret from asm: AccessDeniedException..."
```

That message points toward IAM and secret retrieval.
It does not point toward Express routes or database query code.

Then inspect the task definition shape without printing values:

```bash
$ aws ecs describe-task-definition \
  --task-definition devpolaris-orders-api:43 \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].{environment:environment[].name,secrets:secrets[].name}'
{
  "environment": [
    "NODE_ENV",
    "PORT",
    "ORDER_TIMEOUT_MS"
  ],
  "secrets": [
    "DATABASE_URL",
    "PAYMENT_WEBHOOK_SECRET"
  ]
}
```

This proves the expected names are present in the task definition.
It does not prove the references are correct.
If a name is missing here, fix the task definition and register a new revision.

For Secrets Manager, use metadata first:

```bash
$ aws secretsmanager describe-secret \
  --secret-id prod/orders/DATABASE_URL \
  --region us-east-1 \
  --query '{Name:Name,ARN:ARN,KmsKeyId:KmsKeyId,LastChangedDate:LastChangedDate}'
{
  "Name": "prod/orders/DATABASE_URL",
  "ARN": "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-a1b2c3",
  "KmsKeyId": "alias/aws/secretsmanager",
  "LastChangedDate": "2026-05-02T09:58:12.000000+00:00"
}
```

This proves the secret exists in the expected Region.
It shows the ARN the task definition can reference.
It does not reveal the database password.

For Parameter Store, metadata can confirm the parameter path and version:

```bash
$ aws ssm describe-parameters \
  --parameter-filters "Key=Name,Option=Equals,Values=/prod/orders/PAYMENT_WEBHOOK_SECRET" \
  --region us-east-1 \
  --query 'Parameters[*].{Name:Name,Type:Type,Version:Version,LastModifiedDate:LastModifiedDate}'
[
  {
    "Name": "/prod/orders/PAYMENT_WEBHOOK_SECRET",
    "Type": "SecureString",
    "Version": 7,
    "LastModifiedDate": "2026-05-02T09:55:41.000000+00:00"
  }
]
```

If metadata exists but ECS still cannot retrieve the value, inspect permissions.
For ECS secret injection, the execution role needs access.
If a customer managed KMS key is involved, the role and the key policy may both matter.

CloudWatch Logs is where you inspect app-level config validation.
Search for safe error codes and variable names, not values:

```bash
$ aws logs filter-log-events \
  --log-group-name /ecs/devpolaris-orders-api \
  --filter-pattern '"CONFIG_MISSING" "DATABASE_URL"' \
  --region us-east-1 \
  --query 'events[].message'
[
  "2026-05-02T10:31:12.009Z ERROR config missing required variable DATABASE_URL code=CONFIG_MISSING"
]
```

The diagnostic path is to prove names, sources, versions, roles, and startup behavior while keeping the secret value out of the trail.

## Rotate, Roll Back, And Record The Contract

Secrets need careful change habits because they connect multiple systems.
Rotating a database password may involve the database, Secrets Manager, ECS task startup, and live tasks already holding the old value.
Changing only one side can create a clean-looking secret store and a broken service.

For ECS environment injection, a running container receives secret values when it starts.
If the secret changes later, the existing process does not automatically get a new environment variable.
New tasks must start to receive the new value.
For an ECS service, that usually means deploying a new task definition revision or forcing a new deployment.

The release habit is:
change the secret in the source of truth, update or confirm the task definition reference, start fresh tasks, and watch startup logs and health.
If the new value is bad, roll back to the previous task definition revision or move the secret version label back according to your team's rotation plan.

Record the contract, not the values.
A small release record might look like this:

```text
runtime contract record:
  service: devpolaris-orders-api
  environment: production
  image: devpolaris-orders-api:2026-05-02.3
  task_definition: devpolaris-orders-api:43
  database_secret:
    source: Secrets Manager
    name: prod/orders/DATABASE_URL
    stage: AWSCURRENT
  payment_webhook_secret:
    source: SSM Parameter Store
    name: /prod/orders/PAYMENT_WEBHOOK_SECRET
    version: 7
  validated_by:
    startup_log: config secrets_present
    health_path: /health
```

This gives the team a shared truth during deployment.
If production breaks, the rollback target is clear.
You can compare revision `43` with revision `42`.
You can compare Parameter Store version `7` with version `6`.
You can ask whether the tasks restarted after the secret changed.

There is also a design tradeoff.
Injecting secrets as environment variables is simple.
The app does not need AWS SDK code just to start.
The cost is that values are fixed for the life of the process, and careless logging can expose them.
Fetching secrets at runtime can support refresh patterns, but it adds SDK calls, IAM permissions, caching behavior, retries, and new failure modes.
Use the simple ECS injection pattern first unless the service truly needs live refresh.

One last practical checklist keeps the contract honest:

| Habit | What It Prevents |
|-------|------------------|
| Keep safe examples in Git, not real `.env` files | Secret leaks through source history |
| Put ordinary values in `environment` | Clear task definition review |
| Put private values in `secrets` | Secret values stay outside task definition JSON |
| Validate required names at startup | Broken tasks fail before serving traffic |
| Log presence and source names, not values | Useful evidence without leakage |
| Record secret version or stage | Faster rollback and incident review |
| Restart tasks after secret rotation | New processes receive new values |
| Keep previous task revision available | Fast rollback when config breaks |

Treat configuration with the respect it already demands.
For a production service, runtime config is part of the release.
When you can read it that way, a broken deployment becomes less mysterious:
the image, task definition, secret store, IAM role, logs, and health checks each have a job, and you know which one to inspect next.

---

**References**

- [Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html) - Official ECS guide for injecting Secrets Manager and Parameter Store values into containers and refreshing tasks after secret changes.
- [Amazon ECS task definition parameters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html) - Official reference for `environment`, `secrets`, task definition revisions, and Fargate task definition fields.
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html) - Explains the role ECS uses for setup work such as retrieving referenced secrets and parameters.
- [What is AWS Secrets Manager?](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) - Official overview of Secrets Manager for storing, retrieving, and rotating database credentials, API keys, and other secrets.
- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) - Official guide to hierarchical parameters, `String`, `StringList`, and encrypted `SecureString` values.
- [AWS KMS keys](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html) - Official KMS guide explaining AWS managed keys and customer managed keys used to protect stored secret values.
