---
title: "IAM Review"
description: "Review cloud identities, actions, resources, and conditions before access changes reach production."
overview: "Cloud IAM controls who can act on which resources. This article walks through principal, action, resource, conditions, and audit evidence using a Terraform pull request for devpolaris-orders-api."
tags: ["iam", "roles", "review"]
order: 1
id: article-devsecops-cloud-infrastructure-security-iam-review
---

## Table of Contents

1. [What IAM Review Checks](#what-iam-review-checks)
2. [Read the Access Sentence](#read-the-access-sentence)
3. [Terraform Evidence](#terraform-evidence)
4. [Conditions](#conditions)
5. [Audit Evidence](#audit-evidence)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What IAM Review Checks

Cloud identity and access management, usually called IAM, decides which identities can perform which actions on which resources. Every cloud provider has its own policy syntax, but the review habit is the same.

For `devpolaris-orders-api`, an IAM review starts with one sentence:

```text
orders-api-prod-deployer can update the orders service in production.
```

The useful parts are principal, action, resource, and condition. The principal is the identity. The action is the operation. The resource is the target. The condition narrows when or how the access applies.

IAM review matters because infrastructure code can make broad access look normal. A pull request that adds one small feature can also give a role permission to read every secret, write every bucket, or assume another role.

## Read the Access Sentence

Read every policy statement as a sentence.

```json
{
  "Effect": "Allow",
  "Action": ["storage:GetObject"],
  "Resource": ["orders-invoices-prod/*"]
}
```

This statement says an identity can read objects under the production invoices path. The policy snippet does not show the principal by itself because many cloud systems attach statements to a role. The reviewer still needs to know which role receives the statement.

Now compare a broad statement:

```json
{
  "Effect": "Allow",
  "Action": ["storage:*"],
  "Resource": ["*"]
}
```

This says the identity can perform every storage action on every storage resource covered by the account or project scope. It may work during development, but it is too broad for a production service role.

## Terraform Evidence

In infrastructure as code, the pull request should show both the policy text and the plan.

```text
Terraform plan
  + role: orders-api-prod-reader
  + action: storage:GetObject
  + resource: orders-invoices-prod/*
```

The plan tells the reviewer what will change. The code tells the reviewer why. The review should check both.

Here is a small review record:

```text
Principal: orders-api-prod-reader
Action: storage:GetObject
Resource: orders-invoices-prod/*
Condition: source workload identity is orders-api-prod
Reason: invoice download feature
Reviewer: cloud-security
```

The `Reason` line keeps the permission connected to product behavior. If the feature is removed later, the permission should be removed too.

## Conditions

Conditions narrow access without creating a new role for every detail. They may check source identity, resource tags, branch names, IP ranges, time windows, or request context depending on the provider.

```text
Allow storage:GetObject
Resource: orders-invoices-prod/*
Condition: request principal is orders-api-prod-runtime
```

Conditions are powerful, but they can also become hard to understand. A condition nobody can explain is not a good control. Keep common conditions close to plain language and test them with audit logs or policy simulation where possible.

## Audit Evidence

After deployment, audit logs should show the identity using the permission.

```json
{
  "time": "2026-05-19T11:03:12Z",
  "principal": "orders-api-prod-runtime",
  "action": "storage:GetObject",
  "resource": "orders-invoices-prod/inv_481.pdf",
  "result": "success"
}
```

The `principal`, `action`, and `resource` fields match the review sentence. If the log shows a different principal, the app may be using the wrong identity. If it shows access to a broader resource, the policy may be too wide.

## Putting It All Together

IAM review turns policy syntax into access sentences. Principal, action, resource, and condition should all be visible. Terraform shows the intended change. Audit logs show how the identity behaved afterward.

For `devpolaris-orders-api`, IAM changes should explain the feature, name the role, narrow the action, narrow the resource, use understandable conditions, and leave enough evidence for later access review.

## What's Next

IAM controls who can act. Network exposure controls which paths can reach a service. The next article reviews public access, private paths, routes, and firewall rules.

---

**References**

- [AWS IAM JSON policy elements](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html) - AWS documents principals, actions, resources, effects, and conditions in IAM policies.
- [Azure role-based access control](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview) - Microsoft documents Azure RBAC concepts.
- [Google Cloud IAM overview](https://cloud.google.com/iam/docs/overview) - Google Cloud documents principals, roles, permissions, and policies.
- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - HashiCorp documents how Terraform plans describe proposed infrastructure changes.
