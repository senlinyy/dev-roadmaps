---
title: "Deployment Runbooks"
description: "Eliminate human operator mistakes during high-stress releases by capturing and automating procedures using executable runbooks."
overview: "Loose, informal release checklists are prone to human error and configuration drift. Learn how to transition to version-controlled Executable Runbooks, how to write idempotent deployment scripts, and how to automate post-deployment verification checks using repeatable smoke-test pipelines."
tags: ["runbooks", "release-automation", "deployment-ops", "idempotency"]
order: 6
id: article-cicd-deployment-strategies-deployment-runbooks-and-release-automation
aliases:
  - /cicd/deployment-strategies/deployment-runbooks-and-release-automation
---

## Table of Contents

1. [Why Runbooks Finish the Module](#why-runbooks-finish-the-module)
2. [From Checklist to Executable Runbook](#from-checklist-to-executable-runbook)
3. [Pre-Flight Checks](#pre-flight-checks)
4. [Idempotent Deployment Steps](#idempotent-deployment-steps)
5. [Post-Flight Verification](#post-flight-verification)
6. [Human Gates and Automation Boundaries](#human-gates-and-automation-boundaries)
7. [Putting It All Together](#putting-it-all-together)

## Why Runbooks Finish the Module
<!-- section-summary: A runbook turns deployment strategy decisions into repeatable steps that work during normal releases and incidents. -->

This module has built a release toolbox. Rolling deployments replace instances in waves. Blue-green deployments switch between full environments. Canary deployments expose a new version slowly. Rollback and roll-forward decisions restore service when a release fails. Environment promotion makes sure the same artifact moves through gates.

A **deployment runbook** turns all of that into a repeatable operating procedure. It explains what the team checks before release, what the automation runs, what evidence the release must produce, when a human approves, when the system stops, and how the team recovers.

The runbook matters because production releases happen under time pressure. A person who knows the system well may be tired, distracted, or covering an incident. A new team member may need to run the release while the usual release owner is away. A written checklist helps, but a checklist that lives only in a wiki can drift away from the real scripts.

The strongest runbooks live close to the code and pipeline. They are versioned, reviewed, tested in lower environments, and automated where automation makes the result safer. For the checkout API, the runbook should describe how to promote one image digest, deploy it through the selected rollout pattern, verify checkout behavior, and recover if the signals fail.

The first step is moving from an informal checklist to something the pipeline can execute and audit.

## From Checklist to Executable Runbook
<!-- section-summary: An executable runbook combines human-readable intent with scripts and pipeline jobs that perform the release. -->

A text checklist usually says things like "deploy the new image" or "check the logs." That can help, but it leaves too much interpretation for a stressful moment. Which image? Which environment? Which log query? Which metric threshold? Which rollback command?

An **executable runbook** keeps the human explanation, but the actual operations point to scripts, pipeline jobs, or commands with clear inputs. The runbook connects people and automation.

Here is a compact runbook shape for the checkout API:

```yaml
service: checkout-api
release:
  artifact_input: image_digest
  rollout_pattern: canary
  owner: payments-platform

preflight:
  - name: verify artifact exists
    command: ./scripts/verify-image.sh "$IMAGE_DIGEST"
  - name: verify staging evidence
    command: ./scripts/check-staging-release.sh "$IMAGE_DIGEST"
  - name: verify migration state
    command: ./scripts/check-migration-compatibility.sh

deploy:
  - name: start canary
    command: ./scripts/deploy-canary.sh checkout-api "$IMAGE_DIGEST" 1
  - name: watch first window
    command: ./scripts/watch-canary.sh checkout-api 10m

postflight:
  - name: smoke test checkout
    command: ./scripts/smoke-checkout.sh production
  - name: record release
    command: ./scripts/record-release.sh checkout-api "$IMAGE_DIGEST"

rollback:
  command: ./scripts/rollback-checkout.sh
  trigger: "failed canary gate or severe checkout error spike"
```

![Executable deployment runbook showing pre-flight, deploy, post-flight, rollback, production service, and release record](/content-assets/articles/article-cicd-deployment-strategies-deployment-runbooks-and-release-automation/executable-runbook-flow.png)

*An executable runbook keeps the human-readable release plan tied to scripts, pipeline jobs, rollback automation, and release evidence.*

This is still readable by humans, but it removes guesswork. The scripts hold the operational details. The pipeline can call the same scripts. Reviewers can see when the release process changes because the runbook and scripts live in version control.

GitHub Actions and other CI/CD systems can run repository scripts as workflow steps. That means a runbook can become a real pipeline instead of a separate document. The next question is what the runbook should check before touching production.

## Pre-Flight Checks
<!-- section-summary: Pre-flight checks catch missing release inputs before production traffic changes. -->

**Pre-flight checks** run before deployment starts. They answer, "Do we have the required evidence and safe starting conditions?" These checks should fail quickly. A pre-flight failure is much cheaper than a half-finished production release.

For the checkout API, pre-flight should check four areas:

| Area | Example check | Why it matters |
|---|---|---|
| Artifact | The image digest exists and has a passing build record. | The pipeline should deploy a known artifact. |
| Environment | Production cluster, database, load balancer, and secrets are reachable. | The release should wait during obvious platform trouble. |
| Data compatibility | Pending migrations are additive or already applied safely. | Rollback should stay available. |
| Change coordination | No other checkout deployment is running. | Checkout releases should run one at a time. |

Here is a simple artifact verification script:

```bash
#!/usr/bin/env bash
set -euo pipefail

image_digest="${1:?image digest required}"
service="checkout-api"

./scripts/registry-has-digest.sh "$service" "$image_digest"
./scripts/attestation-verify.sh "$service" "$image_digest"
./scripts/release-evidence.sh "$service" "$image_digest" --require-staging-pass
```

The script fails if any required evidence is missing. That is exactly what we want. A production release should stop before traffic changes if the artifact never passed staging or if provenance verification fails.

Pre-flight checks should also include a human-readable release note. The note can stay short. It should say what changed, what risk the team sees, which deployment pattern will run, and which rollback path is available. That context helps approvers make a real decision instead of clicking a button from habit.

After pre-flight passes, the runbook needs deployment steps that can tolerate retries. That brings us to idempotency.

## Idempotent Deployment Steps
<!-- section-summary: Idempotent steps can run more than once safely, which makes retries and recovery less dangerous. -->

**Idempotent** means running the same operation more than once leaves the system in the same intended state. Deployment steps should be idempotent because pipelines fail halfway, network calls time out, and humans may rerun a job during an incident.

Here is a non-idempotent example. A script creates a new target group every time it runs, then attaches the service to that target group. If the first run times out after creating the target group, the second run creates another one. Soon the load balancer has several unused target groups and the operator has to figure out which one is real.

An idempotent script names resources from stable inputs and checks existing state:

```bash
#!/usr/bin/env bash
set -euo pipefail

service="checkout-api"
image_digest="${1:?image digest required}"
release_id="$(./scripts/release-id-from-digest.sh "$image_digest")"
target_group="checkout-api-${release_id}"

if ! ./scripts/target-group-exists.sh "$target_group"; then
  ./scripts/create-target-group.sh "$target_group"
fi

./scripts/render-task-definition.sh "$service" "$image_digest" > task-definition.json
./scripts/register-task-definition.sh task-definition.json
./scripts/update-service-canary.sh "$service" "$target_group" --weight 1
```

If the script runs twice with the same digest, it aims at the same target group and same task definition content. It avoids creating a pile of duplicate resources. The operation converges toward the desired release state.

Good idempotent deployment scripts usually follow this pattern:

| Step | Behavior |
|---|---|
| Read current state | Query the platform before changing it. |
| Compare desired state | Check whether the intended resource already exists. |
| Apply missing changes | Create or update only what differs. |
| Verify result | Confirm the platform reached the expected state. |
| Exit clearly | Return success when the desired state exists, even after retry. |

![Idempotent deployment steps showing read state, compare, apply missing, verify, safe retry, and no duplicates](/content-assets/articles/article-cicd-deployment-strategies-deployment-runbooks-and-release-automation/idempotent-deployment-steps.png)

*Idempotent deployment scripts converge on the intended state, so retrying a failed job does not create duplicate release resources.*

Idempotency helps forward deployment and rollback. A rollback script should also tolerate reruns. If traffic already points to the previous healthy version, rerunning rollback should report success instead of creating a new problem.

After deployment steps run, the runbook needs proof that production actually works.

## Post-Flight Verification
<!-- section-summary: Post-flight verification checks the real service after deployment instead of trusting the pipeline status alone. -->

**Post-flight verification** runs after the deployment changes production. A CI job turning green only proves the pipeline finished its commands. Post-flight checks prove the service from the outside and compare production signals.

For the checkout API, post-flight can include:

| Check | Practical example |
|---|---|
| Readiness | Production `/ready` returns success from multiple regions. |
| Synthetic transaction | A test cart can apply a discount and reach payment sandbox authorization. |
| Error budget signal | 5xx rate and p95 latency stay within the release threshold. |
| Business metric | Checkout success rate stays near baseline. |
| Observability | Logs, metrics, and traces include the new image digest or version. |

Here is a small smoke test script:

```bash
#!/usr/bin/env bash
set -euo pipefail

base_url="${1:?base url required}"

curl -fsS "$base_url/ready" > /dev/null

response="$(curl -fsS "$base_url/internal/smoke/checkout" \
  -H "X-Smoke-Test: true" \
  -H "Content-Type: application/json" \
  --data '{"sku":"test-plan","discount":"SMOKE10"}')"

echo "$response" | jq -e '.status == "authorized" and .orderId != null' > /dev/null
```

The smoke test calls a meaningful path and checks the response shape. It uses test-only inputs and a safe endpoint. It should write enough logs for responders to find the test run later.

Post-flight also needs a watch window. A canary may pass the first smoke test and fail after real traffic hits a less common path. A runbook can require a 30-minute watch for high-risk checkout releases, with specific dashboards and alerts linked in the release record.

The last practical topic is the human boundary. Automation should handle repeatable checks, but some decisions need accountable approval.

## Human Gates and Automation Boundaries
<!-- section-summary: Good runbooks automate repeatable checks while keeping accountable humans on risky production decisions. -->

A **human gate** is an approval or decision point assigned to a person or group. The goal is accountability and judgment. A human gate helps when the release has business risk, customer communication risk, data migration risk, or unclear signals.

Automation should own checks that machines can judge reliably:

| Automation should decide | Humans should decide |
|---|---|
| Artifact exists | Whether a risky change should ship today |
| Tests passed | Whether degraded but improving metrics are acceptable |
| Staging smoke test passed | Whether customer support needs a heads-up |
| Canary threshold failed | Whether to extend the canary watch window |
| Rollback command succeeded | Whether to open a broader incident |

The runbook should name the owner for each gate. For production checkout releases, the approver might be the release owner plus the payments on-call engineer. GitHub Actions environments can require reviewers before a production deployment job proceeds. Other tools have similar environment approval concepts. The key practice is that approval happens in the same system that records the deployment.

Human gates should have enough context to be useful:

```yaml
approval_context:
  service: checkout-api
  artifact: registry.example.com/checkout-api@sha256:8f3a...
  change_summary: "new discount calculation path"
  rollout: "canary 1 -> 5 -> 25 -> 100"
  rollback: "./scripts/rollback-checkout.sh"
  data_risk: "expand phase only, old columns remain"
  support_note: "watch discount-related checkout failures"
```

This approval record tells the reviewer what they are accepting. It also helps the incident team if the release fails later.

Now the whole module can close as one release system.

## Putting It All Together
<!-- section-summary: A complete deployment runbook makes releases repeatable, observable, recoverable, and reviewable. -->

The checkout team wants to release image digest `sha256:8f3a...`. The runbook starts with pre-flight checks. It verifies the artifact, provenance, staging evidence, migration compatibility, production health, and deployment lock. If any required input is missing, the release stops before production changes.

The production job waits for the required environment approval. The approval context shows the change summary, rollout pattern, rollback command, data risk, and support note. Once approved, the runbook executes idempotent scripts that deploy the canary at 1%, wait for health, run smoke tests, and watch telemetry.

The runbook then moves through the canary steps. At each step, automated gates compare canary and baseline metrics. If the canary fails, rollback sets the traffic weight back to the previous healthy version and records the event. If every gate passes, the release reaches 100%, runs post-flight verification, records the release, and keeps the service under a watch window.

This is what deployment strategy looks like in daily production work. The patterns are useful, but the runbook makes them reliable. It gives the team a shared path before the release, during the rollout, and after something goes wrong. The best runbook feels boring because it turns high-pressure work into clear steps with evidence.

![Deployment runbook summary showing pre-flight, approval, rollout, smoke tests, watch window, rollback trigger, and release record](/content-assets/articles/article-cicd-deployment-strategies-deployment-runbooks-and-release-automation/runbook-release-summary.png)

*A complete runbook connects pre-flight evidence, approval, rollout, smoke tests, watch windows, rollback triggers, and the final release record.*

---

**References**

- [GitHub Actions: adding scripts to your workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/add-scripts) - Shows how workflows run repository scripts and shell commands.
- [GitHub Actions: deploying to a specific environment](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/deploy-to-environment) - Documents jobs that target environments and use environment URLs.
- [GitHub Actions: reviewing deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments) - Explains approving or rejecting jobs waiting on deployment review.
- [Google SRE Workbook: Incident Response](https://sre.google/workbook/incident-response/) - Covers incident roles, clear responsibilities, and structured response.
- [Prometheus alerting practices](https://prometheus.io/docs/practices/alerting/) - Describes actionable alerting rules that support automated and human release decisions.
- [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) - Defines provenance information that can connect an artifact to its source and build process.
