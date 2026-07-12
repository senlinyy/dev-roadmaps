---
title: "ML Storage Systems"
description: "Understand how artifact stores, model registries, dataset stores, and metadata stores work together in a production ML platform."
overview: "ML storage systems keep the files and records that make model work reproducible. This guide follows a multi-environment artifact catalog across object storage, MLflow tracking, model aliases, dataset manifests, metadata, promotion, and operating checks."
tags: ["MLOps", "production", "storage"]
order: 1
id: "article-mlops-mlops-infrastructure-artifact-model-dataset-metadata-stores"
---

## Table of Contents

1. [Why ML Needs Several Storage Systems](#why-ml-needs-several-storage-systems)
2. [The Four Storage Roles](#the-four-storage-roles)
3. [Design A Multi-Environment Artifact Catalog](#design-a-multi-environment-artifact-catalog)
4. [Track Runs And Artifacts With MLflow](#track-runs-and-artifacts-with-mlflow)
5. [Use Registry Aliases And Tags For Promotion](#use-registry-aliases-and-tags-for-promotion)
6. [Store Dataset Manifests And Lineage](#store-dataset-manifests-and-lineage)
7. [Connect Storage To Serving And Rollback](#connect-storage-to-serving-and-rollback)
8. [Mistakes And Operating Checks](#mistakes-and-operating-checks)
9. [Interview-Ready Understanding](#interview-ready-understanding)
10. [References](#references)

## Why ML Needs Several Storage Systems
<!-- section-summary: Production ML needs storage for large files, model versions, dataset snapshots, run metadata, and promotion evidence. -->

ML systems create a lot of evidence. A training run may use a dataset snapshot, a feature schema, a container image, a model file, a tokenizer, metrics, plots, predictions, logs, review notes, and a rollback record. If those pieces live in random folders, the team can train a model once and then lose the path that explains it.

**ML storage systems** are the places where that evidence lives. A production platform usually has more than one because different objects need different behavior. Large files belong in object storage. Run records belong in a tracking store. Deployable model versions belong in a registry. Dataset snapshots need manifests and lineage. Promotion decisions need tags, aliases, approvals, and audit records.

We will follow **ParcelPilot**, a delivery platform that predicts package delay risk for merchants. The team has development, staging, and production environments. Data scientists run experiments every day. A release workflow promotes only approved versions. Serving systems need stable model artifacts. Analysts need to ask which dataset and code produced a prediction after a delivery incident.

The spine for this article is: one model creates many storage needs, each storage system has a job, and a production team needs a catalog that connects artifacts, models, datasets, metadata, environments, and rollback.

## The Four Storage Roles
<!-- section-summary: Artifact stores, model registries, dataset stores, and metadata stores each answer a different production question. -->

The easiest way to learn ML storage is to ask what question each system answers. ParcelPilot needs several stores with clear roles because each store answers a different production question.

| Storage role | What it stores | Question it answers |
| --- | --- | --- |
| Artifact store | Model files, metrics files, plots, feature exports, logs, reports | Which bytes did this run create? |
| Model registry | Named model versions, aliases, tags, signatures, review metadata | Which model version can a deployment use? |
| Dataset store | Dataset snapshots, manifests, schema files, validation reports | Which data trained or evaluated this model? |
| Metadata store | Runs, parameters, metrics, lineage, owners, approvals, environment records | Why was this version created and promoted? |

Object storage often backs several of these roles because it is durable and cheap for large files. MLflow, Vertex AI, Azure ML, SageMaker, Databricks, W&B, DVC, lakeFS, and warehouse catalogs then add metadata and workflow around those files. The tool names change by company, yet the storage roles stay familiar.

ParcelPilot's delay model needs this chain:

1. A dataset snapshot in object storage points to Parquet files and a manifest.
2. An MLflow run records parameters, metrics, tags, and artifact URIs.
3. A model registry version points to the trained model package.
4. A release alias points staging or production to the approved version.
5. A deployment record stores which model URI and container image are live.

That chain is the difference between "we have a model file" and "we can explain, serve, compare, and restore this model."

![ParcelPilot storage roles](/content-assets/articles/article-mlops-mlops-infrastructure-artifact-model-dataset-metadata-stores/parcelpilot-storage-roles.png)

*ParcelPilot keeps each storage role separate so the team can find bytes, versions, datasets, and lineage without treating one bucket as the whole platform.*

## Design A Multi-Environment Artifact Catalog
<!-- section-summary: A catalog gives every stored ML asset a stable name, environment, version, owner, path, and promotion state. -->

ParcelPilot uses a simple artifact catalog that spans development, staging, and production. The catalog can live in a database table, warehouse table, or platform service. The important idea is that every important ML asset has a record that points to the storage location and explains its role.

The object store layout separates environment, asset type, model name, and version:

```
s3://parcelpilot-ml-dev/
  experiments/delay-risk/{run_id}/
  scratch/{user}/

s3://parcelpilot-ml-staging/
  datasets/delay-risk/snapshots/2026-07-01/
  models/delay-risk/versions/2026-07-05-a1b2c3d/
  evaluations/delay-risk/2026-07-05-a1b2c3d/
  manifests/delay-risk/2026-07-05-a1b2c3d.yaml

s3://parcelpilot-ml-prod/
  datasets/delay-risk/snapshots/2026-07-01/
  models/delay-risk/versions/2026-07-05-a1b2c3d/
  release-packets/delay-risk/prod/2026-07-06/
```

The path tells a support engineer where the asset belongs. Development can hold scratch and experiment outputs. Staging holds release candidates and evaluation evidence. Production holds approved artifacts and release packets. The team can apply different IAM, retention, versioning, and lifecycle rules to each environment.

The catalog record makes the storage path machine-readable:

```yaml
asset:
  kind: model
  name: delay-risk
  version: "2026-07-05-a1b2c3d"
  environment: staging
  artifact_uri: s3://parcelpilot-ml-staging/models/delay-risk/versions/2026-07-05-a1b2c3d/
  registered_model: models:/parcelpilot.delay_risk@candidate
  dataset_snapshot: delay-risk-features:2026-07-01
  training_run_id: 8f3a2d90e0d94aa9a7c2
  git_sha: a1b2c3d
  container_image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/delay-risk@sha256:1111222233334444
  owner: logistics-ml
  tags:
    validation_status: passed
    promotion_state: staging
```

The record ties together storage, registry, dataset, run, code, image, owner, and state. That is the catalog's job. Object storage and the registry still do their own jobs, while the catalog connects them so humans and automation can ask the same questions.

![ParcelPilot artifact catalog](/content-assets/articles/article-mlops-mlops-infrastructure-artifact-model-dataset-metadata-stores/parcelpilot-artifact-catalog.png)

*The catalog gives dev, staging, and production assets the same fields, so promotion checks can compare environment, version, owner, and state instead of reading folder names by hand.*

## Track Runs And Artifacts With MLflow
<!-- section-summary: MLflow tracking records parameters, metrics, artifacts, signatures, and tags so each training run has a durable audit trail. -->

**MLflow Tracking** records what happened during a training run. It can store parameters, metrics, tags, artifacts, source information, and links to model packages. The tracking server usually uses a backend store for structured metadata and an artifact store for large files.

For ParcelPilot, the training script logs a delay-risk model with a signature and input example. The signature tells serving and review tools what input shape the model expects. The input example helps reviewers and deployment tests understand a real request.

```python
import mlflow
import mlflow.sklearn
from mlflow.models import infer_signature

MODEL_NAME = "parcelpilot.delay_risk"

with mlflow.start_run(run_name="delay-risk-20260705") as run:
    model.fit(X_train, y_train)
    scores = model.predict_proba(X_valid)[:, 1]
    signature = infer_signature(X_valid.head(20), scores[:20])

    mlflow.log_params({
        "model_family": "gradient_boosted_trees",
        "feature_schema": "delay_features_v6",
        "dataset_snapshot": "delay-risk-features:2026-07-01",
    })
    mlflow.log_metrics({
        "auc": float(auc),
        "precision_at_top_10_percent": float(precision_top_10),
    })
    mlflow.set_tags({
        "git_sha": "a1b2c3d",
        "owner": "logistics-ml",
        "service": "merchant-delay-risk",
    })

    mlflow.sklearn.log_model(
        sk_model=model,
        name="delay-risk-model",
        registered_model_name=MODEL_NAME,
        signature=signature,
        input_example=X_valid.head(3),
    )
```

The example uses `name` for the logged model and includes a signature plus input example. Those are useful defaults for modern MLflow work because the model may move toward registry review, batch scoring, or serving. The run also logs the dataset snapshot and git SHA as tags and parameters, so the artifact can be traced back to data and code.

A typical MLflow deployment separates metadata and artifacts:

```bash
export MLFLOW_TRACKING_URI=https://mlflow.parcelpilot.internal
export MLFLOW_REGISTRY_URI=https://mlflow.parcelpilot.internal

python train_delay_model.py \
  --dataset-snapshot delay-risk-features:2026-07-01 \
  --output-owner logistics-ml
```

The tracking URI tells the script where to record the run. The artifact store behind that server may write to S3, Azure Blob Storage, Google Cloud Storage, NFS, or another supported backend. The training code should write artifacts through a shared artifact store because release automation needs to read them later.

## Use Registry Aliases And Tags For Promotion
<!-- section-summary: Model registries give deployable model versions stable names, while aliases and tags express candidate, staging, production, and rollback intent. -->

A **model registry** stores named model versions. It gives deployment automation a stable way to say "use this approved version of `parcelpilot.delay_risk`." Modern registry workflows should use aliases and tags for release intent rather than relying on old stage-based habits.

ParcelPilot sets tags and aliases after the registered version passes validation:

```python
from mlflow import MlflowClient

client = MlflowClient()
model_name = "parcelpilot.delay_risk"
run_id = "8f3a2d90e0d94aa9a7c2"

versions = client.search_model_versions(
    f"name = '{model_name}' and run_id = '{run_id}'"
)
version = versions[0].version

client.set_model_version_tag(
    name=model_name,
    version=version,
    key="validation_status",
    value="passed",
)
client.set_model_version_tag(
    name=model_name,
    version=version,
    key="dataset_snapshot",
    value="delay-risk-features:2026-07-01",
)
client.set_registered_model_alias(
    name=model_name,
    alias="candidate",
    version=version,
)
```

The alias `candidate` tells the release workflow which model version is currently under review. After staging tests pass, the workflow can move the alias:

```python
client.set_registered_model_alias(
    name="parcelpilot.delay_risk",
    alias="staging",
    version=version,
)
```

Production promotion should add a release record before moving any serving pointer:

```yaml
promotion_request:
  model_name: parcelpilot.delay_risk
  model_version: "42"
  from_alias: staging
  to_alias: production
  requested_by: logistics-ml
  approved_by: platform-review
  checks:
    validation_status: passed
    endpoint_contract: passed
    rollback_alias: prod-previous
```

Databricks Unity Catalog models use catalog and schema names around registered models, which is useful for companies that already manage data and ML assets through Unity Catalog permissions, lineage, and audit. The same idea still applies: a model version needs a governed name, metadata, aliases, owners, and a promotion workflow that a production deployment can trust.

## Store Dataset Manifests And Lineage
<!-- section-summary: Dataset manifests record the exact files, schema, hashes, source tables, and label windows used by a model. -->

A dataset store keeps the training data evidence. It may use DVC, lakeFS, Delta Lake, Iceberg, a warehouse table snapshot, cloud object versioning, or a custom manifest system. The beginner-friendly rule is simple: a model should point to a dataset identity that another engineer can inspect later.

ParcelPilot creates one manifest per dataset snapshot:

```json
{
  "dataset_name": "delay-risk-features",
  "snapshot": "2026-07-01",
  "owner": "logistics-ml",
  "source_tables": [
    "warehouse.delivery_events",
    "warehouse.merchant_profiles",
    "warehouse.weather_alerts"
  ],
  "label_window": {
    "target": "late_by_more_than_24h",
    "maturity_days": 14
  },
  "storage_root": "s3://parcelpilot-ml-staging/datasets/delay-risk/snapshots/2026-07-01/",
  "schema_version": "delay_features_v6",
  "files": [
    {
      "path": "part-0000.parquet",
      "rows": 102938,
      "sha256": "3a7d9f..."
    },
    {
      "path": "part-0001.parquet",
      "rows": 99821,
      "sha256": "91c2aa..."
    }
  ]
}
```

This manifest records the files, row counts, hashes, source tables, label rule, schema version, and storage root. It helps with reproducibility because the team can verify the dataset files before retraining or investigating a past prediction.

Lineage connects the dataset snapshot to the model run and deployment. The link can live in MLflow tags, a catalog table, a warehouse lineage system, or a managed platform registry. The exact tool matters less than the evidence chain:

| Link | Example evidence |
| --- | --- |
| Dataset to run | MLflow tag `dataset_snapshot=delay-risk-features:2026-07-01` |
| Run to model version | Registry version tag `run_id=8f3a2d90e0d94aa9a7c2` |
| Model version to endpoint | Deployment config `model_uri=models:/parcelpilot.delay_risk@production` |
| Endpoint to prediction | Prediction log field `model_version=42` |

Without these links, incidents turn into guesswork. With these links, an engineer can answer which data, code, model version, and endpoint generated a bad score.

## Connect Storage To Serving And Rollback
<!-- section-summary: Serving systems should load approved model URIs, verify manifests, log model versions, and keep rollback aliases available. -->

Serving should consume approved model references rather than random files. ParcelPilot's deployment config points to the registry alias:

```yaml
service: merchant-delay-risk
environment: production
model_uri: models:/parcelpilot.delay_risk@production
container_image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/delay-risk-serving@sha256:5555666677778888
startup_checks:
  require_signature: true
  require_input_example: true
  require_dataset_tag: true
prediction_log_fields:
  - request_id
  - model_name
  - model_version
  - feature_schema
  - score_band
  - latency_ms
```

At startup, the model server resolves the registry alias, downloads the model package, checks the signature, reads tags, and logs the resolved version. That makes the running service auditable. If the `production` alias points to version `42`, the prediction logs should show version `42` too.

Rollback should use a known previous version. ParcelPilot keeps `prod-previous` as a registry alias and stores the release packet that explains it:

```python
client.set_registered_model_alias(
    name="parcelpilot.delay_risk",
    alias="production",
    version="41",
)
client.set_registered_model_alias(
    name="parcelpilot.delay_risk",
    alias="rolled-back-from",
    version="42",
)
```

The serving platform still has to reload or redeploy after the alias changes. Some systems resolve registry aliases only at deployment time. Others can poll or receive a release event. Either way, the release runbook should say exactly how the service picks up the alias change and how operators confirm the live model version.

![ParcelPilot serving and rollback](/content-assets/articles/article-mlops-mlops-infrastructure-artifact-model-dataset-metadata-stores/parcelpilot-serving-rollback.png)

*Serving reads the approved alias, verifies the package, and logs the resolved version; rollback only works when the previous alias and artifact package still point to real files.*

## Mistakes And Operating Checks
<!-- section-summary: Storage mistakes usually show up as missing lineage, mutable paths, broad access, weak manifests, and unclear rollback evidence. -->

The most common mistake is treating storage as a dumping ground. A folder called `final_model` tells you almost nothing. A registry version with no tags tells you almost nothing. A dataset folder with no manifest tells you almost nothing. Production ML needs storage that can answer operational questions.

ParcelPilot runs these checks before promotion:

| Check | Why it matters |
| --- | --- |
| Dataset manifest exists and hashes match | Proves the dataset snapshot can be replayed |
| MLflow run has dataset, git SHA, metrics, owner, and image tags | Connects training evidence to code and data |
| Registry version has signature and input example | Helps serving validate request shape |
| Candidate alias points to one reviewed version | Keeps deployment automation deterministic |
| Production artifact path uses environment-specific access | Reduces accidental cross-environment reads |
| Rollback alias and artifact still resolve | Gives operators a real recovery option |
| Prediction logs include model version | Lets incidents trace live behavior to registry evidence |

A good cleanup policy also matters. Development scratch artifacts can expire quickly. Production model packages, manifests, and release packets may need longer retention for audit and rollback. Batch predictions may move to colder storage after the review window. Use lifecycle rules by path and environment, because one retention rule for every ML object will either waste money or delete useful evidence.

Access is another common failure area. Training jobs may write candidates. Reviewers may read reports and move aliases. Serving jobs may read only approved production artifacts. Analysts may query aggregate evaluation data. Give each role the smallest useful access because model files, features, and prediction logs can contain sensitive business or user information.

## Interview-Ready Understanding
<!-- section-summary: A strong answer explains why artifact stores, registries, dataset manifests, metadata, aliases, and environments need to work together. -->

If someone asks why ML storage is more complex than normal application storage, start with the evidence chain. A model version is the result of data, code, environment, parameters, metrics, files, review, and deployment. The team needs storage systems that keep those pieces connected.

A clear answer sounds like this: I would use object storage for large artifacts and dataset snapshots, MLflow or a managed platform for run tracking, a model registry for named model versions and aliases, manifests for datasets, and a catalog or metadata store to connect versions across dev, staging, and production. I would avoid mutable paths as release truth, use tags and aliases for promotion, log model versions in serving, and keep rollback evidence available.

The practical test is simple. Pick one prediction from production and trace it back. You should find the endpoint, model alias, model version, registry tags, training run, dataset manifest, code commit, container image, metrics, and approval record. If you can do that quickly, your storage systems are doing their job.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [MLflow tracking and artifact stores](https://mlflow.org/docs/latest/ml/tracking/)
- [MLflow Python API for model logging](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html)
- [Databricks model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [DVC data and model versioning](https://dvc.org/doc/use-cases/versioning-data-and-model-files)
- [lakeFS data versioning model](https://docs.lakefs.io/understand/model/)
