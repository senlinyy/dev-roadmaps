---
title: "Ownership and Evidence"
description: "Map team accountability to sensitive systems and collect audit trails that prove secure delivery happened."
overview: "Build an evidence trail for one production change using named owners, CODEOWNERS, branch rules, CI logs, scan outputs, image provenance, deployment records, and access reviews."
tags: ["devsecops", "ownership", "evidence", "audit"]
order: 3
id: article-devsecops-security-foundations-security-ownership-in-devops
aliases:
  - security-ownership-in-devops
  - article-devsecops-security-foundations-security-ownership-in-devops
  - devsecops/security-foundations/security-ownership-in-devops.md
  - audit-logs-and-evidence
  - article-devsecops-security-foundations-audit-logs-and-evidence
  - devsecops/security-foundations/audit-logs-and-evidence.md
  - devsecops/security-foundations/03-ownership-and-evidence.md
  - devsecops/security-foundations/03-ownership-and-evidence
  - security-foundations/03-ownership-and-evidence
---

## Table of Contents

1. [The Delivery Trail](#the-delivery-trail)
2. [Sensitive Systems Need Named Owners](#sensitive-systems-need-named-owners)
3. [CODEOWNERS Routes the Review](#codeowners-routes-the-review)
4. [Branch Rules Turn Ownership Into a Gate](#branch-rules-turn-ownership-into-a-gate)
5. [CI Logs Show the Change Survived the Pipeline](#ci-logs-show-the-change-survived-the-pipeline)
6. [Scan Outputs Show Security Checks Ran](#scan-outputs-show-security-checks-ran)
7. [Image Digests and Provenance Connect Source to Artifact](#image-digests-and-provenance-connect-source-to-artifact)
8. [Deployment Records Connect Artifact to Production](#deployment-records-connect-artifact-to-production)
9. [Access Reviews Keep the Owner List Honest](#access-reviews-keep-the-owner-list-honest)
10. [Build One Audit Packet](#build-one-audit-packet)
11. [Common Gaps Teams Fix Early](#common-gaps-teams-fix-early)
12. [References](#references)

## The Delivery Trail
<!-- section-summary: Ownership says who must care about a system, and evidence records what happened during a production change. -->

Imagine a small health technology company called Harbor Clinic. The team runs a service called **Patient Reminder API**, which sends SMS appointment reminders and reads patient phone numbers from a production database. The service sounds small. It touches private customer data, production infrastructure, and a vendor integration that can send real messages to real people.

Now imagine a production change called `CHG-2026-0417`. The change fixes a retry bug that sent duplicate reminder messages during a vendor outage. The fix touches application code, the deployment workflow, and one Kubernetes deployment in production, so the team needs a clear answer to a simple audit question: **who approved this change, what checks ran, what artifact shipped, and who had production access at the time?**

That question introduces two ideas. **Ownership** means a named person or team accepts accountability for a system, path, workflow, or environment. **Evidence** means durable records that show what happened, such as pull request reviews, required checks, scan reports, image digests, provenance attestations, deployment logs, and access review records.

This article follows one delivery trail from source code to production. We will map the Patient Reminder API to accountable teams, route the pull request to those teams, enforce merge gates, collect CI and security evidence, bind the built image back to the source commit, record the deployment, and package the proof into a small audit packet.

| Delivery step | Main question | Evidence Harbor Clinic keeps |
|---|---|---|
| System ownership | Who owns this sensitive system? | Service catalog row, CODEOWNERS entries, team membership export |
| Pull request review | Did the right people review the change? | PR URL, approvals, review timestamps, branch rule result |
| Pipeline execution | Did the required checks pass? | CI run ID, logs, test report, security scan outputs |
| Artifact build | Which exact image did CI build? | Image digest, SBOM, provenance attestation |
| Production deploy | Which artifact reached production? | Deployment record, environment approval, Kubernetes rollout output |
| Access review | Who could approve or deploy at that time? | GitHub team membership, environment reviewers, audit log export |

NIST Secure Software Development Framework, usually called **SSDF**, gives teams a shared vocabulary for this kind of work. It describes practices for preparing people and processes, protecting code, producing well-secured software, and responding to vulnerabilities. Harbor Clinic still has to make those practices real, and the delivery trail gives the team records it can show during an incident review, customer security review, or internal audit.

![Ownership review routing infographic showing a sensitive system mapped to ownership records, CODEOWNERS, and required service, security, and SRE reviewers](/content-assets/articles/article-devsecops-security-foundations-security-ownership-in-devops/ownership-review-routing.png)

*Ownership starts as a named system record, then CODEOWNERS turns that record into the reviewers required for sensitive changes.*

## Sensitive Systems Need Named Owners
<!-- section-summary: A sensitive system needs a named owner before a team can prove the right people reviewed its changes. -->

A **sensitive system** is any system where a mistake can harm customers, leak private data, move money, break production, or weaken security controls. The Patient Reminder API qualifies because it reads patient contact data and sends messages through a third-party SMS provider. The deployment workflow also qualifies because it can push new code into production.

A beginner-friendly way to think about ownership is this: every sensitive thing needs a team that can answer for it. The owner does the daily care work, reviews risky changes, keeps runbooks current, participates in incidents, and explains why a control exists. Ownership also gives security teams a practical place to send questions, because "the platform repo" says almost nothing, while "`@harbor/reminder-owners` owns `/services/reminder-api/`" gives everyone a real path.

Real teams usually keep the ownership map in more than one place. A service catalog gives humans a readable view of the system, CODEOWNERS routes code review, branch rules enforce merge gates, and on-call schedules show who responds after deployment. Those records should agree with each other, because an auditor or incident lead will compare them during a serious review.

Here is a small ownership record for the Patient Reminder API. The team can store this in a service catalog, a repository file, or an internal platform database; the important part is that the record names the system, the sensitive data, the repository paths, the production environment, and the accountable teams.

```yaml
systems:
  patient-reminder-api:
    description: "Sends appointment reminder messages from production patient contact data."
    repository: "harbor-clinic/platform"
    production_environment: "prod-reminders"
    sensitive_data:
      - "patient_phone_number"
      - "appointment_time"
      - "sms_delivery_status"
    code_paths:
      - "services/reminder-api/"
      - ".github/workflows/deploy-reminder.yml"
      - "infra/prod/reminder/"
    owners:
      service: "@harbor/reminder-owners"
      security: "@harbor/security-champions"
      production: "@harbor/sre-prod"
    change_risk: "customer-data-production"
```

This record does two jobs. First, it tells engineers who to bring into a change before the pull request reaches production. Second, it gives the audit packet a stable source for "this system has these accountable teams," instead of relying on memory or a chat message.

The ownership map gives us the names. The next step puts those names directly into the code review path so GitHub can request the right reviewers.

## CODEOWNERS Routes the Review
<!-- section-summary: CODEOWNERS connects repository paths to accountable teams so GitHub can request the right reviewers on pull requests. -->

**CODEOWNERS** is a GitHub file that maps repository paths to GitHub users or teams. When a pull request changes a matching path, GitHub requests review from the matching owners. For example, a change under `services/reminder-api/` can automatically request `@harbor/reminder-owners` instead of waiting for the author to remember the right people.

The CODEOWNERS file usually lives at `.github/CODEOWNERS`, although GitHub also supports a file at the repository root or in `docs/`. GitHub evaluates the file by pattern, and the last matching pattern takes precedence for a changed file. In real production repos, teams usually put broad rules near the top and narrow, sensitive rules later so the sensitive path wins.

Here is the CODEOWNERS file Harbor Clinic uses for the Patient Reminder API. The paths line up with the ownership record we just wrote, so the service, workflow, and production infrastructure all route to named teams.

```
/.github/CODEOWNERS @harbor/platform-security
/.github/workflows/deploy-reminder.yml @harbor/platform-security @harbor/sre-prod
/services/reminder-api/ @harbor/reminder-owners @harbor/security-champions
/infra/prod/reminder/ @harbor/sre-prod @harbor/platform-security
```

There are a few quiet details hiding in that small file. The CODEOWNERS file itself has an owner, because changing ownership rules changes who can approve sensitive code later. The deployment workflow has platform security and production SRE owners, because editing the workflow can weaken the delivery path even if the application code stays the same.

The service path names both the service team and the security champion team. In GitHub, a CODEOWNERS match can request multiple owners, and a branch protection rule can require a code owner review before merge. If Harbor Clinic needs one approval from the service team and one separate approval from production or security, the team combines CODEOWNERS with branch rules that require multiple approvals and keeps that policy written down in the change standard.

For `CHG-2026-0417`, the pull request touches these files. That mix matters because the change affects application behavior and the workflow that can deploy it.

```
services/reminder-api/src/retry-scheduler.ts
services/reminder-api/test/retry-scheduler.test.ts
.github/workflows/deploy-reminder.yml
```

GitHub requests `@harbor/reminder-owners`, `@harbor/security-champions`, `@harbor/platform-security`, and `@harbor/sre-prod`. That request gives the team the first useful evidence: the pull request shows which owners GitHub requested, who approved, who requested changes, and which commit they reviewed.

CODEOWNERS handles routing. The next problem is enforcement, because a requested review only helps if the repository requires the review before the change can merge.

## Branch Rules Turn Ownership Into a Gate
<!-- section-summary: Branch protection and rulesets enforce review, status checks, and deployment controls before sensitive changes merge. -->

**Branch protection** and **rulesets** are GitHub controls that define what must happen before changes can enter important branches such as `main`. A branch rule can require a pull request, require approvals, require review from code owners, require passing status checks, block force pushes, and restrict who can push directly. A ruleset gives organizations a broader way to apply similar rules across branches, tags, or repositories.

A useful way to read the setup is to split routing from enforcement. CODEOWNERS answers "who should look at this path?" Branch rules answer "what conditions must pass before GitHub accepts the merge?" Harbor Clinic needs both, because a production audit packet should show the right people saw the change and the platform enforced the required path.

For the Patient Reminder API, the `main` branch rule has this shape. The exact screen or API can change over time, but the control intent should stay clear in the team's standard.

| Control | Harbor Clinic setting | Evidence to keep |
|---|---|---|
| Pull request required | Every change to `main` comes through a PR | PR URL and merge commit |
| Approvals required | At least two approving reviews | Review list with timestamps |
| Code owner review required | Matching CODEOWNERS path must approve | Code owner review status |
| Status checks required | `test`, `dependency-review`, `codeql`, `container-scan`, `build-image` | Check run IDs and logs |
| Branch must be current | PR branch must include latest `main` before merge | Merge queue or strict status check result |
| Direct pushes blocked | Only the merge path updates `main` | Branch protection or ruleset export |

This table matters because GitHub settings can drift. A repository admin can change a branch rule, a team can rename a status check, or a new workflow can skip a required job by accident. The audit packet should keep either a ruleset export, a branch protection export, or a signed change record that points to the active repository rule at the time of merge.

Harbor Clinic can capture the current rule with the GitHub CLI. Some repositories use classic branch protection, while others use rulesets, so the team records the one it actually uses.

```bash
CHANGE_ID=CHG-2026-0417
mkdir -p "evidence/$CHANGE_ID/repository-controls"

gh api repos/harbor-clinic/platform/branches/main/protection \
  > "evidence/$CHANGE_ID/repository-controls/main-branch-protection.json"

gh api repos/harbor-clinic/platform/rulesets \
  > "evidence/$CHANGE_ID/repository-controls/repository-rulesets.json"
```

A useful packet keeps a focused snapshot of the repository controls that mattered for this production change. It should prove that the repo required review and checks before the merge. That is the bridge between ownership and the automated delivery evidence we collect next.

## CI Logs Show the Change Survived the Pipeline
<!-- section-summary: CI evidence shows which automated checks ran, which commit they tested, and whether the required jobs passed. -->

**CI**, or continuous integration, is the automated system that builds, tests, and checks code after a pull request changes. A CI log is useful evidence because it ties a commit SHA to actual work: install dependencies, run unit tests, run integration tests, build the artifact, and publish machine-readable results. The log also shows the runner, timestamp, workflow name, and job outcome.

For Harbor Clinic, the retry fix has a simple risk. A duplicate reminder bug can annoy patients and create support tickets, so the test evidence should show the retry scheduler handles vendor failures correctly. The CI run should also show the workflow came from the protected repository path instead of a local laptop or an untracked manual command.

Here is a trimmed workflow for the Patient Reminder API. The full production workflow would have more setup, and this version still shows the evidence shape: every job runs on the pull request commit, every important result lands as a job outcome or artifact, and the later build job exposes the image digest.

```yaml
name: reminder-service-ci

on:
  pull_request:
    paths:
      - "services/reminder-api/**"
      - ".github/workflows/deploy-reminder.yml"
      - "infra/prod/reminder/**"

permissions:
  contents: read
  packages: write
  security-events: write
  id-token: write
  attestations: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
        working-directory: services/reminder-api
      - run: npm test -- --runInBand --reporter=junit
        working-directory: services/reminder-api
      - uses: actions/upload-artifact@v4
        with:
          name: reminder-test-results
          path: services/reminder-api/junit.xml

  build-image:
    runs-on: ubuntu-latest
    needs: test
    outputs:
      digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: build
        uses: docker/build-push-action@v6
        with:
          context: services/reminder-api
          push: true
          tags: ghcr.io/harbor-clinic/reminder-api:${{ github.sha }}
          provenance: true
          sbom: true
```

The important idea here is the link between the PR commit and the result. If the pull request merged commit `8b91f3c`, the CI packet should show `8b91f3c`, the workflow run ID, the passing jobs, and the uploaded test report. A screenshot of a green checkmark can help a human skim. The durable evidence should be the run metadata, logs, and artifacts.

Harbor Clinic collects the PR and CI evidence like this. The numbers here come from the scenario, and a real team would paste the actual PR number and workflow run ID from GitHub.

```bash
CHANGE_ID=CHG-2026-0417
PR_NUMBER=1842
RUN_ID=6812459912

mkdir -p "evidence/$CHANGE_ID/ci"

gh pr view "$PR_NUMBER" \
  --json number,title,author,url,mergeCommit,reviews,files,statusCheckRollup \
  > "evidence/$CHANGE_ID/pr-$PR_NUMBER.json"

gh run view "$RUN_ID" \
  --json databaseId,displayTitle,event,headSha,conclusion,createdAt,updatedAt,workflowName,url \
  > "evidence/$CHANGE_ID/ci/run-$RUN_ID.json"

gh run view "$RUN_ID" --log \
  > "evidence/$CHANGE_ID/ci/run-$RUN_ID.log"

gh run download "$RUN_ID" \
  --dir "evidence/$CHANGE_ID/ci/artifacts"
```

These commands give the audit packet a small but clear story. The PR shows who reviewed the change, the status checks show which jobs GitHub required, the run metadata shows the tested commit, and the logs show what the jobs actually did. Now we can add the security-specific evidence that usually sits beside the tests.

## Scan Outputs Show Security Checks Ran
<!-- section-summary: Security scan evidence records which automated checks ran and how the team handled findings before merge. -->

A **security scan** is an automated check that looks for a specific class of problem. Dependency review checks whether a pull request adds vulnerable packages. Code scanning looks for risky code patterns. Secret scanning looks for leaked credentials. Container scanning checks the built image for known vulnerable packages and risky base images.

These tools do different jobs, so Harbor Clinic records each scan as its own piece of evidence instead of writing one vague "security scan passed" statement. The audit packet names the scan, the commit, the version of the tool if available, the result, and the decision for any finding. That detail matters because a low-risk development dependency finding needs a different response from a critical vulnerability in the runtime image.

For `CHG-2026-0417`, the team expects four scan records. Each one answers a different security question, so the audit packet keeps their outputs separate.

| Scan | What it checks | Evidence field |
|---|---|---|
| Dependency review | New or changed dependencies in the PR | PR check result and dependency report |
| Code scanning | Security patterns in application code | Code scanning alert result for the commit |
| Secret scanning | Accidental credentials in committed content | Secret scanning status or alert review |
| Container scan | Vulnerable packages inside the built image | Scan report tied to the image digest |

A practical scan summary can live beside the raw tool output. The raw output gives detail, while the summary gives an auditor or incident lead a quick way to see what the team decided.

```json
{
  "change_id": "CHG-2026-0417",
  "repository": "harbor-clinic/platform",
  "pull_request": 1842,
  "commit": "8b91f3c1b91d4c3d6a7a6c8c3d1aa0b1f6a42c18",
  "scans": [
    {
      "name": "dependency-review",
      "result": "pass",
      "report": "ci/artifacts/dependency-review.json"
    },
    {
      "name": "codeql",
      "result": "pass",
      "report": "ci/artifacts/codeql-summary.sarif"
    },
    {
      "name": "container-scan",
      "result": "pass-with-accepted-medium",
      "report": "ci/artifacts/container-scan.json",
      "decision": "Medium OpenSSL package finding accepted because runtime image lacks the affected feature; ticket SEC-9124 tracks base image update."
    }
  ]
}
```

The accepted finding deserves a clear record. Real delivery systems sometimes ship with a known medium or low finding because the risk has context, a compensating control, or a scheduled fix. The key is that the team records the decision, the owner, the ticket, and the expiration date, so "we accepted it" has evidence behind it.

The scan records prove security checks ran against the source and built image. The next step proves which exact artifact the team built from that source, because a tag like `latest` or `main` can point to different images over time.

![Production evidence trail infographic showing PR, checks, scans, digest, deploy, and access review evidence connected across one change](/content-assets/articles/article-devsecops-security-foundations-security-ownership-in-devops/production-evidence-trail.png)

*A useful evidence trail keeps separate records for review, checks, scans, artifact identity, deployment, and access review instead of collapsing them into one vague approval.*

## Image Digests and Provenance Connect Source to Artifact
<!-- section-summary: Image digests identify the exact artifact, and provenance records how the artifact came from source code. -->

An **image digest** is a cryptographic identifier for a container image, usually written as `sha256:...`. A tag like `ghcr.io/harbor-clinic/reminder-api:main` is a friendly name that can move. A digest identifies the exact image content, so production records should point to a digest whenever the team needs strong evidence.

For `CHG-2026-0417`, the CI workflow builds this image. Harbor Clinic records the full digest because the digest is the name the production deployment should use.

```
ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
```

That line matters because it lets the team connect three records. The PR merged commit `8b91f3c`, the CI workflow built an image from that commit, and production later ran the image with the digest above. If an incident happens two weeks later, the team can inspect the exact artifact that shipped instead of guessing which tag was current at deploy time.

**Provenance** is metadata that describes how an artifact was built. In software supply chain work, provenance usually records the source repository, source commit, build workflow, build environment, builder identity, and artifact digest. SLSA, which stands for Supply-chain Levels for Software Artifacts, defines a provenance format that many tools can produce or verify.

GitHub artifact attestations can publish provenance for build outputs. In a GitHub Actions workflow, Harbor Clinic can add an attestation step after the image build so the image digest has a verifiable statement attached to it.

```yaml
  attest-image:
    runs-on: ubuntu-latest
    needs: build-image
    steps:
      - uses: actions/attest-build-provenance@v2
        with:
          subject-name: ghcr.io/harbor-clinic/reminder-api
          subject-digest: ${{ needs.build-image.outputs.digest }}
          push-to-registry: true
```

The audit packet should keep both the digest and the provenance verification result. The digest names the artifact, and the provenance says how the team built it. Those two records help answer a very practical question: "Did production receive the image that our protected workflow built from the reviewed commit?"

Harbor Clinic verifies and records the attestation like this. The output gives the audit packet a machine-checkable link between the image digest and the GitHub build identity.

```bash
CHANGE_ID=CHG-2026-0417
IMAGE="ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112"

mkdir -p "evidence/$CHANGE_ID/artifact"

printf "%s\n" "$IMAGE" \
  > "evidence/$CHANGE_ID/artifact/image-digest.txt"

gh attestation verify "oci://$IMAGE" \
  --owner harbor-clinic \
  > "evidence/$CHANGE_ID/artifact/provenance-verification.txt"
```

At this point, we know who reviewed the change, which checks ran, and which artifact CI built. The remaining question is whether that exact artifact reached production through the approved deployment path.

## Deployment Records Connect Artifact to Production
<!-- section-summary: Deployment evidence proves which artifact reached which environment, who approved it, and what rollout result Kubernetes reported. -->

A **deployment record** is the evidence that a specific artifact moved into a specific environment at a specific time. In GitHub, this may include an environment approval, a deployment event, and a workflow run. In Kubernetes, it may include the image reference on the Deployment, rollout status, annotations, and events around the rollout.

Harbor Clinic uses a production environment called `prod-reminders`. A release manager approves the GitHub environment deployment after the PR merges, and the workflow deploys the image by digest. The workflow also writes the change ID, PR number, source commit, and image digest into Kubernetes annotations so the cluster record lines up with the audit packet.

```bash
CHANGE_ID=CHG-2026-0417
PR_NUMBER=1842
SOURCE_SHA=8b91f3c1b91d4c3d6a7a6c8c3d1aa0b1f6a42c18
IMAGE="ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112"

kubectl -n prod-reminders set image deployment/reminder-api api="$IMAGE"

kubectl -n prod-reminders annotate deployment/reminder-api \
  devpolaris.io/change-id="$CHANGE_ID" \
  devpolaris.io/pull-request="$PR_NUMBER" \
  devpolaris.io/source-sha="$SOURCE_SHA" \
  devpolaris.io/image="$IMAGE" \
  --overwrite

kubectl -n prod-reminders rollout status deployment/reminder-api
```

Those annotations help later because Kubernetes objects can answer simple questions. Which change put this image here? Which PR produced it? Which source commit built it? Which image digest is running right now?

The team stores deployment evidence after the rollout. These files let a reviewer compare the intended image digest with the image Kubernetes reports from the live workload.

```bash
CHANGE_ID=CHG-2026-0417
mkdir -p "evidence/$CHANGE_ID/deployment"

kubectl -n prod-reminders get deployment reminder-api -o json \
  > "evidence/$CHANGE_ID/deployment/kubernetes-deployment.json"

kubectl -n prod-reminders rollout history deployment/reminder-api \
  > "evidence/$CHANGE_ID/deployment/rollout-history.txt"

kubectl -n prod-reminders get pods -l app=reminder-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.containers[0].image}{"\n"}{end}' \
  > "evidence/$CHANGE_ID/deployment/running-images.txt"
```

GitHub environment approvals add another useful record. If the production environment requires approval from `@harbor/sre-prod`, the deployment run shows who approved the release and when. That approval record matters because the PR review says "this code can merge," while the environment approval says "this artifact can deploy to production now."

We now have the trail from review to running artifact. The final part checks whether the people and teams in the trail still make sense.

## Access Reviews Keep the Owner List Honest
<!-- section-summary: Access reviews compare the intended owner list with the real people who can review, merge, approve, or deploy. -->

An **access review** is a periodic check of who can perform sensitive actions. For this topic, the important actions are reviewing owned code, merging to protected branches, approving production environments, changing workflows, and deploying to production. The review asks whether each person still needs that access for their role.

Access reviews matter because ownership drifts quietly. A senior engineer moves to another team and stays in `@harbor/reminder-owners`. A contractor finishes a migration and remains an environment reviewer. A platform admin keeps broad repository access after a temporary incident. None of those cases require bad intent; they usually come from normal team movement.

For Harbor Clinic, the access review for Patient Reminder API has three groups. The groups match the same service, security, and production roles that appeared earlier in CODEOWNERS.

| Access group | Sensitive action | Review owner |
|---|---|---|
| `@harbor/reminder-owners` | Code owner review for service code | Engineering manager for reminders |
| `@harbor/security-champions` | Security review for sensitive code paths | Application security lead |
| `@harbor/sre-prod` | Production environment approval and deployment workflow review | SRE manager |

The review evidence should include the membership list, the reviewer decision, and any removals. A useful review record can stay simple. This small CSV shows the kind of decision trail Harbor Clinic keeps beside the membership export:

```csv
review_date,team,member,decision,reason,ticket
2026-04-15,reminder-owners,amina,keep,primary service maintainer,ACCESS-2331
2026-04-15,reminder-owners,leo,remove,moved to analytics team,ACCESS-2332
2026-04-15,sre-prod,marisol,keep,on-call release manager,ACCESS-2331
2026-04-15,security-champions,nadia,keep,security reviewer for patient messaging,ACCESS-2331
```

The GitHub CLI can export the current team membership into the evidence folder. The team still needs a human decision on each row, because a membership export alone only says who had access. The review record captures whether that access still matched the person's role.

```bash
CHANGE_ID=CHG-2026-0417
mkdir -p "evidence/$CHANGE_ID/access-review"

gh api orgs/harbor-clinic/teams/reminder-owners/members \
  --paginate \
  --jq '.[] | [.login, .type] | @csv' \
  > "evidence/$CHANGE_ID/access-review/reminder-owners-members.csv"

gh api orgs/harbor-clinic/teams/security-champions/members \
  --paginate \
  --jq '.[] | [.login, .type] | @csv' \
  > "evidence/$CHANGE_ID/access-review/security-champions-members.csv"

gh api orgs/harbor-clinic/teams/sre-prod/members \
  --paginate \
  --jq '.[] | [.login, .type] | @csv' \
  > "evidence/$CHANGE_ID/access-review/sre-prod-members.csv"
```

GitHub audit logs add one more angle. The audit log can show repository, team, ruleset, and security-related activity in an organization. Harbor Clinic keeps the search query and exported result around important production changes, especially when a control changed close to the release date.

```
repo:harbor-clinic/platform created:2026-04-15..2026-04-18
```

Now the team has the evidence pieces. The next section puts them into one small packet for the production change.

## Build One Audit Packet
<!-- section-summary: An audit packet collects the smallest useful set of records that proves a production change followed the secure delivery path. -->

An **audit packet** is a folder or ticket attachment that collects the evidence for one change. It should stay small enough for a reviewer to understand, and complete enough to answer the core questions. The goal is a clean trail with focused logs that people can connect.

For `CHG-2026-0417`, Harbor Clinic creates this packet. The folder names mirror the delivery trail, so a reviewer can move from ownership to merge controls, CI, artifact, deployment, and access evidence in order.

```
evidence/CHG-2026-0417/
  change-summary.md
  pr-1842.json
  repository-controls/
    main-branch-protection.json
    repository-rulesets.json
  ci/
    run-6812459912.json
    run-6812459912.log
    artifacts/
      reminder-test-results/
      dependency-review.json
      codeql-summary.sarif
      container-scan.json
  artifact/
    image-digest.txt
    provenance-verification.txt
  deployment/
    github-environment-approval.json
    kubernetes-deployment.json
    rollout-history.txt
    running-images.txt
  access-review/
    reminder-owners-members.csv
    security-champions-members.csv
    sre-prod-members.csv
    access-review-decisions.csv
```

The `change-summary.md` file gives the packet a readable front door. It should name the change, the risk, the repository, the PR, the source commit, the image digest, the production environment, and the final deployment result. A reviewer should be able to open this one file and know which deeper evidence file answers each question.

```markdown
# CHG-2026-0417 - Patient Reminder retry fix

Production system: Patient Reminder API
Repository: harbor-clinic/platform
Pull request: https://github.com/harbor-clinic/platform/pull/1842
Merged commit: 8b91f3c1b91d4c3d6a7a6c8c3d1aa0b1f6a42c18
CI run: https://github.com/harbor-clinic/platform/actions/runs/6812459912
Image digest: ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
Production environment: prod-reminders
Deployment result: rollout completed at 2026-04-17T21:43:18Z

Review evidence:
- CODEOWNERS requested reminder, security, and SRE owners.
- Two approvals were recorded before merge.
- Required checks passed on the merged commit.

Security evidence:
- Dependency review passed.
- Code scanning reported no new high or critical alerts for this commit.
- Container scan recorded one accepted medium finding with ticket SEC-9124.
- Provenance verification passed for the image digest.

Access evidence:
- Team membership exports were captured from GitHub on 2026-04-17.
- Access review decisions were completed under ticket ACCESS-2331.
```

This packet gives Harbor Clinic a concrete answer for the production change. The team can show who owned the paths, who approved the pull request, which checks ran, which image CI built, how the image links back to source, which deployment moved it into production, and who had access to approve that path.

The same packet also helps during incidents. If the SMS provider reports duplicate messages again, responders can start from the digest running in production, jump back to the PR and source commit, inspect the test evidence, and review the deployment event without searching through chat history.

![Audit packet summary infographic showing change summary, PR review, CI logs, scan reports, image provenance, deploy record, and access evidence feeding one approved packet](/content-assets/articles/article-devsecops-security-foundations-security-ownership-in-devops/audit-packet-summary.png)

*The audit packet collects the smallest practical set of records that proves who approved the change, which checks ran, which artifact shipped, and who could approve production.*

## Common Gaps Teams Fix Early
<!-- section-summary: The most common evidence gaps come from missing owners, movable tags, unenforced checks, and access lists that drift. -->

The first common gap is **ownership that lives only in people's heads**. A senior engineer knows who owns the reminder service, and the repo has no CODEOWNERS entry and the service catalog has an old team name. Harbor Clinic fixes this by treating the ownership map, CODEOWNERS, and team membership as connected records that need review together.

The second common gap is **requested review without enforced review**. GitHub can request code owners on a pull request, and a branch rule has to require the review before merge. Harbor Clinic fixes this by requiring pull requests, code owner review, multiple approvals, and named status checks on the protected branch or repository ruleset.

The third common gap is **artifact tags without digests**. A deployment record that says `reminder-api:main` leaves too much room for confusion because the tag can point to another image later. Harbor Clinic fixes this by deploying `reminder-api@sha256:...`, recording the digest in the change summary, and verifying provenance for that digest.

The fourth common gap is **scan output without a decision trail**. A scanner can produce a long JSON file, and the team still needs a clear decision for each important finding. Harbor Clinic fixes this with a scan summary that records pass, fail, accepted risk, owner, ticket, and follow-up date.

The fifth common gap is **access review evidence that comes too late**. Teams often export membership after someone asks for proof, and that export may miss who had access at the time of the change. Harbor Clinic fixes this by capturing reviewer and approver membership near the release date and by running periodic reviews for owner teams and production approvers.

Ownership and evidence turn secure delivery from a promise into a record. For a sensitive system, the team can ask a useful question during every important change: "can we show who owned the change, what gates ran, what artifact shipped, and who could approve it?"

---

## References

- [NIST Secure Software Development Framework, SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - Official NIST SSDF publication for secure software development practices.
- [GitHub CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) - Explains CODEOWNERS file locations, pattern behavior, ownership requirements, and pull request review requests.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - Documents branch protection rules, required reviews, required status checks, and related merge controls.
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) - Documents repository and organization rulesets for applying branch and tag rules.
- [GitHub audit log for organizations](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization) - Documents audit log review and filtering for organization activity.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) - Explains how GitHub Actions can create attestations for build artifacts.
- [SLSA build provenance](https://slsa.dev/spec/v1.2/provenance) - Defines provenance metadata for software artifacts in the SLSA specification.
- [SLSA provenance distribution](https://slsa.dev/spec/v1.2/distributing-provenance) - Explains ways to distribute and verify provenance for artifacts.
- [Docker image digests](https://docs.docker.com/dhi/core-concepts/digests/) - Explains image digests and why they identify immutable image content.
- [Kubernetes images](https://kubernetes.io/docs/concepts/containers/images/) - Documents container image names, tags, and digest references in Kubernetes workloads.
