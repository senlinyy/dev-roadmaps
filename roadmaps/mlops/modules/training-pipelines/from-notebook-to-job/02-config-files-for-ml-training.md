---
title: "Training Config Files"
description: "Use versioned training config files to control data snapshots, features, model settings, runtime resources, thresholds, and tracking metadata."
overview: "A training config file records the choices that should vary between runs while the training script keeps the reviewed behavior. This tutorial follows a returns-risk model as a team designs YAML config, validates it, overrides it safely in CI, and records the resolved config with each run."
tags: ["MLOps", "core", "training"]
order: 2
id: "article-mlops-training-pipelines-config-files-for-ml-training"
---

## Table of Contents

1. [A Config File Controls A Run Without Rewriting The Script](#a-config-file-controls-a-run-without-rewriting-the-script)
2. [Follow One Returns-Risk Model](#follow-one-returns-risk-model)
3. [Separate Stable Code From Run Choices](#separate-stable-code-from-run-choices)
4. [Design The Config Hierarchy](#design-the-config-hierarchy)
5. [Validate The Config Before Training](#validate-the-config-before-training)
6. [Override Values Safely](#override-values-safely)
7. [Record The Resolved Config](#record-the-resolved-config)
8. [Operational Checks](#operational-checks)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## A Config File Controls A Run Without Rewriting The Script
<!-- section-summary: A training config file stores the run choices that change often while source code stores the reviewed training behavior. -->

A **training config file** is a versioned file that tells a training script which data, features, model settings, runtime resources, thresholds, and tracking metadata to use for one run. The script owns the behavior. The config owns the choices. This split lets the team try a new learning rate, dataset snapshot, threshold, or GPU setting through a reviewed file instead of editing Python code each time.

You can think of the config as the run order for the training job. It says, "Use this training table, these feature columns, this model type, these hyperparameters, this output path, and these review thresholds." The training script still decides how to load data, build features, train, evaluate, and log artifacts.

This matters after the first article's script exists. A script such as `python -m returns_risk.train --config configs/returns_gbdt.yaml` gives the team one entrypoint. The config file makes each run legible. A reviewer can open the config and see the exact data snapshot, feature set, model parameters, and runtime assumptions before a large job starts.

The core pieces connect like this:

| Config area | Example field | Question it answers |
|---|---|---|
| Run metadata | `owner`, `run_reason`, `model_name` | Who owns this run and why does it exist? |
| Data | `train_table`, `validation_table`, `label_column` | Which examples and labels train the model? |
| Features | `feature_set`, `columns`, `categorical_columns` | Which inputs can the model use? |
| Model | `algorithm`, `learning_rate`, `max_depth` | Which training recipe should the script execute? |
| Runtime | `image_digest`, `cpu`, `memory`, `gpu` | What compute and environment does the run expect? |
| Review | `min_auc`, `max_return_loss_delta` | Which checks must pass before promotion? |
| Tracking | `experiment`, `tags`, `artifact_root` | Where should evidence go? |

![Code and config split for a training run](/content-assets/articles/article-mlops-training-pipelines-config-files-for-ml-training/code-vs-config.png)
*The Python code carries the reviewed behavior, while the config names the data, features, thresholds, and runtime for this BrightCart run.*

## Follow One Returns-Risk Model
<!-- section-summary: The running scenario follows an ecommerce team that needs clear configs for a returns-risk training job. -->

Imagine **BrightCart**, an ecommerce marketplace that wants to predict which orders have a high chance of return. The operations team uses the model to prioritize fit guidance, quality checks, and merchant coaching. A bad model can unfairly flag honest customers or miss product categories with real sizing issues, so the training run needs a clear record.

The model is `returns_risk_gbdt`. The training table is `warehouse.ml.returns_train_2026_06_30`, and the validation table is `warehouse.ml.returns_valid_2026_06_30`. The primary metric is `roc_auc`, because the team first needs ranking quality. The business guardrail is `high_value_customer_flag_rate`, because the team wants extra review when the model flags loyal customers too aggressively.

The first baseline used a notebook. The first production step is a script. The next step is a config file that lets BrightCart run several reviewed variants:

- `configs/returns_baseline.yaml` for the current LightGBM baseline.
- `configs/returns_quality_features.yaml` for a candidate that adds merchant defect signals.
- `configs/returns_low_cost_smoke.yaml` for CI and local checks.

The command stays stable:

```bash
python -m returns_risk.train \
  --config configs/returns_quality_features.yaml \
  --run-id returns-risk-2026-07-04-1400
```

The config name explains the candidate. The run ID gives tracking, logs, and artifacts a stable handle. The script can read the config, validate it, log the resolved version, and then train.

## Separate Stable Code From Run Choices
<!-- section-summary: Source code should hold reusable behavior, while config should hold values that reviewers expect to change between runs. -->

The first design decision is where each choice belongs. A beginner mistake is putting every value in the config because it feels flexible. That can create confusing configs that secretly change the meaning of the training job. Another common problem is burying run choices inside Python files, which makes every experiment a source edit.

BrightCart can use this rule: code owns the **how**, config owns the **which**. The Python code owns how to load a warehouse table, encode categorical features, train a gradient boosted model, calculate segment metrics, and write artifacts. The config names which table, which features, which hyperparameters, which metric thresholds, and which runtime resources.

Here are examples:

| Decision | Better home | Reason |
|---|---|---|
| Function that computes `return_label_30d` | Code | Business logic needs tests and review |
| Training table version | Config | Each run should name its data snapshot |
| Feature column list | Config | Candidate runs often compare feature sets |
| Metric implementation | Code | Metric calculation should stay consistent |
| Minimum acceptable AUC | Config | Review thresholds can change by model family |
| Kubernetes CPU and memory request | Config | The same script may run smoke and full jobs |

This split helps reviews. A data scientist can propose a config-only change for a new feature group. A platform engineer can review runtime requests. A model reviewer can compare thresholds. The Python training behavior stays in normal source review.

## Design The Config Hierarchy
<!-- section-summary: A good config hierarchy names metadata, data, features, model settings, runtime, tracking, and review gates clearly. -->

A clear config reads from top to bottom like the run itself. Start with human metadata, then data, features, model, runtime, tracking, and review gates. This order helps a reviewer understand the run before reading any code.

Here is BrightCart's candidate config:

```yaml
schema_version: 1

run:
  model_name: returns_risk_gbdt
  owner: marketplace-risk-ml
  run_reason: "Add merchant quality features after June sizing incident review."
  ticket: "RISK-1842"

data:
  train_table: warehouse.ml.returns_train_2026_06_30
  validation_table: warehouse.ml.returns_valid_2026_06_30
  label_column: returned_within_30d
  entity_key: order_id
  snapshot_id: returns-training-2026-06-30-v4

features:
  feature_set: returns_features_v8_quality
  numeric_columns:
    - order_value_usd
    - customer_return_rate_365d
    - merchant_return_rate_90d
    - product_size_complaint_rate_60d
    - delivery_delay_hours
  categorical_columns:
    - product_category
    - merchant_tier
    - shipping_method

model:
  algorithm: lightgbm_binary
  objective: binary
  learning_rate: 0.04
  num_leaves: 63
  max_depth: 8
  num_boost_round: 900
  early_stopping_rounds: 50
  seed: 20260704

runtime:
  image: ghcr.io/brightcart/returns-trainer@sha256:8df8e9b3a6d4f1e0c2b9a770055ccaa11223344556677889900aabbccddeeff
  cpu: "8"
  memory: "32Gi"
  gpu: null

tracking:
  experiment: brightcart-returns-risk
  artifact_root: s3://brightcart-ml-artifacts/returns-risk/
  tags:
    team: marketplace-risk
    candidate: quality-features

review:
  min_valid_auc: 0.805
  min_valid_average_precision: 0.219
  max_high_value_customer_flag_rate: 0.085
  max_training_cost_usd: 35
```

This file tells a strong story. The data section names the snapshot and entity key. The feature section shows which columns the model can use. The runtime section records a CPU-only job, which fits a tree model. The review section carries business guardrails, so the training job can fail early if a candidate creates too much customer harm risk.

![Training config hierarchy](/content-assets/articles/article-mlops-training-pipelines-config-files-for-ml-training/config-hierarchy.png)
*A readable config hierarchy lets reviewers scan the run from ownership and data identity down to runtime, tracking, and review gates.*

The config should avoid vague names such as `latest`, `final`, or `best`. A config named `returns_quality_features.yaml` and a snapshot named `returns-training-2026-06-30-v4` give the team better evidence than `prod.yaml` pointing at `latest_train`.

## Validate The Config Before Training
<!-- section-summary: Config validation catches missing fields, unsafe defaults, and unsupported combinations before expensive training starts. -->

Validation should happen before the training script reads a large table or requests expensive compute. Validation checks the shape of the config and the meaning of important values. A missing label column, unsupported algorithm, or empty feature list should stop the run quickly.

BrightCart can start with a small Python validator:

```python
from pathlib import Path

import yaml


SUPPORTED_ALGORITHMS = {"lightgbm_binary", "logistic_regression"}
REQUIRED_TOP_LEVEL = {"schema_version", "run", "data", "features", "model", "runtime", "tracking", "review"}


def load_config(path: str) -> dict:
    config = yaml.safe_load(Path(path).read_text())
    missing = REQUIRED_TOP_LEVEL - set(config)
    if missing:
        raise ValueError(f"Config is missing top-level sections: {sorted(missing)}")

    if config["schema_version"] != 1:
        raise ValueError(f"Unsupported config schema_version: {config['schema_version']}")

    algorithm = config["model"]["algorithm"]
    if algorithm not in SUPPORTED_ALGORITHMS:
        raise ValueError(f"Unsupported model.algorithm: {algorithm}")

    numeric = config["features"].get("numeric_columns", [])
    categorical = config["features"].get("categorical_columns", [])
    if len(numeric) + len(categorical) == 0:
        raise ValueError("At least one feature column is required")

    if config["runtime"]["gpu"] and algorithm == "lightgbm_binary":
        raise ValueError("GPU runtime needs an approved GPU training config")

    return config
```

This validator keeps the errors close to the source. It checks required sections, schema version, algorithm names, feature lists, and one resource rule. A larger team may use a typed config library or JSON Schema, yet the first habit stays the same: parse and validate before training.

The validation output should be readable in CI and Kubernetes logs:

```console
ValueError: Unsupported model.algorithm: lightgbm_binray
```

That message is useful because the typo is in the config, not in the warehouse or cluster. The team can fix the file in a small pull request.

## Override Values Safely
<!-- section-summary: Overrides are useful for smoke tests and scheduled runs when they stay visible and limited. -->

Overrides let CI or an orchestrator adjust a few values without creating a full duplicate config. The danger is hidden changes. If a scheduler silently changes the training table, threshold, or feature list, the run record can mislead reviewers. Good overrides stay small, visible, and logged.

BrightCart can allow only a short list:

| Override | Allowed caller | Why it exists |
|---|---|---|
| `run.run_reason` | Humans and schedulers | Adds context for a run |
| `data.train_table` | CI smoke only | Points at sample fixtures |
| `data.validation_table` | CI smoke only | Points at sample fixtures |
| `runtime.cpu` and `runtime.memory` | Platform jobs | Adjusts compute envelope |
| `tracking.tags.*` | CI and schedulers | Adds source branch or schedule name |

The training CLI can expose explicit flags for common overrides:

```bash
python -m returns_risk.train \
  --config configs/returns_quality_features.yaml \
  --run-id returns-risk-smoke-pr-418 \
  --override data.train_table=tests/fixtures/returns_train_sample.parquet \
  --override data.validation_table=tests/fixtures/returns_valid_sample.parquet \
  --override tracking.tags.source=pull-request
```

Every override should appear in the resolved config artifact. The training job can also log them as tags:

```python
def apply_overrides(config: dict, overrides: list[str]) -> dict:
    applied = {}
    for item in overrides:
        key, value = item.split("=", 1)
        if key not in ALLOWED_OVERRIDES:
            raise ValueError(f"Override is not allowed: {key}")
        set_nested_value(config, key.split("."), value)
        applied[key] = value
    config["run"]["applied_overrides"] = applied
    return config
```

This code keeps flexibility under review. If someone tries to override `review.max_high_value_customer_flag_rate` from the scheduler, the script rejects the run. That threshold should change through a reviewed config file because it affects the product decision.

## Record The Resolved Config
<!-- section-summary: The resolved config is the final run recipe after defaults and overrides, and it should travel with metrics and artifacts. -->

The config file in Git tells reviewers what the team intended. The **resolved config** tells reviewers what actually ran after overrides and defaults. It should be written to the output directory and logged to the tracking system with the metrics and model artifact.

BrightCart can write it like this:

```python
from pathlib import Path

import mlflow
import yaml


def write_resolved_config(config: dict, output_dir: Path) -> Path:
    path = output_dir / "resolved_config.yaml"
    path.write_text(yaml.safe_dump(config, sort_keys=True))
    return path


with mlflow.start_run(run_name=run_id):
    resolved_config_path = write_resolved_config(config, output_dir)
    mlflow.log_artifact(str(resolved_config_path), artifact_path="config")
    mlflow.set_tags(
        {
            "config.schema_version": str(config["schema_version"]),
            "data.snapshot_id": config["data"]["snapshot_id"],
            "features.feature_set": config["features"]["feature_set"],
            "runtime.image": config["runtime"]["image"],
        }
    )
```

The resolved config should include the image digest, data snapshot, feature set, seed, threshold, and applied overrides. If a teammate tries to reproduce the run two weeks later, the resolved config is the first file they open. It also helps compare two runs that used the same source config with different smoke-test overrides or runtime resources.

![Resolved config evidence trail](/content-assets/articles/article-mlops-training-pipelines-config-files-for-ml-training/resolved-config-trail.png)
*The resolved config travels with metrics, model files, signatures, and segment reports so the review packet shows what actually ran.*

For production runs, the resolved config can sit inside the model review packet:

```yaml
review_packet:
  run_id: returns-risk-2026-07-04-1400
  resolved_config: artifacts/returns-risk-2026-07-04-1400/resolved_config.yaml
  metrics: artifacts/returns-risk-2026-07-04-1400/metrics.yaml
  segment_report: artifacts/returns-risk-2026-07-04-1400/segment_metrics.csv
  model_signature: artifacts/returns-risk-2026-07-04-1400/model_signature.json
```

That packet gives product, risk, and ML reviewers the same evidence. Nobody needs to reverse-engineer which YAML file or override created the candidate.

## Operational Checks
<!-- section-summary: Config reviews should check data identity, feature ownership, resource fit, review thresholds, and resolved output evidence. -->

Config files need operations habits because small values can cause expensive or harmful training runs. BrightCart uses a short pull-request checklist for every config change:

| Check | Review question | Evidence |
|---|---|---|
| Data identity | Does the config name immutable train and validation snapshots? | Snapshot ID, table version, row counts |
| Feature ownership | Does each feature group have an owner and freshness check? | Feature catalog entry or data contract |
| Runtime fit | Does CPU, memory, or GPU match the model family? | Past run duration and resource metrics |
| Cost guardrail | Does `max_training_cost_usd` fit the experiment value? | Budget tag and prior run costs |
| Customer guardrail | Are segment thresholds explicit? | Review section and segment report |
| Resolved output | Did the run log `resolved_config.yaml`? | Tracking artifact list |

A simple CI check can validate every config in the repository:

```yaml
name: validate-training-configs

on:
  pull_request:
    paths:
      - "configs/**/*.yaml"
      - "returns_risk/config_validation.py"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Install training package
        run: pip install -e ".[dev]"
      - name: Validate configs
        run: |
          for config in configs/*.yaml; do
            python -m returns_risk.validate_config --config "$config"
          done
```

The same validator can run inside the training script. CI catches config errors during review, and the training job catches any config that enters through a manual run or scheduler.

## Putting It Together
<!-- section-summary: Training config files make each run reviewable by separating source behavior from changing run choices. -->

A training config file gives the team a readable recipe for one training run. In BrightCart's returns-risk model, the config names the run reason, data snapshots, feature set, model parameters, runtime resources, tracking destination, and review gates. The script reads the file, validates it, applies limited overrides, writes the resolved config, and logs it with the model artifacts.

This is the bridge between a training script and a training pipeline. The script gives the workflow one command. The config gives each run a versioned set of choices. The artifact article comes next because every run now needs to emit the files that prove what happened.

## References

- [Kubernetes Docs: ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/)
- [Kubernetes Docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [GitHub Docs: Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Docker Docs: Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [MLflow Python API: `mlflow.sklearn.log_model`](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html)
