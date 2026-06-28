---
title: "Incident Response and Runbooks"
description: "Respond to a confirmed suspicious signal with roles, evidence preservation, containment, credential rotation, recovery, and communication."
overview: "A confirmed suspicious signal turns triage into coordinated response. This article continues the leaked deployment key case through incident roles, communication, decision records, evidence preservation, containment, credential rotation, recovery, and a practical runbook shape."
tags: ["devsecops", "incident-response", "runbooks", "containment"]
order: 2
id: article-devsecops-compliance-incident-readiness-incident-response-and-runbooks
---

## Table of Contents

1. [A Confirmed Suspicious Signal](#a-confirmed-suspicious-signal)
2. [The Running Incident](#the-running-incident)
3. [Roles and Communication](#roles-and-communication)
4. [Severity and Decision Records](#severity-and-decision-records)
5. [Evidence Preservation](#evidence-preservation)
6. [Containment](#containment)
7. [Credential Rotation](#credential-rotation)
8. [Recovery and Verification](#recovery-and-verification)
9. [Communication](#communication)
10. [A Runbook Shape](#a-runbook-shape)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)
13. [References](#references)

## A Confirmed Suspicious Signal
<!-- section-summary: A runbook turns incident response from improvised chat into a clear sequence of roles, evidence, actions, checks, and communication. -->

The triage analyst has a confirmed suspicious signal. GitHub secret scanning found a production AWS deployment key in a branch, CloudTrail showed the key being used from an unfamiliar IP address, and no matching GitHub Actions workflow run explained the activity. That is enough to start incident response.

**Incident response** is coordinated work during a security event. The team preserves evidence, limits damage, removes attacker access, restores trusted service, communicates status, and records decisions. It is part engineering, part investigation, and part calm coordination.

A **runbook** is the written path for that work. It names the roles, the first checks, the containment steps, the verification steps, and the communication points. The runbook should be specific enough that an on-call engineer can act under pressure, while still leaving space for incident commander judgment when the facts change.

NIST SP 800-61 Rev. 3 and CISA-style playbooks give DevSecOps teams useful structure for this moment. They connect response to preparation, trained roles, evidence handling, recovery paths, and follow-up that improves the system after the incident. That wider view matches how real teams operate under pressure.

## The Running Incident
<!-- section-summary: The leaked deployment key case now has enough evidence for a response bridge, a contained scope, and a first working theory. -->

Our service is still `checkout-api`. The production deployment workflow uses a long-lived AWS access key stored in GitHub Actions secrets. A developer accidentally committed the key to a branch, and GitHub secret scanning opened an alert. CloudTrail later showed `GetCallerIdentity`, `ListBuckets`, and `ecr:GetAuthorizationToken` from an unfamiliar IP address.

At this moment, the response team has a **working theory**: a production deployment credential leaked through source control and was used outside the expected GitHub Actions deployment path. A working theory is a short explanation that guides the next checks. It must change when evidence changes.

The initial scope is also clear enough to act. The involved identity is `deploy-bot-prod`. The likely affected systems are GitHub, AWS IAM, ECR, Lambda deployment paths, CloudWatch Logs, and possibly any Kubernetes or runtime system that trusts the deployment pipeline. The first goal is to stop further use of the key while preserving the evidence needed to understand what happened.

The team should expect two workstreams to run at the same time. One workstream contains the threat by disabling or replacing access. The other workstream scopes impact by reading logs, checking deployments, and identifying touched resources. A runbook keeps those streams aligned.

## Roles and Communication
<!-- section-summary: Clear response roles reduce duplicate work because each person knows whether they are coordinating, investigating, changing systems, or communicating status. -->

Response gets confusing fast when everyone tries to help in the same channel. A small incident can still involve security, platform, application, legal, support, and leadership. The first runbook step should assign roles so people know how to help.

The **incident commander** owns coordination. This person tracks severity, decisions, owners, and the next checkpoint. A strong incident commander can be a coordinator with enough technical context to keep the response moving and enough discipline to stop side conversations from hiding important decisions.

The **security investigator** owns evidence and scoping. This person pulls CloudTrail, GuardDuty, GitHub audit logs, secret scanning details, and runtime logs. They keep track of what is known, what is unknown, and which assumptions need proof.

The **service owner** understands `checkout-api` and the deployment path. This person knows what normal deployment looks like, which releases are safe, which logs prove a successful recovery, and which customers or internal teams depend on the service.

The **platform responder** makes controlled changes to shared systems. This can include IAM key deactivation, GitHub secret removal, workflow disabling, environment protection changes, or OIDC role setup. The platform responder should write every change into the decision log because response changes often happen outside the normal pull request rhythm.

The **scribe** records the timeline, decisions, commands, links, and owners. In smaller teams, the incident commander may also scribe, but the role still matters. A good incident record reduces repeated questions and gives the post-incident review real evidence.

![Response bridge infographic showing incident commander, security lead, platform responder, and scribe feeding a shared decision log](/content-assets/articles/article-devsecops-compliance-incident-readiness-incident-response-and-runbooks/response-bridge.png)

_The role map keeps the response channel useful because each person owns a different part of coordination, investigation, change, or evidence capture._

## Severity and Decision Records
<!-- section-summary: Severity guides urgency, while decision records explain what the team changed and why they changed it at that moment. -->

The leaked deployment key starts as a likely SEV2 because a production credential was exposed and used. The team has no confirmed customer data access yet, and there is no evidence of destructive change. The severity can rise if logs show data access, persistence, malware, or customer impact.

Severity should drive response rhythm. A SEV2 may need a live bridge, a fifteen- or thirty-minute update cadence, service owner involvement, and leadership awareness. A SEV1 usually adds executive, legal, privacy, customer support, and possibly regulator-facing workflows depending on what data and jurisdictions are involved.

The **decision record** is the response team's memory. It should capture the time, decision, owner, evidence, and expected effect. Containment decisions can be disruptive. Disabling a production deploy key may pause emergency deployments, but leaving a used key active gives the attacker more time.

Here is a useful decision record shape:

| Time | Decision | Evidence | Owner | Verification |
|---|---|---|---|---|
| 22:18 UTC | Disable access key ending `7FQ9` | CloudTrail shows use from unfamiliar IP | Platform responder | `ListAccessKeys` shows key is inactive |
| 22:22 UTC | Disable production deploy workflow temporarily | Workflow still references leaked key | Service owner | GitHub workflow status shows disabled |
| 22:45 UTC | Replace deployment path with OIDC role | Static key cannot be trusted | Platform responder | Test deployment assumes scoped role |
| 23:10 UTC | Keep severity at SEV2 | No data reads or resource changes found so far | Incident commander | Next scope check at 23:40 UTC |

The table is simple, and that is the point. During an incident, the decision log should be easy to scan. A future reviewer should be able to see the reasoning without hunting through chat history.

## Evidence Preservation
<!-- section-summary: Evidence preservation captures logs and metadata before containment or retention windows remove the details investigators need. -->

Evidence preservation means collecting and protecting the records that explain what happened. The team should do this before destructive cleanup where possible. For a credential incident, useful evidence includes the secret scanning alert, the commit metadata, GitHub audit events, workflow run logs, CloudTrail events, GuardDuty findings, IAM policy details, container registry events, deployment logs, and application access logs.

The first evidence set should be narrow and fast. The analyst can export a two-hour CloudTrail window around the exposure, save the secret scanning alert URL and metadata, record the affected access key ID, and capture the current IAM policies attached to `deploy-bot-prod`. That gives the response team a stable snapshot before access changes.

A CloudTrail lookup can create the first event bundle:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIAEXAMPLEDEPLOYKEY \
  --start-time 2026-06-22T20:30:00Z \
  --end-time 2026-06-22T23:30:00Z \
  --output json > evidence/cloudtrail-deploy-key-2026-06-22.json
```

`AccessKeyId` ties the export to the leaked credential. The three-hour window includes the secret exposure, the first suspicious cloud calls, and the containment decision. `--output json` keeps the event bundle machine-readable, so the investigator can later filter by source IP, user agent, API name, and Region without rerunning the original search.

The team should store evidence in a controlled location, such as an incident bucket or case system with restricted access. The storage should have write-once or versioned behavior when available, because responders need confidence that the records were not quietly edited. The incident record should also avoid pasting secret values into chat or tickets.

Evidence collection should include permissions, because blast radius depends on what the key could do. For an IAM user, that means attached managed policies, inline policies, group memberships, access key metadata, and recent CloudTrail activity. If the identity can assume roles, the trust and permission path matters too.

```bash
aws iam list-attached-user-policies --user-name deploy-bot-prod
aws iam list-user-policies --user-name deploy-bot-prod
aws iam list-groups-for-user --user-name deploy-bot-prod
aws iam list-access-keys --user-name deploy-bot-prod
```

These commands give the investigator a permission inventory that the response team can use while deciding containment and scoping. Attached policies show managed permissions, inline policies show custom permissions, group membership can add inherited access, and access-key metadata shows which keys exist and whether they are active. The full incident still needs timeline review, impact checks, and recovery verification.

## Containment
<!-- section-summary: Containment stops the attacker path while preserving enough service capability for recovery and investigation. -->

**Containment** is the work that stops the suspicious access path from continuing. In this incident, the exposed key is the immediate path. The team should deactivate the key, stop workflows that still depend on it, and remove the secret from GitHub so future jobs cannot use it accidentally.

The safest first AWS action is usually key deactivation. Deactivation stops API calls that use the key while keeping the key record available for investigation. Deletion can come later after the team finishes evidence collection and verifies the replacement path.

```bash
aws iam update-access-key \
  --user-name deploy-bot-prod \
  --access-key-id AKIAEXAMPLEDEPLOYKEY \
  --status Inactive

aws iam list-access-keys --user-name deploy-bot-prod
```

`update-access-key` changes the known leaked key to `Inactive`, which blocks new API calls that use it. `list-access-keys` should then show the same key ID with `Status` set to `Inactive`. The team keeps the key record for investigation until the evidence review is complete.

The GitHub side should remove the stored secret and pause the workflow that expects it. This prevents the next deployment run from failing in a confusing way or reintroducing a replacement static key under pressure.

```bash
gh secret delete AWS_ACCESS_KEY_ID --repo devpolaris/checkout-api
gh secret delete AWS_SECRET_ACCESS_KEY --repo devpolaris/checkout-api
gh workflow disable deploy-production.yml --repo devpolaris/checkout-api
```

The two `gh secret delete` commands remove the stored AWS key names from the repository. `gh workflow disable` pauses the production deployment workflow that still expects those static secrets. A responder should verify the result with `gh secret list` and `gh workflow list` before marking containment complete.

Containment also includes checking for persistence. The attacker may have created a new access key, added an IAM policy, changed a role trust policy, created a GitHub deploy key, altered a workflow file, or added a new Kubernetes secret. The response team should search for changes made by `deploy-bot-prod` and by any related GitHub actor around the same time window.

The containment step should end with a clear statement: the known leaked key is inactive, the workflow using it is disabled, no replacement static key has been created, and the team is searching for secondary access paths. If any of those statements fails, the incident stays in active containment.

The responder can turn that statement into evidence with a short verification bundle. The bundle keeps containment tied to records instead of chat memory.

```bash
CASE_ID="IR-2026-0622-checkout-api"
REPO="devpolaris/checkout-api"
USER_NAME="deploy-bot-prod"
ACCESS_KEY_ID="AKIAEXAMPLEDEPLOYKEY"

mkdir -p "evidence/$CASE_ID/containment"

aws iam list-access-keys \
  --user-name "$USER_NAME" \
  > "evidence/$CASE_ID/containment/access-keys-after-disable.json"

aws iam get-access-key-last-used \
  --access-key-id "$ACCESS_KEY_ID" \
  > "evidence/$CASE_ID/containment/access-key-last-used.json"

gh secret list \
  --repo "$REPO" \
  > "evidence/$CASE_ID/containment/github-actions-secrets-after-delete.txt"

gh workflow list \
  --repo "$REPO" \
  > "evidence/$CASE_ID/containment/github-workflows-after-pause.txt"
```

The incident commander can attach these files to the case and write one sentence: "The exposed key is inactive, the old GitHub secrets are absent, and the production workflow is paused while replacement credentials are tested." The evidence makes that sentence reviewable.

## Credential Rotation
<!-- section-summary: Rotation replaces the unsafe access path with a trusted path, and modern deployment workflows should move from long-lived keys to short-lived OIDC sessions. -->

**Credential rotation** means replacing secret material that may have been exposed. For static access keys, rotation often means creating a new key, updating consumers, verifying the new key, and deleting the old key. During a confirmed exposure, the team should prefer removing the static-key pattern entirely when the platform supports it.

For GitHub Actions deploying to AWS, **OpenID Connect**, usually shortened to OIDC, is the better deployment path. OIDC lets a workflow request a short-lived identity token from GitHub. AWS trusts that token through an IAM role, and AWS STS returns temporary credentials for that one job. The workflow receives credentials for minutes or hours instead of storing a long-lived key in GitHub secrets.

A production workflow shape can look like this:

```yaml
name: deploy-production

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
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::123456789012:role/checkout-api-production-deploy
          aws-region: us-east-1
      - run: ./scripts/deploy-production.sh
```

The `id-token: write` permission is important because GitHub only issues the OIDC token to jobs that request that permission. The AWS role trust policy then checks which repository, branch, or environment is allowed to assume the role. The production environment gives the workflow an approval boundary before the role can be used.

The rotation plan should also narrow permissions. The old key may have broad rights because it grew over time. The new role should start with the actions the deployment actually needs, such as pushing to one ECR repository, updating one Lambda function or ECS service, and reading only the logs needed for verification.

## Recovery and Verification
<!-- section-summary: Recovery restores the deployment path only after containment, replacement credentials, and service checks prove the system is trusted again. -->

**Recovery** means returning the service and deployment process to a trusted operating state. For `checkout-api`, recovery is more than turning the workflow back on. The team needs to prove the new deployment path works, the old key cannot be used, the deployed artifact is expected, and no suspicious changes remain.

The service owner should verify the production application first. That includes health checks, error rates, latency, authentication behavior, recent deployment version, and customer-facing workflows. If the attacker had permission to update code or images, the team should compare the running artifact digest or Lambda version with the expected release artifact.

The platform responder should verify the credential path:

```bash
aws iam get-access-key-last-used --access-key-id AKIAEXAMPLEDEPLOYKEY
aws iam list-access-keys --user-name deploy-bot-prod
aws sts get-caller-identity
```

The first command helps check the last recorded use of the old key. The second confirms the key status. The third should be run inside the recovered workflow or deployment environment. A healthy result should show the assumed role ARN for `checkout-api-production-deploy`, which proves the job is using the intended role identity instead of a leftover static key.

The team should run one controlled deployment through the new path. A small no-op or safe patch release is useful because it tests GitHub environment approval, OIDC token issuance, AWS role assumption, deployment permissions, and post-deploy verification. The run ID, commit SHA, role session name, and CloudTrail events should go into the incident record.

Recovery also includes monitoring after the change. The team can keep temporary high-signal alerts active for the next 24 to 72 hours: any use attempt for the old access key, any `deploy-bot-prod` activity, any failed `AssumeRoleWithWebIdentity`, any production deploy outside the environment path, and any data access from the unfamiliar IP.

![Contain rotate recover infographic showing evidence preservation, key deactivation, secret removal, OIDC role migration, and deploy verification](/content-assets/articles/article-devsecops-compliance-incident-readiness-incident-response-and-runbooks/contain-rotate-recover.png)

_The path shows why containment and recovery belong together: the unsafe key leaves, the trusted deployment path replaces it, and verification proves the service can operate again._

## Communication
<!-- section-summary: Incident communication gives each audience the right facts, uncertainty, owner, and next update without exposing secrets or speculation. -->

Communication during incident response should be factual and audience-specific. Engineers need commands, logs, owners, and decisions. Leaders need severity, user impact, risk, timeline, and next update time. Support teams need customer-facing status if customers may notice an effect. Legal and privacy teams need early awareness if sensitive data may have been accessed.

For the running case, an internal update could say that a production deployment credential was exposed in source control, suspicious cloud API calls were observed, the key has been deactivated, the production deploy workflow is temporarily paused, and scoping is underway. That update gives real facts without publishing secret values or naming an attacker before the team has evidence.

A useful update format is:

```markdown
Incident: checkout-api leaked deployment credential
Severity: SEV2
Current status: Contained known key, scoping for secondary access and impact
Customer impact: No confirmed customer impact at this checkpoint
Actions completed: Key deactivated, GitHub secrets removed, workflow paused, CloudTrail evidence preserved
Current work: IAM change review, deployment artifact verification, OIDC replacement path
Next update: 23:30 UTC
```

External communication requires extra care. A team should involve legal, privacy, communications, and customer support before sending customer-facing statements. The response channel can prepare the facts, but notification obligations depend on data type, contract terms, jurisdiction, and confirmed impact.

## A Runbook Shape
<!-- section-summary: A practical runbook names triggers, owners, containment actions, recovery checks, communication points, and exit criteria. -->

A runbook should be short enough to use during pressure and specific enough to avoid guesswork. For a leaked deployment credential, the runbook can be written around the exact systems involved: GitHub, AWS IAM, CloudTrail, GuardDuty, deployment workflows, and the application runtime.

Here is a production-ready shape the team could keep in the incident repository or response platform:

```markdown
# Runbook: Leaked Deployment Credential

## Trigger
- Secret scanning alert for a production deployment credential
- CloudTrail or SIEM evidence that the credential was used outside expected automation
- Manual report that a deployment secret appeared in source, logs, chat, or an artifact

## First roles
- Incident commander
- Security investigator
- Service owner
- Platform responder
- Scribe

## First evidence
- Secret scanning alert metadata
- Commit, branch, actor, and file path
- CloudTrail events for the access key or role session
- GitHub audit events and workflow runs
- Current IAM permissions and key metadata

## Containment
- Deactivate the exposed access key
- Remove GitHub secrets that store the key
- Disable workflows that still require the static key
- Search for new keys, policy changes, deploy keys, workflow changes, and role trust changes

## Recovery
- Replace static key use with an OIDC role or another short-lived credential path
- Run a controlled deployment through the trusted path
- Verify service health, deployed artifact identity, and CloudTrail role session events
- Keep temporary detections for old-key use and unusual deployment actions

## Exit criteria
- Known leaked key is inactive or deleted after evidence preservation
- No unexplained production changes remain
- Deployment path works through trusted short-lived credentials
- Impact assessment is documented
- Post-incident hardening actions have owners and dates
```

The runbook gives responders a safe default path while preserving room for judgment. During a real incident, the incident commander can skip, add, or reorder steps when the evidence demands it, and every change should land in the decision record.

## Putting It All Together
<!-- section-summary: Response succeeds when the team coordinates roles, preserves evidence, contains access, restores trust, and records every important decision. -->

The leaked deployment key started as a triage case and turned into a response because the evidence showed real use. The runbook gave the team a path: assign roles, set severity, preserve logs, deactivate the key, remove GitHub secrets, pause the unsafe workflow, replace the credential path, verify recovery, and communicate status.

This flow is practical DevSecOps work. It connects security evidence to engineering action. It respects production risk because containment can affect deployments, and it respects investigation quality because evidence can disappear after cleanup.

The strongest response habit is to keep every important action tied to evidence and verification. If the key was disabled, the team records the command and confirms the key state. If the workflow moved to OIDC, the team records the run ID and confirms the CloudTrail role session. If severity stays at SEV2, the team records why the current evidence supports that decision.

![Runbook shape infographic showing trigger, roles, evidence, containment, recovery, and exit criteria between alert and trusted state](/content-assets/articles/article-devsecops-compliance-incident-readiness-incident-response-and-runbooks/runbook-shape.png)

_The summary runbook gives responders a safe default path while still leaving room for evidence-driven judgment during the incident._

## What's Next
<!-- section-summary: The next article uses the same incident record to turn recovery lessons into durable controls, detections, reviews, and practice. -->

Recovery closes the urgent part of the incident. The same incident still showed weaknesses in credential design, secret prevention, deployment permissions, log correlation, and response readiness. The team turns those weaknesses into the hardening backlog.

The next article turns the incident record into hardening work. We will take the timeline, root causes, and decisions from this leaked deployment key case and convert them into preventive controls, detection rules, access reviews, verification checks, and tabletop practice.

## References

- [NIST SP 800-61 Rev. 3: Incident Response Recommendations and Considerations for Cybersecurity Risk Management](https://csrc.nist.gov/pubs/sp/800/61/r3/final) - Provides current NIST incident response recommendations aligned with CSF 2.0.
- [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework) - Organizes incident work across Detect, Respond, and Recover outcomes.
- [CISA Federal Government Cybersecurity Incident and Vulnerability Response Playbooks](https://www.cisa.gov/resources-tools/resources/federal-government-cybersecurity-incident-and-vulnerability-response-playbooks) - Describes standardized incident and vulnerability response procedures.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Documents AWS account activity records and event history.
- [Manage access keys for IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html) - Explains IAM access keys, monitoring recommendations, and key management.
- [Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) - Explains AWS STS temporary credentials.
- [Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) - Shows how GitHub Actions can access AWS through OIDC without long-lived AWS secrets.
- [GitHub secret scanning REST API](https://docs.github.com/en/rest/secret-scanning/secret-scanning) - Documents API workflows for retrieving and updating secret scanning alerts.
- [Amazon GuardDuty User Guide](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html) - Describes AWS threat detection signals used during response.
