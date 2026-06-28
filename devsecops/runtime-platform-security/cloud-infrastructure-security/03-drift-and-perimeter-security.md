---
title: "Drift and Perimeter Security"
description: "Detect console changes, cloud drift, exposed network paths, and unauthorized perimeter changes after IaC review."
overview: "Start with a database rule changed in the console after a reviewed Terraform apply, then compare desired files, IaC state, and live cloud data. You will use drift plans, perimeter review, audit logs, and explicit revert, codify, or import decisions to bring production back under control."
tags: ["devsecops", "drift", "network-exposure", "cloud-security"]
order: 3
id: article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection
aliases:
  - drift-and-misconfiguration-detection
  - article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection
  - devsecops/cloud-infrastructure-security/drift-and-misconfiguration-detection.md
  - network-exposure-review
  - article-devsecops-cloud-infrastructure-security-network-exposure-review
  - devsecops/cloud-infrastructure-security/network-exposure-review.md
  - devsecops/cloud-infrastructure-security/03-drift-and-perimeter.md
  - devsecops/cloud-infrastructure-security/03-drift-and-perimeter
  - cloud-infrastructure-security/03-drift-and-perimeter
---

## Table of Contents

1. [The Console Change After Review](#the-console-change-after-review)
2. [Desired File, State, and Live Cloud](#desired-file-state-and-live-cloud)
3. [Finding Drift With Plans](#finding-drift-with-plans)
4. [Reviewing the Perimeter](#reviewing-the-perimeter)
5. [Audit Logs Explain Who Changed What](#audit-logs-explain-who-changed-what)
6. [Revert, Codify, or Import](#revert-codify-or-import)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)
9. [References](#references)

## The Console Change After Review
<!-- section-summary: Drift starts after live cloud changes bypass the reviewed infrastructure path that approved the intended design. -->

The Northstar customer portal passed its infrastructure review. Terraform created a private database security group, OPA checked the plan, the pull request merged, and the deployment role applied the change. The approved design was simple: the application security group can reach PostgreSQL on port `5432`, and the internet cannot.

Then an incident happens at 02:15. The portal cannot write payment records. The on-call engineer sees database connection timeouts and opens the cloud console during the outage. To debug quickly, they add a temporary database ingress rule from a broad source range. The service recovers. The incident queue moves on. The rule remains.

Here is the kind of rule the live cloud now has:

```hcl
resource "aws_security_group_rule" "database_debug" {
  type              = "ingress"
  security_group_id = aws_security_group.database.id
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
}
```

The HCL block shows the shape of the risky rule, even though the engineer created it in the console. `from_port` and `to_port` set PostgreSQL. `cidr_blocks = ["0.0.0.0/0"]` allows traffic from any IPv4 address. A production database rule with that source deserves immediate review.

**Drift** means the live cloud no longer matches the reviewed infrastructure code or the IaC state record. **Perimeter security** means checking the paths that decide who can reach a resource: security groups, firewall rules, route tables, public IPs, load balancers, storage public access, private endpoints, service endpoints, and metadata service settings.

The important lesson is practical. A pull request gate can prove the planned change was safe at apply time. It cannot prove the account stayed safe afterward. Drift and perimeter security handle the after part.

![Incident exposure path showing a break-glass console change opening database ingress from the internet and the safer target of application-only access](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/incident-exposure-path.png)

*The exposure path makes the incident concrete: a break-glass console change opens a database port, and the safe target is traffic from the application group only.*

To find and fix this cleanly, the team needs to compare three records.

## Desired File, State, and Live Cloud
<!-- section-summary: Drift detection compares the reviewed code, the IaC state mapping, and the actual cloud resource data. -->

IaC drift work uses three records. Beginners should keep them separate because each one answers a different question.

**Desired file** is the infrastructure code in the repository. For Terraform and OpenTofu, this means HCL files, modules, variables, provider settings, and reviewed policy choices. The desired file says what the team intends to run.

**State** is the IaC tool's record of managed resources. Terraform and OpenTofu use state to map a resource address such as `aws_security_group.database` to a real cloud object such as `sg-08abc123`. State also stores many attributes from the last read or apply.

**Live cloud** is what the provider API returns right now. It includes the actual security group rules, route tables, bucket policies, IAM attachments, database flags, public IPs, and audit events in the account, subscription, or project.

For the Northstar database, the three records disagree:

| Record | What it says |
|---|---|
| Desired file | Database accepts port `5432` from `aws_security_group.app.id` |
| State | Last Terraform apply recorded the reviewed security group |
| Live cloud | Console edit added port `5432` from `0.0.0.0/0` |

That disagreement is the drift. The approved design is still in Git. The live account has an extra path. A scheduled drift check, provider posture tool, or audit alert should bring that gap back to the team.

![Drift triangle showing Git code, IaC state, and live cloud compared together with audit logs explaining out-of-band changes](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/drift-triangle.png)

*The triangle shows why drift review compares Git code, IaC state, and the live cloud, then uses audit logs to explain the change.*

The first detection method is a plan that refreshes from the cloud.

## Finding Drift With Plans
<!-- section-summary: Refresh and plan commands compare managed resources with live provider data and produce reviewable drift evidence. -->

A **drift plan** is an IaC plan used to find changes made outside the normal IaC path. Terraform and OpenTofu ask providers for current live resource data, compare it with state and code, and report differences.

Northstar can run a scheduled drift check for Terraform like this:

```bash
terraform init
terraform plan -refresh-only -out=drift.tfplan -detailed-exitcode
terraform show -json drift.tfplan > drift.tfplan.json
```

`terraform init` prepares the backend, providers, and modules. `terraform plan -refresh-only` focuses on changes detected by reading live resources. `-out=drift.tfplan` saves the plan for review. `-detailed-exitcode` gives automation three useful outcomes: exit code `0` for no changes, `2` for detected changes, and `1` for an error. `terraform show -json` creates structured output for dashboards or policy checks.

OpenTofu uses the same workflow shape:

```bash
tofu init
tofu plan -refresh-only -out=drift.tfplan -detailed-exitcode
tofu show -json drift.tfplan > drift.tfplan.json
```

A drift finding for the incident might look like this:

```bash
Objects have changed outside of Terraform

  # aws_security_group.database has changed
  ~ resource "aws_security_group" "database" {
      ingress = [
        {
          from_port   = 5432
          to_port     = 5432
          protocol    = "tcp"
          cidr_blocks = ["0.0.0.0/0"]
          description = "temporary debug access"
        }
      ]
    }
```

The finding gives the team the first fact: the live security group changed outside the reviewed code path. It also names the resource and the risky field.

One caution belongs here. A refresh-only apply can update state to match live cloud data. That can help when the live change is legitimate and reviewed. It can also record an unsafe console edit as accepted state. For security drift, the team should investigate first, decide the right remediation, and then update state only when the reviewed decision calls for it.

Plan-based drift detection covers resources Terraform or OpenTofu already manages. It will miss unmanaged cloud objects. The team also needs perimeter review that looks directly at live exposure.

## Reviewing the Perimeter
<!-- section-summary: Perimeter review checks public and private reachability, provider posture findings, and metadata-service protections. -->

A **cloud perimeter** is the set of boundaries that control reachability. In the Northstar portal, public traffic should reach the load balancer. The load balancer should reach the application. The application should reach the database. Receipt storage should block public reads and accept access from approved identities.

Perimeter review starts with public exposure. Which resources can receive traffic from the internet? Which storage services allow public access? Which databases have public network access? Which public load balancers route to sensitive backends?

For AWS security groups, a focused query can find internet-wide ingress:

```bash
aws ec2 describe-security-groups \
  --filters Name=ip-permission.cidr,Values=0.0.0.0/0 \
  --query 'SecurityGroups[*].{GroupId:GroupId,GroupName:GroupName,Ingress:IpPermissions}'
```

`describe-security-groups` asks EC2 for security group data. The filter selects rules with `0.0.0.0/0`. The query trims the output to group ID, name, and ingress rules so the reviewer can inspect the exposure quickly.

Private reachability needs review too. A database rule that allows an entire VPC may still be too broad if many workloads live there. A safer database path references the application security group:

```hcl
resource "aws_security_group_rule" "database_from_app" {
  type                     = "ingress"
  security_group_id        = aws_security_group.database.id
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
}
```

`source_security_group_id` says the application tier can reach the database. It avoids broad network ranges and ties the network path to a workload group.

Provider posture tools add a live-account view. AWS Config can record configuration changes and evaluate rules. Azure Policy can audit or deny resource configurations in subscriptions and management groups. Google Cloud Security Command Center can surface misconfigurations, vulnerabilities, and risky exposure across projects. These tools inspect the current cloud account, including resources that IaC may not manage yet.

Metadata service settings also belong in perimeter review. Cloud metadata services can provide temporary credentials to workloads. On AWS EC2, IMDSv2 requires session-oriented requests and should be required for instances that use metadata:

```hcl
resource "aws_instance" "worker" {
  ami           = var.worker_ami
  instance_type = "t3.micro"

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
}
```

`http_tokens = "required"` requires IMDSv2 tokens. `http_put_response_hop_limit = 1` limits how far metadata responses can travel. These fields reduce the chance that an application flaw gives an attacker easy access to instance credentials.

The drift plan and perimeter review now show what changed. The audit logs explain who or what changed it.

## Audit Logs Explain Who Changed What
<!-- section-summary: Cloud audit logs connect drift findings to an identity, timestamp, API call, source, and incident record. -->

**Audit logs** are the provider's control plane record. They answer questions such as who called the API, when the call happened, what operation ran, which resource changed, which source IP made the request, and which parameters were sent.

AWS CloudTrail records management events such as `AuthorizeSecurityGroupIngress`, `PutBucketPolicy`, `CreateAccessKey`, and `AttachRolePolicy`. Azure Activity Log records subscription-level management operations. Microsoft Entra audit logs record identity and role activity. Google Cloud Audit Logs record admin activity and data access when those logs are enabled.

For the Northstar incident, the security team can look up the AWS event that authorized the database ingress:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress \
  --start-time 2026-06-20T00:00:00Z \
  --end-time 2026-06-21T00:00:00Z
```

`lookup-events` searches CloudTrail events. The lookup attribute selects the ingress API call. The start and end times narrow the search to the incident window.

A useful event record contains the actor, source IP, user agent, time, and request parameters:

```json
{
  "eventTime": "2026-06-20T02:21:17Z",
  "eventSource": "ec2.amazonaws.com",
  "eventName": "AuthorizeSecurityGroupIngress",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::111122223333:assumed-role/break-glass-network-admin/maya-dev"
  },
  "sourceIPAddress": "203.0.113.24",
  "userAgent": "console.amazonaws.com",
  "requestParameters": {
    "groupId": "sg-0dbportal",
    "ipPermissions": [
      {
        "ipProtocol": "tcp",
        "fromPort": 5432,
        "toPort": 5432,
        "ipRanges": [
          {
            "cidrIp": "0.0.0.0/0",
            "description": "temporary debug access"
          }
        ]
      }
    ]
  }
}
```

The event tells a concrete story. The role was `break-glass-network-admin`. The session name points to `maya-dev`. The user agent says the console made the change. The parameters show port `5432` from `0.0.0.0/0`. The team can compare that event with an incident ticket and an emergency access approval.

Audit logs should live in a security-controlled place with retention and restricted delete access. Many teams forward logs to a separate account, subscription, project, workspace, or SIEM. If a caller can change infrastructure and erase the logs in the same place, investigation evidence is too fragile.

Now the team has the resource, risk, actor, time, and API call. The final step is deciding what to do with the drift.

## Revert, Codify, or Import
<!-- section-summary: Every drift finding needs an explicit decision so live cloud, state, and reviewed code line up again. -->

A drift finding should end with a decision. The three common outcomes are **revert**, **codify**, and **import**.

**Revert** means the live change was unsafe, temporary, or unapproved. For the Northstar database rule, revert is the likely answer. The team removes the public ingress and applies the reviewed configuration:

```bash
terraform plan -out=revert.tfplan
terraform apply revert.tfplan
```

`terraform plan -out=revert.tfplan` previews the remediation and saves it. `terraform apply revert.tfplan` applies exactly that saved plan. The incident record should include the drift finding, audit event, risk, remediation command or pull request, and the time the exposure closed.

**Codify** means the live change was valid and should enter the reviewed design. A network migration might add a new private CIDR, or a new diagnostic endpoint might be approved during a maintenance window. The team should open a pull request, update Terraform or OpenTofu code, run scanners and policies, and record the reason.

**Import** means a live resource should be managed by IaC but is missing from state. During an incident, an engineer might create a log group, diagnostic bucket, or security group. The team can map that existing object into state and add matching code:

```bash
terraform import aws_cloudwatch_log_group.portal_incident /aws/ecs/customer-portal/incident-debug
terraform plan
```

`terraform import` connects the Terraform address to the existing cloud object. `terraform plan` checks whether the code and imported object match. Import is only the mapping step. The repository still needs the resource block, tags, retention, encryption, ownership, and policy checks.

OpenTofu supports the same remediation shape for imported resources:

```bash
tofu import aws_cloudwatch_log_group.portal_incident /aws/ecs/customer-portal/incident-debug
tofu plan
```

A short remediation record keeps the operational story attached to the technical fix:

```markdown
### Drift remediation record

- Resource: `aws_security_group.database`
- Finding: PostgreSQL ingress allowed from `0.0.0.0/0`
- Detected by: scheduled drift plan and AWS Config rule
- Actor: `break-glass-network-admin/maya-dev`
- Incident: `INC-4092`
- Decision: revert
- Remediation: Terraform apply restored application security group source
- Verification: follow-up drift plan returned no changes
- Follow-up: add break-glass expiry alert and database ingress policy test
```

This record gives future reviewers a clear answer: what changed, who changed it, why it was risky, how it was fixed, and what improved afterward.

## Putting It All Together
<!-- section-summary: A healthy drift program combines scheduled plans, live posture tools, audit evidence, and explicit remediation decisions. -->

Northstar now has a complete after-apply loop. IaC scanners and Policy as Code check the planned change before apply. Scheduled Terraform or OpenTofu drift checks compare managed resources with live cloud data. Provider tools such as AWS Config, Azure Policy, and Google Cloud Security Command Center inspect the real environment. Audit logs explain who made out-of-band changes. The remediation path decides whether to revert, codify, or import.

The database incident also improves operations. Emergency console changes need an incident ticket, a short-lived role session, and a follow-up drift check. Public ingress on production databases should alert the owning team. Metadata service settings should be part of VM and container baselines. Storage public access should be checked in IaC and in provider posture tools.

The practical value is that the team treats the repository as the approved design, state as the IaC mapping, live cloud as current reality, and audit logs as evidence. Security work then follows a steady loop: detect the gap, understand the change, close the exposure, and improve the process that allowed it.

![Drift review loop showing detection, audit log review, revert or codify or import decision, verification, and process improvement](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/drift-review-loop.png)

*The loop summarizes the response pattern: detect drift, check logs, choose whether to revert, codify, or import, then verify the account is clean.*

## What's Next
<!-- section-summary: The next article focuses on identity because every drift event came from a caller. -->

Drift investigation usually leads to identity questions. Who opened the rule? Which role allowed it? How long did the session last? Was it a human break-glass path, a workload role, or a deployment pipeline? Did the permission fit the job?

The final article in this module focuses on **Cloud Identity and Access Management** from a DevSecOps angle. It covers human federation, workload identity, CI/CD OIDC, least-privilege deployment roles, temporary elevation, break-glass access, access reviews, and the evidence teams need after a change.

## References

- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - Official Terraform documentation for planning, refresh behavior, saved plans, and `-detailed-exitcode`.
- [Terraform import command](https://developer.hashicorp.com/terraform/cli/import) - Official Terraform documentation for associating existing infrastructure with Terraform state.
- [Terraform state purpose](https://developer.hashicorp.com/terraform/language/state/purpose) - Official Terraform documentation explaining how state maps configuration to real infrastructure.
- [OpenTofu plan command](https://opentofu.org/docs/cli/commands/plan/) - Official OpenTofu documentation for planning and refresh behavior.
- [OpenTofu import command](https://opentofu.org/docs/cli/commands/import/) - Official OpenTofu documentation for importing existing infrastructure into state.
- [AWS Config Developer Guide](https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html) - Official AWS documentation for recording resource configuration and evaluating compliance.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Official AWS documentation for control plane audit logging.
- [AWS EC2 instance metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html) - Official AWS documentation for IMDSv2 and instance metadata configuration.
- [Azure Activity Log](https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/activity-log) - Official Microsoft documentation for Azure subscription-level management events.
- [Azure Policy overview](https://learn.microsoft.com/en-us/azure/governance/policy/overview) - Official Microsoft documentation for evaluating and enforcing Azure resource rules.
- [Google Cloud Audit Logs](https://cloud.google.com/logging/docs/audit) - Official Google Cloud documentation for admin activity, data access, system event, and policy denied audit logs.
- [Google Cloud Security Command Center overview](https://cloud.google.com/security-command-center/docs/concepts-security-command-center-overview) - Official Google Cloud documentation for posture findings and security risk visibility.
