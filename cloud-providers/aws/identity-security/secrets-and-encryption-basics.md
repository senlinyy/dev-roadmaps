---
title: "Secrets and Encryption Basics"
description: "Store sensitive application configuration safely with Secrets Manager, Parameter Store, ECS secret injection, and KMS-backed encryption."
overview: "Applications need private values, but those values should not live in source code, container images, logs, or copied shell history. Learn the first AWS pattern for storing secrets and giving one running service only the access it needs."
tags: ["secrets-manager", "parameter-store", "kms", "ecs"]
order: 4
id: article-cloud-providers-aws-identity-security-secrets-encryption-basics
---

## Table of Contents

1. [Secrets Start As Ordinary App Settings](#secrets-start-as-ordinary-app-settings)
2. [The Running Example: Orders API On ECS](#the-running-example-orders-api-on-ecs)
3. [What Counts As A Secret](#what-counts-as-a-secret)
4. [Where Secrets Do Not Belong](#where-secrets-do-not-belong)
5. [Secrets Manager: Store Secrets With A Lifecycle](#secrets-manager-store-secrets-with-a-lifecycle)
6. [Parameter Store: Simple Namespaced Configuration](#parameter-store-simple-namespaced-configuration)
7. [ECS Injection: Give The Container Names, Not Values](#ecs-injection-give-the-container-names-not-values)
8. [KMS-Backed Encryption In Plain English](#kms-backed-encryption-in-plain-english)
9. [Failure Modes And Diagnosis](#failure-modes-and-diagnosis)
10. [A Shipping Checklist](#a-shipping-checklist)

## Secrets Start As Ordinary App Settings

A local `.env` file can make a backend feel easy until the same private values need to run in a shared cloud account.

You clone a project.
You copy `.env.example` to `.env`.
You paste a database URL, an API key, or a webhook signing token.
The app starts.
That local workflow is simple, and for learning it is useful.

The problem starts when the same habit moves into a shared system.
Your laptop is one person's workspace.
AWS is a shared place where containers, deployment tools, logs, accounts, roles, databases, and people all meet.
If a private value gets copied into the wrong place, it can travel much farther than you expect.

A secret is any value that gives access, proves identity, signs data, or lets another system trust your app.
It might look like a password.
It might look like a random token.
It might look like a long private key block.
The shape is less important than the damage if the value is copied by the wrong person or process.

AWS gives you managed places to store these values.
The two beginner-friendly places are AWS Secrets Manager and AWS Systems Manager Parameter Store.
Both can store sensitive values outside your Git repo and outside your container image.
Both can use AWS KMS (Key Management Service, the AWS service that manages encryption keys) to encrypt secret values.

This article stays at the first useful level.
You will not become a KMS specialist here.
You will learn where secrets live, how an ECS task receives them, why encryption and permission are separate ideas, and how to debug the first failures.

> Secret handling gives the value only to the app and people that truly need it.

## The Running Example: Orders API On ECS

Our running service is `devpolaris-orders-api`.
It is a Node.js backend that handles checkout requests for DevPolaris.
The service runs as a container on Amazon ECS with Fargate.
ECS starts tasks from a task definition, which is the JSON document that tells ECS which image to run, how much CPU and memory to use, which ports to expose, which logs to write, and which environment variables to set.

Locally, the developer might have a `.env` file like this:

```ini
DATABASE_URL=postgresql://orders_app:local-password@localhost:5432/orders
STRIPE_WEBHOOK_SECRET=whsec_local_example
NODE_ENV=development
```

That file is convenient because the app can read `process.env.DATABASE_URL`.
The code does not need to know whether the value came from a file, a terminal export, or the container runtime.
It only needs the environment variable to exist when the process starts.

Production needs the same names, but not the same storage habit.
The production database URL includes a real username and password.
The Stripe webhook secret is what lets the service verify that incoming webhook events really came from Stripe.
If either value leaks, the team has a real incident because an attacker may be able to reach production data or forge trusted webhook events.

For production, the team wants each place to have one clear job.

| Place | What It Should Contain |
|-------|------------------------|
| Git repo | Source code and safe examples |
| Container image | App code and dependencies |
| Secrets Manager or Parameter Store | Private production values |
| ECS task definition | Secret names or ARNs, not secret values |
| Running ECS task | `DATABASE_URL` and `STRIPE_WEBHOOK_SECRET` at startup |

The important move is that the secret value is not baked into the app.
The app image can be promoted from staging to production without rebuilding it just to change a password.
The task definition points ECS at the secret store, and ECS injects the value when it starts the container.

Here is the first mental map:

```mermaid
graph TD
    REPO["Safe code and examples<br/>(repo)"] --> IMAGE["Code without secrets<br/>(container image)"]
    IMAGE --> ECS["Running app<br/>(ECS task)"]
    SM["Database URL secret<br/>(Secrets Manager)"] -.-> ECS
    SSM["Webhook secret<br/>(Parameter Store)"] -.-> ECS
    KMS["Stored value encryption<br/>(KMS key)"] -.-> SM
    KMS -.-> SSM
    IAM["Who may read<br/>(IAM permissions)"] -.-> ECS
```

Read the solid line as the deployment path.
Read the dotted lines as controlled lookups.
The app still sees environment variables, but the values come from AWS at task startup instead of from Git or the image.

That one pattern will carry most beginner services a long way.

## What Counts As A Secret

A beginner often thinks "secret" means "password."
Passwords are secrets, but the category is wider.

A database password is a secret because it lets a process connect to a database.
An API token is a secret because it lets a process call another service as your account.
A private key is a secret because it proves identity or decrypts data.
A signing key is a secret because it lets a process create trusted tokens.
A webhook token is a secret because it lets a process verify that a request came from the expected sender.

For `devpolaris-orders-api`, the first list looks like this:

| Value | Why It Is Secret | Example Environment Name |
|-------|------------------|--------------------------|
| Database connection string | Contains database username, password, host, and database name | `DATABASE_URL` |
| Stripe webhook signing token | Proves incoming webhook payloads are genuine | `STRIPE_WEBHOOK_SECRET` |
| JWT signing key | Lets the service create trusted login or session tokens | `JWT_SIGNING_KEY` |
| Third-party API token | Lets the service call another vendor account | `PAYMENTS_API_TOKEN` |
| Private key | Proves identity or decrypts private data | `PRIVATE_KEY_PEM` |

Some values are not secrets.
`NODE_ENV=production` is not secret.
`PORT=3000` is not secret.
`PUBLIC_BASE_URL=https://orders.devpolaris.com` is usually not secret.
Those values still belong in configuration, but they do not need the same handling as a password.

The easiest rule is this:
if someone can spend money, read private data, write private data, impersonate a system, or bypass a trust check with the value, treat it as a secret.

This rule is safer than asking whether the value "looks random."
Some secrets look ordinary.
A database URL looks like a normal string, but the password inside it is the dangerous part.
Some secrets are split across fields.
A username alone may not be secret, but a username plus password plus host can be enough to connect.

Names are also worth care.
The name `/prod/orders/DATABASE_URL` is fine.
The name `/prod/orders/customer-card-export-password-is-Tiger123` is not fine.
Secret names and parameter names are usually visible in more places than secret values.
Names should help operators find the value without containing the value.

## Where Secrets Do Not Belong

The most common secret leak is not a brilliant attack.
It is a private value copied into a normal engineering tool.

Secrets do not belong in Git.
Git remembers history.
If a secret is committed and later removed, the old commit still exists.
That commit may be in a teammate's clone, a CI cache, a fork, a pull request diff, or a backup.
Removing the line from the current branch does not make the old value safe again.
You usually need to rotate the secret, which means replace it with a new value and invalidate the old one.

Secrets do not belong in container images.
A Dockerfile like this is dangerous:

```text
ENV DATABASE_URL=postgresql://orders_app:real-password@orders-prod.abc.us-east-1.rds.amazonaws.com:5432/orders
```

That value becomes part of the image configuration or image layer history.
Anyone who can pull or inspect the image may find it.
Even if the container never prints the value, the image registry becomes a secret store by accident.
That is not what a registry is for.

Secrets do not belong in logs.
Logs are copied, searched, retained, exported, and shared during debugging.
CloudWatch Logs is useful exactly because many people and tools can inspect runtime evidence.
That same usefulness makes logs a terrible place for private values.

This startup log looks helpful for about five seconds:

```text
2026-04-18T10:31:22.419Z INFO  boot service=devpolaris-orders-api
2026-04-18T10:31:22.420Z INFO  env DATABASE_URL=postgresql://orders_app:prod-password@orders-prod.cluster.example.us-east-1.rds.amazonaws.com:5432/orders
2026-04-18T10:31:22.420Z INFO  env STRIPE_WEBHOOK_SECRET=whsec_live_example
```

Then you realize the log stream has become a leak.
The fix is not to hide the log line from one dashboard.
The fix is to stop logging secret values, rotate the leaked values, and redeploy the service with new secrets.

Secrets do not belong in tickets, chat messages, screenshots, or copied shell history.
A ticket can live for years.
A chat message can be forwarded.
A screenshot can land in a document.
A terminal history file can save the exact command you pasted.

This is why many teams keep `.env.example` in Git but not `.env`.
The example file teaches the names without storing the private values:

```ini
DATABASE_URL=
STRIPE_WEBHOOK_SECRET=
NODE_ENV=production
```

That tiny habit matters.
It lets a new developer understand what the app expects without putting the real production values in the repo.

## Secrets Manager: Store Secrets With A Lifecycle

AWS Secrets Manager is the AWS service most directly named for this job.
You store a secret value, give it a name, and control who can retrieve it.
Secrets Manager also supports secret versions and rotation workflows.
Rotation means changing the secret value on a schedule or during an incident, then moving applications to the new value.

Use Secrets Manager when the value is clearly a secret and its lifecycle matters.
Database credentials are a good fit.
OAuth client secrets are a good fit.
API tokens are a good fit.
A value that you may need to rotate after a leak is a good fit.

For `devpolaris-orders-api`, the database URL can live in Secrets Manager:

```text
Secret name:
  prod/orders/DATABASE_URL

Secret value:
  postgresql://orders_app:REDACTED@orders-prod.cluster-example.us-east-1.rds.amazonaws.com:5432/orders

Used by:
  ECS service devpolaris-orders-api
```

The word `REDACTED` is doing real work in this example.
You should be able to discuss the secret shape without copying the real password.
When you are writing docs, tickets, or diagrams, use placeholders that cannot accidentally connect to anything.

Secrets Manager stores more than one thing around the value.
It has the secret name, an ARN (Amazon Resource Name, the full AWS identifier for the secret), tags, version labels such as `AWSCURRENT`, and information about the KMS key used to encrypt the secret value.
The value is the sensitive part, but the metadata helps AWS and operators manage it.

A useful read-only diagnostic command is `describe-secret`.
It checks that the secret exists without printing the secret value:

```bash
$ aws secretsmanager describe-secret \
  --secret-id prod/orders/DATABASE_URL \
  --region us-east-1
{
  "ARN": "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-a1b2c3",
  "Name": "prod/orders/DATABASE_URL",
  "KmsKeyId": "alias/aws/secretsmanager",
  "LastChangedDate": "2026-04-18T09:22:11.000000+00:00",
  "VersionIdsToStages": {
    "2f7b8d4c-1111-2222-3333-abcdeexample": [
      "AWSCURRENT"
    ]
  }
}
```

Look at what this proves.
It proves the account and Region contain a secret with that name.
It shows the full ARN that ECS can reference.
It shows which KMS key is associated with the secret.
It does not print the database password.

That distinction is a practical habit.
Most diagnosis should start with metadata.
Only retrieve the secret value when you truly need to test a read path, and do it in a controlled terminal where output is not copied into logs or tickets.

## Parameter Store: Simple Namespaced Configuration

AWS Systems Manager Parameter Store is a simpler managed store for configuration values.
It can store ordinary strings, string lists, and encrypted `SecureString` values.
For a beginner, the most helpful feature is the path-like naming style.

You can organize values like this:

```text
/prod/orders/NODE_ENV
/prod/orders/PORT
/prod/orders/STRIPE_WEBHOOK_SECRET
/staging/orders/STRIPE_WEBHOOK_SECRET
```

The path makes environment and ownership visible.
`/prod/orders/STRIPE_WEBHOOK_SECRET` and `/staging/orders/STRIPE_WEBHOOK_SECRET` are different parameters.
That is useful because a lot of cloud mistakes are really "wrong environment" mistakes.

Parameter Store also works well for non-secret config that you want to centralize.
For sensitive values, use the `SecureString` type.
That tells Parameter Store to encrypt the parameter value with KMS.

For `devpolaris-orders-api`, the team might store the Stripe webhook secret as a `SecureString` parameter:

```text
Parameter name:
  /prod/orders/STRIPE_WEBHOOK_SECRET

Type:
  SecureString

Used by:
  ECS service devpolaris-orders-api
```

A beginner-friendly choice is:
use Secrets Manager for secrets where rotation and secret lifecycle are important.
Use Parameter Store for simpler namespaced configuration and simple encrypted values.

That is not a moral ranking.
Both services can hold sensitive data.
The tradeoff is about how much secret lifecycle machinery you need.
Secrets Manager gives more secret-specific features.
Parameter Store gives a simple path-based store that is easy to understand and easy to organize.

Here is a practical comparison:

| Need | Good First Choice | Why |
|------|-------------------|-----|
| Database password that may rotate | Secrets Manager | Secret versions and rotation workflows are part of the service |
| Simple encrypted app token | Parameter Store `SecureString` or Secrets Manager | Choose based on lifecycle and team convention |
| Non-secret config like port or feature flag | Parameter Store `String` | Central config without treating the value as secret |
| Secret shared by several AWS services | Secrets Manager or Parameter Store | Check which target service supports the reference style you need |

The important safety detail is that `SecureString` encrypts the value, not the whole idea of the parameter.
The parameter name and metadata still need sensible names.
Do not put private data in the parameter name.

For diagnosis, you can test whether the caller can decrypt a parameter while avoiding secret output:

```bash
$ aws ssm get-parameter \
  --name /prod/orders/STRIPE_WEBHOOK_SECRET \
  --with-decryption \
  --query 'Parameter.{Name:Name,Type:Type,Version:Version}' \
  --region us-east-1
{
  "Name": "/prod/orders/STRIPE_WEBHOOK_SECRET",
  "Type": "SecureString",
  "Version": 7
}
```

This command asks AWS to decrypt the value, so it tests the permission path.
The query prints only safe metadata.
That is a good debugging compromise when you need to know whether access works without spraying the secret into your terminal.

## ECS Injection: Give The Container Names, Not Values

ECS has a useful secret injection pattern.
In the task definition, you define environment variable names.
For non-secret values, you put literal values in `environment`.
For secret values, you put references in `secrets`.

The app still reads `process.env.DATABASE_URL`.
The difference is where the value came from before the process started.

Here is a simplified task definition snippet:

```json
{
  "family": "devpolaris-orders-api",
  "executionRoleArn": "arn:aws:iam::111122223333:role/devpolaris-orders-ecs-execution",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "111122223333.dkr.ecr.us-east-1.amazonaws.com/devpolaris-orders-api:2026-05-02-1",
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "3000"
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

The `name` field is the environment variable name inside the container.
The `valueFrom` field tells ECS where to fetch the value.
The app code does not need the secret ARN.
The app code reads `process.env.DATABASE_URL`, just like it did locally.

The `executionRoleArn` line matters.
The ECS task execution role is the role ECS uses to do setup work before your container is running.
For this secret injection pattern, that role needs permission to read the referenced secrets or parameters.

That role is not the same idea as the task role.
The task role is what your application code uses after the container starts, for example if the app calls S3 or DynamoDB directly.
For ECS injecting secrets into environment variables at startup, look first at the task execution role.

A tight first policy for this example looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:us-east-1:111122223333:parameter/prod/orders/STRIPE_WEBHOOK_SECRET"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab"
    }
  ]
}
```

The `kms:Decrypt` statement is only needed when the secret or parameter uses a customer managed KMS key that requires this permission.
If you use the default AWS managed key for the service, the permission path can be simpler.
The beginner lesson is not "always paste `kms:Decrypt` everywhere."
The lesson is "if a customer managed key protects the value, the read path may need permission to the secret and permission to the key."

Also notice the narrow resources.
The execution role does not need every secret in the account.
It needs the two values required to start `devpolaris-orders-api`.
That is least privilege in a form you can actually see.

One more practical detail:
when ECS injects a secret into an environment variable, the secret is now inside the running process environment.
That is useful, but the app must still protect the value after startup.
Your app must still avoid logging it, returning it in debug endpoints, or exposing it through crash dumps.

## KMS-Backed Encryption In Plain English

Encryption at rest means the stored bytes are encrypted while they sit in a service.
For Secrets Manager, the secret value is stored in encrypted form.
For Parameter Store `SecureString`, the parameter value is stored in encrypted form.
KMS is the AWS service that provides and controls the keys used for that encryption path.

That sounds like "the secret is safe now," but there is one more half of the story.
Encryption protects stored bytes.
IAM decides who can ask AWS to read or decrypt those bytes.

Those are related, but they are not the same thing.

Think about a locked filing cabinet.
Encryption is the lock on the drawer.
IAM permission is the rule that says who can ask the building manager for the key.
If the rule is too broad, the lock still works, but too many people can open it.

In AWS, the stored value is encrypted first.
Later, when ECS starts a task, ECS uses the task execution role to ask for the value.
AWS checks the IAM permission on the secret or parameter.
If a customer managed KMS key protects the value, AWS also checks the KMS permission path.
Only after those checks does AWS return plaintext to ECS so ECS can inject it into the container environment.

The stored value was encrypted at rest.
The running app still receives plaintext because the app cannot connect to the database with encrypted text.
That is normal.
The control is around who can ask for plaintext and where that plaintext goes next.

AWS KMS has several key types, but two are enough for a first production service.

An AWS managed key is created and managed by AWS for a service in your account.
It is the easy path for many first systems because you do not manage key policies or key lifecycle.

A customer managed key is a KMS key your team creates and controls.
It gives you more control over policy, audit, rotation settings, aliases, and deletion.
It also gives you one more thing to operate correctly.

That is the tradeoff.
Default service keys are simpler.
Customer managed keys give more control.
More control is useful when you need it, but it also creates more ways to break access.

For a first `devpolaris-orders-api` deployment, using the default AWS managed key for Secrets Manager or Parameter Store may be enough.
If the team later needs tighter audit boundaries, cross-team key control, or specific compliance rules, a customer managed key can make sense.
When that happens, the team must treat the KMS key policy as part of the application access path.

Use this diagnostic question: can the ECS task execution role read the secret, and if a customer managed KMS key is used, can it decrypt with that key?

If the answer to either half is no, the task may fail before your Node.js code even starts.

## Failure Modes And Diagnosis

Secrets fail in a few repeatable ways.
The good news is that the errors usually point at one of four questions:
is the permission right, is the name right, is the account and Region right, and did the running task restart after the value changed?

Start every diagnosis by checking the account and Region.
This sounds boring, but it saves time.

```bash
$ aws sts get-caller-identity
{
  "UserId": "AIDAEXAMPLEUSERID",
  "Account": "111122223333",
  "Arn": "arn:aws:iam::111122223333:user/maya"
}
```

If you expected the production account and this shows a sandbox account, stop.
You are asking the wrong workspace.
If you expected `us-east-1` and your command uses `eu-west-1`, stop.
You are asking the wrong location.

The first common ECS failure is missing permission.
The service tries to start a task, ECS tries to fetch the secret, and the task stops during initialization.

```bash
$ aws ecs describe-services \
  --cluster prod-orders \
  --services devpolaris-orders-api \
  --query 'services[0].events[0].message' \
  --region us-east-1
"service devpolaris-orders-api was unable to place a task because ResourceInitializationError: unable to retrieve secret from asm: AccessDeniedException: User: arn:aws:sts::111122223333:assumed-role/devpolaris-orders-ecs-execution/ecs-task is not authorized to perform: secretsmanager:GetSecretValue on resource: arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/orders/DATABASE_URL-a1b2c3"
```

That message tells you where to look.
Do not start by editing app code.
The app probably has not started.
Check the task execution role policy.
Make sure it allows `secretsmanager:GetSecretValue` for the secret ARN.
If the secret uses a customer managed KMS key, also check `kms:Decrypt` and the key policy.

The second common failure is wrong name, wrong ARN, wrong account, or wrong Region.
It looks different:

```bash
$ aws ecs describe-services \
  --cluster prod-orders \
  --services devpolaris-orders-api \
  --query 'services[0].events[0].message' \
  --region us-east-1
"service devpolaris-orders-api was unable to start a task because ResourceInitializationError: unable to retrieve secret from ssm: ParameterNotFound: /prod/order/STRIPE_WEBHOOK_SECRET"
```

The problem here is not encryption.
The task definition asks for `/prod/order/STRIPE_WEBHOOK_SECRET`, but the real path is `/prod/orders/STRIPE_WEBHOOK_SECRET`.
One missing `s` can stop a deployment.

Check the parameter directly:

```bash
$ aws ssm describe-parameters \
  --parameter-filters "Key=Name,Option=Equals,Values=/prod/orders/STRIPE_WEBHOOK_SECRET" \
  --query 'Parameters[*].{Name:Name,Type:Type,LastModifiedDate:LastModifiedDate}' \
  --region us-east-1
[
  {
    "Name": "/prod/orders/STRIPE_WEBHOOK_SECRET",
    "Type": "SecureString",
    "LastModifiedDate": "2026-04-18T09:17:02.000000+00:00"
  }
]
```

The output proves the correct parameter name exists in this account and Region.
Now compare it to the task definition.
The fix is to update the task definition reference, register a new revision, and deploy it.

The third common failure is a leak in logs.
The service starts fine, but a startup helper prints all environment variables.

```text
2026-04-18T10:31:22.419Z INFO  boot service=devpolaris-orders-api
2026-04-18T10:31:22.420Z INFO  config DATABASE_URL=postgresql://orders_app:prod-password@orders-prod.cluster-example.us-east-1.rds.amazonaws.com:5432/orders
2026-04-18T10:31:22.421Z INFO  config STRIPE_WEBHOOK_SECRET=whsec_live_example
```

Treat this as a secret incident.
Remove the logging behavior.
Rotate the database password and webhook secret.
Redeploy the task with the new values.
Check who could access the log group during the exposure window.

The fourth common failure is rotation without restart.
ECS injects secret values when the task starts.
If the secret changes later, an already-running container does not automatically rewrite its environment variables.
The old process keeps the old value until it restarts.

You can spot this by comparing the secret change time with the task start time:

```bash
$ aws secretsmanager describe-secret \
  --secret-id prod/orders/DATABASE_URL \
  --query '{Name:Name,LastChangedDate:LastChangedDate}' \
  --region us-east-1
{
  "Name": "prod/orders/DATABASE_URL",
  "LastChangedDate": "2026-04-18T09:22:11.000000+00:00"
}

$ aws ecs describe-tasks \
  --cluster prod-orders \
  --tasks arn:aws:ecs:us-east-1:111122223333:task/prod-orders/7ac4example \
  --query 'tasks[0].{LastStatus:lastStatus,StartedAt:startedAt,TaskDefinition:taskDefinitionArn}' \
  --region us-east-1
{
  "LastStatus": "RUNNING",
  "StartedAt": "2026-04-18T08:57:44.000000+00:00",
  "TaskDefinition": "arn:aws:ecs:us-east-1:111122223333:task-definition/devpolaris-orders-api:42"
}
```

The task started before the secret changed.
If the database password was rotated at `09:22`, this task may still hold the old password from `08:57`.
For an ECS service, force a new deployment so ECS starts fresh tasks:

```bash
$ aws ecs update-service \
  --cluster prod-orders \
  --service devpolaris-orders-api \
  --force-new-deployment \
  --region us-east-1
{
  "service": {
    "serviceName": "devpolaris-orders-api",
    "status": "ACTIVE",
    "desiredCount": 2,
    "runningCount": 2,
    "pendingCount": 0
  }
}
```

The exact rollout behavior depends on your ECS service settings, but the principle is stable.
If the secret is injected at startup, new secret value means new task startup.

Here is the short diagnostic path to keep close:

1. Confirm account with `aws sts get-caller-identity`.
2. Confirm Region on every command and ARN.
3. Confirm the secret or parameter exists with metadata commands first.
4. Read ECS service events for `ResourceInitializationError`.
5. Check the task execution role for `secretsmanager:GetSecretValue` or `ssm:GetParameters`.
6. Check `kms:Decrypt` and the KMS key policy when using a customer managed key.
7. Search logs for accidental secret output.
8. After rotation, confirm tasks restarted after the secret changed.

That path keeps you from guessing.
It also keeps you from printing secret values just to prove something exists.

## A Shipping Checklist

Before you ship `devpolaris-orders-api` with production secrets, walk through the system like a reviewer who wants the release to be boring.

The repo should contain code and safe examples only.
It can have `.env.example`.
It should not have `.env`, production JSON secret files, private keys, copied AWS CLI outputs with secret values, or screenshots of secret pages.

The container image should be reusable across environments.
It should not contain production `ENV DATABASE_URL=...` lines.
It should not copy a local `.env` file into the image.
The same image should be able to run in staging or production by changing deployment configuration, not by rebuilding with a different password.

The secret store should have clear names.
Use names like `prod/orders/DATABASE_URL` or `/prod/orders/STRIPE_WEBHOOK_SECRET`.
Keep the value out of the name.
Use tags if your team uses tags for owner, app, environment, or cost center.

The task definition should separate plain config from secret config.
Literal `environment` entries are fine for `NODE_ENV` and `PORT`.
Secret references belong in `secrets`.
Use full ARNs when that avoids account or Region confusion.

The task execution role should be narrow.
It should read the secrets or parameters needed by this service.
It should not read every production secret.
If a customer managed KMS key protects the secret, the role needs the correct KMS permission path too.

The application should treat environment variables as sensitive after startup.
Do not print full config objects.
Do not expose debug endpoints that dump `process.env`.
Do not include secret values in thrown errors.
When you need to log configuration, log presence, version, or safe names, not values.

This kind of startup log is useful:

```text
2026-04-18T10:45:03.129Z INFO  boot service=devpolaris-orders-api
2026-04-18T10:45:03.130Z INFO  config DATABASE_URL=present
2026-04-18T10:45:03.130Z INFO  config STRIPE_WEBHOOK_SECRET=present
2026-04-18T10:45:03.131Z INFO  config NODE_ENV=production
```

It tells the operator the app found the required settings.
It does not reveal the private values.

The runbook should say what happens during rotation.
For ECS secret injection, include the step to force a new deployment or otherwise restart tasks.
Without that step, you may successfully rotate the value in AWS while the running service keeps using the old value.

The tradeoff is simple enough to remember:
Secrets Manager gives you more secret lifecycle features.
Parameter Store gives you a simple namespaced store that is excellent for many configuration values.
KMS-backed encryption protects stored bytes.
IAM and key policies decide who can ask AWS to turn those bytes back into plaintext.

That is the beginner model you need before the details get larger.

---

**References**

- [What is AWS Secrets Manager?](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) - Official overview of Secrets Manager, including secret retrieval, storage outside source code, and rotation.
- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) - Official guide to Parameter Store, parameter types, hierarchy, and `SecureString` values.
- [Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html) - Official ECS guidance for passing secrets from Secrets Manager or Parameter Store into containers.
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html) - Official details on the execution role permissions needed for ECS secret and parameter retrieval.
- [AWS KMS keys](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html) - Official KMS guide to AWS owned keys, AWS managed keys, customer managed keys, and key identifiers.
- [KMS key access and permissions](https://docs.aws.amazon.com/kms/latest/developerguide/control-access.html) - Official guide to how key policies, IAM policies, and grants control access to KMS keys.
