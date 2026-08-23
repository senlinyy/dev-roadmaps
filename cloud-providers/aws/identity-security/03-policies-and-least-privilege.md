---
title: "Policies and Least Privilege"
description: "Learn how AWS evaluates IAM policies and how to turn a real workload into narrow actions, resources, conditions, trust, and permission ceilings."
overview: "Treat IAM as a proof system: principal P wants action A on resource R under context C. Follow a receipt export through policy statements, S3 and KMS, PassRole, boundaries, least privilege, and evidence-based AccessDenied debugging."
tags: ["iam", "policies", "least-privilege", "authorization"]
order: 3
id: article-cloud-providers-aws-identity-security-policy-evaluation
aliases:
  - policies-and-least-privilege
  - policy-evaluation
  - iam-policy-evaluation
  - access-denied
  - least-privilege
  - iam-least-privilege
  - article-cloud-providers-aws-identity-security-least-privilege
  - cloud-providers/aws/identity-security/policy-evaluation.md
  - cloud-providers/aws/identity-security/04-policy-evaluation.md
  - cloud-providers/aws/identity-security/least-privilege.md
  - cloud-providers/aws/identity-security/05-least-privilege.md
---

## Table of Contents

1. [How Does IAM Evaluate One API Request?](#how-does-iam-evaluate-one-api-request)
2. [What Does a Policy Statement Mean?](#what-does-a-policy-statement-mean)
3. [How Do Trust, Permissions, Resources, and Conditions Work Together?](#how-do-trust-permissions-resources-and-conditions-work-together)
4. [Why Can One Operation Need Both S3 and KMS Permission?](#why-can-one-operation-need-both-s3-and-kms-permission)
5. [How Do PassRole, Boundaries, and Organization Guardrails Limit Access?](#how-do-passrole-boundaries-and-organization-guardrails-limit-access)
6. [How Do You Build a Least-Privilege Role From Workload Behavior?](#how-do-you-build-a-least-privilege-role-from-workload-behavior)
7. [How Do You Debug AccessDenied With Evidence?](#how-do-you-debug-accessdenied-with-evidence)
8. [How Does the Complete Authorization Design Fit Together?](#how-does-the-complete-authorization-design-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

## How Does IAM Evaluate One API Request?
<!-- section-summary: IAM treats authorization as a proof about one principal, action, resource, and request context. -->

Think of AWS IAM as a **proof system**. Every signed AWS API request is asking one question:

> May principal **P** perform action **A** on resource **R**, given context **C**?

For example:

```text
Principal: arn:aws:sts::123456789012:assumed-role/ReceiptExportRole/my-lambda
Action:    s3:GetObject
Resource:  arn:aws:s3:::company-receipts/2026/receipt-123.pdf
Context:   Region, source service, tags, VPC endpoint,
           encryption context, time, and other request facts
```

IAM evaluates the request and returns `ALLOW` or `DENY`. The fundamental rules are:

```text
everything starts denied
an applicable permission must introduce an Allow
an applicable explicit Deny always wins
```

AWS services expose APIs. When a user runs:

```bash
aws s3 cp receipt.pdf s3://company-receipts/
```

the CLI is not asking for vague “S3 access.” It is making one or more concrete API requests. Depending on the exact operation, those requests can include `s3:PutObject`, `s3:GetObject`, and `s3:ListBucket`.

IAM does not fundamentally understand an organizational sentence such as “Finance administrator,” “can work with receipts,” or “needs S3 access.” It evaluates statements much closer to:

```text
s3:GetObject
on
arn:aws:s3:::company-receipts/incoming/*
```

That difference is the foundation of least privilege. Broad thinking asks which service the application uses. Precise thinking asks which API operations it makes, which resources those operations target, and which request circumstances must be true.

The sections below answer these questions in order:

1. **How Does IAM Evaluate One API Request?**
2. **What Does a Policy Statement Mean?**
3. **How Do Trust, Permissions, Resources, and Conditions Work Together?**
4. **Why Can One Operation Need Both S3 and KMS Permission?**
5. **How Do PassRole, Boundaries, and Organization Guardrails Limit Access?**
6. **How Do You Build a Least-Privilege Role From Workload Behavior?**
7. **How Do You Debug AccessDenied With Evidence?**
8. **How Does the Complete Authorization Design Fit Together?**

## What Does a Policy Statement Mean?
<!-- section-summary: A statement combines an effect, API action, resource set, and optional condition into one authorization rule. -->

Consider one policy statement:

```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::company-receipts/incoming/*"
}
```

Read it as: allow the principal to which this permission applies to call `s3:GetObject` against objects under `company-receipts/incoming/`.

A statement answers three main questions:

```text
Effect    Should a matching request be allowed or denied?
Action    Which AWS API operation does it match?
Resource  Which AWS object or set of objects does it match?
```

It can add a fourth question:

```text
Condition Under which request circumstances does it match?
```

For example:

```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::company-receipts/incoming/*",
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": "eu-west-2"
    }
  }
}
```

The request must target `eu-west-2` as well as matching the action and resource. A compact model is:

```text
Statement = Effect(Action, Resource, Conditions)
```

### Permission belongs to an API action

S3 permissions are not one on/off capability. `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, and `s3:GetBucketLocation` are separate actions.

```json
"Action": "s3:*"
```

matches a very large set of IAM-controlled S3 operations. It is much broader than:

```json
"Action": [
  "s3:GetObject",
  "s3:PutObject"
]
```

Least-privilege design replaces “Which service does the application use?” with “Which API calls does the application actually need?”

### Resource scope narrows the second dimension

If a receipt exporter only reads incoming receipts, `s3:GetObject` on `Resource: "*"` may reach objects far beyond that workload. Naming the bucket is smaller:

```json
"Resource": "arn:aws:s3:::company-receipts/*"
```

Naming the required prefix is smaller again:

```json
"Resource": "arn:aws:s3:::company-receipts/incoming/*"
```

The allowed set shrinks step by step:

```text
all actions on all resources
        ↓
S3 actions on all resources
        ↓
GetObject on all resources
        ↓
GetObject on the receipt bucket
        ↓
GetObject on the incoming receipt prefix
```

Least privilege keeps reducing the set of requests that would receive `ALLOW` until that set matches the legitimate workload.

![The policy decision view turns a business request into an action, resource, principal, context, and result](/content-assets/articles/article-cloud-providers-aws-identity-security-policy-evaluation/request-policy-decision.png)

*A policy becomes reviewable when each field maps to one part of the real request.*

### Where Do Identity and Resource Policies Apply?
<!-- section-summary: Identity policies state what a caller may do, while resource policies state which principals a resource owner accepts. -->

An **identity-based policy** attaches to an IAM user, group, or role. Suppose this policy attaches to `ReceiptExportRole`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::company-receipts/incoming/*"
    }
  ]
}
```

The policy says what that identity may do. It has no `Principal` field because the attachment point already identifies the principal.

A **resource-based policy** attaches to a resource and states which principals may use it. An S3 bucket policy can include:

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::123456789012:role/ReceiptExportRole"
  },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::company-receipts/incoming/*"
}
```

The relationship can be described from either side:

```text
identity policy
ReceiptExportRole → I may read receipts

resource policy
company-receipts bucket → ReceiptExportRole may read me
```

S3 bucket policies, KMS key policies, SQS queue policies, SNS topic policies, Secrets Manager resource policies, and IAM role trust policies are examples of resource-side controls.

#### Cross-account access needs both owners

Suppose account A owns the bucket and account B owns the workload. There are two security domains:

```text
Account B                           Account A

identity policy                     bucket policy
I want to make this request         I trust this external principal
```

Cross-account access generally requires cooperation. Account B permits its principal to call `s3:GetObject`; account A accepts that external principal on its bucket. Authorization is not always only “What may the caller do?” It can also be “Whom does the resource owner trust?”

## How Do Trust, Permissions, Resources, and Conditions Work Together?
<!-- section-summary: A role trust policy controls who may obtain credentials, working policies control what those credentials may do, and resource shapes and conditions narrow matching requests. -->

IAM evaluation starts with implicit deny. If AWS has no applicable allow for `alice → s3:GetObject → secret.pdf`, the result is `DENY`. No blanket deny statement is required to create that state.

If an applicable policy allows `s3:GetObject` under `company-receipts/*`, a matching request can become allowed unless an applicable policy explicitly denies it. If another policy denies `s3:DeleteObject`, that deny overrides a broad `s3:*` allow.

```text
1. Applicable explicit Deny?
   yes → DENY

2. Sufficient applicable Allow?
   no  → DENY
   yes → ALLOW
```

AWS may gather identity policies, resource policies, session policies, permissions boundaries, Organizations guardrails, and service-specific rules. Identity and resource policies can contribute possible permissions. Boundaries, session policies, and organizational controls can restrict those possibilities. An explicit deny remains decisive.

![The evaluation layers show how grants, ceilings, guardrails, and explicit denies combine](/content-assets/articles/article-cloud-providers-aws-identity-security-policy-evaluation/evaluation-layers.png)

*An attached allow is only one input to the final request decision.*

### A role has an entry side and a working side

For a Lambda receipt exporter, the trust policy can allow the Lambda service to assume the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

This statement answers “Who may become `ReceiptExportRole`?” It does not grant S3 access. The role's working policy separately allows the session to read input and write output:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadIncomingReceipts",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::company-receipts/incoming/*"
    },
    {
      "Sid": "WriteDailyExports",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::company-receipt-exports/daily/*"
    }
  ]
}
```

Trust controls who can acquire the role. Permissions control what the acquired credentials can do.

### The API determines the resource shape

If the exporter lists incoming receipts, it also needs `s3:ListBucket`. A common mistake attaches that action to an object ARN:

```json
{
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::company-receipts/incoming/*"
}
```

`ListBucket` operates on the bucket resource, so the correct resource is:

```json
{
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::company-receipts"
}
```

`s3:GetObject` operates on object resources and therefore uses the object-prefix ARN. The correct resource scope follows the semantics of the API operation. Actions within one AWS service do not necessarily use the same resource shape.

### Conditions narrow context that the ARN cannot express

The bucket-level list permission can be narrowed to the incoming prefix:

```json
{
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::company-receipts",
  "Condition": {
    "StringLike": {
      "s3:prefix": [
        "incoming",
        "incoming/*"
      ]
    }
  }
}
```

The statement now matches only when the requested S3 prefix is `incoming` or below it. Other condition keys can represent source service, source account, VPC, VPC endpoint, IP address, resource tags, principal tags, requested Region, TLS, MFA, time, and KMS encryption context.

Without conditions, the policy says “P may do A to R.” With conditions, it says “P may do A to R only when C is true.” A permission can be viewed as a region in a multidimensional space:

```text
Principal × Action × Resource × Context
```

Least privilege cuts that volume down to the expected principal, actions, resources, and context.

Prefer a small positive allow boundary, such as one prefix ARN, to a giant allow plus a complicated set of deny exceptions. Explicit deny is valuable for clear invariants and guardrails; it should not compensate for an unnecessarily broad allow.

## Why Can One Operation Need Both S3 and KMS Permission?
<!-- section-summary: Reading or writing an SSE-KMS object crosses S3 authorization and KMS authorization, and both resource owners must permit their part. -->

Suppose the incoming receipts are encrypted with an AWS KMS customer-managed key. The role already has `s3:GetObject`, but the operation fails with `AccessDenied`.

The logical read crosses two authorization systems:

```text
1. Ask S3 for the object.
2. S3 obtains the encrypted data.
3. KMS authorizes decryption.
4. Plaintext becomes available to the caller.
```

The request therefore needs both:

```text
S3 authorization
  s3:GetObject on the input object

AND

KMS authorization
  kms:Decrypt on the receipt key
```

The role may need:

```json
{
  "Sid": "DecryptReceiptObjects",
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:eu-west-2:123456789012:key/RECEIPT-KEY-ID"
}
```

Writing output protected by server-side encryption with KMS may also require `kms:Encrypt` and `kms:GenerateDataKey`, depending on the workflow. S3 permission does not imply KMS permission, and KMS permission does not grant S3 object access.

### The KMS key has its own resource policy

Customer-managed KMS keys have key policies. Even if the role's identity policy allows `kms:Decrypt` on the key ARN, the key's authorization configuration must permit that usage path.

```text
caller-side policy                key-owner policy
May I decrypt?                    May this principal use this key?
```

Both sides of the security boundary matter. This is the same caller-owner cooperation seen in cross-account bucket access, expressed through KMS's key policy model.

### KMS conditions can narrow how the key is used

A bare `kms:Decrypt` permission on one key allows decryption wherever the remaining KMS authorization permits it. The receipt exporter may only need the key through S3 and for the receipt data's expected encryption context.

Conceptually, a more restricted permission says:

```text
Allow kms:Decrypt
ONLY WHEN
the expected key is used
AND the request comes through S3
AND the encryption context matches receipt data
```

If the role credentials are stolen, those context requirements reduce where the KMS capability can be used. Good least privilege constrains actions, resources, and context together.

![The S3 and KMS view shows why encrypted object access needs permission to both the object path and the encryption key](/content-assets/articles/article-cloud-providers-aws-identity-security-policy-evaluation/s3-kms-permission-match.png)

*One application operation can create several independently authorized AWS API requests.*

## How Do PassRole, Boundaries, and Organization Guardrails Limit Access?
<!-- section-summary: PassRole controls which role a caller may assign to a service, while boundaries and SCPs cap the permissions that delegated identities and accounts can receive. -->

Suppose a deployment principal creates a Lambda function and assigns `ReceiptExportRole` as its execution role. AWS must decide whether that principal may tell Lambda to operate as the role. The controlling permission is `iam:PassRole`.

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::123456789012:role/ReceiptExportRole"
}
```

`PassRole` does not allow the deployment principal to assume the role itself. It allows the principal to configure an AWS service to use that role later.

### PassRole can create indirect privilege escalation

A developer may only have permission to create Lambda functions. If the same developer can pass any role in the account, the developer could configure Lambda to run under a powerful administrator role and then place privileged code in the function.

```text
developer
  │ create or update function
  │ PassRole: *
  ▼
Lambda function
  │ runs as
  ▼
SuperAdminRole
```

Restrict the role and, where appropriate, the receiving service:

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::123456789012:role/ReceiptExportRole",
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "lambda.amazonaws.com"
    }
  }
}
```

The principal may pass one specific role and only to Lambda.

`PassRole` and trust solve opposite sides:

```text
deployment principal
       │ iam:PassRole
       ▼
ReceiptExportRole
       ▲
       │ trust policy allows sts:AssumeRole
       │
     Lambda
```

`PassRole` asks whether the deployer may configure Lambda with the role. The role trust policy asks whether Lambda may assume that role. Both must agree with the intended design.

### A permissions boundary creates a maximum envelope

A platform team may let application teams create IAM roles. Without a limit, a developer could create a role with `Action: "*"` and `Resource: "*"`. A **permissions boundary** sets the maximum permissions the delegated role or user can receive from identity policies.

```text
permissions requested by role policies
                 │
                 ▼
          intersection with
          permissions boundary
                 │
                 ▼
      possible identity permissions
```

If the role policy allows `s3:*`, `ec2:*`, and `iam:*`, while the boundary allows only `s3:GetObject` and `s3:PutObject`, the effective identity permissions remain within the smaller S3 envelope.

A boundary does not grant permissions. If the boundary permits `s3:GetObject` but no identity policy grants `s3:GetObject`, the role does not receive it.

```text
effective identity permission
≈ identity-policy Allow ∩ boundary Allow
```

The intersection matters, not the union.

### SCPs set an organization-level ceiling

AWS Organizations service control policies can impose a ceiling across accounts. An organization can prohibit disabling CloudTrail. A platform boundary can limit application roles to S3 and SQS. The workload policy can narrow one exporter to the receipt prefix.

```text
organization guardrail
  → organization-wide maximum

account or platform boundary
  → delegated-role maximum

application policy
  → workload-specific permission
```

These layers create defense in depth at different ownership levels.

## How Do You Build a Least-Privilege Role From Workload Behavior?
<!-- section-summary: Start with the program's steps, translate each step into an API action, map each action to its exact resource, and only then write policy JSON. -->

Do not begin with IAM JSON. Begin with what the receipt exporter actually does:

```text
1. Discover files under s3://company-receipts/incoming/.
2. Read those files.
3. Decrypt them with ReceiptKey.
4. Produce an export.
5. Write exports under s3://company-receipt-exports/daily/.
6. Encrypt output with ExportKey.
```

Translate behavior into API actions:

```text
list input     → s3:ListBucket
read object    → s3:GetObject
decrypt input  → kms:Decrypt
write object   → s3:PutObject
encrypt output → KMS operations required by the SSE-KMS workflow
```

Then map each action to its resource shape:

```text
s3:ListBucket
  → company-receipts bucket

s3:GetObject
  → company-receipts/incoming/*

kms:Decrypt
  → ReceiptKey

s3:PutObject
  → company-receipt-exports/daily/*

KMS output operations
  → ExportKey
```

Only after those mappings are explicit should the team write the policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListIncomingReceipts",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::company-receipts",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "incoming",
            "incoming/*"
          ]
        }
      }
    },
    {
      "Sid": "ReadIncomingReceipts",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::company-receipts/incoming/*"
    },
    {
      "Sid": "WriteDailyExports",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::company-receipt-exports/daily/*"
    },
    {
      "Sid": "DecryptReceipts",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "arn:aws:kms:eu-west-2:123456789012:key/RECEIPT-KEY-ID"
    },
    {
      "Sid": "EncryptExports",
      "Effect": "Allow",
      "Action": [
        "kms:Encrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:eu-west-2:123456789012:key/EXPORT-KEY-ID"
    }
  ]
}
```

The policy does not contain `s3:*`, `kms:*`, `Resource: "*"`, or `AdministratorAccess`. It describes the application's actual behavior rather than its importance to the organization.

Policies describe a set of independently allowed requests. This document does not require `GetObject` to happen before `Decrypt` and `PutObject`. IAM is not a workflow engine. The application chooses the sequence, and IAM decides whether each request belongs to the allowed set.

### What Does Least Privilege Actually Measure?
<!-- section-summary: Least privilege measures the number and impact of unintended requests that would still succeed, then reduces that blast radius throughout the permission lifecycle. -->

Least privilege is not a contest to create the shortest policy. One action can be extremely powerful:

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "*"
}
```

Another legitimate service integration may need twenty ordinary read actions. Line count and action count do not measure security.

The stronger question is: **How many unintended requests would still succeed if these credentials were compromised?**

Compare two policies. A credential with `s3:*` on `*` may allow an attacker to read, modify, or delete data across unrelated buckets. A credential with `s3:GetObject` only under `company-receipts/incoming/*` has a much smaller capability set.

Least privilege assumes that credentials may eventually fail and designs the permission so one credential compromise does not become a whole-infrastructure compromise.

#### Broad access should be a temporary discovery state

In a controlled development environment, a team may temporarily begin with broad access because it does not yet know the required APIs. That state should have a refinement path:

```text
* / *
  ↓
s3:* / *
  ↓
GetObject + ListBucket
  ↓
specific bucket
  ↓
specific prefix
  ↓
expected network, service, and encryption context
```

Observe actual calls, identify required services, reduce to required actions, reduce to required resources, and then add required conditions. Broad permissions are a discovery state, not the permanent production architecture.

The movement between stages should be visible to reviewers. If the first development policy allows every action on every resource, record why that scope is temporary and which workflow will provide evidence. Run the normal receipt export, an empty-input run, a retry after partial failure, and the deployment path. Each path can reveal a different API call. A policy based on one happy path may omit a permission needed for safe recovery, while a policy based on every action ever observed may preserve unrelated debugging activity.

Ask two questions about every observed action:

```text
Did the workload actually call this API?
AND
Should the production workload be allowed to call it?
```

The first question is factual and can be answered with CloudTrail and service evidence. The second is a design decision. A development run may show `s3:DeleteObject` because somebody cleaned up an object with the same role. That event proves usage, but it does not prove that deletion belongs in the production exporter.

Move from evidence to production permission deliberately:

```text
observed API calls
      ↓
classify each call as required, accidental, or development-only
      ↓
map required calls to exact resource shapes
      ↓
add context that must remain true
      ↓
test success and failure paths
      ↓
remove the temporary broad policy
```

The final removal matters. Adding a narrow policy while leaving the discovery policy attached does not reduce effective access. IAM evaluates all applicable policies, so the older broad allow can continue authorizing requests that the new policy deliberately excludes.

#### Design from forbidden capabilities

Write the negative requirements:

```text
must not delete receipts
must not read outside incoming/
must not write outside daily/
must not use other KMS keys
must not manage IAM
must not create infrastructure
must not pass roles
```

Most of these do not require explicit deny. “Must not delete receipts” can be achieved by never allowing `s3:DeleteObject`. A small allow set is simpler to audit than a broad allow repaired by many deny statements.

Ask what an attacker or faulty program could do that the application never intends to do. Can it overwrite arbitrary receipts, read HR data, write elsewhere in the export bucket, decrypt unrelated ciphertext, create IAM users, pass a more powerful role, or assume another role? Every unexpected “yes” identifies permission to reconsider.

#### Capability should follow the process, not the job title

“Finance app” is not a useful machine permission boundary. “Read objects from X, decrypt with Y, and write objects to Z” is. Batch workloads usually have small deterministic capability sets and are good candidates for tight policies.

Human and machine identities should also look different. A developer may need to inspect logs, read metrics, redeploy services, and debug infrastructure. The receipt execution role needs only its runtime operations. Deployment permission and runtime permission should remain separate:

```text
Developer or CI role
    │ deploy + iam:PassRole
    ▼
Lambda configuration
    │ references
    ▼
ReceiptExportRole
    │ runtime API calls
    ▼
S3 and KMS
```

The deployment role may update function code and configuration and pass the approved execution role. The execution role may get and put objects and use the required keys. A compromised runtime should not inherit the capability to redeploy or modify itself.

#### Permissions require continuous review

Permissions accumulate when feature A needs one action, feature B adds another, temporary debugging adds a third, and nobody removes the first or third after the features disappear.

Treat least privilege as a lifecycle:

```text
observe
  ↓
grant
  ↓
measure
  ↓
review
  ↓
remove unused permissions
  ↓
repeat
```

CloudTrail, IAM Access Analyzer, access-last-used information, and policy simulation can contribute evidence. Permissions become technical debt when they no longer have a current justification.

The review must also follow application change. If a later feature moves input from `incoming/*` to `approved/*`, changes the output key, or removes encrypted templates, update the policy with the same change. Otherwise the old prefix and `kms:Decrypt` permission can survive after the code stops using them. A reviewer should be able to connect every surviving statement to a current behavior, resource owner, and failure or recovery path.

![The least-privilege map turns workflow evidence into narrower actions, resources, conditions, tests, and recurring review](/content-assets/articles/article-cloud-providers-aws-identity-security-policy-evaluation/least-privilege-policy-map.png)

*The policy should continue changing as the application's legitimate request set changes.*

## How Do You Debug AccessDenied With Evidence?
<!-- section-summary: AccessDenied debugging identifies the actual principal, exact API action, exact resource, request context, applicable allows, guardrails, and any downstream authorization system. -->

A damaging IAM debugging pattern is:

```text
AccessDenied
    ↓
add s3:*
    ↓ still denied
add kms:*
    ↓ still denied
attach AdministratorAccess
```

The application may eventually work while the team learns nothing about the missing dependency and creates a much larger attack surface.

Treat `AccessDenied` as evidence. Ask which principal made the request, which API action failed, which resource it targeted, whether an allow was missing or an explicit deny matched, and which authorization layer rejected it.

### Confirm the principal first

The role you expect is not always the caller AWS sees. For CLI or SDK debugging:

```bash
aws sts get-caller-identity
```

You may expect the `ReceiptExportRole`, while AWS shows an assumed session of another role. Never debug an IAM policy until you know which principal actually made the request.

### Find the exact API and resource

“Could not download receipt” may represent `s3:GetObject`, `kms:Decrypt`, `sts:AssumeRole`, or `s3:ListBucket`. Each needs a different permission and resource shape.

CloudTrail and service logs can provide `eventSource`, `eventName`, `userIdentity`, request parameters, resource, error code, and error message. The useful evidence looks like:

```text
Principal: ReceiptExportRole session
Action:    kms:Decrypt
Resource:  arn:aws:kms:eu-west-2:123456789012:key/abc
Result:    AccessDenied
```

Now the problem is a concrete authorization tuple rather than a guess about S3.

### Walk the policy layers in order

```text
request denied
     │
     ▼
which principal made it?
     │
     ▼
which exact action failed?
     │
     ▼
which resource was targeted?
     │
     ▼
applicable Allow exists?
   ┌─┴─┐
  no  yes
   │    │
find   inspect explicit Deny
allow   and guardrails
```

Relevant layers can include identity policies, resource policies, the role trust policy, permissions boundary, session policy, SCP, KMS key policy, bucket policy, VPC endpoint policy, and service-specific conditions.

Sometimes the denial is correct. If the exporter unexpectedly calls `s3:DeleteObject`, its specification still says “read receipts and write exports.” The correct fix may be to repair the software instead of expanding the policy. Authorization failures can reveal application bugs and false assumptions.

### Follow the dependency graph

Suppose Lambda starts, `ListBucket` succeeds, and `GetObject` fails. Successful startup suggests that role trust worked. Successful listing proves that credentials exist and the list permission matches. Investigate `s3:GetObject`, the object ARN, bucket policy, boundary, and organization guardrails.

If `GetObject` begins working but KMS returns a denial, S3 authorization succeeded. Continue downstream to `kms:Decrypt`, the actual key ARN, key policy, and encryption context. Do not widen unrelated S3 permissions.

This is the difference between guessing and following the request's authorization dependencies one edge at a time.

## How Does the Complete Authorization Design Fit Together?
<!-- section-summary: The receipt export separates deployer permission, role trust, runtime permissions, S3 and KMS resource acceptance, and higher permission ceilings into independent authorization edges. -->

A mature design has several layers of “should not” and “cannot.” The application should not delete receipts by design. The runtime role cannot delete them because it lacks `s3:DeleteObject`. A permissions boundary can prevent a developer-created role from exceeding the platform envelope. An SCP can prevent accounts from disabling required security services.

```text
application
I will not do that.

IAM role
I cannot do that.

permissions boundary
Even if my identity policy changes, I cannot exceed this envelope.

organization guardrail
Even account administration remains inside this invariant.
```

The complete Receipt Export design contains several separate authorization arrows:

```text
                 DEPLOYER
                    │
               iam:PassRole
                    │
                    ▼
           ReceiptExportRole
                    ▲
                    │ trust policy
                    │ sts:AssumeRole
                 Lambda
                    │
          temporary credentials
                    │
         ┌──────────┴───────────┐
         │                      │
         ▼                      ▼
 company-receipts        company-receipt-exports
 incoming/*                    daily/*
         │                      │
    s3:GetObject            s3:PutObject
         │                      │
         ▼                      ▼
   Receipt KMS key          Export KMS key
     kms:Decrypt       kms:Encrypt / GenerateDataKey
```

Four questions are hidden in the diagram:

1. Can Lambda acquire the role credentials? The trust policy answers.
2. Can the deployer assign the role to Lambda? `iam:PassRole` answers.
3. What can the temporary credentials do? The role's identity policies answer, within boundaries and guardrails.
4. Will S3 buckets and KMS keys accept those requests? Resource policies and service-specific authorization answer.

Conditions can also correlate identity and resources. Roles tagged `Department=Finance` and resources tagged the same way can support attribute-based access rules in which a principal attribute must match a resource attribute. This moves part of the decision from a fixed list of principal and resource ARNs into request context.

Condition keys must exist for the relevant action and service. A condition is a predicate:

```python
if action_matches and resource_matches and condition_is_true:
    statement_matches
```

If the required context is absent, many operators do not match. Deny statements with `IfExists`, `Null`, negated operators, `NotAction`, or `NotResource` need particular care because an unexpectedly broad deny cannot be rescued by another allow. Use explicit deny for well-understood invariants rather than as a substitute for a clear allow design.

For any IAM problem, reconstruct the request:

```text
Principal P wants Action A on Resource R under Context C.
```

Then ask:

1. Who exactly is the principal: user, role, assumed-role session, or AWS service?
2. What exact API action is requested?
3. What exact resource does that action use: bucket, object, key, or role?
4. Which context applies: tags, source account, Region, VPC endpoint, or encryption context?
5. Where can an allow come from: identity policy or resource policy?
6. What can restrict it: boundary, session policy, SCP, or resource guardrail?
7. Does an explicit deny match?
8. Does the operation trigger another authorization system, as S3 plus KMS does?
9. For a role, who may assume it?
10. Who may assign that role to a service through `iam:PassRole`?

The final decision remains:

```text
                    REQUEST
                       │
                       ▼
          P ─── does A ───► R
                       │
                       C
                 request context
                       │
                       ▼
        ┌─────────────────────────┐
        │ applicable IAM policies │
        └────────────┬────────────┘
                     │
          explicit Deny anywhere?
              ┌──────┴──────┐
             yes            no
              │              │
            DENY      sufficient Allow?
                         ┌────┴────┐
                        no        yes
                         │          │
                       DENY       ALLOW
```

IAM begins with deny. Policies create narrow exceptions in terms of principal, action, resource, and condition. Identity policies describe what a caller may do. Resource policies describe which callers the resource trusts. Roles separate assumption from working permissions. Boundaries and organization policies create maximum envelopes. PassRole controls role assignment to services. S3 and KMS show how one application operation can cross several authorization systems.

Least privilege is the repeated process of shrinking all possible API requests down to exactly the requests the workload legitimately needs while assuming that its credentials may one day be stolen.

## Check Your Answers

:::expand[How Does IAM Evaluate One API Request?]{kind="recap"}
IAM treats authorization as a proof about one principal, action, resource, and request context.

IAM evaluates whether principal P may perform action A on resource R under context C. Requests begin denied, need sufficient permission, and remain denied when an applicable explicit deny matches.
:::

:::expand[What Does a Policy Statement Mean?]{kind="recap"}
A statement combines an effect, API action, resource set, and optional condition into one authorization rule.

A statement combines an allow or deny effect with API actions, resource expressions, and optional conditions. Least privilege narrows the action set and resource set to the workload's real requests.

Identity policies state what a caller may do, while resource policies state which principals a resource owner accepts.

Identity policies attach to users, groups, or roles and state what the identity may do. Resource policies attach to buckets, keys, queues, topics, secrets, or roles and state which principals the owner accepts.
:::

:::expand[How Do Trust, Permissions, Resources, and Conditions Work Together?]{kind="recap"}
A role trust policy controls who may obtain credentials, working policies control what those credentials may do, and resource shapes and conditions narrow matching requests.

A role trust policy controls who may acquire the role, working policies control what the session may do, the API defines the correct resource shape, and conditions restrict matching request context.
:::

:::expand[Why Can One Operation Need Both S3 and KMS Permission?]{kind="recap"}
Reading or writing an SSE-KMS object crosses S3 authorization and KMS authorization, and both resource owners must permit their part.

An encrypted object operation can require S3 permission for the object and KMS permission for the encryption key. The role policies and the KMS key's resource-side authorization must all permit their part.
:::

:::expand[How Do PassRole, Boundaries, and Organization Guardrails Limit Access?]{kind="recap"}
PassRole controls which role a caller may assign to a service, while boundaries and SCPs cap the permissions that delegated identities and accounts can receive.

PassRole controls which role a principal may assign to an AWS service. A permissions boundary caps a delegated identity's maximum permissions without granting them, and SCPs set organization-level ceilings.
:::

:::expand[How Do You Build a Least-Privilege Role From Workload Behavior?]{kind="recap"}
Start with the program's steps, translate each step into an API action, map each action to its exact resource, and only then write policy JSON.

List the workload steps, translate each step into an exact API action, map every action to the correct resource, add required context, and only then write policy JSON.

Least privilege measures the number and impact of unintended requests that would still succeed, then reduces that blast radius throughout the permission lifecycle.

Least privilege measures the unintended requests and damage still possible after compromise, not policy length. Keep discovery access temporary, separate deployment from runtime, design negative requirements, and remove stale permissions continually.
:::

:::expand[How Do You Debug AccessDenied With Evidence?]{kind="recap"}
AccessDenied debugging identifies the actual principal, exact API action, exact resource, request context, applicable allows, guardrails, and any downstream authorization system.

Confirm the real principal, failed API action, target resource, and request context. Then inspect missing allows, explicit denies, ceilings, resource policies, conditions, and downstream authorization systems in order.
:::

:::expand[How Does the Complete Authorization Design Fit Together?]{kind="recap"}
The receipt export separates deployer permission, role trust, runtime permissions, S3 and KMS resource acceptance, and higher permission ceilings into independent authorization edges.

The deployer, Lambda trust, runtime role, S3 buckets, KMS keys, boundaries, and SCPs form separate authorization edges. Each edge must match the intended principal, action, resource, and context.
:::

## References

- [IAM policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
- [IAM JSON policy elements](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html)
- [IAM JSON policy element: Principal](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html)
- [IAM JSON policy element: Condition](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html)
- [Identity-based and resource-based policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html)
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Required permissions for S3 API operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html)
- [Policies and permissions in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-policy-language-overview.html)
- [Key policies in AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html)
- [Use IAM policies with AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/iam-policies.html)
- [Pass a role to an AWS service](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html)
- [Permissions boundaries for IAM entities](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)
- [Troubleshoot access denied errors](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_access-denied.html)
