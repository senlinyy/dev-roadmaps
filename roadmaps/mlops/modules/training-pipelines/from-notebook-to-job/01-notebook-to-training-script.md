---
title: "Training Scripts"
description: "Turn exploratory notebook work into a versioned Python training entrypoint that CI, containers, and schedulers can run."
overview: "A training script is a command-line program that loads data, reads configuration, trains the model, evaluates it, and writes artifacts in a repeatable way. This guide follows a clinic no-show model as a notebook turns into `train.py`, a Docker image, a Kubernetes Job, and a CI check."
tags: ["MLOps", "core", "training"]
order: 1
id: "article-mlops-training-pipelines-notebook-to-training-script"
---

## Table of Contents

1. [A Training Script Gives The Model One Real Entry Point](#a-training-script-gives-the-model-one-real-entry-point)
2. [Follow One Clinic No-Show Model](#follow-one-clinic-no-show-model)
3. [Move Notebook Cells Into Named Functions](#move-notebook-cells-into-named-functions)
4. [Add A Command-Line Contract](#add-a-command-line-contract)
5. [Make The Script Safe For CI](#make-the-script-safe-for-ci)
6. [Package The Job In A Container](#package-the-job-in-a-container)
7. [Run The Script As A Kubernetes Job](#run-the-script-as-a-kubernetes-job)
8. [Failure Modes You Can Diagnose](#failure-modes-you-can-diagnose)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## A Training Script Gives The Model One Real Entry Point
<!-- section-summary: A training script is the repeatable command a team uses after a notebook idea needs to run outside the notebook. -->

A **training script** is a Python program with a clear command-line entrypoint for training a model. It loads the approved data snapshot, reads a config file, trains the model, evaluates it, and writes the output files that the rest of the MLOps workflow expects. The key change from a notebook is simple: a scheduler, CI job, teammate, or Kubernetes Job can call the same command and get the same kind of outputs each time.

This article starts where many ML projects really start: a useful notebook. A notebook helps you explore data quickly, draw plots, try features, and inspect mistakes. The trouble starts when that notebook quietly turns into the production training process. Cells can run out of order, hidden variables can survive from earlier experiments, file paths can point at one person's laptop, and a model review can depend on a notebook state nobody can replay.

A training script gives the work a stable door. The team can say, "The clinic no-show model trains with `python -m appointment_no_show.train --config configs/no_show_baseline.yaml`." That command can run on a laptop with a small sample, in CI with a smoke dataset, in a container with a pinned image digest, and later in an orchestrated training pipeline.

Here is the structure you will connect in this guide:

| Piece | What it means | Why it matters |
|---|---|---|
| Entry point | The command that starts training | Gives CI and schedulers one stable call |
| Functions | Named pieces such as `load_data`, `train_model`, and `evaluate` | Removes hidden cell state from the workflow |
| Arguments | Values passed through flags such as `--config` and `--run-id` | Lets each run declare its inputs |
| Outputs | Model files, metrics, schemas, and reports | Gives reviewers evidence after training ends |
| Container | A pinned runtime around the script | Keeps package and OS differences visible |
| Kubernetes Job | A one-off workload that runs to completion | Fits batch training jobs on a shared cluster |

![Notebook to script flow](/content-assets/articles/article-mlops-training-pipelines-notebook-to-training-script/notebook-to-script.png)
*A notebook can still be where exploration happens, while the training script gives tests, packaging, and scheduled runs one repeatable path.*

## Follow One Clinic No-Show Model
<!-- section-summary: The running scenario follows a clinic operations team that needs a rerunnable no-show prediction job. -->

Imagine **Maple Clinic Network**, a group of outpatient clinics that loses appointment capacity when patients miss visits without canceling. The operations team wants a model called `no_show_risk_v3` that predicts whether tomorrow's appointments have a high no-show risk. The model output helps the outreach team send reminders and fill openings with waitlist patients.

The first version lives in a notebook named `notebooks/no_show_exploration.ipynb`. Lena, the data scientist, used it to inspect appointment history, join weather and reminder events, train a scikit-learn model, and draw a threshold chart. The notebook proved the idea: the validation AUC reached `0.812`, and the outreach team liked the first review.

Now the team needs the training work to leave the notebook. The training data is `warehouse.ml.appointment_no_show_train_2026_06_30`, the validation data is `warehouse.ml.appointment_no_show_valid_2026_06_30`, and the owner is `clinic-ml-platform`. The first target is modest: a repeatable script that trains a logistic regression baseline and writes the model, metrics, feature schema, and review report.

The script will use this command:

```bash
python -m appointment_no_show.train \
  --config configs/no_show_baseline.yaml \
  --run-id no-show-2026-07-04-0900 \
  --output-dir artifacts/no-show-2026-07-04-0900
```

This command names the run and the config before the model starts. That matters because the model review should discuss the exact dataset, features, threshold, and runtime used for this run. A notebook can still help Lena explore the next idea, while the training script handles the version the team may rerun.

## Move Notebook Cells Into Named Functions
<!-- section-summary: The first rewrite step is to move notebook work into small functions that receive inputs and return outputs. -->

The notebook probably has a natural order already: import packages, load data, build features, split data, train, evaluate, and save files. The script should make that order explicit. Each cell group turns into a function with clear inputs and outputs. This removes hidden variables and makes the code easier to test with a tiny sample.

A beginner-friendly first pass can use this layout:

```bash
appointment_no_show/
  __init__.py
  train.py
  data.py
  features.py
  evaluation.py
configs/
  no_show_baseline.yaml
tests/
  test_training_smoke.py
```

The split has a practical reason. `train.py` owns the command-line flow. `data.py` owns table reads and sample loading. `features.py` owns feature columns and transformations. `evaluation.py` owns metrics and threshold checks. When the model breaks, the team can inspect the part that owns the failed step.

Here is a compact training flow. The real project would have more feature code, yet the shape is the point:

```python
from pathlib import Path

import joblib
import mlflow
import pandas as pd
import yaml
from mlflow.models import infer_signature
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from appointment_no_show.data import load_training_frame
from appointment_no_show.features import build_xy, write_feature_schema


def train_model(config: dict, run_id: str, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    train_df = load_training_frame(config["data"]["train_table"])
    valid_df = load_training_frame(config["data"]["validation_table"])
    X_train, y_train = build_xy(train_df, config["features"])
    X_valid, y_valid = build_xy(valid_df, config["features"])

    model = Pipeline(
        steps=[
            ("scale", StandardScaler()),
            ("classifier", LogisticRegression(max_iter=config["model"]["max_iter"])),
        ]
    )
    model.fit(X_train, y_train)

    valid_scores = model.predict_proba(X_valid)[:, 1]
    metrics = {
        "valid_auc": roc_auc_score(y_valid, valid_scores),
        "valid_average_precision": average_precision_score(y_valid, valid_scores),
    }

    model_path = output_dir / "model.joblib"
    metrics_path = output_dir / "metrics.yaml"
    schema_path = output_dir / "feature_schema.json"

    joblib.dump(model, model_path)
    metrics_path.write_text(yaml.safe_dump(metrics, sort_keys=True))
    write_feature_schema(config["features"], schema_path)

    signature = infer_signature(X_valid.head(20), model.predict_proba(X_valid.head(20)))
    with mlflow.start_run(run_name=run_id):
        mlflow.log_params(config["model"])
        mlflow.log_metrics(metrics)
        mlflow.set_tags(
            {
                "owner": config["run"]["owner"],
                "data.train_table": config["data"]["train_table"],
                "data.validation_table": config["data"]["validation_table"],
                "feature_set": config["features"]["name"],
            }
        )
        mlflow.log_artifact(str(metrics_path), artifact_path="reports")
        mlflow.log_artifact(str(schema_path), artifact_path="schema")
        mlflow.sklearn.log_model(
            sk_model=model,
            name="model",
            input_example=X_valid.head(5),
            signature=signature,
        )
```

Several details are doing real production work here. The function receives `config`, `run_id`, and `output_dir`, so the caller controls the run instead of relying on global variables. The model writes a file even before MLflow logging, so a failed tracking call can still leave local evidence. The MLflow model logging uses `name="model"` with an input example and signature, which matches the current MLflow API direction and gives serving teams the expected model input shape.

## Add A Command-Line Contract
<!-- section-summary: A command-line contract lets humans, CI, containers, and schedulers run the same training entrypoint. -->

The next step is the command-line wrapper. A **command-line contract** is the set of flags the script accepts and the promises those flags make. For this job, the contract says every run must name a config file, a run ID, and an output directory. The script can add a `--smoke` flag for CI so the same code path can train on a tiny sample.

The wrapper can stay small:

```python
import argparse
from pathlib import Path

import yaml

from appointment_no_show.training_core import train_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--smoke", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = yaml.safe_load(Path(args.config).read_text())
    if args.smoke:
        config["data"]["train_table"] = "tests/fixtures/no_show_train_sample.parquet"
        config["data"]["validation_table"] = "tests/fixtures/no_show_valid_sample.parquet"

    train_model(config=config, run_id=args.run_id, output_dir=Path(args.output_dir))


if __name__ == "__main__":
    main()
```

This wrapper gives every caller the same surface. A laptop call, a CI job, and a Kubernetes Job can all use `python -m appointment_no_show.train`. The smoke path changes the input data through the config after parsing, so CI can test imports, feature building, metric calculation, artifact writing, and MLflow-safe model logging without waiting for the full warehouse table.

![Training job command contract](/content-assets/articles/article-mlops-training-pipelines-notebook-to-training-script/training-entrypoint-contract.png)
*The contract is small on purpose: name the data, config, output path, and run ID before the training job starts.*

A useful script also validates the config early. If a feature name is missing, the error should happen before the expensive training work starts. The config file can carry a schema version so future script changes can reject old configs politely:

```yaml
run:
  owner: clinic-ml-platform
  model_name: no_show_risk
  config_version: 1

data:
  train_table: warehouse.ml.appointment_no_show_train_2026_06_30
  validation_table: warehouse.ml.appointment_no_show_valid_2026_06_30
  label_column: no_showed

features:
  name: no_show_features_v3
  columns:
    - days_until_appointment
    - prior_no_show_count_180d
    - reminder_sms_sent
    - appointment_hour
    - clinic_location_risk_score

model:
  algorithm: logistic_regression
  max_iter: 300
  threshold_review_target: 0.42
```

The config holds choices that should change between runs. The script holds behavior that should stay reviewed as code. That separation keeps the workflow clean when the team tries a new threshold, a new feature list, or a new training table.

## Make The Script Safe For CI
<!-- section-summary: CI should execute a tiny training run that proves the script imports, trains, evaluates, and writes expected files. -->

CI should catch the ordinary mistakes before a full training job wastes compute. A good smoke test uses a tiny fixture dataset with realistic columns. It checks the script exits successfully, writes required artifacts, and reports metrics within a loose range. The goal is confidence in the training path, not proof that the model is ready for production.

The smoke test can call the module exactly like a scheduler would:

```python
from pathlib import Path
import subprocess


def test_training_script_writes_required_outputs(tmp_path: Path) -> None:
    output_dir = tmp_path / "no-show-smoke"
    result = subprocess.run(
        [
            "python",
            "-m",
            "appointment_no_show.train",
            "--config",
            "configs/no_show_baseline.yaml",
            "--run-id",
            "ci-smoke",
            "--output-dir",
            str(output_dir),
            "--smoke",
        ],
        check=True,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0
    assert (output_dir / "model.joblib").exists()
    assert (output_dir / "metrics.yaml").exists()
    assert (output_dir / "feature_schema.json").exists()
```

A GitHub Actions workflow can run that smoke test on pull requests:

```yaml
name: training-script-smoke

on:
  pull_request:
    paths:
      - "appointment_no_show/**"
      - "configs/no_show_baseline.yaml"
      - "tests/**"

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements-dev.txt
      - name: Run training smoke test
        env:
          MLFLOW_TRACKING_URI: file:${{ runner.temp }}/mlruns
        run: pytest tests/test_training_smoke.py
```

The important part is the path filter and the timeout. The workflow runs when training code, config, or fixtures change. The timeout keeps a broken data load from hanging the pull request. The local file-based MLflow URI gives the smoke run a tracking location without requiring production credentials.

## Package The Job In A Container
<!-- section-summary: A container wraps the training script with the Python, OS, and system libraries the job expects. -->

Once the script passes CI, the next question is where it runs. A laptop has one Python setup, CI has another, and the training cluster has a third. A **container image** packages the script with the OS packages, Python version, and library versions the job expects. The exact digest should be recorded with each training run because image tags can move.

A simple Dockerfile can start like this:

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY appointment_no_show ./appointment_no_show
COPY configs ./configs

ENTRYPOINT ["python", "-m", "appointment_no_show.train"]
```

The build should produce a tag for humans and a digest for evidence:

```bash
docker build -t ghcr.io/maple-clinic/no-show-trainer:2026-07-04 .
docker push ghcr.io/maple-clinic/no-show-trainer:2026-07-04
docker buildx imagetools inspect ghcr.io/maple-clinic/no-show-trainer:2026-07-04
```

The run record should keep the immutable value:

```yaml
runtime:
  image: ghcr.io/maple-clinic/no-show-trainer@sha256:91b5c5a2d4f0a9f8e7c6b4a3210fedcba9876543210fedcba9876543210abcd
  python: "3.12"
  sklearn: "1.7.2"
  mlflow: "3.14.0"
  base_image: python:3.12-slim
```

This record helps incident review. If a training run from July 4 cannot load on July 20, the team can compare the exact image digest and package list instead of guessing whether `latest` changed.

## Run The Script As A Kubernetes Job
<!-- section-summary: A Kubernetes Job runs training as a batch workload that should finish successfully or fail with inspectable logs. -->

A **Kubernetes Job** is a workload for a task that runs to completion. That fits training scripts because a training run has a start, a long middle, and an end. The job either finishes, writes artifacts, and exits with code `0`, or it fails and leaves logs, status, and events for investigation.

Maple Clinic can define a one-off training job like this:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: no-show-train-20260704-0900
  labels:
    app: no-show-risk
    owner: clinic-ml-platform
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      serviceAccountName: no-show-trainer
      containers:
        - name: trainer
          image: ghcr.io/maple-clinic/no-show-trainer@sha256:91b5c5a2d4f0a9f8e7c6b4a3210fedcba9876543210fedcba9876543210abcd
          args:
            - "--config"
            - "configs/no_show_baseline.yaml"
            - "--run-id"
            - "no-show-2026-07-04-0900"
            - "--output-dir"
            - "/mnt/artifacts/no-show-2026-07-04-0900"
          env:
            - name: MLFLOW_TRACKING_URI
              valueFrom:
                secretKeyRef:
                  name: mlflow-tracking
                  key: uri
          resources:
            requests:
              cpu: "2"
              memory: "8Gi"
            limits:
              cpu: "4"
              memory: "16Gi"
```

The `restartPolicy: Never` setting keeps each failed attempt visible. The `backoffLimit: 1` setting avoids repeated expensive retries when the config is wrong. The service account should have only the storage and warehouse access this training job needs. The MLflow URI comes from a Kubernetes Secret because it may include a private endpoint or token.

The useful investigation commands are simple:

```bash
kubectl apply -f jobs/no-show-train-20260704-0900.yaml
kubectl get job no-show-train-20260704-0900
kubectl logs job/no-show-train-20260704-0900
kubectl describe job no-show-train-20260704-0900
```

These commands tell the team whether the job started, whether the container exited cleanly, which logs the script wrote, and which scheduling or permission events Kubernetes recorded.

![Repeatable run evidence](/content-assets/articles/article-mlops-training-pipelines-notebook-to-training-script/repeatable-run-evidence.png)
*When the same code, data snapshot, and config produce a named evidence bundle, review conversations can focus on behavior instead of guessing what ran.*

## Failure Modes You Can Diagnose
<!-- section-summary: A script-centered workflow gives the team clear evidence when training fails locally, in CI, or in the cluster. -->

Training scripts fail in ordinary ways. The value of the rewrite is that each failure points at a visible layer. If the script cannot import a package, CI catches it. If a feature column disappears from the warehouse table, the config validation or feature builder raises a clear error. If the container cannot pull, Kubernetes records an image pull event. If MLflow rejects a model signature, the run logs show the model logging step.

Here is a practical diagnosis table for Maple Clinic:

| Symptom | Likely layer | Evidence to inspect | Usual fix |
|---|---|---|---|
| `ModuleNotFoundError` in CI | Packaging | GitHub Actions logs | Add dependency or package module correctly |
| Missing feature column | Data contract | Script error and table schema | Update feature pipeline or config |
| Smoke test passes, cluster job fails | Runtime or access | Kubernetes events and logs | Fix image digest, service account, or secret |
| Metrics file missing | Script output path | Container logs and artifact mount | Create output directory before training |
| MLflow run lacks model signature | Tracking code | Run artifacts and script logs | Add `input_example` and `infer_signature` |

The workflow also gives a clean rollback path. If `no_show_risk_v3` trains with a broken config, the team can keep the last approved model version in the registry, fix the config in a pull request, and rerun the training job under a new run ID. The old run remains evidence, and the new run gets its own artifacts.

## Putting It Together
<!-- section-summary: A training script turns a promising notebook into a command that teams can test, package, schedule, and review. -->

A notebook can prove an ML idea. A training script turns that idea into a repeatable job. For Maple Clinic, the useful transition was not dramatic: move notebook cells into functions, add a command-line contract, read a config, write artifacts, log the model with a signature, test the command in CI, package it in a container, and run it as a Kubernetes Job.

That gives the rest of the training-pipeline work a strong base. Config files can now change training choices without editing source code. Artifact logging can standardize what every run emits. Orchestrators can call the same command as one step in a larger workflow. Scaling work can change CPU, memory, or GPU resources around the script while the entrypoint stays familiar.

## References

- [Docker Docs: Dockerfile overview](https://docs.docker.com/build/concepts/dockerfile/)
- [Docker Docs: Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Kubernetes Docs: Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes Docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [GitHub Docs: Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [MLflow Python API: `mlflow.sklearn.log_model`](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html)
