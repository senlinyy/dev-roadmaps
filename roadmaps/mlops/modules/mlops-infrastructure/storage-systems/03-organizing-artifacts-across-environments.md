---
title: "Artifact Promotion"
description: "Show naming, promotion, and isolation practices for stored ML assets."
overview: "Learn how to organize ML artifacts across dev, training, staging, and production so model releases are traceable, isolated, and reversible."
tags: ["MLOps", "production", "storage"]
order: 3
id: "article-mlops-mlops-infrastructure-organizing-artifacts-across-environments"
---

## Artifact Promotion Is A Release System
<!-- section-summary: ML artifacts are the files and records that let a model move from experiment to production: model weights, serialized pipelines, tokenizer files, evaluation reports, data... -->

ML artifacts are the files and records that let a model move from experiment to production: model weights, serialized pipelines, tokenizer files, evaluation reports, data snapshots, signatures, container digests, feature configs, and approval evidence. Artifact promotion is the process that decides which of those assets can move from one environment to the next.

Imagine `MapleCart Search`, an ecommerce team training a ranking model. A researcher trains many candidates. The training pipeline writes metrics and artifacts. A release owner approves one candidate. Staging tests the model behind a replay set. Production serves the approved version to shoppers. If every artifact lands in one shared bucket called `models/`, the team will eventually ship the wrong file or lose the evidence behind a release.

Artifact promotion gives you a controlled path:

```plaintext
experiment -> candidate -> staging -> production -> archived
```

Each step should add evidence. A candidate has training metadata. A staging artifact has integration results. A production artifact has approval and rollout records. An archived artifact has retention and rollback meaning.

![MapleCart promotion path](/content-assets/articles/article-mlops-mlops-infrastructure-organizing-artifacts-across-environments/maplecart-promotion-path.png)

*MapleCart adds evidence at each step, so production version 42 carries metrics, a manifest, replay checks, approval, and a rollback record.*

## Separate The Registry From The Blob Store
<!-- section-summary: A model registry and an object store solve related problems, but they are not the same thing. -->

A model registry and an object store solve related problems, but they are not the same thing.

| System | What it stores | Why it matters |
|---|---|---|
| Object store | Files: model binaries, reports, datasets, manifests | Durable artifact bytes, large files, lifecycle rules |
| Model registry | Names, versions, aliases, tags, descriptions, links | Human and automated release decisions |
| Metadata store | Runs, parameters, metrics, lineage, approvals | Reproducibility and audit trail |

In a simple setup, MLflow can track runs, store artifacts, and register models. In a larger platform, you might use MLflow with S3, Azure Blob Storage, Google Cloud Storage, Databricks Unity Catalog, or a cloud provider registry. The pattern stays the same: immutable bytes in storage, release meaning in metadata.

## Use Stable Names And Immutable Versions
<!-- section-summary: Artifact names should help people and tools answer basic questions:. -->

Artifact names should help people and tools answer basic questions:

- Which model is this?
- Which environment can read it?
- Which version or run produced it?
- Which data snapshot and code commit produced it?
- Which files belong together?

A practical object-store layout:

```plaintext
s3://maplecart-ml-artifacts/
  experiments/
    search-ranker/
      run_id=7c1b2e/
        model/
        metrics.json
        evaluation.html
        feature_config.yml
  candidates/
    search-ranker/
      version=42/
        manifest.json
        model/
        reports/
  staging/
    search-ranker/
      version=42/
        manifest.json
  production/
    search-ranker/
      version=41/
        manifest.json
      version=42/
        manifest.json
  archive/
    search-ranker/
      year=2026/
```

Avoid names like `latest.pkl`, `final_model.pkl`, or `new_model_v2_really_final.pkl`. A human can guess wrong, and automation will guess faster.

Use a manifest to tie files together:

```json
{
  "model_name": "search-ranker",
  "version": "42",
  "run_id": "7c1b2e",
  "git_sha": "d4a91f8",
  "data_snapshot": "search-training-2026-06-30",
  "feature_config_hash": "sha256:bb01...",
  "artifact_uri": "s3://maplecart-ml-artifacts/candidates/search-ranker/version=42/model",
  "metrics_uri": "s3://maplecart-ml-artifacts/candidates/search-ranker/version=42/reports/metrics.json",
  "created_by": "scheduled-training",
  "created_at": "2026-07-05T02:31:00Z"
}
```

