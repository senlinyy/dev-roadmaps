---
title: "Secrets, Encryption, And Security Evidence"
description: "Store private runtime values in AWS, control who can read them, and verify safe use with logs, metadata, and CloudTrail evidence."
overview: "Production secrets need more than a hidden string. Learn where passwords, tokens, and private config live in AWS, how encryption fits in, and what evidence proves the app used them safely."
tags: ["secrets-manager", "parameter-store", "kms", "cloudtrail"]
order: 4
id: article-cloud-providers-aws-identity-security-secrets-encryption-basics
aliases:
  - secrets-and-encryption-basics
  - cloud-providers/aws/identity-security/secrets-and-encryption-basics.md
---

## Table of Contents

1. [What Counts As A Secret?](#what-counts-as-a-secret)
2. [Why .env Does Not Scale To Production](#why-env-does-not-scale-to-production)
3. [Secrets As AWS Resources](#secrets-as-aws-resources)
4. [Who Can Read The Secret?](#who-can-read-the-secret)
5. [Encryption And KMS In Plain English](#encryption-and-kms-in-plain-english)
6. [Evidence: Logs, CloudTrail, And Failed Reads](#evidence-logs-cloudtrail-and-failed-reads)
7. [Quick Recap](#quick-recap)

## What Counts As A Secret?

The secrets article starts after a support ticket, not after a product comparison.
The orders API deploys cleanly, but payment webhooks begin failing.
A developer opens the app logs and sees that `PAYMENT_WEBHOOK_SECRET` is missing in production.
Someone asks whether they can paste the value into the task definition to get the service moving.

That is the moment for the real question:

> Where do passwords, tokens, and private config live, and how do I know they were used safely?

On a laptop, a `.env` file made the app feel simple.
The developer copied a database URL, a webhook signing token, and a few harmless settings.
The app started.
Nothing about that local loop taught the team where the same values should live once containers, deploy pipelines, logs, and support roles are involved.

A secret is any value that grants access, proves identity, signs data, decrypts data, or lets another system trust your app.
The shape does not matter.
A secret may look like a password, token, connection string, private key, signing secret, or vendor API key.
The test is the damage if the wrong person or process copies it.

For `devpolaris-orders-api`, the private values are not all the same:

| Value | Why It Is Secret |
|-------|------------------|
| Database URL with password | Lets the app connect to production order data |
| Payment webhook signing secret | Lets the app verify trusted payment events |
| Vendor API token | Lets the app call another service as DevPolaris |
| Private key material | Can prove identity or decrypt protected data |

Some configuration is not secret.
`PORT=3000`, `NODE_ENV=production`, and `PUBLIC_BASE_URL=https://orders.devpolaris.com` may be important, but they do not usually grant access by themselves.
Putting every setting in a secret store makes operations noisier without improving security.
The sensitive values need a stronger path because they carry authority.

The guiding questions are:

- What value would cause damage if copied?
- Where does that value live in AWS?
- Which app, runtime, or human role can read it?
- How is the stored value encrypted?
- What evidence proves the app received it without printing it?
- What happens when the value rotates?

We will follow the missing webhook secret through those questions.

## Why .env Does Not Scale To Production

The local file looked like this:

```ini
DATABASE_URL=postgresql://orders_app:local-password@localhost:5432/orders
PAYMENT_WEBHOOK_SECRET=whsec_local_example
NODE_ENV=development
```

That workflow is fine for development.
The file sits in one workspace and contains development values.
The app reads environment variables, so the code does not care whether the values came from a shell export, a local file, or a container runtime.

Production changes the risk because the same value can travel through many systems.
If the team pastes the real webhook secret into a task definition, that value may appear in deployment history, copied JSON, terminal scrollback, support tickets, screenshots, or internal chat.
If the app prints its environment during startup, the secret moves into logs.
If somebody adds the value as a tag, it moves into inventory and billing search paths.

The problem is not environment variables by themselves.
Many apps still read secret values from environment variables at process start.
The problem is where the value is stored, who can read it, and what evidence is left behind.

The production path should give each part a clear job:

```text
Secrets Manager or Parameter Store:
  stores the sensitive value

IAM:
  controls who can read it

ECS, EC2, Lambda, or app code:
  delivers the value to the process at runtime

Logs and CloudTrail:
  prove what happened without printing the value
```

That path takes more setup than copying `.env`.
The payoff is control.
The team can rotate the secret, inspect metadata, audit reads and writes, and debug startup without spreading the private value into every operational surface.

## Secrets As AWS Resources

The missing webhook secret needs a home before the app can receive it safely.
In AWS, that home should be a managed resource with a name, ARN, metadata, version history, permissions, and audit trail.
AWS Secrets Manager is the first service to recognize for values with a real secret lifecycle.
AWS Systems Manager Parameter Store is nearby and can store encrypted `SecureString` parameters.

The choice should follow the value's job.
The database password may need rotation tied to the database user.
The webhook secret may need incident rotation if a provider key leaks.
A simple encrypted setting may fit the team's existing Parameter Store convention.
Public config does not need a secret store at all.

For the orders API, the team chooses this shape:

```text
orders/prod/database
orders/prod/payment-webhook
```

A safe metadata check for the webhook secret might look like:

```bash
$ aws secretsmanager describe-secret \
>   --secret-id orders/prod/payment-webhook \
>   --region us-east-1
{
  "ARN": "arn:aws:secretsmanager:us-east-1:333333333333:secret:orders/prod/payment-webhook-AbCdEf",
  "Name": "orders/prod/payment-webhook",
  "KmsKeyId": "arn:aws:kms:us-east-1:333333333333:key/1111-2222-3333-4444",
  "LastChangedDate": "2026-05-13T10:02:31Z",
  "VersionIdsToStages": {
    "a1b2c3": ["AWSCURRENT"]
  },
  "Tags": [
    { "Key": "service", "Value": "orders-api" },
    { "Key": "env", "Value": "prod" },
    { "Key": "owner", "Value": "checkout" }
  ]
}
```

This output does not print the secret value.
It proves the resource exists, shows which KMS key protects it, shows when it changed, and gives ownership metadata.
That is enough for many support checks.

Rotation is where the resource model pays off.
Changing the value in the secret store is not always the whole rollout.
If ECS injects the secret at startup, old tasks keep the value they received.
If the payment provider has a matching value, the provider and AWS secret have to move together.
If the new value breaks verification, the team needs enough evidence to know whether the app received the new value.

The rotation story is operational:

```text
1. Create or receive the new provider secret.
2. Update the AWS secret value.
3. Replace tasks that received the old value at startup.
4. Check webhook verification logs.
5. Retire the old provider value after the cutover is healthy.
```

Secrets are not just hidden strings.
They are resources with lifecycle.

## Who Can Read The Secret?

After the secret has a home, the next question is who can read it.
This is where the missing webhook ticket can fork in two directions.
If ECS injects the value into the container at startup, ECS needs permission through the task execution role.
If the application calls Secrets Manager while running, the application uses the task role.

Those identities are easy to confuse because they are both attached to the same task definition.
They do different jobs:

| Access Pattern | Identity That Usually Needs Permission | What It Does |
|----------------|-----------------------------------------|--------------|
| ECS injects secret into the container at startup | Task execution role | Lets ECS fetch the value before the container starts |
| App code reads the secret at runtime | Task role | Lets the app call Secrets Manager itself |
| Deploy pipeline registers a task definition | Deploy role | References the secret ARN |
| Support checks metadata | Support role | Reads safe metadata, not necessarily the value |
| Emergency operator reads the value | Break-glass role | Rare, logged, and justified |

For a first ECS design, startup injection is often the simplest path.
The task definition names the environment variable and points to the secret ARN.
The task definition should not contain the value.

```json
{
  "containerDefinitions": [
    {
      "name": "orders-api",
      "secrets": [
        {
          "name": "PAYMENT_WEBHOOK_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:333333333333:secret:orders/prod/payment-webhook-AbCdEf"
        }
      ]
    }
  ]
}
```

The application still reads `process.env.PAYMENT_WEBHOOK_SECRET`.
That keeps the app code simple.
The security work happens around storage, delivery, and permissions.

Startup injection has a tradeoff.
It is easy for app code, but a changed secret usually requires replacing running tasks before the app sees the new value.
Runtime fetching lets an app refresh a value more deliberately, but it adds code, caching, retry behavior, and direct `GetSecretValue` permission for the app.
Choose the simpler path until the app has a real reason to refresh secrets while running.

## Encryption And KMS In Plain English

Encryption enters the story after the secret has a home and a reader.
It is important, but it is not the same question as permission.
AWS KMS, Key Management Service, manages cryptographic keys used by many AWS services.
Secrets Manager can use KMS to encrypt secret values at rest.

The path is:

```mermaid
flowchart TD
    STORE["secret resource"] --> KEY["KMS key"]
    APP["approved caller"] --> STORE
    STORE --> VALUE["plaintext returned to caller"]
```

KMS helps protect stored secret material.
IAM controls which caller can ask for the value.
The app still owns safe handling after the value arrives.
If the app logs the webhook secret, encryption at rest did its job and the application still leaked the value.

That split avoids a common false comfort.
"The secret is encrypted" does not mean every use is safe.
It means the stored material has cryptographic protection.
The team still needs narrow read permissions, safe delivery, careful logs, and a rotation process.

For the support ticket, this matters because the team can inspect safe metadata without exposing the plaintext.
They can see the secret's ARN, tags, KMS key, and last changed time.
They should not print the value unless a tightly controlled emergency workflow requires it.

## Evidence: Logs, CloudTrail, And Failed Reads

The final question is how the team proves the secret was used safely.
The orders API should leave enough evidence to debug startup and webhook verification without copying the secret into the evidence.

A good startup log proves presence, not content:

```text
2026-05-13T09:15:41Z INFO boot service=orders-api env=prod revision=42
2026-05-13T09:15:41Z INFO config name=PAYMENT_WEBHOOK_SECRET present=true source=ecs-secret-reference
2026-05-13T09:15:43Z INFO payment_webhook verification=ready
```

A bad startup log prints the value:

```text
PAYMENT_WEBHOOK_SECRET=whsec_real_prod_value
```

That line creates a new incident.
The secret now lives in log storage and any downstream system that indexed or exported the log.
The fix is not only "delete the line."
The team should remove exposed logs where possible, rotate the secret, and add logging safeguards so the value is not printed again.

CloudTrail can show secret API activity without showing the private value:

```json
{
  "eventTime": "2026-05-13T09:10:02Z",
  "eventSource": "secretsmanager.amazonaws.com",
  "eventName": "GetSecretValue",
  "awsRegion": "us-east-1",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::333333333333:assumed-role/orders-api-task-role/ecs-task-42"
  },
  "requestParameters": {
    "secretId": "orders/prod/payment-webhook"
  }
}
```

This event says the orders API task role requested the payment webhook secret.
It does not print the value.
That is the kind of evidence operators need.

When a secret issue appears, keep the diagnosis connected to the story:

| Symptom | First Check | Likely Direction |
|---------|-------------|------------------|
| Missing env var | Task definition secret reference and execution role | Fix startup injection path |
| `AccessDenied` on `GetSecretValue` | Caller role, action, secret ARN | Fix role attachment or narrow allow |
| `KMSAccessDeniedException` | KMS key policy and decrypt permission | Check the key path |
| App has old value | Task age and last deployment | Replace tasks after rotation |
| Secret value appears in logs | Logging code and redaction | Remove leaked logs and rotate value |

Evidence keeps the team from treating every secret problem as the same problem.
Missing variable, denied read, bad key policy, stale task, and leaked log each have a different fix.

## Quick Recap

The webhook ticket began with a missing environment value.
The safe fix was not to paste the secret into the nearest config file.
It was to give the value a managed home, control who can read it, and leave evidence that does not expose the value.

| Question | Answer Habit |
|----------|--------------|
| What counts as a secret? | Any value that grants access, proves identity, signs data, or protects trust |
| Why does `.env` not scale? | Production values get copied into too many systems to control |
| Where should secrets live? | In Secrets Manager or an intentional encrypted parameter path |
| Who can read the secret? | Only the runtime, pipeline, or human role with a real job |
| What does KMS do? | Protects encrypted stored material, not app behavior after receipt |
| What evidence proves safe use? | Metadata, CloudTrail, safe app logs, health checks, and no leaked values |

Secret handling is good when it becomes boring.
The value has one managed home.
The app has one controlled path to receive it.
Operators can prove what happened without seeing the value.

---

**References**

- [What is AWS Secrets Manager?](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) - Used for the model of storing, retrieving, managing, and rotating secrets outside source code.
- [Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html) - Used for ECS startup injection from Secrets Manager or Parameter Store and the need to refresh tasks after secret changes.
- [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) - Used for the nearby `SecureString` option and hierarchical parameter naming model.
- [AWS KMS cryptographic details](https://docs.aws.amazon.com/kms/latest/cryptographic-details/basic-concepts.html) - Used for the plain-English explanation of keys protecting encrypted data.
- [Logging AWS Secrets Manager events with AWS CloudTrail](https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring-cloudtrail.html) - Used for the CloudTrail evidence path around secret API activity and failed reads.
- [Tagging best practices](https://docs.aws.amazon.com/whitepapers/latest/tagging-best-practices/tagging-best-practices.html) - Used for the warning that tags are operational metadata and should not contain sensitive information.
