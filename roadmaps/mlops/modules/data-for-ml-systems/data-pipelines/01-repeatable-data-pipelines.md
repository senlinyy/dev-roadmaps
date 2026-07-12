---
title: "Repeatable Data Pipelines"
description: "Show how data preparation turns into a versioned, rerunnable workflow."
overview: "A repeatable data pipeline turns changing source data into validated ML-ready datasets through fixed inputs, reviewed steps, declared outputs, and run records. This article follows a grocery forecasting team as they move from notebook preparation to a DVC-backed pipeline with data checks and operational review."
tags: ["MLOps", "production", "pipelines"]
order: 1
id: "article-mlops-data-for-ml-systems-repeatable-data-pipelines"
---

## Table of Contents

1. [A Pipeline Gives Dataset Builds A Recipe](#a-pipeline-gives-dataset-builds-a-recipe)
2. [Follow One Grocery Forecasting Team](#follow-one-grocery-forecasting-team)
3. [Name The Inputs And The Time Window](#name-the-inputs-and-the-time-window)
4. [Turn Notebook Steps Into Pipeline Stages](#turn-notebook-steps-into-pipeline-stages)
5. [Validate The Dataset Before Training](#validate-the-dataset-before-training)
6. [Record The Run And Publish The Output](#record-the-run-and-publish-the-output)
7. [Operate Reruns, Backfills, And Incidents](#operate-reruns-backfills-and-incidents)
8. [Putting It Together](#putting-it-together)
9. [What's Next](#whats-next)
10. [References](#references)

## A Pipeline Gives Dataset Builds A Recipe
<!-- section-summary: A repeatable data pipeline gives an ML dataset a reviewed recipe, fixed inputs, declared outputs, validation checks, and a run record. -->

A **repeatable data pipeline** is a workflow that builds a dataset the same planned way each time. It names the source data, accepts parameters such as date windows, runs ordered transformation steps, validates the result, writes a versioned output, and records what happened. For an ML team, this turns dataset creation from a notebook memory into a recipe another person can inspect, run, and debug.

You need this as soon as a model result matters beyond one experiment. A notebook can answer, "Can this feature help?" A repeatable pipeline answers, "Which exact examples trained the model, which code prepared them, which checks passed, and can we rerun that build next month?" That second question is the production question.

Think about a demand forecasting model for a grocery chain. The model predicts how many baskets of strawberries, tomatoes, and salad kits each store will sell tomorrow. If the dataset build quietly changes because a promotion table arrives late, the model may learn the wrong relationship between discounts and demand. If the team can rerun the pipeline with the same inputs and see the same output, the team can trust comparisons between model versions.

The spine for this article is simple: a familiar dataset problem, a plain definition, the pieces of the workflow, a concrete DVC-style pipeline, and the checks that keep reruns safe.

## Follow One Grocery Forecasting Team
<!-- section-summary: The running scenario follows a grocery forecasting team that needs reliable datasets from messy daily source data. -->

Imagine **RiverCart Grocers**, a regional grocery delivery company with 85 stores and a small ML team. The team owns a demand model called `fresh-demand-forecast`. Store managers use the forecast to order perishable items before the morning supplier cutoff. A bad forecast can waste food, create empty shelves, or push shoppers toward substitutions they dislike.

The dataset combines several sources. The point-of-sale table has basket line items. The catalog table says which SKU belongs to produce, dairy, bakery, or frozen food. The promotion calendar records discounts and front-page placements. The inventory table reports stockouts. A weather feed gives temperature and rainfall by store region. The label is the next-day units sold for each `(store_id, sku_id, forecast_date)` pair.

In early exploration, Maya, the data scientist, created the dataset in a notebook. She loaded a few SQL extracts, joined them, filled missing weather values, removed days with store closures, and wrote `train.parquet`. That helped the team prove the model idea. Then the model started winning review meetings, and the notebook turned into a risk. Nobody could tell whether last week's model used the old promotion join, the new closure filter, or a local CSV Maya had downloaded during debugging.

The team decides to turn the preparation into a repeatable pipeline. Their first production goal is modest: build one training dataset for a requested date range, validate it, save a manifest, and let training reference the output by version. They can add orchestration, lineage, and richer backfills later, but the recipe needs to exist first.

## Name The Inputs And The Time Window
<!-- section-summary: Repeatable pipelines start by making source tables, date windows, label delays, and ownership explicit. -->

The first step is naming inputs clearly. A pipeline input is any external thing the build reads: a warehouse table, a file prefix, a model artifact, a parameter file, a feature definition, or a secrets-free config. If a value changes the output dataset, it deserves a name in the pipeline record.

RiverCart starts with a config file. The point of the file is plain: the dataset build should read parameters from a reviewed place rather than hidden notebook variables.

```yaml
pipeline:
  name: build_fresh_demand_examples
  owner: demand-ml@rivercart.example
  purpose: "Training data for next-day fresh grocery demand forecasting."

window:
  start_date: "2026-05-01"
  end_date: "2026-06-30"
  label_delay_days: 2

sources:
  sales_lines: warehouse.retail.sales_lines
  product_catalog: warehouse.retail.product_catalog
  promotion_calendar: warehouse.marketing.promotion_calendar
  inventory_snapshots: warehouse.supply.inventory_snapshots
  store_weather_daily: warehouse.external.store_weather_daily

output:
  dataset_name: fresh_demand_examples
  dataset_version: "2026-06-30-v1"
  path: s3://rivercart-ml/datasets/fresh-demand/2026-06-30-v1/
```

There are two timing details worth slowing down for. The **event date** is the date the example describes, such as the day RiverCart wants to forecast demand for a store and SKU. The **label delay** is the waiting period before the team trusts the true sales label. If sales corrections and refunds keep changing for two days, the pipeline should build June 30 labels after July 2. This prevents the model from training on labels that still move.

The source list also makes ownership visible. If `promotion_calendar` changes shape, the data platform team and the marketing analytics team both know which ML pipeline may break. A source list sounds boring, but it is often the fastest way to reduce production confusion.

## Turn Notebook Steps Into Pipeline Stages
<!-- section-summary: Pipeline stages split the dataset build into reviewed commands with dependencies, outputs, and parameters. -->

After the inputs are explicit, the team can split the notebook into stages. A **stage** is one named unit of work inside the pipeline, such as extracting source rows, joining features, creating labels, validating the output, or writing the manifest. The stage should have a clear command, clear dependencies, and clear outputs.

DVC is one practical tool for this style of work. DVC stores pipeline structure in `dvc.yaml`, records the resolved run state in `dvc.lock`, and can rerun changed stages with `dvc repro`. The official DVC docs describe stages with `cmd`, `deps`, `params`, and `outs`, which maps nicely to ML dataset preparation.

RiverCart's first `dvc.yaml` can look like this:

```yaml
stages:
  extract_sources:
    cmd: python pipelines/fresh_demand/extract_sources.py --config configs/fresh_demand.yaml
    deps:
      - pipelines/fresh_demand/extract_sources.py
      - configs/fresh_demand.yaml
    outs:
      - data/interim/fresh_demand/raw_sales.parquet
      - data/interim/fresh_demand/raw_promotions.parquet
      - data/interim/fresh_demand/raw_inventory.parquet
      - data/interim/fresh_demand/raw_weather.parquet

  build_examples:
    cmd: python pipelines/fresh_demand/build_examples.py --config configs/fresh_demand.yaml
    deps:
      - pipelines/fresh_demand/build_examples.py
      - configs/fresh_demand.yaml
      - data/interim/fresh_demand/raw_sales.parquet
      - data/interim/fresh_demand/raw_promotions.parquet
      - data/interim/fresh_demand/raw_inventory.parquet
      - data/interim/fresh_demand/raw_weather.parquet
    outs:
      - data/processed/fresh_demand/examples.parquet

  validate_examples:
    cmd: python pipelines/fresh_demand/validate_examples.py --config configs/fresh_demand.yaml
    deps:
      - pipelines/fresh_demand/validate_examples.py
      - data/processed/fresh_demand/examples.parquet
    outs:
      - reports/fresh_demand/validation.json

  publish_manifest:
    cmd: python pipelines/fresh_demand/publish_manifest.py --config configs/fresh_demand.yaml
    deps:
      - pipelines/fresh_demand/publish_manifest.py
      - data/processed/fresh_demand/examples.parquet
      - reports/fresh_demand/validation.json
    outs:
      - manifests/fresh_demand/2026-06-30-v1.yaml
```

The important habit is that each stage rewrites its output from its declared inputs. The extract stage produces raw snapshots for the requested window. The build stage creates one ML-ready table. The validation stage writes a machine-readable report. The manifest stage records the dataset identity. The command line could run inside CI, an Airflow task, a Dagster asset, a Prefect flow, or a Kubernetes Job. DVC gives the small team a local and CI-friendly starting point before a heavier orchestrator enters the picture.

The team can run the whole recipe with a command like this:

```bash
dvc repro
```

The run should update `dvc.lock` when inputs, parameters, code, or outputs change. That lock file is valuable because it records the concrete state DVC used for the pipeline. The Git commit now ties together the code, config, pipeline structure, and lock record.

![Repeatable pipeline recipe from sources and config through stages to a validated dataset](/content-assets/articles/article-mlops-data-for-ml-systems-repeatable-data-pipelines/repeatable-pipeline-recipe.png)
*The pipeline recipe makes each dataset build visible: named sources enter through config, ordered stages transform them, and the output is a checked dataset.*

## Validate The Dataset Before Training
<!-- section-summary: Validation checks catch schema drift, timing mistakes, missing values, row-count jumps, and label problems before a model trains. -->

A repeatable pipeline needs validation before training picks up the dataset. Validation is the part of the workflow that says, "This output matches the contract we expect." A data contract for ML usually covers schema, freshness, null rates, accepted value ranges, row counts, duplicate keys, label maturity, and distribution changes.

RiverCart uses two levels of checks. The SQL layer checks warehouse facts before extraction, and the Python layer checks the final dataframe. dbt data tests are a common way to express warehouse checks because generic tests such as `not_null`, `unique`, and `accepted_values` live beside the transformed models. For highly specific ML checks, the team can add singular SQL tests.

```sql
select
  store_id,
  sku_id,
  forecast_date,
  count(*) as rows_per_key
from {{ ref('fresh_demand_examples') }}
group by 1, 2, 3
having count(*) > 1
```

This test returns rows that violate the unique training key. A passing test returns zero rows. That is a nice convention for CI because the result has a clear meaning and it can show the exact keys that failed.

For dataframe checks, Pandera gives the team a Python schema that can run in the pipeline and in unit tests. The schema below keeps the example tight while still showing real ML constraints.

```python
import pandera.pandas as pa
from pandera.typing import Series


class FreshDemandExamples(pa.DataFrameModel):
    store_id: Series[str] = pa.Field(str_length={"min_value": 3})
    sku_id: Series[str] = pa.Field(str_length={"min_value": 5})
    forecast_date: Series[pa.DateTime]
    units_sold_next_day: Series[int] = pa.Field(ge=0, le=5000)
    on_promotion: Series[bool]
    price: Series[float] = pa.Field(gt=0, le=200)
    inventory_on_hand: Series[int] = pa.Field(ge=0)
    temperature_c: Series[float] = pa.Field(ge=-40, le=55)


def validate_examples(df):
    validated = FreshDemandExamples.validate(df, lazy=True)
    duplicate_keys = validated.duplicated(["store_id", "sku_id", "forecast_date"]).sum()
    if duplicate_keys:
        raise ValueError(f"duplicate training keys: {duplicate_keys}")
    return validated
```

Great Expectations can play a similar role when a team wants expectation suites, validation definitions, checkpoints, actions, and Data Docs. The current GX Core docs describe a workflow of setting up a data context, connecting to data, defining expectations, and running validations. RiverCart might choose GX for production reporting and Pandera for smaller dataframe-level unit tests. The tool choice matters less than the contract. Training should only start after the dataset passes the required checks.

![Validation gate checking schema, freshness, unique keys, label delay, and row count before training](/content-assets/articles/article-mlops-data-for-ml-systems-repeatable-data-pipelines/repeatable-validation-gate.png)
*A validation gate turns quality rules into a visible handoff: training starts only after the dataset clears the checks that protect the model.*

## Record The Run And Publish The Output
<!-- section-summary: A dataset run record ties the output path to code, parameters, validation results, row counts, and source freshness. -->

Once the pipeline has built and validated the dataset, it should publish a run record. A **run record** is the receipt for one execution of the pipeline. It tells future teammates which commit ran, which config values were used, which output was written, and which validation report approved the output.

RiverCart writes a manifest beside the dataset:

```yaml
dataset:
  name: fresh_demand_examples
  version: "2026-06-30-v1"
  path: s3://rivercart-ml/datasets/fresh-demand/2026-06-30-v1/
  format: parquet
  primary_key:
    - store_id
    - sku_id
    - forecast_date

build:
  run_id: fresh-demand-build-2026-07-03-0315
  git_commit: 4f98aa7c9f2d
  dvc_lock_digest: sha256:0fd65f1b0e84c72a
  config_file: configs/fresh_demand.yaml
  started_at_utc: "2026-07-03T03:15:08Z"
  finished_at_utc: "2026-07-03T03:41:22Z"

contents:
  row_count: 12988420
  store_count: 85
  sku_count: 4129
  date_min: "2026-05-01"
  date_max: "2026-06-30"
  positive_sales_rate: 0.734

validation:
  status: passed
  report: reports/fresh_demand/validation.json
  duplicate_keys: 0
  missing_weather_rate: 0.0018
  max_label_date: "2026-06-30"
```

This manifest gives the training pipeline something stable to reference. Instead of training from "the fresh demand table," the model trains from `fresh_demand_examples:2026-06-30-v1`. The distinction matters during review. If a candidate model improves forecast accuracy, the team can show the exact dataset version behind that score.

The pipeline can also write a small summary row to a dataset catalog table:

```sql
insert into ml_catalog.dataset_versions (
  dataset_name,
  dataset_version,
  path,
  git_commit,
  row_count,
  validation_status,
  created_at_utc
)
values (
  'fresh_demand_examples',
  '2026-06-30-v1',
  's3://rivercart-ml/datasets/fresh-demand/2026-06-30-v1/',
  '4f98aa7c9f2d',
  12988420,
  'passed',
  current_timestamp
);
```

A catalog row helps dashboards, review packets, training jobs, and incident queries all find the same dataset identity.

## Operate Reruns, Backfills, And Incidents
<!-- section-summary: Production teams need a policy for normal reruns, historical backfills, failed checks, and emergency dataset rollback. -->

The daily production work starts after the first clean run. A repeatable pipeline should have a small operating policy so the team knows what to do on normal days and during incidents.

RiverCart uses three run types. A **scheduled run** builds the latest approved training window. A **rerun** rebuilds the same dataset version after an infrastructure failure, such as a worker crash before publish. A **backfill** rebuilds older windows after source data or logic changes. Each run type needs a reason, an owner, and a publish rule.

The backfill rule is the most important one. Say the promotion calendar had missing front-page placement flags for two weeks in June. The team should avoid silently overwriting `2026-06-30-v1`. They should create `2026-06-30-v2`, record why it exists, and compare validation metrics against the original.

```yaml
backfill_request:
  dataset_name: fresh_demand_examples
  original_version: "2026-06-30-v1"
  corrected_version: "2026-06-30-v2"
  reason: "Marketing fixed missing front-page placement flags for 2026-06-10..2026-06-24."
  requested_by: demand-ml-oncall
  review_required:
    - row_count_delta_pct
    - promotion_feature_delta_pct
    - top_sku_forecast_error_replay
```

Operational checks should be easy to read in an on-call handoff:

| Check | Healthy signal | Owner |
|---|---|---|
| Source freshness | All source extracts cover the requested end date | Data platform |
| Row count | Change stays inside reviewed threshold | ML platform |
| Duplicate keys | Zero duplicate `(store_id, sku_id, forecast_date)` rows | Demand ML |
| Label maturity | Latest label date respects the delay window | Demand ML |
| Distribution drift | Price, promotion, inventory, and weather shifts have explanations | Demand ML and analytics |
| Publish atomicity | Dataset path and manifest appear together | ML platform |

The incident path starts from evidence. If a model trained on `2026-06-30-v1` starts over-ordering strawberries, the team checks the model run, finds the dataset version, opens the manifest, reads the validation report, and compares it with the corrected backfill. That is the practical value of repeatability: the team has a path through the dataset build rather than a hunt through notebooks and chat messages.

## Putting It Together
<!-- section-summary: Repeatable pipelines make dataset builds inspectable, rerunnable, validated, and ready for later versioning and lineage work. -->

A repeatable data pipeline gives ML data a production recipe. It declares inputs and time windows, turns notebook logic into ordered stages, validates the output, records the run, and publishes a stable dataset identity. DVC is one lightweight way to express the pipeline and rerun changed stages. dbt, Pandera, and Great Expectations can cover different layers of validation. The same ideas also fit Airflow, Dagster, Prefect, Spark, and warehouse-native jobs.

For RiverCart, the win is practical. The team can build `fresh_demand_examples:2026-06-30-v1`, show which code and source data produced it, and rebuild or backfill it with a clear review trail. That gives model training a stable input and gives incidents a place to start.

![Run record tying dataset version, Git commit, DVC lock, validation report, and owner to a published dataset](/content-assets/articles/article-mlops-data-for-ml-systems-repeatable-data-pipelines/repeatable-run-record.png)
*The run record is the receipt: it connects the published dataset to the code, lockfile, validation report, and owner that produced it.*

## What's Next
<!-- section-summary: The next article adds durable dataset identity and lineage so each model can point back to the data that trained it. -->

The next step is dataset versioning and lineage. A repeatable pipeline creates the dataset; versioning gives the output a durable identity, and lineage connects that identity to source tables, pipeline runs, training runs, and model releases.

## References

- [DVC documentation: dvc.yaml files](https://doc.dvc.org/user-guide/project-structure/dvcyaml-files)
- [DVC command reference: repro](https://doc.dvc.org/command-reference/repro)
- [dbt documentation: data tests](https://docs.getdbt.com/docs/build/data-tests)
- [Pandera documentation: DataFrame Models](https://pandera.readthedocs.io/en/stable/dataframe_models.html)
- [Great Expectations documentation: GX Core overview](https://docs.greatexpectations.io/docs/core/introduction/gx_overview/)
