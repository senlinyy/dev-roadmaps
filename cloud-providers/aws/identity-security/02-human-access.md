---
title: "Access for People and Applications"
description: "Use IAM Identity Center, roles, STS sessions, runtime identities, federation, MFA, and audit evidence so people and workloads can access AWS without permanent keys."
overview: "People, applications, CI jobs, and external servers begin with different identities, but AWS access converges on one model: a trusted caller obtains a temporary role session, makes signed requests, and leaves evidence."
tags: ["iam", "identity-center", "roles", "credentials"]
order: 2
id: article-cloud-providers-aws-identity-security-human-access
aliases:
  - human-access
  - access-for-people-and-applications
  - iam-identity-center
  - aws-sso
  - aws-iam-human-access
  - identity-center-human-access
  - workload-roles
  - workload-access-and-temporary-credentials
  - temporary-credentials-and-role-assumption
  - article-cloud-providers-aws-identity-security-workload-roles
  - cloud-providers/aws/identity-security/human-access.md
  - cloud-providers/aws/identity-security/02-human-access.md
  - cloud-providers/aws/identity-security/workload-roles.md
  - cloud-providers/aws/identity-security/03-workload-roles.md
  - cloud-providers/aws/identity-security/workload-access-and-temporary-credentials.md
  - cloud-providers/aws/identity-security/temporary-credentials-and-role-assumption.md
---

## Table of Contents

