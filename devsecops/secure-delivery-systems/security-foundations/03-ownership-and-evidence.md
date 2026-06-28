---
title: "Ownership and Evidence"
description: "Learn how teams assign clear owners to sensitive delivery paths and collect records that prove a production change followed the approved route."
overview: "Start with a simple production accountability story, then build an evidence trail for one Patient Reminder API release using service ownership, CODEOWNERS, branch rules, CI logs, scan results, image provenance, deployment records, and access reviews."
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

1. [A Simple Accountability Story](#a-simple-accountability-story)
2. [The Change We Will Trace](#the-change-we-will-trace)
3. [Sensitive Systems Need Named Owners](#sensitive-systems-need-named-owners)
4. [CODEOWNERS Routes the Review](#codeowners-routes-the-review)
5. [Branch Rules Enforce the Path](#branch-rules-enforce-the-path)
6. [CI Evidence Shows the Change Was Tested](#ci-evidence-shows-the-change-was-tested)
7. [Security Evidence Shows Risk Was Checked](#security-evidence-shows-risk-was-checked)
8. [Digests and Provenance Tie Source to Artifact](#digests-and-provenance-tie-source-to-artifact)
9. [Deployment Records Tie Artifact to Production](#deployment-records-tie-artifact-to-production)
10. [Access Reviews Keep Owner Lists Current](#access-reviews-keep-owner-lists-current)
11. [Build a Small Audit Packet](#build-a-small-audit-packet)
12. [Verify the Packet During an Incident](#verify-the-packet-during-an-incident)
13. [Common Gaps Teams Fix Early](#common-gaps-teams-fix-early)
14. [References](#references)

## A Simple Accountability Story
<!-- section-summary: Ownership and evidence answer who was responsible for a change and which records prove the path it took. -->

Imagine a clinic replaces the keypad on a medicine storage room. The next morning, nurses cannot open the door during a busy shift. The clinic manager needs two kinds of answers. First, who owns that room and the access system? Second, what records show who approved the keypad change, who installed it, which code was entered, and when the failure started?

The answer cannot live only in someone's memory. The clinic needs a named owner for the room, a work order, an approval record, an installer record, a test result, and an access log. Those records help the team fix the current problem, and they also show whether the normal change path worked.

Software delivery has the same need. If a production change breaks something, the team needs to know who owns the affected area and what evidence proves the change path. For DevSecOps, **ownership** means named people or teams are accountable for a system, workflow, data area, or environment. **Evidence** means durable records that show what happened: pull request reviews, branch-rule results, CI runs, scan outputs, image digests, attestations, deployment approvals, audit logs, and access review decisions.

Here is the simple mapping:

| Clinic story | Software delivery version |
|---|---|
| Medicine room owner | Service owner or production environment owner |
| Work order | Change ticket or pull request |
| Approval record | Code review, CODEOWNERS review, environment approval |
| Installer record | CI workflow run and deployment job |
| New keypad code | Built artifact digest and deployed image reference |
| Door access log | GitHub audit log, cloud audit log, Kubernetes deployment record |

NIST Secure Software Development Framework, usually called **SSDF**, gives teams a broad vocabulary for preparing people and processes, protecting code, producing well-secured software, and responding to vulnerabilities. The practical DevSecOps version is this: for every sensitive production change, the team should be able to name the owners, show the review path, show the checks, show the artifact, show the deployment, and show who had access at the time.

We will build that trail with one production change.

## The Change We Will Trace
<!-- section-summary: One Patient Reminder API change gives each evidence record a concrete system, commit, artifact, and deployment. -->

Harbor Clinic runs a service called **Patient Reminder API**. It sends SMS appointment reminders and reads patient phone numbers from a production database. The service is small, and it touches private customer data, production infrastructure, and a third-party SMS provider.

The change is `CHG-2026-0417`. It fixes a retry bug that sent duplicate reminder messages during a vendor outage. The fix touches application code, a test, the deployment workflow, and the Kubernetes deployment for production. If the change breaks production, Harbor Clinic wants to answer these questions quickly:

| Question | Plain meaning |
|---|---|
| Who owns the affected system? | The accountable teams are known before the incident starts |
| Which change entered production? | The PR, commit, and change ID are clear |
| Who reviewed it? | The CODEOWNERS and approval records match the sensitive paths |
| Which checks ran? | Tests and security scans ran against the same commit |
| Which artifact shipped? | The image digest and provenance connect source to artifact |
| Who approved deployment? | The production environment approval is recorded |
| What is running now? | Kubernetes reports the same digest that the release record approved |
| Who could approve or deploy then? | Access review records show team membership and decisions |

The first tiny evidence record can look like this:

```yaml
change_id: CHG-2026-0417
service: patient-reminder-api
repository: github.com/harbor-clinic/platform
pull_request: 1842
source_sha: 8b91f3c1b91d4c3d6a7a6c8c3d1aa0b1f6a42c18
production_environment: prod-reminders
```

That skeleton is intentionally small. It gives us the spine of the change before we add controls and proof. Next we need the most basic accountability record: who owns this sensitive system?

## Sensitive Systems Need Named Owners
<!-- section-summary: A sensitive system needs named teams before review routing, deployment approval, and incident response can work cleanly. -->

A **sensitive system** is any system where a mistake can harm customers, leak private data, move money, break production, or weaken security controls. Patient Reminder API qualifies because it reads patient contact data and sends messages through a third-party provider. The deployment workflow also qualifies because it can push new code into production.

A beginner-friendly rule works well here: every sensitive thing needs a team that can answer for it. The owner reviews risky changes, keeps runbooks current, participates in incidents, explains controls during reviews, and knows which other teams must be involved. "`@harbor/reminder-owners` owns `services/reminder-api/`" gives people a usable path. "Someone in platform knows" gives responders a search problem.

Real teams usually keep ownership in several places. A service catalog gives humans a readable view. CODEOWNERS routes pull request reviews. Branch rules enforce the merge path. On-call schedules show who responds after deployment. Access reviews show whether team membership still matches the work. These records should agree with each other.

Here is a small ownership record for Patient Reminder API:

```yaml
systems:
  patient-reminder-api:
    description: "Sends appointment reminders from production patient contact data."
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

The record names the system, repository, production environment, sensitive data, paths, teams, and risk class. It also creates a source for the later audit packet. The packet can point to this record when it says which teams owned the system and production path.

Ownership is useful when the delivery platform uses it. The next step puts these teams into GitHub review routing.

![Ownership review routing infographic showing a sensitive system mapped to ownership records, CODEOWNERS, and required service, security, and SRE reviewers](/content-assets/articles/article-devsecops-security-foundations-security-ownership-in-devops/ownership-review-routing.png)

*Ownership starts as a named system record, then CODEOWNERS turns that record into reviewers for sensitive changes.*

## CODEOWNERS Routes the Review
<!-- section-summary: CODEOWNERS connects changed repository paths to the teams that should review those paths. -->

**CODEOWNERS** is a GitHub file that maps repository paths to GitHub users or teams. When a pull request changes a matching path, GitHub requests review from the matching owners. GitHub supports CODEOWNERS in `.github/CODEOWNERS`, the repository root, or `docs/CODEOWNERS`. In practice, many teams use `.github/CODEOWNERS` so the file is easy to find with other repository controls.

GitHub evaluates CODEOWNERS patterns in order, and the last matching pattern takes precedence. That means broad rules usually go near the top and sensitive, specific rules go later.

Harbor Clinic uses this file:

```bash
/.github/CODEOWNERS @harbor/platform-security
/.github/workflows/deploy-reminder.yml @harbor/platform-security @harbor/sre-prod
/services/reminder-api/ @harbor/reminder-owners @harbor/security-champions
/infra/prod/reminder/ @harbor/sre-prod @harbor/platform-security
```

The CODEOWNERS file itself has an owner because changing review rules changes future production review. The deployment workflow has platform security and SRE owners because workflow edits can change how code reaches production. The service path names the service team and security champions because Patient Reminder API handles sensitive data.

For `CHG-2026-0417`, the pull request touches these files:

```bash
services/reminder-api/src/retry-scheduler.ts
services/reminder-api/test/retry-scheduler.test.ts
.github/workflows/deploy-reminder.yml
infra/prod/reminder/deployment.yaml
```

GitHub requests `@harbor/reminder-owners`, `@harbor/security-champions`, `@harbor/platform-security`, and `@harbor/sre-prod`. The pull request record will show requested reviewers, completed reviews, requested changes, approvals, and the commit reviewed.

The team captures the pull request record:

```bash
gh pr view 1842 \
  --repo harbor-clinic/platform \
  --json number,title,author,url,headRefOid,mergeCommit,reviews,reviewDecision,files
```

`gh pr view 1842` reads pull request `#1842`. `--repo` selects the repository. `--json` asks GitHub CLI for fields the evidence packet can store: PR identity, author, URL, commit, merge commit, reviews, final review decision, and changed files.

Example output, shortened:

```json
{
  "number": 1842,
  "title": "Fix duplicate SMS retry during vendor outage",
  "author": { "login": "amina" },
  "headRefOid": "8b91f3c1b91d4c3d6a7a6c8c3d1aa0b1f6a42c18",
  "reviewDecision": "APPROVED",
  "files": [
    { "path": "services/reminder-api/src/retry-scheduler.ts" },
    { "path": ".github/workflows/deploy-reminder.yml" }
  ]
}
```

This output shows that the PR exists and which commit it reviewed. Review routing alone still leaves room for a bypass if the branch accepts merges without the right approvals. The next section turns routing into an enforced gate.

## Branch Rules Enforce the Path
<!-- section-summary: Branch protection and rulesets require review, status checks, and controlled merge behavior before production code changes. -->

**Branch protection** and **rulesets** are GitHub controls that define what must happen before changes can enter important branches such as `main`. A rule can require pull requests, approvals, code-owner review, status checks, signed commits, merge queues, linear history, and restrictions on force pushes or direct pushes. Rulesets give organizations a broader way to apply similar rules across repositories, branches, and tags.

CODEOWNERS answers who should review a path. Branch rules answer whether GitHub will enforce the required path before merge. Harbor Clinic needs both for production evidence.

For Patient Reminder API, the `main` branch rule has this shape:

| Control | Harbor Clinic setting | Evidence to keep |
|---|---|---|
| Pull request required | Every change to `main` uses a PR | PR URL and merge commit |
| Approvals required | At least two approving reviews | Review list with timestamps |
| Code owner review required | Matching CODEOWNERS path must approve | Code owner review status |
| Status checks required | `test`, `dependency-review`, `codeql`, `container-scan`, `build-image` | Check run IDs and logs |
| Branch must be current | PR includes latest `main` before merge | Merge queue or strict status result |
| Direct pushes blocked | Normal users update `main` through the merge path | Branch protection or ruleset export |

The settings can drift. A repository admin can change a rule, a team can rename a required check, or a new workflow can miss a required job. Harbor Clinic captures the active controls near the production change.

```bash
CHANGE_ID=CHG-2026-0417
mkdir -p "evidence/$CHANGE_ID/repository-controls"

gh api repos/harbor-clinic/platform/branches/main/protection \
  > "evidence/$CHANGE_ID/repository-controls/main-branch-protection.json"

gh api repos/harbor-clinic/platform/rulesets \
  > "evidence/$CHANGE_ID/repository-controls/repository-rulesets.json"
```

`CHANGE_ID` names the evidence folder. `mkdir -p` creates the folder if it is missing. The first `gh api` command exports classic branch protection for `main`. The second exports repository rulesets. Some repositories use one, some use both, so the packet records the controls the repository actually uses.

A shortened branch protection export might include:

```json
{
  "required_pull_request_reviews": {
    "required_approving_review_count": 2,
    "require_code_owner_reviews": true
  },
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "test",
      "dependency-review",
      "codeql",
      "container-scan",
      "build-image"
    ]
  },
  "enforce_admins": {
    "enabled": true
  }
}
```

This record connects ownership to enforcement. It says the repository required code owner review and named status checks before the change merged. Next we collect the CI records for those checks.

## CI Evidence Shows the Change Was Tested
<!-- section-summary: CI evidence ties the pull request commit to automated jobs, logs, test reports, and build outputs. -->

**CI**, or continuous integration, is the automation that builds, tests, and checks code after a change. CI evidence is useful because it ties a commit SHA to actual work: installing dependencies, running tests, building an image, uploading results, and reporting job outcomes. A green checkmark helps humans scan, and durable evidence needs run metadata, logs, and artifacts.

The retry fix has a clear functional risk. If the scheduler handles a vendor outage poorly, patients receive duplicate SMS reminders. Harbor Clinic wants test output that shows the retry behavior was checked against the same commit that reviewers approved.

Here is a trimmed workflow:

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
    runs-on: ubuntu-24.04
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
    runs-on: ubuntu-24.04
    needs: test
    outputs:
      digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v4
      - id: build
        uses: docker/build-push-action@v6
        with:
          context: services/reminder-api
          push: true
          tags: ghcr.io/harbor-clinic/reminder-api:${{ github.sha }}
          provenance: true
          sbom: true
```

The workflow runs on pull requests that touch the service, deployment workflow, or production infrastructure. The `permissions` block gives the jobs only the GitHub token permissions they need for repository reads, package writes, security events, OIDC, and attestations. The `build-image` job exposes the image digest so later jobs can record or attest it.

Harbor Clinic collects CI evidence:

```bash
CHANGE_ID=CHG-2026-0417
PR_NUMBER=1842
RUN_ID=6812459912

mkdir -p "evidence/$CHANGE_ID/ci"

gh run view "$RUN_ID" \
  --repo harbor-clinic/platform \
  --json databaseId,displayTitle,event,headSha,conclusion,createdAt,updatedAt,workflowName,url \
  > "evidence/$CHANGE_ID/ci/run-$RUN_ID.json"

gh run view "$RUN_ID" \
  --repo harbor-clinic/platform \
  --log \
  > "evidence/$CHANGE_ID/ci/run-$RUN_ID.log"

gh run download "$RUN_ID" \
  --repo harbor-clinic/platform \
  --dir "evidence/$CHANGE_ID/ci/artifacts"
```

`RUN_ID` is the GitHub Actions workflow run. The first `gh run view` command stores machine-readable run metadata. `headSha` should match the approved source commit, and `conclusion` should be `success`. The second command stores logs. `gh run download` saves uploaded artifacts such as JUnit reports and scan outputs.

Example run metadata:

```json
{
  "databaseId": 6812459912,
  "workflowName": "reminder-service-ci",
  "event": "pull_request",
  "headSha": "8b91f3c1b91d4c3d6a7a6c8c3d1aa0b1f6a42c18",
  "conclusion": "success",
  "url": "https://github.com/harbor-clinic/platform/actions/runs/6812459912"
}
```

The CI records show that the commit survived the required automated checks. Security checks need their own summary because each scanner answers a different question.

## Security Evidence Shows Risk Was Checked
<!-- section-summary: Security evidence records which scans ran, what they checked, and how the team handled findings. -->

A **security scan** is an automated check for a specific class of risk. Dependency review checks whether a pull request adds vulnerable packages. Code scanning looks for risky code patterns. Secret scanning detects committed credentials. Container scanning checks the built image for vulnerable packages and risky base images.

These tools do different jobs, so Harbor Clinic stores each scan result separately. A single sentence such as "security passed" hides too much. The evidence should name the scan, commit, tool version when available, result, report file, and decision for any finding.

For `CHG-2026-0417`, the team expects these scan records:

| Scan | What it checks | Evidence field |
|---|---|---|
| Dependency review | New or changed dependencies in the PR | PR check result and dependency report |
| Code scanning | Security patterns in application code | SARIF or code scanning result for the commit |
| Secret scanning | Accidental credentials in committed content | Secret scanning status or alert review |
| Container scan | Vulnerable packages inside the built image | Scan report tied to the image digest |

A practical scan summary can live beside raw tool output:

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
      "decision": "Medium OpenSSL package finding accepted because the runtime image lacks the affected feature; ticket SEC-9124 tracks the base image update."
    }
  ]
}
```

Real production systems sometimes ship with an accepted low or medium finding. The important record is the decision: risk explanation, owner, ticket, expiration date, and follow-up plan. That way an accepted finding has a review trail.

![Production evidence trail infographic showing PR, checks, scans, digest, deploy, and access review evidence connected across one change](/content-assets/articles/article-devsecops-security-foundations-security-ownership-in-devops/production-evidence-trail.png)

*A useful evidence trail keeps separate records for review, checks, scans, artifact identity, deployment, and access review.*

The scan records show what risk checks ran. The next evidence link names the exact artifact that came out of the build.

## Digests and Provenance Tie Source to Artifact
<!-- section-summary: Image digests identify the exact artifact, while provenance records how the artifact was built from source. -->

An **image digest** is a cryptographic identifier for a container image, usually written as `sha256:...`. A tag like `ghcr.io/harbor-clinic/reminder-api:main` is a friendly name that can move. A digest identifies exact image content, so production records should use digests when the team needs strong evidence.

For `CHG-2026-0417`, CI builds this image:

```bash
ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
```

That digest lets the team connect three records. The PR merged commit `8b91f3c`, the CI workflow built an image from that commit, and production later ran the image with the digest above.

**Provenance** is metadata that describes how an artifact was built. In software supply chain work, provenance usually records the source repository, source commit, build workflow, build environment, builder identity, and artifact digest. SLSA defines provenance fields for this purpose, and GitHub artifact attestations give GitHub Actions users a built-in way to create and verify provenance for build outputs.

The workflow can attest the image after the build:

```yaml
  attest-image:
    runs-on: ubuntu-24.04
    needs: build-image
    permissions:
      contents: read
      id-token: write
      attestations: write
    steps:
      - uses: actions/attest-build-provenance@v2
        with:
          subject-name: ghcr.io/harbor-clinic/reminder-api
          subject-digest: ${{ needs.build-image.outputs.digest }}
          push-to-registry: true
```

`subject-name` names the image repository. `subject-digest` uses the digest produced by the build job. `push-to-registry: true` stores the attestation with the registry so later verification can find it.

Harbor Clinic records the digest and verifies the attestation:

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

`IMAGE` holds the exact digest reference. `printf` writes it to the packet. `gh attestation verify` checks that an attestation exists for the artifact and that it belongs to the expected owner.

Example verification output:

```bash
Loaded digest sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
✓ Verification succeeded
sha256:0fd3a7f... was attested by harbor-clinic/platform
```

Now the team knows which artifact CI produced. The next question is whether production received that same artifact through the approved deployment path.

## Deployment Records Tie Artifact to Production
<!-- section-summary: Deployment evidence proves which artifact entered which environment, who approved it, and what the platform reported. -->

A **deployment record** is evidence that a specific artifact moved into a specific environment at a specific time. In GitHub, that can include an environment approval, deployment event, and workflow run. In Kubernetes, it can include the image reference on the Deployment, rollout status, annotations, and pod image IDs.

Harbor Clinic uses a production environment called `prod-reminders`. A release manager approves the GitHub environment deployment after the PR merges, and the deployment job updates Kubernetes by digest. The workflow also writes the change ID, PR number, source commit, and image digest into Kubernetes annotations.

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

`-n prod-reminders` selects the production namespace. `set image` updates the `api` container in the `reminder-api` Deployment. `annotate` stores release context on the Deployment, and `--overwrite` updates existing annotations during later releases. `rollout status` waits for Kubernetes to report the rollout state.

Example output:

```bash
deployment.apps/reminder-api image updated
deployment.apps/reminder-api annotated
deployment "reminder-api" successfully rolled out
```

After rollout, the team stores deployment evidence:

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

`get deployment -o json` stores the full Deployment record. `rollout history` stores Kubernetes rollout revisions. The `get pods` command uses a label selector to list pods for the service and a `jsonpath` expression to print pod names and image references.

Example `running-images.txt` output:

```bash
reminder-api-6d8f9d66cc-n7m2p ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
reminder-api-6d8f9d66cc-r4z8k ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
```

The deployment records connect the approved digest to the running platform. The final ownership question is whether the people who could approve or deploy still belonged in those groups.

## Access Reviews Keep Owner Lists Current
<!-- section-summary: Access reviews compare intended owners and approvers with the real people who can review, merge, approve, or deploy. -->

An **access review** is a periodic check of who can perform sensitive actions. For this delivery path, the important actions are reviewing owned code, merging to protected branches, approving production environments, changing workflows, and deploying to production. The review asks whether each person still needs that access for their role.

Access drifts during normal work. A senior engineer moves to another team and remains in `@harbor/reminder-owners`. A contractor finishes a migration and remains an environment reviewer. A platform admin keeps broad repository access after an incident. These cases come from everyday team movement, so the process has to catch them.

Harbor Clinic reviews three groups:

| Access group | Sensitive action | Review owner |
|---|---|---|
| `@harbor/reminder-owners` | Code owner review for service code | Engineering manager for reminders |
| `@harbor/security-champions` | Security review for sensitive code paths | Application security lead |
| `@harbor/sre-prod` | Production environment approval and deployment workflow review | SRE manager |

The review evidence should include membership exports and decisions. A small CSV decision file works:

```csv
review_date,team,member,decision,reason,ticket
2026-04-15,reminder-owners,amina,keep,primary service maintainer,ACCESS-2331
2026-04-15,reminder-owners,leo,remove,moved to analytics team,ACCESS-2332
2026-04-15,sre-prod,marisol,keep,on-call release manager,ACCESS-2331
2026-04-15,security-champions,nadia,keep,security reviewer for patient messaging,ACCESS-2331
```

The GitHub CLI can export current team members:

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

`gh api` calls the GitHub REST API. `--paginate` follows additional pages for larger teams. `--jq` formats each member as CSV with login and account type. The export says who had access when the team captured it; the decision CSV says whether that access still matched the person's role.

Example CSV output:

```csv
"amina","User"
"nadia","User"
"marisol","User"
```

GitHub audit logs add another angle. The audit log can show organization activity such as repository setting changes, team changes, ruleset changes, and security-related events. Harbor Clinic keeps the query and exported results around sensitive production releases, especially when a repository control changed near the release date.

At this point, we have owner records, review records, branch controls, CI logs, scan outputs, artifact proof, deployment records, and access review records. The next section packages them into one small folder.

## Build a Small Audit Packet
<!-- section-summary: An audit packet collects the smallest useful records that prove a production change followed the secure delivery path. -->

An **audit packet** is a folder, ticket attachment, or evidence bundle for one change. It should stay small enough for a reviewer to understand and complete enough to answer the core questions. The packet is a map, not a data dump.

For `CHG-2026-0417`, Harbor Clinic creates this structure:

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

The `change-summary.md` file gives the packet a readable front door:

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
- CODEOWNERS requested reminder, security, platform, and SRE owners.
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

The summary gives a reviewer the main story and points to the deeper files. During an incident, responders can start with the digest running in production, jump back to the PR and source commit, inspect test evidence, and review deployment approvals without searching chat history.

![Audit packet summary infographic showing change summary, PR review, CI logs, scan reports, image provenance, deploy record, and access evidence feeding one approved packet](/content-assets/articles/article-devsecops-security-foundations-security-ownership-in-devops/audit-packet-summary.png)

*The audit packet collects the smallest practical set of records that proves who approved the change, which checks ran, which artifact shipped, and who could approve production.*

The packet exists for audits, and it also helps real incidents. Let's use it the way an on-call engineer would.

## Verify the Packet During an Incident
<!-- section-summary: Incident verification compares the live system with the packet so responders know whether the approved artifact is running. -->

Two days after the release, the SMS vendor reports another burst of duplicate messages. SRE lead Marisol opens the packet and asks one first question: is production running the approved image from `CHG-2026-0417`?

She checks the Deployment annotation and configured image:

```bash
kubectl -n prod-reminders get deployment reminder-api \
  -o jsonpath='{.metadata.annotations.devpolaris\.io/change-id}{"\n"}{.metadata.annotations.devpolaris\.io/source-sha}{"\n"}{.spec.template.spec.containers[?(@.name=="api")].image}{"\n"}'
```

`kubectl get deployment` reads the live Deployment. The `jsonpath` expression prints the change ID, source SHA, and configured image for the `api` container.

Expected output:

```bash
CHG-2026-0417
8b91f3c1b91d4c3d6a7a6c8c3d1aa0b1f6a42c18
ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
```

Then she checks running pods:

```bash
kubectl -n prod-reminders get pods -l app=reminder-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[?(@.name=="api")].imageID}{"\n"}{end}'
```

`-l app=reminder-api` selects pods for the service. The `imageID` field comes from the container runtime after the image is pulled.

Expected output:

```bash
reminder-api-6d8f9d66cc-n7m2p   ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
reminder-api-6d8f9d66cc-r4z8k   ghcr.io/harbor-clinic/reminder-api@sha256:0fd3a7f5c2a9d44e7b7467a8f9106cb4d71c3ce86b5e2a6f6f6aab6e08c7f112
```

Both checks match the packet. Marisol now knows the approved artifact is running. That answer does not fix the SMS issue by itself. It narrows the investigation. The team can look at vendor behavior, retry configuration, feature flags, or data state with confidence that production is running the reviewed image.

If the live digest differed from the packet, the incident would move toward deployment drift, emergency changes, or stuck rollout investigation. The packet gives responders a clean first comparison.

## Common Gaps Teams Fix Early
<!-- section-summary: The most common evidence gaps come from missing owners, weak enforcement, movable tags, vague scan decisions, and stale access. -->

The first common gap is **ownership that lives only in people's heads**. A senior engineer knows who owns the reminder service, while the repo has no CODEOWNERS entry and the service catalog has an old team name. Harbor Clinic fixes this by treating the ownership record, CODEOWNERS, and team membership as connected records that need review together.

The second common gap is **requested review without enforced review**. GitHub can request code owners on a pull request, and branch rules have to require the review before merge. Harbor Clinic fixes this by requiring pull requests, code-owner review, multiple approvals, and named status checks on the protected branch or ruleset.

The third common gap is **artifact tags without digests**. A deployment record that says `reminder-api:main` leaves room for confusion because the tag can point to a different image later. Harbor Clinic fixes this by deploying `reminder-api@sha256:...`, recording the digest in the change summary, and verifying provenance for that digest.

The fourth common gap is **scan output without a decision trail**. A scanner can produce a long JSON file, and the team still needs a clear decision for important findings. Harbor Clinic fixes this with a scan summary that records pass, fail, accepted risk, owner, ticket, and follow-up date.

The fifth common gap is **access review evidence captured too late**. Teams often export membership after someone asks for proof, and that export may miss who had access at the time of the change. Harbor Clinic fixes this by capturing reviewer and approver membership near the release date and by running periodic reviews for owner teams and production approvers.

Ownership and evidence turn secure delivery from a promise into records the team can use. For a sensitive system, every important change should answer the same questions: who owned the paths, who approved the change, which checks ran, which artifact shipped, which environment received it, and who could approve that path.

---

## References

- [NIST Secure Software Development Framework, SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - Official NIST SSDF publication for secure software development practices.
- [GitHub CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) - Explains CODEOWNERS file locations, pattern behavior, ownership requirements, and pull request review requests.
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - Documents branch protection rules, required reviews, required status checks, and related merge controls.
- [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) - Documents repository and organization rulesets for applying branch and tag rules.
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) - Documents workflow triggers, permissions, jobs, and steps.
- [GitHub audit log for organizations](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization) - Documents audit log review and filtering for organization activity.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) - Explains how GitHub Actions can create attestations for build artifacts.
- [GitHub attest-build-provenance action](https://github.com/actions/attest-build-provenance) - Official GitHub action for generating build provenance attestations.
- [SLSA build provenance](https://slsa.dev/spec/v1.2/provenance) - Defines provenance metadata for software artifacts in the SLSA specification.
- [SLSA provenance distribution](https://slsa.dev/spec/v1.2/distributing-provenance) - Explains ways to distribute and verify provenance for artifacts.
- [Docker image digests](https://docs.docker.com/dhi/core-concepts/digests/) - Explains image digests and immutable image references.
- [Kubernetes images](https://kubernetes.io/docs/concepts/containers/images/) - Documents container image names, tags, digests, and image pulls.
- [Kubernetes annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/) - Documents annotations for attaching non-identifying metadata to Kubernetes objects.
- [Kubernetes deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents Deployment rollouts, status, and rollback history.
