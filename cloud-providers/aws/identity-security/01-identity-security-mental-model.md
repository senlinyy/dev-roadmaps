---
title: "What Is AWS IAM"
description: "Understand how AWS IAM uses identities, credentials, roles, policies, temporary sessions, MFA, and guardrails to decide whether an API request is allowed."
overview: "IAM answers who is calling AWS and what that caller may do. Build the model from root and IAM users through roles, Identity Center, policy evaluation, least privilege, and MFA."
tags: ["iam", "security", "authorization", "aws"]
order: 1
id: article-cloud-providers-aws-identity-security-identity-security-mental-model
aliases:
  - identity-security-mental-model
  - identity-and-security-mental-model
  - iam-roles-policies-and-least-privilege
  - iam-security
  - iam-roles-policies-and-principals
  - article-cloud-iac-cloud-providers-iam-security
  - child-cloud-providers-iam-security
  - cloud-providers/aws/identity-security/iam-roles-policies-and-least-privilege.md
  - cloud-providers/aws/identity-security/iam-security.md
  - cloud-iac/cloud-providers/iam-security.md
---

## Table of Contents

1. [How Does IAM Decide Whether AWS Should Accept a Request?](#how-does-iam-decide-whether-aws-should-accept-a-request)
2. [How Are Identity, Credentials, and Permissions Different?](#how-are-identity-credentials-and-permissions-different)
3. [Why Are Temporary Credentials Safer Than Long-Lived Keys?](#why-are-temporary-credentials-safer-than-long-lived-keys)
4. [How Do IAM Roles Work?](#how-do-iam-roles-work)
5. [How Does IAM Identity Center Give People AWS Access?](#how-does-iam-identity-center-give-people-aws-access)
6. [How Do IAM Policies Describe Access?](#how-do-iam-policies-describe-access)
7. [How Do Least Privilege and MFA Reduce Risk?](#how-do-least-privilege-and-mfa-reduce-risk)
8. [How Does the Complete IAM Model Fit Together?](#how-does-the-complete-iam-model-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

## How Does IAM Decide Whether AWS Should Accept a Request?
<!-- section-summary: IAM helps AWS evaluate the principal, action, resource, and request context before returning allow or deny. -->

AWS Identity and Access Management, or **IAM**, controls who is authenticated and what that identity is authorized to do with AWS resources. The definition becomes clearer when you begin with one API request.

Imagine an account that contains an S3 bucket, an EC2 instance, a DynamoDB table, and a Lambda function. A caller sends this request:

```text
DeleteBucket(my-production-bucket)
```

AWS cannot decide from the command alone. It must answer four questions:

```text
WHO is making the request?
WHAT action are they attempting?
WHICH resource is the target?
UNDER WHAT circumstances is the request being made?
```

Nearly every AWS authorization decision can be modeled as:

```text
Request = Principal + Action + Resource + Context
```

For example:

```text
Principal: Alice
Action:    s3:GetObject
Resource:  arn:aws:s3:::company-data/report.csv
Context:   company network, MFA present, 10:30
```

The **principal** is the authenticated caller. The **action** is the AWS API operation. The **resource** is the AWS object the action targets. The **context** contains request facts that policies may test, such as the network path, authentication method, session attributes, or resource tags.

IAM and the applicable AWS policy mechanisms evaluate those facts and produce one of two results:

```text
ALLOW
```

or:

```text
DENY
```

That request model is the foundation for the rest of IAM. Users, roles, permission sets, policies, MFA, STS, and organizational guardrails all contribute information to one or more parts of the decision.

The sections below answer these questions in order:

1. **How Does IAM Decide Whether AWS Should Accept a Request?**
2. **How Are Identity, Credentials, and Permissions Different?**
3. **Why Are Temporary Credentials Safer Than Long-Lived Keys?**
4. **How Do IAM Roles Work?**
5. **How Does IAM Identity Center Give People AWS Access?**
6. **How Do IAM Policies Describe Access?**
7. **How Do Least Privilege and MFA Reduce Risk?**
8. **How Does the Complete IAM Model Fit Together?**

## How Are Identity, Credentials, and Permissions Different?
<!-- section-summary: Authentication proves the caller's identity, authorization determines permitted actions, and credentials are the evidence used to authenticate. -->

IAM deals with two related but separate problems. **Authentication** asks, “Who are you?” Evidence can include a password, MFA, an access key, temporary security credentials, or a federated login.

**Authorization** asks, “Now that AWS knows who you are, what may you do?” Alice might be allowed to read objects from bucket A and restart EC2 instances while being forbidden to delete the bucket, change IAM, or read the payroll bucket.

Three concepts must therefore remain distinct:

| Concept | Question |
|---|---|
| Identity | Who are you? |
| Credential | How can you prove it? |
| Permission | What may you do? |

An access key is a credential, not a permission. An IAM user is an identity, not a permission. A role is an identity that can be assumed, not a permanent credential. These things interact during a request, but they have different jobs.

### The account owns the resources

AWS resources live under an AWS account:

```text
AWS account
├── EC2 resources
├── S3 resources
├── Lambda resources
└── DynamoDB resources
```

When the account is created, AWS also creates the **root user**, the original identity associated with ownership of that account.

### The root user is the owner identity

The root user has extremely broad control and should not be the normal identity for deployment, database work, log inspection, development, or scripts. Think of it as the owner of the building rather than an employee performing a daily job inside it.

```text
root user
    │
    │ used extremely rarely
    ▼
account-level or emergency operations
```

Some account-level operations require root credentials. That is why the root identity exists and must be recoverable. It should be strongly protected with MFA, should not have long-term root access keys, and should be kept out of everyday workflows. In an AWS Organizations environment, member-account root access can also be secured centrally, including removing root credentials from member accounts.

The durable mental model is: **root is the account's master ownership identity, not the everyday administrator.** Daily people and workloads need identities with smaller, task-specific permissions.

### When Do IAM Users and Groups Fit?
<!-- section-summary: IAM users are persistent identities in one account, while groups are permission-management collections for those users. -->

An **IAM user** is a persistent identity inside one AWS account. If a company has Alice, Bob, and Charlie, it can create one IAM user for each:

```text
AWS account
├── Alice
├── Bob
└── Charlie
```

An IAM user can have long-lived credentials such as a console password or an access key ID and secret access key. Creating the user does not grant useful access by itself. A new IAM user has no permissions until policies grant them.

Alice might receive `s3:GetObject`. Bob might receive `ec2:StartInstances` and `ec2:StopInstances`. This works for a small number of users, but assigning the same policies separately to a hundred developers becomes difficult to maintain.

#### Groups reduce repeated permission work

An **IAM group** is a collection used to assign permissions to IAM users. Instead of attaching the same developer policies to one hundred users, the account can attach those policies once to a `Developers` group:

```text
              Developers group
             /        |        \
          Alice      Bob      Charlie
```

Users in the group receive the group's permissions. A user can belong to several groups, and the effective permissions can come from each. Groups cannot contain other groups.

The group is not an authenticated identity. Nobody signs in as `Developers`, and a group cannot be used as the principal in an IAM resource policy. It has no password, access key, or role session. Its purpose is to organize permissions for IAM users.

```text
IAM user  → persistent identity
IAM group → permission-management collection for users
```

IAM users and groups remain useful in specific cases, but a persistent user can also create persistent credential risk. That is why modern AWS guidance prefers federation and temporary credentials for workforce access where possible, and reserves IAM users for cases that the federated model does not support.

## Why Are Temporary Credentials Safer Than Long-Lived Keys?
<!-- section-summary: Temporary credentials expire automatically, reducing the storage, rotation, offboarding, and compromise risks created by permanent access keys. -->

Suppose an application must upload files to S3. One design creates an IAM user named `uploader-app`, generates a long-lived access key, and stores it on the server:

```text
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

The request can work, but the application now owns a permanent secret. The team must answer a long list of operational questions:

- Where is the key stored?
- How is it distributed?
- Who can read it?
- How often is it rotated?
- What if somebody copies it?
- What happens when an employee leaves?
- What if the key is committed to a public repository?
- What if the application prints it in a log?

If a long-lived key is stolen, it may remain usable until somebody detects the compromise and deactivates or deletes it. Every copy of the value becomes another place that must be found and cleaned up.

The safer credential is often one that the team never needs to store permanently. **AWS Security Token Service**, or **STS**, issues temporary credentials that behave like AWS API credentials but expire automatically.

```text
trusted identity
      │
      │ requests temporary access
      ▼
     STS
      │
      │ issues temporary credentials
      ▼
AWS API requests
```

A credential valid for one hour becomes invalid when the session expires. A stolen temporary credential is still a security incident, but the time in which it can be used is bounded. Temporary sessions also reduce manual rotation work because AWS issues and expires the credentials as part of the access flow.

AWS recommends temporary credentials for both humans and workloads wherever the access pattern supports them. IAM roles are the primary identity mechanism that uses this temporary-credential model.

## How Do IAM Roles Work?
<!-- section-summary: An IAM role separates who may assume an identity from what the resulting temporary role session may do. -->

An **IAM role** is an identity with permissions and no permanent credentials attached to it. An authorized principal assumes the role, and STS issues temporary credentials for a role session.

Imagine a rack of temporary badges:

```text
permanent identity: Alice
available role:     ProductionReadOnly
```

Alice first authenticates as herself. She then assumes the role:

```text
Alice
   │
   │ AssumeRole
   ▼
ProductionReadOnly role session
   │
   │ temporary credentials
   ▼
read production resources
```

Alice has not become a permanent user named `ProductionReadOnly`. She operates as that role for one temporary session. When the session expires, its credentials become invalid.

### A role answers two policy questions

Every role has two sides:

```text
WHO may become this role?
WHAT may the role do after it is assumed?
```

The role's **trust policy** answers the first question. It identifies principals trusted to assume the role. The trusted principal could be Alice, an AWS service such as EC2, an approved principal in another account, or another supported identity.

The role's **permissions policies** answer the second question. Once a principal has assumed `ProductionReadOnly`, the resulting session might be allowed to perform `s3:GetObject`, `dynamodb:GetItem`, and `cloudwatch:GetMetricData` on specified resources.

```text
trust policy
  → who can enter the role

permissions policy
  → what the role session can do after entry
```

A caller can have permission to request `AssumeRole`, but the role must also trust that caller. Likewise, a correct trust relationship only permits entry; it does not by itself grant access to S3, DynamoDB, or CloudWatch after entry.

### Workloads should normally use roles

Software running on EC2 may need `s3:GetObject`. Embedding an IAM user's permanent key on the server creates a secret to store and rotate. Attaching an application role creates a different path:

```text
EC2 instance
      │
      │ receives AppRole credentials
      ▼
temporary role credentials
      │
      ▼
     S3
```

AWS can make temporary credentials available to the compute environment, and AWS SDKs can discover and refresh them automatically. Lambda functions use execution roles for the same reason. Container workloads can also receive workload-specific roles through their AWS runtime integration.

The rule is simple:

```text
code needs AWS access
        │
        ▼
usually choose a role,
not an IAM user with a permanent key
```

### Roles support cross-account access

Suppose a company separates development and production accounts. It does not need to create permanent users and keys for each developer in both accounts. A centrally authenticated developer can assume a role in production:

```text
developer
   │
   │ authenticates centrally
   ▼
approved identity
   │
   │ AssumeRole
   ▼
ProductionReadOnly role in production account
```

The production role's trust policy identifies the approved caller. Its permissions limit the session to production reads. STS supplies temporary credentials. Roles therefore provide delegated cross-account access without sharing one account's permanent credentials with another.

![The request gate shows how a caller enters a trusted role, receives temporary credentials, and then faces normal policy evaluation for each AWS API request](/content-assets/articles/article-cloud-providers-aws-identity-security-identity-security-mental-model/iam-request-gate.png)

*A role's trust policy controls entry, while its permissions control the actions available after entry.*

## How Does IAM Identity Center Give People AWS Access?
<!-- section-summary: IAM Identity Center connects a workforce identity source to permission sets, IAM roles, and temporary AWS account sessions. -->

Roles solve temporary access for workloads and cross-account delegation. A company with 2,000 employees and 50 AWS accounts still needs a manageable workforce sign-in system. Creating 50 separate copies of Alice, Bob, and Charlie as IAM users would multiply onboarding, credential, and offboarding work.

**AWS IAM Identity Center** centralizes workforce access to AWS accounts and applications. It can maintain users itself or integrate with an external identity provider or directory.

```text
company identity source
├── Developers
└── Finance
       │
       ▼
IAM Identity Center
       │
       ▼
assigned AWS accounts and access levels
```

Alice authenticates through the company identity system. Identity Center knows which accounts and access assignments belong to her. She may receive Developer access in the development account and ReadOnly access in production.

### Permission sets become account roles

A **permission set** is a centrally managed description of the access someone should receive in an AWS account. A `ReadOnly` permission set may allow resource inspection without modifications. A `DatabaseAdmin` permission set may contain permissions for RDS, DynamoDB, and Aurora operations.

Identity Center provisions corresponding IAM roles into the assigned AWS accounts. An authorized user reaches the role through the AWS access portal or CLI and receives a temporary session:

```text
Alice
  │
  │ authenticates
  ▼
Identity Center
  │
  │ selects account + permission set
  ▼
IAM role in target account
  │
  │ STS temporary credentials
  ▼
AWS API requests
```

The permission set and IAM role are related but not identical. The permission set is the centralized template and assignment. Identity Center uses it to create and manage the role that exists in the target account. The user ultimately operates through a temporary role session.

The useful simplification is: **Identity Center manages workforce access; IAM roles represent the AWS permissions workers temporarily receive.** IAM Identity Center sits above IAM for human access, while IAM roles and policies still enforce the permissions underneath.

## How Do IAM Policies Describe Access?
<!-- section-summary: IAM JSON policies describe effects, actions, resources, principals, and conditions from either the identity or resource side of an access relationship. -->

Identities answer who can make a request. **Policies** describe what those identities or sessions may do. A simple IAM policy is a JSON document:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::company-reports/*"
    }
  ]
}
```

Read the statement as: allow the holder of this permission to perform the S3 `GetObject` API action on objects under the `company-reports` bucket.

The core vocabulary is small:

| Policy element | Meaning |
|---|---|
| `Effect` | Whether the statement allows or denies |
| `Action` | Which AWS API operation or operations |
| `Resource` | Which AWS resource or resource set |
| `Principal` | Which caller, where that element is supported |
| `Condition` | Which request facts must be true |

An action such as `s3:GetObject` names an API operation. A resource ARN such as `arn:aws:s3:::financial-data/*` narrows that operation to objects in a defined location. A condition can require MFA, a specific VPC endpoint, a source network, or a resource tag such as `Environment=Development`.

IAM is therefore more expressive than an `admin` or `non-admin` switch. A policy can narrow the action, target, circumstances, and sometimes the principal.

### Identity and resource policies describe opposite sides

Suppose Alice needs to read one S3 bucket:

```text
Alice ─────→ S3 bucket
```

An **identity-based policy** starts from Alice: “Alice may read bucket X.” It attaches to a user, group, or role.

A **resource-based policy** starts from the bucket: “Bucket X accepts reads from Alice.” It attaches to the resource and names an allowed principal where the service supports that model.

```text
identity-based policy
Alice → can access bucket X

resource-based policy
bucket X → accepts principal Alice
```

An IAM role's trust policy is an important resource-based policy: the role names the principals it trusts to assume it. AWS evaluates applicable identity-based and resource-based permissions together, with additional rules for same-account and cross-account requests.

### How Does AWS Reach an Allow or Deny Decision?
<!-- section-summary: Requests begin implicitly denied, require a sufficient allow, and remain denied whenever an applicable explicit deny or guardrail blocks them. -->

IAM begins from denial:

```text
no permission → denied
```

You do not normally need to write a deny for every unmentioned action. If no applicable policy grants the request, the result is an **implicit deny**.

The simplified evaluation model is:

```text
                  request
                     │
                     ▼
          applicable explicit Deny?
             ┌───────┴───────┐
            yes              no
             │                │
           DENY       sufficient applicable Allow?
                           ┌───┴───┐
                          yes      no
                           │        │
                         ALLOW     DENY
```

An applicable explicit deny overrides an allow. Suppose policy A allows `s3:*`, while policy B denies `s3:DeleteBucket`. Reads and writes may still be allowed, but `DeleteBucket` remains denied because the explicit deny wins.

```text
GetObject    → potentially allowed
PutObject    → potentially allowed
DeleteBucket → denied
```

#### Other policies can act as ceilings

Real environments may evaluate several policy types:

```text
identity policies
resource policies
permissions boundaries
session policies
AWS Organizations service control policies
AWS Organizations resource control policies
```

Some policy mechanisms grant permissions. Others define the maximum permissions that can survive evaluation. A permissions boundary can cap what an IAM user or role may receive. An Organizations service control policy can set an outer guardrail for member accounts. Session policies can further restrict a particular temporary session.

This explains why seeing `AdministratorAccess` attached to an identity does not prove that every request will succeed. An explicit deny or another limiting policy can still block the operation. Debugging IAM requires identifying all policy layers relevant to the request, not only the most obvious identity policy.

## How Do Least Privilege and MFA Reduce Risk?
<!-- section-summary: Least privilege narrows actions, resources, context, and time, while MFA strengthens the proof used to start a human session. -->

If Alice only needs to read one report, the easiest policy might allow every action on every resource:

```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```

That would solve the immediate access problem while also allowing unrelated database deletion, IAM changes, EC2 termination, network changes, and reads from other buckets.

The **principle of least privilege** grants only the permissions required for the intended task. It can narrow four dimensions:

```text
             broad                         narrow

Actions      s3:*            →             s3:GetObject
Resources    *               →             one bucket or prefix
Context      anywhere        →             approved request context
Time         permanent       →             temporary session
```

Policies narrow actions, resources, and conditions. Roles and STS narrow time because their credentials expire.

Least privilege is blast-radius reduction. If application A has `Action: *` and `Resource: *`, a stolen credential gives an attacker enormous capability. If application B can only perform `s3:GetObject` under `arn:aws:s3:::public-product-images/*`, the compromise is still serious, but the possible actions and resources are much smaller.

Least privilege does not prevent every credential compromise. It limits what can happen if one occurs.

### MFA strengthens authentication

If Alice signs in with only a password, a stolen password may be enough for an attacker to authenticate as Alice. **Multi-factor authentication**, or **MFA**, adds another factor such as a security key or authenticator:

```text
password + security key or authenticator
```

AWS recommends MFA, especially for root and IAM users, and recommends phishing-resistant methods where possible.

MFA primarily strengthens authentication. It does not grant S3 access or any other permission. Policies still decide what Alice may do.

```text
MFA
Are you really Alice?

IAM authorization
May Alice delete this bucket?
```

Policies can connect the two by using MFA presence as a condition. In that case, a statement may permit a sensitive action only when the request context proves that the session used MFA.

![The summary connects protected root access, temporary human and workload sessions, policy evaluation, MFA, and least privilege](/content-assets/articles/article-cloud-providers-aws-identity-security-identity-security-mental-model/identity-security-summary.png)

*MFA strengthens the start of the session, while policies and temporary credentials control its scope and duration.*

## How Does the Complete IAM Model Fit Together?
<!-- section-summary: Humans and workloads authenticate through different paths, receive temporary role sessions, and submit requests that AWS evaluates against policies and guardrails. -->

A modern human access path can be followed from authentication to authorization:

```text
Alice
  │
  │ password + MFA or corporate authentication
  ▼
corporate identity provider
  │
  ▼
IAM Identity Center
  │
  │ assigned account + permission set
  ▼
IAM role in target account
  │
  │ STS temporary credentials
  ▼
AWS API request
  │
  │ Principal + Action + Resource + Context
  ▼
policy evaluation
  ├── ALLOW
  └── DENY
```

A workload takes a shorter path:

```text
Lambda function or EC2 application
      │
      │ associated IAM role
      ▼
temporary role credentials
      │
      ▼
AWS API request
      │
      ▼
policy evaluation
      ├── ALLOW
      └── DENY
```

Root remains outside normal paths:

```text
root user
   │
   │ strong protection + MFA
   ▼
rare account-level or emergency operation
```

### An online shop example

Suppose one AWS account contains an S3 bucket named `product-images`, a DynamoDB Orders table, a Lambda function named `checkout-service`, and two humans: Alice the developer and Bob in finance.

The checkout function needs to write orders. It does not need to delete the Orders table, change IAM, terminate EC2 instances, or read unrelated S3 buckets. The function therefore uses a `CheckoutRole` that allows `dynamodb:PutItem` on the Orders table. Lambda receives temporary role credentials for that execution environment.

Alice signs in to the company identity system with MFA. Identity Center assigns her a Developer permission set in the development account and a ReadOnly permission set in production. When she selects an account, she receives a temporary role session. Bob receives a Finance role appropriate to his work. The root credentials remain protected for rare account operations.

The checkout request becomes:

```text
Principal: CheckoutRole session
Action:    dynamodb:PutItem
Resource:  Orders table
Context:   current temporary role session
```

If the applicable policies permit the request, AWS returns `ALLOW`. If the application attempts `dynamodb:DeleteTable` and no policy grants it, the request remains implicitly denied.

### Put each IAM feature into one box

IAM feels complicated when users, groups, roles, permission sets, access keys, MFA, STS, Identity Center, service control policies, resource policies, and trust policies are memorized separately. They become easier to place in four boxes:

| Question | IAM concepts |
|---|---|
| Who are you? | root, IAM user, federated user, role session |
| How do you prove it? | password, MFA, access key, STS temporary credentials, identity-provider login |
| What may you do? | IAM policies, resource policies, permission sets |
| What limits access? | explicit deny, boundaries, SCPs, session policies, conditions |

Three comparisons resolve common confusion.

**IAM user versus IAM role:** a user is a persistent identity that may have persistent credentials. A role is an assumable identity whose sessions use temporary credentials. A user says, “I am Alice.” A role session says, “For this session, I am operating as ProductionReadOnly.” Roles fit workloads, cross-account access, federated humans, and temporary privilege.

**IAM group versus IAM role:** a group collects IAM users so their permissions are easier to manage. A role is an identity that trusted principals can assume. You do not assume a group, and a role is not a folder containing users.

**Identity Center versus IAM:** Identity Center manages workforce sign-in and account assignments. It uses permission sets to provision roles. IAM roles and policies still enforce the resulting AWS access. Identity Center often sits above IAM rather than replacing it.

![The IAM foundation keeps protected root access, workforce sessions, workload roles, policy decisions, MFA, and least privilege in one model](/content-assets/articles/article-cloud-providers-aws-identity-security-identity-security-mental-model/iam-access-foundation-summary.png)

*Each IAM feature contributes to identity, proof, permission, or limitation for an AWS request.*

The complete subject can be retained as ten rules:

1. Every AWS operation is fundamentally an API request.
2. IAM helps AWS decide whether that request should be allowed.
3. Authentication establishes the principal; authorization establishes what the principal may do.
4. The root user is the account's highly privileged ownership identity and should be used rarely.
5. IAM users are persistent identities and can have long-term credentials, so modern designs use them sparingly.
6. IAM groups organize permissions for IAM users and are not identities that can sign in.
7. IAM roles are assumable identities whose sessions receive temporary STS credentials.
8. Humans should normally use federation and Identity Center, while AWS workloads should normally use roles.
9. Policies evaluate principals, actions, resources, and conditions; requests start denied, and explicit deny overrides allow.
10. Least privilege minimizes actions, resources, context, and access duration.

All ten rules lead back to the same decision:

```text
Who are you?
     +
What are you trying to do?
     +
To which resource?
     +
Under which conditions?
     │
     ▼
evaluate applicable policies
     │
     ▼
   ALLOW or DENY
```

## Check Your Answers

:::expand[How Does IAM Decide Whether AWS Should Accept a Request?]{kind="recap"}
IAM helps AWS evaluate the principal, action, resource, and request context before returning allow or deny.

IAM helps evaluate the principal, action, resource, and request context against applicable policies. The result is either allow or deny.
:::

:::expand[How Are Identity, Credentials, and Permissions Different?]{kind="recap"}
Authentication proves the caller's identity, authorization determines permitted actions, and credentials are the evidence used to authenticate.

An identity is who the caller is, a credential proves that identity, and a permission describes what the authenticated caller may do. Root is the account's ownership identity and should stay outside daily work.

IAM users are persistent identities in one account, while groups are permission-management collections for those users.

An IAM user is a persistent identity in one account and may have long-lived credentials. An IAM group collects users for permission management but cannot authenticate or act as a policy principal.
:::

:::expand[Why Are Temporary Credentials Safer Than Long-Lived Keys?]{kind="recap"}
Temporary credentials expire automatically, reducing the storage, rotation, offboarding, and compromise risks created by permanent access keys.

Temporary STS credentials expire automatically, which limits their useful lifetime and removes much of the storage and rotation burden created by permanent keys.
:::

:::expand[How Do IAM Roles Work?]{kind="recap"}
An IAM role separates who may assume an identity from what the resulting temporary role session may do.

A role has no permanent credentials. Its trust policy says who may assume it, its permissions say what the role session may do, and STS supplies temporary credentials for the session.
:::

:::expand[How Does IAM Identity Center Give People AWS Access?]{kind="recap"}
IAM Identity Center connects a workforce identity source to permission sets, IAM roles, and temporary AWS account sessions.

Identity Center connects a workforce directory to account assignments and permission sets. Those permission sets provision IAM roles that users access through temporary sessions.
:::

:::expand[How Do IAM Policies Describe Access?]{kind="recap"}
IAM JSON policies describe effects, actions, resources, principals, and conditions from either the identity or resource side of an access relationship.

Policies use effects, actions, resources, principals where applicable, and conditions. Identity-based policies start from the caller, while resource-based policies start from the target resource.

Requests begin implicitly denied, require a sufficient allow, and remain denied whenever an applicable explicit deny or guardrail blocks them.

A request begins implicitly denied, needs a sufficient applicable allow, and stays denied if any applicable explicit deny or limiting guardrail blocks it.
:::

:::expand[How Do Least Privilege and MFA Reduce Risk?]{kind="recap"}
Least privilege narrows actions, resources, context, and time, while MFA strengthens the proof used to start a human session.

Least privilege narrows actions, resources, context, and time to reduce compromise blast radius. MFA strengthens authentication by requiring another proof before a human session begins.
:::

:::expand[How Does the Complete IAM Model Fit Together?]{kind="recap"}
Humans and workloads authenticate through different paths, receive temporary role sessions, and submit requests that AWS evaluates against policies and guardrails.

Humans authenticate through a workforce system and workloads use service integrations; both commonly receive temporary role sessions. Every API request then supplies a principal, action, resource, and context for policy evaluation.
:::

## References

- [What is IAM?](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)
- [Root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)
- [IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html)
- [IAM user groups](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_groups.html)
- [Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html)
- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Create an IAM user](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users_create.html)
- [What is IAM Identity Center?](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [Manage AWS accounts with permission sets](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html)
- [Identity-based and resource-based policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html)
- [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
- [How AWS evaluates allow and deny](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html)
