---
title: "Cloud Identity and Access Management"
description: "Design least-privilege cloud roles, federated CI/CD access, access reviews, and audited emergency access."
overview: "Cloud IAM controls who and what can change cloud resources, how long that access lasts, and what evidence proves the access was approved, scoped, and reviewed."
tags: ["devsecops", "iam", "cloud", "break-glass"]
order: 4
id: article-devsecops-cloud-infrastructure-security-cloud-identity-and-access
aliases:
  - iam-review
  - break-glass-access
  - article-devsecops-cloud-infrastructure-security-iam-review
  - article-devsecops-cloud-infrastructure-security-break-glass-access
  - devsecops/cloud-infrastructure-security/iam-review.md
  - devsecops/cloud-infrastructure-security/break-glass-access.md
  - devsecops/cloud-infrastructure-security/04-cloud-identity-and-access.md
  - devsecops/cloud-infrastructure-security/04-cloud-identity-and-access
  - cloud-infrastructure-security/04-cloud-identity-and-access
---

## Table of Contents

1. [Identity Explains Most Cloud Changes](#identity-explains-most-cloud-changes)
2. [The Production Access Map](#the-production-access-map)
3. [Human Federation](#human-federation)
4. [Workload Identity](#workload-identity)
5. [CI/CD OIDC Federation](#cicd-oidc-federation)
6. [Least-Privilege Deployment Roles](#least-privilege-deployment-roles)
7. [Guardrails and Permission Boundaries](#guardrails-and-permission-boundaries)
8. [Temporary Elevation and Break-Glass Access](#temporary-elevation-and-break-glass-access)
9. [Access Reviews and Evidence](#access-reviews-and-evidence)
10. [Putting It All Together](#putting-it-all-together)

## Identity Explains Most Cloud Changes
<!-- section-summary: Drift findings usually lead to identity questions because every cloud API call comes from a human, workload, pipeline, or emergency role. -->

The previous article followed a drift finding: a production database security group changed after deployment, and the live cloud account no longer matched the reviewed code. The first questions were about the resource and the network path. Which port opened? Which source range changed? Was the database reachable from the internet?

The next questions are identity questions. Who opened the rule? Which role allowed it? Was it a human in the console, a deployment pipeline, an application runtime role, or an emergency recovery session? How long did that access last? Did the permission match the job?

**Cloud Identity and Access Management**, usually shortened to **cloud IAM**, is the system that answers who can call cloud APIs, what they can do, which resources they can touch, and which conditions must be true. A **principal** is the caller. It can be a human user, a role session, a service account, a managed identity, a workload identity, or a CI/CD workflow token. An **action** is the API operation, like `s3:GetObject`, `ec2:AuthorizeSecurityGroupIngress`, `Microsoft.Authorization/roleAssignments/write`, or `compute.firewalls.patch`. A **resource** is the target. A **condition** is extra context, like MFA status, source branch, session tag, repository name, device state, region, or environment.

Cloud IAM matters to DevSecOps because delivery systems change production all day. Pull request checks, deployment workflows, application runtimes, incident responders, and emergency accounts all need access. A healthy design gives each caller a narrow access path with the permission it needs, only for the time it needs it, with evidence that explains why the access existed.

This article follows the same Northstar customer portal. The team has a production account, Terraform deployments, runtime containers, on-call engineers, and a break-glass path. We will separate human access from workload access, replace static pipeline keys with OIDC federation, design plan and deploy roles, add guardrails, and create evidence through access reviews.

## The Production Access Map
<!-- section-summary: A production system needs separate access paths for planning, deploying, runtime work, incident investigation, auditing, and emergency recovery. -->

The Northstar portal runs a web API, a background worker, a receipt storage bucket, and a private database. Terraform manages the infrastructure. GitHub Actions creates pull request plans and applies approved changes from a protected production environment. Engineers investigate incidents through workforce sign-in. Security reviewers need read access to policies and logs. A small emergency group can recover production when normal automation fails.

The first design move is **role separation**. One broad role for every task is simple at first, but it gives every caller too much power. A pull request plan should not be able to apply changes. A runtime application should not change IAM. An incident responder usually needs logs and configuration, not write access. Emergency recovery needs stronger permissions, but those sessions should be rare, short, and loud.

Here is a practical access map:

| Role | Who or what assumes it | Duration | Main purpose | Evidence |
|---|---|---:|---|---|
| `northstar-prod-terraform-plan` | Pull request workflow | 30 minutes | Read state and build a speculative plan | PR number, commit SHA, workflow run ID |
| `northstar-prod-terraform-deploy` | Protected deploy workflow | 45 minutes | Apply approved Terraform changes | Approved PR, environment approval, workflow run ID |
| `northstar-prod-api-runtime` | Customer portal API container | Platform-managed session | Read needed secrets, write logs, use receipt storage | Task identity, service name, deployment version |
| `northstar-prod-worker-runtime` | Receipt worker container | Platform-managed session | Write receipt files and read queue messages | Task identity, service name, deployment version |
| `northstar-prod-incident-readonly` | On-call engineer through federation | 2 hours | Read logs, metrics, traces, and resource state | Incident ticket, human identity, MFA |
| `northstar-prod-security-audit` | Security reviewer through federation | 4 hours | Review IAM, CloudTrail, policy findings, and exceptions | Review ticket, reviewer, date |
| `northstar-prod-emergency-recovery` | Approved responder during serious outage | 45 minutes | Restore access or recover service when normal paths fail | Incident ticket, peer approval, audit query |

The important pattern is **one job, one access path, one audit trail**. The deployment job receives deployment access. The runtime receives runtime access. The incident responder receives read-only investigation access. If someone needs stronger access, the request should name the incident, the person, the expected action, and the expiry.

![Production access map showing separate plan, deploy, runtime, read-only incident, security audit, and emergency recovery roles with evidence trails](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/production-access-map.png)

*The map separates the major production access paths so plan, deploy, runtime, read-only, and emergency sessions do not blur into one broad role.*

This map gives the rest of the article a concrete path. People need human federation. Applications need workload identity. Pipelines need OIDC. Deployment roles need least privilege. Emergency recovery needs temporary elevation. Access reviews keep the map current after teams and systems change.

## Human Federation
<!-- section-summary: Human federation replaces daily cloud users and static access keys with temporary sessions from the company identity provider. -->

**Human federation** means people sign in through a central identity provider, then receive temporary cloud access based on group membership, role assignment, MFA, device posture, or approval state. The identity provider might be Microsoft Entra ID, Okta, Google Workspace, an internal directory, IAM Identity Center, or another workforce identity system.

This replaces the older pattern where every engineer gets a cloud-local user and long-lived access keys. Long-lived access keys are hard to control because they keep working until someone rotates or deletes them. They can sit in `~/.aws/credentials`, CI secrets, old scripts, shell history, password managers, build logs, and forgotten laptops. When someone leaves the company, the team has to hunt every possible copy.

Federation gives the team a cleaner daily path. An engineer authenticates to the company identity provider, passes MFA, chooses an assigned role, and receives a temporary session. The cloud audit log records the role session and can usually connect it back to the workforce identity. Offboarding starts in the identity provider instead of in every cloud account.

For Northstar, normal human access can stay read-oriented in production:

| Workforce group | Production access | Write access | Use case |
|---|---|---:|---|
| `Engineering` | Dashboards and documentation | No | Understand production behavior without changing it |
| `SRE-OnCall` | `northstar-prod-incident-readonly` | No | Investigate alerts and read logs |
| `Security-Reviewers` | `northstar-prod-security-audit` | No | Review IAM, policy results, and audit logs |
| `Release-Managers` | Approve deployment environment | No direct console write | Approve production workflow runs |
| `Emergency-Responders` | Eligible for emergency role | Yes, after approval | Recover serious incidents |

This design keeps normal production changes inside Git and deployment automation. A release manager approves a workflow, but the workflow performs the change with a deployment role. The release manager does not need a standing administrator role in the cloud console.

For command-line work, federation also changes the local workflow. AWS users may run `aws sso login`. Azure users may run `az login`. Google Cloud users may run `gcloud auth login`. The command is provider-specific, but the principle is the same: authenticate as a person, receive a temporary session, and map that session to a role with a clear purpose.

Human federation handles people. Software needs a separate identity path because applications should never borrow a person's credentials.

## Workload Identity
<!-- section-summary: Workload identity gives applications their own temporary cloud credentials without storing permanent secrets in code or containers. -->

**Workload identity** means an application, function, virtual machine, Kubernetes service account, container task, or batch job receives its own identity. The workload uses that identity to call cloud APIs. The application does not need a permanent cloud key in a config file.

For the Northstar portal, the API runtime needs a narrow role. It might read one database connection secret, write application logs, and read a small set of receipt objects. The background worker might read messages from a queue and write receipt PDFs to a bucket. Neither workload should create IAM users, change security groups, deploy infrastructure, or read every secret in the account.

Cloud platforms provide this in different ways. AWS ECS task roles and Lambda execution roles provide temporary credentials to workloads. Azure managed identities let Azure resources request tokens without storing secrets. Google Cloud service accounts and workload identity patterns give workloads a cloud identity. Kubernetes platforms often map Kubernetes service accounts to cloud identities through workload identity integrations.

Here is a narrow AWS policy for a receipt worker that writes only to the receipt bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListReceiptBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::northstar-payment-receipts-prod",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "receipts/*"
          ]
        }
      }
    },
    {
      "Sid": "WriteAndReadReceiptObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::northstar-payment-receipts-prod/receipts/*"
    }
  ]
}
```

This policy shows two production details. S3 bucket-level actions and object-level actions use different resource shapes. The bucket ARN controls listing. The object ARN with `/*` controls files inside the bucket. The prefix condition keeps listing focused on the worker's own path.

Workload identity also helps incident response. If an audit log shows `northstar-prod-api-runtime` changed a security group, that is a serious finding because the API runtime should not have that permission. The identity name itself tells the responder which system exceeded its intended job.

Now the team has a safe path for people and runtimes. The deployment pipeline needs the same treatment because static deployment keys are one of the easiest ways to lose control of production.

## CI/CD OIDC Federation
<!-- section-summary: OIDC federation lets CI/CD workflows exchange signed run tokens for short-lived cloud credentials instead of storing static deploy keys. -->

**OpenID Connect**, usually shortened to **OIDC**, is a standard for signed identity tokens. In CI/CD, a workflow can request a short-lived OIDC token from the CI/CD platform. The cloud provider verifies that token and exchanges it for temporary cloud credentials if the token matches the role's trust rules.

This removes static deployment keys from the pipeline. A static key in GitHub Actions, GitLab CI, Jenkins, or another system can leak through logs, compromised runners, old backups, or over-broad secret access. An OIDC token is tied to one workflow run and expires quickly. The cloud role can also inspect token claims such as repository, branch, environment, workflow, and audience.

For GitHub Actions deploying to AWS, the trust policy can require the expected repository and protected environment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GitHubProductionDeployOnly",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:northstar/customer-portal:environment:production"
        }
      }
    }
  ]
}
```

The condition is the important part. It accepts GitHub's OIDC issuer only when the token represents the expected repository and production environment. If the production environment has required reviewers, branch protections, and restricted deployment access, the repository controls and the cloud trust policy reinforce each other.

![OIDC trust chain showing a CI workflow token matched against repository, environment, audience, and branch claims before receiving temporary cloud credentials](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/oidc-trust-chain.png)

*The trust chain shows how a workflow token turns into a temporary deployment role only after the cloud provider checks repository, environment, and audience claims.*

A GitHub Actions job then requests an OIDC token and assumes the role:

```yaml
name: production-deploy

on:
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Configure temporary AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/northstar-prod-terraform-deploy
          aws-region: us-east-1
          role-session-name: deploy-${{ github.run_id }}

      - name: Apply reviewed plan
        run: terraform apply -auto-approve tfplan
```

Azure and Google Cloud use the same security pattern with different names. Azure workload identity federation can trust GitHub, GitLab, Terraform Cloud, Kubernetes, or another issuer without storing a client secret. Google Cloud Workload Identity Federation lets external workloads exchange trusted tokens for Google Cloud credentials instead of using service account keys.

OIDC answers how the pipeline gets credentials. The next section narrows what those credentials can do.

## Least-Privilege Deployment Roles
<!-- section-summary: Deployment access should be split by job so plan, deploy, runtime, read-only investigation, and emergency recovery roles do not share the same power. -->

**Least privilege** means each identity receives only the permissions it needs for its job. In cloud deployments, the job matters. A plan role needs read access. A deploy role needs controlled write access. A runtime role needs application access. An incident role needs investigation access. An emergency role needs recovery access with extra monitoring.

Start by separating plan and deploy. The `northstar-prod-terraform-plan` role can read state, describe cloud resources, and generate a speculative plan. It should not modify production. This matters because pull request workflows may run before a human approves the change. Even if someone opens a malicious pull request, the plan role should not have write power.

The `northstar-prod-terraform-deploy` role has stronger permissions, so it should run only from protected branches or protected environments. It should be able to change the resources Terraform owns, but it should not create permanent access keys, attach administrator policies, disable audit logging, or pass arbitrary roles to services.

In AWS, `iam:PassRole` is a permission worth reviewing carefully. It lets a caller pass an IAM role to a service such as ECS, Lambda, or EC2. If a deployment role can pass any role, it may indirectly give a workload powerful access. A safer policy allows only approved runtime roles and only to the expected service:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PassOnlyApprovedRuntimeRolesToEcs",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::111122223333:role/northstar-prod-api-runtime",
        "arn:aws:iam::111122223333:role/northstar-prod-worker-runtime"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ecs-tasks.amazonaws.com"
        }
      }
    }
  ]
}
```

Least privilege often improves in stages. A team may start with broader permissions in a development account to discover what Terraform actually calls. Then it can review audit logs, access analyzer output, failed access attempts, and real deployment history. The production role should become narrower over time, not broader.

The same practice applies to Azure role assignments and Google Cloud IAM roles. Built-in roles are convenient, but they can include more permission than a workload needs. Custom roles can help when a team has a stable, narrow job. The practical test is simple: can the caller do its job, and can it avoid doing the dangerous things outside its job?

Least-privilege roles are one layer. Guardrails add another layer above the role.

## Guardrails and Permission Boundaries
<!-- section-summary: Guardrails set maximum permissions so one over-broad role policy cannot bypass organization rules. -->

A **guardrail** is a control that sets a boundary around what teams, accounts, projects, subscriptions, or roles can do. Guardrails are useful because individual role policies can make mistakes. A developer might add a wildcard while debugging. A deployment module might create a broader role than intended. A legacy administrator role might still exist. A guardrail blocks the dangerous path even when a local policy is too loose.

In AWS, common guardrails include AWS Organizations service control policies, IAM permissions boundaries, resource control policies, and account-level settings. A **permissions boundary** sets the maximum permissions for a role or user. It does not grant access by itself. The identity still needs an allow policy, and the boundary limits what that allow can become.

Here is a simplified boundary shape for application-created runtime roles. It allows common runtime actions, then explicitly denies permanent credential and organization-admin paths:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyPermanentCredentialAndOrgAdminPaths",
      "Effect": "Deny",
      "Action": [
        "iam:CreateAccessKey",
        "iam:CreateUser",
        "iam:AttachUserPolicy",
        "iam:PutUserPolicy",
        "iam:CreatePolicyVersion",
        "organizations:*"
      ],
      "Resource": "*"
    }
  ]
}
```

This boundary gives the platform team a ceiling over especially dangerous actions. Application teams can still create useful runtime roles, but those roles cannot create long-lived users or change organization policy.

Azure and Google Cloud have similar organization-level ideas. Azure uses management groups, Azure Policy, Azure RBAC, Privileged Identity Management, and deny assignments in some managed contexts. Google Cloud uses organization policies, IAM allow policies, deny policies, principal access boundaries, and folder or project hierarchy controls.

Good guardrails focus on sharp edges. Deny disabling audit logs. Deny creating permanent admin users. Deny leaving approved regions. Deny public storage where the organization has decided it should never happen. Deny deployment outside approved identity paths. A guardrail that tries to encode every application detail can slow teams down. A guardrail that blocks the dangerous exits gives teams room to build inside a safe boundary.

Guardrails also connect to emergency recovery. If normal roles cannot disable CloudTrail or remove an organization policy, the emergency role may need a rare recovery path. That path should use temporary elevation, strong approval, and loud audit evidence.

## Temporary Elevation and Break-Glass Access
<!-- section-summary: Temporary elevation gives short approved access for special work, while break-glass handles rare recovery when normal automation cannot fix production. -->

**Temporary elevation** means a person receives stronger access for a short time after approval. The person does not carry standing administrator access all day. They request a role, explain the reason, link a ticket, pass MFA, and receive a session that expires automatically.

This fits normal production needs. An on-call engineer may need two hours of read-only investigation. A database engineer may need a short maintenance role during a planned migration. A security reviewer may need access to IAM reports for a quarterly review. Each session should name the person and the reason.

**Break-glass access** is the emergency path for serious incidents where normal automation cannot recover production. The path should exist before the incident. It should be tested. It should be rare. It should leave evidence.

For Northstar, break-glass might cover these cases:

| Emergency | Why normal access may fail | Recovery action |
|---|---|---|
| CI/CD cannot assume the deploy role | A trust policy or identity provider setting broke | Restore the last known good trust configuration |
| Terraform state is locked and the unlock workflow is down | The deployment pipeline cannot progress | Clear the lock through the approved backend procedure |
| A bad network change blocks health checks | Normal rollback cannot reach the service path | Revert the specific security group or route change |
| Workforce federation has an outage | Humans cannot start normal sessions | Use monitored emergency access to restore identity integration |
| Audit forwarding broke during incident response | Security visibility is degraded | Restore log delivery and verify retention |

A practical break-glass runbook should include these steps:

1. Declare the incident and record the incident ID.
2. Request the emergency role with expected actions, expected resources, duration, and rollback plan.
3. Get peer approval from a named person outside the responder.
4. Authenticate with strong MFA.
5. Start a short session with the incident ID in the session name.
6. Perform only the planned recovery actions.
7. Alert security monitoring when the role is assumed.
8. Close or let the session expire.
9. Query audit logs for every API call in the session.
10. Run a drift check and open a pull request for any lasting infrastructure change.

This runbook makes emergency access available without making it casual. The team can recover production, and the evidence trail shows why the access existed and what happened during the session.

## Access Reviews and Evidence
<!-- section-summary: Access reviews compare current permissions with real usage, ownership, exceptions, and audit logs so privilege does not grow quietly. -->

An **access review** is a scheduled check of whether a person, group, workload, or role still needs its current access. The reviewer looks at business need, recent usage, permission scope, group membership, exceptions, and audit logs. The result should be a decision: keep, reduce, remove, or add an expiry.

Access reviews matter because IAM drifts too. People change teams. Workloads stop using old services. Deployment roles keep permissions from retired modules. Emergency exceptions remain after incidents. A role that made sense six months ago may be too broad today.

For Northstar, a quarterly review should cover these paths:

| Review target | Evidence to collect | Good decision |
|---|---|---|
| Workforce groups | HR roster, on-call rotation, MFA status, role assignments | Remove people who changed teams |
| Plan role | Workflow runs, state reads, describe calls, failed access attempts | Keep read-only scope |
| Deploy role | OIDC trust policy, protected environment approvals, `iam:PassRole` usage | Remove unused write actions and broad resources |
| Runtime roles | CloudTrail activity, secret reads, bucket access, last accessed data | Keep only actions the workload uses |
| Emergency role | Activations, incident tickets, approvers, API calls, drift cleanup PRs | Confirm every session had a valid incident |
| Static keys | Key age, last used date, owner, exception record | Delete unused keys and migrate exceptions to federation |

The review record should be specific enough to prove what happened later:

| Evidence field | Example |
|---|---|
| Review | `NORTHSTAR-PROD-IAM-Q3-2026` |
| Role | `northstar-prod-terraform-deploy` |
| Trust path | GitHub OIDC, `repo:northstar/customer-portal:environment:production` |
| Current scope | Terraform-managed ECS, load balancer, receipt bucket, constrained `iam:PassRole` |
| Usage evidence | CloudTrail activity for last 90 days and workflow run IDs |
| Decision | Remove unused `rds:DescribeDBSnapshots`; keep constrained `iam:PassRole` |
| Reviewer | `platform-security` |
| Owner | `cloud-platform` |
| Ticket | `SEC-8124` |
| Next review | `2026-12-31` |

For an AWS review, the platform security team can collect a first evidence bundle from the CLI before the meeting. The bundle should show the role definition, attached policies, recent role assumptions, and analyzer findings that mention the role. The reviewer then decides what to keep or remove.

```bash
REVIEW_ID="NORTHSTAR-PROD-IAM-Q3-2026"
ROLE_NAME="northstar-prod-terraform-deploy"
ROLE_ARN="arn:aws:iam::111122223333:role/northstar-prod-terraform-deploy"
ANALYZER_ARN="arn:aws:access-analyzer:us-east-1:111122223333:analyzer/northstar-prod"
START="2026-07-01T00:00:00Z"
END="2026-09-30T23:59:59Z"

mkdir -p "evidence/$REVIEW_ID/$ROLE_NAME"

aws iam get-role \
  --role-name "$ROLE_NAME" \
  > "evidence/$REVIEW_ID/$ROLE_NAME/role.json"

aws iam list-attached-role-policies \
  --role-name "$ROLE_NAME" \
  > "evidence/$REVIEW_ID/$ROLE_NAME/attached-policies.json"

aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue="$ROLE_NAME" \
  --start-time "$START" \
  --end-time "$END" \
  --output json \
  > "evidence/$REVIEW_ID/$ROLE_NAME/cloudtrail-role-events.json"

aws accessanalyzer list-findings \
  --analyzer-arn "$ANALYZER_ARN" \
  --filter "{\"resource\":{\"eq\":[\"$ROLE_ARN\"]}}" \
  > "evidence/$REVIEW_ID/$ROLE_NAME/access-analyzer-findings.json"
```

This gives the reviewer the raw record before they discuss the decision. The same pattern works in Azure and Google Cloud: export the role assignment or IAM policy, export recent audit activity, list policy findings, and write the keep, reduce, or remove decision beside the evidence.

Audit logs are the main evidence source. In AWS, CloudTrail records IAM and STS calls, including role assumptions. Azure Activity Logs and Microsoft Entra audit logs show role assignments, sign-ins, and many management operations. Google Cloud Audit Logs record admin activity and data access when enabled. These logs should flow to a security-controlled place where application teams and attackers cannot delete their own trail.

For CI/CD, the session name should carry a run ID. For emergency work, the session name should carry an incident ID. That tiny naming habit makes later review much easier because the audit event can connect to a pull request, workflow run, or incident ticket.

Access reviews should lead to changes. If a workload no longer calls a service, remove that action. If a human group contains people outside the on-call rotation, remove them. If an emergency role was used without a ticket, fix the process. If a pipeline still uses static keys, move it to OIDC and delete the key.

## Putting It All Together
<!-- section-summary: A mature cloud IAM design uses federation, workload identities, OIDC deployment roles, guardrails, emergency access, and recurring evidence review. -->

The Northstar production path now has clear identities. A developer opens a pull request. The plan workflow uses OIDC to assume `northstar-prod-terraform-plan`, reads current state, and posts a speculative plan. That role cannot change production.

A release manager approves the protected production environment. The deploy workflow receives a fresh OIDC token and assumes `northstar-prod-terraform-deploy`. The trust policy checks repository and environment claims. The permission policy allows the expected infrastructure changes and only passes approved runtime roles. The session name includes the workflow run ID.

The API and worker run with workload identities. They receive temporary credentials from the cloud platform. They can use the secrets, queues, buckets, and logs they need. They cannot modify IAM or network rules.

An incident starts. The on-call engineer signs in through workforce federation and activates `northstar-prod-incident-readonly` with MFA and an incident ticket. If the normal path is blocked, a responder requests `northstar-prod-emergency-recovery`, gets peer approval, and uses a short session with the incident ID in the name. Afterward, the team reviews audit logs and runs a drift check.

A quarterly access review keeps the design from aging badly. The team checks people, groups, deployment roles, runtime roles, emergency activations, static key exceptions, and audit logs. Permissions that no longer match real usage get removed. Exceptions get expiry dates. The evidence shows who had access, why they had it, whether they used it, and what changed.

That is the Cloud and Infrastructure Security module as a complete loop. Infrastructure code defines the desired change. Policy as Code checks the rules before apply. Drift and perimeter security watch the live account after deployment. IAM controls the callers behind every change and gives the team the evidence to prove the access was approved, scoped, temporary where needed, and reviewed over time.

![Cloud IAM summary showing federated human access, workload identity, CI OIDC, least-privilege deployment roles, break-glass access, and access review evidence](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/cloud-iam-summary.png)

*The summary ties the IAM practices together: federated humans, workload roles, OIDC, limited deployment access, break-glass controls, and recurring evidence review.*

---

**References**

- [AWS IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) - Official AWS documentation for IAM roles, trust policies, permissions, and temporary credentials.
- [AWS temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) - Official AWS documentation for STS and temporary access.
- [AWS OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html) - Official AWS guidance for using OIDC identity providers with IAM roles.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Official GitHub documentation for OIDC tokens in workflows.
- [Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) - GitHub's AWS-specific OIDC setup guidance.
- [Google Cloud Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation) - Official Google Cloud documentation for federated workload access without service account keys.
- [Microsoft Entra workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) - Official Microsoft documentation for federated workload credentials.
- [AWS permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html) - Official AWS documentation for maximum permission boundaries.
- [AWS Organizations service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) - Official AWS documentation for organization-level permission guardrails.
- [AWS IAM Access Analyzer policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html) - Official AWS documentation for generating policies from access activity.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Official AWS documentation for account activity and API audit logs.
- [Microsoft Entra emergency access accounts](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access) - Official Microsoft guidance for emergency access account planning.
- [Microsoft Entra access reviews](https://learn.microsoft.com/en-us/entra/id-governance/access-reviews-overview) - Official Microsoft documentation for recurring access reviews.
