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

1. [What This Article Covers](#what-this-article-covers)
2. [Runtime Configuration](#runtime-configuration)
3. [Environment Variables and Parameter Values](#environment-variables-and-parameter-values)
4. [How To Change Runtime Settings](#how-to-change-runtime-settings)
5. [Feature Flags In Real Teams](#feature-flags-in-real-teams)
6. [Secrets Manager and Parameter Store](#secrets-manager-and-parameter-store)
7. [How To Wire Secrets Into A Runtime](#how-to-wire-secrets-into-a-runtime)
8. [Config Rollback](#config-rollback)
9. [Candidate Version](#candidate-version)
10. [ECS Service Deployments](#ecs-service-deployments)
11. [Lambda Versions and Aliases](#lambda-versions-and-aliases)
12. [ALB and CodeDeploy Traffic Shifting](#alb-and-codedeploy-traffic-shifting)
13. [EKS and GitOps Rollouts](#eks-and-gitops-rollouts)
14. [Rollback Shape](#rollback-shape)
15. [Putting It All Together](#putting-it-all-together)
16. [What's Next](#whats-next)

## What This Article Covers
<!-- section-summary: Runtime settings and rollout controls belong in one release conversation because both decide what production users experience. -->

The previous article treated an AWS release as the full production story around a change. This article zooms into one very common release moment: a candidate is ready, and now the team must decide which runtime values it receives and how much production traffic it should touch.

We will keep using `devpolaris-orders-api`, the checkout API. The new candidate adds receipt upload retry. That sounds like a small code change, but the release depends on several runtime pieces at the same time. The retry branch needs a feature flag. It needs a retry count and timeout. It needs a receipt bucket name. It needs a secret for an external receipt scanning service. It needs the ECS task role or Lambda execution role to call the right AWS APIs. It also needs a traffic control path so the team can expose the candidate gradually and recover quickly.

Here is the shape of the article. First, we talk about **runtime configuration**, **environment variables**, **parameter values**, **feature flags**, **Secrets Manager**, **Parameter Store**, and **config rollback**. Then we talk about **candidate versions**, **ECS service deployments**, **Lambda versions and aliases**, **ALB and CodeDeploy traffic shifting**, **EKS and GitOps rollouts**, and **rollback shape**. In production, these ideas sit in the same release record because a safe rollout needs the right code and the right runtime state.

## Runtime Configuration
<!-- section-summary: Runtime configuration is the environment-specific state that AWS gives the application after the artifact starts. -->

**Runtime configuration** is the set of values a running application reads from its hosting environment. These values include environment variables, parameter names, secret references, feature flag keys, endpoint names, queue URLs, bucket names, telemetry settings, and sometimes platform settings such as task count or timeout values.

The important detail is that runtime configuration changes application behavior while the artifact can stay the same. The same container image can run in staging with staging values and in production with production values. The same Lambda code package can run behind a `dev` alias or a `prod` alias with different environment variables. The code package tells AWS which code to run. Runtime configuration tells that code which outside systems to call and which branches to take.

For the orders API, the candidate image contains the receipt retry code. These values decide what that code actually does in production:

```yaml
CHECKOUT_RECEIPT_RETRY_ENABLED: "true"
CHECKOUT_RECEIPT_RETRY_ATTEMPTS: "3"
RECEIPTS_BUCKET: devpolaris-prod-receipts
RECEIPT_SCAN_ENDPOINT: https://scan.receipts.internal.devpolaris.example
RECEIPT_SCAN_API_TOKEN:
  source: AWS Secrets Manager
  secret_id: orders/prod/receipt-scan-api-token
```

Every row carries release risk. If `CHECKOUT_RECEIPT_RETRY_ENABLED` turns on too early, the team sends real checkout traffic through a branch that only saw test traffic. If `RECEIPTS_BUCKET` points to a staging bucket, receipt upload may succeed while production receipts land in the wrong place. If the secret reference points to a missing value, the candidate can start and then fail only when a receipt upload needs scanning.

That is why runtime configuration deserves the same review as the image digest. A release record that names only the candidate image tells half of the story. The artifact says which code AWS runs. Configuration says what that code connects to, which permissions it needs, and which behavior users receive.

## Environment Variables and Parameter Values
<!-- section-summary: Environment variables and parameters are ordinary runtime inputs, and teams should review them before changing production behavior. -->

An **environment variable** is a key-value string that AWS injects into the process environment. ECS exposes environment variables from the container definition inside a task definition. Lambda exposes environment variables from the function configuration. The application reads them through normal language APIs such as `process.env` in Node.js.

A **parameter value** is configuration stored outside the code, usually in a service such as AWS Systems Manager Parameter Store. Parameter Store gives teams a hierarchical place for config such as `/orders/prod/receipt-retry-attempts`, `/orders/prod/receipt-bucket`, or `/orders/prod/log-level`. It can also store encrypted `SecureString` values, although many teams prefer Secrets Manager for credentials that need rotation.

Here is the Node.js shape inside `devpolaris-orders-api`. The code reads the runtime values once during startup, validates them, and gives the rest of the application a typed settings object:

```js
const retryEnabled = process.env.CHECKOUT_RECEIPT_RETRY_ENABLED === "true";
const retryAttempts = Number.parseInt(
  process.env.CHECKOUT_RECEIPT_RETRY_ATTEMPTS || "1",
  10
);
const receiptsBucket = process.env.RECEIPTS_BUCKET;

if (!receiptsBucket) {
  throw new Error("RECEIPTS_BUCKET is required");
}

if (!Number.isInteger(retryAttempts) || retryAttempts < 1 || retryAttempts > 5) {
  throw new Error("CHECKOUT_RECEIPT_RETRY_ATTEMPTS must be between 1 and 5");
}

export const runtimeSettings = {
  retryEnabled,
  retryAttempts,
  receiptsBucket
};
```

This code is small, but it shows a production habit that matters. The application validates required settings at startup and fails before it serves traffic. That gives ECS, Lambda, or Kubernetes a clear failure signal. A missing bucket name should fail the candidate during deployment, before the first customer reaches checkout.

A settings review should name old values, new values, ownership, and expected behavior. It should avoid secret plaintext while still recording the secret coordinate. This is the kind of YAML a release owner can place in a pull request, release issue, or deployment record:

```yaml
settings_review:
  service: devpolaris-orders-api
  change: receipt upload retry
  environment: production
  values:
    CHECKOUT_RECEIPT_RETRY_ENABLED:
      old: "false"
      new: "true"
      expected_effect: checkout can use the retry branch after rollout starts
    CHECKOUT_RECEIPT_RETRY_ATTEMPTS:
      old: "1"
      new: "3"
      expected_effect: receipt upload retries up to three total attempts
    RECEIPTS_BUCKET:
      old_target: devpolaris-prod-receipts
      new_target: devpolaris-prod-receipts
      expected_effect: production receipts stay in the production bucket
    RECEIPT_SCAN_API_TOKEN:
      old_secret_id: orders/prod/receipt-scan-api-token
      new_secret_id: orders/prod/receipt-scan-api-token
      expected_effect: token source stays stable while the candidate changes
```

This review also catches a quiet class of mistakes. If a pull request changes an image and a Terraform variable at the same time, the release owner can see both. If GitHub Actions deploys the image while Terraform or OpenTofu manages the task definition, the release record should tie the pipeline run and infrastructure plan together.

## How To Change Runtime Settings
<!-- section-summary: Changing runtime settings means creating a new runtime contract, deploying it, and checking which version AWS now runs. -->

On ECS, environment variables live in the **task definition**. A task definition is the versioned launch specification for tasks. AWS describes it as the blueprint for your application because it names the image, CPU, memory, ports, environment variables, secret references, roles, and logging settings. When a setting changes, the team usually registers a new task definition revision and updates the ECS service to run it.

This example uses `jq` to create a new task definition JSON from the current production definition. It changes the retry flag and retry attempts, then registers a new revision. Real teams often generate this file through Terraform, OpenTofu, AWS CDK, CloudFormation, or a deployment action, but the CLI flow helps you see what actually changes.

```bash
aws ecs describe-task-definition \
  --task-definition devpolaris-orders-api \
  --query taskDefinition \
  --output json > taskdef-current.json

jq '
  del(
    .taskDefinitionArn,
    .revision,
    .status,
    .requiresAttributes,
    .compatibilities,
    .registeredAt,
    .registeredBy
  )
  | .containerDefinitions[0].environment =
    (
      [.containerDefinitions[0].environment[] | select(.name != "CHECKOUT_RECEIPT_RETRY_ENABLED" and .name != "CHECKOUT_RECEIPT_RETRY_ATTEMPTS")]
      + [
        {"name":"CHECKOUT_RECEIPT_RETRY_ENABLED","value":"true"},
        {"name":"CHECKOUT_RECEIPT_RETRY_ATTEMPTS","value":"3"}
      ]
    )
' taskdef-current.json > taskdef-v31.json

aws ecs register-task-definition \
  --cli-input-json file://taskdef-v31.json
```

After the new task definition revision exists, the ECS service update points the service to that revision. The `deploymentCircuitBreaker` option can ask ECS to fail and roll back a deployment when the service fails to reach steady state, which helps catch candidates that crash or fail health checks during rollout.

```bash
aws ecs update-service \
  --cluster prod-platform \
  --service devpolaris-orders-api \
  --task-definition devpolaris-orders-api:31 \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},minimumHealthyPercent=100,maximumPercent=200"
```

Then the release owner describes the service and checks what AWS is actually doing. This is the proof step. It shows deployment state, rollout state, task definition revision, desired task count, and running task count.

```bash
aws ecs describe-services \
  --cluster prod-platform \
  --services devpolaris-orders-api \
  --query "services[0].deployments[].{id:id,status:status,rolloutState:rolloutState,taskDefinition:taskDefinition,desired:desiredCount,running:runningCount,failed:failedTasks}" \
  --output table
```

Lambda has a different runtime surface. Environment variables live on the unpublished function configuration and then become part of a published version. If the orders API receipt worker runs as Lambda, the team updates function configuration, publishes a version, and moves an alias such as `prod` only after the version is ready.

```bash
aws lambda update-function-configuration \
  --function-name devpolaris-orders-receipt-worker \
  --environment "Variables={CHECKOUT_RECEIPT_RETRY_ENABLED=true,CHECKOUT_RECEIPT_RETRY_ATTEMPTS=3,RECEIPTS_BUCKET=devpolaris-prod-receipts}"

aws lambda publish-version \
  --function-name devpolaris-orders-receipt-worker \
  --description "v31 receipt upload retry"
```

Changing a setting is a release because AWS has to start new tasks, publish a new function version, or roll Kubernetes pods. The next question is how to change behavior without tying every decision to a full deployment. That is where feature flags fit.

## Feature Flags In Real Teams
<!-- section-summary: Feature flags let a team deploy code separately from enabling the risky behavior for users. -->

A **feature flag** is a runtime decision point. The code contains both paths, and the flag decides which path runs for a request, tenant, cohort, region, or environment. Teams use flags because they separate deployment from exposure. The candidate can reach ECS or Lambda while the risky receipt retry branch stays off, then the team can enable it for a small group after the runtime looks healthy.

AWS teams choose from several flag providers. Some teams keep simple flags in Parameter Store or AWS AppConfig. Many teams use LaunchDarkly, Unleash, ConfigCat, or another product because they need targeting rules, approvals, audit history, and fast rollback from a UI. **OpenFeature** is a vendor-neutral API that can sit between application code and the flag provider, so the application asks for `checkout.receiptRetry` without hardcoding one provider's SDK across the codebase.

Here is the orders API reading a flag through OpenFeature. The default is `false` because the safe production behavior is to keep the new retry branch off if the flag system gives no answer:

```js
import { OpenFeature } from "@openfeature/server-sdk";

const featureClient = OpenFeature.getClient();

export async function shouldRetryReceiptUpload(user) {
  return featureClient.getBooleanValue("checkout.receiptRetry", false, {
    userId: user.id,
    tenant: user.tenant,
    environment: "production"
  });
}
```

The flag record should live beside the deployment record. It names the key, source of truth, default behavior, owner, rollout rule, and rollback action:

```yaml
feature_flag_review:
  key: checkout.receiptRetry
  source_of_truth: LaunchDarkly or Unleash
  default_value: false
  initial_rule:
    enabled_for: 5 percent of checkout traffic
    excluded_tenants:
      - enterprise-contract-tests
  owner: platform-api-oncall
  rollback_action: set checkout.receiptRetry to false
```

Feature flags and traffic shifting solve related but different problems. Traffic shifting decides which runtime version receives a request. A feature flag decides which code path runs inside that runtime version. A strong rollout can use both. The team can deploy task definition `devpolaris-orders-api:31`, send 10 percent of ALB traffic to it, and enable `checkout.receiptRetry` for 5 percent of eligible users.

Flags still need discipline. A flag that stays in the code forever turns into a second production system with hidden branches. A release record should include the cleanup plan once the retry behavior is the normal path. In real teams, the flag owner usually creates a follow-up ticket to remove the old branch after the rollout completes and the watch window stays clean.

## Secrets Manager and Parameter Store
<!-- section-summary: Secrets Manager and Parameter Store keep sensitive and shared configuration outside code and task definition plaintext. -->

**AWS Secrets Manager** stores sensitive values such as passwords, API tokens, database credentials, and webhook signing keys. It encrypts secrets with AWS KMS, supports versions, supports rotation workflows, and gives teams an audit trail through AWS APIs. For the orders API, the receipt scanning API token belongs here because leaking it could let another system impersonate the checkout service.

**AWS Systems Manager Parameter Store** stores configuration in a hierarchical path structure. Teams often use it for ordinary values such as `/orders/prod/retry-attempts`, `/orders/prod/receipt-bucket`, or `/orders/prod/log-level`. Parameter Store also supports `SecureString` values encrypted by KMS. In many production systems, Parameter Store holds non-secret config and references, while Secrets Manager holds credentials that need richer rotation and version handling.

The difference matters because ECS task definitions can expose plain environment variables to anyone who has permission to describe the task definition. AWS documentation recommends storing sensitive data in Secrets Manager or Parameter Store rather than plain task definition environment values. A task definition should contain a secret coordinate while the secret plaintext stays in the managed store.

Here is the release record for the receipt scanning token. Notice that it names the secret and expected IAM access without exposing the token value:

```yaml
secret_review:
  runtime: ecs
  setting: RECEIPT_SCAN_API_TOKEN
  source: AWS Secrets Manager
  secret_id: orders/prod/receipt-scan-api-token
  expected_version_stage: AWSCURRENT
  consumer_identity: arn:aws:iam::111122223333:role/devpolaris-orders-api-task
  required_permissions:
    - secretsmanager:GetSecretValue
    - kms:Decrypt
  verification:
    - candidate task starts
    - receipt scan smoke test succeeds
    - CloudTrail shows access from the expected task role
```

Secrets Manager versions add one more release tool. A secret can have staging labels such as `AWSCURRENT`, `AWSPREVIOUS`, and `AWSPENDING`. If a new secret value breaks the candidate, the team can move the label back to the previous known-good version. That is a configuration rollback, so the previous version ID should be recorded before the release starts.

Adjacent tools also appear here in real teams. Vault may be the central secret system for a multi-cloud company. SOPS may encrypt Kubernetes secret manifests in Git before Argo CD applies them. Those tools can fit AWS deployments well, but the release habit stays the same: the runtime should receive a secret reference or decrypted value through a controlled path, and the release record should keep plaintext secrets out.

## How To Wire Secrets Into A Runtime
<!-- section-summary: Secret wiring is concrete when the runtime has a secret reference, IAM permission, and a verification step. -->

For ECS, secret wiring lives in the container definition. The `secrets` array maps an environment variable name to a Secrets Manager or Parameter Store ARN. ECS uses the task execution path to fetch and inject the value when the task starts, and the application reads it as an environment variable inside the container.

```json
{
  "containerDefinitions": [
    {
      "name": "api",
      "image": "111122223333.dkr.ecr.eu-west-2.amazonaws.com/devpolaris-orders-api@sha256:7a31b5",
      "environment": [
        { "name": "CHECKOUT_RECEIPT_RETRY_ENABLED", "value": "true" },
        { "name": "CHECKOUT_RECEIPT_RETRY_ATTEMPTS", "value": "3" },
        { "name": "RECEIPTS_BUCKET", "value": "devpolaris-prod-receipts" }
      ],
      "secrets": [
        {
          "name": "RECEIPT_SCAN_API_TOKEN",
          "valueFrom": "arn:aws:secretsmanager:eu-west-2:111122223333:secret:orders/prod/receipt-scan-api-token-AbCdEf"
        }
      ]
    }
  ]
}
```

Two IAM roles commonly appear in ECS secret debugging. The **task execution role** belongs to the ECS startup machinery that pulls images, writes logs, and injects secrets. The **task role** belongs to the application code after the task is running. If the application itself calls Secrets Manager at runtime, the task role needs permission. If ECS injects the secret at startup, the execution role needs the read path. Many incidents come from granting the permission to the wrong role.

Here is a focused IAM statement for secret injection. A real policy may add conditions for KMS keys, VPC endpoints, resource tags, or account boundaries:

```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue",
    "kms:Decrypt"
  ],
  "Resource": [
    "arn:aws:secretsmanager:eu-west-2:111122223333:secret:orders/prod/receipt-scan-api-token-*",
    "arn:aws:kms:eu-west-2:111122223333:key/12345678-1234-1234-1234-123456789012"
  ]
}
```

For Lambda, the same principle applies through a different runtime surface. You can store a secret ARN in an environment variable and let the function code fetch the secret with the Lambda execution role. Some teams use the AWS Parameters and Secrets Lambda Extension so the function can retrieve and cache values with less custom code. The release review should still name the secret coordinate, the execution role, and the verification step.

```bash
aws lambda update-function-configuration \
  --function-name devpolaris-orders-receipt-worker \
  --environment "Variables={RECEIPT_SCAN_SECRET_ID=orders/prod/receipt-scan-api-token,RECEIPTS_BUCKET=devpolaris-prod-receipts}"
```

The verification should use the application path and the AWS control plane. A successful `describe-task-definition` proves the reference exists. A checkout smoke test proves the process can actually read the value, call the scanning service, and write the receipt to the expected bucket.

## Config Rollback
<!-- section-summary: Config rollback restores known-good runtime values when a setting, parameter, secret, or flag causes production trouble. -->

**Config rollback** means returning runtime values to a known-good state. It can involve an environment variable, feature flag, Parameter Store value, Secrets Manager version label, IAM permission, timeout, or traffic setting. It often recovers faster than rebuilding an artifact because the team can restore the value that changed.

Imagine the rollout sends 10 percent of traffic to task definition `devpolaris-orders-api:31`. Checkout failures rise, and logs show `ReceiptScanUnauthorized` from the retry path. The team has several possible first moves. If the retry branch causes the problem, turn the flag off. If the secret value changed, move `AWSCURRENT` back to the previous version. If the candidate task lacks permission, move traffic back to the stable task definition while the IAM policy is fixed through Terraform or OpenTofu.

A rollback record should name the previous values before the release starts:

```yaml
config_rollback:
  CHECKOUT_RECEIPT_RETRY_ENABLED:
    current_candidate_value: "true"
    previous_stable_value: "false"
    restore_action: register task definition with value "false" or disable the feature flag
  CHECKOUT_RECEIPT_RETRY_ATTEMPTS:
    current_candidate_value: "3"
    previous_stable_value: "1"
    restore_action: restore previous task definition or parameter value
  RECEIPT_SCAN_API_TOKEN:
    current_secret_stage: AWSCURRENT
    previous_secret_version_id: 6f4c2d9a-2e5a-41a8-930d-0a1111111111
    restore_action: move AWSCURRENT back to the previous version if token rotation caused failure
  RECEIPTS_BUCKET:
    current_target: devpolaris-prod-receipts
    previous_target: devpolaris-prod-receipts
    restore_action: no config rollback expected
```

Here are the practical restore moves. For ECS environment variables, the most reliable path is to redeploy a known-good task definition revision. If revision `30` has the stable values, point the service back to it:

```bash
aws ecs update-service \
  --cluster prod-platform \
  --service devpolaris-orders-api \
  --task-definition devpolaris-orders-api:30

aws ecs describe-services \
  --cluster prod-platform \
  --services devpolaris-orders-api \
  --query "services[0].deployments[].{status:status,rolloutState:rolloutState,taskDefinition:taskDefinition,running:runningCount}" \
  --output table
```

For Parameter Store, restore the previous value and then redeploy or restart the runtime path that reads it. If the app reads the parameter only at startup, existing tasks may keep the old in-memory value until replacement:

```bash
aws ssm put-parameter \
  --name /orders/prod/receipt-retry-attempts \
  --type String \
  --value "1" \
  --overwrite
```

For Secrets Manager, move the staging label back to the previous version. The exact version IDs should come from the release record or a pre-release `list-secret-version-ids` check:

```bash
aws secretsmanager update-secret-version-stage \
  --secret-id orders/prod/receipt-scan-api-token \
  --version-stage AWSCURRENT \
  --move-to-version-id 6f4c2d9a-2e5a-41a8-930d-0a1111111111 \
  --remove-from-version-id 2a8d930c-8b7c-4f93-a111-222222222222
```

Config rollback should be boring and specific. The team should know which value to restore, where to restore it, which runtime will pick it up, and which metric proves the restore helped.

## Candidate Version
<!-- section-summary: A candidate version is the specific runtime version being evaluated before or during production exposure. -->

A **candidate version** is the exact runtime version the team wants to evaluate for production. It includes the artifact and the runtime contract around it. On ECS, that usually means a task definition revision, image digest, environment variables, secret references, IAM roles, health checks, desired count, and deployment configuration. On Lambda, it means a published function version plus alias routing. On EKS, it means a Kubernetes Deployment revision, image digest, ConfigMap, Secret, ServiceAccount, and ingress rule.

The word "candidate" helps because deployment can happen before full exposure. ECS can start replacement tasks before every user reaches them. Lambda can publish version `31` while the `prod` alias still points mostly at version `30`. EKS can create new pods and wait for readiness before the rollout replaces old pods.

Here is a candidate record for the orders API on ECS:

```yaml
candidate:
  platform: Amazon ECS on Fargate
  cluster: prod-platform
  service: devpolaris-orders-api
  task_definition: devpolaris-orders-api:31
  image: 111122223333.dkr.ecr.eu-west-2.amazonaws.com/devpolaris-orders-api@sha256:7a31b5
  task_role: arn:aws:iam::111122223333:role/devpolaris-orders-api-task
  execution_role: arn:aws:iam::111122223333:role/devpolaris-orders-api-execution
  config:
    CHECKOUT_RECEIPT_RETRY_ENABLED: "true"
    CHECKOUT_RECEIPT_RETRY_ATTEMPTS: "3"
  secrets:
    RECEIPT_SCAN_API_TOKEN: orders/prod/receipt-scan-api-token
  direct_checks:
    - task reaches RUNNING
    - target group health is healthy
    - checkout smoke test passes
    - receipt upload writes to devpolaris-prod-receipts
```

The record gives the release owner a real object to inspect. If CloudWatch logs show errors from `devpolaris-orders-api:31`, the team knows which image, settings, secret references, and roles were active. If rollback uses `devpolaris-orders-api:30`, the team also knows the previous runtime contract to restore.

## ECS Service Deployments
<!-- section-summary: ECS service deployments replace tasks according to service deployment settings while health checks protect availability. -->

An **ECS service deployment** is the process of moving an ECS service from one service revision to another. For the common rolling deployment path, ECS starts tasks from the new task definition and stops old tasks according to deployment settings such as `minimumHealthyPercent` and `maximumPercent`. The Application Load Balancer target group health check decides which tasks can receive traffic.

For `devpolaris-orders-api`, the stable service runs task definition `30`. The candidate is task definition `31`. The release owner updates the service, watches the deployment state, and checks the load balancer target health before calling the rollout good.

```bash
aws ecs update-service \
  --cluster prod-platform \
  --service devpolaris-orders-api \
  --task-definition devpolaris-orders-api:31 \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},minimumHealthyPercent=100,maximumPercent=200"

aws ecs describe-services \
  --cluster prod-platform \
  --services devpolaris-orders-api \
  --query "services[0].deployments[].{status:status,rolloutState:rolloutState,rolloutStateReason:rolloutStateReason,taskDefinition:taskDefinition,desired:desiredCount,running:runningCount,pending:pendingCount}" \
  --output table
```

The deployment circuit breaker protects a specific failure class. If the new tasks fail to reach steady state, ECS can mark the deployment failed and roll back to the last completed deployment. That helps with crashes, bad health checks, missing secret permissions during startup, or images that fail during boot. Business monitoring still matters because a candidate can reach steady state and still increase checkout errors when a retry branch behaves badly under real user traffic.

The release owner should pair ECS deployment state with application evidence. For the orders API, the watch window should include checkout success rate, p95 checkout latency, receipt upload failures, ALB target 5xx, ECS task restarts, and logs filtered by task definition revision. A deployment that reaches `COMPLETED` in ECS still needs business health before the team promotes the release record to complete.

If the team uses GitHub Actions, the workflow should record the task definition revision, image digest, AWS account, region, and service update result. If the team uses Terraform or OpenTofu to manage the ECS service, the plan should show the task definition and deployment configuration change before apply. The production habit is to keep the AWS control-plane state and the source-controlled release evidence aligned.

## Lambda Versions and Aliases
<!-- section-summary: Lambda versions and aliases give serverless teams a stable name for production and a controlled path to shift traffic. -->

A **Lambda version** is an immutable snapshot of a function's code and configuration. A **Lambda alias** is a stable name, such as `prod`, that points to a version. Aliases can also use weighted routing so a small percentage of invocations goes to a second version. This gives Lambda teams a rollout control that looks similar to a canary.

For the receipt flow, imagine the scanning work moved out of the API and into `devpolaris-orders-receipt-worker`. The team publishes version `31`, keeps alias `prod` on version `30`, then sends 10 percent of invocations to version `31`:

```bash
aws lambda publish-version \
  --function-name devpolaris-orders-receipt-worker \
  --description "v31 receipt upload retry"

aws lambda update-alias \
  --function-name devpolaris-orders-receipt-worker \
  --name prod \
  --function-version 30 \
  --routing-config '{"AdditionalVersionWeights":{"31":0.10}}'
```

The alias now has a stable production name and a weighted candidate. Most invocations use version `30`, and 10 percent use version `31`. If the watch window looks healthy, the team can move more weight to `31` or point the alias fully at version `31`:

```bash
aws lambda update-alias \
  --function-name devpolaris-orders-receipt-worker \
  --name prod \
  --function-version 31 \
  --routing-config '{}'
```

Rollback uses the same alias. The team points `prod` back to the stable version and clears the weighted route:

```bash
aws lambda update-alias \
  --function-name devpolaris-orders-receipt-worker \
  --name prod \
  --function-version 30 \
  --routing-config '{}'
```

Lambda config still matters. Environment variables, IAM permissions, event source settings, concurrency, timeouts, and secrets all belong in the release record. A weighted alias protects exposure while the release record still has to catch a candidate that points to the wrong bucket or lacks permission to call Secrets Manager.

## ALB and CodeDeploy Traffic Shifting
<!-- section-summary: ALB target groups and CodeDeploy let teams run blue and green ECS revisions with controlled traffic movement and rollback hooks. -->

An **Application Load Balancer target group** is a set of backend targets that can receive traffic from an ALB listener rule. In ECS, tasks register into target groups. A simple rolling deployment uses one production target group. A blue/green deployment uses two target groups so the old service revision and new service revision can run side by side.

**CodeDeploy** can manage ECS blue/green deployments. The blue side is the current production revision. The green side is the candidate revision. CodeDeploy can create the replacement task set, wait for health, route test traffic, shift production traffic, run lifecycle hooks, and roll back if alarms fire. AWS also supports ECS blue/green deployment controls directly in newer ECS workflows, but many teams still know this pattern through CodeDeploy.

Here is a release record showing the ALB pieces. The point is to make routing visible before traffic moves:

```yaml
alb_codedeploy_rollout:
  application: devpolaris-orders-api
  deployment_group: orders-api-prod
  listener:
    prod: arn:aws:elasticloadbalancing:eu-west-2:111122223333:listener/app/orders-prod/abc/prod
    test: arn:aws:elasticloadbalancing:eu-west-2:111122223333:listener/app/orders-prod/abc/test
  target_groups:
    blue: arn:aws:elasticloadbalancing:eu-west-2:111122223333:targetgroup/orders-api-blue/1111
    green: arn:aws:elasticloadbalancing:eu-west-2:111122223333:targetgroup/orders-api-green/2222
  candidate_task_definition: devpolaris-orders-api:31
  alarms:
    - orders-api-5xx-rate-high
    - orders-api-checkout-p95-high
```

A CodeDeploy deployment can start from an AppSpec file that names the ECS service, task definition, container, port, and hooks. This example is shortened, but it shows the pieces a release owner should recognize:

```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: arn:aws:ecs:eu-west-2:111122223333:task-definition/devpolaris-orders-api:31
        LoadBalancerInfo:
          ContainerName: api
          ContainerPort: 3000
Hooks:
  - AfterAllowTestTraffic: arn:aws:lambda:eu-west-2:111122223333:function:orders-api-smoke-test
  - AfterAllowTraffic: arn:aws:lambda:eu-west-2:111122223333:function:orders-api-watch-window-check
```

The ALB health check should stay lightweight. It should prove that the API process can receive traffic and is ready to handle requests. Deep dependency checks, such as calling every downstream system, can create noisy task replacement during a temporary dependency blip. The release watch window should use deeper CloudWatch metrics, traces, logs, and synthetic checks beside the load balancer health signal.

Traffic shifting gives the team a controlled blast radius. It also requires compatibility. During a canary or blue/green deployment, old and new versions may run at the same time. The orders API `v30` and `v31` must agree on database schema, SQS message shape, receipt object keys, and API response contracts while traffic is split.

## EKS and GitOps Rollouts
<!-- section-summary: EKS rollouts use Kubernetes objects, and GitOps teams make the desired rollout state visible in Git. -->

Amazon EKS runs Kubernetes, so the rollout vocabulary changes. The candidate usually appears as a new image digest in a Kubernetes `Deployment`, new values in a `ConfigMap`, references to a `Secret`, a `ServiceAccount` with IAM Roles for Service Accounts, and ingress or service mesh routing rules. Kubernetes rolling updates use settings such as `maxUnavailable` and `maxSurge` to control how pods are replaced.

Many EKS teams use **Helm** to package Kubernetes manifests and **Argo CD** to sync the desired state from Git into the cluster. This pattern is called GitOps. The pull request acts as the release review surface. It can show the image digest, ConfigMap changes, External Secrets references, IAM role annotation, rollout strategy, and rollback commit.

Here is a small Helm values fragment for the orders API candidate:

```yaml
image:
  repository: 111122223333.dkr.ecr.eu-west-2.amazonaws.com/devpolaris-orders-api
  digest: sha256:7a31b5

env:
  CHECKOUT_RECEIPT_RETRY_ENABLED: "true"
  CHECKOUT_RECEIPT_RETRY_ATTEMPTS: "3"
  RECEIPTS_BUCKET: devpolaris-prod-receipts

secrets:
  receiptScanApiToken:
    externalSecretName: orders-prod-receipt-scan-api-token

serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::111122223333:role/devpolaris-orders-api-pod

deployment:
  strategy:
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
```

This path still needs the same release thinking. A ConfigMap change can roll pods. A Secret reference can fail because the external secret controller lacks access to Secrets Manager. A pod can be ready at the Kubernetes level while checkout errors rise after real traffic arrives. If the team uses Argo Rollouts, Flagger, an ingress controller, or a service mesh for canary traffic, the rollout record should name the traffic steps and metrics.

GitOps rollback often means reverting the commit that changed the desired state. That works well when Git truly owns the runtime contract. If someone hotfixes a value directly in the cluster, Argo CD may either overwrite it or show drift. Teams that use GitOps should treat direct cluster edits as emergency actions and record how the change will be reconciled back into Git.

## Rollback Shape
<!-- section-summary: Rollback shape names the exact recovery action for the runtime and configuration that changed. -->

**Rollback shape** means the concrete move that returns users to a stable path. It depends on what changed and which runtime owns traffic. A bad ECS task definition, a bad Lambda version, a bad feature flag, a bad secret version, and a bad EKS ConfigMap may need different first actions.

For ECS rolling deployments, rollback often means updating the service back to the previous task definition revision. If the deployment fails before steady state and the circuit breaker has rollback enabled, ECS can handle that failed deployment path. If the candidate reaches steady state and then business errors rise, the team usually performs an explicit service update back to the known-good revision.

For Lambda, rollback usually means moving the alias back to the stable version and clearing weighted traffic. For CodeDeploy blue/green, rollback may mean stopping the deployment or letting configured alarms trigger rollback during the bake window. For EKS with GitOps, rollback may mean reverting the Git commit that changed the image, ConfigMap, Secret reference, or rollout object.

Here is the rollback shape for the orders API release:

```yaml
rollback_shape:
  bad_ecs_candidate:
    signal: checkout errors or ALB 5xx rise on task definition 31
    action: update ECS service back to devpolaris-orders-api:30
    verify:
      - running tasks use revision 30
      - checkout success rate returns to baseline
  bad_feature_flag:
    signal: errors only happen in retry branch
    action: disable checkout.receiptRetry in the flag provider
    verify:
      - retry branch stops appearing in logs
      - receipt upload failures return to baseline
  bad_secret_value:
    signal: receipt scan returns unauthorized after token rotation
    action: move Secrets Manager AWSCURRENT back to previous version
    verify:
      - candidate can scan receipts again
      - CloudTrail shows expected secret access
  bad_lambda_candidate:
    signal: receipt worker version 31 errors rise
    action: point prod alias back to version 30 and clear routing config
    verify:
      - alias points to version 30
      - failed invocations return to baseline
  bad_eks_rollout:
    signal: new pods are ready but checkout errors rise
    action: revert the GitOps commit or roll back the Helm release
    verify:
      - pods run the previous image and config
      - Argo CD shows synced and healthy
```

This record helps the on-call engineer choose the smallest useful recovery action. If only the flag causes errors, turn off the flag. If the whole candidate fails before serving traffic, roll back the runtime version. If the secret value changed, restore the secret label. The goal is to recover the user path first and then investigate the candidate with lower pressure.

## Putting It All Together
<!-- section-summary: A safe rollout keeps the candidate, configuration, secret access, IAM permissions, traffic movement, and rollback action connected. -->

The orders API team starts with a candidate image for receipt upload retry. The GitHub Actions pipeline builds the image, pushes it to ECR, and records the digest. Terraform or OpenTofu updates the ECS task definition with the new image, retry settings, secret reference, and IAM permissions. The release record names the task definition revision, feature flag rule, secret IDs, previous values, and rollback target.

Before production exposure, the team checks runtime configuration. The retry flag default is safe. The retry attempts value is within the startup validation range. The receipt bucket still points to production. The receipt scanning token comes from Secrets Manager. The ECS execution role can inject the secret, and the task role can write to S3 and publish any required events. The ALB health check is lightweight, and the deeper checkout smoke test exercises the real receipt path.

Then the team deploys the candidate. On plain ECS rolling deployments, ECS starts new tasks and drains old tasks according to deployment settings. On Lambda, the team publishes version `31` and shifts a small alias weight. On CodeDeploy blue/green, the team tests the green target group before production traffic moves. On EKS, Argo CD syncs the desired image and config from Git, and Kubernetes rolls pods according to the deployment strategy.

The watch window focuses on the release risk: checkout success rate, p95 checkout latency, receipt upload failures, receipt scan authorization errors, ALB 5xx, task restarts, Lambda errors, pod restarts, and logs tagged with the candidate version. If the signals stay healthy, the team increases exposure. If a signal crosses the rollback rule, the team restores the right piece: flag, secret, task definition, alias, target group route, or GitOps commit.

This is the practical AWS release loop. The team names the candidate, reviews config and secrets, checks IAM permissions, moves traffic carefully, watches the right evidence, and keeps the recovery action ready before users feel the full blast of a bad change.

## What's Next

Runtime configuration and rollout controls decide how a candidate reaches users. The next article goes deeper into ECS deployments: task definition revisions, service updates, rolling deployment settings, target group health, deployment evidence, and rollback commands for a containerized AWS service.

---

**References**

* [Amazon ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html) - AWS guide to the versioned task launch specification.
* [Pass environment variables to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/taskdef-envfiles.html) - ECS documentation for ordinary environment variables and the warning about sensitive values.
* [Pass sensitive data to an Amazon ECS container](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html) - ECS documentation for Secrets Manager and Parameter Store secret references.
* [AWS Systems Manager Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) - AWS guide to hierarchical runtime configuration storage.
* [What's in a Secrets Manager secret](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html) - AWS guide to secret versions and staging labels.
* [Roll back a secret to a previous version](https://docs.aws.amazon.com/secretsmanager/latest/userguide/roll-back-secret.html) - AWS guide to restoring previous secret versions.
* [Amazon ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html) - AWS guide to failed deployment detection and rollback.
* [Deploy Amazon ECS services by replacing tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html) - AWS guide to ECS rolling deployments.
* [Amazon ECS blue/green deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html) - AWS guide to blue/green deployments and bake time.
* [Application Load Balancer resources for blue/green deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb-resources-for-blue-green.html) - AWS guide to listeners and target groups during ECS blue/green deployments.
* [Create an alias for a Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html) - AWS guide to Lambda aliases.
* [Implement Lambda canary deployments using a weighted alias](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html) - AWS guide to weighted alias routing.
* [Running highly available applications on Amazon EKS](https://docs.aws.amazon.com/eks/latest/best-practices/application.html) - AWS best practices for Kubernetes rolling updates on EKS.
* [OpenFeature](https://openfeature.dev/) - Vendor-neutral feature flag API project.
* [Helm](https://helm.sh/docs/) - Kubernetes package manager commonly used for EKS deployments.
* [Argo CD](https://argo-cd.readthedocs.io/) - GitOps controller commonly used for EKS release workflows.
