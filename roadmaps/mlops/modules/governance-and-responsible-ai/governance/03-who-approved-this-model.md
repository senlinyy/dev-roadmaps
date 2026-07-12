---
title: "Model Approval"
description: "Show how model approval turns training evidence, business risk, reviewers, tickets, and release gates into a controlled production decision."
overview: "Model approval is the recorded decision that a specific model version may reach a specific environment under specific controls. This tutorial follows an insurance pricing model through an approval packet, release ticket, automated gate, production handoff, and audit-ready evidence checks."
tags: ["MLOps", "production", "audit"]
order: 3
id: "article-mlops-governance-and-responsible-ai-who-approved-this-model"
---

## Table of Contents

1. [What Model Approval Means](#what-model-approval-means)
2. [The Insurance Pricing Scenario](#the-insurance-pricing-scenario)
3. [Approval Evidence](#approval-evidence)
4. [The Release Ticket](#the-release-ticket)
5. [Approval YAML](#approval-yaml)
6. [Automated Gates](#automated-gates)
7. [Production Handoff](#production-handoff)
8. [Audit Logs and Review Cadence](#audit-logs-and-review-cadence)
9. [Practical Checks, Mistakes, and Interview Understanding](#practical-checks-mistakes-and-interview-understanding)
10. [References](#references)

## What Model Approval Means
<!-- section-summary: Model approval is the recorded decision that a specific model version can reach a specific environment with named evidence and controls. -->

Model approval answers the question in the title: **who approved this model, based on which evidence, for which release, and under which limits**. It is the point where model work changes from "we trained a promising version" into "this exact version may affect real users in this exact way."

That sounds formal, because it is formal. It also has a very practical engineering shape. A model approval record should name the model version, the dataset snapshot, the training run, the evaluation report, the risk tier, the reviewers, the deployment target, the rollback target, and the release ticket that joined those pieces together. When an incident, customer complaint, or audit asks why version 27 served traffic, the team should answer from records rather than memory.

Think about approval as a controlled handoff. The data science team creates a candidate. The platform team checks whether the candidate can run safely. Product checks whether the model behavior fits the business workflow. Security and privacy check data and access boundaries. Risk or compliance reviewers check the evidence for sensitive decisions. The release system then verifies the packet and only deploys the approved version.

The NIST AI Risk Management Framework gives useful language for this flow. It groups AI risk work into Govern, Map, Measure, and Manage. In day-to-day MLOps, approval sits where Measure and Manage meet: the team measures model quality and impact, then manages the decision to release, hold, roll back, or require more evidence.

## The Insurance Pricing Scenario
<!-- section-summary: An insurance pricing model needs approval because model output can affect quotes, customer trust, and regulated review obligations. -->

We will follow HarborShield Insurance, a fictional company that sells auto insurance. HarborShield trains a model called `renewal_price_adjustment` for renewal quotes. The model predicts a recommended pricing adjustment band for existing customers based on claim history, vehicle type, policy age, telematics consent status, payment history, garaging region, and prior support interactions.

This model matters because price changes affect customers directly. A bad version can overcharge a customer group, underprice risky policies, violate internal pricing rules, or create a confusing customer experience. The model output still flows through an actuarial pricing system and business rules, yet the model influences the final quote. That puts it in a higher review tier than a dashboard-only model.

HarborShield names the candidate `renewal_price_adjustment` version `27`. The candidate came from MLflow run `8ef9c21a`, trained on dataset snapshot `pricing_features_2026_06_15`, packaged in container image digest `sha256:2b3b9f1f80af`, and evaluated on a locked validation period from May 2026. The team wants to move it from staging shadow scoring into a 5% canary for renewal traffic.

Here is the approval map for this release.

| Approval area | Plain question | HarborShield evidence |
| --- | --- | --- |
| Purpose | What decision receives model input? | Renewal price adjustment band for existing auto policies. |
| Version identity | Which candidate is under review? | Registry model `pricing_prod.models.renewal_price_adjustment`, version `27`. |
| Data boundary | Which data trained it? | Snapshot `pricing_features_2026_06_15`, label cutoff `2026-05-31`, restricted columns listed. |
| Performance | Did it beat the current model safely? | Lift, calibration, segment error, quote impact simulation. |
| Fairness and impact | Which groups need extra review? | Region, age band, vehicle use, telematics consent, customer tenure. |
| Security | Can only approved identities read artifacts? | Registry grants, object-store policy, artifact digest, image signature. |
| Release | Which environment and percentage? | 5% canary behind pricing service flag `pricing_model_v27_canary`. |
| Rollback | What restores the previous path? | Reassign alias to version `24`, disable canary flag, keep pricing rules fallback. |

![HarborShield approval map](/content-assets/articles/article-mlops-governance-and-responsible-ai-who-approved-this-model/harborshield-approval-map.png)

*HarborShield’s approval map keeps version `27`, the pricing purpose, the data snapshot, quote simulation, privacy review, canary scope, and rollback target in one release view.*

The approval path should match the risk. A low-risk internal model might only need an owner review and a basic release checklist. HarborShield needs more evidence because pricing affects customer bills and can raise regulatory concerns. The workflow still stays concrete: one packet, one ticket, named reviewers, and a release gate that checks the packet before deployment.

## Approval Evidence
<!-- section-summary: Approval evidence gathers model identity, data, evaluation, risk notes, security controls, and rollback into one reviewable packet. -->

Approval evidence is the material that lets reviewers make a decision without chasing screenshots through chat. It should be specific enough that another engineer can reconstruct the release later. For HarborShield, the evidence packet connects the training run, data snapshot, model artifact, release target, and reviewer decisions.

A good packet has two audiences. Humans read it to judge risk. Automation reads it to block incomplete releases. That means the packet needs plain explanations and stable fields. The plain explanation says why version `27` is better, where it still has risk, and what the team will monitor. The stable fields let CI check version numbers, required files, thresholds, approval states, and rollback targets.

Here is a compact packet.

```yaml
approval_packet_id: hs-pricing-2026-07-v27
model:
  name: pricing_prod.models.renewal_price_adjustment
  version: 27
  proposed_alias: canary
  current_production_version: 24
  registry: unity_catalog
training:
  mlflow_run_id: 8ef9c21a7d4b41a79fd6
  git_commit: 9a74c0e
  image_digest: sha256:2b3b9f1f80af9e36c1cf
  dataset_snapshot: pricing_features_2026_06_15
  label_cutoff: "2026-05-31"
evaluation:
  validation_period: "2026-05-01 to 2026-05-31"
  quote_error_mae_delta: -0.018
  calibration_error_delta: -0.006
  max_segment_price_lift_delta: 0.021
  adverse_impact_review: reviews/adverse-impact-v27.md
  simulation_report: reports/quote-simulation-v27.html
risk:
  tier: high
  customer_impact: pricing recommendation for renewal quotes
  human_or_rules_control: actuarial pricing rules still cap final quote movement
controls:
  canary_percent: 5
  rollback_target_version: 24
  feature_flag: pricing_model_v27_canary
  monitoring_dashboard: https://metrics.example/harborshield/pricing/v27
approvals:
  pricing_product_owner: pending
  actuarial_reviewer: pending
  privacy_reviewer: pending
  security_reviewer: pending
  ml_platform_owner: pending
```

Notice how the packet avoids vague statements like "model improved." It records the metric deltas, validation period, restricted review, report paths, and rollback target. A reviewer can ask sharper questions: which segment had the largest price movement, how the canary will pause, and whether the privacy reviewer accepted the training data boundary.

The evidence packet should link to raw artifacts without copying everything into the ticket. HarborShield stores evaluation HTML, segment CSVs, calibration plots, model cards, and data validation results in a governed review bucket. The packet carries the paths and digests. That gives reviewers one map while the storage system keeps large files durable and access controlled.

![HarborShield evidence packet to release ticket](/content-assets/articles/article-mlops-governance-and-responsible-ai-who-approved-this-model/evidence-to-release-ticket.png)

*The packet feeds ticket `MLREL-1842`, where required reviewer decisions and production canary scope turn evidence into an accountable release workflow.*

## The Release Ticket
<!-- section-summary: A release ticket turns the packet into an accountable workflow with reviewers, decisions, timestamps, and deployment scope. -->

Most companies already have a change process through Jira, ServiceNow, GitHub Issues, or another ticketing tool. Model approval should fit that path instead of living only inside an experiment tracker. The release ticket is the human workflow record. It names the decision, pulls in the evidence packet, routes reviewers, and records the final approval.

HarborShield uses a ticket named `MLREL-1842`. The ticket is short enough to read during release review, and every field points to durable evidence.

```yaml
ticket: MLREL-1842
title: Approve renewal_price_adjustment v27 for 5 percent canary
requester: maya.chen@harborshield.example
requested_at: 2026-07-05T10:30:00Z
change_window: 2026-07-08T09:00:00Z to 2026-07-08T12:00:00Z
environment: production-canary
approval_packet_id: hs-pricing-2026-07-v27
model_version: pricing_prod.models.renewal_price_adjustment/27
summary: >
  Version 27 improves calibration on May renewal traffic and reduces quote
  error while keeping max segment price lift inside the approved policy range.
release_scope:
  canary_percent: 5
  traffic: renewal quotes for auto policies in supported states
  exclusion: manually underwritten policies and policies with active complaints
reviewers:
  - group: pricing-product
    required: true
  - group: actuarial-review
    required: true
  - group: privacy-review
    required: true
  - group: ml-platform-release
    required: true
rollback:
  owner: pricing-oncall
  target_version: 24
  steps:
    - disable feature flag pricing_model_v27_canary
    - set registry alias canary back to version 24
    - verify quote service p95 latency and error rate for 30 minutes
```

The ticket creates accountability. If pricing approves the customer impact, that approval appears with a person or group, a timestamp, and a comment. If privacy approves the data boundary, the decision links to the privacy review. If the platform owner approves the release mechanics, the ticket links to the CI run and deployment plan.

The ticket should also record rejection or deferral. A rejected model version still teaches the team something. Maybe segment error was too high for drivers in one region. Maybe the dataset included a column that the privacy team had not approved for pricing. Maybe the rollback plan lacked a tested command. Those outcomes belong in the ticket because future candidates should learn from them.

## Approval YAML
<!-- section-summary: A small approval file gives CI and reviewers the same source for required evidence, owners, and gates. -->

A ticket is useful for workflow, while a versioned approval file is useful for repeatability. HarborShield stores `governance/approval.yaml` beside the model release code. The file describes required evidence, reviewer groups, and threshold checks for this model family. Reviewers can read it. CI can parse it. Auditors can see how approval rules changed over time.

```yaml
model_id: renewal_price_adjustment
risk_tier: high
owner:
  business: pricing-product
  technical: ml-pricing-platform
  incident: pricing-oncall
approval_policy:
  allowed_targets:
    - staging-shadow
    - production-canary
    - production-full
  required_reviewers:
    production-canary:
      - pricing-product
      - actuarial-review
      - privacy-review
      - ml-platform-release
    production-full:
      - pricing-product
      - actuarial-review
      - privacy-review
      - security-review
      - ml-platform-release
minimum_evidence:
  - model_card
  - data_snapshot_manifest
  - data_quality_report
  - segment_evaluation
  - calibration_report
  - quote_impact_simulation
  - privacy_review
  - artifact_digest
  - rollback_plan
  - monitoring_plan
thresholds:
  quote_error_mae_delta_max: 0.000
  calibration_error_delta_max: 0.000
  max_segment_price_lift_delta_max: 0.030
  p95_prediction_latency_ms_max: 80
```

The policy file gives a stable contract. The model team can change the candidate version, yet the review requirements stay consistent until the policy itself changes through code review. That helps new team members because approval no longer depends on asking the right person in chat.

Several fields deserve attention. `required_reviewers` changes by target environment because a staging shadow test carries less production risk than full traffic. `minimum_evidence` names evidence classes rather than one-off filenames, so the same policy can apply to many versions. `thresholds` uses direction-aware names, which reduces confusion during automation.

## Automated Gates
<!-- section-summary: Automated gates block releases when required evidence, approvals, thresholds, or artifact integrity checks are missing. -->

Human reviewers should focus on judgment. Automation should handle repeatable checks. If a packet lacks a rollback target, a required report, an artifact digest, or a privacy approval, the release system should fail before the deployment step. That saves reviewer time and keeps incomplete packets out of production.

HarborShield runs a gate in CI before the production environment approval. The script reads the approval policy and release packet, checks required fields, verifies thresholds, and prints a release evidence summary.

```python
import sys
import yaml

policy = yaml.safe_load(open("governance/approval.yaml"))
packet = yaml.safe_load(open("governance/release-packet.yaml"))

missing = [
    item
    for item in policy["minimum_evidence"]
    if item not in packet.get("evidence", {})
]

if missing:
    sys.exit(f"release packet missing evidence: {missing}")

if packet["controls"]["rollback_target_version"] is None:
    sys.exit("rollback target version is required")

for reviewer in policy["approval_policy"]["required_reviewers"]["production-canary"]:
    decision = packet["approvals"].get(reviewer, {}).get("decision")
    if decision != "approved":
        sys.exit(f"{reviewer} has not approved production-canary")

checks = {
    "quote_error_mae_delta_max": packet["evaluation"]["quote_error_mae_delta"],
    "calibration_error_delta_max": packet["evaluation"]["calibration_error_delta"],
    "max_segment_price_lift_delta_max": packet["evaluation"]["max_segment_price_lift_delta"],
    "p95_prediction_latency_ms_max": packet["runtime"]["p95_prediction_latency_ms"],
}

for threshold_name, observed in checks.items():
    limit = policy["thresholds"][threshold_name]
    if observed > limit:
        sys.exit(f"{threshold_name} failed: observed={observed} limit={limit}")

print("approval gate passed for", packet["approval_packet_id"])
```

The script is small, yet it encodes the release discipline. A production job should never guess whether a model was approved. It should verify a packet, a policy, reviewer decisions, and artifact identity. A more mature version might also call the model registry API, check container signatures, verify object-store digests, and attach the gate output to the ticket.

A GitHub Actions workflow can make the gate visible.

```yaml
name: pricing-model-release

on:
  workflow_dispatch:
    inputs:
      approval_packet:
        required: true
        type: string

jobs:
  approval-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v5
      - name: Validate approval evidence
        run: python tools/check_approval_packet.py "${{ inputs.approval_packet }}"
      - name: Write release summary
        run: python tools/write_release_summary.py "${{ inputs.approval_packet }}"
```

The `id-token: write` permission is useful when the workflow exchanges a short-lived OpenID Connect token for cloud access. That pattern keeps release automation away from long-lived cloud keys. The exact cloud role setup changes by provider, so the important review point is whether the workflow uses a scoped release identity and whether that identity can only read the packet, update approved registry aliases, and write release events.

## Production Handoff
<!-- section-summary: Approval only matters in production when the registry, serving config, artifact store, and release logs use the approved version. -->

After approval, the deployment path should move one controlled pointer. HarborShield uses a registry alias for the canary target. The serving service reads the alias instead of a raw object-store path. That gives the release workflow one place to promote or roll back a model version.

```python
from mlflow import MlflowClient

client = MlflowClient(registry_uri="databricks-uc")

model_name = "pricing_prod.models.renewal_price_adjustment"
approved_version = "27"

client.set_model_version_tag(
    name=model_name,
    version=approved_version,
    key="approval_packet_id",
    value="hs-pricing-2026-07-v27",
)
client.set_model_version_tag(
    name=model_name,
    version=approved_version,
    key="release_ticket",
    value="MLREL-1842",
)
client.set_registered_model_alias(
    name=model_name,
    alias="canary",
    version=approved_version,
)
```

The handoff should also write a release event. Registry tags help future readers, while a release event gives incident responders a timeline. HarborShield writes one row every time an alias changes.

```sql
INSERT INTO ml_audit.model_release_events (
  release_event_id,
  release_ticket,
  approval_packet_id,
  model_name,
  model_version,
  previous_model_version,
  alias_name,
  action,
  actor,
  ci_run_url,
  event_time
)
VALUES (
  'rel-hs-pricing-20260708-v27',
  'MLREL-1842',
  'hs-pricing-2026-07-v27',
  'pricing_prod.models.renewal_price_adjustment',
  27,
  24,
  'canary',
  'assign_alias',
  'github-actions:pricing-model-release',
  'https://github.com/harborshield/ml-pricing/actions/runs/9928188',
  CURRENT_TIMESTAMP
);
```

The release evidence check after deployment should be boring and explicit.

```bash
python tools/check_registry_alias.py \
  --model pricing_prod.models.renewal_price_adjustment \
  --alias canary \
  --expected-version 27

python tools/check_release_event.py \
  --release-ticket MLREL-1842 \
  --approval-packet hs-pricing-2026-07-v27

python tools/check_canary_metrics.py \
  --dashboard pricing-renewal-canary \
  --max-error-rate 0.005 \
  --max-p95-latency-ms 80
```

Those commands prove that the approved version reached the serving path, the audit row was written, and the canary is healthy enough for the first observation window. The team still needs human judgment for customer impact, yet the mechanical facts should be easy to verify.

![HarborShield approval gate canary rollback](/content-assets/articles/article-mlops-governance-and-responsible-ai-who-approved-this-model/approval-gate-canary-rollback.png)

*The approval gate checks evidence, reviewer decisions, and thresholds before the canary alias points to `v27`, while latency, error rate, and rollback to `v24` stay visible during release.*

## Audit Logs and Review Cadence
<!-- section-summary: Approval records need audit logs and scheduled review because model risk continues after the release date. -->

Approval is a point-in-time decision. The audit trail keeps the decision explainable later. HarborShield keeps approval packets, release tickets, CI summaries, registry events, object-store access logs, and serving metrics for the retention window agreed with risk and legal teams. The records should answer who approved the version, who changed the alias, which identity downloaded the artifact, and which prediction service used the version.

For cloud and platform logs, the useful events include registry updates, object-store writes, policy changes, deployment job runs, and role assumptions. On AWS, CloudTrail records account activity from APIs, SDKs, CLI, and console actions. On Databricks or another managed ML platform, audit tables or account logs can show registry, serving, and permission events. The exact query changes by platform, yet the investigation question stays stable: who changed the production path near the release?

HarborShield also schedules review. A high-risk pricing model receives a 90-day review even when no incident occurs. The review checks whether model performance still matches the approved evidence, whether segments shifted, whether customer complaints changed, whether the data boundary changed, and whether the rollback target still exists. If the model needs retraining, the next version goes through the same packet and approval path.

## Practical Checks, Mistakes, and Interview Understanding
<!-- section-summary: A healthy approval workflow connects evidence, reviewers, release gates, registry state, and audit records. -->

Use these checks when you review a model approval workflow:

| Check | What you want to see |
| --- | --- |
| Version identity | Model name, version, run id, commit, image digest, and dataset snapshot agree across packet, registry, and ticket. |
| Risk path | The approval policy changes review depth based on environment and risk tier. |
| Evidence | Metrics, segment checks, model card, data review, security review, rollback, and monitoring links are present. |
| Approvers | Required groups have recorded decisions, timestamps, and comments. |
| Release gate | CI blocks missing evidence, failed thresholds, missing rollback, and unapproved decisions. |
| Handoff | Serving reads the registry alias or approved model reference rather than a loose artifact path. |
| Audit | Alias changes, deployment runs, artifact reads, and ticket decisions leave records. |

Common mistakes have a pattern. Teams approve a slide deck while the deployment uses a different version. They record approval in chat and lose the thread during an incident. They skip rollback verification because the canary seems small. They allow the training role to update production aliases. They let a ticket say "approved" without linking to the packet, model registry version, and CI evidence.

Interview-ready understanding sounds like this: model approval is a controlled release decision for a specific model version. A strong answer mentions evidence packets, risk tier, named approvers, release tickets, automated gates, registry aliases, rollback target, and audit logs. The practical goal is simple: when someone asks who approved this model, the team can point to durable evidence and show exactly what reached production.

## References

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) - Primary framework for AI risk functions such as Govern, Map, Measure, and Manage.
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) - Official MLflow guide for registered models, versions, aliases, and tags.
- [Databricks: Manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/) - Official Databricks guidance for governed model lifecycle workflows.
- [GitHub Actions: OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Official GitHub guidance for short-lived cloud authentication from workflows.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Official AWS guide for account activity audit trails.
