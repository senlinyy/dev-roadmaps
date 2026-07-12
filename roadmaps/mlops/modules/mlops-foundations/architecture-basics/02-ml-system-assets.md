---
title: "ML System Assets"
description: "Explain the main assets that need storage, versioning, and ownership."
overview: "A production ML system has more assets than one model file. This article explains the code, data, labels, features, configs, environments, artifacts, metrics, reports, approvals, and logs that need ownership and traceability."
tags: ["MLOps", "core", "architecture"]
order: 2
id: "article-mlops-mlops-foundations-ml-system-assets"
---

## Table of Contents

1. [A Model File Is Only One Asset](#a-model-file-is-only-one-asset)
2. [Code And Configuration](#code-and-configuration)
3. [Data, Labels, And Features](#data-labels-and-features)
4. [Model Artifacts And Runtime Dependencies](#model-artifacts-and-runtime-dependencies)
5. [Metrics, Reports, And Approval Records](#metrics-reports-and-approval-records)
6. [Logs, Predictions, And Feedback](#logs-predictions-and-feedback)
7. [Asset Inventory Checklist](#asset-inventory-checklist)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## A Model File Is Only One Asset
<!-- section-summary: Production ML systems need traceability across many assets, including data, code, config, environment, model artifacts, reports, approvals, and monitoring evidence. -->

When people first talk about shipping a model, they often picture one file. Maybe it is `model.pkl`, `model.onnx`, a PyTorch checkpoint, or a TensorFlow SavedModel directory. That file matters, but a production ML system has many other assets around it.

An **ML system asset** is any file, record, dataset, configuration, environment, report, or log that the team needs to train, evaluate, deploy, operate, or explain a model. If a future incident review needs it, treat it as an asset. If a new model version can change when it changes, treat it as an asset.

Let's use **HarborBooks**, an online bookstore that trains a search-ranking model. When a reader searches for "machine learning", the model decides which books appear first. The model artifact matters, but it also depends on query logs, click labels, purchase labels, moderation rules, feature code, a data snapshot, model parameters, environment versions, evaluation reports, approval records, deployment config, prediction logs, and delayed customer feedback. The model file without those assets is hard to trust.

Here is a compact view.

![ML assets map showing code, data, features, model, config, and environment as connected production assets](/content-assets/articles/article-mlops-mlops-foundations-ml-system-assets/ml-assets-map.png)

_The asset map shows why a production model is more than one model file: code, data, features, config, and runtime all shape behavior._

The goal of asset management is practical: when model version `v18` ranks sponsored books too high compared with `v17`, the team can compare the assets that changed. Maybe the training data included a holiday sale week. Maybe a feature changed from `author_popularity_30d` to `author_popularity_7d`. Maybe the serving image loaded an older tokenizer. Asset traceability gives the team facts before the argument starts.

## Code And Configuration
<!-- section-summary: Code and configuration define how data turns into a model, so they need version control, review, and links to each training run. -->

The first assets are **code** and **configuration**. Code includes feature-building logic, training code, evaluation code, serving code, pipeline code, and tests. Configuration includes the values that shape a run: feature list, date windows, model parameters, thresholds, artifact paths, and environment names.

For HarborBooks, a small change in feature code can change the model. If `query_click_rate_30d` uses a 30-day window in one run and a 7-day window in another, the same model algorithm can learn a different pattern. If the config changes the training date range, the model can learn from a seasonal sale instead of normal browsing behavior.

Version control gives code and config a review trail.

```yaml
code:
  repository: github.com/harborbooks/search-ranker
  training_commit: 7d83a14
  serving_commit: 33b7cc1
config:
  file: configs/search-ranker.yml
  feature_set: search_features_v6
  ranking_policy: relevance_first_v3
```

The training run should record these values. A model artifact with no code commit is hard to review. A model artifact with no config is hard to compare. Together, code and config explain how the run should behave.

A useful production habit is to store the config file beside the run output, not only in the repository. The repository tells you what the config looked like at a commit. The run artifact tells you which exact config file the training job actually used. That distinction helps when a local experiment overrides one value from the command line or when a scheduled job reads a config from a release branch.

## Data, Labels, And Features
<!-- section-summary: Data, labels, and features are core ML assets because model behavior depends on their definitions, quality, freshness, timing, and lineage. -->

The next assets are **data**, **labels**, and **features**. Training data is the set of examples the model learns from. Labels are the outcomes the model tries to predict. Features are the input values the model uses to make predictions.

For the search-ranking model, one training example might include a search query, book ID, category, language, price band, stock status, author popularity, click position, add-to-cart outcome, purchase outcome, and moderation status. Each field needs a definition and a time boundary. The model should learn from signals available before the ranking decision, not from a purchase event that happened after the reader clicked a result.

A dataset snapshot should have a stable name or URI. The team can choose a retention policy that fits cost and compliance while still identifying which examples trained an important model version and keeping enough lineage to investigate problems.

```yaml
data:
  training_snapshot: s3://harborbooks-ml-data/search-ranking/examples/2026-06-30/
  source_tables:
    - search_impressions
    - product_catalog
    - click_events
    - purchase_events
    - moderation_flags
labels:
  name: clicked_or_purchased_within_24_hours
  positive_sources:
    - result_click
    - add_to_cart
    - completed_purchase
features:
  feature_set_version: search_features_v6
  decision_time: search_request_at
```

Label definitions deserve special care. If HarborBooks changes the label from "clicked" to "purchased", the model can change even if code stays the same. Clicks teach relevance and curiosity. Purchases teach commercial outcome. Both can be valid, but they answer different product questions. Feature definitions need the same care because training and serving should compute the same meaning for the same field.

Dataset versioning tools make this concrete. A small team might use DVC to tie data and model snapshots to Git commits. A larger data platform might use object-storage manifests, table versions, lakehouse snapshots, W&B Artifacts, or a warehouse lineage catalog. The tool choice can change, but the asset requirement stays simple: the run record should point to the exact examples and labels used for training.

## Model Artifacts And Runtime Dependencies
<!-- section-summary: Model artifacts need metadata and runtime dependencies so the production environment can load them and use them correctly. -->

The **model artifact** is the saved result of training. It may contain learned weights, a serialized pipeline, tokenizer files, vocabulary files, calibration settings, thresholds, or preprocessing objects. Some models produce one file. Others produce a directory of files that must move together.

HarborBooks' artifact might include an XGBoost ranker, a feature order file, a text normalization vocabulary, a query tokenizer, and a small calibration file for confidence reporting. All of these pieces should belong to the same versioned package.

```yaml
model_package:
  name: search-ranker
  version: v18
  files:
    - ranker.xgb
    - feature_order.json
    - text_normalizer.json
    - query_tokenizer.json
    - calibration.json
  artifact_uri: s3://harborbooks-ml-models/search-ranker/v18/
```

Runtime dependencies are assets too. A model can load in training and fail in serving if Python, package versions, operating system libraries, CPU instruction support, GPU libraries, or model server versions differ. The team should record the training image and serving image, then test that the artifact loads in the serving image.

```yaml
runtime:
  training_image: ghcr.io/harborbooks/search-train:2026-07-04
  serving_image: ghcr.io/harborbooks/search-serving:2026-07-04
  python: "3.11"
  xgboost: "2.1.4"
```

This metadata helps during upgrades. If model `v19` fails after a dependency change, the team can compare the runtime assets with `v18`.

## Metrics, Reports, And Approval Records
<!-- section-summary: Metrics, reports, and approvals explain why a model version was allowed to move forward. -->

A production model should have evidence, not only artifacts. **Metrics** show how the candidate performed. **Reports** explain the evaluation context. **Approval records** show who accepted the release risk and under which conditions.

![Release evidence bundle showing data snapshot, training run, evaluation report, model artifact, approval ticket, and rollback target collected around one release](/content-assets/articles/article-mlops-mlops-foundations-ml-system-assets/release-evidence-bundle.png)

_The bundle view shows the evidence reviewers need before they can trust a model version enough to release or roll it back._

For the search-ranking model, an evaluation report should compare the candidate with the baseline. It should include primary metrics, guardrails, segments, latency, known limitations, and the release recommendation. Ranking models need segment evidence because aggregate relevance can hide a bad release. A model can improve popular programming books while burying children's books, non-English titles, or small publishers.

```yaml
evaluation_report:
  candidate: search-ranker:v18
  baseline: search-ranker:v17
  primary_metric:
    ndcg_at_10:
      baseline: 0.417
      candidate: 0.431
  guardrails:
    small_publisher_exposure: passed
    p95_ranking_latency_ms: passed
  segments:
    childrens_books: needs_review
    technical_books: passed
approval:
  status: approved_for_shadow
  approvers:
    - search-ml-owner
    - marketplace-product-owner
    - catalog-quality-reviewer
```

These assets matter later. If the model creates a customer problem, the team can see whether the problem was known, whether the release followed the approval conditions, and whether the evaluation missed a segment.

## Logs, Predictions, And Feedback
<!-- section-summary: Production logs, prediction records, labels, reviews, and incident notes create the feedback assets that guide monitoring and future model versions. -->

After deployment, the system creates new assets. Prediction logs show which model version produced which score for which request. Monitoring metrics show service health and model behavior. Labels and feedback show what happened after the prediction.

Prediction logs need careful design because they can contain sensitive data. The team may store request IDs, model version, feature summary, score, threshold decision, latency, and trace IDs while masking or excluding sensitive fields. Privacy and security requirements should shape the logging plan.

```json
{
  "request_id": "search_8x91",
  "model": "search-ranker",
  "version": "v18",
  "query": "machine learning",
  "top_result_book_id": "book_4412",
  "ranker_latency_ms": 38,
  "result_count": 24,
  "trace_id": "trc_4412"
}
```

Feedback assets include clicks, add-to-cart events, purchases, zero-result searches, customer support tags, catalog review notes, incident reports, and retraining notes. These assets help the next model version learn from production. They also help the team explain whether a release improved the product decision.

## Asset Inventory Checklist
<!-- section-summary: A simple inventory helps teams know which assets exist, where they live, who owns them, and how long they should be retained. -->

An asset inventory does not need to be fancy. It can start as a table in a repository or a metadata record in a platform. The inventory should name each asset, owner, storage location, version strategy, and retention expectation.

| Asset | Example | Owner |
|---|---|---|
| Training code | `search-ranker` repository | Search ML team |
| Config | `configs/search-ranker.yml` | Search ML team |
| Dataset snapshot | `s3://harborbooks-ml-data/search-ranking/...` | Data platform |
| Label definition | `clicked_or_purchased_within_24_hours` | Search product |
| Model artifact | `search-ranker:v18` | Search ML team |
| Runtime image | `search-serving:2026-07-04` | ML platform |
| Evaluation report | `reports/search-ranker/v18.yml` | Search ML team |
| Approval record | release gate entry | Product and catalog-quality owners |
| Prediction logs | request ranking records | ML platform and data platform |
| Incident notes | post-incident review | On-call and product owners |

The inventory should also include access controls. Model artifacts, data snapshots, and prediction logs can contain sensitive business or customer information. Ownership includes permission management, not only file naming.

## Putting It All Together
<!-- section-summary: Asset traceability lets a team explain how a model version was created, approved, deployed, monitored, and improved. -->

ML system assets are the material trail behind a model version. Code explains how the model was trained. Data explains what the model learned from. Config explains the choices for that run. Environment explains where the run happened. Artifacts are the files the runtime uses. Reports and approvals explain why release was allowed. Logs and feedback explain what happened after release.

For HarborBooks, asset traceability lets the team compare `v18` with `v17`. They can see whether the data changed, whether the feature set changed, whether the ranking policy changed, whether the serving image changed, and whether production feedback supports the next training cycle. That is why asset management sits near the beginning of the roadmap.

![Asset changes change behavior infographic showing feature definition, dependency version, and data snapshot changes flowing into monitored model output](/content-assets/articles/article-mlops-mlops-foundations-ml-system-assets/asset-change-behavior.png)

_The summary visual shows the practical reason asset tracking matters: small asset changes can alter predictions, so monitoring needs to connect behavior back to the changed asset._

## What's Next
<!-- section-summary: The next article compares the serving modes that use these assets in production. -->

The next article compares serving modes. We will look at batch, online, and streaming patterns so you can classify how a model reaches users or downstream systems.

## References

- [Google Cloud: MLOps continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) - Covers metadata management, model validation, model deployment, and monitoring assets in ML pipelines.
- [AWS SageMaker AI: Model Registry](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry.html) - Documents model packages, model package groups, versioning, and approval status.
- [Microsoft Learn: MLOps model management with Azure Machine Learning](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-management-and-deployment?view=azureml-api-2) - Describes reusable environments, model registration, lineage, and model lifecycle management.
- [MLflow Docs: Tracking](https://mlflow.org/docs/latest/ml/tracking/) - Documents run metadata, parameters, metrics, artifacts, and experiment tracking.
- [DVC Docs: Versioning Data and Models](https://doc.dvc.org/example-scenarios/versioning-data-and-models) - Shows how data and model versions can be tied to source-code history while large files live outside Git.
- [W&B Docs: Registry overview](https://docs.wandb.ai/models/registry) - Documents artifact versions, registries, lineage, audit history, and downstream automation.