1. [How Does a Caller Receive AWS Access?](#how-does-a-caller-receive-aws-access)
2. [Why Is the IAM Role the Central Access Identity?](#why-is-the-iam-role-the-central-access-identity)
3. [How Do Permission Sets and Account Assignments Work?](#how-do-permission-sets-and-account-assignments-work)
4. [How Does CLI Access Work Without Permanent Keys?](#how-does-cli-access-work-without-permanent-keys)
5. [How Do Applications Receive Runtime Credentials?](#how-do-applications-receive-runtime-credentials)
6. [How Do CI Jobs and External Workloads Federate?](#how-do-ci-jobs-and-external-workloads-federate)
7. [How Do You Identify the Real Caller During an Incident?](#how-do-you-identify-the-real-caller-during-an-incident)
8. [How Does the Complete Access Chain Fit Together?](#how-does-the-complete-access-chain-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

## How Does a Caller Receive AWS Access?
<!-- section-summary: A long-lived identity authenticates, obtains a short-lived AWS session, signs a request, and then faces authorization policy evaluation. -->

The cleanest way to understand access for people and applications is to start with one question: **when something asks AWS to perform an action, how does AWS decide whether to allow it?**

Every request can be reduced to:

```text
WHO is making the request?
        ↓
WHAT action are they requesting?
        ↓
ON WHICH resource?
        ↓
UNDER WHAT conditions?
        ↓
ALLOW or DENY
```

AWS calls the authenticated “who” a **principal**. A principal may represent a human, an application, an AWS service, a federated identity, or—very commonly—a role session. AWS recommends temporary credentials rather than long-lived access keys for both people and workloads in normal modern access paths.

The fundamental flow is:

```text
identity
   ↓ authentication
session
   ↓ receives temporary credentials
signed AWS request
   ↓ authorization
IAM policy evaluation
   ↓
allow or deny
```

Four words in that flow are frequently mixed together.

An **identity** answers “Who are you?” Alice in the corporate directory, a GitHub Actions workflow, an EC2 instance, and a Kubernetes workload are all possible starting identities.

A **credential** proves identity or, in many AWS flows, proves possession of an already-created session. Temporary API credentials include an `AccessKeyId`, a `SecretAccessKey`, and a `SessionToken`. AWS STS issues many of these temporary credentials, and they expire automatically.

A **permission** answers “What may this identity or session do?” A permission might allow `s3:GetObject` on objects under `arn:aws:s3:::company-reports/*`.

A **session** is the temporary security identity that actually makes the AWS calls. Alice can remain a long-lived identity in Microsoft Entra ID without becoming a permanent IAM user. She authenticates through the corporate system, federates into AWS, assumes a role, and receives a temporary role session. An application can use the same pattern without an IAM user named after the service.

```text
long-lived identity
        ↓
prove identity
        ↓
short-lived AWS session
        ↓
perform work
```

The sections below answer these questions in order:

1. **How Does a Caller Receive AWS Access?**
2. **Why Is the IAM Role the Central Access Identity?**
3. **How Do Permission Sets and Account Assignments Work?**
4. **How Does CLI Access Work Without Permanent Keys?**
5. **How Do Applications Receive Runtime Credentials?**
6. **How Do CI Jobs and External Workloads Federate?**
7. **How Do You Identify the Real Caller During an Incident?**
8. **How Does the Complete Access Chain Fit Together?**

## Why Is the IAM Role the Central Access Identity?
<!-- section-summary: A role is a reusable set of AWS permissions that a trusted person, workload, service, account, or federated identity can temporarily become. -->

An **IAM role** is a reusable AWS identity that carries permissions but normally has no permanent password or access key. When an authorized caller assumes it, AWS creates a role session and gives that session temporary credentials.

Every role must answer two separate questions:

```text
WHO may become this role?
```

and:

```text
WHAT may the resulting role session do?
```

The role's **trust policy** controls who may assume it. Its permission policies control the actions available after assumption.

```text
                     IAM role
              ┌──────────────────┐
identity ────►│ trust policy     │
              │ may assume?      │
              ├──────────────────┤
              │ permissions      │────► S3, EC2, DynamoDB, ...
              │ may do what?     │
              └──────────────────┘
```

The same structure supports several callers:

```text
GitHub Actions
      ↓ trusted through OIDC
DeploymentRole
      ↓ permission
ecs:UpdateService
```

```text
EC2 service
      ↓ trusted
ApplicationRole
      ↓ permission
s3:GetObject
```

```text
Alice
      ↓ through Identity Center
DatabaseAdminRole
      ↓ permission
RDS actions
```

The authentication mechanisms differ, but all three callers obtain a role session.

Trust deserves the same scrutiny as permission. A deployment role may have reasonable permissions to update ECS, read one artifact, and operate a CloudFormation stack. If its trust relationship lets every GitHub repository assume it, the dangerous question becomes “Who may become DeploymentRole?” A narrowly permissioned role with an overly broad trust policy can still be dangerous. A tightly trusted role with excessive permissions is also dangerous.

The risk is two-dimensional:

```text
assumption boundary × permission boundary
```

Secure role design narrows both.

### How Do People Receive Temporary AWS Sessions?
<!-- section-summary: Workforce users authenticate through a corporate identity source and IAM Identity Center rather than receiving a permanent IAM user in every AWS account. -->

For employees, the first identity system usually lives outside IAM. It might be Microsoft Entra ID, Okta, Google Workspace, Active Directory, or IAM Identity Center's own directory.

AWS IAM Identity Center connects that workforce identity source to AWS accounts:

```text
Alice
  ↓
corporate identity provider
  ↓ authentication + MFA
IAM Identity Center
  ↓ assigned AWS account access
IAM role in target account
  ↓
temporary AWS session
```

This separates two responsibilities:

```text
workforce identity system
Is this really Alice?

AWS access system
What may Alice do in this AWS account?
```

The corporate directory can remain the source of truth for employment, password or passkey policy, MFA, groups, onboarding, and termination. AWS handles AWS-specific account and permission decisions.

When Alice opens AWS, the conceptual sequence is:

```text
Alice signs in to the corporate identity provider
        ↓
MFA succeeds
        ↓
Identity Center recognizes Alice
        ↓
Identity Center finds her account assignments
        ↓
Alice selects Production / ReadOnly
        ↓
AWS creates a role session
        ↓
temporary credentials represent that session
        ↓
Alice operates as the role
```

AWS does not need to create an IAM user named Alice, a permanent AWS password, or a long-lived access key for this path. Alice's permanent workforce identity remains different from the temporary AWS session she uses for one account and access level.

![The account assignment view shows how a person receives access through a workforce group, permission set, AWS account, and temporary role session](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/identity-center-account-assignments.png)

*The human identity remains in the workforce system while the AWS session is temporary and account-specific.*

## How Do Permission Sets and Account Assignments Work?
<!-- section-summary: A permission set defines an access template, while an account assignment maps a user or group to that template in one AWS account. -->

IAM Identity Center introduces a **permission set**, which is easiest to understand as a role blueprint. A `Developer` permission set might include EC2 development access, CloudWatch reads, S3 access to development buckets, and no IAM administration.

The permission set is managed centrally in Identity Center. When it is assigned to an AWS account, Identity Center provisions and manages a corresponding IAM role in that account.

```text
permission set
      │
      │ provisions
      ▼
AWS account
┌────────────────────────────────┐
│ IAM role managed by            │
│ IAM Identity Center            │
└────────────────────────────────┘
```

The permission set describes access. The role in the destination account implements that access.

A permission set alone gives nobody access. An **account assignment** connects three values:

```text
(user or group, AWS account, permission set)
```

For example:

```text
Developers group
    + Development account
    + Developer permission set
```

can grant development access, while a different assignment gives the same group `ReadOnly` in production.

Alice can therefore hold different access by account:

```text
Development → Developer
Staging     → Developer
Production  → ReadOnly
Security    → no assignment
```

The access portal shows only the accounts and permission sets assigned to her. In a larger organization, assignments normally target groups instead of individual people. Alice joins `PlatformEngineers`, and that group carries `Production / ReadOnly` and `Development / PowerUser` assignments. Onboarding can become a group-membership change instead of a repeated set of IAM user operations.

The separation between identity and privilege is intentional. The workforce directory says who Alice is and which groups she belongs to. The account assignment says which AWS account and role blueprint those groups may use.

## How Does CLI Access Work Without Permanent Keys?
<!-- section-summary: The AWS CLI can authenticate through Identity Center, cache a temporary session, and reveal the current assumed-role identity before work begins. -->

Older CLI setup commonly used `aws configure` and stored permanent credentials in `~/.aws/credentials`:

```text
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

The values can be copied, committed to a repository, left on an old laptop, or forgotten. Identity Center lets the CLI retrieve temporary credentials instead.

An engineer can configure an Identity Center profile and sign in:

```bash
aws configure sso --profile development
aws sso login --profile development
```

The login starts an authentication flow through Identity Center. After authentication, the CLI obtains temporary credentials for the account and role represented by the profile. Normal commands then use that session:

```bash
aws s3 ls --profile development
```

Console access and CLI access are different clients using the same security path:

```text
browser console                     AWS CLI
      │                                │
      └────── authentication ──────────┘
                      ↓
              IAM Identity Center
                      ↓
                  IAM role
                      ↓
                 role session
                      ↓
                AWS API request
```

Before doing significant work, ask “Who am I right now?” The command is:

```bash
aws sts get-caller-identity
```

For a role session, the ARN may look like:

```text
arn:aws:sts::123456789012:assumed-role/Developer/alice-session
```

This output distinguishes the durable IAM role from the temporary session:

```text
role
arn:aws:iam::123456789012:role/Developer

session
arn:aws:sts::123456789012:assumed-role/Developer/alice-session
```

The role is persistent configuration. The session is ephemeral. Alice is currently operating as one session of the Developer role, and the account ID in that identity should match the account she intends to change.

![The comparison shows why a temporary Identity Center session is safer than a copied access key for daily console and CLI work](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/static-key-vs-temporary-sessions.png)

*A profile identifies the desired account and role; the resulting session expires instead of becoming a permanent laptop secret.*

## How Do Applications Receive Runtime Credentials?
<!-- section-summary: AWS compute environments prove workload identity, expose temporary role credentials, and let SDKs discover and refresh those credentials automatically. -->

Replace Alice with an application on EC2 that must read `s3://company-config/`. Creating an IAM user, generating an access key, and putting it in an environment variable recreates the long-lived-secret problem. The team must rotate the key, distribute it to every instance, update new Auto Scaling instances, and find every copy after a leak.

The AWS-native model gives the execution environment a role:

```text
application
    ↓ runs on
EC2 instance
    ↓ associated with
IAM role
    ↓
temporary credentials
    ↓
S3
```

The role might allow only `s3:GetObject` under `company-config/*`.

The application still signs AWS requests with credentials. The difference is that AWS manages their lifecycle:

```text
AWS creates temporary credentials
        ↓
AWS exposes them to the runtime
        ↓
AWS SDK discovers them
        ↓
application signs requests
        ↓
credentials expire
        ↓
new temporary credentials become available
```

For EC2, the runtime exposes role credentials through instance metadata, and AWS SDKs know how to retrieve and refresh them. Other compute platforms implement the same principle in platform-specific ways:

```text
EC2            → instance role
ECS            → task role
Lambda         → execution role
Kubernetes/EKS → workload or pod identity mechanism
```

The application code can use the SDK's normal credential discovery:

```python
s3 = boto3.client("s3")
```

It should not need to embed a key:

```python
s3 = boto3.client(
    "s3",
    aws_access_key_id="...",
    aws_secret_access_key="..."
)
```

The application asks, “Which AWS role am I running as?” rather than, “Where did somebody hide the AWS password?”

The human and application paths now converge:

```text
HUMAN
Alice → corporate IdP → Identity Center → IAM role
      → role session → temporary credentials → AWS API

APPLICATION
EC2 / ECS / Lambda runtime → IAM role
      → role session → temporary credentials → AWS API
```

The left side differs, while the right side is almost identical. AWS access architecture is largely the process of deciding who may obtain which role session.

![The runtime path shows how EC2, ECS, Lambda, and EKS workloads obtain short-lived credentials from assigned roles](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/runtime-role-credential-delivery.png)

*The runtime owns credential delivery and refresh, while the role defines the workload's AWS permissions.*

## How Do CI Jobs and External Workloads Federate?
<!-- section-summary: OIDC and certificate-based federation let external jobs prove identity and exchange that proof for temporary AWS role credentials. -->

CI/CD systems such as GitHub Actions and GitLab CI often run outside the AWS compute environment. A historical design stores `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as CI secrets. Those permanent keys work until somebody rotates or deletes them.

When the platform supports it, federation gives the job temporary access. With OpenID Connect, or **OIDC**, the flow is:

```text
CI job
   ↓ receives
signed OIDC token
   ↓
AWS validates the trusted OIDC provider
   ↓
STS AssumeRoleWithWebIdentity
   ↓
deployment role session
   ↓
temporary credentials
   ↓
deployment
```

The token can carry claims that identify the repository, environment, workflow, or subject. The role trust policy can require that the token comes from the trusted issuer and represents the intended deployment workflow.

```text
trust this OIDC issuer
AND only accept a token for this deployment identity
```

This is stronger than trusting anything that possesses one permanent AWS key. Federation moves much of the security boundary into the trust decision, so the issuer and token claims should be as specific as practical.

External servers can also avoid static AWS keys. An on-premises system, another-cloud virtual machine, or specialized build agent may use **IAM Roles Anywhere**:

```text
external server
      ↓ proves possession of
X.509 certificate
      ↓
IAM Roles Anywhere
      ↓
IAM role
      ↓
temporary AWS credentials
```

The certificate provides the external workload's identity proof, and the resulting role session uses temporary AWS credentials. Running outside AWS does not automatically require an IAM user with a permanent access key.

### How Do MFA, Emergency Access, and Root Differ?
<!-- section-summary: MFA strengthens the normal identity proof, emergency access provides an independent recovery path, and root remains reserved for root-specific account ownership tasks. -->

**Multi-factor authentication**, or **MFA**, answers “How confident are we that this is really Alice?” It does not answer “What may Alice do?” The policy and role still define authorization.

For workforce federation, MFA is often enforced by the corporate identity provider or Identity Center:

```text
password, passkey, or MFA
          ↓
authentication succeeds
          ↓
Identity Center
          ↓
permission assignment
          ↓
IAM role session
```

AWS recommends MFA and favors phishing-resistant factors such as passkeys or security keys where practical.

MFA on one path does not protect another path that bypasses it. If Alice uses MFA for console sign-in but also owns a permanent administrator access key, stealing that key may bypass the human login flow. Reducing permanent credentials remains part of the MFA design.

**Emergency access**, sometimes called break-glass access, exists for the case where the normal corporate identity provider or Identity Center path is unavailable. AWS recognizes emergency access as a narrow situation in which an IAM user may be appropriate, and it also documents a separate emergency federation architecture.

The principle is:

```text
primary authentication path fails
            ↓
independent, strongly protected path exists
            ↓
temporary emergency administrative access
```

Emergency access should be rare, monitored, strongly authenticated, protected from casual use, and tested before an incident. It is not a second daily administrator path.

The AWS account's **root user** is separate again. Root represents ultimate account ownership and can perform some operations that ordinary IAM principals cannot. It should use MFA, should have no root access keys, and should not participate in ordinary operational work. Organizations can centrally secure or remove root credentials for member accounts.

The three paths are:

```text
normal administrator
federated identity → administrator role

emergency administrator
independent, protected emergency access path

root
account-owner mechanism for root-specific situations
```

## How Do You Identify the Real Caller During an Incident?
<!-- section-summary: Investigations should identify the exact temporary role session, how it was created, and which policies applied rather than stopping at a shared role name. -->

Authentication creates a role session, but authorization still happens on each request. AWS constructs context that can include the principal, action, resource, Region, source attributes, session data, tags, and network-related facts. It then evaluates applicable policies.

The simplified rule remains:

```text
default = deny
applicable Allow is required
applicable explicit Deny wins
```

Identity policies, resource policies, session policies, permissions boundaries, Organizations service control policies, resource control policies, and other relevant controls may all affect the result. Attaching `AdministratorAccess` does not prove that the request will succeed if another guardrail or explicit deny blocks it.

During an incident, identify the **session**, not only the role. A role such as `ProductionAdmin` may be assumed legitimately by twenty engineers and several automations:

```text
durable role: ProductionAdmin
      ├── session 1: Alice
      ├── session 2: Bob
      ├── session 3: automation
      └── session 4: attacker?
```

CloudTrail's `userIdentity` information can contain the assumed role, session issuer, role-session name, temporary access-key identifier, session creation time, and source identity when it is configured. An event may identify:

```text
arn:aws:sts::123456789012:assumed-role/ProductionAdmin/alice
```

This is stronger evidence than the sentence “ProductionAdmin deleted the resource.”

### Source identity preserves origin

AWS STS supports **source identity**, which attaches an original identity value to an assumed-role session. Consider a role chain:

```text
Alice
  ↓ assumes Developer
  ↓ sourceIdentity = alice@example
Developer session
  ↓ assumes ProductionReadOnly
ProductionReadOnly session
```

Without session attribution, the downstream evidence may only say that `ProductionReadOnly` performed an action. With source identity, investigators can trace the session toward Alice. CloudTrail also records the STS role-assumption event separately from the later API calls made with the temporary credentials, allowing an investigation to reconstruct how the session was obtained.

The operational question becomes: **which session performed the request, which identity created that session, and which trust and permission decisions allowed it?**

## How Does the Complete Access Chain Fit Together?
<!-- section-summary: Human and application access share the same identity, authentication, trust, role, session, temporary credential, authorization, resource, and audit sequence. -->

The human path is:

```text
Alice
  │ authenticates + MFA
  ▼
corporate identity provider
  ▼
IAM Identity Center
  │ account assignment
  │ (user or group, account, permission set)
  ▼
IAM role
  │ assume
  ▼
role session
  │ temporary credentials
  ▼
AWS API
  │ policy evaluation
  ▼
resource

CloudTrail records evidence through the path
```

The application path is:

```text
application or CI job
       │ proves workload identity
       ├── EC2 / ECS / Lambda runtime
       ├── OIDC token
       └── X.509 certificate
       ▼
IAM role trust decision
       ▼
role session
       │ temporary credentials
       ▼
AWS API
       │ policy evaluation
       ▼
resource

CloudTrail records evidence through the path
```

Most of the paths are identical after the caller proves identity. The reusable chain is:

```text
identity
   ↓
authentication
   ↓
trust decision
   ↓
role
   ↓
session
   ↓
temporary credentials
   ↓
signed request
   ↓
authorization
   ↓
resource
   ↓
audit evidence
```

For a human, the identity is the workforce user, authentication comes from the identity provider and MFA, the access decision comes from Identity Center assignments, and the account role is created from a permission set.

For an AWS application, the identity begins with the workload runtime, the AWS compute environment proves it, and the role trust relationship selects the workload role.

For CI/CD, the pipeline job is the identity, OIDC provides the proof, token issuer and claim conditions define trust, and STS creates the deployment-role session.

![The summary separates human access, AWS workload access, external federation, emergency access, and audit evidence into clear paths](/content-assets/articles/article-cloud-providers-aws-identity-security-human-access/access-path-summary.png)

*Different callers prove identity differently, then converge on temporary role sessions and normal authorization.*

The design rules are:

1. Humans should normally federate instead of receiving an IAM user in every account.
2. Applications should normally use roles instead of embedded access keys.
3. Permission sets are reusable access templates, and account assignments connect users or groups to them in particular accounts.
4. Role trust deserves the same scrutiny as role permissions.
5. Temporary credentials should be the normal choice for console, CLI, applications, CI/CD, and external workloads.
6. MFA strengthens authentication, least privilege and guardrails restrict authorization, and emergency access uses an independent protected path.
7. Incident investigations should identify the actual role session and its origin rather than stopping at the shared role name.

Identity Center, STS, IAM roles, OIDC, runtime credential delivery, MFA, Roles Anywhere, and CloudTrail are pieces of one system. Together they answer: **who may obtain a temporary security session, what may that session do, and can the organization later prove who used it?**

## Check Your Answers

:::expand[How Does a Caller Receive AWS Access?]{kind="recap"}
A long-lived identity authenticates, obtains a short-lived AWS session, signs a request, and then faces authorization policy evaluation.

A long-lived person or workload identity authenticates, obtains a short-lived AWS session, uses temporary credentials to sign a request, and then faces IAM authorization for the requested action and resource.
:::

:::expand[Why Is the IAM Role the Central Access Identity?]{kind="recap"}
A role is a reusable set of AWS permissions that a trusted person, workload, service, account, or federated identity can temporarily become.

A role is a reusable permission identity with no permanent credentials. Its trust policy controls who may assume it, and its permission policies control what the temporary session may do.

Workforce users authenticate through a corporate identity source and IAM Identity Center rather than receiving a permanent IAM user in every AWS account.

People authenticate through a workforce identity source and IAM Identity Center, choose an assigned account and access level, and receive a temporary role session instead of a permanent IAM user in every account.
:::

:::expand[How Do Permission Sets and Account Assignments Work?]{kind="recap"}
A permission set defines an access template, while an account assignment maps a user or group to that template in one AWS account.

A permission set is a centrally managed role blueprint. An account assignment maps a user or group, AWS account, and permission set, causing Identity Center to provision and expose the corresponding account role.
:::

:::expand[How Does CLI Access Work Without Permanent Keys?]{kind="recap"}
The AWS CLI can authenticate through Identity Center, cache a temporary session, and reveal the current assumed-role identity before work begins.

The CLI authenticates through an Identity Center profile and caches temporary credentials. `aws sts get-caller-identity` confirms the account and assumed-role session currently making requests.
:::

:::expand[How Do Applications Receive Runtime Credentials?]{kind="recap"}
AWS compute environments prove workload identity, expose temporary role credentials, and let SDKs discover and refresh those credentials automatically.

EC2, ECS, Lambda, and EKS runtimes connect workloads to IAM roles and expose temporary credentials through platform-specific mechanisms that AWS SDKs can discover and refresh.
:::

:::expand[How Do CI Jobs and External Workloads Federate?]{kind="recap"}
OIDC and certificate-based federation let external jobs prove identity and exchange that proof for temporary AWS role credentials.

CI jobs can exchange an OIDC token for a trusted role session, while external servers can use certificate-based IAM Roles Anywhere. Both approaches avoid permanent AWS access keys.

MFA strengthens the normal identity proof, emergency access provides an independent recovery path, and root remains reserved for root-specific account ownership tasks.

MFA strengthens normal identity proof, emergency access provides a separate and tested path when normal federation fails, and root remains protected for account-owner operations that specifically require it.
:::

:::expand[How Do You Identify the Real Caller During an Incident?]{kind="recap"}
Investigations should identify the exact temporary role session, how it was created, and which policies applied rather than stopping at a shared role name.

Inspect the assumed-role session, session issuer, role-session name, source identity, and the earlier STS assumption event. A shared role name alone does not identify the human, workload, or automation behind one request.
:::

:::expand[How Does the Complete Access Chain Fit Together?]{kind="recap"}
Human and application access share the same identity, authentication, trust, role, session, temporary credential, authorization, resource, and audit sequence.

Identity leads to authentication, a trust decision, a role, a temporary session, signed AWS requests, authorization, resource access, and audit evidence. Human and workload access differ mainly in how identity is proved.
:::

## References

- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html)
- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [Manage AWS accounts with permission sets](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html)
- [Configure access to AWS accounts](https://docs.aws.amazon.com/singlesignon/latest/userguide/manage-your-accounts.html)
- [Configure IAM Identity Center authentication for the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
- [AWS STS get-caller-identity](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html)
- [IAM roles for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html)
- [AWS JSON policy element: Principal](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html)
- [What is IAM Roles Anywhere?](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/introduction.html)
- [Create an IAM user for emergency access](https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started-emergency-iam-user.html)
- [Set up emergency access for IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/emergency-access.html)
- [Root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)
- [IAM policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)
- [CloudTrail userIdentity element](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html)
- [Monitor actions taken with assumed roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_control-access_monitor.html)
- [Log IAM and STS API calls with CloudTrail](https://docs.aws.amazon.com/IAM/latest/UserGuide/cloudtrail-integration.html)
