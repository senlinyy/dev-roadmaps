---
title: "Google Vertex AI"
description: "Use Google Vertex AI for managed pipelines, training jobs, model registry, endpoints, service accounts, and production MLOps workflows on Google Cloud."
overview: "Vertex AI gives teams a Google Cloud control plane for pipeline jobs, custom training, model upload and versioning, endpoints, service accounts, and monitoring. This guide follows a fraud graph model from BigQuery features to a governed Vertex AI release."
tags: ["MLOps", "advanced", "cloud"]
order: 3
id: "article-mlops-mlops-infrastructure-google-vertex-ai-overview"
---

## Table of Contents

1. [What Vertex AI Gives An MLOps Team](#what-vertex-ai-gives-an-mlops-team)
2. [The Project-Level Map](#the-project-level-map)
3. [Prepare Data In BigQuery And Cloud Storage](#prepare-data-in-bigquery-and-cloud-storage)
4. [Build A Pipeline Job](#build-a-pipeline-job)
5. [Run Custom Training With The Right Service Account](#run-custom-training-with-the-right-service-account)
6. [Upload And Version The Model](#upload-and-version-the-model)
7. [Deploy To An Endpoint](#deploy-to-an-endpoint)
8. [Operations, Guardrails, And Rollback](#operations-guardrails-and-rollback)
9. [When Vertex AI Helps And When It Adds Weight](#when-vertex-ai-helps-and-when-it-adds-weight)
10. [Practical Checks And Interview-Ready Understanding](#practical-checks-and-interview-ready-understanding)
11. [References](#references)

## What Vertex AI Gives An MLOps Team
<!-- section-summary: Vertex AI gives Google Cloud teams managed resources for pipelines, training, registry, endpoints, and operational controls around ML systems. -->

**Vertex AI** is Google Cloud's managed platform for building, training, registering, deploying, and operating machine learning models. The short version is this: you bring data, code, containers, and release rules, and Vertex AI gives you managed Google Cloud resources around the workflow.

We will follow **SignalCart**, a marketplace that detects account-takeover fraud. The model looks at a graph of users, devices, cards, delivery addresses, and login sessions. Fraud analysts care about this model because one bad release can block good shoppers or let high-risk orders through. The ML team also needs a repeatable workflow because graph features change often, labels arrive late, and review teams need evidence before a model touches checkout traffic.

SignalCart keeps raw events and curated features in BigQuery. Training reads graph feature snapshots, writes artifacts to Cloud Storage, uploads the approved model to Vertex AI Model Registry, and deploys it to a Vertex AI Endpoint. A Vertex AI Pipeline ties the steps together so the team can compare one fraud graph candidate against the last production version.

The spine for this article is: Google Cloud already has your analytical data, Vertex AI gives managed ML resources next to it, and production quality still depends on data boundaries, service accounts, registry metadata, endpoint release steps, and rollback evidence.

## The Project-Level Map
<!-- section-summary: Vertex AI work usually starts with a Google Cloud project, region, service accounts, storage buckets, BigQuery tables, pipeline jobs, models, and endpoints. -->

In Google Cloud, the **project** is the main administrative boundary. It holds IAM policies, APIs, billing, service accounts, logs, BigQuery datasets, Cloud Storage buckets, Artifact Registry repositories, and Vertex AI resources. SignalCart uses separate projects for development, staging, and production because fraud data is sensitive and production endpoints need tighter control.

A **region** also matters. Vertex AI resources such as pipeline jobs, custom jobs, models, and endpoints live in a region. The team chooses `us-central1` for this example because the related BigQuery datasets, storage buckets, and serving callers are already designed around that region. In a real company, privacy, latency, cost, quota, and data residency influence this choice.

Here is the map:

| Production question | Google Cloud or Vertex AI resource | SignalCart example |
| --- | --- | --- |
| Where does the ML system live? | Google Cloud project | `signalcart-ml-prod` |
| Where do curated features live? | BigQuery dataset | `fraud_features_prod.graph_snapshots` |
| Where do artifacts and pipeline outputs live? | Cloud Storage bucket | `gs://signalcart-ml-prod-artifacts` |
| Where do training and serving images live? | Artifact Registry | `us-central1-docker.pkg.dev/signalcart-ml-prod/ml-images` |
| How does the workflow run? | Vertex AI PipelineJob | `fraud-graph-release-20260705` |
| How does training run? | Vertex AI CustomJob | Graph model trainer container |
| Where does the model version live? | Vertex AI Model Registry | `fraud-graph-risk` with version aliases |
| How do callers get predictions? | Vertex AI Endpoint | `fraud-graph-prod` |
| Which identity reads data and deploys models? | Service accounts | `vertex-pipeline-runner` and `vertex-inference-prod` |

This map helps because Vertex AI is a platform surface with several connected resources. The fraud model touches BigQuery, Cloud Storage, containers, IAM, pipelines, model upload, endpoints, and monitoring. A good MLOps design names those resources so each handoff is visible.

![SignalCart Vertex AI Map](/content-assets/articles/article-mlops-mlops-infrastructure-google-vertex-ai-overview/signalcart-vertex-ai-map.png)

*SignalCart's Vertex AI workflow connects the BigQuery snapshot, Cloud Storage artifacts, pipeline run, custom training job, registry version, endpoint, and service account guardrail.*

## Prepare Data In BigQuery And Cloud Storage
<!-- section-summary: Vertex AI workflows often pair BigQuery for structured features with Cloud Storage for artifacts, exported data, pipeline outputs, and model files. -->

SignalCart builds graph features in BigQuery. A daily feature pipeline joins checkout events, login events, payment attempts, device fingerprints, support reports, and confirmed chargebacks. The output table has one row per account-window pair, with graph metrics such as shared device count, address reuse, account age, and recent failed payment velocity.

A useful training snapshot has stable time boundaries:

```sql
CREATE OR REPLACE TABLE `signalcart-ml-prod.fraud_features_prod.graph_train_20260701` AS
SELECT
  account_id,
  snapshot_timestamp,
  shared_device_count_7d,
  shared_address_count_30d,
  failed_payment_count_24h,
  new_card_count_7d,
  chargeback_label_30d
FROM `signalcart-ml-prod.fraud_features_prod.account_graph_daily`
WHERE snapshot_timestamp >= TIMESTAMP '2026-05-01 00:00:00 UTC'
  AND snapshot_timestamp < TIMESTAMP '2026-07-01 00:00:00 UTC'
  AND label_maturity_days >= 30;
```

The `label_maturity_days` filter matters because fraud labels arrive after disputes, investigations, and chargeback windows. Training on immature labels gives the model a false view of reality. A broken label window stays broken after the workflow enters Vertex AI, so the data contract has to carry that rule before the pipeline runs.

The team stores pipeline artifacts in Cloud Storage:

```
gs://signalcart-ml-prod-artifacts/
  pipeline-root/fraud-graph/
  datasets/fraud-graph/2026-07-01/
  models/fraud-graph/2026-07-05-a1b2c3d/
  evaluations/fraud-graph/2026-07-05-a1b2c3d/
```

The artifact layout separates pipeline working files, dataset exports, model files, and evaluation reports. Vertex AI can manage many resources, yet your storage layout still decides how easy it is to replay a run or investigate an incident.

## Build A Pipeline Job
<!-- section-summary: A Vertex AI PipelineJob turns feature building, training, evaluation, and model upload into one repeatable workflow with a shared run record. -->

A **pipeline** is a workflow made of steps. In Vertex AI, a pipeline usually comes from the Kubeflow Pipelines SDK or TensorFlow Extended style components, then runs as a Vertex AI PipelineJob. SignalCart uses a pipeline because the fraud graph release has several handoffs: build features, train, evaluate, upload model, and run endpoint smoke tests.

Here is a compact Python example using the Kubeflow Pipelines DSL and the Vertex AI SDK:

```python
from google.cloud import aiplatform
from kfp import compiler, dsl


@dsl.component(
    base_image="python:3.11",
    packages_to_install=["google-cloud-bigquery", "pandas", "pyarrow"],
)
def export_graph_snapshot(project: str, table: str, output_uri: str) -> str:
    from google.cloud import bigquery

    client = bigquery.Client(project=project)
    extract_job = client.extract_table(table, output_uri)
    extract_job.result()
    return output_uri


@dsl.component(
    base_image="us-central1-docker.pkg.dev/signalcart-ml-prod/ml-images/fraud-trainer@sha256:1111222233334444",
)
def train_graph_model(dataset_uri: str, model_dir: str, metrics_uri: str) -> str:
    import subprocess

    subprocess.run(
        [
            "python",
            "train.py",
            "--dataset-uri",
            dataset_uri,
            "--model-dir",
            model_dir,
            "--metrics-uri",
            metrics_uri,
        ],
        check=True,
    )
    return model_dir


@dsl.pipeline(name="fraud-graph-release")
def fraud_graph_pipeline(project: str, feature_table: str, artifact_bucket: str):
    dataset_uri = f"gs://{artifact_bucket}/datasets/fraud-graph/2026-07-01/*.parquet"
    model_uri = f"gs://{artifact_bucket}/models/fraud-graph/2026-07-05-a1b2c3d/"
    metrics_uri = f"gs://{artifact_bucket}/evaluations/fraud-graph/2026-07-05-a1b2c3d/metrics.json"

    exported = export_graph_snapshot(
        project=project,
        table=feature_table,
        output_uri=dataset_uri,
    )
    train_graph_model(
        dataset_uri=exported.output,
        model_dir=model_uri,
        metrics_uri=metrics_uri,
    )


compiler.Compiler().compile(
    pipeline_func=fraud_graph_pipeline,
    package_path="fraud_graph_pipeline.json",
)

aiplatform.init(
    project="signalcart-ml-prod",
    location="us-central1",
    staging_bucket="gs://signalcart-ml-prod-artifacts",
)

job = aiplatform.PipelineJob(
    display_name="fraud-graph-release-20260705",
    template_path="fraud_graph_pipeline.json",
    pipeline_root="gs://signalcart-ml-prod-artifacts/pipeline-root/fraud-graph",
    parameter_values={
        "project": "signalcart-ml-prod",
        "feature_table": "signalcart-ml-prod.fraud_features_prod.graph_train_20260701",
        "artifact_bucket": "signalcart-ml-prod-artifacts",
    },
    enable_caching=True,
)

job.run(
    service_account="vertex-pipeline-runner@signalcart-ml-prod.iam.gserviceaccount.com"
)
```

The example has a few production habits. The training image uses a digest, so the job records the exact container bytes. The pipeline root sits in a product-specific Cloud Storage path. The job runs as a service account rather than a human user. Those details turn a demo pipeline into something an operations team can review.

## Run Custom Training With The Right Service Account
<!-- section-summary: Custom training jobs run your container on Vertex AI compute while a service account controls access to BigQuery, Cloud Storage, and Artifact Registry. -->

Some teams put training directly inside a pipeline step. Others submit a separate Vertex AI **CustomJob** from the pipeline. A custom job is useful when you want explicit worker pools, machine types, replica counts, container images, and environment variables.

SignalCart can submit a custom job with the Vertex AI SDK:

```python
from google.cloud import aiplatform

aiplatform.init(project="signalcart-ml-prod", location="us-central1")

job = aiplatform.CustomContainerTrainingJob(
    display_name="fraud-graph-train-20260705",
    container_uri="us-central1-docker.pkg.dev/signalcart-ml-prod/ml-images/fraud-trainer@sha256:1111222233334444",
    command=["python", "train.py"],
)

model = job.run(
    args=[
        "--train-table=signalcart-ml-prod.fraud_features_prod.graph_train_20260701",
        "--model-dir=gs://signalcart-ml-prod-artifacts/models/fraud-graph/2026-07-05-a1b2c3d/",
        "--metrics-uri=gs://signalcart-ml-prod-artifacts/evaluations/fraud-graph/2026-07-05-a1b2c3d/metrics.json",
    ],
    replica_count=1,
    machine_type="n2-standard-8",
    service_account="vertex-training-runner@signalcart-ml-prod.iam.gserviceaccount.com",
    sync=True,
)
```

The machine type is intentionally ordinary here. A graph feature fraud model may need CPU and memory more than accelerators. If your model needs GPUs, choose the current accelerator and quota for that workload, record the machine type, accelerator type, driver/runtime assumptions, image digest, and cost limit in the run metadata.

Service accounts are the security center of this workflow. The training account needs permission to read the approved BigQuery tables, read the training image, and write artifacts to the ML bucket. The endpoint account needs permission to read model artifacts and write logs. The deployment account needs permission to upload models and update endpoints. Keeping those separate makes access review much easier.

## Upload And Version The Model
<!-- section-summary: Vertex AI Model Registry stores upload metadata, serving container settings, model versions, aliases, and labels for deployment workflows. -->

After training and evaluation pass, SignalCart uploads the model to Vertex AI Model Registry. A **model** in Vertex AI represents a deployable model resource. A model can have versions, labels, descriptions, and serving container configuration. The registry entry gives the deployment workflow a reviewed object instead of a loose folder in Cloud Storage.

The model upload can use `gcloud`:

```bash
gcloud ai models upload \
  --region=us-central1 \
  --display-name=fraud-graph-risk \
  --artifact-uri=gs://signalcart-ml-prod-artifacts/models/fraud-graph/2026-07-05-a1b2c3d/ \
  --container-image-uri=us-central1-docker.pkg.dev/signalcart-ml-prod/ml-images/fraud-serving@sha256:5555666677778888 \
  --description="Fraud graph risk model trained from graph_train_20260701" \
  --labels=owner=fraud-ml,validation_status=passed,git_sha=a1b2c3d
```

The serving container image matters as much as the model files. It contains the prediction server, preprocessing code, dependency versions, and health behavior. Pinning the image by digest gives reviewers a precise reference.

Teams can also use the Vertex AI SDK to upload a version with aliases. The exact alias policy is up to the team, yet common names are `candidate`, `staging`, and `prod-previous`:

```python
from google.cloud import aiplatform

aiplatform.init(project="signalcart-ml-prod", location="us-central1")

model = aiplatform.Model.upload(
    display_name="fraud-graph-risk",
    artifact_uri="gs://signalcart-ml-prod-artifacts/models/fraud-graph/2026-07-05-a1b2c3d/",
    serving_container_image_uri="us-central1-docker.pkg.dev/signalcart-ml-prod/ml-images/fraud-serving@sha256:5555666677778888",
    labels={
        "owner": "fraud-ml",
        "validation_status": "passed",
        "git_sha": "a1b2c3d",
    },
    version_aliases=["candidate"],
    version_description="Graph fraud model trained on mature labels through 2026-07-01",
)

model.wait()
```

Aliases and labels help deployment automation stay readable. A release workflow can say "deploy the model version tagged `validation_status=passed` and approved in the change record." A support engineer can open the model resource and see which dataset, commit, and serving image connect to the version.

![SignalCart Fraud Release](/content-assets/articles/article-mlops-mlops-infrastructure-google-vertex-ai-overview/signalcart-fraud-release.png)

*The fraud release path keeps mature labels, pipeline metrics, model aliasing, smoke tests, and traffic split decisions visible before checkout traffic changes.*

## Deploy To An Endpoint
<!-- section-summary: Vertex AI Endpoints serve model versions behind managed infrastructure, with machine settings, replica limits, service accounts, and traffic split controls. -->

A **Vertex AI Endpoint** is the online prediction surface. It can have one or more deployed models, and traffic can move between them. SignalCart uses one endpoint for the production fraud graph model because callers should have a stable endpoint while model versions change behind it.

Create the endpoint:

```bash
gcloud ai endpoints create \
  --region=us-central1 \
  --display-name=fraud-graph-prod
```

Deploy a model version to the endpoint:

```bash
gcloud ai endpoints deploy-model "$ENDPOINT_ID" \
  --region=us-central1 \
  --model="$MODEL_ID" \
  --display-name=fraud-graph-20260705 \
  --machine-type=n2-standard-4 \
  --min-replica-count=2 \
  --max-replica-count=8 \
  --service-account=vertex-inference-prod@signalcart-ml-prod.iam.gserviceaccount.com \
  --traffic-split=0=100
```

The replica counts define the serving floor and ceiling. The service account defines what the model server can access. The traffic split controls how much traffic reaches the newly deployed model. SignalCart starts at 100 percent only for the first launch. Later releases deploy a second model and move a small slice of traffic after smoke tests pass.

The caller sends a request with the same shape used in training and contract tests:

```json
{
  "instances": [
    {
      "account_id": "acct_8842",
      "shared_device_count_7d": 4,
      "shared_address_count_30d": 2,
      "failed_payment_count_24h": 3,
      "new_card_count_7d": 2
    }
  ]
}
```

A good response includes the score and trace fields the fraud review system needs:

```json
{
  "predictions": [
    {
      "fraud_risk": 0.87,
      "model_version": "2026-07-05-a1b2c3d",
      "reason_codes": ["shared_device_cluster", "failed_payment_velocity"]
    }
  ]
}
```

The response contract matters because product code, analyst dashboards, and incident review all depend on it. A model that returns a high-quality score with the wrong field names can still break checkout.

## Operations, Guardrails, And Rollback
<!-- section-summary: A production Vertex AI release needs endpoint smoke tests, traffic steps, logs, prediction sampling, alert thresholds, and a rollback command. -->

SignalCart treats deployment as a measured release. The pipeline uploads the model and creates a deployment, then the release workflow runs a smoke test, checks endpoint logs, and opens a guarded traffic step. The guardrail is a blend of technical and business signals: latency, error rate, missing fields, score distribution, manual review queue volume, false-positive complaints, and confirmed fraud capture rate once labels arrive.

The smoke test calls the endpoint before customer traffic moves:

```bash
gcloud ai endpoints predict "$ENDPOINT_ID" \
  --region=us-central1 \
  --json-request=tests/fraud-graph-smoke-request.json
```

The rollback plan should already name the previous deployed model. In an endpoint with two deployed models, the team can update traffic back to the previous version. The exact command depends on the deployed model IDs returned by Vertex AI, so the release record stores them:

```bash
gcloud ai endpoints describe "$ENDPOINT_ID" \
  --region=us-central1 \
  --format="table(deployedModels.id,deployedModels.displayName,trafficSplit)"

gcloud ai endpoints update "$ENDPOINT_ID" \
  --region=us-central1 \
  --traffic-split="$PREVIOUS_DEPLOYED_MODEL_ID=100"
```

SignalCart also samples predictions to BigQuery for monitoring. The endpoint service writes structured logs with request ID, model version, feature schema version, score band, latency, and response status. Analysts join those prediction logs to later fraud outcomes once labels mature. That join tells the team whether the model helped the product and whether the container stayed healthy.

![SignalCart Operations Loop](/content-assets/articles/article-mlops-mlops-infrastructure-google-vertex-ai-overview/signalcart-operations-loop.png)

*The operations loop pairs endpoint logs and prediction samples with BigQuery joins, guardrail alerts, rollback traffic splits, and fraud analyst review.*

## When Vertex AI Helps And When It Adds Weight
<!-- section-summary: Vertex AI helps when Google Cloud data, pipelines, registry, endpoints, service accounts, and monitoring need one managed control plane. -->

Vertex AI helps SignalCart because the team already uses BigQuery, Cloud Storage, Artifact Registry, Cloud Logging, and Google Cloud IAM. The managed platform keeps the ML workflow close to those systems. Pipeline jobs can read BigQuery, custom jobs can run training containers, the registry can hold deployable versions, and endpoints can serve the fraud API with a managed service account.

It also helps when several teams need the same evidence. Fraud analysts need evaluation reports. Platform engineers need image digests and endpoint settings. Security reviewers need service account scopes. Product managers need release notes and rollback status. Vertex AI gives a central place to connect many of those records.

The platform adds weight when a team has a small offline model, no serving path, and no Google Cloud production footprint. You still need to learn projects, regions, service accounts, artifact buckets, IAM, pipeline compilation, model upload, and endpoint operations. If your current pain is unclear labels or weak features, Vertex AI will run that weak workflow very reliably. Fix the data contract and evaluation plan first.

The useful question is where the real operational work sits. If it sits in repeatable Google Cloud training, registry review, endpoint serving, and IAM-controlled release, Vertex AI can simplify a lot. If it sits in basic model discovery or one analyst notebook, a lighter stack may give faster learning.

## Practical Checks And Interview-Ready Understanding
<!-- section-summary: A strong Vertex AI answer connects projects, data, pipelines, jobs, registry versions, endpoints, service accounts, monitoring, and rollback. -->

Before you call a Vertex AI workflow production-ready, trace one model from data to endpoint. You should know which project and region own the workflow, which BigQuery snapshot trained the model, which Cloud Storage path holds artifacts, which service account ran training, which model version was uploaded, which endpoint serves it, which deployed model ID receives traffic, and which command moves traffic back.

Common mistakes include training on labels before they mature, letting a human user identity run production jobs, uploading model files without serving image metadata, deploying with broad service account access, skipping endpoint smoke tests, and leaving rollback IDs out of the release record. Each mistake is fixable with a clearer workflow and better evidence.

In an interview, a clear answer sounds like this: Vertex AI is Google Cloud's managed MLOps platform. I would use BigQuery or Cloud Storage for data, Vertex AI Pipelines or CustomJobs for repeatable training, Model Registry for versioned deployable models, Endpoints for online prediction, service accounts for least privilege, and endpoint traffic controls for release and rollback. The important production habit is to connect the model version to its data snapshot, code, image, service account, endpoint, and monitoring signals.

## References

- [Vertex AI Pipelines overview](https://cloud.google.com/vertex-ai/docs/pipelines/introduction)
- [Run a Vertex AI pipeline](https://cloud.google.com/vertex-ai/docs/pipelines/run-pipeline)
- [Create custom training jobs](https://cloud.google.com/vertex-ai/docs/training/create-custom-job)
- [Import models to Vertex AI Model Registry](https://cloud.google.com/vertex-ai/docs/model-registry/import-model)
- [Use model version aliases](https://cloud.google.com/vertex-ai/docs/model-registry/model-alias)
- [Deploy a model to an endpoint](https://cloud.google.com/vertex-ai/docs/predictions/deploy-model-api)
- [Google Cloud SDK reference for `gcloud ai models upload`](https://cloud.google.com/sdk/gcloud/reference/ai/models/upload)
