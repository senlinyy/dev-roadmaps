---
title: "Training Artifacts"
description: "Log the model, metrics, resolved config, data manifest, schemas, reports, environment details, and review packet that a training run needs."
overview: "Training artifacts are the files and metadata a job leaves behind so a team can inspect, compare, reproduce, and promote a model. This guide follows a content moderation model as it writes artifacts locally, logs them to MLflow and W&B, and uses the outputs during review and debugging."
tags: ["MLOps", "core", "training"]
order: 3
id: "article-mlops-training-pipelines-logging-training-outputs-artifacts"
---

## Table of Contents

1. [Training Artifacts Are The Evidence A Run Leaves Behind](#training-artifacts-are-the-evidence-a-run-leaves-behind)
2. [Follow One Moderation Model](#follow-one-moderation-model)
3. [Decide Which Artifacts Every Run Must Emit](#decide-which-artifacts-every-run-must-emit)
4. [Write Artifacts Locally First](#write-artifacts-locally-first)
5. [Log Artifacts To MLflow](#log-artifacts-to-mlflow)
6. [Use W&B Artifacts For Review And Lineage](#use-wb-artifacts-for-review-and-lineage)
7. [Create A Review Packet](#create-a-review-packet)
8. [Debug With Artifacts](#debug-with-artifacts)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Training Artifacts Are The Evidence A Run Leaves Behind
<!-- section-summary: Training artifacts are files and metadata that let a team inspect, compare, replay, and promote a model run. -->

**Training artifacts** are the files and metadata produced by a training job. They include the model file, metrics, resolved config, data manifest, feature schema, evaluation reports, plots, logs, environment details, and sometimes checkpoints. They answer the practical question a reviewer asks after the job ends: what exactly did this run create, and can we trust it?

The previous articles gave you a training script and a config file. Artifacts are the next layer. The script runs the work. The config records the choices. The artifacts preserve the evidence. Without artifacts, a training run can finish successfully and still leave the team with weak proof. A model file alone cannot explain which data trained it, which threshold passed review, which segment failed, or which container image ran.

For beginners, the simplest artifact rule is this: every training run should leave enough evidence for another teammate to understand the result without rerunning the job. Rerunning may still help, yet the first review should start from saved outputs.

The artifact set usually connects like this:

| Artifact | Example file | Why it exists |
|---|---|---|
| Model | `model/model.joblib` or MLflow model directory | The trained object used for batch scoring or serving |
| Metrics | `reports/metrics.yaml` | The headline scores used for comparison |
| Segment report | `reports/segment_metrics.csv` | Evidence across customers, regions, labels, or classes |
| Data manifest | `data/dataset_manifest.yaml` | Row counts, snapshot IDs, label window, checksums |
| Feature schema | `schema/feature_schema.json` | Input columns, types, and order |
| Resolved config | `config/resolved_config.yaml` | Final run recipe after overrides |
| Environment | `environment/runtime.yaml` | Image digest, package versions, hardware, seeds |
| Review packet | `review/model_review.yaml` | Decision summary and approval evidence |

![Training artifact contract](/content-assets/articles/article-mlops-training-pipelines-logging-training-outputs-artifacts/artifact-contract.png)
*The artifact contract turns a completed moderation training job into a checklist of files reviewers can actually open.*

## Follow One Moderation Model
<!-- section-summary: The running scenario follows a trust and safety team training an image moderation model that must leave review evidence. -->

Imagine **SignalBend**, a social audio app where users can attach cover images to public rooms. The trust and safety team trains a model called `cover_image_policy_v5` to flag images that may violate nudity, violence, or hate-symbol policies. The model sends risky images to human review before they appear in high-traffic rooms.

This model needs careful artifacts because mistakes have real user impact. A weak model can send too many safe images to reviewers, causing delay and frustration. It can also miss policy violations that damage the community. The review team needs more than one accuracy score. They need segment metrics by policy class, language market, image source, and account age. They also need sample false positives and false negatives to inspect.

The training run uses:

```yaml
run_id: cover-policy-2026-07-04-1700
model_name: cover_image_policy
data_snapshot: signalbend-cover-policy-train-2026-06-30-v6
image_bucket: s3://signalbend-ml/cover-policy/images/snapshot_date=2026-06-30/
owner: trust-safety-ml
primary_metric: valid_macro_f1
review_guardrail: max_safe_image_false_positive_rate
```

The artifact goal is direct: when the run finishes, the team should find the model, the metrics, the examples behind the metrics, the resolved config, the data receipt, the runtime details, and a review packet. Each piece should have a stable path and should also be logged to the experiment system.

## Decide Which Artifacts Every Run Must Emit
<!-- section-summary: An artifact contract tells the training script which files must exist before the run can count as complete. -->

An **artifact contract** is a short list of required outputs. It protects the team from partial runs that look successful. If `model.pt` exists but the segment report is missing, SignalBend should treat the run as incomplete because the moderation review depends on segment evidence.

The contract can live in the training config:

```yaml
artifacts:
  required:
    - path: model/model.pt
      kind: model
    - path: reports/metrics.yaml
      kind: metrics
    - path: reports/segment_metrics.csv
      kind: evaluation
    - path: reports/error_examples.parquet
      kind: evaluation
    - path: data/dataset_manifest.yaml
      kind: data
    - path: schema/input_schema.json
      kind: schema
    - path: config/resolved_config.yaml
      kind: config
    - path: environment/runtime.yaml
      kind: runtime
    - path: review/model_review.yaml
      kind: review
```

The key is that the contract names paths and kinds. The path tells the script where the file should appear. The kind tells tracking systems and reviewers how to group it. A model registry may care about the model and schema. A risk reviewer may care about the review packet and error examples. A platform engineer may care about runtime and logs.

SignalBend's dataset manifest should carry data evidence:

```yaml
dataset_manifest:
  snapshot_id: signalbend-cover-policy-train-2026-06-30-v6
  train_rows: 12388420
  validation_rows: 1548872
  label_window_utc: "2026-05-01T00:00:00Z..2026-06-30T23:59:59Z"
  label_sources:
    - human_review_queue
    - appeal_outcomes
    - policy_escalation_samples
  class_counts:
    safe: 10524400
    nudity: 804210
    violence: 644902
    hate_symbols: 414908
  checksum_sha256: 972e704b84cf38bfc14a3d4f62d81bc04527a87e3b7c8cc56e3b0f71c9ad2a44
```

This file gives the model review a data receipt. If the validation score drops next week, the team can compare class counts and label sources before blaming the model architecture.

## Write Artifacts Locally First
<!-- section-summary: Local artifact writing keeps evidence available even if the tracking server or network has a bad day. -->

The training script should write artifacts to a local output directory before it uploads them to a tracking tool. This habit helps during outages. If the MLflow server or W&B API is unavailable near the end of training, the pod can still keep the files on the mounted artifact volume or upload them through a retry job.

SignalBend can use a small helper:

```python
from pathlib import Path
import json
import yaml

import pandas as pd
import torch


def write_training_artifacts(output_dir: Path, model, metrics: dict, reports: dict, config: dict) -> dict:
    paths = {
        "model": output_dir / "model" / "model.pt",
        "metrics": output_dir / "reports" / "metrics.yaml",
        "segments": output_dir / "reports" / "segment_metrics.csv",
        "errors": output_dir / "reports" / "error_examples.parquet",
        "schema": output_dir / "schema" / "input_schema.json",
        "config": output_dir / "config" / "resolved_config.yaml",
        "runtime": output_dir / "environment" / "runtime.yaml",
    }

    for path in paths.values():
        path.parent.mkdir(parents=True, exist_ok=True)

    torch.save(model.state_dict(), paths["model"])
    paths["metrics"].write_text(yaml.safe_dump(metrics, sort_keys=True))
    reports["segment_metrics"].to_csv(paths["segments"], index=False)
    reports["error_examples"].to_parquet(paths["errors"], index=False)
    paths["schema"].write_text(json.dumps(reports["input_schema"], indent=2))
    paths["config"].write_text(yaml.safe_dump(config, sort_keys=True))
    paths["runtime"].write_text(yaml.safe_dump(reports["runtime"], sort_keys=True))

    return paths
```

This helper writes one output family at a time. It creates directories before writing. It returns paths so the tracking code can upload the same files. It also gives unit tests something concrete to assert.

The runtime artifact deserves special attention for GPU runs. Even when this moderation example trains on one L40S, the record should name exact runtime details:

```yaml
runtime:
  container_image: ghcr.io/signalbend/cover-policy-trainer@sha256:6aa7c73d2d9fb1e211449f013a71ab7d8f7a5590426c95bcb2e70b93c77b56c4
  gpu_sku: NVIDIA L40S
  node_pool: gke-cover-policy-l40s-us-central1-a
  gpu_operator: "26.3.3"
  nvidia_driver: "580.159.04"
  cuda: "13.0.2"
  cudnn: "9.15"
  nccl: "2.28.8"
  pytorch: "2.12.0"
  seed: 20260704
```

This record gives future debugging real material. A result from L40S on one driver can differ from a result on H100 or H200 with a different CUDA stack. The article's lesson is plain: record the exact runtime rather than writing only "trained on GPU."

![Local artifacts before tracking upload](/content-assets/articles/article-mlops-training-pipelines-logging-training-outputs-artifacts/local-first-then-track.png)
*Writing files locally first gives the pod durable evidence before the same outputs are attached to tracking and review systems.*

## Log Artifacts To MLflow
<!-- section-summary: MLflow can store run parameters, metrics, tags, artifacts, and a model with signature under one run. -->

MLflow gives the team a run page where parameters, metrics, artifacts, and the model live together. For SignalBend, MLflow is useful because the training job can log the model with an input example and signature, then attach the reports and manifests reviewers need.

Here is the logging section:

```python
import mlflow
import mlflow.pytorch
from mlflow.models import infer_signature


def log_to_mlflow(run_id: str, config: dict, model, paths: dict, X_example, y_scores) -> None:
    signature = infer_signature(X_example, y_scores)

    with mlflow.start_run(run_name=run_id):
        mlflow.set_tags(
            {
                "owner": config["run"]["owner"],
                "model_name": config["run"]["model_name"],
                "data_snapshot": config["data"]["snapshot_id"],
                "policy_domain": "cover-image-moderation",
                "runtime.image": config["runtime"]["image"],
            }
        )
        mlflow.log_params(
            {
                "architecture": config["model"]["architecture"],
                "learning_rate": config["model"]["learning_rate"],
                "batch_size": config["model"]["batch_size"],
                "threshold": config["review"]["policy_threshold"],
            }
        )
        mlflow.log_metrics(load_yaml(paths["metrics"]))
        mlflow.log_artifact(str(paths["metrics"]), artifact_path="reports")
        mlflow.log_artifact(str(paths["segments"]), artifact_path="reports")
        mlflow.log_artifact(str(paths["errors"]), artifact_path="reports")
        mlflow.log_artifact(str(paths["schema"]), artifact_path="schema")
        mlflow.log_artifact(str(paths["config"]), artifact_path="config")
        mlflow.log_artifact(str(paths["runtime"]), artifact_path="environment")
        mlflow.pytorch.log_model(
            pytorch_model=model,
            name="model",
            input_example=X_example,
            signature=signature,
        )
```

The model logging call uses `name="model"` and includes a signature. That gives downstream systems a clearer contract for the model input and output. The report files stay as artifacts because human reviewers need to open them. The tags make the run searchable by owner, model, snapshot, and runtime image.

## Use W&B Artifacts For Review And Lineage
<!-- section-summary: W&B artifacts can version model and report files, link them to runs, and help teams review lineage. -->

W&B fits teams that want a collaborative review space with rich charts, artifacts, reports, and lineage. SignalBend can log a model artifact and a review artifact. The model artifact carries deployable files. The review artifact carries reports and evidence.

```python
import wandb


def log_to_wandb(run_id: str, config: dict, paths: dict) -> None:
    run = wandb.init(
        project="signalbend-cover-policy",
        job_type="train",
        name=run_id,
        config=config,
    )

    model_artifact = wandb.Artifact(
        name="cover-image-policy",
        type="model",
        metadata={
            "data_snapshot": config["data"]["snapshot_id"],
            "model_name": config["run"]["model_name"],
            "threshold": config["review"]["policy_threshold"],
        },
    )
    model_artifact.add_file(str(paths["model"]), name="model/model.pt")
    model_artifact.add_file(str(paths["schema"]), name="schema/input_schema.json")
    run.log_artifact(model_artifact, aliases=["candidate", run_id])

    review_artifact = wandb.Artifact(name=f"{run_id}-review", type="review-packet")
    review_artifact.add_file(str(paths["metrics"]), name="reports/metrics.yaml")
    review_artifact.add_file(str(paths["segments"]), name="reports/segment_metrics.csv")
    review_artifact.add_file(str(paths["errors"]), name="reports/error_examples.parquet")
    review_artifact.add_file(str(paths["config"]), name="config/resolved_config.yaml")
    review_artifact.add_file(str(paths["runtime"]), name="environment/runtime.yaml")
    run.log_artifact(review_artifact, aliases=["candidate-review"])

    run.finish()
```

This pattern keeps the model and the review evidence linked to the same run. A reviewer can open the run, inspect charts, then inspect the artifacts. A platform engineer can trace which config and dataset produced the candidate. A future CI process can promote a specific artifact version only after review.

## Create A Review Packet
<!-- section-summary: A review packet gathers the run decision, metric thresholds, artifact links, and owner signoff into one readable file. -->

A **review packet** is a compact file that says whether the run should move forward. It pulls together metrics, guardrails, artifact locations, and signoff fields. It saves the review meeting from hunting across dashboards.

SignalBend can write this packet:

```yaml
review_packet:
  run_id: cover-policy-2026-07-04-1700
  model_name: cover_image_policy
  recommendation: candidate_for_shadow_review
  owner: trust-safety-ml
  data_snapshot: signalbend-cover-policy-train-2026-06-30-v6
  metrics:
    valid_macro_f1: 0.842
    valid_safe_false_positive_rate: 0.031
    valid_policy_recall:
      nudity: 0.881
      violence: 0.836
      hate_symbols: 0.792
  required_artifacts:
    model: model/model.pt
    metrics: reports/metrics.yaml
    segment_report: reports/segment_metrics.csv
    error_examples: reports/error_examples.parquet
    resolved_config: config/resolved_config.yaml
    runtime: environment/runtime.yaml
  open_questions:
    - "Review hate-symbol false negatives in Spanish and Portuguese markets."
    - "Confirm reviewer capacity for one-week shadow queue."
```

This file gives every reviewer the same anchor. The recommendation says what the ML team wants next. The metrics show the current evidence. The open questions prevent a strong aggregate score from hiding weak spots.

![Review and debug evidence](/content-assets/articles/article-mlops-training-pipelines-logging-training-outputs-artifacts/review-debug-evidence.png)
*When a segment looks suspicious, the review packet points the team from summary metrics to examples and then to the next training fix.*

## Debug With Artifacts
<!-- section-summary: Good artifacts turn failed runs and surprising metrics into targeted investigations. -->

Artifacts help most when something surprises the team. Suppose `cover-policy-2026-07-04-1700` has a strong macro F1, yet the Spanish-language segment shows a high false-positive rate. The team can open `segment_metrics.csv`, find the exact segment, inspect `error_examples.parquet`, and compare the data manifest with the previous run.

A simple query over the segment report can start the investigation:

```python
import pandas as pd

segments = pd.read_csv("reports/segment_metrics.csv")
problem_segments = segments[
    (segments["false_positive_rate"] > 0.06)
    & (segments["support"] >= 500)
].sort_values("false_positive_rate", ascending=False)

print(problem_segments[["segment_name", "support", "false_positive_rate", "recall"]].head(10))
```

Example output:

```console
segment_name                 support  false_positive_rate  recall
market=es,source=upload      1842     0.074                0.811
market=pt,source=upload      913      0.068                0.804
market=es,source=screen_cap  642      0.064                0.826
```

That output points the review team at concrete examples. The next check is the error artifact:

```python
errors = pd.read_parquet("reports/error_examples.parquet")
errors[
    (errors["market"] == "es")
    & (errors["prediction"] == "policy_violation")
    & (errors["label"] == "safe")
].head(25).to_csv("review/spanish_false_positive_examples.csv", index=False)
```

Now the team has a small review file for human inspection. If the examples reveal a label issue, the next training run should update the dataset manifest and note the label correction. If the examples reveal a feature problem, the next config can adjust the feature set.

## Putting It Together
<!-- section-summary: Training artifacts preserve the evidence that lets a team review, debug, compare, and promote a model run. -->

Training artifacts turn a completed job into inspectable evidence. SignalBend's moderation run writes local files first, logs them to MLflow, optionally versions them with W&B artifacts, and packages them into a review packet. The model file matters, but the model file alone gives weak evidence. The metrics, segment report, error examples, data manifest, schema, resolved config, runtime record, and review packet explain the model.

This closes the "From Notebook to Job" submodule. You now have a script, a config, and a set of artifacts. The next step is pipeline design: connecting data prep, training, evaluation, and artifact publishing into a coordinated workflow.

## References

- [MLflow Python API: `mlflow.pytorch.log_model`](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.pytorch.html)
- [MLflow Python API: `mlflow.sklearn.log_model`](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html)
- [Weights & Biases Docs: Artifacts overview](https://docs.wandb.ai/models/artifacts/)
- [Weights & Biases Docs: Registry overview](https://docs.wandb.ai/models/registry/)
- [NVIDIA GPU Operator: Platform support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [NVIDIA Deep Learning Frameworks Support Matrix](https://docs.nvidia.com/deeplearning/frameworks/support-matrix/index.html)