The manifest should be immutable after creation. If the model changes, create a new version.

## Promote With Copy Or Alias, Not Guesswork
<!-- section-summary: There are two common promotion styles:. -->

There are two common promotion styles:

- Copy immutable artifacts into environment-specific prefixes.
- Keep one immutable artifact location and move a registry alias or deployment reference.

Both can work. Copying creates a clear storage boundary. Aliases reduce duplicate bytes and can simplify serving. Many teams combine them: copy release evidence into an environment prefix, then update a registry alias for deployment.

With MLflow aliases:

```python
from mlflow import MlflowClient

client = MlflowClient()

client.set_model_version_tag(
    name="search-ranker",
    version="42",
    key="pre_deploy_checks",
    value="passed",
)

client.set_registered_model_alias(
    name="search-ranker",
    alias="staging",
    version="42",
)
```

After staging passes:

```python
client.set_registered_model_alias(
    name="search-ranker",
    alias="champion",
    version="42",
)
```

Current Databricks Unity Catalog model guidance also favors aliases and environment-aware names instead of older fixed stages. That is useful because you can represent release state in a way that matches your own environments.

## Keep Environments Isolated
<!-- section-summary: Promotion should cross a boundary intentionally. Development should write to development paths. Training should write candidates. Production serving should read approved artifacts. -->

Promotion should cross a boundary intentionally. Development should write to development paths. Training should write candidates. Production serving should read approved artifacts.

Example bucket policy intent:

```yaml
principals:
  ml-dev-notebooks:
    allow:
      - "read: s3://maplecart-ml-artifacts/dev/*"
      - "write: s3://maplecart-ml-artifacts/experiments/*"
  scheduled-training:
    allow:
      - "read: s3://maplecart-training-snapshots/approved/*"
      - "write: s3://maplecart-ml-artifacts/candidates/*"
  cd-promotion:
    allow:
      - "read: s3://maplecart-ml-artifacts/candidates/*"
      - "write: s3://maplecart-ml-artifacts/staging/*"
      - "write: s3://maplecart-ml-artifacts/production/*"
  production-serving:
    allow:
      - "read: s3://maplecart-ml-artifacts/production/*"
```

The production service should have no write permission to candidate artifacts. A notebook should have no write permission to production artifacts. This rule saves teams from a surprising number of release accidents.

## Store Evidence Next To The Artifact
<!-- section-summary: The model file alone is rarely enough. Store the evidence needed for approval, debugging, and rollback:. -->

The model file alone is rarely enough. Store the evidence needed for approval, debugging, and rollback:

```plaintext
version=42/
  manifest.json
  model/
  reports/
    offline-metrics.json
    segment-metrics.json
    drift-baseline.json
    robustness-report.md
  approvals/
    release-ticket.json
    risk-signoff.json
  deployment/
    image-digest.txt
    staging-smoke-test.json
    production-canary.json
```

This structure lets a reviewer inspect the release without hunting across a notebook, a dashboard, and a chat thread. The registry can link to these files through tags:

```python
client.set_model_version_tag("search-ranker", "42", "data_snapshot", "search-training-2026-06-30")
client.set_model_version_tag("search-ranker", "42", "git_sha", "d4a91f8")
client.set_model_version_tag("search-ranker", "42", "release_ticket", "MLREL-512")
client.set_model_version_tag("search-ranker", "42", "manifest_uri", "s3://maplecart-ml-artifacts/production/search-ranker/version=42/manifest.json")
```

Tags should point to evidence; they should not replace the evidence.

![MapleCart environment evidence](/content-assets/articles/article-mlops-mlops-infrastructure-organizing-artifacts-across-environments/maplecart-environment-evidence.png)

*The promotion boundary is useful because each environment has a different writer or reader, while the production evidence folder keeps metrics, approvals, image digest, and feature config together.*

