---
title: "Model Governance"
description: "Define model governance as the operating system for ownership, evidence, risk decisions, approval, monitoring, and rollback."
overview: "Model governance gives every production model a clear owner, a risk tier, an evidence packet, an approval path, and a record of how the team will monitor and retire it. This article builds that workflow through one governed healthcare readmission model without turning the topic into legal advice."
tags: ["MLOps", "production", "audit"]
order: 1
id: "article-mlops-governance-and-responsible-ai-model-governance-explained"
---

## Table of Contents

1. [What Model Governance Means](#what-model-governance-means)
2. [The Governance Map](#the-governance-map)
3. [Owners, Risk Tiers, and Decision Rights](#owners-risk-tiers-and-decision-rights)
4. [The Evidence Packet](#the-evidence-packet)
5. [Policies That Automation Can Check](#policies-that-automation-can-check)
6. [Registry Controls and Model Handoff](#registry-controls-and-model-handoff)
7. [Monitoring, Review, and Retirement](#monitoring-review-and-retirement)
8. [Failure Modes](#failure-modes)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

Model governance means **the way a team decides which models are allowed to affect real users, what evidence supports that decision, who owns the model after release, and how the model gets changed or removed later**. In plain English, it is the operating routine around the model, not only the model file itself.

Imagine a care coordination team at BrightLine Clinics. They train a model called `readmission_30d` that predicts which patients may need extra follow-up after discharge. The model does not make a final medical decision by itself, and clinicians still decide what care to provide. Even so, the model influences who receives attention first, so the team needs a careful record of data, evaluation, privacy review, approvals, monitoring, and rollback.

That is the spine for this article: a model starts as a useful idea, governance gives it a defined risk path, the team builds an evidence packet, automation checks the packet, the registry controls the handoff, and operations keeps watching the model after launch.

## What Model Governance Means
<!-- section-summary: Model governance connects model work to ownership, evidence, approvals, and operations. -->

When people first hear governance, they often picture a big committee that slows everything down. A real production team needs something more practical. Governance answers the questions that show up the moment a model leaves a notebook: who owns this model, which users or customers can be affected, what evidence says it is ready, who approved the release, what logs prove the release happened correctly, and what the team will do if the model harms the product.

For BrightLine, the model governance question is simple enough to say out loud. If `readmission_30d` starts ranking patients for follow-up, the team needs to know which dataset trained it, which patient groups were checked, which threshold was chosen, which clinician workflow receives the prediction, which privacy controls protect the data, and who can approve a production alias change. Each answer needs a durable record because the question may come back during an incident, a customer complaint, an internal audit, or a routine model review.

The NIST AI Risk Management Framework is useful here because it organizes AI risk work into four functions: **Govern, Map, Measure, and Manage**. In a production MLOps team, those words translate into daily engineering work. Govern names roles and policies. Map describes where the model is used and who can be affected. Measure collects evaluation and monitoring evidence. Manage turns the evidence into release, rollback, and improvement decisions.

This article avoids legal advice. Treat the examples as engineering governance patterns that help your legal, security, privacy, product, and compliance partners review the system with better evidence.

## The Governance Map
<!-- section-summary: A governance map gives the team a shared view of the model, the decision, the evidence, and the operating loop. -->

Before the team writes policy files or registry permissions, they need a shared map of what governance actually covers. The map is useful because model risk travels across many systems. Training data lives in a warehouse or lakehouse. Experiments live in MLflow or another tracking system. Model artifacts live in a registry. Release approval may live in GitHub, Jira, ServiceNow, or a model risk tool. Runtime logs live in the serving platform and observability stack.

Here is the BrightLine governance map for `readmission_30d`.

| Governance area | Plain-English question | BrightLine example |
| --- | --- | --- |
| Purpose | What decision does the model support? | Rank recently discharged patients for care coordinator review. |
| Owner | Who answers for the model after release? | `care-ml-owner@brightline.example` owns model health and review cadence. |
| Risk tier | How much harm can a wrong prediction cause? | High, because the ranking influences follow-up attention. |
| Data boundary | Which data trained and feeds the model? | Discharge summaries, prior visit counts, diagnosis group, appointment history. |
| Evidence | What proves the model was tested? | Validation metrics, subgroup checks, data quality report, model card, privacy review. |
| Approval | Who can accept the release risk? | Product lead, clinical safety reviewer, privacy reviewer, ML platform approver. |
| Runtime control | Which version serves traffic? | Unity Catalog model `health_prod.risk.readmission_30d` with a production alias. |
| Monitoring | How does the team watch it? | Daily prediction volume, segment recall checks, drift checks, override rate, incidents. |
| Retirement | How does the team stop using it? | Remove production alias, deploy rules fallback, archive evidence, close owner review. |

![BrightLine readmission governance map](/content-assets/articles/article-mlops-governance-and-responsible-ai-model-governance-explained/brightline-governance-map.png)

*BrightLine’s governance map keeps purpose, ownership, risk, evidence, approval, and monitoring connected to the same `readmission_30d` release path.*

The map makes the next sections easier to follow. Ownership decides who signs and maintains evidence. Risk tier decides how much evidence and approval the team needs. Evidence feeds the approval packet. The registry and serving layer enforce the approved version. Monitoring checks that the approved version still behaves inside the agreed boundary.

## Owners, Risk Tiers, and Decision Rights
<!-- section-summary: Governance needs named owners and risk tiers before approval rules can mean anything. -->

An **owner** is the person or group responsible for the model as a production system. That responsibility includes technical health, evidence quality, review cadence, incident response, and retirement. A model can have several contributors, but it needs one accountable owner group so questions do not bounce between data science, platform, product, and security.

A **risk tier** is a plain label that tells the team how careful the release path must be. Many companies use labels such as low, medium, high, and critical. The names matter less than the rule behind them. A low-risk movie recommendation experiment may need basic offline metrics and a product owner approval. A high-risk readmission triage model may need subgroup performance checks, privacy review, human workflow review, documented fallback, and a scheduled re-review.

BrightLine writes the ownership and tier in a small policy file stored beside the training pipeline. This file is boring in the best way. It gives CI, reviewers, and auditors one place to find the release expectations.

```yaml
model_id: readmission_30d
business_owner: care-coordination
technical_owner: ml-platform-risk
risk_tier: high
supported_decision: discharge follow-up prioritization
human_review_required: true
review_cycle_days: 90
approval_groups:
  - care-product-leads
  - clinical-safety-reviewers
  - privacy-reviewers
  - ml-platform-approvers
minimum_evidence:
  - model_card
  - data_quality_report
  - subgroup_evaluation
  - privacy_review
  - rollback_plan
  - monitoring_plan
```

The important part is the connection between the tier and the work. The team avoids arguing from scratch every time someone trains a new version. A high-risk model version needs the same evidence classes each time, and the release can wait until the packet is complete.

Decision rights also need names. The business owner accepts product impact. The technical owner accepts runtime health. The privacy reviewer checks the data boundary and retention plan. The clinical safety reviewer checks workflow impact and failure response. The platform approver checks registry permissions, serving config, observability, and rollback. These are engineering decision points, and legal or compliance teams may add separate requirements for regulated environments.

## The Evidence Packet
<!-- section-summary: An approval packet turns scattered model work into a single reviewable release record. -->

The **evidence packet** is the bundle of records that explains one proposed model release. It should let a reviewer answer a practical question without opening ten dashboards and guessing which run matters. For BrightLine, the packet points to the exact model version, the exact training run, the exact dataset snapshot, the evaluation report, the risk review, and the rollback plan.

In a modern MLOps stack, most of this evidence already exists. MLflow records parameters, metrics, artifacts, and model signatures. Databricks Unity Catalog can govern registered models, centralize permissions, and expose lineage for data and AI assets. The governance job is to connect those records into a packet with enough structure that humans and automation can check it.

Here is a compact release packet that BrightLine stores as `governance/release-packet.yaml` for model version 17.

```yaml
release_packet_id: rp-readmission-2026-07-02-v17
model:
  name: health_prod.risk.readmission_30d
  version: 17
  proposed_alias: candidate
  serving_endpoint: readmission-risk-prod
training_run:
  mlflow_run_id: 5a7f2e9c4d8f4f5a9c21
  git_commit: 41c9d7a
  image_digest: sha256:8d24a8d679f2
data:
  feature_table: health_prod.features.discharge_features
  label_table: health_prod.labels.readmission_30d
  cutoff_date: "2026-06-01"
  pii_review_id: privacy-2026-188
evaluation:
  overall_auroc: 0.842
  recall_high_risk: 0.730
  min_segment_recall: 0.681
  calibration_report: reports/calibration-v17.html
controls:
  human_review_required: true
  fallback_owner: care-ops-oncall
  rollback_target_version: 15
approvals:
  product: pending
  clinical_safety: pending
  privacy: pending
  ml_platform: pending
```

The packet has two jobs. First, it tells the story of the release. Second, it gives automation fields to validate. For example, CI can check that `git_commit` matches the workflow run, that the model version exists in the registry, that the required reports are attached, and that `min_segment_recall` meets the policy for a high-risk release.

The training code should also create model evidence in a way the registry and reviewers can use later. A model signature matters because it records the expected input and output shape. An input example matters because it gives future reviewers a concrete request shape. Databricks requires signatures for models registered in Unity Catalog, so the governance path should capture them during logging instead of trying to reconstruct them during approval.

```python
import mlflow
from mlflow.models import infer_signature

mlflow.set_registry_uri("databricks-uc")

feature_columns = [
    "age_band",
    "prior_visits_30d",
    "diagnosis_group",
    "length_of_stay_days",
    "missed_appointments_180d",
]

input_example = training_frame[feature_columns].head(5)
signature = infer_signature(input_example, model.predict_proba(input_example))

with mlflow.start_run(run_name="readmission-risk-xgb-2026-07-02"):
    mlflow.log_params(
        {
            "model_family": "xgboost",
            "max_depth": 4,
            "training_cutoff": "2026-06-01",
            "risk_tier": "high",
        }
    )
    mlflow.log_metrics(
        {
            "validation_auroc": 0.842,
            "recall_high_risk": 0.730,
            "min_segment_recall": 0.681,
        }
    )
    mlflow.set_tags(
        {
            "model_id": "readmission_30d",
            "business_owner": "care-coordination",
            "release_packet_id": "rp-readmission-2026-07-02-v17",
        }
    )
    mlflow.xgboost.log_model(
        model,
        name="readmission_model",
        input_example=input_example,
        signature=signature,
        registered_model_name="health_prod.risk.readmission_30d",
    )
```

The details here are governance details, not decoration. `risk_tier` connects the run to the approval policy. `release_packet_id` lets an audit trail join the model run to the review record. `registered_model_name` gives the registry a stable governed object instead of a loose file path.

![BrightLine release packet policy checks](/content-assets/articles/article-mlops-governance-and-responsible-ai-model-governance-explained/release-packet-policy-checks.png)

*The release packet gives reviewers one place to inspect the run, data snapshot, subgroup result, privacy review, and rollback target before policy checks pass the model toward handoff.*

## Policies That Automation Can Check
<!-- section-summary: Policy checks keep governance repeatable by turning release rules into validations. -->

Human review stays important, especially for purpose, impact, privacy, and workflow questions. The repeatable checks should move into automation because reviewers should not waste their attention on missing files and obvious threshold failures. A policy check can fail early when a required report is missing, a model has no signature, a high-risk packet lacks a rollback plan, or the proposed version has no owner.

BrightLine keeps a tiny policy checker in CI. It reads the packet, validates required fields, asks MLflow for the registered model details, and blocks release if the packet cannot support review. The example below is intentionally small, because the value comes from the shape of the check.

```python
import sys
import yaml

REQUIRED_FOR_HIGH_RISK = {
    "model_card",
    "data_quality_report",
    "subgroup_evaluation",
    "privacy_review",
    "rollback_plan",
    "monitoring_plan",
}

packet = yaml.safe_load(open("governance/release-packet.yaml"))
policy = yaml.safe_load(open("governance/model-policy.yaml"))

missing = REQUIRED_FOR_HIGH_RISK.difference(set(policy["minimum_evidence"]))
if policy["risk_tier"] == "high" and missing:
    sys.exit(f"missing required evidence classes: {sorted(missing)}")

if packet["evaluation"]["min_segment_recall"] < 0.67:
    sys.exit("min_segment_recall is below the high-risk release threshold")

if packet["controls"]["rollback_target_version"] is None:
    sys.exit("rollback_target_version must be set before production approval")

if packet["approvals"]["privacy"] != "approved":
    sys.exit("privacy approval is still pending")
```

This kind of script should stay close to the release pipeline. It should produce clear failure messages, and it should write its result back into the packet or CI summary. The point is traceability. When version 17 reaches production, the team can show the policy version, the packet version, the CI run, and the model version that passed together.

Policy checks can also run inside a deployment gate. A GitHub Actions workflow can require the packet check before the job targets a production environment. GitHub environments can add required reviewers and deployment protection rules, so the automated evidence check and human approval sit in the same release path.

## Registry Controls and Model Handoff
<!-- section-summary: The model registry turns governance decisions into controlled access to a concrete model version. -->

The model registry is where governance starts to affect runtime. A registry gives the team a named model, versions, metadata, aliases, permissions, and links back to training evidence. In Databricks, Unity Catalog is the modern governance surface for registered models. It brings centralized access control, auditing, lineage, and discovery to models along with data assets.

For BrightLine, the registry object is `health_prod.risk.readmission_30d`. The environment path matters. A development model can live in `health_dev.risk`. A candidate for review can live in `health_staging.risk`. The approved production model lives in `health_prod.risk`, and only the serving identity can execute it. The people who trained the model do not need direct production serving permissions.

Unity Catalog registered models use the privileges model for securable objects. In SQL, a team grants model execution through `GRANT EXECUTE ON FUNCTION` because registered models are handled as functions in this permissions path.

```sql
GRANT EXECUTE ON FUNCTION health_prod.risk.readmission_30d
TO `serving-readmission-prod`;

GRANT MANAGE ON FUNCTION health_prod.risk.readmission_30d
TO `ml-governance-admins`;

SHOW GRANTS ON FUNCTION health_prod.risk.readmission_30d;
```

Those grants express the handoff. The production endpoint can load the model. The governance admins can manage permissions. Data scientists can still train and propose versions in a lower environment, and approval controls the move toward production. This separation matters because a governed release should not rely on everyone being careful with a shared artifact path.

Aliases help the serving layer target an approved version without hardcoding a version number in application code. In MLflow, an alias such as `champion` can point to the version serving production traffic, and the team can reassign that alias during promotion or rollback. In Unity Catalog, Databricks recommends aliases and environment namespaces for model lifecycle workflows rather than older fixed registry stages.

## Monitoring, Review, and Retirement
<!-- section-summary: Governance continues after launch through monitoring, review cadence, and a planned removal path. -->

A model release is a promise to keep watching. BrightLine sets a 90-day review cycle for `readmission_30d`, and the monitoring plan covers operational health, data quality, model performance, and human workflow signals. The team checks prediction volume because a sudden drop may mean the endpoint stopped receiving traffic. They check input drift because the discharge population can shift. They check override rate because clinicians may see a pattern the offline metrics missed.

A practical monitoring table might look like this in the warehouse.

```sql
CREATE TABLE IF NOT EXISTS ml_observability.readmission_predictions (
  prediction_id STRING,
  model_name STRING,
  model_version INT,
  model_alias STRING,
  request_time TIMESTAMP,
  patient_cohort STRING,
  risk_score DOUBLE,
  recommended_queue STRING,
  clinician_override BOOLEAN,
  label_readmitted_30d BOOLEAN,
  label_available_at TIMESTAMP
);
```

The schema includes the fields needed for governance questions. `model_version` and `model_alias` tell the team which model served the prediction. `patient_cohort` supports segment checks. `clinician_override` shows whether users trusted the recommendation. The delayed label fields let the team evaluate the model after enough time passes.

The review meeting should use evidence, not memory. The owner brings the last packet, the current metrics, incidents, drift checks, data changes, support tickets, and proposed actions. The outcome should update the model record: keep serving, retrain, change threshold, add monitoring, restrict scope, or retire. Retirement needs a clean path too. The team removes the production alias, deploys the fallback queueing rule, archives the evidence packet, records the reason, and closes any access grants that only existed for the retired model.

![BrightLine monitoring review retirement loop](/content-assets/articles/article-mlops-governance-and-responsible-ai-model-governance-explained/monitor-review-retire-loop.png)

*The post-launch loop ties prediction volume, segment recall, override rate, scheduled review, action choices, and archived evidence back to the governed model record.*

## Failure Modes
<!-- section-summary: Governance fails when evidence, ownership, approval, and runtime controls drift apart. -->

The first common failure is an orphan model. The original data scientist leaves, the endpoint still runs, and nobody owns review. The fix is to make ownership a required field in the policy and to alert when the owner group has no active members. A model inventory should show every production model, owner, risk tier, serving endpoint, last review date, and next review date.

The second failure is a beautiful report attached to the wrong version. This happens when people upload PDFs manually after training. The fix is to make the release packet reference immutable run ids, model versions, git commits, and container digests. A reviewer should see the same identifiers in the packet, MLflow run, registry version, CI log, and serving deployment.

The third failure is approval without runtime control. A committee approves version 17, while the endpoint can still load any model from a shared bucket. The fix is registry-backed serving with least-privilege execution grants, immutable artifacts, alias changes through deployment workflow, and audit logs for permission or alias changes.

The fourth failure is review without action. Teams schedule quarterly reviews, see drift, and move on because no one owns the response. A useful review ends with one of a small set of actions: continue, retrain, restrict, rollback, or retire. Each action needs an owner and due date because governance only helps when it changes operations.

## Putting It Together
<!-- section-summary: A governed model has a named owner, a risk tier, a packet, a controlled handoff, monitoring, and a retirement path. -->

Model governance turns a model from a promising artifact into an operated production system. The workflow starts by naming the purpose, owner, and risk tier. It continues through an evidence packet that ties together data, run, code, metrics, privacy review, approvals, and rollback. Automation checks the packet so reviewers can focus on judgment. The registry enforces the handoff with permissions, versions, aliases, and audit logs. Monitoring and review keep the model inside the boundary the team approved.

For BrightLine, the readmission model is ready for review only when the packet can answer the practical questions: what is the model for, who owns it, which version is proposed, what data trained it, what tests passed, which groups reviewed it, how production will load it, what telemetry will catch problems, and how the team will roll back. That is model governance in the hands of an engineering team.

## References

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
- [NIST AI RMF Playbook](https://airc.nist.gov/airmf-resources/playbook/)
- [Databricks: Manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [Databricks: Manage privileges in Unity Catalog](https://docs.databricks.com/aws/en/data-governance/unity-catalog/manage-privileges/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [MLflow Model Signatures and Input Examples](https://mlflow.org/docs/latest/ml/model/signatures/)
- [GitHub Docs: Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
