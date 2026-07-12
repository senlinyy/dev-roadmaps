---
title: "Training Triggers"
description: "Choose scheduled, event-based, manual, or hybrid training triggers based on data arrival, label readiness, business cadence, and operational risk."
overview: "A training trigger decides when a training pipeline starts. This tutorial follows a grocery demand forecast model and compares weekly schedules, data-arrival events, label-complete gates, manual reviews, backfills, and trigger runbooks."
tags: ["MLOps", "production", "orchestration"]
order: 2
id: "article-mlops-training-pipelines-scheduled-vs-event-based-training"
---

## Table of Contents

1. [A Training Trigger Decides When The Pipeline Starts](#a-training-trigger-decides-when-the-pipeline-starts)
2. [Follow One Grocery Demand Forecast](#follow-one-grocery-demand-forecast)
3. [Use Scheduled Training For Stable Cadence](#use-scheduled-training-for-stable-cadence)
4. [Use Event-Based Training When Data Arrival Matters](#use-event-based-training-when-data-arrival-matters)
5. [Add Label-Ready Gates](#add-label-ready-gates)
6. [Use Manual And Hybrid Triggers For Review Control](#use-manual-and-hybrid-triggers-for-review-control)
7. [Prevent Duplicate And Runaway Training](#prevent-duplicate-and-runaway-training)
8. [Trigger Runbook](#trigger-runbook)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## A Training Trigger Decides When The Pipeline Starts
<!-- section-summary: A training trigger is the condition that starts a pipeline run, such as a schedule, file arrival, label completion, manual approval, or incident response. -->

A **training trigger** is the condition that starts a training pipeline run. The condition can be a calendar schedule, a new data snapshot, a completed upstream job, a human click, an incident ticket, or a backfill request. The trigger answers a simple question: why should this training pipeline run now?

The previous article explained what the pipeline does after it starts. This article focuses on the start signal. That distinction matters. A strong pipeline can still cause waste or risk if it starts at the wrong time. A weekly forecast can train before labels arrive. An event-driven pipeline can train twice on the same snapshot. A manual trigger can skip required evidence if the team treats it as an emergency shortcut.

For beginners, training triggers usually fall into four groups:

| Trigger type | Plain-English meaning | Common fit |
|---|---|---|
| Scheduled | Start at a fixed time or cadence | Weekly forecasts, nightly refreshes, monthly compliance retraining |
| Event-based | Start when something happens | New snapshot, upstream feature table, registry approval, incident label batch |
| Manual | Start when a person requests a run | Hotfix retraining, experiments, one-off backfills |
| Hybrid | Start after multiple conditions match | Data arrived, labels are complete, budget is available, reviewer approved |

![FreshFleet hybrid training trigger](/content-assets/articles/article-mlops-training-pipelines-scheduled-vs-event-based-training/freshfleet-hybrid-trigger.png)
*FreshFleet uses a hybrid trigger because the business wants a weekly candidate, while the pipeline still needs a ready snapshot and an approved manual path.*

## Follow One Grocery Demand Forecast
<!-- section-summary: The running scenario follows a grocery forecast that needs weekly cadence plus safeguards around labels, promotions, and duplicate snapshots. -->

Imagine **FreshFleet Markets**, a regional grocery chain that predicts demand for each store and product for the next 14 days. The model is `store_sku_demand_forecast_v9`. It feeds replenishment orders, warehouse pick plans, and store manager dashboards. Bad timing causes real problems: stale forecasts lead to empty shelves, while a rushed retrain can learn from incomplete labels after a promotion.

FreshFleet receives sales events continuously. The training table closes every Sunday at `23:59 UTC`, but return adjustments and supplier substitutions land through Monday morning. Promotion calendars finalize on Monday by `10:00 UTC`. The replenishment team wants reviewed model candidates by Tuesday afternoon.

The trigger decision therefore has business shape:

```yaml
training_window:
  model_name: store_sku_demand_forecast
  cadence: weekly
  sales_window_end: "Sunday 23:59 UTC"
  label_ready_after: "Monday 10:00 UTC"
  forecast_review_deadline: "Tuesday 15:00 UTC"
  primary_trigger: "Monday 11:00 UTC schedule"
  event_gate: "demand_snapshot_ready"
  manual_backfill_owner: forecasting-platform
```

FreshFleet will use a hybrid trigger. A weekly schedule creates a predictable cadence. A data-ready gate checks that the snapshot and promotion calendar exist. A manual backfill path handles incidents and historical reruns.

## Use Scheduled Training For Stable Cadence
<!-- section-summary: Scheduled training fits models that need a predictable cadence aligned with business review and label readiness. -->

**Scheduled training** starts a pipeline at a known time. It works well when the business expects a regular model candidate and the data lifecycle is predictable. FreshFleet chooses Monday at `11:00 UTC` because the weekly sales window has closed, return adjustments have landed, and the promotion calendar should be ready.

Airflow supports scheduled DAG runs through the DAG `schedule` argument with cron strings, presets, or time intervals. A small Airflow wrapper can call the training pipeline:

```python
from datetime import datetime

from airflow.sdk import DAG
from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator


with DAG(
    dag_id="freshfleet_weekly_demand_training",
    schedule="0 11 * * MON",
    start_date=datetime(2026, 7, 6),
    catchup=False,
    tags=["ml", "training", "forecasting"],
) as dag:
    train = KubernetesPodOperator(
        task_id="run_demand_training_pipeline",
        namespace="ml-training",
        image="ghcr.io/freshfleet/demand-pipeline@sha256:ad19f054c8b0c9342d15b36a777c9a90a5fbd1b64c1dc7cbef41e9a6a9b6cd10",
        cmds=["python", "-m", "freshfleet.pipeline"],
        arguments=[
            "--config",
            "configs/demand_weekly.yaml",
            "--run-id",
            "{{ dag_run.run_id }}",
        ],
    )
```

The schedule tells Airflow when to create a run. The container image is pinned by digest so the run uses a fixed runtime. The `run_id` comes from the orchestrator so logs, artifacts, and pipeline state share one ID.

Scheduled training has three practical benefits:

- The business can plan review time because candidates arrive on a known cadence.
- Platform teams can reserve compute windows and watch costs.
- Backfills can use the same calendar idea with explicit dates.

It also needs guardrails. A schedule can fire even when data is late. That is why FreshFleet adds a data-ready check before training starts.

## Use Event-Based Training When Data Arrival Matters
<!-- section-summary: Event-based training starts after a specific upstream event, such as a snapshot completion message or file arrival. -->

**Event-based training** starts after something observable happens. For ML training, the event is often a data snapshot finishing, a file landing in object storage, an upstream feature job completing, or a human approval arriving from a review system.

FreshFleet publishes a `demand_snapshot_ready` event after the data platform writes the weekly snapshot manifest:

```json
{
  "event_type": "demand_snapshot_ready",
  "snapshot_id": "freshfleet-demand-2026-07-05-v3",
  "train_uri": "s3://freshfleet-ml/features/demand/snapshot_date=2026-07-05/train/",
  "validation_uri": "s3://freshfleet-ml/features/demand/snapshot_date=2026-07-05/valid/",
  "row_count": 912441302,
  "promotion_calendar_version": "promo-calendar-2026-w27-v2",
  "created_at": "2026-07-06T10:22:11Z"
}
```

An event-driven trigger can read this payload and start the pipeline with `snapshot_id` as a parameter. Prefect 3 deployments support schedules and event-based triggers through deployments and automations. A deployment can define where the flow runs, while an automation can create a run when the event appears.

```yaml
deployments:
  - name: demand-training-weekly
    entrypoint: flows/demand_training.py:demand_training_flow
    work_pool:
      name: kubernetes-ml-training
    parameters:
      config_uri: s3://freshfleet-ml/configs/demand_weekly.yaml
    schedules:
      - cron: "0 11 * * MON"
        timezone: "UTC"
        active: true
```

The deployment captures the workflow surface. The event payload can supply the snapshot ID at run time. FreshFleet still keeps the Monday schedule because the business wants a predictable run window. The event gate prevents the scheduled run from training on an absent or incomplete snapshot.

Dagster sensors provide another pattern. A sensor can check an external system at intervals, yield a `RunRequest` when a new snapshot appears, and use a run key to avoid duplicate runs for the same snapshot:

```python
import dagster as dg


demand_training_job = dg.define_asset_job("demand_training_job")


@dg.sensor(
    job=demand_training_job,
    minimum_interval_seconds=300,
    default_status=dg.DefaultSensorStatus.RUNNING,
)
def demand_snapshot_sensor(context):
    snapshot = find_latest_ready_snapshot()
    if snapshot is None:
        yield dg.SkipReason("No ready demand snapshot")
        return

    yield dg.RunRequest(
        run_key=snapshot.snapshot_id,
        run_config={
            "ops": {
                "train_demand_model": {
                    "config": {"snapshot_id": snapshot.snapshot_id}
                }
            }
        },
    )
```

The run key matters because it gives the sensor a stable duplicate guard. If the sensor sees the same snapshot five times, it should still create one training run.

## Add Label-Ready Gates
<!-- section-summary: A label-ready gate checks that the target, features, and business context exist before the pipeline spends training compute. -->

Many ML datasets are ready in pieces. Features may arrive first. Labels may arrive later. Business context such as promotions, weather, fraud chargebacks, or returns can arrive after the first event. A training trigger should respect that delay.

FreshFleet uses a label-ready gate before training starts:

```sql
SELECT
  snapshot_id,
  COUNT(*) AS rows,
  COUNTIF(actual_units_sold IS NULL) / COUNT(*) AS missing_label_rate,
  COUNTIF(promotion_id IS NULL AND promotion_expected = TRUE) AS missing_promotions,
  MAX(event_date) AS max_event_date
FROM warehouse.ml.demand_training_examples
WHERE snapshot_id = 'freshfleet-demand-2026-07-05-v3'
GROUP BY snapshot_id;
```

Expected result:

```console
snapshot_id                         rows       missing_label_rate  missing_promotions  max_event_date
freshfleet-demand-2026-07-05-v3     912441302  0.0008              0                   2026-07-05
```

The gate can use thresholds from the config:

```yaml
trigger_gates:
  max_missing_label_rate: 0.002
  max_missing_promotion_rows: 0
  min_rows: 850000000
  required_snapshot_status: ready
```

This gate protects the team from rushed retraining. A pipeline can start only when the snapshot is ready, labels meet the threshold, promotion context is present, and row counts look reasonable. If the gate fails, the pipeline should stop with a clear message and notify the owner.

![Label ready gate for demand training](/content-assets/articles/article-mlops-training-pipelines-scheduled-vs-event-based-training/label-ready-gate.png)
*The label-ready gate turns “is the data ready?” into specific checks that either start training or notify the owner with a clear reason.*

## Use Manual And Hybrid Triggers For Review Control
<!-- section-summary: Manual and hybrid triggers support backfills, incidents, and review approval while keeping the same evidence requirements as regular runs. -->

Manual triggers belong in the workflow because teams need backfills, incident retrains, and one-off tests. The key is that manual runs should use the same pipeline and evidence rules as scheduled runs. A manual run should still name a snapshot, config, run reason, owner, and budget tag.

FreshFleet uses this command for an approved backfill:

```bash
prefect deployment run demand-training-flow/demand-training-weekly \
  --param config_uri=s3://freshfleet-ml/configs/demand_weekly.yaml \
  --param snapshot_id=freshfleet-demand-2026-06-28-v2 \
  --param run_reason="Backfill after supplier substitution label correction." \
  --param owner=forecasting-platform
```

A hybrid trigger combines conditions:

```yaml
hybrid_trigger:
  name: weekly-demand-training
  start_when:
    schedule: "0 11 * * MON"
    required_event: demand_snapshot_ready
    required_gates:
      - label_ready
      - promotion_calendar_ready
      - budget_available
  manual_override:
    allowed_roles:
      - forecasting-platform-oncall
      - ml-platform-admin
    requires_reason: true
    requires_snapshot_id: true
```

This gives FreshFleet a practical operating policy. The default path runs weekly. The event and gates ensure the input is ready. The manual override exists for real incidents and backfills, with enough metadata for audit.

## Prevent Duplicate And Runaway Training
<!-- section-summary: Trigger design should prevent duplicate runs, overlapping full jobs, and repeated retries on bad inputs. -->

Training runs can cost money and consume scarce compute. Trigger design should prevent duplicates and runaway behavior. The most common problems are duplicate events for the same snapshot, schedules that overlap after a slow run, retries that keep using bad input, and manual runs that bypass budget checks.

FreshFleet uses these controls:

| Control | Example | Why it helps |
|---|---|---|
| Idempotency key | `snapshot_id` as run key | One completed run per snapshot |
| Concurrency limit | One full training run per model family | Prevents overlapping expensive jobs |
| Retry policy | Retry data check twice, train once | Avoids repeated training on bad config |
| Budget tag | `cost_center=forecasting` | Makes cloud cost review possible |
| Pause switch | `training_enabled=false` variable | Stops schedules during incidents |

The orchestrator can enforce some controls. The pipeline can enforce the rest. For example, the first stage can check whether a successful run already exists for the snapshot:

```python
def assert_snapshot_has_no_successful_run(snapshot_id: str, tracking_client) -> None:
    runs = tracking_client.search_runs(
        experiment_names=["freshfleet-demand-training"],
        filter_string=f"tags.snapshot_id = '{snapshot_id}' and attributes.status = 'FINISHED'",
    )
    if runs:
        raise RuntimeError(f"Snapshot already has a successful training run: {snapshot_id}")
```

This check saves money and keeps the registry clean. If a team needs to rerun intentionally, the manual run should use a new run reason such as `replay-after-config-fix` and record why it bypassed the duplicate guard.

![Trigger safety controls](/content-assets/articles/article-mlops-training-pipelines-scheduled-vs-event-based-training/trigger-safety-controls.png)
*Trigger controls protect the team from duplicate snapshots, overlapping full runs, repeated bad retries, and emergency runs with no audit trail.*

## Trigger Runbook
<!-- section-summary: A trigger runbook tells the on-call engineer how to pause, replay, investigate, and backfill training runs. -->

A trigger runbook should be short enough for the on-call engineer to use during a messy week. FreshFleet writes one for the demand forecast:

```yaml
runbook:
  normal_schedule:
    cadence: "Mondays 11:00 UTC"
    owner: forecasting-platform
    expected_duration: "90 minutes"
  pause_training:
    reason_examples:
      - upstream snapshot corruption
      - warehouse cost incident
      - label pipeline outage
    command: "prefect deployment schedule pause demand-training-flow/demand-training-weekly <schedule-id>"
  replay_snapshot:
    command: "prefect deployment run demand-training-flow/demand-training-weekly --param snapshot_id=<snapshot_id> --param run_reason=<reason>"
  duplicate_run_check:
    query: "Search tracking runs by tags.snapshot_id before manual rerun."
  escalation:
    slack: "#ml-platform-oncall"
    pager: "forecasting-platform-primary"
```

The runbook ties the trigger to operations. A team member can pause schedules, replay a snapshot, check for duplicates, and escalate without inventing a process during an incident.

## Putting It Together
<!-- section-summary: Good trigger design starts pipelines at the right time and preserves evidence around why each run happened. -->

A training trigger decides when a pipeline starts. FreshFleet uses a hybrid design because the forecast has a weekly business cadence and real data-readiness risk. The Monday schedule gives product and operations a predictable review rhythm. The snapshot event and label-ready gates protect the model from incomplete input. Manual triggers support backfills and incidents while keeping run reason, owner, snapshot, and evidence intact.

The next article looks at orchestration tools. The trigger decides when to run; the orchestrator tracks the workflow, retries, logs, assets, events, and operational surface while the run is in motion.

## References

- [Apache Airflow 3.2.2 Docs: Cron and time intervals](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/cron.html)
- [Apache Airflow Docs: Event-driven scheduling](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/event-scheduling.html)
- [Prefect 3 Docs: Deployments](https://docs.prefect.io/v3/concepts/deployments)
- [Prefect 3 Docs: Schedule flow runs](https://docs.prefect.io/v3/concepts/schedules)
- [Prefect 3 Docs: Automations](https://docs.prefect.io/v3/concepts/automations)
- [Dagster Docs: Schedules](https://docs.dagster.io/guides/automate/schedules)
- [Dagster Docs: Sensors](https://docs.dagster.io/guides/automate/sensors)
