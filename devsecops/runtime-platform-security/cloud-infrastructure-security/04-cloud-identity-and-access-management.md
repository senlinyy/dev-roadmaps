---
title: "Cloud Identity and Access Management"
description: "Design cloud IAM paths for humans, workloads, CI/CD, deployment roles, guardrails, emergency elevation, and access reviews."
overview: "Start with the caller behind every cloud change, then map human federation, workload identity, CI/CD OIDC, least-privilege deployment roles, permission guardrails, temporary elevation, and recurring access reviews into one DevSecOps operating loop."
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

1. [Every Cloud Change Has a Caller](#every-cloud-change-has-a-caller)
2. [The Production Access Map](#the-production-access-map)
3. [Human Federation](#human-federation)
4. [Workload Identity](#workload-identity)
5. [CI/CD OIDC Federation](#cicd-oidc-federation)
6. [Least-Privilege Deployment Roles](#least-privilege-deployment-roles)
7. [Guardrails and Permission Boundaries](#guardrails-and-permission-boundaries)
8. [Temporary Elevation and Break-Glass Access](#temporary-elevation-and-break-glass-access)
9. [Access Reviews and Evidence](#access-reviews-and-evidence)
10. [Putting It All Together](#putting-it-all-together)
11. [References](#references)

## Every Cloud Change Has a Caller
<!-- section-summary: Cloud IAM explains which human, workload, pipeline, or emergency role can call each cloud API. -->

Every cloud change has a caller. A Terraform apply that creates a subnet has a caller. A console edit that opens a security group has a caller. A container that reads a secret has a caller. A CI job that deploys a service has a caller. During an incident, the emergency role has a caller too.

**Cloud Identity and Access Management**, usually shortened to **cloud IAM**, controls those callers. It answers four plain questions: who or what is calling, what action can it perform, which resource can it touch, and which conditions must be true?

A beginner can read most IAM decisions with these four words:

| IAM word | Plain-English meaning | Example |
|---|---|---|
| Principal | The caller | A human role session, workload identity, service account, managed identity, or CI workflow |
| Action | The API operation | `s3:PutObject`, `ec2:AuthorizeSecurityGroupIngress`, `Microsoft.Authorization/roleAssignments/write`, `compute.firewalls.patch` |
| Resource | The target | A bucket, role, subnet, database, project, subscription, or log workspace |
| Condition | Extra context for the decision | MFA, repository, branch, environment, source IP, region, session tag, or ticket ID |

The previous article followed a drift incident where a production database rule opened after review. The resource question was clear: port `5432` accepted traffic from `0.0.0.0/0`. The next question is identity: which caller could make that change, and should that caller have had that permission?

This article follows the Northstar customer portal again. The team has engineers, deployment workflows, application containers, receipt workers, security reviewers, and emergency responders. Each caller needs a narrow path, a short session where possible, and evidence that explains why the access existed.

## The Production Access Map
<!-- section-summary: Separate access paths keep planning, deploying, runtime work, incident investigation, auditing, and emergency recovery clear. -->

Northstar runs a web API, a background receipt worker, a receipt storage bucket, and a private database. Terraform manages the infrastructure. GitHub Actions runs speculative plans on pull requests and applies approved changes from a protected production environment. Engineers investigate incidents through workforce sign-in. Security reviewers need read access to IAM and logs. A small emergency group can recover production when normal automation fails.

The first IAM design move is **role separation**. Role separation means each job gets its own access path. A pull request plan job can read enough to build a plan. A deploy job can apply reviewed changes. A runtime container can read its own secret and write its own objects. An incident responder can read logs and resource state. An emergency responder can perform rare recovery actions with strong evidence.

Here is Northstar's starter access map:

| Role | Who or what assumes it | Duration | Main purpose | Evidence |
|---|---|---:|---|---|
| `northstar-prod-terraform-plan` | Pull request workflow | 30 minutes | Read state and build a speculative plan | PR number, commit SHA, workflow run ID |
| `northstar-prod-terraform-deploy` | Protected deploy workflow | 45 minutes | Apply approved Terraform changes | Approved PR, environment approval, workflow run ID |
| `northstar-prod-api-runtime` | Customer portal API container | Platform-managed session | Read needed secrets, write logs, use receipt storage | Task identity, service name, deployment version |
| `northstar-prod-worker-runtime` | Receipt worker container | Platform-managed session | Write receipt files and read queue messages | Task identity, service name, deployment version |
| `northstar-prod-incident-readonly` | On-call engineer through federation | 2 hours | Read logs, metrics, traces, and resource state | Incident ticket, human identity, MFA |
| `northstar-prod-security-audit` | Security reviewer through federation | 4 hours | Review IAM, CloudTrail, policy findings, and exceptions | Review ticket, reviewer, date |
| `northstar-prod-emergency-recovery` | Approved responder during serious outage | 45 minutes | Restore service when normal paths fail | Incident ticket, peer approval, audit query |

The table gives each caller a job and evidence trail. The deployment workflow receives deployment access. The runtime receives runtime access. The incident responder receives read-only investigation access. Stronger access requires a stronger reason and a shorter window.

![Production access map showing separate plan, deploy, runtime, read-only incident, security audit, and emergency recovery roles with evidence trails](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/production-access-map.png)

*The map separates the major production access paths so plan, deploy, runtime, read-only, and emergency sessions do not blur into one broad role.*

People need the first access path.

## Human Federation
<!-- section-summary: Human federation gives people temporary cloud sessions through the company identity provider instead of daily static cloud users. -->

**Human federation** means people sign in through a central identity provider, then receive temporary cloud access based on group membership, MFA, device posture, approval state, or role assignment. The identity provider might be Microsoft Entra ID, Okta, Google Workspace, IAM Identity Center, or another workforce identity system.

Federation replaces a risky older pattern: every engineer has a cloud-local user and long-lived access keys. Long-lived keys can sit in `~/.aws/credentials`, old CI secrets, shell history, build logs, password managers, and forgotten laptops. Federation gives the team a daily path with temporary sessions and central offboarding.

For Northstar, normal production human access stays read-oriented:

| Workforce group | Production access | Write access | Use case |
|---|---|---:|---|
| `Engineering` | Dashboards and documentation | No | Understand production behavior |
| `SRE-OnCall` | `northstar-prod-incident-readonly` | No | Investigate alerts and read logs |
| `Security-Reviewers` | `northstar-prod-security-audit` | No | Review IAM, policy results, and audit logs |
| `Release-Managers` | Approve deployment environment | No direct console write | Approve production workflow runs |
| `Emergency-Responders` | Eligible for emergency role | Yes, after approval | Recover serious incidents |

This setup keeps normal production changes inside Git and deployment automation. A release manager approves a workflow, and the workflow performs the change with a deployment role. The release manager does not need a standing administrator role in the cloud console.

Provider commands differ, but the pattern is similar:

```bash
aws sso login --profile northstar-prod-readonly
az login --tenant 11111111-2222-3333-4444-555555555555
gcloud auth login
```

`aws sso login` starts an AWS IAM Identity Center session for a named profile. `az login` starts an Azure CLI session against a tenant. `gcloud auth login` starts a Google Cloud user login. The access behind those sessions should map to groups, roles, MFA, and approval rules rather than permanent personal admin keys.

Human federation handles people. Software needs its own identity path.

## Workload Identity
<!-- section-summary: Workload identity gives applications temporary cloud credentials without storing permanent secrets in code, images, or config files. -->

**Workload identity** means an application, function, virtual machine, Kubernetes service account, container task, or batch job receives its own cloud identity. The workload uses that identity to call cloud APIs. The application does not need a permanent cloud key baked into a container image or config file.

For Northstar, the API runtime might read one database connection secret, write logs, and read a few receipt objects. The background worker might read queue messages and write receipt PDFs. Those workloads should avoid IAM changes, network changes, infrastructure deployment, and unrelated secrets.

Cloud platforms provide workload identity in different ways. AWS ECS task roles, EC2 instance profiles, and Lambda execution roles provide temporary credentials to workloads. Azure managed identities let Azure resources request tokens from Microsoft Entra ID. Google Cloud service accounts and Workload Identity Federation patterns give workloads cloud identities. Kubernetes platforms often map Kubernetes service accounts to cloud identities.

Here is a narrow AWS policy for a receipt worker:

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

`ListReceiptBucket` allows listing only the `receipts/` prefix in the bucket. `WriteAndReadReceiptObjects` allows reads and writes only for objects under that prefix. The bucket ARN controls listing, while the object ARN controls files inside the bucket.

Workload identity also helps incident response. If an audit log shows `northstar-prod-api-runtime` changing a security group, responders know something is wrong because that identity should never have network administration permissions.

The next caller is the deployment pipeline.

## CI/CD OIDC Federation
<!-- section-summary: OIDC federation lets CI workflows exchange signed run tokens for short-lived cloud credentials. -->

**OpenID Connect**, usually shortened to **OIDC**, is a standard for signed identity tokens. In CI/CD, a workflow can request a short-lived OIDC token from the CI platform. The cloud provider verifies the token and exchanges it for temporary cloud credentials when the token matches the role trust rules.

This replaces static deployment keys stored in CI secrets. A static key can leak through logs, compromised runners, backups, overly broad secret access, or old copies. An OIDC token is tied to one workflow run and expires quickly. The cloud role can inspect token claims such as repository, branch, environment, workflow, and audience.

For GitHub Actions deploying to AWS, the trust policy can require the expected repository and protected production environment:

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

`Principal.Federated` names GitHub's OIDC provider in the AWS account. `Action` allows web identity federation into the role. The `aud` condition expects AWS STS. The `sub` condition accepts only the Northstar repository's production environment claim. GitHub environment protection, branch rules, and cloud trust policy now reinforce the same deployment path.

![OIDC trust chain showing a CI workflow token matched against repository, environment, audience, and branch claims before receiving temporary cloud credentials](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/oidc-trust-chain.png)

*The trust chain shows how a workflow token turns into a temporary deployment role only after the cloud provider checks repository, environment, and audience claims.*

A workflow then requests an OIDC token and assumes the role:

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

`permissions.id-token: write` lets the workflow request the OIDC token. `environment: production` connects the job to protected environment rules. `role-to-assume` names the cloud deployment role. `role-session-name` includes the workflow run ID, which helps later audit review.

Azure workload identity federation and Google Cloud Workload Identity Federation use the same security idea with different setup steps. The pipeline proves who it is through a signed token and receives short-lived credentials for the allowed job.

OIDC answers how the pipeline gets credentials. The next section narrows what those credentials can do.

## Least-Privilege Deployment Roles
<!-- section-summary: Deployment roles should be split by job and scoped to the resources and actions each workflow needs. -->

**Least privilege** means each identity receives the permissions needed for its job. A plan role needs read access. A deploy role needs controlled write access. A runtime role needs application access. An incident role needs investigation access. An emergency role needs recovery access with stronger monitoring.

Start by separating plan and deploy. The `northstar-prod-terraform-plan` role can read remote state, describe resources, and produce a speculative plan. It should avoid write permissions because pull request workflows run before production approval.

The `northstar-prod-terraform-deploy` role has stronger permissions, so it should run only from protected branches or protected environments. It can change Terraform-managed infrastructure, while avoiding dangerous side paths such as creating permanent access keys, disabling audit logging, attaching administrator policies, or passing arbitrary roles to services.

In AWS, `iam:PassRole` deserves special review. It allows a caller to pass an IAM role to a service such as ECS, Lambda, or EC2. If a deployment role can pass any role, it may indirectly give a workload powerful access. A safer policy allows only approved runtime roles and only to the expected service:

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

`Action` names the role-passing permission. `Resource` lists the only runtime roles the deploy role can pass. `iam:PassedToService` limits the pass to ECS tasks. This protects the deployment path from accidentally launching a workload with an unrelated admin role.

Least privilege usually improves in stages. Teams can start with broader permissions in development to discover real API calls, then use audit logs, access analyzer findings, failed access events, and deployment history to narrow production roles. The target is practical: the caller can do its job and cannot perform high-risk actions outside that job.

Guardrails add a ceiling above individual roles.

## Guardrails and Permission Boundaries
<!-- section-summary: Guardrails set maximum permissions so one broad role policy cannot bypass organization rules. -->

A **guardrail** is a control that sets a boundary around what teams, accounts, projects, subscriptions, or roles can do. Guardrails help when an individual role policy is too broad or a module creates an unsafe permission. They block sharp edges across the organization.

In AWS, common guardrails include AWS Organizations service control policies, IAM permissions boundaries, resource control policies, and account-level settings. A **permissions boundary** sets the maximum permissions for a role or user. It does not grant access by itself; the identity still needs an allow policy, and the boundary limits the maximum scope.

Here is a simplified boundary shape for application-created runtime roles:

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

The `Deny` statement blocks permanent credential creation and organization administration paths. Since explicit deny has strong priority in IAM evaluation, this boundary can stop a risky action even if a separate policy accidentally allows it.

Azure and Google Cloud have similar organization-level ideas. Azure uses management groups, Azure Policy, Azure RBAC, Privileged Identity Management, and deny assignments in some managed contexts. Google Cloud uses organization policies, IAM allow policies, IAM deny policies, principal access boundaries, and folder or project hierarchy controls.

Good guardrails focus on the dangerous exits. Deny disabling audit logs. Deny creating permanent admin users. Deny leaving approved regions. Deny public storage where the organization has a hard rule. Deny deployment outside approved identity paths. Detailed application design still belongs in reviewed IaC and policy packs.

Emergency recovery needs a careful path through those guardrails.

## Temporary Elevation and Break-Glass Access
<!-- section-summary: Temporary elevation gives short approved access for special work, and break-glass handles rare recovery when normal paths fail. -->

**Temporary elevation** means a person receives stronger access for a short time after approval. They request a role, explain the reason, link a ticket, pass MFA, and receive a session that expires automatically.

This fits normal production work. An on-call engineer may need two hours of read-only investigation. A database engineer may need a maintenance role during a planned migration. A security reviewer may need IAM reports for a quarterly review. Each session should name the person, reason, ticket, and expiry.

**Break-glass access** is the emergency path for serious incidents where normal automation cannot recover production. The path should exist before the incident, receive regular tests, stay rare, and leave strong evidence.

For Northstar, break-glass might cover these cases:

| Emergency | Why normal access may fail | Recovery action |
|---|---|---|
| CI/CD cannot assume the deploy role | A trust policy or identity provider setting broke | Restore the last known good trust configuration |
| Terraform state is locked and the unlock workflow is down | The deployment pipeline cannot progress | Clear the lock through the approved backend procedure |
| A bad network change blocks health checks | Normal rollback cannot reach the service path | Revert the specific security group or route change |
| Workforce federation has an outage | Humans cannot start normal sessions | Restore identity integration through monitored emergency access |
| Audit forwarding broke during incident response | Security visibility is degraded | Restore log delivery and verify retention |

A practical break-glass runbook should capture the sequence:

1. Declare the incident and record the incident ID.
2. Request the emergency role with expected actions, resources, duration, and rollback plan.
3. Get peer approval from a named person outside the responder.
4. Authenticate with strong MFA.
5. Start a short session with the incident ID in the session name.
6. Perform the planned recovery actions.
7. Alert security monitoring when the role is assumed.
8. Close the session or let it expire.
9. Query audit logs for every API call in the session.
10. Run a drift check and open a pull request for any lasting infrastructure change.

This runbook lets the team recover production while keeping emergency power rare, short, approved, and reviewable.

## Access Reviews and Evidence
<!-- section-summary: Access reviews compare current permissions with real usage, ownership, exceptions, and audit logs. -->

An **access review** is a scheduled check of whether a person, group, workload, or role still needs its current access. The reviewer looks at business need, recent usage, permission scope, group membership, exceptions, and audit logs. The decision should say keep, reduce, remove, or add an expiry.

IAM drifts over time. People change teams. Workloads stop using old services. Deployment roles keep permissions from retired modules. Emergency exceptions remain after incidents. A role that fit last quarter may be too broad today.

For Northstar, a quarterly review should cover these paths:

| Review target | Evidence to collect | Decision shape |
|---|---|---|
| Workforce groups | HR roster, on-call rotation, MFA status, role assignments | Remove people who changed teams |
| Plan role | Workflow runs, state reads, describe calls, failed access attempts | Keep read-only scope |
| Deploy role | OIDC trust policy, protected environment approvals, `iam:PassRole` usage | Remove unused write actions and broad resources |
| Runtime roles | Audit activity, secret reads, bucket access, last accessed data | Keep actions the workload uses |
| Emergency role | Activations, incident tickets, approvers, API calls, drift cleanup PRs | Confirm every session had a valid incident |
| Static keys | Key age, last used date, owner, exception record | Delete unused keys and migrate exceptions to federation |

The review record should be specific enough for a later audit:

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

For an AWS review, the platform security team can collect a first evidence bundle from the CLI:

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

The variables at the top keep the review ID, role, analyzer, and time window consistent across commands. The `get-role` and `list-attached-role-policies` commands capture the current role definition. The CloudTrail query collects recent events tied to the role name. The Access Analyzer query collects findings for the role ARN.

The same review pattern works in Azure and Google Cloud: export role assignments or IAM policies, export audit activity, list policy findings, and write the keep, reduce, or remove decision beside the evidence.

Access reviews should lead to changes. If a workload no longer calls a service, remove that action. If a human group contains people outside the on-call rotation, remove them. If an emergency role was used without a ticket, fix the process. If a pipeline still uses static keys, move it to OIDC and delete the key.

## Putting It All Together
<!-- section-summary: Cloud IAM ties every production change to a scoped caller, short session, guardrail, and reviewable evidence trail. -->

Northstar's production path now has clear identities. A developer opens a pull request. The plan workflow uses OIDC to assume `northstar-prod-terraform-plan`, reads current state, and posts a speculative plan. That role cannot change production.

A release manager approves the protected production environment. The deploy workflow receives a fresh OIDC token and assumes `northstar-prod-terraform-deploy`. The trust policy checks repository and environment claims. The permission policy allows expected infrastructure changes and only passes approved runtime roles. The session name includes the workflow run ID.

The API and worker run with workload identities. They receive temporary credentials from the cloud platform. They can use the secrets, queues, buckets, and logs they need. They cannot modify IAM or network rules.

An incident starts. The on-call engineer signs in through workforce federation and activates `northstar-prod-incident-readonly` with MFA and an incident ticket. If the normal path is blocked, a responder requests `northstar-prod-emergency-recovery`, gets peer approval, and uses a short session with the incident ID in the name. Afterward, the team reviews audit logs and runs a drift check.

A quarterly access review keeps the design current. The team checks people, groups, deployment roles, runtime roles, emergency activations, static key exceptions, and audit logs. Permissions that no longer match real usage get removed. Exceptions get expiry dates. The evidence shows who had access, why they had it, whether they used it, and what changed.

This closes the Cloud and Infrastructure Security module as one loop. Infrastructure code defines the desired change. Policy as Code checks the rules before apply. Drift and perimeter security watch the live account after deployment. IAM controls the callers behind every change and gives the team evidence that access was approved, scoped, temporary where needed, and reviewed over time.

![Cloud IAM summary showing federated human access, workload identity, CI OIDC, least-privilege deployment roles, break-glass access, and access review evidence](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/cloud-iam-summary.png)

*The summary ties the IAM practices together: federated humans, workload roles, OIDC, limited deployment access, break-glass controls, and recurring evidence review.*

## References

- [AWS IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) - Official AWS documentation for IAM roles, trust policies, permissions, and temporary credentials.
- [AWS temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) - Official AWS documentation for STS and temporary access.
- [AWS OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_oidc.html) - Official AWS guidance for using OIDC identity providers with IAM roles.
- [AWS IAM Access Analyzer policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html) - Official AWS documentation for generating IAM policies from access activity.
- [AWS permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html) - Official AWS documentation for maximum permission boundaries.
- [AWS Organizations service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) - Official AWS documentation for organization-level permission guardrails.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Official AWS documentation for account activity and API audit logs.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Official GitHub documentation for OIDC tokens in workflows.
- [Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) - GitHub's AWS-specific OIDC setup guidance.
- [Azure managed identities](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) - Official Microsoft documentation for managed identities for Azure resources.
- [Microsoft Entra workload identity federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) - Official Microsoft documentation for federated workload credentials.
- [Azure role-based access control overview](https://learn.microsoft.com/en-us/azure/role-based-access-control/overview) - Official Microsoft documentation for Azure RBAC.
- [Microsoft Entra Privileged Identity Management](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) - Official Microsoft documentation for eligible role activation and privileged access governance.
- [Microsoft Entra emergency access accounts](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access) - Official Microsoft guidance for emergency access account planning.
- [Microsoft Entra access reviews](https://learn.microsoft.com/en-us/entra/id-governance/access-reviews-overview) - Official Microsoft documentation for recurring access reviews.
- [Google Cloud IAM overview](https://cloud.google.com/iam/docs/overview) - Official Google Cloud documentation for IAM concepts and access control.
- [Google Cloud service accounts](https://cloud.google.com/iam/docs/service-account-overview) - Official Google Cloud documentation for service accounts as workload identities.
- [Google Cloud Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation) - Official Google Cloud documentation for federated workload access without service account keys.
- [Google Cloud IAM deny policies](https://cloud.google.com/iam/docs/deny-overview) - Official Google Cloud documentation for deny policies.
- [NIST Secure Software Development Framework SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST guidance for protecting development workflows and access to development systems.