## Version Datasets And Derived Features
<!-- section-summary: Model promotion can fail when the model is approved but the matching feature definition is missing. Treat feature configs, preprocessing code, tokenizers, encoders, schemas,... -->

Model promotion can fail when the model is approved but the matching feature definition is missing. Treat feature configs, preprocessing code, tokenizers, encoders, schemas, and data snapshots as release artifacts.

For a ranking model, the manifest might include:

```json
{
  "features": {
    "feature_config_uri": "s3://maplecart-ml-artifacts/production/search-ranker/version=42/feature_config.yml",
    "schema_uri": "s3://maplecart-ml-artifacts/production/search-ranker/version=42/schema.json",
    "training_snapshot": "delta://ml_training.search_ranker_snapshot@2026-06-30",
    "serving_feature_view": "search_ranker_online_v8"
  }
}
```

Now a deployment review can ask whether the production feature view matches the model. That is much safer than discovering a mismatch after traffic shifts.

## Verify What Production Actually Loads
<!-- section-summary: Artifact promotion should include a runtime verification step. A registry alias or storage copy tells you what the pipeline intended. The service itself tells you what users... -->

Artifact promotion should include a runtime verification step. A registry alias or storage copy tells you what the pipeline intended. The service itself tells you what users actually hit.

Add a version endpoint or metric to every model service:

```json
{
  "service": "maplecart-search-ranker",
  "model_name": "search-ranker",
  "model_version": "42",
  "model_alias": "champion",
  "manifest_sha256": "8b6d...",
  "image_digest": "sha256:bd71...",
  "feature_config_hash": "sha256:bb01...",
  "loaded_at": "2026-07-05T10:18:42Z"
}
```

After promotion, CD can query that endpoint:

```bash
curl -fsS https://search-ranker.prod.internal/version | jq .
```

It can also check metrics:

```promql
sum by (model_version) (
  rate(maplecart_search_predictions_total{environment="production"}[5m])
)
```

If the alias says version 42, but traffic metrics show version 41, you have a serving cache, rollout, or routing issue. Catching that mismatch during CD is far better than catching it during an incident.

![MapleCart production verification](/content-assets/articles/article-mlops-mlops-infrastructure-organizing-artifacts-across-environments/maplecart-production-verification.png)

*The final check compares release intent with the service version endpoint and traffic metric, then records version 41 as the rollback target if production needs to move back.*

## Use Lifecycle Rules Without Breaking Reproducibility
<!-- section-summary: Artifact stores can grow quickly. Use lifecycle policies, but separate short-lived artifacts from release artifacts. -->

Artifact stores can grow quickly. Use lifecycle policies, but separate short-lived artifacts from release artifacts.

| Artifact type | Example retention |
|---|---|
| Failed experiment scratch files | 14-30 days |
| Candidate artifacts with no approval | 60-180 days |
| Production model artifacts | As long as policy, audit, and rollback require |
| Evaluation reports for production releases | Match production model retention |
| Raw training snapshots | Follow data-governance retention rules |

S3 Lifecycle and Google Cloud Storage Object Lifecycle Management can transition or expire objects according to rules. Apply those rules by prefix, tag, or bucket. Be careful with production release artifacts: deleting a model file while keeping registry metadata creates a broken rollback path.

Example lifecycle intent:

```json
{
  "rules": [
    {
      "id": "expire-experiment-scratch",
      "prefix": "experiments/",
      "expire_after_days": 30
    },
    {
      "id": "transition-production-reports",
      "prefix": "production/",
      "transition_after_days": 90,
      "storage_class": "archive"
    }
  ]
}
```

Use your cloud provider's exact lifecycle syntax in real buckets. Keep this kind of policy reviewed by both platform and governance owners.

## Promotion Runbook
<!-- section-summary: A practical promotion runbook for MapleCart Search:. -->

A practical promotion runbook for MapleCart Search:

