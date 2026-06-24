---
title: "Detection Signals and Alert Triage"
description: "Use cloud logs, runtime alerts, scanner signals, SIEM events, and identity activity to identify security incidents early."
overview: "Signals are raw security evidence, alerts are signals that deserve attention, and triage is the first investigation that decides whether the team has an incident. This article follows a leaked deployment token from first alert to escalation."
tags: ["devsecops", "detection", "triage", "attck"]
order: 1
id: article-devsecops-incident-readiness-detection-signals-alert-triage
---

## Table of Contents

1. [Why Triage Exists](#why-triage-exists)
2. [Signals, Alerts, and Incidents](#signals-alerts-and-incidents)
3. [The Running Scenario](#the-running-scenario)
4. [Cloud and Identity Logs](#cloud-and-identity-logs)
5. [Runtime and Pipeline Signals](#runtime-and-pipeline-signals)
6. [Building a Triage View](#building-a-triage-view)
7. [Using MITRE ATT&CK](#using-mitre-attck)
8. [Severity and Escalation](#severity-and-escalation)
9. [A Small Triage Workflow](#a-small-triage-workflow)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Why Triage Exists
<!-- section-summary: Triage gives the team a short, disciplined investigation before a noisy alert turns into either closed noise or a real incident. -->

Security detection in a DevSecOps team usually starts with a messy queue. A scanner opens a secret alert, GuardDuty reports unusual cloud API activity, a Kubernetes audit log shows a service account creating pods, and the SIEM groups three logins from a new country. Each item may be harmless by itself, but the team still has to decide which one deserves action right now.

**Triage** is the first investigation step after an alert appears. The goal is to answer a small set of questions quickly: what happened, which identity or system was involved, what could that identity reach, whether the activity matches normal work, and whether someone needs to start the incident response runbook.

This matters because alert queues punish vague thinking. If every alert turns into a full incident, engineers burn out and the response channel fills with noise. If every alert waits until someone has spare time, a real attacker can keep using the access they found. Triage creates the middle step: enough evidence to make a confident first decision.

In production, detection also belongs to more than one team. Platform engineers understand deployment workflows, security engineers understand attacker behavior, service owners understand normal application traffic, and support teams may hear from customers first. A good triage process lets those people share one view of the evidence instead of arguing from separate dashboards.

## Signals, Alerts, and Incidents
<!-- section-summary: Signals are observations, alerts are prioritized observations, and incidents are confirmed or likely security events that need coordinated response. -->

A **signal** is a piece of security-relevant evidence. A CloudTrail event showing `UpdateAccessKey`, a GitHub secret scanning finding, a failed login burst, a suspicious container exec session, and a vulnerability scanner result are all signals. They say something happened, and the team may need to inspect it.

An **alert** is a signal that a rule, model, or person has promoted for attention. The alert might come from a SIEM correlation rule, a cloud threat detection service, an EDR product, a container runtime sensor, or GitHub Advanced Security. The alert adds a label, severity, owner, and reason so a human can work it.

An **incident** is a security event that needs coordinated response. The team may still have unknowns, but the evidence is strong enough to assign roles, preserve evidence, contain access, communicate status, and track decisions. Incident response is expensive by design because it changes systems under pressure.

| Term | Simple meaning | Example in a DevSecOps environment |
|---|---|---|
| **Signal** | Raw evidence from a system | CloudTrail records `ListBuckets` from an unfamiliar IP address |
| **Alert** | A signal selected for review | GuardDuty reports unusual API calls for an IAM user |
| **Case** | A triage workspace for related alerts | The SIEM groups GitHub, AWS, and Kubernetes activity by the same deploy identity |
| **Incident** | Confirmed or likely security event needing response | A leaked deployment key was used outside the pipeline and had production permissions |

That distinction keeps the queue useful. The analyst can say, "we have three signals in one case, and the case now meets the threshold for incident response." The language stays practical, and the team knows why the work moves from investigation into containment.

## The Running Scenario
<!-- section-summary: A leaked deployment token gives us one concrete story that starts with a scanner alert and grows into a cloud activity investigation. -->

We will use one scenario through this article and the next two articles in the module. The `checkout-api` service deploys to AWS from GitHub Actions. An older workflow still uses a long-lived IAM access key stored as GitHub Actions secrets named `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

During a late-night debug session, a developer commits a temporary `.env.deploy` file to a branch. GitHub secret scanning opens an alert because the file contains an AWS access key. The branch is deleted a few minutes later, but the secret scanning alert remains. Around the same time, CloudTrail records `GetCallerIdentity`, `ListBuckets`, and `ecr:GetAuthorizationToken` from an IP address that has never appeared in deployment logs.

That gives us a realistic triage problem. The secret scanning alert could be a token that was caught before use. The CloudTrail events could be the normal deployment workflow from a new runner range. They could also mean someone copied the key and started probing the account.

The first triage decision is therefore narrow and useful: does this look like a leaked deployment key being used outside the expected pipeline? If yes, the response team needs to contain the key and preserve the evidence. If no, the team can close the alert with a reason and tune detection if needed.

![Signal to case infographic showing a secret alert, CloudTrail probe, GuardDuty finding, and missing pipeline run grouped into one triage case](/content-assets/articles/article-devsecops-incident-readiness-detection-signals-alert-triage/signal-to-case.png)

_The timeline shows why the alert is a case: several separate signals point to the same key during the same short window._

## Cloud and Identity Logs
<!-- section-summary: Cloud and identity logs answer who called which API, from where, at what time, and with which credential. -->

Cloud and identity logs are usually the strongest first evidence because attackers and automation both need identities. A cloud API call names the principal, the action, the target service, the source IP address, the user agent, the request time, and often the access key or role session involved.

In AWS, **CloudTrail** records account activity for many AWS API calls. For a deployment-key investigation, the most useful fields are `eventTime`, `eventName`, `eventSource`, `userIdentity`, `sourceIPAddress`, `userAgent`, `awsRegion`, `errorCode`, and the request parameters. Those fields help the analyst separate a normal GitHub Actions deployment from a strange interactive probe.

Here is a small CloudTrail lookup shape an analyst might use during triage:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIAEXAMPLEDEPLOYKEY \
  --start-time 2026-06-22T21:00:00Z \
  --end-time 2026-06-22T23:00:00Z \
  --query 'Events[].{time:EventTime,name:EventName,source:EventSource,user:Username}'
```

That command asks CloudTrail for events tied to one access key during a tight window. The output gives the first timeline: which APIs were called, when they were called, and which identity name AWS associated with them. The analyst still needs the full event JSON for source IP, user agent, and request details, but the timeline starts here.

GitHub adds another identity layer. The organization audit log can show repository setting changes, secret scanning events, workflow changes, environment changes, and access changes. For this scenario, the triage view should include the commit that introduced the secret, the secret scanning alert, any push protection bypass, workflow file changes, and any deployment environment approvals near the same time.

Kubernetes audit logs may also matter when the deployment key can reach a cluster. A Kubernetes audit event can show that a service account created a pod, read a secret, or executed into a workload. The useful fields look similar: user, verb, resource, namespace, source IP, and response status. The naming changes, but the triage question stays the same: which identity did what, to which resource, from where?

## Runtime and Pipeline Signals
<!-- section-summary: Runtime, scanner, and pipeline signals add context around the same identity so the team can see whether cloud activity affected workloads. -->

CloudTrail tells us about cloud API calls. It may not show what happened inside the application after those calls. That is where runtime, pipeline, and scanner signals help. They show whether a suspicious credential led to a changed deployment, a strange container, a new image pull, or a secret exposure in source control.

For the leaked deployment key scenario, the first scanner signal is the GitHub secret scanning alert. Secret scanning detects supported secret patterns in repositories and opens alerts for review. Push protection can stop supported secrets before they land in the repository, and a bypass event deserves triage because it means a person deliberately allowed the push to continue.

The pipeline adds more context. A deployment workflow should leave run IDs, commit SHAs, actor names, environment approvals, artifacts, and deployment logs. If CloudTrail says `deploy-bot-prod` called `lambda:UpdateFunctionCode`, the pipeline logs should show a matching workflow run for the same commit and time window. A cloud API call with no matching workflow run deserves escalation because the deploy identity acted outside its expected path.

Runtime tools then answer whether workloads changed or behaved strangely. GuardDuty may report suspicious AWS activity. A container runtime sensor may report a shell process inside a production container. Kubernetes audit logs may show `create pods/exec` or `get secrets`. Application logs may show admin endpoints hit from a new IP range. Each signal adds a small tile to the same picture.

Here is a practical triage table for the running case:

| Source | Signal | Why it matters |
|---|---|---|
| GitHub secret scanning | AWS access key found in `.env.deploy` | A deploy credential may have left the secrets store |
| GitHub audit log | Branch push and secret alert at 21:42 UTC | Links the exposure to a repository, actor, and commit |
| CloudTrail | `GetCallerIdentity` from unfamiliar IP | Often the first probe after someone obtains a cloud key |
| CloudTrail | `ecr:GetAuthorizationToken` | The caller may be checking container registry access |
| Pipeline logs | No matching production workflow run | The deploy identity acted outside the normal deployment path |
| GuardDuty | Unusual API activity finding | A cloud-native detector agrees the activity deserves review |

No single row proves the whole story. Together, the rows justify moving from alert review to incident response because the exposed credential appears to have been used.

## Building a Triage View
<!-- section-summary: A triage view joins events by identity, time, source, and resource so the analyst can work from one timeline instead of six dashboards. -->

A triage view is a small investigation workspace. It can live in a SIEM, a case management tool, a spreadsheet during a tabletop exercise, or a ticket template. The important part is that it joins related evidence around a few stable fields: identity, credential, source IP, user agent, resource, time, and environment.

For this scenario, the main join key is the access key ID. The second join key is the deployment identity name, such as `deploy-bot-prod`. The third join key is time because the secret alert and the cloud API calls happened within minutes. Those keys let the analyst pull a compact timeline from noisy logs.

![Triage workspace infographic showing repo events, cloud logs, and cluster audit evidence joined by identity, time, source IP, and resource before close or escalate decisions](/content-assets/articles/article-devsecops-incident-readiness-detection-signals-alert-triage/triage-workspace.png)

_The workspace turns separate dashboards into one small investigation board, so the analyst can explain the escalation decision clearly._

A CloudTrail Lake or Athena-style query might look like this:

```sql
SELECT
  eventTime,
  eventSource,
  eventName,
  userIdentity.userName,
  userIdentity.accessKeyId,
  sourceIPAddress,
  userAgent,
  errorCode
FROM cloudtrail_events
WHERE userIdentity.accessKeyId = 'AKIAEXAMPLEDEPLOYKEY'
  AND eventTime BETWEEN TIMESTAMP '2026-06-22 21:00:00'
                  AND TIMESTAMP '2026-06-22 23:00:00'
ORDER BY eventTime ASC;
```

The query is small on purpose. A first triage query should create a clear timeline before it tries to answer every question. After the analyst sees the first events, they can expand the window, search by source IP, search by user agent, and check whether the same caller touched production data.

The case record should capture the current answer to five questions:

| Question | Example answer for `checkout-api` |
|---|---|
| **What triggered review?** | GitHub secret scanning found an AWS key in a branch |
| **Which identity is involved?** | IAM user `deploy-bot-prod`, access key ending `7FQ9` |
| **What can it reach?** | ECR push/pull, Lambda update, CloudWatch logs, some S3 read permissions |
| **What evidence shows use?** | CloudTrail API calls from an unfamiliar IP with no matching workflow run |
| **What is the first decision?** | Escalate to incident response and contain the key |

This record also protects the team from memory drift. During a live incident, people join late, chat moves fast, and early assumptions can survive after new evidence disproves them. A written triage view gives the team a shared starting point.

## Using MITRE ATT&CK
<!-- section-summary: MITRE ATT&CK gives the team shared names for suspicious behavior so alerts can be grouped by attacker objective. -->

**MITRE ATT&CK** is a public knowledge base of adversary tactics and techniques. A tactic describes the attacker's objective, such as initial access, credential access, discovery, persistence, or exfiltration. A technique describes a common way attackers try to reach that objective.

ATT&CK helps triage because it turns scattered alert names into behavior. A secret scanning alert, a cloud `GetCallerIdentity` call, and a container registry token request can all fit one story: a credential may have been exposed, the caller checked whether it worked, and the caller explored what the credential could access.

For our leaked deployment key scenario, the mapping could look like this:

| Evidence | ATT&CK-style behavior | Triage use |
|---|---|---|
| AWS access key in source control | **Unsecured Credentials** | Treat the key as exposed and identify every place it exists |
| API calls with the deploy key | **Valid Accounts** | Check whether a real credential was used by an unexpected caller |
| `ListBuckets`, `GetAuthorizationToken` | **Discovery** | Look for resource enumeration after the first access check |
| New credentials, roles, or policies | **Account Manipulation** | Search for persistence after initial use |
| Large object reads or unusual downloads | **Exfiltration** | Check whether the incident touched sensitive data |

The mapping should stay lightweight. The analyst can keep the first ten minutes focused on the main behavior instead of forcing every event into a perfect taxonomy. The value is shared language: "this case has exposed credentials, valid account use, and discovery." That sentence helps the incident commander understand the shape of the risk.

ATT&CK also helps detection coverage after the incident. If the team only detected the leaked key through secret scanning, they can add detections for valid-account use from new infrastructure, suspicious discovery commands, and account manipulation. The later hardening article turns that idea into owner-tracked work.

## Severity and Escalation
<!-- section-summary: Severity combines confidence, blast radius, business impact, and response urgency instead of relying on the alert label alone. -->

An alert label is a starting point. A "high" alert on a lab repository may need a ticket. A "medium" alert involving a production deploy key may need an incident bridge. Severity should combine the confidence of compromise with the blast radius of the identity and the importance of the affected system.

For the running scenario, the confidence increases because multiple independent sources agree. GitHub found the key in source control. CloudTrail shows the key used after exposure. The source IP and user agent do not match the normal deployment pattern. The pipeline has no matching workflow run.

The blast radius also matters. A deploy key that can only update a staging demo has a limited path. A deploy key that can update production Lambda code, read container images, or pull logs from customer workflows creates a wider response. The analyst should look up permissions early because severity depends on what the credential could do, not only what it already did.

Here is a simple severity guide for credential-related triage:

| Severity | Good fit | Example |
|---|---|---|
| **SEV4 / Low** | Exposed test secret with no cloud access and no use evidence | Dummy key found in a training repo |
| **SEV3 / Medium** | Real secret exposed, no use evidence yet, limited environment | Staging API token committed and rotated quickly |
| **SEV2 / High** | Real production credential exposed and used, limited data impact evidence | Deploy key used from unfamiliar IP for discovery calls |
| **SEV1 / Critical** | Confirmed data access, destructive action, persistence, or customer impact | Production data copied or infrastructure changed by the attacker |

The first escalation needs enough certainty to act, and the team can downgrade later if evidence supports that decision. The response runbook can begin with containment and evidence preservation while deeper scoping continues. That keeps the team from waiting for perfect certainty while a credential may still be useful to an attacker.

## A Small Triage Workflow
<!-- section-summary: A repeatable triage workflow keeps the first investigation focused on evidence, scope, ownership, and the escalation decision. -->

A practical triage workflow starts with the alert and expands only as far as the decision requires. The analyst records the trigger, confirms whether the signal points to a real asset, enriches the identity and permissions, builds the first timeline, checks for matching normal activity, and then closes or escalates the case.

For the leaked deployment key, the workflow could look like this:

1. The analyst opens the GitHub secret scanning alert and records the repository, branch, commit SHA, file path, alert time, and secret type.
2. The analyst identifies the AWS access key owner and checks whether the key belongs to a production deployment identity.
3. The analyst queries CloudTrail for the key around the exposure time and notes every API call, source IP, Region, and user agent.
4. The analyst compares the CloudTrail timeline with GitHub Actions workflow runs and deployment approvals for the same service.
5. The analyst checks GuardDuty, Kubernetes audit logs, ECR activity, and application logs for related events within the same time window.
6. The analyst writes the first decision: close as contained false alarm, continue as a security case, or escalate to incident response.

The workflow should produce a short case note with the trigger, the evidence, the current severity, the systems at risk, the decision, and the next owner. The note lets the response team start from facts instead of repeating the same searches. It also gives late joiners a clean way to catch up.

For a real on-call shift, the analyst should be able to run a small evidence sequence before writing that note. The exact tools will vary by company, but the sequence below shows the shape. It creates a case folder, captures the GitHub alert metadata, pulls the cloud timeline for the exposed key, lists nearby deployment runs, and leaves the raw files ready for the response team.

```bash
CASE_ID="IR-2026-0622-checkout-api"
REPO="devpolaris/checkout-api"
ACCESS_KEY_ID="AKIAEXAMPLEDEPLOYKEY"
START="2026-06-22T20:30:00Z"
END="2026-06-22T23:30:00Z"

mkdir -p "evidence/$CASE_ID"

gh api \
  "/repos/$REPO/secret-scanning/alerts?state=open" \
  > "evidence/$CASE_ID/github-secret-alerts.json"

aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=AccessKeyId,AttributeValue="$ACCESS_KEY_ID" \
  --start-time "$START" \
  --end-time "$END" \
  --output json \
  > "evidence/$CASE_ID/cloudtrail-access-key.json"

gh run list \
  --repo "$REPO" \
  --created "$START..$END" \
  --json databaseId,displayTitle,event,headSha,status,conclusion,workflowName,createdAt,url \
  > "evidence/$CASE_ID/github-runs.json"
```

Those three files give the responder a grounded start. The responder can compare cloud API activity with repository alerts and workflow runs instead of switching between dashboards and trying to remember what they saw.

Here is a compact triage note format:

```markdown
## Triage Note

Alert: GitHub secret scanning found an AWS access key in devpolaris/checkout-api
Identity: IAM user deploy-bot-prod, access key ending 7FQ9
Evidence of use: CloudTrail shows GetCallerIdentity, ListBuckets, and ecr:GetAuthorizationToken from 203.0.113.44
Normal activity check: No GitHub Actions production workflow run matches the CloudTrail time window
Known access: Production deploy permissions for Lambda, ECR, and CloudWatch Logs
Decision: Escalate as SEV2 credential exposure with evidence of use
Next owner: Incident commander starts deployment-token runbook
```

That note is enough to move. The next article takes the same case into incident response and runbook execution.

## Putting It All Together
<!-- section-summary: Effective triage connects scanner alerts, cloud logs, identity context, runtime evidence, and a clear escalation threshold. -->

Detection starts with signals, but the team needs triage to turn those signals into decisions. A scanner finding, a CloudTrail event, a GuardDuty finding, a Kubernetes audit record, and a pipeline log all describe small parts of the same environment. Triage connects those parts around identity, time, source, and resource.

The leaked deployment key scenario shows why this matters. GitHub secret scanning found the exposed key. CloudTrail showed the key being used. Pipeline logs showed no matching deployment run. GuardDuty added cloud-native suspicion. Those pieces together justified a SEV2 incident response even before the team knew the full blast radius.

The habit to build is simple and concrete. Start with the alert, name the identity, check what it can reach, build a small timeline, compare against normal automation, and write the escalation decision. That workflow gives the response team a useful handoff instead of a vague warning.

![Detection triage loop infographic showing collect signals, group case, build timeline, score severity, and escalate or close around a leaked deploy key](/content-assets/articles/article-devsecops-incident-readiness-detection-signals-alert-triage/detection-triage-loop.png)

_The summary loop shows triage as a repeatable handoff process, not a one-off hunt through logs._

## What's Next
<!-- section-summary: The next article takes the escalated leaked-token case into containment, evidence preservation, credential rotation, recovery, and communication. -->

The triage case has crossed the response threshold. A production deployment credential was exposed, and the evidence shows activity outside the expected pipeline. The next step is coordinated incident response.

The next article follows the same `checkout-api` case through a runbook: who takes which role, how evidence is preserved, how the key is contained, how credentials are rotated, how the service recovers, and how the team communicates without losing the timeline. That gives the triage handoff a practical response path.

---

**References**

- [NIST SP 800-61 Rev. 3: Incident Response Recommendations and Considerations for Cybersecurity Risk Management](https://csrc.nist.gov/pubs/sp/800/61/r3/final) - Frames incident response as part of the wider CSF 2.0 risk management lifecycle.
- [CISA Federal Government Cybersecurity Incident and Vulnerability Response Playbooks](https://www.cisa.gov/resources-tools/resources/federal-government-cybersecurity-incident-and-vulnerability-response-playbooks) - Provides standardized playbook ideas for identifying, coordinating, remediating, recovering, and tracking mitigations.
- [MITRE ATT&CK Enterprise Matrix](https://attack.mitre.org/matrices/enterprise/) - Gives shared tactic and technique names for suspicious behavior across enterprise, cloud, SaaS, and container platforms.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Explains CloudTrail account activity records and event history.
- [Amazon GuardDuty User Guide](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html) - Describes GuardDuty threat detection for AWS environments.
- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) - Documents GitHub's secret detection workflow and alerting.
- [GitHub organization audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization) - Explains organization audit log access and event review.
- [Kubernetes auditing](https://kubernetes.io/docs/tasks/debug/debug-cluster/audit/) - Documents Kubernetes audit events, audit policy, and audit levels.
