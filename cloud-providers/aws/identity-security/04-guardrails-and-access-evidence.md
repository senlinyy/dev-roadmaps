---
title: "Guardrails and Access Evidence"
description: "Use AWS Organizations, SCPs, cross-account roles, CloudTrail, Access Analyzer, credential reports, and review cadence to keep IAM safe across accounts."
overview: "IAM gets harder after one account grows into many accounts. This article follows one payments workload as the team adds account structure, guardrails, cross-account access, audit evidence, credential review, and a repeatable cleanup rhythm."
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

1. [When One Account Grows Into Many](#when-one-account-grows-into-many)
2. [The Account Map](#the-account-map)
3. [Service Control Policies](#service-control-policies)
4. [Common Guardrails](#common-guardrails)
5. [Cross-Account Access](#cross-account-access)
6. [CloudTrail Evidence](#cloudtrail-evidence)
7. [Access Analyzer and Last Accessed](#access-analyzer-and-last-accessed)
8. [Static Credentials and Secrets](#static-credentials-and-secrets)
9. [The Review Loop](#the-review-loop)
10. [Putting It All Together](#putting-it-all-together)

## When One Account Grows Into Many
<!-- section-summary: Multi-account AWS needs rules above local IAM and evidence after changes, because access can drift after teams, accounts, and workloads grow. -->

The earlier IAM articles followed one workflow: a receipt export function needs the right role, the right policy, the right bucket path, and the right KMS key. That is already a lot for one production account. Now the same company grows past one account, and the access problem changes shape.

The running example is a small payments company. The first version has one AWS account with an S3 bucket for receipt files, a Lambda function that writes receipt exports, CloudWatch logs, and a few IAM roles. S3 stores objects such as files and reports. Lambda runs code without managing servers. CloudWatch collects logs, metrics, and alarms. IAM roles give workloads temporary AWS credentials.

After a few months, one account turns into several accounts. `payments-dev` holds experiments, `payments-prod` handles customer traffic, `security-log-archive` stores audit logs, `tooling` runs CI/CD pipelines, and `engineer-lab` lets engineers learn safely. CI/CD means the automated build and deployment system that tests and ships application changes.

This split helps the company. Development mistakes stay away from production data. Security logs sit in a separate account. The deployment pipeline can have its own account instead of sharing space with the application. Account boundaries give AWS teams one of the strongest ways to separate risk.

The split also creates new IAM work. A local administrator in one account might create a broad policy during an incident and forget to remove it. A lab account might launch resources in a Region the company never approved for customer data. A vendor role created for a two-week project might survive for a year. A static access key might keep working after the scanner that used it has been retired.

This article is about two habits that keep that larger environment understandable. **Guardrails** set rules above local IAM, so each account stays inside company limits. **Access evidence** shows what access exists, what requests happened, which credentials remain active, and which permissions can be removed.

The team needs the account map before it can place guardrails on it. That map comes from AWS Organizations.

## The Account Map
<!-- section-summary: AWS Organizations gives multiple AWS accounts one central structure, so teams can group accounts and attach shared controls to the right branches. -->

**AWS Organizations** is the AWS service for centrally managing multiple AWS accounts. It lets a company create accounts, invite existing accounts, group accounts, attach organization policies, and manage billing from one organization structure. In plain terms, it gives the company a tree for its AWS accounts instead of a pile of separate logins.

The top account in that structure is the **management account**. It creates and manages the organization, attaches policies, designates delegated administrator accounts, and handles consolidated billing. Because this account has such broad control over the organization, the payments company keeps normal application workloads out of it.

The other accounts are **member accounts**. `payments-dev`, `payments-prod`, `tooling`, `security-log-archive`, and `engineer-lab` are all member accounts in the example. Each member account still has its own resources, IAM roles, CloudTrail events, Region settings, and root user, but the organization can group and govern those accounts from above.

An **organizational unit**, usually shortened to **OU**, is a group of accounts in the organization tree. OUs can contain accounts, and they can also contain other OUs. The payments company can place production accounts under a `Workloads/Prod` OU, development accounts under `Workloads/Dev`, security accounts under `Security`, and learning accounts under `Labs`.

```mermaid
flowchart TD
    Mgmt["Management account"]
    Root["Organization root"]
    Security["Security OU"]
    Workloads["Workloads OU"]
    Labs["Labs OU"]
    Prod["Prod OU"]
    Dev["Dev OU"]
    Logs["security-log-archive"]
    Tooling["tooling"]
    PaymentsProd["payments-prod"]
    PaymentsDev["payments-dev"]
    Lab["engineer-lab"]

    Mgmt --> Root
    Root --> Security
    Root --> Workloads
    Root --> Labs
    Security --> Logs
    Security --> Tooling
    Workloads --> Prod
    Workloads --> Dev
    Prod --> PaymentsProd
    Dev --> PaymentsDev
    Labs --> Lab
```

This tree matters because policies can attach to the root, an OU, or a specific account. Accounts inherit applicable policies from the branches above them. If `payments-prod` sits under `Workloads/Prod`, it can inherit stricter production rules. If `engineer-lab` sits under `Labs`, it can inherit rules that allow experiments but block expensive or risky services.

A reviewer can confirm the account list from the management account or a delegated administration path:

```bash
aws organizations list-accounts \
  --query 'Accounts[].{Name:Name,Id:Id,Status:Status}' \
  --output json
```

```json
[
  {
    "Name": "payments-dev",
    "Id": "111122223333",
    "Status": "ACTIVE"
  },
  {
    "Name": "payments-prod",
    "Id": "999900001111",
    "Status": "ACTIVE"
  },
  {
    "Name": "tooling",
    "Id": "444455556666",
    "Status": "ACTIVE"
  },
  {
    "Name": "security-log-archive",
    "Id": "777788889999",
    "Status": "ACTIVE"
  }
]
```

This output proves which accounts are active in the organization. OU placement comes from the organization tree, so the next review step is to check that `payments-prod` sits under the production branch before production guardrails are attached.

The organization structure gives the team a place to put shared rules. The first shared rule type to understand is the service control policy.

![The guardrails map shows which controls usually sit at the organization, account, identity, network, data, and evidence layers](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/common-guardrails-map.png)

*The guardrails map shows which controls usually sit at the organization, account, identity, network, data, and evidence layers.*


## Service Control Policies
<!-- section-summary: Service control policies set permission ceilings for member accounts, so local IAM administrators cannot grant actions above the organization limit. -->

A **service control policy**, usually shortened to **SCP**, is an AWS Organizations policy that sets the maximum permissions available to IAM users and IAM roles in member accounts. An SCP grants zero permissions on its own. It works as a ceiling over local IAM.

AWS still evaluates the local identity policies, resource policies, session policies, permissions boundaries, and other IAM layers for each request. The SCP answers a separate question: is this action still available inside this account according to the organization rules? The request succeeds only when the local IAM layers allow it and the organization ceiling leaves it available.

Here is a small SCP that denies member accounts the ability to leave the organization. This example is intentionally small, because the important part is seeing the ceiling above local IAM:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyLeavingOrganization",
      "Effect": "Deny",
      "Action": "organizations:LeaveOrganization",
      "Resource": "*"
    }
  ]
}
```

If a local administrator in `payments-prod` has the AWS managed `AdministratorAccess` policy, this SCP still blocks the denied action. The local administrator can manage many resources inside the account, but the organization ceiling removes this action from the account's available permissions.

The statement is small, but every field matters. `Effect` is `Deny`, so it removes this action wherever the SCP applies. `Action` names `organizations:LeaveOrganization`, the operation member accounts should not use during normal work. `Resource` is `*` because this Organizations action does not narrow cleanly to one application resource. The review question is whether the denied action should be unavailable for every account under the target OU.

SCPs have boundaries that matter in production. AWS applies SCPs to member accounts, including root users in member accounts. The management account sits outside that SCP effect, which is one reason production workloads should live in member accounts. Service-linked roles also sit outside SCP restrictions because AWS services use those roles to operate integrations inside the account.

The `FullAWSAccess` SCP is part of the default starting point in Organizations. If a team removes it without replacing it with allow statements that keep needed services available, member-account actions can fail broadly. For beginners, the most practical SCP pattern is an explicit deny guardrail: leave the normal allow baseline in place, then deny the actions the company wants to block everywhere under a branch.

SCPs deserve slow rollout. The payments company should attach a new SCP to a small test OU first, move one low-risk account into that OU, and watch normal workflows. Last accessed data and CloudTrail events can show which services accounts use before the policy moves closer to production.

The attached SCPs on an OU are part of the operating evidence. This command asks Organizations which SCPs currently apply directly to the production OU:

```bash
aws organizations list-policies-for-target \
  --target-id ou-a1b2-prod \
  --filter SERVICE_CONTROL_POLICY \
  --query 'Policies[].{Name:Name,Id:Id,AwsManaged:AwsManaged}' \
  --output json
```

```json
[
  {
    "Name": "FullAWSAccess",
    "Id": "p-FullAWSAccess",
    "AwsManaged": true
  },
  {
    "Name": "DenyOutsideApprovedRegions",
    "Id": "p-abcd1234",
    "AwsManaged": false
  },
  {
    "Name": "ProtectCloudTrail",
    "Id": "p-efgh5678",
    "AwsManaged": false
  }
]
```

This output says the OU still has the normal allow baseline and two customer guardrails. A missing `FullAWSAccess` row would deserve careful investigation unless the organization intentionally uses a custom allow-list SCP model.


Now that the ceiling makes sense, the next question is which actions belong in shared guardrails. The payments company starts with risks that repeat across accounts: Regions, logging, public storage, and root usage.

![The SCP ceiling view shows how organization-level policy limits the maximum actions an account can use even when an identity policy allows more](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/scp-ceiling-map.png)

*The SCP ceiling view shows how organization-level policy limits the maximum actions an account can use even when an identity policy allows more.*


## Common Guardrails
<!-- section-summary: Common guardrails protect approved Regions, audit logging, public storage settings, and root usage where the same rule should hold across many accounts. -->

A **guardrail** is a shared rule that prevents a class of mistakes across many accounts. In AWS, guardrails can use SCPs, organization-level service policies, account baselines, or security service settings. The important idea is simple: the company decides which risks should be controlled centrally, instead of asking every account team to remember them separately.

Approved Regions are a common first guardrail. A **Region** is an AWS geographic location such as `us-east-1`, `eu-west-1`, or `ap-southeast-2`. If the payments company stores customer data only in Ireland and London, a production account should not create a database in a different Region during a rushed release.

An SCP can use the `aws:RequestedRegion` condition key to deny actions outside approved Regions. Global services need special care because services such as IAM, Route 53, CloudFront, AWS Support, and some Organizations operations use global or special endpoints. A Region guardrail should begin in a test OU because a missing exception can break account administration.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideApprovedRegions",
      "Effect": "Deny",
      "NotAction": [
        "iam:*",
        "organizations:*",
        "route53:*",
        "cloudfront:*",
        "support:*",
        "sts:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": [
            "eu-west-1",
            "eu-west-2"
          ]
        }
      }
    }
  ]
}
```

The important part is the combination of `NotAction` and `aws:RequestedRegion`. `NotAction` lists global or special services that should keep working even when the requested Region is outside the approved list. `StringNotEquals` denies every other action when the requested Region is outside `eu-west-1` and `eu-west-2`. The review question is whether the exception list covers real global administration paths without quietly allowing data services outside the approved Regions.

Audit logging is another guardrail. **AWS CloudTrail** records AWS API activity, and an organization trail can log events for all accounts in the organization. The payments company can create an organization trail from the management account or a delegated administrator account, send the logs to `security-log-archive`, and keep member accounts from changing the organization trail.

An SCP can also block local tampering actions such as `cloudtrail:StopLogging` and `cloudtrail:DeleteTrail` in workload accounts. The organization trail remains the main evidence path, and the SCP adds a second layer that keeps local administrators from turning off local trails or weakening logging settings during an investigation.

Public S3 access needs a specific guardrail because one public bucket policy can expose a lot of data. **Amazon S3 Block Public Access** has settings that block public ACLs, block public bucket policies, ignore public ACLs, and restrict public buckets. AWS Organizations can manage S3 Block Public Access through an Amazon S3 policy for the organization, which is often clearer than trying to catch every public-storage path with one giant SCP.

```json
{
  "s3_attributes": {
    "public_access_block_configuration": {
      "@@assign": "all"
    }
  }
}
```

This organization S3 policy uses the Organizations policy language rather than IAM policy syntax. `public_access_block_configuration` is the S3 Block Public Access setting group, and `@@assign: "all"` means the policy assigns all four public-access block settings. The review question is whether any account has a documented business exception for public buckets; for receipt and payment data, the expected operating answer should be no.

Root usage also belongs in guardrail conversations. Every member account has a **root user**, and that identity has account ownership power. The payments company should keep root protected with MFA, avoid root access keys, and use root only for documented account recovery or root-only tasks. SCPs can restrict root users in member accounts, so production OUs can block routine root administration paths while keeping a clear break-glass process.


These guardrails reduce account-level mistakes. The accounts still need to work together, and that brings the next access pattern: crossing account boundaries without sharing permanent keys.

## Cross-Account Access
<!-- section-summary: Cross-account roles and resource policies let accounts collaborate while avoiding shared production access keys. -->

After the account split, work starts crossing boundaries. The `tooling` account needs to deploy to `payments-prod`. The security team needs read access to selected evidence in workload accounts. The `payments-prod` receipt exporter may need to write audit copies into a bucket in `security-log-archive`.

The risky shortcut is a production IAM user with access keys copied into another account's CI/CD system. That key can keep working for years, and anyone who finds it can call production APIs. The safer AWS pattern is **cross-account access** through roles or resource policies.

A **cross-account role** is an IAM role in one account that a principal from another account can assume. The target account owns the role. The role's trust policy names the external principal that may assume it. The source account also grants its caller permission to call `sts:AssumeRole` on that target role.

STS means **AWS Security Token Service**. When a caller assumes a role, STS returns temporary credentials for that role session. Those credentials expire automatically, and CloudTrail records the assumed-role session as it uses AWS services.

For the payments company, `payments-prod` can create a role named `ProdDeployRole`. Its trust policy can allow only the deployment pipeline role in `tooling`. The role name and source principal make the production deployment path visible to a reviewer:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111122223333:role/DeployPipeline"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

The trust policy lives in `payments-prod`. `Principal.AWS` names the exact source role in `tooling` that may request the production deploy session. `Action` is `sts:AssumeRole` because the source role asks STS for temporary credentials in the target account. A production trust policy should avoid trusting a whole account root unless the team has another control that narrows which source principals can use it.

The source role in `tooling` also needs an identity policy that allows the assume-role request. This second policy lives with the caller, so the source account controls who can ask for the production session:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::999900001111:role/ProdDeployRole"
    }
  ]
}
```

Both sides matter. The target role must trust the source principal. The source principal must have permission to ask for the target role. In the source policy, `Resource` points at the production role ARN, so the pipeline cannot use this statement to assume a different role. After STS creates the session, the role permissions in `payments-prod` control what the pipeline can do, and the SCPs above `payments-prod` still set the account ceiling.

Sometimes a caller needs one resource instead of a full session in another account. A **resource-based policy** attaches directly to a resource and names the principals that may use it. An S3 bucket policy in `security-log-archive` can allow `payments-prod` to write objects under one audit prefix, while the caller keeps using its own role session.

Roles and resource policies solve different access shapes. A role works well when the caller needs to operate inside another account. A resource policy works well when another account needs access to one supported resource. Both patterns keep production away from shared long-lived access keys.


The accounts can now work together. The next problem is proof: who assumed which role, who changed which policy, and which request failed or succeeded.

![The cross-account flow shows how temporary role sessions give central tooling access without sharing permanent credentials across accounts](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/cross-account-temporary-access.png)

*The cross-account flow shows how temporary role sessions give central tooling access without sharing permanent credentials across accounts.*


## CloudTrail Evidence
<!-- section-summary: CloudTrail records AWS API activity, so reviewers can see the caller, action, account, source, request details, and denial evidence. -->

**CloudTrail** is AWS's activity record for API calls. It records requests made through the AWS Console, AWS CLI, SDKs, AWS services, and automation tools. For IAM operations, it helps answer practical review questions: who asked AWS to do this, from which account, using which session, and did AWS allow the request?

A CloudTrail event is a JSON record with fields that connect an action to a caller. The exact fields vary by service and event type, but the IAM evidence usually starts with `eventTime`, `eventSource`, `eventName`, `userIdentity`, `sourceIPAddress`, `requestParameters`, and `errorCode`.

```json
{
  "eventTime": "2026-05-14T10:22:31Z",
  "eventSource": "iam.amazonaws.com",
  "eventName": "CreateAccessKey",
  "awsRegion": "us-east-1",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::123456789012:assumed-role/prod-support/senlin-prod-support",
    "accountId": "123456789012",
    "sessionContext": {
      "sessionIssuer": {
        "type": "Role",
        "arn": "arn:aws:iam::123456789012:role/prod-support",
        "userName": "prod-support"
      }
    }
  },
  "sourceIPAddress": "203.0.113.40",
  "requestParameters": {
    "userName": "backup-scanner"
  },
  "errorCode": "AccessDenied"
}
```

This event tells a concrete story. A role session named `prod-support` tried to call `CreateAccessKey` in IAM. The request came from `203.0.113.40`. AWS denied it. A reviewer can now ask whether support should ever create access keys, which SCP or IAM layer denied the request, and whether the support workflow needs a safer path.

CloudTrail Event history can help with quick lookup, and trails or event data stores handle longer retention and analysis. For organization-wide evidence, the payments company should use an organization trail that logs all accounts and sends the records to a protected location. Member accounts can see the organization trail, but they cannot delete it, turn logging on or off, or change what it logs.

When the question crosses accounts or needs SQL-style filtering, CloudTrail Lake can turn the same evidence into a query. A security reviewer investigating access-key creation can search the organization event data store for the account, action, and time window:

```sql
SELECT eventTime, recipientAccountId, eventName, userIdentity.arn, sourceIPAddress, errorCode
FROM $EDS_ID
WHERE eventSource = 'iam.amazonaws.com'
  AND eventName IN ('CreateAccessKey', 'UpdateAccessKey', 'DeleteAccessKey')
  AND eventTime BETWEEN '2026-05-14 00:00:00' AND '2026-05-15 00:00:00'
ORDER BY eventTime DESC
LIMIT 50;
```

The result should give the review meeting a short evidence list instead of a vague concern about keys:

```console
eventTime                 recipientAccountId  eventName       arn                                                       sourceIPAddress  errorCode
2026-05-14 10:22:31.000   123456789012        CreateAccessKey arn:aws:sts::123456789012:assumed-role/prod-support/senlin-prod-support 203.0.113.40     AccessDenied
2026-05-14 09:10:02.000   999900001111        DeleteAccessKey arn:aws:sts::999900001111:assumed-role/security-audit/priya             198.51.100.12    null
```

The first row shows a denied attempt by a production support session. The second row shows a security-audit session deleting an access key in another account. The next step is still human: confirm whether each key belongs to an approved exception, an emergency identity, a legacy vendor, or something that should be disabled.

During hands-on debugging, the current caller is the first fact to prove. A human using the CLI can run this before changing anything else. The command does not change resources, so it is a useful first check during an incident:

```bash
aws sts get-caller-identity --output json
```

```json
{
  "UserId": "AROA999999999EXAMPLE:priya",
  "Account": "777788889999",
  "Arn": "arn:aws:sts::777788889999:assumed-role/SecurityAudit/priya"
}
```

That response shows the account, ARN, and user ID behind the current credentials. This example says Priya is using a temporary `SecurityAudit` role session in the `security-log-archive` account. It helps catch simple but dangerous mistakes, such as working in `payments-prod` while thinking the terminal profile points at `payments-dev`, or using an old IAM user key instead of an Identity Center role session.

CloudTrail shows what happened. Access reviews also need evidence about what policy paths currently allow, even before anyone uses them.

## Access Analyzer and Last Accessed
<!-- section-summary: IAM Access Analyzer and last accessed data help teams find external access, internal access paths, unused roles, stale keys, and permissions that can be narrowed. -->

**IAM Access Analyzer** is AWS tooling that analyzes access paths and policy intent. It can produce findings for external access, internal access, and unused access. A finding is a piece of evidence that says a policy or credential deserves review.

External access findings begin with a **zone of trust**. The zone of trust is the account or organization boundary the analyzer treats as expected. If an S3 bucket policy in `payments-prod` grants access to an account outside the organization, Access Analyzer can create an external access finding because the principal sits outside the trusted boundary.

Internal access findings help with a different question. They can show possible access paths between principals and resources inside the selected account or organization scope. For example, the security team may want to know which roles inside the organization can read a production DynamoDB table or a sensitive S3 bucket. DynamoDB is AWS's managed key-value and document database.

Unused access findings focus on cleanup. They can identify roles with no access activity in the configured usage window, IAM user passwords or access keys that have not been used, and permissions that appear unused. For a payments team, this is where the old vendor role, forgotten scanner key, and broad support policy start to show up as review items.

| Evidence type | Question it helps answer | Payments example |
|---|---|---|
| External access | Can someone outside the trusted account or organization reach this resource? | A bucket policy allows a vendor account to read receipt exports. |
| Internal access | Which internal principals can reach this sensitive resource? | A support role can read a production customer table. |
| Unused access | Which roles, keys, passwords, or permissions appear stale? | A migration role has had no activity in 120 days. |
| Last accessed | Which services or supported actions were attempted recently? | A role has `ec2:*`, but evidence only shows read-only EC2 use. |

**Last accessed information** helps reviewers narrow permissions. It can show service-level access and, for supported services and management actions, action-level access. It includes attempted API access, so a denied request can still appear in the data. CloudTrail remains the source to check whether the request succeeded or failed.

For external access review, a security team can list active analyzer findings and keep the output focused on the resource, principal, and status:

```bash
aws accessanalyzer list-findings \
  --analyzer-arn arn:aws:access-analyzer:us-east-1:777788889999:analyzer/org-access-analyzer \
  --filter '{"status":{"eq":["ACTIVE"]}}' \
  --query 'findings[].{Resource:resource,ResourceType:resourceType,Principal:principal,Status:status}' \
  --output json
```

```json
[
  {
    "Resource": "arn:aws:s3:::payments-prod-receipts",
    "ResourceType": "AWS::S3::Bucket",
    "Principal": {
      "AWS": "arn:aws:iam::555566667777:role/vendor-export"
    },
    "Status": "ACTIVE"
  }
]
```

This finding does not automatically mean the bucket is compromised. It means a principal outside the trusted zone can reach the bucket according to policy analysis. The reviewer should confirm the vendor owner, the allowed prefix, the contract reason, the expiration date, and the CloudTrail evidence for recent use.

This evidence has limits. Action-level last accessed information does not cover data plane events, and `iam:PassRole` is not tracked in IAM action last accessed information. A reviewer should use last accessed data as a guide, then confirm important decisions with CloudTrail, application owners, and the policy itself.

The payments company can use this evidence without making the first cleanup destructive. If a vendor role looks unused, the first change can remove the trust path or detach the broad policy. If normal work stays healthy and the owner confirms the contract ended, the team can delete the role later. Reversible changes give evidence time to prove the access really went stale.

Access Analyzer and last accessed data point at stale access. Static credentials deserve their own section because they can outlive every reason they were created.

## Static Credentials and Secrets
<!-- section-summary: Credential reports and secret metadata help teams review long-lived access keys, passwords, MFA status, and secret usage without exposing sensitive values. -->

A **static credential** is a credential that keeps working until someone rotates, disables, or deletes it. IAM user passwords and IAM access keys are the usual AWS examples. They are useful for a few legacy or emergency cases, but they need review because they do not expire like role sessions.

The **IAM credential report** lists all users in an account and the status of IAM-managed credentials such as passwords, MFA devices, and the first two access keys for each user. MFA means multi-factor authentication, the second proof used during sign-in. The report gives auditors and administrators a CSV view of credential age, activity, and status.

A security reviewer can generate and download the report with the AWS CLI. The command pair asks IAM to prepare the report, then decodes the CSV content into a local file for review:

```bash
aws iam generate-credential-report

aws iam get-credential-report \
  --query Content \
  --output text | base64 --decode > credential-report.csv
```

The first command returns a generation status:

```json
{
  "State": "COMPLETE",
  "Description": "A credential report was generated successfully."
}
```

The second command pulls the base64-encoded CSV content from the `Content` field and decodes it into `credential-report.csv`. The report contains metadata about IAM-managed credentials. It does not print secret access key values.

A small slice of that CSV can reveal the next cleanup items. The reviewer is looking for active keys, old rotation dates, missing MFA, and credentials with no useful owner:

```csv
user,password_enabled,mfa_active,access_key_1_active,access_key_1_last_rotated,access_key_1_last_used_date,access_key_1_last_used_service
backup-scanner,false,false,true,2025-01-09T12:30:41+00:00,2025-02-04T08:12:09+00:00,s3
breakglass-admin,true,true,false,N/A,N/A,N/A
vendor-export,false,false,true,2024-11-18T17:50:10+00:00,N/A,N/A
```

`backup-scanner` has an active key that last used S3 months ago. That might be an old scanner integration, or it might be a script nobody owns anymore. `breakglass-admin` has a password and MFA with no active access key, which can fit an emergency process if the owner and storage procedure are documented. `vendor-export` has an active key with no recorded use, which makes it a strong cleanup candidate.

Credential review should avoid exposing secret values. AWS shows the secret access key only when the key is created. Later reviews should inspect the key ID, status, age, and last-used data. Printing or copying secret material during an audit creates a new place where the secret can leak.

Secrets stored in **AWS Secrets Manager** need the same discipline. Secrets Manager stores sensitive values such as database passwords, API tokens, and application credentials. A reviewer often needs to know who can read a secret, when it was changed, whether rotation is enabled, and which KMS key protects it. KMS is AWS's key management service for encryption keys.

For secret review, metadata comes first. The reviewer can learn the name, ARN, KMS key, rotation status, and last change time before anyone retrieves the sensitive value:

```bash
aws secretsmanager describe-secret \
  --secret-id prod/payments/db-password \
  --query '{ARN:ARN,Name:Name,KmsKeyId:KmsKeyId,RotationEnabled:RotationEnabled,LastChangedDate:LastChangedDate}' \
  --output json
```

```json
{
  "ARN": "arn:aws:secretsmanager:eu-west-1:999900001111:secret:prod/payments/db-password-AbCdEf",
  "Name": "prod/payments/db-password",
  "KmsKeyId": "arn:aws:kms:eu-west-1:999900001111:key/22222222-3333-4444-5555-666666666666",
  "RotationEnabled": true,
  "LastChangedDate": "2026-05-30T21:14:08.281000+00:00"
}
```

This metadata output is safe for a normal review because it leaves the password value out of the terminal. `RotationEnabled` should match the team's rotation policy. `KmsKeyId` shows which encryption key protects the secret. `LastChangedDate` tells the reviewer when the secret metadata or value last changed, which is useful when a deployment suddenly starts failing after a credential update.

The secret value itself should stay out of the terminal during normal review. `GetSecretValue` retrieves `SecretString` or `SecretBinary`, and AWS records the API call in CloudTrail. Secrets Manager omits the sensitive secret value fields from CloudTrail, but request parameters can still appear in logs, so reviewers should keep sensitive data out of parameters and custom logs.

Secrets Manager access also crosses IAM and KMS. A caller needs `secretsmanager:GetSecretValue`, and if the secret uses a customer-managed KMS key, the caller also needs `kms:Decrypt` for that key. CloudTrail can show the `GetSecretValue` activity, and KMS evidence can explain encryption-key access when a secret read succeeds or fails.

At this point, the team has account structure, guardrails, cross-account access patterns, CloudTrail events, analyzer findings, last accessed data, credential reports, and secret metadata. The final piece is a review loop that turns all of that evidence into actual permission changes.

## The Review Loop
<!-- section-summary: A recurring access review turns evidence into owner decisions, narrower policies, disabled keys, removed trusts, and deleted stale roles. -->

An **access review** is a repeated check of who can access what and whether that access still has a clear owner and reason. It should produce decisions, not just dashboards. The payments company reviews access because teams change, vendors leave, pipelines move, emergency exceptions age, and old permissions keep working until someone removes them.

Different evidence belongs on different rhythms. High-risk changes need review before and after the work. Slower drift, such as unused roles and stale keys, can move through monthly or quarterly review. The rhythm should match the risk and the team's ability to act on findings.

| When | Evidence to collect | Decision to make |
|---|---|---|
| Before risky IAM changes | Current caller, planned policy diff, target account, expected CloudTrail events | Are we changing the intended account, role, and resource? |
| After a production access window | `AssumeRole`, policy-change, secret-read, and denied-request events | Should the exception path be removed or narrowed now? |
| Monthly | Active Access Analyzer findings, credential report changes, static keys, root and IAM user status | Which external access, passwords, and keys need an owner response? |
| Quarterly | Last accessed data, unused access findings, broad policies, old role trusts, SCP service usage | Which roles, permissions, or account guardrails can be narrowed? |

The review should name an owner for every accepted access path. If the vendor export role stays, the vendor owner, business reason, allowed account, allowed actions, and next review date should be visible. If nobody owns it, the access should move toward removal.

Cleanup works best in small reversible steps. A key can be deactivated before deletion. A role trust can be removed before the whole role disappears. A broad policy can lose one unused service before the team rewrites the entire permission set. CloudTrail and application owners can then confirm normal work still behaves as expected.

A good cleanup item is specific enough for a reviewer to understand. "Clean IAM" gives the team no decision. "Deactivate access key `AKIAIOSFODNN7EXAMPLE` for `backup-scanner`, observe for two business days, then delete it because CloudTrail shows no successful use since February and the scanner was retired" gives the team evidence, timing, and a clear next step.

Now the article can put the pieces back together as one operating model for the payments company. The parts matter most when they work together instead of drifting into separate security checklists.

![The operating loop connects guardrails to CloudTrail, Access Analyzer, credential reports, remediation, and regular review](/content-assets/articles/article-cloud-providers-aws-identity-security-account-guardrails/guardrails-evidence-operating-loop.png)

*The operating loop connects guardrails to CloudTrail, Access Analyzer, credential reports, remediation, and regular review.*


## Putting It All Together
<!-- section-summary: The final IAM operating model combines account structure, guardrails, cross-account roles, activity logs, access analysis, credential review, and recurring cleanup. -->

The payments company started with one production account and one receipt export function. As the system grew, the team split work across `payments-dev`, `payments-prod`, `tooling`, `security-log-archive`, and `engineer-lab`. That split gave the company better isolation, but it also created access paths that needed shared rules and shared evidence.

AWS Organizations gives the account map. The management account owns the organization and stays quiet. Member accounts hold workloads. OUs group production, development, security, tooling, and labs so the company can attach the right controls to the right branches.

SCPs set permission ceilings for member accounts. Region guardrails keep workloads in approved locations. CloudTrail guardrails protect activity logging. S3 Block Public Access policies reduce accidental public storage exposure. Root guardrails keep daily work away from the most powerful identity in each member account.

Cross-account roles let `tooling` deploy to `payments-prod` with temporary credentials instead of production access keys. Resource policies let `payments-prod` write selected audit objects into `security-log-archive` without receiving a whole session in the log archive account. SCPs still apply to member accounts after those cross-account paths are in use.

CloudTrail records who asked for what. `sts get-caller-identity` proves the active terminal session. Access Analyzer finds external access, internal access paths, and unused access. Last accessed data helps reviewers narrow permissions. Credential reports reveal active user passwords and keys. Secrets Manager metadata and CloudTrail events let reviewers inspect secret access without printing secret values.

The review loop turns evidence into change. Access stays when it has an owner, a reason, and a review date. Evidence can also show that a workflow needs less permission than it has today. Stale keys, role trusts, broad permissions, and vendor paths can move through reversible cleanup steps, then deletion after normal work proves the cleanup was safe.

Guardrails and access evidence make IAM manageable after AWS grows into a multi-account system. Guardrails keep each account inside company limits. Evidence helps the team prove which access exists, which request happened, and which old permission can leave.


---

**References**

- [Terminology and concepts for AWS Organizations](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_getting-started_concepts.html) - Explains organizations, management accounts, member accounts, roots, OUs, delegated administrators, and the recommendation to keep workloads out of the management account.
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) - Documents SCP permission ceilings, member-account scope, management-account exception, root-user coverage, service-linked role exception, rollout guidance, and last-accessed usage for SCP refinement.
- [SCP syntax](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html) - Describes SCP JSON elements, deny and allow behavior, condition usage, and Region restriction patterns.
- [Service control policy examples](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples.html) - Provides AWS examples for common SCP guardrails and guidance for testing SCPs before broad attachment.
- [AWS global condition context keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html) - Covers global condition keys such as `aws:RequestedRegion` and related policy-condition behavior.
- [Creating a trail for an organization](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/creating-trail-organization.html) - Explains organization trails, member-account copies, member-account modification limits, multi-Region behavior, and protected log destinations.
- [CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html) - Defines CloudTrail event fields such as `eventSource`, `eventName`, `sourceIPAddress`, request parameters, and error fields.
- [CloudTrail userIdentity element](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html) - Explains how CloudTrail represents IAM users, role sessions, federated users, AWS services, and session issuers.
- [get-caller-identity - AWS CLI Command Reference](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html) - Documents the caller identity response fields and permission behavior.
- [Delegate access across AWS accounts using IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/tutorial_cross-account-with-roles.html) - Shows cross-account role setup, trust, `sts:AssumeRole`, temporary credentials, and destination-account permissions.
- [Cross-account resource access in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies-cross-account-resource-access.html) - Compares cross-account roles with resource-based policies for sharing supported resources across accounts.
- [Amazon S3 policy syntax and examples](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_s3_syntax.html) - Documents organization-level S3 Block Public Access policy syntax and the four Block Public Access settings.
- [IAM Access Analyzer findings](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-findings.html) - Documents external access, internal access, and unused access finding families.
- [Refine permissions using last accessed information](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_last-accessed.html) - Describes service and action last accessed information, tracking limitations, Organizations reports, and the need to confirm success or denial in CloudTrail.
- [Generate credential reports](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_getting-report.html) - Documents credential report generation, CSV fields, IAM-managed credential coverage, report refresh behavior, passwords, MFA, and access key status fields.
- [GetSecretValue - AWS Secrets Manager API Reference](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html) - Documents secret retrieval, CloudTrail logging, sensitive response fields, and required `secretsmanager:GetSecretValue` plus `kms:Decrypt` permissions for customer-managed KMS keys.