1. Confirm the candidate manifest exists and points to immutable files.
2. Confirm offline metrics and segment metrics passed.
3. Confirm the feature config hash matches the service config.
4. Copy or approve the candidate artifact into staging.
5. Run staging smoke tests and replay checks.
6. Attach staging evidence to the release ticket.
7. Update the production alias or production prefix only after approval.
8. Record the previous champion version as rollback target.
9. Verify the production service reports the expected model version.
10. Archive the release record with the model version.

The runbook sounds ordinary, which is the point. You want releases to feel repeatable rather than magical.

## A Tiny Promotion Script
<!-- section-summary: Even a small script can make promotion safer than manual console clicks:. -->

Even a small script can make promotion safer than manual console clicks:

```bash
#!/usr/bin/env bash
set -euo pipefail

MODEL_NAME="$1"
VERSION="$2"
SOURCE="s3://maplecart-ml-artifacts/candidates/${MODEL_NAME}/version=${VERSION}/"
DEST="s3://maplecart-ml-artifacts/staging/${MODEL_NAME}/version=${VERSION}/"

aws s3 cp "${SOURCE}manifest.json" /tmp/manifest.json
jq -e '.model_name and .version and .git_sha and .data_snapshot and .artifact_uri' /tmp/manifest.json

aws s3 sync "${SOURCE}" "${DEST}" --exact-timestamps

echo "promoted ${MODEL_NAME} version ${VERSION} to staging"
```

This is deliberately small. Real promotion tools add checksums, approval-ticket validation, registry updates, and audit logging. Still, the script shows the important habit: read the manifest first, verify required fields, then copy immutable release files into the next environment.

## A Promotion Failure Example
<!-- section-summary: Here is the kind of incident artifact promotion prevents. A ranking model passes offline evaluation, and a developer manually updates the production service to read... -->

Here is the kind of incident artifact promotion prevents. A ranking model passes offline evaluation, and a developer manually updates the production service to read `s3://maplecart-ml-artifacts/experiments/search-ranker/run_id=7c1b2e/model/`. The service works for two days. Then an experiment cleanup job deletes files under `experiments/` after 30 days. The next pod restart fails because the production model path vanished.

With a promotion process, that production service would read from `production/search-ranker/version=42/`, and lifecycle rules for production releases would follow the production retention policy. The experiment folder could still expire safely because production never depended on it.

This is why naming is not cosmetic. Storage layout encodes operational promises. A path that starts with `experiments/` tells the platform, "This can disappear." A path that starts with `production/` tells the platform, "This must remain available for serving, audit, and rollback."

## Common Mistakes
<!-- section-summary: Watch for these storage problems:. -->

Watch for these storage problems:

- One bucket prefix holds dev, candidate, staging, and production artifacts.
- Production services read from experiment run folders.
- A registry version points to a file that can be overwritten.
- `latest` appears in a serving URI.
- Evaluation reports live only inside a notebook output.
- Model binaries are retained, but feature configs are deleted.
- Lifecycle rules remove rollback artifacts before the rollback window ends.
- Approval evidence lives only in chat.

Good artifact promotion gives you a clean answer to a stressful question: "What exactly are we serving, why did we approve it, and how do we go back?"

## Review Checklist
<!-- section-summary: Before promoting a model artifact, ask:. -->

Before promoting a model artifact, ask:

- Is the model artifact immutable?
- Does the manifest include run ID, commit, data snapshot, feature config, and artifact checksum?
- Can production read only production-approved artifacts?
- Is the previous production version recorded as rollback target?
- Are evaluation reports stored with the candidate?
- Are approval records stored with the release?
- Does the serving endpoint report the loaded model version?
- Do lifecycle rules preserve release artifacts for the required window?
- Can a new teammate find the artifact, evidence, and rollback command without asking the original author?

If you can answer yes, the artifact store is doing more than holding files. It is carrying release truth for the model.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [MLflow Model Registry workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/)
- [Databricks: manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [Azure Databricks: manage model lifecycle](https://learn.microsoft.com/en-us/azure/databricks/machine-learning/manage-model-lifecycle/)
- [Amazon S3 object lifecycle management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Amazon S3 lifecycle configuration elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)
- [Google Cloud Storage Object Lifecycle Management](https://cloud.google.com/storage/docs/lifecycle)
