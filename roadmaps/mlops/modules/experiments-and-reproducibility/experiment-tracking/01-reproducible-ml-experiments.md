---
title: "Reproducible Experiments"
description: "Explain how teams make an ML experiment explainable and rerunnable by recording code, data, configuration, environment, seeds, metrics, and artifacts."
overview: "A reproducible ML experiment records the ingredients behind one model result: code commit, dataset snapshot, configuration, container or package environment, random seed, metrics, notes, and artifacts. This article follows a recommendation ranking team as they build that record with MLflow."
tags: ["MLOps", "core", "tracking"]
order: 1
id: "article-mlops-experiments-and-reproducibility-reproducible-ml-experiments"
---

## Table of Contents

1. [Reproducible Means You Can Explain And Rerun The Result](#reproducible-means-you-can-explain-and-rerun-the-result)
2. [Follow One Recommendation Experiment](#follow-one-recommendation-experiment)
3. [Record The Ingredients](#record-the-ingredients)
4. [Freeze Code, Config, And Data](#freeze-code-config-and-data)
5. [Control Environment And Randomness](#control-environment-and-randomness)
6. [Log A Run With MLflow](#log-a-run-with-mlflow)
7. [Review A Run Before You Trust It](#review-a-run-before-you-trust-it)
8. [Failure Modes You Can Diagnose](#failure-modes-you-can-diagnose)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Reproducible Means You Can Explain And Rerun The Result
<!-- section-summary: A reproducible experiment ties one ML result to the exact ingredients that produced it. -->

An ML experiment is one planned attempt to train, evaluate, or compare a model. In a notebook, that attempt can feel informal: change a feature, run a cell, look at a score, then try the next idea. In a production team, a strong score can lead to a model review, a registry entry, a shadow test, or a customer-facing release, so the experiment needs a record that survives after the notebook session ends.

A **reproducible ML experiment** is a run whose important ingredients are recorded well enough for another teammate to explain the result and rerun it close enough for review. The record ties code, dataset snapshot, configuration, environment, seed, metrics, notes, and artifacts to one run ID. You may still see tiny differences from hardware, parallel training, or library behavior, yet the team can inspect the same recipe instead of guessing what happened.

This matters most when a run surprises people. A ranking model may improve `nDCG@10` by three points, or a vision model may suddenly miss a defect class it handled last week. Reproducibility gives the team a path back through the evidence: which data changed, which commit ran, which hyperparameters were used, which package versions were installed, and which artifact was proposed for release.

## Follow One Recommendation Experiment
<!-- section-summary: The running scenario follows a retail recommendation team that needs evidence behind a promising ranking model. -->

Imagine the recommendation team at **Luma Retail**, an online store that shows a "Recommended for you" shelf on the home page. The current production model is `homepage-ranker:v11`, a LightGBM ranker trained on click, cart, purchase, and product metadata features. The team wants to test a new feature group from product image embeddings because merchandisers believe similar-looking products help shoppers browse seasonal collections.

The experiment owner is Priya, the ranking engineer on call for the weekly model review. The dataset is `recs_clickstream_rank_train_2026_06_30`, built from thirty days of logged home-page impressions, click labels, add-to-cart labels, and purchase labels. The primary metric is `nDCG@10` because the first ten recommendations carry most of the product value. Guardrail metrics include catalog coverage, duplicate-product rate, cold-start product exposure, training cost, and batch scoring latency.

Here is the business problem in plain English: Priya needs to tell the team whether the new image embedding features improved recommendations, and she needs enough evidence for another engineer to rerun the candidate if the review asks for proof. A screenshot of a good chart is too thin for that review. A reproducible run record carries the evidence.

## Record The Ingredients
<!-- section-summary: A useful run record names the code, data, config, environment, seed, metrics, artifacts, owner, and reason for the run. -->

The first habit is to treat every experiment run like a small evidence package. The package should answer a simple question: if this result matters two weeks from now, can the team find the exact inputs and outputs without asking the original author to remember them?

For Luma Retail, the run record can use this shape:

| Ingredient | Example for the ranking run | Why reviewers care |
|---|---|---|
| Run ID | `recs-lgbm-2026-07-04-1430` | One handle for logs, metrics, artifacts, and discussion |
| Owner | `priya@luma.example` | A person who can explain the hypothesis and result |
| Code commit | `8f24c91` | The training logic, feature joins, and evaluation code |
| Dataset snapshot | `recs_clickstream_rank_train_2026_06_30:v4` | The exact training and validation examples |
| Config file | `configs/homepage_ranker_image_features.yaml` | Hyperparameters, feature groups, windows, thresholds |
| Environment | `ghcr.io/luma/recs-train@sha256:6ab...` | Python, LightGBM, CUDA, OS libraries, and system packages |
| Seed | `20260704` | The random starting point for splits, sampling, and model training |
| Metrics | `valid/ndcg_at_10`, `valid/coverage`, `batch/p95_ms` | The evidence used to judge the candidate |
| Artifacts | `model.txt`, `feature_schema.json`, `segment_metrics.csv` | Files needed for review, rerun, registry, or debugging |
| Notes | "Add CLIP image embedding features to home-page ranker." | The human reason for the run |

![Luma Retail MLflow run evidence packet](/content-assets/articles/article-mlops-experiments-and-reproducibility-reproducible-ml-experiments/luma-mlflow-run-evidence-packet.png)
*A reproducible run gives Luma Retail one MLflow record that connects code, data, config, environment, metrics, artifacts, and review notes.*

A table like this may feel simple, and that is the point. Reproducibility improves when the team records ordinary facts consistently. The hard part is discipline across notebooks, scheduled training jobs, CI runs, and model review packets.

## Freeze Code, Config, And Data
<!-- section-summary: Code, config, and data snapshots explain what logic ran and which examples trained the model. -->

Code identity starts with the Git commit. The commit should be clean enough for review, meaning the run record should show the commit hash and whether local uncommitted changes existed. A run from a dirty workspace can still teach something during exploration, yet it should carry a visible warning because the exact source may be hard to recover later.

Configuration deserves the same treatment as code. A ranking run usually has many choices: feature groups, date windows, model type, learning rate, tree depth, negative sampling ratio, early stopping rounds, and metric thresholds. If those choices live only inside ad hoc notebook variables, another teammate has to reconstruct the run by reading cells in order. A versioned YAML file gives the team a stable review object.

```yaml
experiment:
  name: homepage-ranker-image-features
  owner: priya@luma.example
  hypothesis: "Image embedding features improve visual discovery without reducing catalog coverage."

data:
  train_snapshot: recs_clickstream_rank_train_2026_06_30:v4
  validation_snapshot: recs_clickstream_rank_valid_2026_06_30:v4
  source_uri: s3://luma-ml/datasets/recommendations/snapshot_date=2026-06-30/
  snapshot_sha256: 72f2b6c9a8f1d31e9267b4a3b6a40e2f0c8d90e4a61df2a41d7f2a06bb7c0914

model:
  algorithm: lightgbm_lambdarank
  learning_rate: 0.04
  num_leaves: 63
  max_depth: 8
  num_boost_round: 700
  early_stopping_rounds: 50

features:
  base_set: recs_homepage_features_v11
  add_groups:
    - product_image_clip_embedding_v2
    - visual_similarity_bucket_v1

runtime:
  seed: 20260704
  container_image: ghcr.io/luma/recs-train@sha256:6ab91c52
```

The data snapshot is the ingredient beginners often under-record. A path named `latest_train.parquet` gives weak evidence because the contents can change. A stronger snapshot has a date, a version, a manifest, and a checksum or table version. Teams usually store this in object storage, a lakehouse table version, DVC, lakeFS, MLflow dataset metadata, or a warehouse snapshot table.

For this ranking job, Priya should keep the dataset manifest with the run:

```yaml
dataset_manifest:
  name: recs_clickstream_rank_train_2026_06_30
  version: v4
  rows: 184203911
  impression_window_utc: "2026-06-01T00:00:00Z..2026-06-30T23:59:59Z"
  label_delay_hours: 24
  entity_keys:
    - user_id_hash
    - product_id
    - request_id
  files:
    - s3://luma-ml/datasets/recommendations/snapshot_date=2026-06-30/part-000.parquet
    - s3://luma-ml/datasets/recommendations/snapshot_date=2026-06-30/part-001.parquet
  validation_checks:
    duplicate_request_product_pairs: 0
    missing_product_embedding_rate: 0.0031
    label_positive_rate: 0.087
```

Now the run has a data receipt. If a later candidate changes because a feature pipeline backfilled image embeddings, the team can compare manifests instead of debating from memory.

![Luma Retail freeze code config and data workflow](/content-assets/articles/article-mlops-experiments-and-reproducibility-reproducible-ml-experiments/luma-freeze-code-config-data.png)
*Priya can rebuild the candidate only when the Git commit, YAML config, dataset version, manifest checksum, training job, and MLflow run point to the same recipe.*

## Control Environment And Randomness
<!-- section-summary: The environment and seed explain the runtime conditions around a training result. -->

The environment is the software and hardware context that ran the experiment. Python version, package versions, CUDA libraries, operating system packages, CPU or GPU type, and container image all affect real training work. A model can train successfully on one laptop and fail in CI because the LightGBM version, BLAS library, or GPU driver differs.

Most industrial teams handle this with a container image for scheduled training and a lock file for local development. The run record should capture the image digest along with the friendly tag. A tag such as `latest` or `2026-07-04` can move. A digest points at one exact image.

Randomness also needs a clear record. Sampling, train-validation splits, tree learners, neural networks, and distributed workers may use random number generators. A seed helps the team rerun the same path, although some frameworks and hardware kernels can still produce different low-level results. PyTorch's official reproducibility notes are careful about this: releases, platforms, and operations can affect exact repeatability.

For Python training code, seed setup can live near the top of the job:

```python
import os
import random

import numpy as np


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)


seed_everything(20260704)
```

If the model uses PyTorch, TensorFlow, Spark, or distributed GPU training, the job needs framework-specific settings as well. The important article idea stays simple: the seed belongs in the run record, and exact reruns require environment control plus framework-aware training settings.

## Log A Run With MLflow
<!-- section-summary: MLflow gives the team one place to store run parameters, metrics, tags, artifacts, and model files. -->

MLflow Tracking is a common way to store experiment runs. A small local team can start with a local tracking directory. A production team usually points clients at an MLflow tracking server with a backend store for metadata and an artifact store such as S3, GCS, Azure Blob Storage, or a managed platform.

The training command might look like this in CI or a scheduled job:

```bash
export MLFLOW_TRACKING_URI=https://mlflow.luma.example
export IMAGE_DIGEST=ghcr.io/luma/recs-train@sha256:6ab91c52

python train_ranker.py \
  --config configs/homepage_ranker_image_features.yaml \
  --run-name recs-lgbm-2026-07-04-1430
```

Inside the training script, the run should log the facts reviewers need. The example below keeps the code compact, yet it shows the core habit: log parameters, metrics, tags, config files, environment files, evaluation files, and the model artifact under the same run.

```python
import json
import os
import subprocess
from pathlib import Path

import mlflow
import mlflow.lightgbm
from mlflow.models import infer_signature
import yaml


def git_commit() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()


config_path = Path("configs/homepage_ranker_image_features.yaml")
config = yaml.safe_load(config_path.read_text())

mlflow.set_experiment("homepage-recommendation-ranking")

with mlflow.start_run(run_name=os.environ.get("RUN_NAME", "local-ranker-run")):
    mlflow.set_tags(
        {
            "owner": config["experiment"]["owner"],
            "code.commit": git_commit(),
            "data.train_snapshot": config["data"]["train_snapshot"],
            "data.validation_snapshot": config["data"]["validation_snapshot"],
            "runtime.image": os.environ.get("IMAGE_DIGEST", "local-dev"),
            "hypothesis": config["experiment"]["hypothesis"],
        }
    )

    mlflow.log_params(
        {
            "algorithm": config["model"]["algorithm"],
            "learning_rate": config["model"]["learning_rate"],
            "num_leaves": config["model"]["num_leaves"],
            "max_depth": config["model"]["max_depth"],
            "seed": config["runtime"]["seed"],
            "base_feature_set": config["features"]["base_set"],
            "added_feature_groups": ",".join(config["features"]["add_groups"]),
        }
    )

    model, metrics, X_valid = train_and_evaluate(config)

    mlflow.log_metrics(
        {
            "valid_ndcg_at_10": metrics["valid_ndcg_at_10"],
            "valid_map_at_10": metrics["valid_map_at_10"],
            "catalog_coverage": metrics["catalog_coverage"],
            "duplicate_product_rate": metrics["duplicate_product_rate"],
            "batch_p95_ms": metrics["batch_p95_ms"],
        }
    )

    mlflow.log_artifact(str(config_path), artifact_path="config")
    mlflow.log_artifact("requirements.lock", artifact_path="environment")
    mlflow.log_artifact("artifacts/dataset_manifest.yaml", artifact_path="data")
    mlflow.log_artifact("artifacts/segment_metrics.csv", artifact_path="evaluation")
    mlflow.log_artifact("artifacts/top_failures.parquet", artifact_path="evaluation")

    input_example = X_valid.head(5)
    signature = infer_signature(input_example, model.predict(input_example))
    mlflow.lightgbm.log_model(
        model,
        name="model",
        input_example=input_example,
        signature=signature,
    )
    mlflow.log_text(json.dumps(metrics, indent=2), artifact_file="evaluation/metrics.json")
```

The code commit and dataset snapshot are logged as tags because reviewers often filter by them. Hyperparameters are logged as parameters because comparison tables use them side by side. Scores are logged as metrics because tracking tools plot and sort them. Files are logged as artifacts because the model review needs more than scalar values. In MLflow 3-style examples, model logging uses `name="model"` because the older `artifact_path` parameter is deprecated for model logging.

The example assumes `train_and_evaluate` returns the validation feature frame as `X_valid`. That small detail matters in real registry and serving workflows: the input example and inferred signature tell the next system what shape the model expects, and Databricks documents model signatures as a required part of Unity Catalog model versions.

## Review A Run Before You Trust It
<!-- section-summary: Trust comes from checking the run record against the baseline, the dataset, the environment, and the artifacts. -->

A reproducible run is useful only if the team checks it before making a decision. The review should be boring in a good way: the same evidence appears every time, and missing evidence blocks promotion until someone fills the gap.

For Luma Retail, the weekly model review can use this checklist:

| Check | What the reviewer expects |
|---|---|
| Code commit | Commit exists in Git, CI passed, dirty workspace tag is absent |
| Dataset snapshot | Train and validation snapshots have fixed versions, manifests, and row counts |
| Config | YAML file is attached, reviewed, and matches the run parameters |
| Environment | Container image digest or lock file is attached |
| Seed | Seed is logged and used by the training script |
| Baseline | Current production model `homepage-ranker:v11` ran on the same validation snapshot |
| Metrics | Primary metric, guardrails, and segment metrics are all present |
| Artifacts | Model file, feature schema, evaluation report, and failure samples are attached |
| Notes | Hypothesis, owner, and review outcome are written in the run |

The baseline line is especially important. If Priya trains the new candidate on `valid_2026_06_30` and compares it with a baseline score from `valid_2026_05_31`, the comparison mixes model quality with data changes. A reproducible experiment records enough information to catch that mismatch quickly.

A review packet can point back to the MLflow run:

```yaml
candidate_review:
  run_id: 6e68c42cf62a4f7db93d3f5f4e65a9d1
  mlflow_experiment: homepage-recommendation-ranking
  candidate_model: s3://luma-mlflow-artifacts/6e68c42/model/
  baseline_model: homepage-ranker:v11
  shared_validation_snapshot: recs_clickstream_rank_valid_2026_06_30:v4
  decision: hold_for_segment_review
  reason:
    - valid_ndcg_at_10 improved from 0.417 to 0.431
    - catalog_coverage dropped from 0.74 to 0.69
    - cold_start_product_exposure needs merchandising review
```

That decision record is part of reproducibility too. Future teammates need to know which run won the metric table and why the team held it back.

## Failure Modes You Can Diagnose
<!-- section-summary: Reproducibility helps the team investigate metric jumps, missing artifacts, data drift, and production incidents. -->

Once the run record exists, several common experiment failures get easier to debug. A metric jump may trace back to a dataset snapshot with duplicate impression rows. A slow model may trace back to a new feature group that calls a heavier embedding lookup. A model artifact may fail serving validation because the feature schema attached to the run differs from the online feature contract.

Here are practical examples:

| Failure mode | Evidence that helps |
|---|---|
| Offline metric improved while online click rate later dropped | Baseline and candidate predictions, segment metrics, and top failure samples |
| Teammate struggles to rerun the candidate | Git commit, config file, container digest, dataset manifest, and seed |
| Model serving rejects requests | Logged `feature_schema.json` and example prediction payloads |
| Evaluation shifts after a data backfill | Dataset snapshot version, row counts, label delay, and manifest checksum |
| Review loses track of the trained model | MLflow run ID and model artifact URI |

This is the reason MLOps teams care about experiment tracking before they care about fancy dashboards. A dashboard is helpful after the evidence exists. The core win is that a model result has a trail from idea to data to artifact.

## Putting It Together
<!-- section-summary: Reproducible experiments give every important result a durable trail from idea to artifact. -->

A reproducible experiment is an ML run with a durable recipe. The recipe records code, data, config, environment, seed, metrics, artifacts, owner, and notes. The team can explain the result, compare it with a baseline, rerun it closely enough for review, and debug it when the result later matters.

For Luma Retail, Priya's recommendation experiment is reproducible when the MLflow run links the image-feature hypothesis to the exact training snapshot, Git commit, YAML config, container digest, metrics, segment reports, and model artifact. That evidence gives the team a shared trail for the candidate review.

![Luma Retail reproducible experiment review trail](/content-assets/articles/article-mlops-experiments-and-reproducibility-reproducible-ml-experiments/luma-review-trail-summary.png)
*The experiment trail connects the hypothesis, run evidence, baseline check, segment review, hold decision, and the next rerun.*

## References

- [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) - Official MLflow guide for experiments, runs, parameters, metrics, tags, artifacts, and comparisons.
- [MLflow Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/) - Official MLflow API guide for logging runs from training code.
- [MLflow Dataset Tracking](https://mlflow.org/docs/latest/ml/dataset/) - Official MLflow guide for dataset lineage and dataset records in runs.
- [MLflow Models](https://mlflow.org/docs/latest/ml/model/) - Official MLflow guide for packaging model artifacts.
- [Databricks: Get started with MLflow 3 for models](https://docs.databricks.com/aws/en/mlflow/mlflow-3-install) - Official Databricks guide that explains MLflow 3 logged models and the `name` parameter for model logging.
- [PyTorch Reproducibility](https://docs.pytorch.org/docs/stable/notes/randomness.html) - Official PyTorch notes on seeds, deterministic behavior, and reproducibility limits.
- [DVC: Versioning Data and Models](https://doc.dvc.org/example-scenarios/versioning-data-and-models) - Official DVC example for pairing data and model versions with code history.
