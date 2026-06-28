---
title: "Runtime Configuration and Safe Rollouts"
description: "Manage AWS runtime configuration, secrets, feature flags, ECS/Lambda release candidates, traffic shifting, and config rollback as one workflow."
overview: "A safe AWS rollout needs more than a new image or function package. This article explains how runtime settings, secrets, IAM permissions, feature flags, candidate versions, traffic controls, and rollback records fit together during one production change."
tags: ["configuration", "secrets", "ecs", "lambda", "rollouts"]
order: 2
id: article-cloud-providers-aws-deployment-runtime-operations-runtime-config-secrets-and-environment-variables
aliases:
  - runtime-configuration-and-safe-rollouts
  - runtime-configuration-safe-rollouts
  - aws-runtime-configuration-and-safe-rollouts
  - article-cloud-providers-aws-deployment-runtime-operations-runtime-configuration-safe-rollouts
  - runtime-config-secrets-and-environment-variables
  - config-and-secrets
  - cloud-providers/aws/deployment-runtime-operations/runtime-config-secrets-and-environment-variables.md
  - cloud-providers/aws/deployment-runtime-operations/03-config-secrets.md
---

## Table of Contents

1. [Configuration Is Part of the Rollout](#configuration-is-part-of-the-rollout)
2. [Plain Configuration and Startup Validation](#plain-configuration-and-startup-validation)
3. [Secrets and Rotation](#secrets-and-rotation)
4. [Feature Flags and Candidate Behavior](#feature-flags-and-candidate-behavior)
5. [Move Traffic Safely](#move-traffic-safely)
6. [Configuration Rollback](#configuration-rollback)
7. [A Config Incident Review](#a-config-incident-review)
8. [Official References](#official-references)

## Configuration Is Part of the Rollout
<!-- section-summary: Runtime configuration controls how the same artifact behaves in one environment. -->

The release from the previous article moved `orders-api` from task definition `orders-api:41` to `orders-api:42`. Now look at the part that usually causes the most quiet production trouble: the values around the code. The same image can behave differently in development, staging, and production because each environment supplies different endpoints, table names, timeouts, feature flags, secrets, and IAM permissions.

**Runtime configuration** means the values the application reads while it runs. Some values are plain settings, such as `LOG_LEVEL`, `PAYMENT_ENDPOINT`, or `RECEIPT_PREFIX`. Some values are secrets, such as API tokens and database passwords. Some values are flags that decide who sees a new behavior. Configuration is part of the rollout because a wrong value can break production while the artifact itself is perfectly healthy.

For this article, follow `checkout-api`, an ECS service that handles normal checkout traffic, and `checkout-handler`, a Lambda function that handles payment webhooks. The new release needs `PAYMENT_ENDPOINT`, `PAYMENT_API_SECRET`, `CHECKOUT_V2_PERCENT`, and permission to write audit events to S3. The rollout plan should answer five practical questions:

| Question | Release answer |
|---|---|
| Where does the value live? | ECS task definition, Lambda environment, Parameter Store, Secrets Manager, AppConfig, or a deployment-managed file |
| Who can read it? | ECS task role, Lambda execution role, deployment role, or a narrow operator role |
| How does the app load it? | At startup, per request, through a cache, or through a flag/config client |
| How does the team verify it? | CLI read, startup log, smoke test, IAM simulation, and runtime behavior |
| How does rollback work? | Previous task definition, previous parameter version, previous secret stage, previous flag rule, or previous alias target |

Those questions give the rest of the article its path. First we handle plain configuration, then secrets, then flags, then traffic movement, then rollback.

![The configuration layers show how one artifact can run differently through environment settings, secret references, flags, roles, and startup validation](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-runtime-config-secrets-and-environment-variables/runtime-configuration-layers.png)

*The configuration layers show how one artifact can run differently through environment settings, secret references, flags, roles, and startup validation.*


## Plain Configuration and Startup Validation
<!-- section-summary: Plain settings should be traceable, validated at startup, and tied to the runtime that reads them. -->

**Plain configuration** holds values that are safe for the application process to know and safe enough to appear in release notes. Examples include a table name, endpoint URL, timeout, log level, feature percentage, or S3 prefix. Plain settings still need release discipline. A wrong endpoint or missing table name can send traffic to the wrong dependency or crash every task during startup.

For ECS, plain environment variables often live inside the task definition. This small task definition fragment shows the shape:

```json
{
  "name": "checkout-api",
  "image": "123456789012.dkr.ecr.eu-west-2.amazonaws.com/checkout-api@sha256:9d8b7f6a5e4c3b2a111111111111111111111111111111111111111111111111",
  "environment": [
    {
      "name": "PAYMENT_ENDPOINT",
      "value": "https://payments.example.com/live"
    },
    {
      "name": "RECEIPT_PREFIX",
      "value": "receipts-v2/"
    },
    {
      "name": "CHECKOUT_V2_PERCENT",
      "value": "10"
    }
  ]
}
```

`image` points to the artifact by digest, so the task definition knows the exact package. `PAYMENT_ENDPOINT` tells the app where to send payment requests. `RECEIPT_PREFIX` decides where receipt PDFs are written. `CHECKOUT_V2_PERCENT` controls how much behavior the application exposes after the candidate starts. The next action after changing this fragment is to register a new task definition revision and verify that the running service uses that revision.

Some teams store shared plain settings in Systems Manager Parameter Store. That gives the value a path, a version number, and a modification time:

```bash
aws ssm get-parameter \
  --name /prod/orders/payment-endpoint \
  --region eu-west-2 \
  --query 'Parameter.{Name:Name,Type:Type,Version:Version,LastModifiedDate:LastModifiedDate,Value:Value}'
```

Example output:

```json
{
  "Name": "/prod/orders/payment-endpoint",
  "Type": "String",
  "Version": 12,
  "LastModifiedDate": "2026-06-24T09:55:37.174000+00:00",
  "Value": "https://payments.example.com/live"
}
```

`Name` proves the app and operator are talking about the same path. `Version` gives rollback a concrete target. `LastModifiedDate` places the change in the release timeline. `Value` is acceptable in this example because the setting is plain configuration. The next action is to compare the value and version with the release record, then confirm whether the application reads the parameter at startup or refreshes it while running.

Application code should validate required settings before it accepts traffic. Here is a small Node.js example:

```js
const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const percent = Number(process.env.CHECKOUT_V2_PERCENT ?? "0");
if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
  throw new Error("CHECKOUT_V2_PERCENT must be an integer from 0 to 100");
}

export const runtimeConfig = {
  paymentEndpoint: required("PAYMENT_ENDPOINT"),
  receiptPrefix: required("RECEIPT_PREFIX"),
  checkoutV2Percent: percent,
  logLevel: process.env.LOG_LEVEL ?? "info"
};
```

The helper turns missing required values into startup failures instead of hidden runtime surprises. `CHECKOUT_V2_PERCENT` receives a numeric validation because percentages outside `0` to `100` have no safe meaning. `LOG_LEVEL` falls back to `info`, so the app can operate with a clear default. The next action is to make the startup failure visible through task events and logs, then keep the load balancer from sending traffic to tasks that fail readiness.

For Lambda, environment variables are part of the function configuration and published version workflow. If the function reads configuration during initialization, a version or alias change may be needed before the runtime sees the new value. Write that reload behavior in the release plan so rollback has a documented path.

## Secrets and Rotation
<!-- section-summary: Secrets need managed storage, scoped IAM access, and a deployment path that respects refresh behavior. -->

A **secret** is a value that grants access: a payment provider token, database password, signing key, webhook secret, or private API credential. Put secrets in AWS Secrets Manager or encrypted Parameter Store parameters instead of source code, Docker images, tickets, screenshots, or release notes.

In ECS, a task definition can reference a Secrets Manager secret and inject it into the container environment when the task starts:

```json
{
  "secrets": [
    {
      "name": "PAYMENT_API_SECRET",
      "valueFrom": "arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders/payment-AbCdEf"
    }
  ]
}
```

`name` is the environment variable visible to the container process. `valueFrom` points to the secret location without printing the secret value. The secret is resolved when the task starts, so existing tasks may keep the old value after rotation. The next action after changing or rotating this secret is to replace tasks, refresh the application cache, or confirm that the runtime fetches the value on demand.

Use `describe-secret` for metadata during a release because it avoids printing the secret value:

```bash
aws secretsmanager describe-secret \
  --secret-id arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders/payment-AbCdEf \
  --region eu-west-2 \
  --query '{ARN:ARN,RotationEnabled:RotationEnabled,LastChangedDate:LastChangedDate,LastRotatedDate:LastRotatedDate,VersionStages:VersionIdsToStages}'
```

Example output:

```json
{
  "ARN": "arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders/payment-AbCdEf",
  "RotationEnabled": true,
  "LastChangedDate": "2026-06-24T09:48:02.000000+00:00",
  "LastRotatedDate": "2026-06-24T09:48:02.000000+00:00",
  "VersionStages": {
    "a1b2c3d4-1111-2222-3333-444455556666": [
      "AWSCURRENT"
    ],
    "b2c3d4e5-2222-3333-4444-555566667777": [
      "AWSPREVIOUS"
    ]
  }
}
```

`RotationEnabled` shows whether the secret follows the team's rotation policy. `LastChangedDate` and `LastRotatedDate` place the secret in the release timeline. `AWSCURRENT` marks the version new clients should read, and `AWSPREVIOUS` marks the prior version where Secrets Manager keeps one. The next action is to confirm the runtime role can read the secret and that the app refresh path matches the rotation plan.

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/prod-checkout-task-role \
  --action-names secretsmanager:GetSecretValue \
  --resource-arns arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders/payment-AbCdEf \
  --region eu-west-2 \
  --query 'EvaluationResults[].{Action:EvalActionName,Decision:EvalDecision,Resource:EvalResourceName}'
```

Example output:

```json
[
  {
    "Action": "secretsmanager:GetSecretValue",
    "Decision": "allowed",
    "Resource": "arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders/payment-AbCdEf"
  }
]
```

`allowed` means the role policy path grants the read action for the tested secret ARN. The next action is a real smoke test because KMS key policies, secret resource policies, organization guardrails, and application code still participate in the final request. If the decision is `implicitDeny`, add the narrow permission before the candidate tasks start.

![The rotation path shows how current and previous secret versions, validation, and a rollback window reduce config-change risk](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-runtime-config-secrets-and-environment-variables/secret-rotation-path.png)

*The rotation path shows how current and previous secret versions, validation, and a rollback window reduce config-change risk.*


## Feature Flags and Candidate Behavior
<!-- section-summary: Feature flags separate deploying a candidate from exposing the candidate behavior to every user. -->

A **feature flag** is a runtime switch that controls behavior for selected users, tenants, accounts, percentages, or environments. It lets a team deploy code first, prove the runtime is healthy, then expose the new behavior gradually. That separation is useful for checkout changes because the service can start with the new code and keep `CHECKOUT_V2_PERCENT` at `0` while the team checks startup, logs, and dependencies.

Flags need ownership. Every temporary flag should have a purpose, default, rollout rule, owner, cleanup date, and disable path. A forgotten flag leaves two production paths alive, which doubles test coverage, alert interpretation, and incident response work.

A small flag document might look like this:

```json
{
  "checkoutV2": {
    "enabled": true,
    "defaultTreatment": "v1",
    "rules": [
      {
        "name": "employees",
        "tenantIds": [
          "internal"
        ],
        "treatment": "v2"
      },
      {
        "name": "canary-percent",
        "percent": 10,
        "treatment": "v2"
      }
    ],
    "owner": "payments-team",
    "expiresOn": "2026-07-31",
    "disableAction": "set enabled=false"
  }
}
```

`enabled` is the quick disable switch. `defaultTreatment` keeps most users on the known path. The first rule enables the feature for an internal tenant, and the second rule sends 10 percent of eligible traffic to version 2. `owner` and `expiresOn` make cleanup part of the release instead of a future mystery. The next action is to make logs and metrics include the treatment, such as `checkoutTreatment=v2`, so verification can separate old and new behavior.

AWS AppConfig can manage hosted configuration and feature flags with validators and deployment strategies. Some teams use LaunchDarkly, Unleash, a database table, or a Parameter Store value. The tool choice matters less than four operations: audited change, staged rollout, fast disable path, and clear ownership.

For a simple Parameter Store-backed percentage flag, an operator might stage a small increase like this:

```bash
aws ssm put-parameter \
  --name /prod/orders/flags/checkout-v2-percent \
  --type String \
  --value "10" \
  --overwrite \
  --region eu-west-2 \
  --query '{Version:Version,Tier:Tier}'
```

Example output:

```json
{
  "Version": 7,
  "Tier": "Standard"
}
```

`Version` is the new parameter version after the flag update. The next action is to verify how the application reloads the flag. If the app reads it at startup, replace tasks or restart the runtime. If the app polls it through a config client, wait for the configured refresh interval and confirm logs show the new flag version.

## Move Traffic Safely
<!-- section-summary: Safe rollout moves candidate traffic only while runtime and user-facing signals stay healthy. -->

After settings, secrets, permissions, and flags are ready, the rollout can move traffic. Traffic movement should match the runtime. ECS rolling deployments replace tasks under the service scheduler. Lambda aliases can split invocations between a primary version and a weighted candidate version. CodeDeploy can coordinate blue/green patterns and alarms for supported ECS and Lambda deployments.

For ECS, a release often updates the service to a new task definition:

```bash
aws ecs update-service \
  --cluster prod-web \
  --service checkout-api \
  --task-definition checkout-api:58 \
  --deployment-configuration minimumHealthyPercent=100,maximumPercent=200 \
  --region eu-west-2 \
  --query 'service.{Service:serviceName,TaskDefinition:taskDefinition,Desired:desiredCount,Deployments:deployments[].{Status:status,TaskDefinition:taskDefinition,Running:runningCount,Pending:pendingCount,Rollout:rolloutState}}'
```

Example output:

```json
{
  "Service": "checkout-api",
  "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:58",
  "Desired": 4,
  "Deployments": [
    {
      "Status": "PRIMARY",
      "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:58",
      "Running": 1,
      "Pending": 3,
      "Rollout": "IN_PROGRESS"
    },
    {
      "Status": "ACTIVE",
      "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:57",
      "Running": 4,
      "Pending": 0,
      "Rollout": "COMPLETED"
    }
  ]
}
```

`minimumHealthyPercent=100` asks ECS to keep full desired healthy capacity while replacing tasks. `maximumPercent=200` allows extra tasks during the rollout if capacity is available. The output shows the new revision as `PRIMARY` and still in progress. The next action is to watch target health, service events, logs, and user-facing checks until the primary deployment reaches the desired count and old tasks drain.

For Lambda, an alias can keep version `16` as the primary production version while sending 10 percent of alias traffic to version `17`:

```bash
aws lambda update-alias \
  --function-name checkout-handler \
  --name prod \
  --function-version 16 \
  --routing-config '{"AdditionalVersionWeights":{"17":0.1}}' \
  --region eu-west-2 \
  --query '{Name:Name,FunctionVersion:FunctionVersion,RoutingConfig:RoutingConfig}'
```

Example output:

```json
{
  "Name": "prod",
  "FunctionVersion": "16",
  "RoutingConfig": {
    "AdditionalVersionWeights": {
      "17": 0.1
    }
  }
}
```

`FunctionVersion` is the primary version for the alias. `AdditionalVersionWeights` sends 10 percent to version `17`. The next action is to run smoke tests through the alias, then watch errors, duration, throttles, downstream failures, and business checks for the candidate version. If event sources are involved, confirm which alias or function version receives those events because queue and stream rollouts need special attention.

Traffic movement also needs capacity. ECS rolling deployments may temporarily run old and new tasks together. Lambda can increase concurrency if the candidate runs slower. A safe rollout checks CPU, memory, database connections, downstream quotas, queue age, and throttles while traffic moves.

![The rollout visual shows traffic steps, health gates, and the rollback arrow back to the previous version and config](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-runtime-config-secrets-and-environment-variables/traffic-shifting-rollback.png)

*The rollout visual shows traffic steps, health gates, and the rollback arrow back to the previous version and config.*


## Configuration Rollback
<!-- section-summary: Configuration rollback needs the previous values, previous versions, and reload steps. -->

Rollback should include code, traffic, configuration, secrets, IAM, and flags. Returning an ECS service to the previous task definition may restore environment variables embedded in that task definition. Shared Parameter Store values, AppConfig deployments, and secret stages need their own rollback record because the old code may read them at runtime.

Parameter Store history gives a concrete rollback source:

```bash
aws ssm get-parameter-history \
  --name /prod/orders/payment-endpoint \
  --region eu-west-2 \
  --query 'Parameters[-3:].{Version:Version,LastModifiedDate:LastModifiedDate,Value:Value}'
```

Example output:

```json
[
  {
    "Version": 10,
    "LastModifiedDate": "2026-06-20T12:10:04.100000+00:00",
    "Value": "https://payments.example.com/live"
  },
  {
    "Version": 11,
    "LastModifiedDate": "2026-06-23T15:22:51.900000+00:00",
    "Value": "https://payments-canary.example.com/live"
  },
  {
    "Version": 12,
    "LastModifiedDate": "2026-06-24T09:55:37.174000+00:00",
    "Value": "https://payments.example.com/live"
  }
]
```

The output shows the recent versions and values for a plain setting. The rollback candidate depends on the release record and incident evidence. If version `12` caused the issue, version `11` or `10` may be the previous safe value. The next action is to restore the selected value, record the new version created by the restore, and reload any runtime that reads the value at startup.

```bash
aws ssm put-parameter \
  --name /prod/orders/payment-endpoint \
  --type String \
  --value "https://payments.example.com/live" \
  --overwrite \
  --region eu-west-2 \
  --query '{Version:Version}'
```

Example output:

```json
{
  "Version": 13
}
```

The restore creates a new parameter version rather than deleting history. The next action is to replace or refresh the runtime. For ECS tasks that read the parameter only at startup, force a new deployment after restoring the value:

```bash
aws ecs update-service \
  --cluster prod-web \
  --service checkout-api \
  --force-new-deployment \
  --region eu-west-2 \
  --query 'service.deployments[].{Status:status,TaskDefinition:taskDefinition,Rollout:rolloutState}'
```

Example output:

```json
[
  {
    "Status": "PRIMARY",
    "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:58",
    "Rollout": "IN_PROGRESS"
  }
]
```

`--force-new-deployment` starts replacement tasks from the current task definition so startup-loaded configuration is read again. The next action is to watch target health and logs until the new tasks are healthy and the bad configuration symptom disappears.

Secrets need a different rollback conversation. If a rotated secret broke the release, confirm whether `AWSPREVIOUS` is still accepted by the dependency, whether the app can use that version, and whether restoring the old value creates security risk. IAM rollback should use the previous policy document or managed policy version. Feature flag rollback should use the previous rule or the quick disable path.

## A Config Incident Review
<!-- section-summary: A config incident review traces the bad behavior to the value, secret, flag, identity, and reload path that changed. -->

At 15:10, checkout errors spike after the rollout. ECS says tasks are running, and target health is green. Users receive payment failures. The release record says `PAYMENT_ENDPOINT` changed from a sandbox migration test back to the live provider before traffic moved, so the team starts with configuration evidence.

```bash
aws ecs describe-task-definition \
  --task-definition checkout-api:58 \
  --region eu-west-2 \
  --query 'taskDefinition.containerDefinitions[?name==`checkout-api`].environment'
```

Example output:

```json
[
  [
    {
      "name": "PAYMENT_ENDPOINT_PARAM",
      "value": "/prod/orders/payment-endpoint"
    },
    {
      "name": "CHECKOUT_V2_PERCENT",
      "value": "10"
    }
  ]
]
```

The task definition contains a parameter path rather than the endpoint directly. The next action is to inspect that parameter version and value.

```bash
aws ssm get-parameter \
  --name /prod/orders/payment-endpoint \
  --region eu-west-2 \
  --query 'Parameter.{Version:Version,LastModifiedDate:LastModifiedDate,Value:Value}'
```

Example output:

```json
{
  "Version": 12,
  "LastModifiedDate": "2026-06-24T15:02:44.221000+00:00",
  "Value": "https://payments-sandbox.example.com"
}
```

The value points to the sandbox provider in production, and the modification time sits just before the error spike. The next action is to restore the live endpoint value, force new ECS tasks because the app reads the parameter at startup, and run a checkout smoke test. After recovery, add startup validation that rejects sandbox endpoints in production, include the parameter version in release notes, and add a smoke test that checks the configured provider before traffic moves.

This review teaches the general loop. Name the runtime value, find where the app reads it, inspect the current version, compare it with the release record, restore or disable the bad value, reload the runtime, and verify with user-facing behavior.

## Official References

- [Amazon ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html)
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)
- [Manage Lambda function versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)
- [Create a Lambda alias](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
- [Lambda weighted aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)
- [Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [What is AWS Secrets Manager?](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
- [Rotate AWS Secrets Manager secrets](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)
- [What is AWS AppConfig?](https://docs.aws.amazon.com/appconfig/latest/userguide/what-is-appconfig.html)
- [AWS AppConfig feature flags](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-type-reference-feature-flags.html)
- [IAM policy simulator API](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)
