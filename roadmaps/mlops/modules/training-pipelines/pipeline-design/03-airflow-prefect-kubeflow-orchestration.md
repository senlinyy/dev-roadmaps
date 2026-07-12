---
title: "Training Orchestration"
description: "Choose and operate a training orchestrator by matching workflow shape, data dependencies, Kubernetes needs, team ownership, retries, logs, and artifact handoff."
overview: "Training orchestration coordinates the steps around model training so data prep, validation, training, evaluation, artifact logging, and review run in a controlled order. This guide follows a claims-triage model through Airflow, Dagster, Prefect, Kubeflow Pipelines, Argo Workflows, and Databricks Lakeflow Jobs."
tags: ["MLOps", "production", "orchestration"]
order: 3
id: "article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration"
---

## Table of Contents

1. [Training Orchestration Coordinates The Whole Run](#training-orchestration-coordinates-the-whole-run)
2. [Follow One Claims-Triage Training Workflow](#follow-one-claims-triage-training-workflow)
3. [What An Orchestrator Owns](#what-an-orchestrator-owns)
4. [Start With The Interface Between Steps](#start-with-the-interface-between-steps)
5. [Airflow For Data-Heavy Platform Workflows](#airflow-for-data-heavy-platform-workflows)
6. [Dagster And Prefect For Pythonic ML Workflows](#dagster-and-prefect-for-pythonic-ml-workflows)
7. [Kubeflow Pipelines And Argo For Kubernetes-Native ML](#kubeflow-pipelines-and-argo-for-kubernetes-native-ml)
8. [Databricks Lakeflow Jobs For Lakehouse Teams](#databricks-lakeflow-jobs-for-lakehouse-teams)
9. [Choose And Operate The Orchestrator](#choose-and-operate-the-orchestrator)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

## Training Orchestration Coordinates The Whole Run
<!-- section-summary: Training orchestration coordinates data prep, validation, training, evaluation, artifacts, retries, logs, and handoff across a whole workflow. -->

**Training orchestration** is the system that coordinates the steps around model training. It decides which step runs first, which step waits for an upstream output, which container or compute environment runs each step, what happens after a failure, where logs live, and which artifacts move into review. A training script trains the model. A pipeline describes the stages. An orchestrator runs that pipeline in the real world.

The previous articles gave you the pieces: a Python training script, a config file, artifacts, a repeatable pipeline, and triggers. Orchestration is where those pieces meet daily operations. A schedule or event starts a run. The orchestrator launches the feature build, waits for validation, starts the training job, records status, retries safe failures, stops unsafe failures, and gives the on-call engineer one place to inspect what happened.

For a beginner, the useful question is simple: who is responsible for moving the workflow from one step to the next? If a validation report is missing, the orchestrator should stop before training. If a training container runs out of memory, the orchestrator should show the failed task, logs, runtime, and retry history. If the model passes evaluation, the orchestrator should connect the run ID, artifacts, and review packet to the handoff step.

The main ideas connect like this:

| Concept | Plain-English meaning | Why it matters |
|---|---|---|
| Workflow graph | The steps and dependencies in the run | Prevents training before data and validation are ready |
| Task runtime | The container, cluster, job, notebook, or worker that runs a step | Keeps Python packages, hardware, and permissions visible |
| State tracking | The record of running, passed, failed, skipped, or retried steps | Gives operators a clear investigation path |
| Retry policy | Rules for repeating safe failures | Handles temporary storage or network problems without hiding bad inputs |
| Artifact handoff | Passing model files, metrics, reports, and manifests between steps | Keeps review and registry work tied to evidence |
| Trigger surface | Schedule, event, manual run, or backfill entrypoint | Explains why the pipeline ran now |

![ClearClaim training orchestration responsibilities](/content-assets/articles/article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration/clearclaim-training-orchestration.png)
*The orchestrator owns the movement, state, runtime, retries, handoff, and alerts around the ClearClaim training run.*

## Follow One Claims-Triage Training Workflow
<!-- section-summary: The running scenario follows an insurance team that needs a training workflow with data checks, model evidence, and review handoff. -->

Imagine **ClearClaim Insurance**, a regional insurer that routes incoming auto claims to the right handling queue. The model is `claim_triage_xgboost_v4`. It predicts whether a claim can go to straight-through processing, needs a normal adjuster review, or should go to the special investigation unit. The model affects customer wait time and fraud investigation workload, so the team needs strong evidence around every run.

The training workflow has familiar pieces. A data job builds a point-in-time feature snapshot from claim events, policy records, repair estimates, call-center notes, and fraud investigation outcomes. A validation step checks row counts, delayed labels, missing repair categories, and leakage rules. A Python script trains an XGBoost model from a YAML config. An evaluation step writes segment metrics by state, claim type, repair shop network, and customer tenure. A final step publishes a review packet and creates a candidate in the model registry after approval.

The team runs the full training workflow every Saturday night after the weekly label window closes. They also need manual runs after label corrections and event-based runs when the data platform publishes a new approved snapshot. This is exactly where orchestration matters. The workflow has too many moving parts for one shell script on a laptop, and it has too much business risk for a silent cron job.

The run record should look like this:

```yaml
training_run:
  run_id: claim-triage-2026-07-04-2300
  model_name: claim_triage_xgboost
  owner: claims-ml-platform
  trigger_reason: weekly-approved-snapshot
  config_uri: s3://clearclaim-ml/configs/claim_triage_weekly.yaml
  data_snapshot: clearclaim-claims-2026-06-30-v7
  artifact_root: s3://clearclaim-ml-artifacts/claim-triage/claim-triage-2026-07-04-2300/
  primary_metric: valid_macro_f1
  guarded_segments:
    - state=CA
    - claim_type=total_loss
    - repair_network=out_of_network
```

That record gives the orchestrator and the humans the same vocabulary. Every task should receive the run ID. Every artifact should include the snapshot. Every dashboard should let the on-call engineer filter by owner and model name.

## What An Orchestrator Owns
<!-- section-summary: An orchestrator should own workflow order, state, retries, logs, runtime selection, parameters, and notifications, while model logic stays inside scripts and components. -->

An orchestrator should own coordination. It should know that `validate_snapshot` depends on `build_snapshot`, that `train_model` depends on validation, and that `publish_candidate` depends on evaluation. It should also know how to run each step: a Kubernetes pod, a Python worker, a Databricks notebook task, a containerized component, or an Argo template.

The model code should stay inside reviewed scripts and components. ClearClaim keeps feature logic in the data pipeline, training logic in `claim_triage/train.py`, evaluation logic in `claim_triage/evaluate.py`, and artifact logging in shared helpers. The orchestrator calls those pieces. It should pass parameters, watch state, collect logs, and enforce dependencies. That split makes the workflow portable because the same training script can run from Airflow, Prefect, Kubeflow Pipelines, or a plain Kubernetes Job.

The boundary is practical:

| Responsibility | Good owner | Example |
|---|---|---|
| Feature computation logic | Data code | SQL or Spark job that builds the snapshot |
| Training behavior | Python package | `python -m claim_triage.train --config ...` |
| Dependency order | Orchestrator | Train only after validation passes |
| Runtime selection | Orchestrator plus config | Use CPU pool for XGBoost, GPU pool for vision model |
| Metrics and artifacts | Training and evaluation code | MLflow run, W&B artifacts, review packet |
| Retry and timeout | Orchestrator | Retry storage read once, fail training after four hours |
| Human notification | Orchestrator | Alert `#claims-ml-oncall` after validation failure |

This boundary also helps during incidents. If the training code raises a feature-name error, the ML engineer fixes code or config. If the orchestrator cannot start a pod, the platform engineer checks cluster permissions, image pull access, or work-pool capacity. If the publish step cannot attach lineage, the registry owner checks the handoff contract.

## Start With The Interface Between Steps
<!-- section-summary: A stable interface between steps lets different orchestrators run the same training workflow without changing the model code. -->

Before choosing a tool, write the interface between steps. The interface says what each step receives, what it writes, and which status means it passed. This prevents a tool comparison from drifting into personal preference. ClearClaim can run the same workflow from several orchestrators if the step contract stays stable.

The contract can be a small YAML file:

```yaml
steps:
  build_snapshot:
    command: "python -m claim_triage.features.build_snapshot"
    outputs:
      snapshot_manifest: "data/snapshot_manifest.yaml"
  validate_snapshot:
    command: "python -m claim_triage.validation.validate_snapshot"
    inputs:
      snapshot_manifest: "data/snapshot_manifest.yaml"
    outputs:
      validation_report: "reports/data_validation.json"
    pass_condition: "all required checks passed"
  train_model:
    command: "python -m claim_triage.train"
    inputs:
      config: "config/resolved_config.yaml"
      snapshot_manifest: "data/snapshot_manifest.yaml"
    outputs:
      model_uri: "runs:/<run_id>/model"
      metrics: "reports/metrics.yaml"
  evaluate_model:
    command: "python -m claim_triage.evaluate"
    outputs:
      segment_metrics: "reports/segment_metrics.csv"
      review_packet: "review/model_review.yaml"
  publish_candidate:
    command: "python -m claim_triage.registry.publish_candidate"
    inputs:
      review_packet: "review/model_review.yaml"
    pass_condition: "lineage, owner, and rollback fields exist"
```

This file is small, but it carries important design choices. Every step has a command. Every handoff file has a path. Every important check has a pass rule. The orchestrator can represent this as Airflow tasks, Dagster assets, Prefect tasks, Kubeflow components, Argo templates, or Databricks job tasks.

The interface should also include the runtime. ClearClaim uses Docker images pinned by digest, service accounts with narrow permissions, and resource requests that match the model family:

```yaml
runtime:
  image: ghcr.io/clearclaim/claim-triage-trainer@sha256:624e2a0f6b7d9a0c44a3819ab23e18bfeeddcc00112233445566778899aabbcc
  service_account: claim-triage-training
  cpu: "8"
  memory: "32Gi"
  timeout_minutes: 240
  max_retries:
    build_snapshot: 1
    validate_snapshot: 0
    train_model: 1
    evaluate_model: 0
    publish_candidate: 0
```

Validation and publish steps get zero retries because repeated attempts rarely fix bad data or missing lineage. Snapshot build and training get one retry because storage or node interruptions can happen. Those choices should live in review, not in someone's memory.

![One step interface across multiple orchestrators](/content-assets/articles/article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration/step-interface-many-orchestrators.png)
*A stable step contract keeps the same training package usable whether the team runs it from Airflow, Dagster, Prefect, Kubeflow, or Lakeflow Jobs.*

## Airflow For Data-Heavy Platform Workflows
<!-- section-summary: Airflow fits teams with many scheduled data dependencies, platform-owned DAGs, and containerized tasks that need strong operational visibility. -->

**Apache Airflow** is a good fit when the training workflow sits close to data engineering. Many companies already use Airflow for warehouse jobs, feature snapshots, dbt runs, Spark jobs, and scheduled data quality checks. If the ML training workflow depends on those jobs, Airflow gives one place to see the data path and the model path together.

Airflow represents a workflow as a DAG, a directed acyclic graph. The DAG describes tasks and dependencies. Current Airflow docs show scheduled DAGs using the `schedule` argument, and Airflow 3 added event-driven scheduling for workflows that react to external events. For ClearClaim, Airflow can run the weekly schedule and still wait for a snapshot event or data-ready marker before training.

Here is a compact Airflow DAG that launches the training pipeline as Kubernetes pods:

```python
from datetime import datetime

from airflow.sdk import DAG
from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator


DEFAULT_IMAGE = "ghcr.io/clearclaim/claim-triage-trainer@sha256:624e2a0f6b7d9a0c44a3819ab23e18bfeeddcc00112233445566778899aabbcc"


with DAG(
    dag_id="claim_triage_training",
    schedule="0 23 * * SAT",
    start_date=datetime(2026, 7, 4),
    catchup=False,
    tags=["ml", "claims", "training"],
) as dag:
    validate_snapshot = KubernetesPodOperator(
        task_id="validate_snapshot",
        namespace="ml-training",
        image=DEFAULT_IMAGE,
        cmds=["python", "-m", "claim_triage.validation.validate_snapshot"],
        arguments=["--run-id", "{{ dag_run.run_id }}", "--config", "configs/claim_triage_weekly.yaml"],
        service_account_name="claim-triage-training",
    )

    train_model = KubernetesPodOperator(
        task_id="train_model",
        namespace="ml-training",
        image=DEFAULT_IMAGE,
        cmds=["python", "-m", "claim_triage.train"],
        arguments=["--run-id", "{{ dag_run.run_id }}", "--config", "configs/claim_triage_weekly.yaml"],
        service_account_name="claim-triage-training",
    )

    evaluate_model = KubernetesPodOperator(
        task_id="evaluate_model",
        namespace="ml-training",
        image=DEFAULT_IMAGE,
        cmds=["python", "-m", "claim_triage.evaluate"],
        arguments=["--run-id", "{{ dag_run.run_id }}"],
        service_account_name="claim-triage-training",
    )

    validate_snapshot >> train_model >> evaluate_model
```

The `KubernetesPodOperator` lets Airflow ask Kubernetes to run a pod for each task. That keeps task dependencies in Airflow and runtime isolation in Kubernetes. The pinned image keeps package versions fixed. The service account controls warehouse and artifact access. The `dag_run.run_id` connects task logs, MLflow runs, and artifacts.

Airflow works best when platform engineers own the DAG style, data teams already watch Airflow, and the workflow has many scheduled dependencies. It can feel heavy for a small research team that wants quick local iteration. It also needs discipline around DAG parsing, task size, retries, and backfills so a training workflow does not turn into one giant Python function hidden inside an operator.

## Dagster And Prefect For Pythonic ML Workflows
<!-- section-summary: Dagster and Prefect fit teams that want Python-first workflows with assets, typed config, sensors, deployments, work pools, and clear run operations. -->

**Dagster** and **Prefect** appeal to many ML teams because the workflow stays close to normal Python. They can still run containers and connect to Kubernetes, yet the authoring experience often feels friendlier for teams that think in Python functions, assets, and flow runs.

Dagster is strong when the team wants to treat datasets, features, models, and reports as assets with lineage. A Dagster sensor can watch for an external event, such as a new snapshot in object storage, and create a run. Official Dagster docs describe sensors as definitions that check internal or external events and take action, with examples such as files appearing in S3. That maps well to ClearClaim's approved snapshot event.

```python
import dagster as dg


claim_training_job = dg.define_asset_job(
    "claim_training_job",
    selection=[
        "claim_feature_snapshot",
        "claim_validation_report",
        "claim_triage_model",
        "claim_review_packet",
    ],
)


@dg.sensor(job=claim_training_job, minimum_interval_seconds=300)
def claim_snapshot_sensor(context):
    snapshot = find_latest_approved_snapshot()
    if snapshot is None:
        yield dg.SkipReason("No approved claim snapshot")
        return

    yield dg.RunRequest(
        run_key=snapshot.snapshot_id,
        run_config={
            "ops": {
                "claim_feature_snapshot": {
                    "config": {"snapshot_id": snapshot.snapshot_id}
                }
            }
        },
    )
```

The `run_key` gives the workflow an idempotency guard. The sensor can check every five minutes, and the same snapshot should still create one run. Dagster fits teams that want asset lineage, partitioned datasets, materialization history, and clear definitions for schedules and sensors.

Prefect is strong when the team wants a flow that can run from a deployment, a work pool, a schedule, an automation, or a manual trigger. Prefect deployments define how a flow runs and which work pool should execute it. Prefect automations can create flow runs, pause schedules, send notifications, and react to events.

```python
from prefect import flow, task


@task(retries=1)
def validate_snapshot(run_id: str, config_uri: str) -> str:
    return run_command(
        "python",
        "-m",
        "claim_triage.validation.validate_snapshot",
        "--run-id",
        run_id,
        "--config",
        config_uri,
    )


@task(retries=1)
def train_model(run_id: str, config_uri: str) -> str:
    return run_command(
        "python",
        "-m",
        "claim_triage.train",
        "--run-id",
        run_id,
        "--config",
        config_uri,
    )


@flow(name="claim-triage-training")
def claim_triage_training(run_id: str, config_uri: str):
    validation_report = validate_snapshot(run_id, config_uri)
    model_uri = train_model(run_id, config_uri)
    return write_review_packet(run_id=run_id, validation_report=validation_report, model_uri=model_uri)
```

A Prefect deployment can attach this flow to a Kubernetes work pool and a weekly schedule:

```yaml
deployments:
  - name: claim-triage-weekly
    entrypoint: flows/claim_training.py:claim_triage_training
    work_pool:
      name: kubernetes-ml-training
    parameters:
      config_uri: s3://clearclaim-ml/configs/claim_triage_weekly.yaml
    schedules:
      - cron: "0 23 * * SAT"
        timezone: "UTC"
        active: true
```

Prefect fits teams that want flexible deployments, visible flow runs, event automations, and worker pools without writing a large amount of platform glue. Dagster fits teams that want stronger asset lineage and data-product structure. Either tool can run the same ClearClaim training script if the step interface stays clean.

## Kubeflow Pipelines And Argo For Kubernetes-Native ML
<!-- section-summary: Kubeflow Pipelines and Argo fit teams that want containerized workflow steps running directly on Kubernetes with artifact handoff and platform controls. -->

**Kubeflow Pipelines** fits teams that already use Kubernetes for ML workloads and want each workflow step packaged as a component. Official Kubeflow docs describe KFP as a platform for portable and scalable ML workflows using containers on Kubernetes-based systems. Components pass parameters and artifacts between steps, which matches training pipelines that produce models, reports, and manifests.

ClearClaim can model the workflow as KFP components:

```python
from kfp import dsl


@dsl.component(base_image="ghcr.io/clearclaim/claim-triage-trainer@sha256:624e2a0f6b7d9a0c44a3819ab23e18bfeeddcc00112233445566778899aabbcc")
def validate_snapshot(run_id: str, config_uri: str, report: dsl.Output[dsl.Artifact]):
    from claim_triage.validation import validate_snapshot

    validate_snapshot(run_id=run_id, config_uri=config_uri, output_path=report.path)


@dsl.component(base_image="ghcr.io/clearclaim/claim-triage-trainer@sha256:624e2a0f6b7d9a0c44a3819ab23e18bfeeddcc00112233445566778899aabbcc")
def train_model(run_id: str, config_uri: str, model: dsl.Output[dsl.Model]):
    from claim_triage.training import train

    train(run_id=run_id, config_uri=config_uri, model_output_path=model.path)


@dsl.pipeline(name="claim-triage-training")
def claim_triage_training(run_id: str, config_uri: str):
    validation = validate_snapshot(run_id=run_id, config_uri=config_uri)
    training = train_model(run_id=run_id, config_uri=config_uri)
    training.after(validation)
```

The important part is the artifact surface. The validation component writes a report artifact. The training component writes a model artifact. The pipeline engine knows the dependency and can track component outputs. This fits ML platform teams that want reusable components, metadata, artifact lineage, and Kubernetes execution.

**Argo Workflows** sits one level lower. It is a general workflow engine for Kubernetes. It works well when the team wants direct YAML control over container steps, service accounts, node selectors, secrets, and cluster-native behavior. Argo can run ML pipelines even when the organization does not use the full Kubeflow stack.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: claim-triage-training-
spec:
  entrypoint: training
  serviceAccountName: claim-triage-training
  templates:
    - name: training
      steps:
        - - name: validate
            template: run-step
            arguments:
              parameters:
                - name: module
                  value: claim_triage.validation.validate_snapshot
        - - name: train
            template: run-step
            arguments:
              parameters:
                - name: module
                  value: claim_triage.train
        - - name: evaluate
            template: run-step
            arguments:
              parameters:
                - name: module
                  value: claim_triage.evaluate
    - name: run-step
      inputs:
        parameters:
          - name: module
      container:
        image: ghcr.io/clearclaim/claim-triage-trainer@sha256:624e2a0f6b7d9a0c44a3819ab23e18bfeeddcc00112233445566778899aabbcc
        command: ["python", "-m"]
        args:
          - "{{inputs.parameters.module}}"
          - "--config"
          - "configs/claim_triage_weekly.yaml"
```

Kubeflow Pipelines gives ML-specific authoring and metadata. Argo gives Kubernetes-native workflow control. Both need platform maturity: image builds, cluster quotas, artifact storage, secrets, service accounts, observability, and cleanup policies. They are strong choices when training jobs already run as containers on shared clusters.

## Databricks Lakeflow Jobs For Lakehouse Teams
<!-- section-summary: Databricks Lakeflow Jobs fit teams whose training data, notebooks, Spark jobs, MLflow tracking, and review work already live on Databricks. -->

Many teams still say **Databricks Workflows** in conversation. Current Databricks documentation presents the orchestration surface as **Lakeflow Jobs**. It coordinates jobs, tasks, and triggers inside Databricks, and it fits teams whose data engineering, feature tables, notebooks, Spark jobs, MLflow tracking, and model review work already live in that workspace.

ClearClaim might use Databricks if the claim feature tables live in Delta, analysts review feature quality in notebooks, and MLflow tracking already uses Databricks-managed experiments. A Lakeflow job can run a notebook task for feature validation, a Python wheel task for training, a Spark task for segment metrics, and a final task that writes a registry handoff file.

The job design still follows the same contract:

```yaml
job:
  name: claim-triage-training
  trigger:
    schedule: "Saturday 23:00 UTC"
  tasks:
    - key: validate_snapshot
      type: notebook
      notebook_path: /Repos/claims-ml/validation/validate_claim_snapshot
    - key: train_model
      type: python_wheel
      package_name: claim_triage
      entry_point: train
      depends_on:
        - validate_snapshot
    - key: evaluate_model
      type: python_wheel
      package_name: claim_triage
      entry_point: evaluate
      depends_on:
        - train_model
    - key: publish_candidate
      type: python_wheel
      package_name: claim_triage
      entry_point: publish_candidate
      depends_on:
        - evaluate_model
```

Treat this as a design sketch rather than a copy-paste API payload. The real configuration may come from the Databricks UI, REST API, CLI, SDK, or Databricks Asset Bundles. The important idea is the same: each task has an owner, dependency, runtime, parameters, and output evidence.

Databricks is strongest when the workflow stays near the lakehouse. It can be awkward when most work already runs on a separate Kubernetes platform or when the organization wants cloud-neutral workflow definitions. The clean step interface helps here too. If the training package accepts `--config`, `--run-id`, and `--artifact-root`, a Databricks job can call it today and another orchestrator can call it later.

## Choose And Operate The Orchestrator
<!-- section-summary: The best orchestrator depends on workflow shape, team ownership, runtime platform, data location, artifact needs, and on-call habits. -->

Choosing an orchestrator should start from the workflow and the team, not from a feature checklist. ClearClaim should ask where the data lives, who owns the workflow, what runtime each step needs, how triggers work, how evidence moves, and who gets paged when the run fails.

| Need | Strong fit | Why |
|---|---|---|
| Many warehouse and data-platform dependencies | Airflow | Existing data DAGs, schedules, sensors, Kubernetes operators |
| Asset lineage and Python data products | Dagster | Assets, materializations, schedules, sensors, partitions |
| Flexible Python flows and event automations | Prefect | Deployments, work pools, schedules, automations, simple flow authoring |
| ML-specific Kubernetes components | Kubeflow Pipelines | Components, pipeline metadata, artifact passing, Kubernetes execution |
| Direct Kubernetes workflow control | Argo Workflows | YAML workflows, service accounts, pods, cluster-native policies |
| Databricks-centered lakehouse workflow | Databricks Lakeflow Jobs | Jobs, tasks, triggers, notebooks, Spark, MLflow workspace integration |

After choosing the tool, operate it with the same evidence standards as the model. ClearClaim's runbook should answer these questions:

| Question | Operational answer |
|---|---|
| How do we pause training? | Disable the schedule or automation and record the incident ticket |
| How do we replay a snapshot? | Start a manual run with `snapshot_id`, `run_reason`, and owner |
| How do we avoid duplicates? | Use `snapshot_id` as an idempotency key and reject existing successful runs |
| How do we control cost? | Set concurrency limits, timeouts, resource requests, and budget tags |
| How do we debug failures? | Open the failed task logs, artifact root, validation report, and runtime events |
| How do we rollback? | Keep the previous approved model active until the review packet passes |

A useful incident flow is direct:

```yaml
incident_runbook:
  failed_task: train_model
  first_checks:
    - "Open orchestrator task logs for the failed run ID."
    - "Check Kubernetes or workspace runtime events for image pull, memory, or permission errors."
    - "Open reports/data_validation.json from the same artifact root."
    - "Search MLflow or W&B by run_id and snapshot_id."
  safe_actions:
    - "Rerun only after config and snapshot are confirmed."
    - "Use a new run_id for replay."
    - "Keep the current approved model active until review passes."
```

This runbook keeps the orchestrator tied to production behavior. The tool is not just a scheduler. It is the operations surface for model training.

![Orchestrator choice and incident runbook](/content-assets/articles/article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration/choose-operate-orchestrator.png)
*Choosing the tool is only half the job; the team also needs a runbook for failed tasks, runtime events, validation evidence, and rollback safety.*

## Putting It Together
<!-- section-summary: Training orchestration gives the training pipeline a reliable operations surface across schedules, events, runtimes, logs, artifacts, and review handoff. -->

Training orchestration coordinates the whole run. ClearClaim's claims-triage model needs data prep, validation, training, evaluation, artifact logging, and registry handoff to run in a controlled order. The orchestrator tracks each step, launches the right runtime, applies retries and timeouts, records logs, and gives the team a replay path after failures.

Airflow fits data-heavy scheduled workflows. Dagster and Prefect fit Pythonic teams that want assets, flows, sensors, deployments, and event automation. Kubeflow Pipelines and Argo fit Kubernetes-native ML platforms. Databricks Lakeflow Jobs fit teams already centered on Databricks data, notebooks, Spark, MLflow, and job tasks. The best choice is the one that matches the workflow, team ownership, runtime, and incident habits while preserving the same script, config, artifacts, and review evidence.

## References

- [Apache Airflow Docs: Cron and time intervals](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/cron.html)
- [Apache Airflow Docs: Event-driven scheduling](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/event-scheduling.html)
- [Apache Airflow Kubernetes Provider: KubernetesPodOperator](https://airflow.apache.org/docs/apache-airflow-providers-cncf-kubernetes/stable/operators.html)
- [Dagster Docs: Schedules](https://docs.dagster.io/guides/automate/schedules)
- [Dagster Docs: Sensors](https://docs.dagster.io/guides/automate/sensors)
- [Prefect 3 Docs: Deployments](https://docs.prefect.io/v3/concepts/deployments)
- [Prefect 3 Docs: Schedules](https://docs.prefect.io/v3/concepts/schedules)
- [Prefect 3 Docs: Automations](https://docs.prefect.io/v3/concepts/automations)
- [Kubeflow Pipelines: Overview](https://www.kubeflow.org/docs/components/pipelines/overview/)
- [Kubeflow Pipelines: Components](https://www.kubeflow.org/docs/components/pipelines/concepts/component/)
- [Argo Workflows: Steps](https://argo-workflows.readthedocs.io/en/latest/walk-through/steps/)
- [Databricks Docs: Lakeflow Jobs](https://docs.databricks.com/aws/en/jobs/)
- [Databricks Docs: Trigger a single job run](https://docs.databricks.com/aws/en/jobs/run-now)
