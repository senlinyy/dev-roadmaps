---
title: "Drift and Perimeter Security"
description: "Detect cloud configuration drift, exposed network paths, and unauthorized console changes."
overview: "Drift and perimeter security compares reviewed infrastructure code with the live cloud environment, then closes exposed paths, investigates unauthorized changes, and brings the account back under code."
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

1. [After the Gate, the Cloud Keeps Moving](#after-the-gate-the-cloud-keeps-moving)
2. [Desired State, State Files, and Live Cloud](#desired-state-state-files-and-live-cloud)
3. [The Incident That Opens a Door](#the-incident-that-opens-a-door)
4. [Finding Drift With Plans](#finding-drift-with-plans)
5. [Reviewing the Perimeter](#reviewing-the-perimeter)
6. [Audit Logs Explain Who Changed What](#audit-logs-explain-who-changed-what)
7. [Revert, Codify, or Import](#revert-codify-or-import)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## After the Gate, the Cloud Keeps Moving
<!-- section-summary: Passing IaC and policy checks proves the planned change was reviewed, while drift checks prove the live account still matches that review. -->

The previous article focused on Policy as Code. The team wrote rules, ran them against the plan, and blocked risky infrastructure before apply. That is a strong gate, and it solves a real problem. A pull request can prove that a planned database subnet, storage bucket, IAM role, or firewall rule passed review before the cloud provider created it.

The live cloud account still needs attention after the merge. Engineers can click in the console during an incident. Old scripts can call cloud APIs directly. A vendor tool can create resources outside Terraform. A provider default can change. An attacker with stolen credentials can add a network path. Those changes may never pass through the pull request gate.

**Drift** means the live environment no longer matches the reviewed infrastructure code or the recorded IaC state. **Perimeter security** means checking the paths that decide who can reach a resource: public IPs, load balancers, route tables, firewall rules, storage public access, private endpoints, and metadata service settings. Together, drift and perimeter checks answer a practical question: does production still look like the safe design the team approved?

This article follows the Northstar customer portal again. The team already added IaC scanning and Policy as Code. Now an incident creates a manual console change, and the team needs to detect it, understand it, and bring the account back under code.

## Desired State, State Files, and Live Cloud
<!-- section-summary: Drift detection compares the code, the IaC state record, and the actual resources returned by cloud APIs. -->

Before we investigate the incident, we need a clear definition of the three records involved in IaC operations.

**Desired state** is the infrastructure written in the repository. For Terraform or OpenTofu, this is the HCL code that says what the team intends to run. Desired state includes resources, variables, modules, providers, and policy choices that reviewers approved.

**State** is the IaC tool's record of the real resources it manages. Terraform and OpenTofu use state to map a resource address such as `aws_security_group.database` to the real cloud object ID such as `sg-08abc123`. State also stores many resource attributes from the last read or apply.

**Live cloud** is the current configuration returned by cloud provider APIs. It includes the actual security group rules, bucket settings, route tables, IAM policies, public IPs, database flags, and audit logs at this moment.

Drift shows up when these records disagree. The code may say the database accepts traffic only from the application security group. The live cloud may say port 5432 accepts traffic from `0.0.0.0/0`. The state file may still remember the older safe rule until the next refresh. That gap is exactly where security risk hides.

![Drift triangle showing Git code, IaC state, and live cloud compared together with audit logs explaining out-of-band changes](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/drift-triangle.png)

*The triangle shows why drift review compares Git code, IaC state, and the live cloud, then uses audit logs to explain the change.*

The Northstar team can use the same production scenario from earlier articles. The customer portal has a web front door, private application tasks, a private database, and a receipt storage bucket. The safe design is clear: internet traffic reaches the load balancer, the load balancer reaches the app, the app reaches the database, and customer data storage blocks public access.

Now the incident changes that clean picture.

## The Incident That Opens a Door
<!-- section-summary: Manual emergency changes often solve a short-term outage and leave a long-term exposure if nobody closes the loop. -->

At 02:15, the on-call engineer receives an alert: the customer portal cannot write payment records. The application logs show database connection timeouts. The deployment pipeline is already busy with a locked state file, and the support queue is growing. Under pressure, the engineer opens the cloud console and edits the database security group to allow PostgreSQL from a broad IP range while they debug.

Here is the kind of risky rule that appears during incidents:

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

The engineer did not add this exact HCL to the repository. The rule was created in the console, so the pull request gate never saw it. IaC scanners did not run. OPA did not check it. A reviewer did not ask why the production database needs internet exposure. The outage ends, the engineer moves to the next incident, and the database path remains open.

This is a very normal production failure shape. The on-call engineer restored service, and the missing closeout loop created the security risk. Emergency changes need time limits, audit evidence, drift checks, and a decision: revert the change, codify the change, or import a new managed resource. Without that loop, a temporary workaround turns into a quiet production exposure.

![Incident exposure path showing a break-glass console change opening database ingress from the internet and the safer target of application-only access](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/incident-exposure-path.png)

*The exposure path makes the incident concrete: a break-glass console change opens a database port, and the safe target is traffic from the application group only.*

The first step is finding the drift.

## Finding Drift With Plans
<!-- section-summary: Refresh and plan commands let teams compare live cloud resources with the IaC state and reviewed code. -->

Terraform and OpenTofu read live cloud objects during planning. A normal plan refreshes state, compares it with code, and proposes changes. A **refresh-only plan** focuses on changes made outside the IaC workflow. It asks the provider for live values and reports objects that changed since the last apply.

The Northstar team can run a drift check like this:

```bash
terraform init
terraform plan -refresh-only -out=drift.tfplan -detailed-exitcode
terraform show -json drift.tfplan > drift.tfplan.json
```

OpenTofu has the same general shape:

```bash
tofu init
tofu plan -refresh-only -out=drift.tfplan -detailed-exitcode
tofu show -json drift.tfplan > drift.tfplan.json
```

The `-detailed-exitcode` option helps automation. Exit code `0` means no diff, exit code `2` means the plan found changes, and exit code `1` means the command failed. A scheduled job can treat exit code `2` as "someone needs to review drift."

A drift finding for the incident might read like this in the plan output:

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

This finding gives the team the first fact: the live security group changed outside the reviewed code path. It also gives the exact resource that needs investigation.

There is one important caution. A refresh-only apply can update state to match the live cloud. That is useful for recording legitimate live changes, but it can also record an unsafe console edit as the new state. For security drift, the team should investigate first and decide the safe remediation before recording the live change as accepted state.

Plan-based drift detection works well for resources managed by Terraform or OpenTofu. It does not see every unmanaged resource in the account. The team also needs provider-native tools that inspect the live perimeter directly.

## Reviewing the Perimeter
<!-- section-summary: Perimeter review checks public paths, private paths, metadata settings, and provider findings that IaC state may miss. -->

A **cloud perimeter** is the set of boundaries that control reachability. In a customer portal, the public edge might be a CDN, load balancer, API gateway, or public IP. The private side might include subnets, route tables, security groups, network ACLs, private endpoints, service endpoints, database firewall rules, and storage public access settings.

The Northstar team reviews the perimeter in layers. The first layer is public exposure. Which resources can receive traffic from the internet? Which storage resources allow public reads? Which databases have public network access? Which load balancers route to sensitive services? These checks catch the obvious doors.

For AWS security groups, a focused query can find rules that allow traffic from the whole internet:

```bash
aws ec2 describe-security-groups \
  --filters Name=ip-permission.cidr,Values=0.0.0.0/0 \
  --query 'SecurityGroups[*].{GroupId:GroupId,GroupName:GroupName,Ingress:IpPermissions}'
```

The second layer is private reachability. A private IP range can still be too broad. A database rule that allows the whole VPC may give every workload a path to the database. A better rule references the application security group:

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

This rule says the application tier can reach the database. It avoids a broad private CIDR and follows workload identity at the network layer.

The third layer is cloud provider posture tooling. AWS Config can record resource configuration changes and evaluate managed or custom rules. Azure Policy can evaluate resource compliance and deny or audit deployments. Google Cloud Security Command Center can surface misconfigurations, vulnerabilities, and risky exposure across projects. These tools matter because they inspect the live cloud account, including resources that IaC may not manage yet.

The fourth layer is metadata service protection. In cloud VMs and containers, the metadata service can provide temporary credentials to the running workload. That is useful, but it can increase blast radius when a vulnerable application can reach metadata endpoints. On AWS EC2, IMDSv2 requires session-oriented requests and should be required for instances that use metadata:

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

The perimeter review now has two kinds of evidence: IaC drift from the plan and provider findings from the live account. The next question is who made the change.

## Audit Logs Explain Who Changed What
<!-- section-summary: Cloud audit logs connect drift findings to an identity, timestamp, API call, source, and incident record. -->

**Audit logs** are the cloud provider's record of control plane API activity. In AWS, CloudTrail records management events such as `AuthorizeSecurityGroupIngress`, `PutBucketPolicy`, `CreateAccessKey`, and `AttachRolePolicy`. Azure Activity Log and Google Cloud Audit Logs provide similar control plane evidence for their platforms.

For the Northstar incident, the security team needs to know whether the database rule came from the on-call engineer, a script, a third-party tool, or an attacker. CloudTrail can show the API event:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress \
  --start-time 2026-06-20T00:00:00Z \
  --end-time 2026-06-21T00:00:00Z
```

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

This record gives the team a concrete investigation path. The role name says a break-glass role was used. The session name points to a human identity. The user agent says the console made the change. The parameters show the exact public ingress rule. The team can now compare the event with an incident ticket and an emergency access request.

Audit logs should be protected like production evidence. Mature teams send cloud audit logs to a separate security account or project, restrict delete permissions, add retention, and alert on attempts to disable logging. If an attacker can change infrastructure and delete the logs in the same account, the investigation loses its strongest evidence.

Now the team knows what changed and who changed it. The final decision is how to reconcile the environment.

## Revert, Codify, or Import
<!-- section-summary: Every drift finding needs an explicit remediation decision so the live account and reviewed code line up again. -->

A drift finding should not sit in a dashboard forever. The team needs a triage path. The three common outcomes are **revert**, **codify**, and **import**.

**Revert** means the live change was unsafe, temporary, or unapproved. For the Northstar database rule, revert is the likely answer. The team removes the public ingress rule and applies the reviewed configuration again:

```bash
terraform plan -out=revert.tfplan
terraform apply revert.tfplan
```

The incident record should include the drift finding, the CloudTrail event, the risk, the command or pull request that restored the safe state, and the time the exposure closed.

**Codify** means the live change was valid and should become part of the reviewed design. For example, the company might have moved from one private CIDR to another during a network migration. The engineer made the console edit during a maintenance window, and the change was safe. The team should open a pull request that updates the Terraform code, runs IaC scanning and policy checks, and records the reason.

**Import** means the live account contains a resource that IaC should manage but does not currently know about. During the incident, an engineer might create a temporary log group, security group, or diagnostic storage bucket. The team can import the resource into state, add matching code, and review it:

```bash
terraform import aws_cloudwatch_log_group.portal_incident /aws/ecs/customer-portal/incident-debug
terraform plan
```

Import is only the mapping step. The repository still needs the resource block, tags, retention, encryption, ownership, and policy checks. A resource imported into state without reviewed code remains hard for humans to understand.

A practical remediation checklist looks like this:

```markdown
### Drift remediation record

- Resource: `aws_security_group.database`
- Finding: PostgreSQL ingress allowed from `0.0.0.0/0`
- Detected by: scheduled drift plan and AWS Config rule
- Actor: `break-glass-network-admin/maya-dev`
- Incident: `INC-4092`
- Decision: revert
- Remediation: Terraform apply restored app security group source
- Verification: follow-up drift plan returned no changes
- Follow-up: add break-glass expiry alert and database ingress policy test
```

This record is short, but it connects the technical fix to the operational story. It tells future reviewers why the change existed, how the team closed it, and what they improved afterward.

## Putting It All Together
<!-- section-summary: A healthy drift program combines scheduled checks, provider posture tools, audit evidence, and explicit remediation decisions. -->

The Northstar team now has a complete loop. IaC scanners and Policy as Code check the planned change before apply. Scheduled Terraform or OpenTofu drift checks compare managed resources with the live cloud account. Provider tools such as AWS Config, Azure Policy, and Security Command Center inspect the real environment and find unmanaged exposure. Audit logs explain who made each out-of-band change. The remediation process decides whether to revert, codify, or import.

The database incident also improves the team's operating habits. Emergency console changes need an incident ticket, a role session with a short expiry, and a follow-up drift check. Public ingress findings should page the owning team when they touch production databases or customer data paths. Metadata service settings should be part of VM and container baseline review. Storage public access checks should run in both IaC and provider posture tools.

This is the practical value of drift and perimeter security. The team does not pretend the repository is the whole truth. It treats the repository as the approved design, the state file as the IaC mapping, the cloud account as the current reality, and audit logs as the evidence trail. Security work then follows a steady loop: detect the gap, understand the change, close the exposure, and update the process that allowed it.

![Drift review loop showing detection, audit log review, revert or codify or import decision, verification, and process improvement](/content-assets/articles/article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection/drift-review-loop.png)

*The loop summarizes the response pattern: detect drift, check logs, choose whether to revert, codify, or import, then verify the account is clean.*

## What's Next
<!-- section-summary: The next article focuses on identity because most cloud changes come from a human, workload, or pipeline principal. -->

Drift investigation usually leads to identity questions. Who opened the rule? Which role allowed it? How long did the session last? Was it a human break-glass path, a workload role, or a deployment pipeline? Did the permission fit the job?

The final article in this module focuses on **Cloud Identity and Access Management** from a DevSecOps angle. It covers human federation, workload access, CI/CD OIDC, least-privilege deployment roles, temporary elevation, break-glass access, access reviews, and the evidence teams need after a change.

---

**References**

- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - Official Terraform documentation for planning, refresh behavior, and `-detailed-exitcode`.
- [Terraform import command](https://developer.hashicorp.com/terraform/cli/import) - Official Terraform documentation for associating existing infrastructure with Terraform state.
- [OpenTofu plan command](https://opentofu.org/docs/cli/commands/plan/) - Official OpenTofu documentation for planning and refresh behavior.
- [AWS Config Developer Guide](https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html) - Official AWS documentation for recording resource configuration and evaluating compliance.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Official AWS documentation for control plane audit logging.
- [AWS EC2 instance metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html) - Official AWS documentation for IMDSv2 and instance metadata configuration.
- [Azure Policy overview](https://learn.microsoft.com/en-us/azure/governance/policy/overview) - Official Microsoft documentation for evaluating and enforcing Azure resource rules.
- [Google Cloud Security Command Center overview](https://cloud.google.com/security-command-center/docs/concepts-security-command-center-overview) - Official Google Cloud documentation for posture findings and security risk visibility.
