---
title: "Training Pipelines"
description: "Connect data preparation, validation, training, evaluation, artifact publishing, and registry handoff into one repeatable workflow."
overview: "A training pipeline is a repeatable workflow that runs the steps around model training in the right order. This guide follows a delivery ETA model through data prep, validation, training, evaluation, artifact logging, registry handoff, CI checks, and a Kubeflow Pipelines example."
tags: ["MLOps", "production", "orchestration"]
order: 1
id: "article-mlops-training-pipelines-repeatable-training-pipeline"
---

## Table of Contents

1. [A Training Pipeline Connects The Steps Around Training](#a-training-pipeline-connects-the-steps-around-training)
2. [Follow One Delivery ETA Model](#follow-one-delivery-eta-model)
3. [Map The Pipeline Stages](#map-the-pipeline-stages)
4. [Make Each Stage Produce Evidence](#make-each-stage-produce-evidence)
5. [Write A Pipeline Spec](#write-a-pipeline-spec)
6. [Run The Pipeline In CI And Production](#run-the-pipeline-in-ci-and-production)
7. [Add Registry Handoff And Rollback Evidence](#add-registry-handoff-and-rollback-evidence)
8. [Failure Modes You Can Diagnose](#failure-modes-you-can-diagnose)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## A Training Pipeline Connects The Steps Around Training
<!-- section-summary: A training pipeline is a repeatable workflow that runs data prep, validation, training, evaluation, and artifact publishing in order. -->

A **training pipeline** is a repeatable workflow that runs the steps around model training in the right order. It usually prepares data, validates the data, trains the model, evaluates the result, logs artifacts, and hands a reviewed candidate to a registry or release process. The pipeline gives the team one workflow to run instead of a loose set of commands and notebooks.

The earlier articles built the pieces. A training script gives one entrypoint. A config file names the run choices. Artifacts preserve the evidence. A training pipeline connects those pieces with dependencies and checks. If data validation fails, training should stop. If training succeeds and evaluation fails, the model should stay out of the registry. If evaluation passes, the pipeline should publish a review packet with links to the evidence.

For a beginner, the main idea is order plus evidence. The pipeline says which step depends on which previous step, what each step consumes, what it produces, and what counts as success. That makes a rerun much cleaner during incidents, scheduled retraining, and model review.

Here is the pipeline shape you will build in this article:

| Stage | Input | Output | Success check |
|---|---|---|---|
| Prepare data | Raw delivery events | Training and validation snapshots | Row counts and time window match config |
| Validate data | Snapshots | Validation report | Schema, freshness, and label checks pass |
| Train model | Config and snapshots | Model and metrics | Job exits cleanly and writes required artifacts |
| Evaluate model | Model and validation data | Segment report and review packet | Metrics and guardrails pass |
| Publish candidate | Artifacts and review packet | Registry candidate or release ticket | Lineage and approval fields exist |

![Delivery ETA training pipeline stages](/content-assets/articles/article-mlops-training-pipelines-repeatable-training-pipeline/delivery-eta-training-pipeline.png)
*HarborRoute's pipeline is useful because each stage has a clear input, a clear output, and a place to stop when evidence fails.*

## Follow One Delivery ETA Model
<!-- section-summary: The running scenario follows a delivery platform that retrains an ETA model through a pipeline instead of manual commands. -->

Imagine **HarborRoute**, a delivery platform that predicts estimated arrival times for grocery and pharmacy orders. The model is `delivery_eta_lightgbm_v12`. It uses order distance, courier availability, weather, store prep delay, traffic zone, and historical route speed features. The prediction feeds customer-facing ETA windows, dispatcher views, and late-order alerts.

The old training workflow depends on a senior engineer running four commands from a notebook folder: build a feature table, run a validation script, train the model, and copy artifacts to object storage. That worked during early development. It causes trouble now because the operations team wants a weekly retraining job, the product team wants review evidence, and the on-call engineer needs a replay path after bad ETAs.

The pipeline will train from `harborroute_eta_train_2026_06_30` and validate on `harborroute_eta_valid_2026_06_30`. The primary metric is `valid_mae_minutes`. The guardrails are `p90_absolute_error_minutes`, `late_order_underprediction_rate`, and `pharmacy_order_mae_minutes`, because underestimating pharmacy deliveries causes the most customer support pain.

The pipeline run should create a packet like this:

```yaml
pipeline_run:
  run_id: eta-train-2026-07-04-0300
  owner: logistics-ml-platform
  data_snapshot: harborroute-eta-2026-06-30-v5
  config: configs/eta_lightgbm_weekly.yaml
  model_name: delivery_eta_lightgbm
  primary_metric: valid_mae_minutes
  artifact_root: s3://harborroute-ml-artifacts/eta/eta-train-2026-07-04-0300/
  decision: candidate_for_dispatch_shadow
```

That packet gives the team a stable handle for every downstream conversation. If the run fails, the run ID still points at logs and partial evidence. If it passes, the same run ID appears in MLflow, the review ticket, and the registry candidate.

## Map The Pipeline Stages
<!-- section-summary: A pipeline stage should have a clear owner, input, output, and success rule. -->

A useful pipeline starts with a stage map. This step prevents the workflow from turning into one giant container that hides everything. Each stage should have a simple responsibility and a file or metadata output that the next stage can use.

HarborRoute can define the stages like this:

| Stage | Owner | What it does | Main outputs |
|---|---|---|---|
| `extract_features` | Data engineering | Builds point-in-time feature snapshots from delivery events | Train and validation Parquet paths |
| `validate_data` | ML platform | Checks schema, freshness, label balance, and leakage boundaries | `data_validation_report.json` |
| `train_model` | ML engineering | Runs the LightGBM training script with the weekly config | Model, metrics, resolved config |
| `evaluate_model` | Applied ML | Computes route, store, city, and pharmacy segment metrics | `segment_metrics.csv`, review packet |
| `publish_candidate` | ML platform | Logs candidate metadata and opens registry/release review | Registry candidate and release ticket |

The stage map also explains dependencies. `validate_data` needs the feature snapshot. `train_model` needs validation to pass. `evaluate_model` needs the trained model. `publish_candidate` needs the review packet. If a stage fails, the pipeline engine can show the failed step instead of forcing the on-call engineer to search one long log file.

A practical data contract can sit between `extract_features` and `validate_data`:

```yaml
feature_snapshot:
  snapshot_id: harborroute-eta-2026-06-30-v5
  train_uri: s3://harborroute-ml/features/eta/snapshot_date=2026-06-30/train/
  validation_uri: s3://harborroute-ml/features/eta/snapshot_date=2026-06-30/valid/
  entity_key: delivery_id
  event_time_column: order_created_at_utc
  label_column: actual_delivery_minutes
  feature_set: eta_route_features_v12
  train_rows: 48211421
  validation_rows: 5210042
```

This file keeps the pipeline honest. The training step can read this snapshot file instead of guessing which table the data prep step created.

## Make Each Stage Produce Evidence
<!-- section-summary: Each pipeline stage should emit a small artifact that proves what it received, produced, and checked. -->

Pipelines are easier to operate when every stage leaves evidence. A data-prep stage should record row counts, date ranges, and feature snapshot IDs. A validation stage should record passed and failed checks. A training stage should record metrics and runtime details. An evaluation stage should record segment metrics and examples. A publish stage should record the candidate ID, registry link, and review ticket.

HarborRoute's validation stage can write a report like this:

```json
{
  "snapshot_id": "harborroute-eta-2026-06-30-v5",
  "checks": [
    {
      "name": "freshness",
      "status": "passed",
      "observed_max_event_time": "2026-06-30T23:58:21Z"
    },
    {
      "name": "label_null_rate",
      "status": "passed",
      "observed": 0.0004,
      "max_allowed": 0.002
    },
    {
      "name": "pharmacy_order_share",
      "status": "passed",
      "observed": 0.084,
      "min_allowed": 0.06,
      "max_allowed": 0.11
    }
  ]
}
```

The evaluation stage can write a segment report:

```csv
segment,rows,mae_minutes,p90_absolute_error_minutes,underprediction_rate
all_orders,5210042,4.83,13.7,0.181
city=seattle,482901,4.61,12.9,0.173
city=chicago,508229,5.42,15.8,0.204
order_type=pharmacy,437512,5.71,16.1,0.217
weather=heavy_rain,184221,7.92,22.4,0.281
```

This report makes the product decision clearer. A strong overall MAE can hide a bad rainy-day or pharmacy segment. The pipeline should fail the publish step if a required segment crosses the guardrail.

The review packet can combine these outputs:

```yaml
review_packet:
  run_id: eta-train-2026-07-04-0300
  recommendation: candidate_for_dispatch_shadow
  data_validation_report: artifacts/data_validation_report.json
  segment_metrics: artifacts/segment_metrics.csv
  model_uri: runs:/eta-train-2026-07-04-0300/model
  guardrails:
    valid_mae_minutes:
      observed: 4.83
      max_allowed: 5.10
    pharmacy_order_mae_minutes:
      observed: 5.71
      max_allowed: 6.25
    late_order_underprediction_rate:
      observed: 0.181
      max_allowed: 0.195
```

The pipeline should treat the review packet as a first-class artifact. It tells the release process what happened and why the candidate can move forward.

![Stage evidence feeding a publish gate](/content-assets/articles/article-mlops-training-pipelines-repeatable-training-pipeline/stage-evidence.png)
*The review packet gathers the stage evidence into guardrails that the publish step can evaluate before a candidate leaves training.*

## Write A Pipeline Spec
<!-- section-summary: A pipeline spec captures the workflow graph so a platform can run the same stages consistently. -->

Many teams use a pipeline platform such as Kubeflow Pipelines, Vertex AI Pipelines, SageMaker Pipelines, Databricks Workflows, Airflow, Dagster, or Prefect. The exact platform changes by company. The useful pattern stays stable: define steps, pass artifacts between steps, and let the platform track status, logs, retries, and outputs.

Kubeflow Pipelines uses Python functions decorated as components and a pipeline function decorated with `@dsl.pipeline`. Here is a compact version of HarborRoute's workflow:

```python
from kfp import compiler, dsl


@dsl.component(base_image="python:3.12")
def extract_features(config_uri: str, snapshot_uri: dsl.OutputPath(str)) -> None:
    from harborroute.features import build_eta_snapshot

    snapshot = build_eta_snapshot(config_uri)
    with open(snapshot_uri, "w") as f:
        f.write(snapshot.to_yaml())


@dsl.component(base_image="python:3.12")
def validate_data(snapshot_uri: dsl.InputPath(str), report_uri: dsl.OutputPath(str)) -> None:
    from harborroute.validation import validate_eta_snapshot

    validate_eta_snapshot(snapshot_uri=snapshot_uri, output_path=report_uri)


@dsl.component(base_image="ghcr.io/harborroute/eta-trainer@sha256:85c0d7a999bb5a1c40ff1353de2a1c0f8d5e4f3a2b1c998877665544332211aa")
def train_model(snapshot_uri: dsl.InputPath(str), config_uri: str, artifact_root: str) -> str:
    from harborroute.training import train_eta_model

    return train_eta_model(
        snapshot_path=snapshot_uri,
        config_uri=config_uri,
        artifact_root=artifact_root,
    )


@dsl.component(base_image="python:3.12")
def evaluate_model(run_id: str, review_packet_uri: dsl.OutputPath(str)) -> None:
    from harborroute.evaluation import write_review_packet

    write_review_packet(run_id=run_id, output_path=review_packet_uri)


@dsl.pipeline(name="delivery-eta-training")
def delivery_eta_training(config_uri: str, artifact_root: str):
    snapshot = extract_features(config_uri=config_uri)
    validation = validate_data(snapshot_uri=snapshot.outputs["snapshot_uri"])
    training = train_model(
        snapshot_uri=snapshot.outputs["snapshot_uri"],
        config_uri=config_uri,
        artifact_root=artifact_root,
    )
    training.after(validation)
    evaluate_model(run_id=training.output)


compiler.Compiler().compile(delivery_eta_training, package_path="delivery_eta_training.yaml")
```

This example shows the graph. `extract_features` produces a snapshot file. `validate_data` checks it. `train_model` uses the same snapshot and config, then returns a run ID. `evaluate_model` uses the run ID to find artifacts and write a review packet. The compiled YAML can run on a Kubeflow-compatible backend or a managed pipeline service that supports KFP-style pipelines.

For SageMaker Pipelines or Vertex AI Pipelines, the same conceptual stages remain. The platform-specific syntax and IAM setup differ, so the team should keep the stage contract clear and let the platform adapter handle cloud-specific details.

## Run The Pipeline In CI And Production
<!-- section-summary: CI should validate the pipeline graph and components, while production runs use approved snapshots, service accounts, and artifact storage. -->

Pipeline CI should check the graph before a full production run. HarborRoute can compile the KFP spec, run unit tests for components, and execute a tiny local smoke path. The point is to catch broken imports, missing config fields, and graph wiring errors before the scheduler requests production compute.

A CI workflow can look like this:

```yaml
name: eta-pipeline-check

on:
  pull_request:
    paths:
      - "pipelines/delivery_eta_training.py"
      - "harborroute/**"
      - "configs/eta_lightgbm_weekly.yaml"

jobs:
  compile-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Install pipeline dependencies
        run: pip install -r requirements-pipeline.txt
      - name: Run unit tests
        run: pytest tests/pipelines tests/training
      - name: Compile pipeline
        run: python pipelines/delivery_eta_training.py
      - name: Check compiled spec exists
        run: test -s delivery_eta_training.yaml
```

Production runs need stronger controls:

| Control | HarborRoute setting |
|---|---|
| Service account | `eta-training-pipeline` with warehouse read and artifact write access |
| Artifact root | `s3://harborroute-ml-artifacts/eta/{run_id}/` |
| Runtime image | Pinned image digest in config and component spec |
| Secret handling | Tracking URI and warehouse credentials from platform secret store |
| Retry policy | Retry data extraction once, train step once, publish step manually |
| Timeout | Stop the full pipeline after four hours |

Those controls keep the pipeline predictable. The production run should use approved snapshots and an artifact root controlled by the platform team. A full run should also publish enough metadata for cost and quota review.

## Add Registry Handoff And Rollback Evidence
<!-- section-summary: The pipeline should publish a reviewed candidate with lineage and keep rollback evidence for the previous approved model. -->

The publish step should be careful. A passing pipeline run can create a candidate, open a review ticket, or update a registry alias only after approval, depending on the team's release policy. For a beginner, the main idea is that the pipeline should carry lineage into the handoff. The registry or release ticket needs the run ID, data snapshot, config, metrics, review packet, and artifact URI.

HarborRoute can write a candidate handoff file:

```yaml
registry_candidate:
  model_name: delivery_eta_lightgbm
  candidate_version: eta-train-2026-07-04-0300
  run_id: eta-train-2026-07-04-0300
  source_model_uri: runs:/eta-train-2026-07-04-0300/model
  data_snapshot: harborroute-eta-2026-06-30-v5
  resolved_config: s3://harborroute-ml-artifacts/eta/eta-train-2026-07-04-0300/config/resolved_config.yaml
  review_packet: s3://harborroute-ml-artifacts/eta/eta-train-2026-07-04-0300/review/model_review.yaml
  previous_approved_version: delivery_eta_lightgbm@champion-2026-06-27
  rollback_plan:
    batch_scoring_config: configs/scoring/eta_champion_2026_06_27.yaml
    owner: logistics-ml-platform
    maximum_recovery_minutes: 30
```

The previous approved version matters because release systems need a safe return path. If the new ETA model underpredicts rainy-day deliveries during shadow testing, the team can keep the previous approved version active, close the candidate, and rerun the training pipeline with a fixed feature snapshot or threshold.

![Candidate handoff and rollback path](/content-assets/articles/article-mlops-training-pipelines-repeatable-training-pipeline/candidate-handoff-rollback.png)
*A candidate handoff should carry the previous approved version and rollback plan, not just the new model URI.*

## Failure Modes You Can Diagnose
<!-- section-summary: A staged pipeline lets the team find whether a failure came from data, validation, training, evaluation, publish, or platform runtime. -->

A training pipeline gives better debugging because each failed stage has its own logs and artifacts. The on-call engineer can inspect the stage that failed instead of reading one long notebook export.

| Failure | Where it appears | Evidence to inspect | Typical response |
|---|---|---|---|
| Feature snapshot row count drops | `validate_data` | Data validation report and snapshot manifest | Pause training and check upstream feature job |
| Training container exits with code `137` | `train_model` | Pod logs and resource metrics | Increase memory request or reduce batch size |
| Overall MAE passes, pharmacy MAE fails | `evaluate_model` | Segment report and review packet | Keep candidate out of registry and inspect segment errors |
| Registry candidate lacks lineage | `publish_candidate` | Candidate handoff file | Block promotion until run ID and artifacts are attached |
| Pipeline spec fails to compile | CI | Compile job logs | Fix component signatures or dependency versions |

The pipeline also supports replay. A teammate can rerun the same config and snapshot under a new run ID, then compare reports. That replay should carry its own artifacts rather than overwriting the original run.

## Putting It Together
<!-- section-summary: A training pipeline turns scripts, configs, and artifacts into a repeatable workflow with stage evidence and release handoff. -->

A training pipeline is the workflow around training. HarborRoute's ETA pipeline prepares data, validates it, trains the model, evaluates segments, logs artifacts, and creates a registry handoff packet. Each stage has clear inputs, outputs, and success checks. The pipeline platform tracks status and logs, while the artifacts carry the evidence humans need.

This structure gives later pipeline decisions a place to attach. The next article compares scheduled and event-based triggers. A trigger decides when the same pipeline should run; the pipeline itself decides what happens once the run starts.

## References

- [Kubeflow Pipelines: Introduction](https://www.kubeflow.org/docs/components/pipelines/overview/)
- [Kubeflow Pipelines: Components](https://www.kubeflow.org/docs/components/pipelines/concepts/component/)
- [Amazon SageMaker Pipelines documentation](https://docs.aws.amazon.com/sagemaker/latest/dg/pipelines.html)
- [Google Cloud: Vertex AI Pipelines introduction](https://cloud.google.com/vertex-ai/docs/pipelines/introduction)
- [MLflow Python API: `mlflow.sklearn.log_model`](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html)
- [GitHub Docs: Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
