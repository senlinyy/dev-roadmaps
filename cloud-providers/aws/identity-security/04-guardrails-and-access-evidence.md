---
title: "Guardrails and Access Evidence"
description: "Learn how organization guardrails limit AWS authority and how CloudTrail, Access Analyzer, last-accessed data, and credential reports support access reviews."
overview: "A multi-account AWS environment needs two different security systems: guardrails that prevent unacceptable actions and evidence that shows which access paths exist or have been used. This article builds both systems from the IAM authorization model, then combines them in a repeatable review loop."
tags: ["iam", "organizations", "cloudtrail", "access-analyzer"]
order: 4
id: article-cloud-providers-aws-identity-security-account-guardrails
aliases:
  - guardrails-and-access-evidence
  - account-guardrails
  - service-control-policies
  - aws-organizations-iam
  - access-evidence
  - iam-access-evidence
  - cloudtrail-iam-evidence
  - secrets-encryption-and-security-evidence
  - article-cloud-providers-aws-identity-security-access-evidence
  - cloud-providers/aws/identity-security/account-guardrails.md
  - cloud-providers/aws/identity-security/06-account-guardrails.md
  - cloud-providers/aws/identity-security/access-evidence.md
  - cloud-providers/aws/identity-security/07-access-evidence.md
  - cloud-providers/aws/identity-security/secrets-encryption-and-security-evidence.md
---

## Table of Contents

