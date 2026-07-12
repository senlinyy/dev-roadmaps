---
title: "Azure Machine Learning"
description: "Use Azure Machine Learning to move training scripts into managed jobs, reusable data assets, registries, managed endpoints, and governed release workflows."
overview: "Azure Machine Learning gives a team an Azure-native workspace for training jobs, data assets, model assets, registries, managed endpoints, identities, and pipelines. This guide follows a churn model from local scripts into a managed production workflow."
tags: ["MLOps", "advanced", "cloud"]
order: 2
id: "article-mlops-mlops-infrastructure-azure-machine-learning-overview"
---

## Table of Contents

1. [What Azure Machine Learning Gives You](#what-azure-machine-learning-gives-you)
2. [The Workspace Map](#the-workspace-map)
3. [Turn Raw Files Into Data Assets](#turn-raw-files-into-data-assets)
4. [Run Training As A Managed Job](#run-training-as-a-managed-job)
5. [Register A Model Asset](#register-a-model-asset)
6. [Use Registries And Pipelines For Promotion](#use-registries-and-pipelines-for-promotion)
7. [Deploy With Managed Online Endpoints](#deploy-with-managed-online-endpoints)
8. [Identity, Networking, And Operating Checks](#identity-networking-and-operating-checks)
9. [When Azure ML Helps And When It Adds Weight](#when-azure-ml-helps-and-when-it-adds-weight)
10. [Practical Checks And Interview-Ready Understanding](#practical-checks-and-interview-ready-understanding)
11. [References](#references)

## What Azure Machine Learning Gives You
<!-- section-summary: Azure Machine Learning gives you an Azure workspace for managed training jobs, reusable assets, registries, endpoints, pipelines, and access controls around the ML lifecycle. -->

**Azure Machine Learning** is Microsoft's managed MLOps platform for teams that want to train, register, deploy, and operate models inside Azure. The plain version is this: you bring data, code, environments, and release rules, and Azure ML gives you managed resources for the work around them.

We will follow **LoopCart**, a subscription shopping app that predicts which customers are likely to cancel in the next 30 days. The first churn model started as a Python script on a data scientist's laptop. It read a CSV export, trained a scikit-learn model, wrote a pickle file, and sent a metric screenshot to Slack. That worked for learning, yet it gave the team no durable run history, no shared data asset, no reviewed model version, and no clean way to serve predictions to the retention product.

Azure ML helps LoopCart move that script into a managed workflow. The workspace stores data assets, environments, jobs, models, endpoints, and connections. The training job runs on Azure compute with a managed identity. The model moves into a registry after validation. The endpoint serves an approved version with Azure-managed infrastructure. The pipeline ties those steps together so the team can repeat the workflow each week.

The spine for this article is: a local ML script grows into a production workflow, Azure ML gives each step a managed Azure resource, and the team still has to make clear choices about data contracts, identity, promotion, endpoint safety, and rollback.

## The Workspace Map
<!-- section-summary: The Azure ML workspace is the home base for jobs, data assets, models, compute, endpoints, environments, and connections. -->

A **workspace** is the top-level Azure ML container for a team or product area. It keeps the ML resources for one boundary together: experiments, jobs, compute, models, endpoints, environments, and data assets. LoopCart uses one workspace per environment because development experiments, staging release tests, and production serving need different permissions and review rules.

For a beginner, the workspace is useful because it gives names to the moving pieces. You can point at a training job, a data asset, a model version, an endpoint, and the identity that ran the job. That trace matters when a retention campaign sends too many discounts to healthy customers and the team needs to know which model, data snapshot, and code version produced the score.

Here is the map LoopCart uses:

| Production question | Azure ML resource | LoopCart example |
| --- | --- | --- |
| Where does ML work live? | Workspace | `loopcart-ml-prod` in `eastus` |
| Where does input data live? | Data asset | `churn_features:2026-07-01` points to a curated Blob Storage path |
| Where does code run? | Command job | `train-churn-20260705-a1b2c3d` |
| Which packages run the code? | Environment | `retention-train-env:8` with pinned Python packages |
| Where does the candidate model live? | Model asset | `churn-retention-model:2026-07-05.1` |
| How does reuse cross workspaces? | Registry | `loopcart-ml-registry` shares approved model and environment versions |
| How do callers get predictions? | Managed online endpoint | `churn-retention-prod` |
| Which Azure identity reads data and artifacts? | Managed identity | `aml-retention-training-prod` and `aml-retention-endpoint-prod` |

The table also shows a practical habit: use stable names that a support engineer can read during an incident. A name such as `churn-retention-prod` tells the team what the endpoint serves. A name such as `model-2-final-final` gives nobody enough evidence.

![LoopCart Azure ML Workspace](/content-assets/articles/article-mlops-mlops-infrastructure-azure-machine-learning-overview/loopcart-azure-ml-workspace.png)

*LoopCart's workspace ties the churn data asset, command job, environment, model asset, endpoint, and managed identity into one Azure ML boundary.*

## Turn Raw Files Into Data Assets
<!-- section-summary: Data assets give training jobs a named, versioned pointer to input data, so a model version can point back to the exact dataset it used. -->

The churn model needs training data before it needs cloud compute. LoopCart keeps curated feature files in Azure Blob Storage after a data pipeline joins subscription events, support tickets, marketing touches, payment failures, and account age. Azure ML can read those files directly, yet the team wraps the storage path as a **data asset** so jobs and reviews can use a stable name.

A **data asset** is a named, versioned reference to data. It can point to a folder, file, table-like source, or managed storage location. For LoopCart, the important part is the version. The model trained on `churn_features:2026-07-01` should keep that link after newer features land on July 8.

The data engineer creates a data asset with Azure ML CLI v2:

```yaml
$schema: https://azuremlschemas.azureedge.net/latest/data.schema.json
name: churn_features
version: "2026-07-01"
type: uri_folder
description: "Curated churn training features through 2026-07-01"
path: azureml://datastores/workspaceblobstore/paths/churn/features/2026-07-01/
tags:
  owner: retention-ml
  schema_version: churn_features_v5
  label_window_days: "30"
```

```bash
az ml data create \
  --file data/churn-features.yml \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod
```

The important fields are `name`, `version`, `type`, and `path`. The name gives the team a readable handle. The version freezes the training input identity. The path points to the real bytes in Blob Storage. The tags carry review context such as schema version and label window.

This small YAML file prevents a common production problem. A local script often reads "the latest CSV" from a folder. That is dangerous because the same code can train on different data tomorrow. A data asset lets the job say exactly which snapshot it used, and the model registration can carry that same dataset version into review.

## Run Training As A Managed Job
<!-- section-summary: A command job runs your training code on Azure-managed compute with explicit inputs, outputs, environment, and identity. -->

After the data asset exists, LoopCart can move the training script into an Azure ML **command job**. A command job runs code with a command line, an environment, input assets, output locations, and compute. The job is still your code; Azure ML manages the run record, compute handoff, logs, input mounting, output capture, and integration with the workspace.

The training repository has a small script:

```bash
python train.py \
  --train-data ./data \
  --model-dir ./outputs/model \
  --metrics-file ./outputs/metrics.json
```

The Azure ML job version makes the same work reproducible:

```yaml
$schema: https://azuremlschemas.azureedge.net/latest/commandJob.schema.json
type: command
display_name: train-churn-retention
experiment_name: churn-retention
code: ../src
command: >-
  python train.py
  --train-data ${{inputs.train_data}}
  --model-dir ${{outputs.model_output}}
  --metrics-file ${{outputs.metrics_output}}/metrics.json
environment: azureml:retention-train-env:8
compute: azureml:cpu-train-cluster
inputs:
  train_data:
    type: uri_folder
    path: azureml:churn_features:2026-07-01
outputs:
  model_output:
    type: uri_folder
  metrics_output:
    type: uri_folder
tags:
  git_sha: a1b2c3d
  owner: retention-ml
  dataset: churn_features:2026-07-01
```

```bash
az ml job create \
  --file jobs/train-churn.yml \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod
```

The `environment` points to a versioned Azure ML environment. That environment should pin Python packages and any system dependencies the training job needs. The `compute` points to a compute cluster, so the team can use a larger VM for training without running a permanent server. The `outputs` section tells Azure ML which job folders to preserve after the run.

LoopCart also adds a simple review check after the job finishes. The release workflow reads the metrics output and blocks model registration when the candidate misses the product bar:

```bash
az ml job download \
  --name train-churn-20260705-a1b2c3d \
  --download-path ./job-output \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod

jq -e '.auc >= 0.82 and .recall_at_top_5_percent >= 0.31' \
  ./job-output/named-outputs/metrics_output/metrics.json
```

This check keeps the registry useful. Weak training runs can stay in experiment history. Candidates that meet the bar move into model registration with enough evidence for a reviewer.

## Register A Model Asset
<!-- section-summary: A model asset turns training output into a named, versioned candidate that deployment and review workflows can reference. -->

A **model asset** is the Azure ML object that represents a trained model package. It can point to a folder, file, or MLflow model. The useful part is that deployment workflows can reference `azureml:churn-retention-model:2026-07-05.1` instead of a raw output folder from a job.

LoopCart uses MLflow format because the model can carry a signature, dependencies, and serving metadata. The training script logs the model with a clear name, input example, and signature:

```python
import mlflow
import mlflow.sklearn
from mlflow.models import infer_signature

with mlflow.start_run():
    model.fit(X_train, y_train)
    probabilities = model.predict_proba(X_valid)[:, 1]
    signature = infer_signature(X_valid.head(20), probabilities[:20])

    mlflow.log_metrics({
        "auc": float(auc),
        "recall_at_top_5_percent": float(recall_at_5),
    })

    mlflow.sklearn.log_model(
        sk_model=model,
        name="churn-retention-model",
        signature=signature,
        input_example=X_valid.head(3),
    )
```

After the job passes its metrics gate, the release workflow creates a model asset from the job output:

```yaml
$schema: https://azuremlschemas.azureedge.net/latest/model.schema.json
name: churn-retention-model
version: "2026-07-05.1"
type: mlflow_model
path: azureml://jobs/train-churn-20260705-a1b2c3d/outputs/model_output/paths/
description: "Retention churn model trained on churn_features:2026-07-01"
tags:
  git_sha: a1b2c3d
  dataset: churn_features:2026-07-01
  validation_status: passed
  business_owner: lifecycle-growth
```

```bash
az ml model create \
  --file models/churn-retention-model.yml \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod
```

The model asset gives the team a stable object for review and deployment. It also separates model identity from the training job name. The job records how training ran. The model asset records the candidate that may move toward serving.

## Use Registries And Pipelines For Promotion
<!-- section-summary: Azure ML registries and pipelines help teams reuse approved assets across workspaces and automate the handoff from data to training to model registration. -->

Many teams start with one workspace, then add more. LoopCart has development, staging, and production workspaces. Data scientists experiment in development. The release workflow validates in staging. Production serves only approved artifacts. A shared Azure ML **registry** helps the team reuse model assets, environments, and components across those workspaces.

The registry is useful because the production workspace can consume an approved model version without depending on a developer's workspace paths. The team publishes a candidate to the registry after review:

```bash
az ml model create \
  --file models/churn-retention-model.yml \
  --registry-name loopcart-ml-registry
```

The production deployment can then reference the registry asset by name and version. In practice, teams often protect the registry with approvals in CI, role-based access control, and tags such as `validation_status=passed` and `approved_by=retention-review-board`.

Pipelines help with repetition. A **pipeline job** links steps such as feature validation, training, evaluation, model registration, and endpoint smoke tests. The point is to make the weekly release path boring and inspectable.

Here is a compact Azure ML pipeline job shape:

```yaml
$schema: https://azuremlschemas.azureedge.net/latest/pipelineJob.schema.json
type: pipeline
display_name: churn-retention-release
experiment_name: churn-retention
settings:
  default_compute: azureml:cpu-train-cluster
jobs:
  train:
    type: command
    component: azureml:train_churn_component:4
    inputs:
      train_data: azureml:churn_features:2026-07-01
  evaluate:
    type: command
    component: azureml:evaluate_churn_component:3
    inputs:
      model_folder: ${{parent.jobs.train.outputs.model_output}}
      validation_data: azureml:churn_features:2026-07-01
```

The pipeline keeps the handoff explicit. The evaluation step consumes the training step output. The release workflow can register the model only after the evaluation output passes the agreed threshold. That gives the platform team a single run record to review instead of scattered notebook cells and screenshots.

![LoopCart Promotion Path](/content-assets/articles/article-mlops-mlops-infrastructure-azure-machine-learning-overview/loopcart-promotion-path.png)

*The promotion path gives LoopCart a readable handoff from development work to staging checks, registry review, production endpoint release, and blue-green traffic control.*

## Deploy With Managed Online Endpoints
<!-- section-summary: Managed online endpoints serve approved model versions behind Azure-managed infrastructure with traffic control, logging, and identity. -->

LoopCart's retention product needs online predictions. When a customer opens the cancellation flow, the product asks for a churn risk score and decides which help path or discount test the customer can see. That call needs low latency, a stable request contract, and a rollback path.

A **managed online endpoint** is Azure ML's managed real-time serving resource. The endpoint owns the public or private serving surface. A **deployment** behind the endpoint points to the model, scoring code, environment, VM type, and instance count. The endpoint can shift traffic between deployments, which is useful for blue-green or canary releases.

The endpoint YAML uses Microsoft Entra authentication and a user-assigned managed identity:

```yaml
$schema: https://azuremlschemas.azureedge.net/latest/managedOnlineEndpoint.schema.json
name: churn-retention-prod
auth_mode: aad_token
identity:
  type: user_assigned
  user_assigned_identities:
    - resource_id: /subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-loopcart-ml-prod/providers/Microsoft.ManagedIdentity/userAssignedIdentities/aml-retention-endpoint-prod
tags:
  owner: retention-ml
  environment: prod
```

```bash
az ml online-endpoint create \
  --file endpoints/churn-retention-endpoint.yml \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod
```

The deployment points to the approved model asset and scoring code:

```yaml
$schema: https://azuremlschemas.azureedge.net/latest/managedOnlineDeployment.schema.json
name: blue
endpoint_name: churn-retention-prod
model: azureml:churn-retention-model:2026-07-05.1
environment: azureml:retention-inference-env:4
code_configuration:
  code: ../scoring
  scoring_script: score.py
instance_type: Standard_DS3_v2
instance_count: 2
request_settings:
  request_timeout_ms: 3000
  max_concurrent_requests_per_instance: 4
tags:
  git_sha: a1b2c3d
  model_version: "2026-07-05.1"
```

```bash
az ml online-deployment create \
  --file endpoints/blue-deployment.yml \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod \
  --all-traffic
```

The first production deployment can take all traffic. The next release can create a `green` deployment and shift traffic in steps:

```bash
az ml online-deployment create \
  --file endpoints/green-deployment.yml \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod

az ml online-endpoint update \
  --name churn-retention-prod \
  --traffic blue=90 green=10 \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod
```

LoopCart watches latency, error rate, prediction volume, and business guardrails during the 10 percent step. If the new model sends too many customers into an expensive retention offer, the team moves traffic back to `blue` and keeps the incident review tied to the model version, endpoint deployment, and request logs.

## Identity, Networking, And Operating Checks
<!-- section-summary: Production Azure ML work needs small managed identities, private data paths, logs, endpoint tests, and rollback checks around the managed resources. -->

Managed services still need careful access design. Azure ML can run jobs and endpoints with managed identities, which lets the workload access Azure resources without long-lived secrets in code. LoopCart uses separate identities for training and serving because they need different permissions.

The training identity can read the curated feature path and write job outputs. The endpoint identity can read only approved model artifacts and any runtime reference data. The deployment workflow identity can create endpoints and update traffic. The model scoring code has no traffic-management permission.

A typical role assignment for the endpoint identity grants read access to the storage account that holds approved artifacts:

```bash
az role assignment create \
  --assignee-object-id "$ENDPOINT_IDENTITY_OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Reader" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-loopcart-ml-prod/providers/Microsoft.Storage/storageAccounts/loopcartmlprod"
```

Network design depends on the company. Some teams keep managed endpoints public with Entra auth and strict caller controls. Other teams use private networking so training data, artifacts, and endpoint calls stay inside approved network paths. The important beginner habit is to draw the data path: source storage, training compute, model registry, endpoint, logs, and caller.

LoopCart runs these checks before a release:

| Check | Evidence |
| --- | --- |
| Data asset points to the intended snapshot | `az ml data show --name churn_features --version 2026-07-01` |
| Training job used the expected code and data | Job tags include `git_sha` and `dataset` |
| Model asset has validation tags | `validation_status=passed` and reviewer identity |
| Endpoint identity has small access | Storage read scope matches approved artifact location |
| Smoke test passes | A known request returns a valid schema and latency under the target |
| Rollback target exists | Previous deployment still has traffic metadata and model asset version |

The smoke test can run through the Azure ML endpoint:

```bash
az ml online-endpoint invoke \
  --name churn-retention-prod \
  --request-file tests/sample-cancel-flow-request.json \
  --workspace-name loopcart-ml-prod \
  --resource-group rg-loopcart-ml-prod
```

That command checks the serving contract from the caller's point of view. It should return the score, model version, and any reason codes the product API expects. A release that passes training metrics and fails this endpoint contract should stop before it reaches customers.

![LoopCart Production Checks](/content-assets/articles/article-mlops-mlops-infrastructure-azure-machine-learning-overview/loopcart-production-checks.png)

*The final Azure ML release review follows the churn score from data snapshot to endpoint identity, smoke test, and rollback target before the retention product acts on it.*

## When Azure ML Helps And When It Adds Weight
<!-- section-summary: Azure ML helps when a team needs Azure-native managed training, registry, endpoints, and governance, while small projects may prefer a lighter stack at first. -->

Azure ML helps LoopCart because the team already runs on Azure, uses Blob Storage and Entra ID, and needs a repeatable path from training to serving. The platform gives data assets, jobs, registries, environments, endpoints, and managed identities in one Azure control plane. That is valuable when the team has several model owners and a real production release process.

It also helps when compliance and audit matter. A reviewer can inspect the model asset, job tags, data asset version, endpoint deployment, and identity permissions. The release workflow can require approvals before publishing to the registry or sending traffic to a new deployment.

Azure ML can add weight for a tiny team with one offline script and no production serving yet. The team still has to learn workspace design, asset versioning, compute, identity, YAML schemas, and release automation. A small project may start with MLflow tracking, object storage, and a scheduled job, then move into Azure ML when handoffs, serving, governance, or Azure-native access controls create enough value.

The practical question is where the pain sits today. If the pain is reproducible jobs, shared model assets, endpoint operations, and Azure IAM review, Azure ML gives useful structure. If the pain is still basic data quality and a clear evaluation metric, fix those first because Azure ML will faithfully run a weak workflow too.

## Practical Checks And Interview-Ready Understanding
<!-- section-summary: A strong Azure ML explanation connects workspaces, data assets, jobs, registries, endpoints, identities, and rollback into one production workflow. -->

Before you call an Azure ML workflow production-ready, walk through the evidence from data to serving. You should know which workspace owns the run, which data asset trained the model, which environment ran the code, which job produced the artifact, which model asset was reviewed, which identity can read the artifact, which deployment serves traffic, and which command rolls traffic back.

Common mistakes are easy to spot once you follow that chain. Teams train from a moving storage path without a data asset version. They register a model with no dataset tag. They let the endpoint identity read too much storage. They replace all traffic at once without a rollback deployment. They treat the registry as a file dump instead of a release boundary.

In an interview, a clear answer sounds like this: Azure ML is an Azure-native managed MLOps platform. I would use a workspace for the product boundary, data assets for versioned inputs, command or pipeline jobs for training, model assets and registries for review and reuse, managed online endpoints for serving, and managed identities for least-privilege access. The important production habit is to keep the evidence connected from data snapshot to endpoint traffic.

## References

- [Azure Machine Learning CLI and SDK v2 concepts](https://learn.microsoft.com/en-us/azure/machine-learning/concept-v2?view=azureml-api-2)
- [Create data assets in Azure Machine Learning](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-create-data-assets?view=azureml-api-2)
- [Create and manage models in Azure Machine Learning](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-manage-models?view=azureml-api-2)
- [What are Azure Machine Learning registries?](https://learn.microsoft.com/en-us/azure/machine-learning/concept-machine-learning-registries?view=azureml-api-2)
- [Deploy and score a machine learning model with a managed online endpoint](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-deploy-online-endpoints?view=azureml-api-2)
- [Access Azure resources from online endpoints with managed identity](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-access-resources-from-endpoints-managed-identities?view=azureml-api-2)
