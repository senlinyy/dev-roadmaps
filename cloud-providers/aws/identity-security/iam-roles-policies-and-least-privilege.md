---
title: "IAM Roles, Policies, And Least Privilege"
description: "Give AWS callers enough access to do their job by reading IAM permissions as caller, action, resource, condition, and decision."
overview: "IAM is easier when you stop starting from policy JSON. Start with the request you want to allow, then shape the role and policy until the permission is narrow, readable, and testable."
tags: ["iam", "roles", "policies", "least-privilege"]
order: 2
id: article-cloud-iac-cloud-providers-iam-security
aliases:
  - iam-security
  - iam-roles-policies-and-principals
  - cloud-providers/aws/identity-security/iam-security.md
  - cloud-iac/cloud-providers/iam-security.md
  - child-cloud-providers-iam-security
---

## Table of Contents

1. [The Permission Request](#the-permission-request)
2. [Why Roles Exist](#why-roles-exist)
3. [Policies As Allow Rules](#policies-as-allow-rules)
4. [Actions And Resources](#actions-and-resources)
5. [Reading AccessDenied](#reading-accessdenied)
6. [Narrowing A Permission Safely](#narrowing-a-permission-safely)
7. [Quick Recap](#quick-recap)

## The Permission Request

The IAM lesson starts when the orders API team fixes one problem and immediately creates another one.
The app failed to read its database secret, someone added a broad Secrets Manager permission to the task role, and the next review stops on the policy.

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:*",
  "Resource": "*"
}
```

The app now starts.
That is why the shortcut is tempting.
The reviewer is not arguing that the service should stay broken.
They are asking a better question:

> How do I give something enough AWS access to work without giving it everything?

The answer begins before JSON.
The team needs to describe the request that should be allowed.
For the orders API, the useful request is not "access to secrets."
It is one runtime caller reading one database secret.

```text
principal: arn:aws:sts::333333333333:assumed-role/orders-api-task-role/ecs-task-42
action:    secretsmanager:GetSecretValue
resource:  arn:aws:secretsmanager:us-east-1:333333333333:secret:orders/prod/database-AbCdEf
desired:   allow
```

The same role should not be able to administer IAM:

```text
principal: arn:aws:sts::333333333333:assumed-role/orders-api-task-role/ecs-task-42
action:    iam:AttachRolePolicy
resource:  arn:aws:iam::333333333333:role/orders-api-task-role
desired:   deny
```

Those two records are the start of least privilege.
They tell the team what the app needs and what would be dangerous.
IAM, AWS Identity and Access Management, is the system that helps AWS evaluate those requests.
It checks who is asking, what action they want, which resource they target, what request context applies, and whether the applicable policies allow or deny the request.

The guiding questions are:

- Which identity is making the request?
- What job does that identity need to perform?
- Which AWS action represents that job?
- Which resource should the action touch?
- Is any condition needed to narrow the request?
- What error proves the policy is too narrow or too broad?

The rest of the article follows the policy review.
We will start from the broad allow, replace it with a role-shaped permission, and then use real denial messages to keep the policy honest.

## Why Roles Exist

The old way to make the app work would be to create an IAM user, generate an access key, and put that key somewhere the container can read it.
That design is easy to understand on day one and painful to operate later.
The key can leak.
It can outlive the container.
It can be reused by scripts nobody remembers.
It also gives AWS a weak story about who made a request.

Roles exist to avoid that shape.
An IAM role is an AWS identity that a trusted caller can assume.
When the caller assumes the role, AWS issues temporary credentials for a role session.
The role's policies decide what that session can do.

For the orders API, the trusted caller is the ECS task running the app.
The task role should describe the app's runtime job:
read the database secret and write export files.
It should not describe Maya's support job or the deploy pipeline's release job.

```text
Maya's support role:
  inspect logs and safe metadata

Deploy role:
  register task definitions and update the ECS service

Orders API task role:
  read one database secret
  write exports under one S3 prefix
```

That separation is what gives IAM its value.
If the app can deploy itself, a runtime bug has release power.
If the deploy role can read every secret, a CI leak becomes a secret incident.
If humans and workloads share a role, CloudTrail becomes harder to read.

ECS adds one naming detail that is worth learning early.
The task execution role lets ECS do platform work, such as pulling the image and sending logs.
The task role is what application code uses when it calls AWS APIs.
If the Node.js app calls Secrets Manager, `secretsmanager:GetSecretValue` belongs on the task role.

```json
{
  "family": "devpolaris-orders-api",
  "taskRoleArn": "arn:aws:iam::333333333333:role/orders-api-task-role",
  "executionRoleArn": "arn:aws:iam::333333333333:role/orders-api-execution-role"
}
```

This is the first place the policy review can go wrong.
Adding the permission to the execution role may look reasonable because ECS is starting the task.
But the caller in the error is the application task role session.
The policy must follow the caller that made the failing request.

## Policies As Allow Rules

Now the team can replace the broad permission with a sentence.

```text
Allow the orders API task role to read the production database secret.
```

The policy statement becomes the encoded form of that sentence:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:us-east-1:333333333333:secret:orders/prod/database-AbCdEf"
}
```

The shape is reviewable because every field has a job.
`Effect` says this statement allows something.
`Action` names the AWS API operation.
`Resource` names the target.
If a teammate asks why it exists, the answer is the startup path:
the app reads its database URL from Secrets Manager.

The broad version did not have that property.
`secretsmanager:*` on `*` says the app can do every Secrets Manager action on every secret the policy reaches.
That includes actions far beyond startup.
It may include reading unrelated secrets, updating secret values, or changing metadata.
The policy fixed the symptom by giving the app a larger security problem.

IAM's default deny model helps the team write narrow policies.
If no applicable policy allows a request, AWS denies it.
You do not need to write explicit denies for every unrelated action.
You allow the requests that should pass and let the default block the rest.

Explicit denies still matter.
If an applicable policy explicitly denies a request, another allow cannot override it.
That matters when an error says an organization guardrail or another policy type denied the request.
At the beginner level, the main habit is enough:
start from the allow you can explain, then read the error carefully if AWS still denies the request.

## Actions And Resources

After the secret read works, the orders API hits the next permission problem.
The app writes a daily export file to S3.
The developer adds `s3:PutObject` on the export prefix.
The write succeeds in one path, but another startup check still fails because the app lists the prefix before writing.

That failure teaches why action and resource have to be mapped from real app behavior.
Writing an object and listing a bucket are different AWS actions.
They also use different resource shapes.

| App Behavior | IAM Action | Resource |
|--------------|------------|----------|
| Load database URL | `secretsmanager:GetSecretValue` | One secret ARN |
| Write export file | `s3:PutObject` | Objects under `orders-api/*` |
| List export keys before writing | `s3:ListBucket` | Bucket ARN, narrowed by prefix |

The narrow S3 policy is longer than a wildcard because the app does more than one S3 operation:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::devpolaris-orders-exports-prod/orders-api/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::devpolaris-orders-exports-prod",
      "Condition": {
        "StringLike": {
          "s3:prefix": "orders-api/*"
        }
      }
    }
  ]
}
```

The condition is not decoration.
Without it, `s3:ListBucket` may let the app list more keys than its job requires.
With the prefix condition, the app can inspect the area it owns.

This is the tradeoff of least privilege.
The policy takes more thought than `s3:*`.
In return, a review can see exactly what the app can touch.
When an export path changes, the team has a clear place to update.
When a request falls outside the prefix, the denial becomes useful evidence instead of an annoyance.

## Reading AccessDenied

The review is not complete until the team knows how to read failures.
An `AccessDenied` message is the permission system telling you which request did not pass.
Changing a policy before reading that message is how broad permissions creep back in.

Here is the original secret error:

```text
AccessDeniedException: User:
arn:aws:sts::333333333333:assumed-role/orders-api-task-role/ecs-task-42
is not authorized to perform: secretsmanager:GetSecretValue
on resource:
arn:aws:secretsmanager:us-east-1:333333333333:secret:orders/prod/database-AbCdEf
because no identity-based policy allows the action
```

This is a missing allow for the task role on one secret.
If the app should read that secret, add the narrow allow.
If the caller is not the task role, fix the runtime identity instead.

A different denial can mean the policy is protecting the system correctly:

```text
AccessDenied: User:
arn:aws:sts::333333333333:assumed-role/orders-api-task-role/ecs-task-42
is not authorized to perform: s3:PutObject
on resource:
arn:aws:s3:::devpolaris-orders-exports-prod/manual-backups/daily.csv
```

The action is `s3:PutObject`, but the key is under `manual-backups/`.
If the orders API should only write under `orders-api/*`, the policy is doing its job.
The fix may be an environment variable, object-key builder, or code path.
Widening the policy would hide a bug.

Sometimes the error points away from the role policy:

```text
AccessDenied: User:
arn:aws:sts::333333333333:assumed-role/orders-api-task-role/ecs-task-42
is not authorized to perform: s3:PutObject
on resource:
arn:aws:s3:::devpolaris-orders-exports-prod/orders-api/daily.csv
with an explicit deny in a service control policy
```

An explicit deny wins over an allow.
Adding another allow to the task role will not fix this request.
The team needs to understand the denying guardrail and why it exists.

## Narrowing A Permission Safely

The final step in the review is to test both sides of the boundary.
A policy should allow the request the app needs and deny a nearby request the app should not make.

For the export job, the team writes the expected pair:

```text
should pass:
  s3:PutObject
  arn:aws:s3:::devpolaris-orders-exports-prod/orders-api/2026-05-13.csv

should fail:
  s3:PutObject
  arn:aws:s3:::devpolaris-orders-exports-prod/manual-backups/2026-05-13.csv
```

If both pass, the policy is too broad.
If both fail, the policy is too narrow or the caller is wrong.
If the first passes and the second fails, the permission matches the story.

Use the same loop for secrets:

```text
should pass:
  secretsmanager:GetSecretValue on orders/prod/database

should fail:
  secretsmanager:GetSecretValue on payments/prod/webhook
```

Tools can help with that loop.
The IAM policy simulator can test specific principal, action, and resource combinations.
Access Analyzer can help review access patterns.
CloudTrail can show which API calls actually happened.
The important point is not the tool name.
The point is that least privilege is verified by evidence, not by the hope that the policy "looks secure."

The result is slower than granting admin access.
It is also calmer to operate.
When a role has a permission, the team can say why it exists, what should pass, what should fail, and what evidence proves the result.

## Quick Recap

IAM became easier once the team stopped asking for generic "AWS access" and started writing request stories.

| Question | Answer Habit |
|----------|--------------|
| Who is asking? | Identify the principal, usually a human role, deploy role, or workload role |
| What job do they need? | Write the permission sentence in plain English first |
| Which action represents the job? | Use the AWS action name that maps to the app behavior |
| Which resource is the target? | Use the exact ARN or prefix whenever possible |
| Is a condition needed? | Add conditions only when they clearly narrow the request |
| What does AccessDenied say? | Read caller, action, resource, and reason before editing policy |

The review started with a broad policy that made the app work.
It ended with a narrower role because the team followed the actual requests:
read one secret, write one export prefix, and deny nearby actions that do not belong to the app.

---

**References**

- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) - Explains how roles are assumed and why they provide temporary credentials for trusted callers.
- [Amazon ECS task IAM roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Documents the workload role used by application code inside ECS tasks.
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) - Verifies the least-privilege guidance, workload role preference, condition usage, and Access Analyzer review habits.
- [IAM JSON policy elements reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html) - Defines policy elements such as `Effect`, `Action`, `Resource`, and `Condition`.
- [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html) - Verifies default deny, allow, and explicit deny behavior.
- [Troubleshoot access denied errors](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_access-denied.html) - Shows how AWS phrases missing allows, explicit denies, and authorization failures.