1. [How Are Guardrails Different From Access Evidence?](#how-are-guardrails-different-from-access-evidence)
2. [How Does the Account Map Show Where Authority Can Travel?](#how-does-the-account-map-show-where-authority-can-travel)
3. [Which Capabilities Belong in Guardrails?](#which-capabilities-belong-in-guardrails)
4. [How Does Cross-Account Access Work?](#how-does-cross-account-access-work)
5. [What Does CloudTrail Prove?](#what-does-cloudtrail-prove)
6. [What Do Access Analyzer and Last-Accessed Data Prove?](#what-do-access-analyzer-and-last-accessed-data-prove)
7. [How Do Can, Did, and Should Guide an Access Review?](#how-do-can-did-and-should-guide-an-access-review)
8. [How Does the Review Loop Combine Guardrails and Evidence?](#how-does-the-review-loop-combine-guardrails-and-evidence)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An IAM policy answers an important question: what may this principal request? In a growing AWS environment, however, that is only one part of the security problem. Teams also need to prevent certain actions even when an account administrator makes a bad permission change. They need to understand how authority crosses account boundaries. Finally, they need evidence for deciding whether the access they granted still matches what people and workloads actually require.

That distinction is the foundation for organizing guardrails, cross-account access, and evidence.

A **guardrail** changes the range of requests that AWS can authorize. It expresses a limit such as, "ordinary principals in production must not disable central audit logging." Service control policies, resource control policies, permissions boundaries, resource restrictions, and session restrictions can all act as guardrails in different parts of the authorization system.

Keep these questions in view as you work through the lesson:

1. **How Are Guardrails Different From Access Evidence?**
2. **How Does the Account Map Show Where Authority Can Travel?**
3. **Which Capabilities Belong in Guardrails?**
4. **How Does Cross-Account Access Work?**
5. **What Does CloudTrail Prove?**
6. **What Do Access Analyzer and Last-Accessed Data Prove?**
7. **How Do Can, Did, and Should Guide an Access Review?**
8. **How Does the Review Loop Combine Guardrails and Evidence?**

## How Are Guardrails Different From Access Evidence?
<!-- section-summary: Guardrails affect authorization, while access evidence describes configured, reachable, attempted, or used access. -->

**Access evidence** describes that system or activity around it. CloudTrail can show that a principal made a request. IAM Access Analyzer can show that a policy creates an access path. Last-accessed information can show that an identity attempted to use a service or supported action during the tracking period. A credential report can show which IAM users have passwords or access keys. These sources normally do not change whether the next request is allowed.

```text
GUARDRAILS                         ACCESS EVIDENCE

What must not be possible?         What access exists or was attempted?

SCPs                               CloudTrail
RCPs                               Access Analyzer
permissions boundaries             Last Accessed
resource restrictions              credential reports
session restrictions               policy and credential inventory
```

Consider three statements:

```text
SCP:
Production principals cannot delete a CloudTrail trail.

CloudTrail event:
A role session called iam:CreateRole yesterday.

Access Analyzer finding:
A role can be assumed from an external account.
```

The first statement affects authorization. The second is evidence of an attempted request. The third is evidence that a reachable path exists whether or not anyone has used it. Treating all three as "IAM controls" hides their different jobs.

A useful end-to-end model begins with required access. A team decides what a person or workload should need, translates that need into IAM and resource-policy grants, and places guardrails around the maximum authority those grants may create. AWS evaluates actual requests inside those limits. Evidence from the resulting configuration and activity then feeds the next access review.

```text
Desired access
     ↓
IAM and resource-policy grants
     ↓ constrained by
Guardrails that define maximum power
     ↓
AWS requests and authorization decisions
     ↓
Access evidence
     ↓
Review and refine desired access
```

The loop matters because the desired answer changes. A deployment role may stop using EC2 after a system moves to Lambda. A vendor contract may end. A new resource policy may accidentally trust an outside account. Evidence helps the team discover those changes; guardrails limit the worst consequences while the team catches up.

This model builds on IAM's default-deny behavior. With no applicable permission, a request is denied. An applicable `Allow` may make the request possible, but an applicable explicit `Deny` wins. AWS may evaluate identity policies, resource policies, permissions boundaries, session policies, Organizations service control policies, and, where supported, resource control policies.

You can summarize the idea—not the literal AWS evaluation algorithm—with this equation:

```text
Effective permissions
    ≈ possible grants
    ∩ organization guardrails
    ∩ principal guardrails
    ∩ session restrictions
    − explicit denies
```

Identity policies and resource policies create possible grants. SCPs and RCPs place organization limits around them. Permissions boundaries limit a principal. Session policies restrict a particular temporary session. Resource-based policy evaluation introduces details that this shorthand does not show, so use it as a mental model rather than an implementation specification.

The most important consequence is simple: an organization guardrail is not automatically a grant. A ceiling can limit the height of a room, but it cannot lift a person off the floor. The next sections make that distinction concrete.

## How Does the Account Map Show Where Authority Can Travel?
<!-- section-summary: A useful account map combines the Organizations hierarchy with trust and resource-policy edges that move authority between security domains. -->

Before reviewing individual policies, map where authority can start and where it can travel. An AWS account is a strong administrative and security boundary. A multi-account environment therefore needs more than a spreadsheet of account IDs.

The AWS Organizations hierarchy gives the first view:

```text
AWS Organization
│
├── Security OU
│   ├── Log Archive
│   └── Security Tooling
│
├── Production OU
│   ├── Payments Prod
│   └── Customer Prod
│
└── NonProd OU
    ├── Development
    └── Sandbox
```

An **organizational unit**, or OU, groups accounts so that governance policies can be attached to a branch. This tree shows containment and inheritance: an account under the Production OU is affected by policies on the organization root, that OU, any child OUs, and the account itself.

Containment is not the same as access. Authority can cross the tree through role trusts and resource policies:

```text
Developer identity ──AssumeRole──────► production role
CI system ───────────AssumeRole──────► deployment role
Vendor account ──────AssumeRole──────► support role
Another account ─────bucket policy───► production bucket
Security tooling ────resource access─► log archive
```

The real account map is therefore a graph. The Organizations hierarchy supplies one set of edges; cross-account trusts and resource policies supply others. A vendor may sit outside the organization tree but still reach a support role. A development identity may enter a deployment role and then pass an execution role to a workload. A bucket policy may grant a principal in another account direct access without role assumption.

The better inventory question is not merely, "How many accounts do we own?" It is, **"Where can authority originate, and through which edges can it reach another account or resource?"**

For every important account, record the information needed to answer that question:

- the account's purpose, OU, and environment classification;
- the approved human and workload access paths;
- inbound role trusts and outbound role assumptions;
- resource shares and resource-based policies;
- external accounts and third parties with a relationship;
- attached SCPs and RCPs;
- the central logging destination and security administrator; and
- the AWS Regions that the account is expected to use.

This map becomes the skeleton of the review. It tells reviewers which policies need to be inspected together and which evidence stores must contain relevant activity. It also exposes **transitive authority**: access gained through a chain rather than one direct grant.

Imagine the following chain:

```text
Alice
  └─ AssumeRole → DevAdmin
         └─ AssumeRole → DeploymentRole
                └─ iam:PassRole → LambdaExecutionRole
                       └─ S3 bucket policy → SensitiveBucket
```

Alice's original identity policy may only allow `sts:AssumeRole` on `DevAdmin`. Read in isolation, that policy appears modest. The security question is not limited to that first hop. Reviewers must ask which resources become reachable through all allowed transitions. IAM security often depends on chains of authority rather than one obviously broad policy.

![The guardrails map shows which controls usually sit at the organization, account, identity, network, data, and evidence layers](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/common-guardrails-map.png)

*The account and control map helps reviewers connect organization boundaries, identity controls, resource controls, and evidence instead of reviewing each one alone.*

### How Do SCPs and RCPs Set Organization Limits?
<!-- section-summary: SCPs limit the authority available to principals in member accounts, while RCPs limit the authority that supported resources can accept. -->

A **service control policy**, or SCP, defines the maximum permissions available to principals governed by an AWS Organizations branch. That makes an SCP a ceiling.

Suppose a developer's identity policy effectively says:

```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```

This resembles administrator access. Now suppose an SCP affecting the production account denies these capabilities:

```text
organizations:LeaveOrganization
cloudtrail:StopLogging
cloudtrail:DeleteTrail
iam:CreateUser
iam:CreateAccessKey
```

The identity policy still attempts to grant every action, but the organization has removed those prohibited capabilities from the maximum. Effective authority is approximately `AdministratorAccess` minus the denied operations. Attaching another broad identity policy inside the member account cannot restore power that the SCP ceiling removed.

![The SCP ceiling view shows how organization-level policy limits the maximum actions an account can use even when an identity policy allows more](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/scp-ceiling-map.png)

*An SCP can remove dangerous capabilities from the member account's maximum authority even when a local identity policy is overly broad.*

SCPs inherit along the Organizations path:

```text
Organization root guardrail
        ∩ Production OU guardrail
        ∩ Payments child OU guardrail
        ∩ account guardrail
        ∩ IAM and resource-policy grants
        = effective permissions
```

An explicit deny at a relevant level blocks the request lower in the hierarchy. In an allow-list SCP strategy, the action must remain allowed through the relevant hierarchy. This is why a member-account administrator cannot simply attach `AdministratorAccess` to escape the company's organization policy. The organization control sits outside the administrator's normal account-level permission domain.

The reverse is equally important: SCPs do not grant access. Imagine an SCP that allows every action on every resource. If Alice has no IAM or resource-policy grant, her effective permissions remain empty.

```text
SCP maximum = everything
IAM grants  = nothing

everything ∩ nothing = nothing
```

The SCP only says that the organization does not remove a capability. Alice must still receive an applicable grant before AWS can allow her request.

SCP scope also has boundaries. SCPs affect member accounts, including their root users. They do not constrain principals operating in the Organizations management account. Service-linked roles are also outside normal SCP restriction. A **service-linked role** is an IAM role linked to an AWS service so that the service can perform required actions on your behalf.

Those exceptions explain two design rules. First, keep routine workloads and day-to-day human administration out of the management account as much as practical. Second, do not assume an SCP is a universal deny mechanism for every AWS principal and service interaction.

SCPs primarily constrain principals governed by the organization. They do not automatically constrain an external principal merely because it accesses a resource in one of your accounts. Resource-side access requires resource-side reasoning.

That is where **resource control policies**, or RCPs, provide a useful mirror:

```text
SCP: How powerful may principals in these accounts become?
RCP: How much access may resources in these accounts accept?
```

Conceptually, an SCP limits the maximum outbound authority held by principals. An RCP limits the maximum inbound exposure accepted by supported resources. RCPs participate in AWS's current policy-evaluation model but have their own service support and applicability rules. You do not need them for every IAM design, yet the symmetry prevents a common blind spot: some access paths begin in identity policies, while others begin on the resource side.

## Which Capabilities Belong in Guardrails?
<!-- section-summary: Strong guardrails express company invariants around catastrophic failure modes rather than trying to duplicate every role's detailed permission policy. -->

Do not begin guardrail design by listing hundreds of AWS API operations that developers should use. Begin with failure modes. Ask, **"What event would be so damaging that no ordinary administrator should be able to cause it?"**

This question identifies **invariants**: facts that must remain true despite local policy mistakes or routine changes.

### Protect audit evidence

Workload administrators should not be able to disable central logging, delete the protected log archive, or modify the roles that manage the audit system. Security automation and tightly controlled security administrators may need exceptions, but those paths should be explicit.

```text
Ordinary account administrator
  ├─ stop central logging ─────── denied
  ├─ delete protected logs ────── denied
  └─ change security role ─────── denied

Approved security path
  └─ controlled exception
```

### Restrict unapproved Regions

An organization may permit workloads only in Regions such as `eu-west-1`, `eu-west-2`, and `us-east-1`. A guardrail can deny requests targeting other Regions. This control needs care because some AWS services are global or use a specific endpoint. A Region deny based on `aws:RequestedRegion` therefore needs appropriate exclusions for global services rather than assuming every request maps cleanly to a regional endpoint.

### Reduce long-lived identities

A production OU can deny operations such as `iam:CreateUser` and `iam:CreateAccessKey` when humans authenticate through federation and workloads use roles. The invariant is not "no one can ever authenticate." It is "normal production access does not depend on newly created, long-lived IAM-user credentials."

### Block privilege-escalation paths

An attacker does not need a policy named `AdministratorAccess` if they can manufacture equivalent authority. Capabilities such as `iam:CreatePolicyVersion`, `iam:AttachRolePolicy`, `iam:PutRolePolicy`, `iam:UpdateAssumeRolePolicy`, and `iam:PassRole` can become escalation paths in the wrong context. Guardrails can reserve sensitive identity administration for dedicated security or automation roles.

### Protect organization integrity

Member accounts should not casually leave the organization, remove central integrations, or modify security infrastructure. These operations affect the control plane that keeps account governance consistent, so they are natural candidates for an organization-level invariant.

### Limit root-user activity

The root user in a member account is extremely powerful, yet member-account root users are within SCP scope. Organizations also supports centralized root-access management. Normal administration should not depend on root, and SCP-based controls can restrict routine root activity while preserving a deliberate recovery process.

These examples share a shape. They do not attempt to define every legitimate application action. They protect a small set of catastrophic boundaries:

```text
Production stays inside the organization.
Central audit logging cannot be disabled by workload administrators.
Workload accounts do not create ordinary long-lived IAM users.
Production stays in approved Regions.
Ordinary principals cannot rewrite security administration paths.
Member-account root is not used for routine work.
```

Least privilege and guardrails solve different problems. Least privilege tries to make today's grants match today's legitimate need. Guardrails make sure that tomorrow's mistaken grant still cannot authorize selected catastrophic operations. A good review needs both.

## How Does Cross-Account Access Work?
<!-- section-summary: Cross-account access requires authorization in separate security domains and can use either temporary role sessions or supported resource-based policies. -->

Two AWS accounts are separate security domains. If Alice in Account A needs production access in Account B, both domains normally participate in authorizing the path.

The first major pattern is `AssumeRole`. Account B contains a role such as `ProdReadOnlyRole`. The role's **trust policy** identifies who may become that role. Alice's permissions in Account A allow her to call `sts:AssumeRole` on that target role.

Think of the entry step as two locks:

```text
Account A identity policy
  allows sts:AssumeRole on ProdReadOnlyRole?
                  ↓ yes

Account B role trust policy
  trusts Alice's principal or account?
                  ↓ yes

AWS STS issues an assumed-role session
```

**AWS Security Token Service**, or STS, issues temporary credentials for the new role session. Its ARN has a form like:

```text
arn:aws:sts::222222222222:assumed-role/ProdReadOnlyRole/alice
```

Cross-account role access has two distinct authorization questions:

1. May Alice enter the role? Her source permissions, the target trust policy, and applicable guardrails determine whether `AssumeRole` succeeds.
2. After she becomes the role, what may the role session do? The role's permissions, SCPs, permissions boundary or session restrictions, and resource controls determine requests such as `s3:GetObject` or a database description call.

Keeping entry separate from action prevents a great deal of IAM confusion.

A role's trust and permissions policies therefore answer different questions:

```text
Trust policy:       Who may become this role?
Permissions policy: What may the resulting role session do?
```

For example, `VendorSupportRole` may trust a specific vendor account, while its permissions allow only `cloudwatch:GetMetricData` and `logs:GetLogEvents`. Trusting the vendor to enter the role does not give the vendor administrator access. The session receives only the role's effective capabilities.

Third-party access needs another layer of care. A software provider may operate one AWS account for thousands of customers. If your trust policy recognizes only that provider account, another customer could potentially cause the provider to request your role on the wrong customer's behalf. This is the **confused deputy problem**.

An `ExternalId` condition helps bind role assumption to the intended customer relationship:

```text
Provider principal matches
        AND
ExternalId matches this customer relationship
        ↓
AssumeRole may proceed
```

The deeper lesson is that the provider's identity may not be enough. The trust decision sometimes must also identify which tenant or relationship caused the provider's request.

The second major pattern is direct cross-account resource access. A principal in Account A can request an S3 object in Account B when the requesting side permits the principal and the bucket policy on the resource-owning side permits the cross-account request. No target role session is required.

```text
Account A identity policy
          +
Account B resource policy
          =
possible cross-account resource access
```

This is why an access review cannot stop at IAM users, roles, and identity policies. Resource-side edges can appear in S3 bucket policies, KMS key policies, SQS queue policies, SNS topic policies, Secrets Manager resource policies, role trust policies, and other supported resource policies.

![The cross-account flow shows how temporary role sessions give central tooling access without sharing permanent credentials across accounts](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/cross-account-temporary-access.png)

*Cross-account role assumption uses temporary sessions, but reviewers must evaluate both the entry trust and the permissions available after entry.*

Combine these ideas with the account graph. A harmless-looking first role assumption may lead to another role, `iam:PassRole`, and a resource policy. Reviewing the full reachable chain is more accurate than reviewing one policy document at a time.

## What Does CloudTrail Prove?
<!-- section-summary: CloudTrail is activity evidence for observed AWS requests, but its ability to prove absence depends on event coverage, retention, Region, and search scope. -->

**AWS CloudTrail** records AWS activity as events. A relevant event can answer questions such as:

- Who made the request: a user, role session, workload, or AWS service?
- What API action was requested?
- When and in which Region did the request occur?
- What source context, request parameters, and resources were involved?
- Did the event include success or error information?

Conceptually, a configured access path makes a request possible. A human or workload makes an actual request. AWS authorizes or denies it. CloudTrail records activity evidence for the request when the event type is covered by the logging configuration.

CloudTrail is especially useful because last-accessed summaries can include attempts. A summary saying that IAM was accessed yesterday does not tell you whether the principal changed IAM successfully. The CloudTrail event can reveal the precise API operation, actor, parameters, and an `AccessDenied` result.

CloudTrail's strength does not make every missing event proof that nothing happened. Observation coverage matters.

The built-in CloudTrail Event history provides 90 days of management events in each Region. **Management events** describe control-plane operations such as creating or changing AWS resources. Event history does not provide data events, network activity events, or Insights events. Longer retention and additional event classes require the appropriate trail, event data store, and event selectors.

For example, creating an S3 bucket is normally a management event. Reading an object with `GetObject` is data-plane activity and requires appropriate S3 data-event collection. A reviewer who searches only Event history for `GetObject` is not observing the full question.

Therefore a missing result can mean several different things:

```text
1. The request did not happen.
2. The relevant time is outside retention.
3. That event type was not collected.
4. The reviewer searched the wrong Region, account, trail, or store.
```

This distinction is a general evidence rule: **evidence of absence requires sufficiently complete observation coverage; absence of evidence does not.** Before using CloudTrail to justify deleting access, confirm that the event class, resources, accounts, Regions, and time window were actually collected and retained.

CloudTrail answers "what request happened?" It does not by itself enumerate every path that policy configuration would allow. A resource can be exposed to an external account even when that account has never made a request. That is the next evidence problem.

## What Do Access Analyzer and Last-Accessed Data Prove?
<!-- section-summary: Access Analyzer finds possible policy paths, while last-accessed and unused-access data create review hypotheses about permissions and credentials that may no longer be needed. -->

**IAM Access Analyzer** analyzes policies and access paths. Suppose a production bucket policy allows account `888888888888`, but that account has never read an object. CloudTrail may show no observed access. Access Analyzer can still report that external access exists.

Both results can be correct:

```text
CloudTrail:      Did a covered request occur?
Access Analyzer: Does policy analysis expose an access path?
```

An external-access finding is about possible access, not proof that the external entity used it. That makes the finding valuable even when activity logs are quiet: the door may be open although nobody appears to have walked through it.

External analysis needs a boundary between expected and unexpected principals. Access Analyzer calls this the **zone of trust**. The zone may be an account or the whole AWS Organization. A relationship between two accounts inside the organization may be considered internal; a path from a vendor account outside the organization can appear as external access.

```text
Account map + zone of trust + policy analysis
                    ↓
Which access edges cross the intended boundary?
```

Access Analyzer supports several useful evidence categories:

- **External access:** Which supported resources are reachable from outside the chosen trust zone?
- **Internal access:** Which principals inside the organization or account have effective paths to selected resources?
- **Unused access:** Which roles, permissions, access keys, or passwords appear not to have been used within a configured period?

Internal analysis is not merely a list of identity policies. For the selected resources, effective paths can depend on identity policies, resource policies, SCPs, RCPs, and permissions boundaries. It helps answer, "Who inside can reach the crown jewels?"

IAM **last-accessed information** answers another question: when did an identity attempt to use a service or supported management action? Imagine a principal granted access to S3, DynamoDB, EC2, Lambda, RDS, and KMS. The evidence shows recent S3 and DynamoDB activity, Lambda activity 70 days ago, and no EC2, RDS, or KMS activity within the tracking data.

That creates a least-privilege hypothesis: perhaps the principal no longer needs EC2, RDS, and KMS. It is not yet proof. Service-level last-accessed information has a tracking period of at least 400 days, and the data includes attempted access rather than only successful access. An old disaster-recovery capability may also be legitimate despite rare use.

A compact comparison helps keep the tools straight:

| Review question | Better evidence |
|---|---|
| Was a service used recently? | Last-accessed information |
| Exactly who requested an API and with which parameters? | CloudTrail |
| Did an attempted request fail? | CloudTrail |
| Which granted services or permissions appear unused? | Last Accessed or unused Access Analyzer |
| Could an outside account reach a supported resource? | Access Analyzer |

Think of last-accessed information as a summary index and CloudTrail as an event ledger. The summary can point a reviewer toward IAM usage; the ledger supplies the event-level detail needed to understand success, failure, caller, target, and context.

Unused-access analysis helps at scale. In an environment with thousands of roles, manually inspecting each one is not practical. An unused-access analyzer can use a threshold from 1 to 365 days and identify review candidates such as inactive roles, unused permissions, unused access keys, and unused passwords.

The output is a queue for investigation, not an automatic deletion list. A disaster-recovery role, break-glass identity, annual financial process, incident-response permission, or failover automation may legitimately remain quiet for months. The correct flow is:

```text
Granted access
    ↓ no observed need during the threshold
Review candidate
    ├─ still justified → document and retain
    └─ not justified  → narrow or remove
```

Evidence informs judgment. It cannot replace ownership, architecture knowledge, and an explanation of why the capability should exist.

### How Do Static Credentials and Credential Reports Fit?
<!-- section-summary: Static credentials describe how an identity authenticates, and credential reports inventory IAM-user password, MFA, and access-key state for review. -->

An **identity** is the person or workload that AWS recognizes. A **credential** is evidence presented to authenticate as that identity. An IAM user named `ci-system` is an identity; its access key ID and secret access key form a credential.

IAM-user access keys are long-lived. They remain usable until someone rotates, disables, or deletes them. Temporary credentials come from patterns such as:

```text
EC2 instance → IAM role
Lambda function → execution role
federated human → AssumeRole
GitHub OIDC identity → AssumeRoleWithWebIdentity
```

AWS recommends temporary credentials where possible: federation or IAM Identity Center for humans, and IAM roles for workloads. Expiration does not make credential theft harmless, but it limits how long stolen credentials remain useful. A leaked static key can work until revocation; a leaked temporary credential stops working when the session expires.

Do not confuse an AWS credential secret with an application secret. An AWS access key contains an access key ID and a secret access key; that secret proves the caller is an AWS principal. An application may separately need a database password, payment-provider API key, GitHub token, OAuth client secret, or TLS private key.

```text
IAM credential:
Proves that the caller is principal P.

Application secret:
Provides a confidential value the application needs.
```

Moving `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from source code into Secrets Manager is safer than committing them to a repository. It does not remove the architectural problem that a long-lived AWS credential still exists and must be distributed, rotated, and revoked. When possible, give the workload an IAM role and let it receive temporary credentials instead.

If IAM users still exist, the team needs an inventory of their authentication state. The **IAM credential report** contains account-level fields such as:

- whether a user has a console password and when it was last used;
- whether multi-factor authentication is active;
- whether either of the user's access keys is active;
- when each key was created or rotated;
- when a key was last used, including the last service and Region; and
- credential information for the account root user.

The report supports concrete questions: Which IAM users still have console passwords? Who lacks MFA? Which keys appear unused? Does a retired identity retain active credentials? Does root have credentials? Did a key rotation leave two active keys indefinitely?

This report is **credential-state evidence**, not authorization evidence. It describes how an IAM user can authenticate. The user's IAM policies describe what the authenticated identity may do. CloudTrail describes covered requests that the identity made. Access Analyzer describes supported paths that policies make reachable.

Keeping those categories separate prevents misleading conclusions. An inactive access key does not prove the identity has no permissions. A broad policy does not prove that a usable credential exists. A successful authentication mechanism does not prove that the principal exercised a particular permission.

## How Do Can, Did, and Should Guide an Access Review?
<!-- section-summary: A sound access decision combines configuration, reachability, activity, usage summaries, and the organization's own statement of legitimate need. -->

The evidence sources in this article fall into four groups.

1. **Configuration evidence** answers, "What is configured?" It includes IAM policies, role trust policies, SCPs, RCPs, resource policies, permissions boundaries, and access-key state.
2. **Reachability evidence** answers, "Which paths are possible?" It includes Access Analyzer, authorization analysis, and policy simulation.
3. **Activity evidence** answers, "What happened?" CloudTrail is the main example here.
4. **Usage-summary evidence** answers, "What seems to have been needed over time?" It includes last-accessed information, unused-access findings, and credential last-used fields.

One category cannot substitute for another:

```text
No CloudTrail activity
    ≠ no access path exists

Access Analyzer finds a path
    ≠ the path was exercised

Last accessed shows no attempt
    ≠ deletion is definitely safe
```

For each important relationship between principal P and resource R, ask three questions.

**CAN?** Can P access R under the current authorization system? Inspect identity policies, resource policies, trust policies, SCPs, RCPs, permissions boundaries, session restrictions, and reachability analysis.

**DID?** Did P actually request access to R? Inspect CloudTrail with event coverage and retention appropriate to that request.

**SHOULD?** Does P have a legitimate reason to access R? This answer comes from business ownership, job responsibility, application architecture, system design, an approved change, and security policy. AWS cannot decide the organization's intent.

The three questions intersect:

```text
CAN ∩ DID ∩ SHOULD
```

The **should** question is primary. A permission can be used regularly and still be illegitimate. A permission can be unused and still be required for tested disaster recovery. Technical evidence has meaning only in comparison with an explicit requirement.

Consider `FinanceReportingRole` with these effective grants:

```text
s3:GetObject on finance-data/*
kms:Decrypt using FinanceKey
dynamodb:*
ec2:*
```

First, configuration evidence says the role can read encrypted finance objects and has broad DynamoDB and EC2 permissions. Next, the production SCP blocks IAM administration, unapproved-Region requests, and CloudTrail tampering, but does not remove DynamoDB or EC2. Those broad grants are therefore real within the remaining controls.

Access Analyzer shows that the role is reachable from the Finance identity account and has no external path. That is useful reachability evidence, but it does not prove the permission set is narrow.

CloudTrail and usage summaries show regular S3 and KMS activity, with no observed DynamoDB or EC2 use. The application owner explains that reports only read encrypted objects from S3. The architecture, the current grants, the reachable path, and observed use now point in the same direction: `dynamodb:*` and `ec2:*` are not supported by the role's legitimate purpose.

The evidence-driven change is:

```text
Before:
s3:GetObject + kms:Decrypt + dynamodb:* + ec2:*

After:
s3:GetObject + kms:Decrypt
```

This is iterative least privilege. The team did not assume that one tool could declare the policy correct. It began with a business requirement, analyzed what could happen, inspected what did happen, narrowed the policy, and can observe again.

Even a perfect reduction today is not enough forever. Someone may attach a broader policy next month. Guardrails provide defense in depth by continuing to deny selected catastrophic actions even when the role's detailed grant becomes wrong.

A practical evidence hierarchy is therefore:

```text
Business and system requirement → Why should access exist?
Policy and reachability analysis → Can access exist?
CloudTrail                    → Did access occur?
Last Accessed / unused access → How recently does it appear needed?
Decision                      → Retain, narrow, or remove
```

No AWS tool can answer "Is this permission correct?" alone. Correctness is a judgment built from intended architecture, current authorization, observed activity, and accountable ownership.

## How Does the Review Loop Combine Guardrails and Evidence?
<!-- section-summary: A continuous loop maps authority, defines invariants, applies guardrails, measures access, narrows grants, and repeats as systems change. -->

An AWS environment changes continuously, so a one-time audit cannot create permanent least privilege. A mature review process repeats:

```text
1. Map accounts and trust edges.
2. Define the invariants that must remain true.
3. Apply guardrails around those invariants.
4. Measure covered activity.
5. Find reachable, external, and apparently unused access.
6. Reduce unsupported grants and credentials.
7. Repeat as identities, workloads, vendors, and policies change.
```

The desired direction is:

```text
actual granted permissions ≈ legitimate required permissions
```

Guardrails form an outer ceiling. Inside that ceiling sit the permissions that policy configuration makes possible. Inside that set is the smaller collection observed in use. The gaps deserve investigation: some are excessive grants; others are legitimate but rare emergency capabilities.

Guardrails should express invariants. Instead of asking which hundreds of API operations developers need, ask what must remain true regardless of a local administrator's next policy edit. Examples include protected audit logging, organization membership, approved Regions, restricted long-lived IAM users, protected security roles, and non-routine member-account root use.

Evidence tests hypotheses. A deployment team may initially believe that `DeploymentRole` needs broad EC2, S3, DynamoDB, and Lambda access. CloudTrail shows Lambda and S3 requests. Last-accessed and unused-access analysis show no EC2 or DynamoDB activity. The architecture confirms that the system uses only Lambda and S3. The team can replace the original hypothesis with a narrower one, deploy a constrained Lambda-and-S3 policy, and observe again.

That approach does not pretend that perfect permissions can always be derived on the first day. It makes least privilege an evidence-guided process with feedback.

The whole system can be assembled in layers:

1. **Account architecture:** management, security, logging, production, and development accounts each have a clear purpose.
2. **Human authentication:** people enter through an identity provider and IAM Identity Center, then use temporary role credentials rather than ordinary IAM-user keys.
3. **Workload authentication:** EC2, Lambda, ECS, and other workloads use IAM roles and temporary credentials instead of embedded access keys.
4. **Organization guardrails:** production SCPs prevent long-lived identity creation, audit tampering, organization departure, unapproved-Region activity, and dangerous security modifications.
5. **Explicit cross-account trust:** workforce roles enter selected production roles; vendor access uses a separate trust path and an `ExternalId` where appropriate.
6. **Resource controls:** S3, KMS, Secrets Manager, queues, and other sensitive resources receive deliberately scoped resource policies and controls.
7. **Access evidence:** CloudTrail shows requests; Access Analyzer shows external, internal, and unused paths; last-accessed data provides usage clues; credential reports inventory static authentication state.
8. **Review:** owners combine those sources, then retain, narrow, or remove access and repeat the process.

Imagine unused-access analysis reports that `ProdReportingRole` has unused EC2 permissions. The reviewer confirms the finding with CloudTrail coverage, the application owner, and a policy review, then removes EC2 access. If someone later attaches a broad policy by mistake, the production SCP still blocks the catastrophic operations chosen as invariants. That is defense in depth: the detailed grant and outer boundary protect against different failures.

![The operating loop connects guardrails to CloudTrail, Access Analyzer, credential reports, remediation, and regular review](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/guardrails-evidence-operating-loop.png)

*The review loop feeds evidence back into permission design while organization guardrails preserve the outer safety boundary.*

The compact mental model is:

```text
ACCOUNT MAP
Where can authority travel?
        ↓
GRANTS
Identity and resource policies
        ↓
GUARDRAILS
SCPs, RCPs, boundaries, and session restrictions
        ↓
AUTHORIZATION → allow or deny
        ↓
ACTIVITY AND EVIDENCE
CloudTrail      → what happened
Access Analyzer → what can happen
Last Accessed   → what appears used
Cred reports    → which static credentials exist
        ↓
Refine grants and guardrails
```

Behind that diagram are four final questions:

1. **Should** this person or workload have access, according to architecture and business intent?
2. **Can** it have access under IAM, resource policies, and the trust graph?
3. Can organization guardrails stop dangerous access even when someone makes a grant mistake?
4. **Did** the principal actually attempt or use the access according to evidence with adequate coverage?

Permissions create authority. Trust moves authority across boundaries. Guardrails bound the maximum authority. Evidence lets the organization compare what it granted with what its systems actually need, then repeat that comparison as the environment changes.

## Check Your Answers
<!-- section-summary: Review the core distinctions between authorization limits, access paths, activity records, usage summaries, and legitimate need. -->

:::expand[How Are Guardrails Different From Access Evidence?]{kind="recap"}
Guardrails affect authorization, while access evidence describes configured, reachable, attempted, or used access.

Guardrails participate in limiting authorization: they reduce what a principal or resource may ultimately accept. Access evidence describes configuration, reachability, activity, usage, or credential state. Evidence informs a decision but normally does not change whether the next AWS request is authorized.
:::

:::expand[How Does the Account Map Show Where Authority Can Travel?]{kind="recap"}
A useful account map combines the Organizations hierarchy with trust and resource-policy edges that move authority between security domains.

The tree shows accounts, OUs, and inherited organization policies. Authority also moves through role trusts, role chaining, `iam:PassRole`, and resource-based policies. Those extra edges can create transitive paths to resources that are invisible when each account or policy is read alone.

SCPs limit the authority available to principals in member accounts, while RCPs limit the authority that supported resources can accept.

An SCP defines the maximum actions available to governed principals in member accounts. A principal still needs an applicable IAM or resource-policy `Allow`. An SCP that permits everything gives a principal with no grants no effective permission, while an SCP deny can remove a capability even from a broad administrator policy.

An SCP limits the maximum authority available to principals in governed accounts. An RCP limits how much authority supported resources in governed accounts may accept. They address the principal and resource sides of authorization respectively and have their own scope and service rules.
:::

:::expand[Which Capabilities Belong in Guardrails?]{kind="recap"}
Strong guardrails express company invariants around catastrophic failure modes rather than trying to duplicate every role's detailed permission policy.

It represents a company invariant or catastrophic failure mode that should remain impossible despite ordinary account-level permission mistakes. Examples include audit tampering, organization departure, unapproved-Region activity, routine root use, creation of long-lived identities, and sensitive privilege-escalation operations.
:::

:::expand[How Does Cross-Account Access Work?]{kind="recap"}
Cross-account access requires authorization in separate security domains and can use either temporary role sessions or supported resource-based policies.

First, the source principal must be allowed to call `sts:AssumeRole` and the target role's trust policy must accept the caller. Second, after STS creates the session, the assumed role's permissions and applicable SCPs, boundaries, session restrictions, and resource controls determine what that session may do.
:::

:::expand[What Does CloudTrail Prove?]{kind="recap"}
CloudTrail is activity evidence for observed AWS requests, but its ability to prove absence depends on event coverage, retention, Region, and search scope.

The event may be outside retention, the relevant event class may not have been collected, or the reviewer may be searching the wrong Region, account, trail, or event store. Proving absence requires adequate observation coverage, not merely an empty search result.
:::

:::expand[What Do Access Analyzer and Last-Accessed Data Prove?]{kind="recap"}
Access Analyzer finds possible policy paths, while last-accessed and unused-access data create review hypotheses about permissions and credentials that may no longer be needed.

Access Analyzer reasons about possible access paths created by policies. CloudTrail records covered AWS activity. An external path can exist without being used, so an Analyzer finding and an empty activity search can both be correct.

Rare but legitimate capabilities—such as disaster recovery, break-glass access, annual financial work, or incident response—may remain unused for a long time. Last-accessed and unused-access evidence must be combined with coverage, ownership, architecture, and business intent.

Static credentials describe how an identity authenticates, and credential reports inventory IAM-user password, MFA, and access-key state for review.

It inventories IAM-user and root credential state, including passwords, MFA, access-key status, rotation, and last-use fields. It describes how an identity can authenticate; policies describe authorization, CloudTrail describes activity, and Access Analyzer describes reachable paths.
:::

:::expand[How Do Can, Did, and Should Guide an Access Review?]{kind="recap"}
A sound access decision combines configuration, reachability, activity, usage summaries, and the organization's own statement of legitimate need.

`Can` comes from policy and reachability analysis. `Did` comes from activity evidence with sufficient collection and retention. `Should` comes from the organization's business and system requirements. Comparing all three supports a decision to retain, narrow, or remove access.
:::

:::expand[How Does the Review Loop Combine Guardrails and Evidence?]{kind="recap"}
A continuous loop maps authority, defines invariants, applies guardrails, measures access, narrows grants, and repeats as systems change.

Workloads, teams, vendors, and AWS policies change. A good loop remaps access, rechecks invariants, measures activity and reachability, narrows unsupported grants, and observes again. Guardrails preserve an outer safety boundary when detailed permissions later drift.
:::

## References

- [Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html) - Explains how AWS combines identity policies, resource policies, boundaries, SCPs, and RCPs, including explicit-deny behavior.
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) - Defines SCPs as maximum-permission guardrails and documents their scope and important exceptions.
- [SCP evaluation](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html) - Explains how SCPs attached along the Organizations hierarchy affect effective permissions.
- [Deny access based on the requested Region](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_examples_aws_deny-requested-region.html) - Shows Region-restriction policy considerations, including global services.
- [Best practices for member accounts](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices_member-acct.html) - Covers member-account security and root-access practices in an organization.
- [Cross-account policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html) - Describes authorization across the trusted and trusting accounts.
- [Understanding CloudTrail events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-events.html) - Defines CloudTrail events and the types of AWS activity they record.
- [Working with CloudTrail Event history](https://docs.aws.amazon.com/en_en/awscloudtrail/latest/userguide/view-cloudtrail-events.html) - Documents the 90-day, per-Region management-event history and its coverage limits.
- [How IAM Access Analyzer findings work](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-concepts.html) - Explains policy-based findings and why possible access is different from observed activity.
- [IAM Access Analyzer](https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html) - Covers external, internal, and unused-access analysis and zones of trust.
- [Refine permissions using last-accessed information](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_last-accessed.html) - Describes tracking periods, attempted access, and the role of last-accessed data in least-privilege reviews.
- [UnusedAccessConfiguration](https://docs.aws.amazon.com/access-analyzer/latest/APIReference/API_UnusedAccessConfiguration.html) - Documents the configurable unused-access tracking threshold.
- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) - Recommends federation and temporary credentials for humans and workloads where possible.
- [Generate credential reports](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_getting-report.html) - Describes IAM credential-report fields for passwords, MFA, and access keys.
