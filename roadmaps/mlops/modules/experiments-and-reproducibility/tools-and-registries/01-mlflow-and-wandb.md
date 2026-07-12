---
title: "MLflow and W&B"
description: "Compare MLflow and Weights & Biases through practical experiment tracking, artifacts, reports, sweeps, collaboration, and registry handoff."
overview: "MLflow and Weights & Biases help teams preserve experiment evidence. This tutorial follows a grocery demand forecasting model through tracked runs, artifacts, reports, sweeps, collaboration review, and the handoff from experiment work to a registry."
tags: ["MLOps", "core", "production", "registry"]
order: 1
id: "article-mlops-experiments-and-reproducibility-mlflow-and-wandb"
---

## Table of Contents

1. [What MLflow And W&B Do](#what-mlflow-and-wb-do)
2. [The Forecasting Team Needs A Run Trail](#the-forecasting-team-needs-a-run-trail)
3. [Track The Same Training Job In MLflow](#track-the-same-training-job-in-mlflow)
4. [Track The Same Training Job In W&B](#track-the-same-training-job-in-wb)
5. [Artifacts, Reports, And Sweeps](#artifacts-reports-and-sweeps)
6. [How Teams Usually Choose](#how-teams-usually-choose)
7. [Registry Handoff](#registry-handoff)
8. [Operational Checks](#operational-checks)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## What MLflow And W&B Do
<!-- section-summary: MLflow and W&B record experiment evidence so a team can compare runs, preserve artifacts, explain choices, and hand a reviewed model to a registry. -->

**MLflow** and **Weights & Biases**, usually shortened to **W&B**, are experiment systems. They record what happened during model development: the code version, input data version, parameters, metrics, charts, files, notes, and model artifact that came out of a training run. They help you answer a simple production question: which model did we train, why did we trust it, and where is the evidence?

They overlap because both tools track runs and artifacts. They differ in the way teams tend to use them. MLflow often sits close to platform engineering, model packaging, open-source tracking servers, Databricks workflows, and registry handoff. W&B often sits close to collaborative research, rich charts, reports, hyperparameter sweeps, dataset/model artifacts, and review conversations across data science teams.

Imagine a grocery company called FreshCart. The company trains a demand forecasting model that predicts the next 14 days of sales for every store and product pair. A bad model over-orders berries in small stores, under-orders milk before holiday weekends, and leaves store managers explaining empty shelves. A good tracking setup gives the team evidence before the forecast reaches replenishment systems.

## The Forecasting Team Needs A Run Trail
<!-- section-summary: A run trail connects a training attempt to its data, parameters, metrics, artifacts, owner, and review decision. -->

The FreshCart team trains many forecasting candidates. One run uses LightGBM with weather features. Another adds promotion calendars. A third changes the loss function so high-volume items carry more weight. The team needs a trail that keeps those choices attached to the result, because the final discussion should use evidence instead of notebook memory.

An experiment run is one recorded training attempt. A practical run record should show the ingredients, the output, and the decision. If a director asks why `freshcart-demand-forecast:v42` reached the registry, the team should find the exact training table, feature code, metrics, plots, model file, and review notes without searching through old Slack threads.

For FreshCart, a useful run trail might include:

| Evidence | FreshCart example | Why the team needs it |
|---|---|---|
| Data version | `warehouse.ml.demand_training_2026_06_30` | Shows which historical sales and labels trained the model |
| Code version | `git_sha: 7f4a9c2` | Lets the team rebuild the training job later |
| Parameters | `max_depth=9`, `learning_rate=0.045` | Explains how this run differs from nearby runs |
| Metrics | `weighted_mape=0.083`, `stockout_risk_delta=-0.021` | Supports model comparison with product impact |
| Artifacts | `model.pkl`, `segment_metrics.csv`, `forecast_error_plot.png` | Gives reviewers files they can inspect and deploy |
| Decision | `candidate_for_registry=true` | Records the handoff from experimentation to release review |

That table is the job description for MLflow and W&B. A tracking tool gives each run a stable place where these facts live together. Without that place, the team has model files in object storage, metrics in notebooks, plots in screenshots, and decisions in chat history.

![FreshCart run trail connecting data version, code SHA, parameters, metrics, artifacts, and review decision.](/content-assets/articles/article-mlops-experiments-and-reproducibility-mlflow-and-wandb/freshcart-run-trail.png)
*FreshCart's run trail keeps the evidence reviewers need close to the candidate forecast model.*

## Track The Same Training Job In MLflow
<!-- section-summary: MLflow records parameters, metrics, tags, artifacts, models, and registry-ready metadata from a training run. -->

MLflow organizes runs under experiments. A training script can log parameters, metrics, tags, artifacts, and a model in a few lines of Python. The tracking server stores lightweight metadata in a backend store such as PostgreSQL, while larger artifacts usually land in object storage such as S3, ADLS, GCS, or a managed Databricks location.

Here is a simplified FreshCart training script that logs evidence to MLflow. The model training code is intentionally small here, because the important lesson is the tracking pattern around the training job.

```python
import mlflow
import mlflow.sklearn
from mlflow.models import infer_signature

from freshcart.data import load_training_frame
from freshcart.features import build_features
from freshcart.models import train_forecaster
from freshcart.reports import write_segment_report

mlflow.set_experiment("freshcart-demand-forecasting")

training_table = "warehouse.ml.demand_training_2026_06_30"
features_version = "demand_features_v12"
git_sha = "7f4a9c2"

df = load_training_frame(training_table)
X_train, X_valid, y_train, y_valid = build_features(df, version=features_version)
model, metrics = train_forecaster(
    X_train,
    y_train,
    X_valid,
    y_valid,
    max_depth=9,
    learning_rate=0.045,
)

segment_report_path = write_segment_report(model, X_valid, y_valid)
signature = infer_signature(X_valid.head(20), model.predict(X_valid.head(20)))

with mlflow.start_run(run_name="lgbm-store-sku-v42"):
    mlflow.log_params(
        {
            "algorithm": "lightgbm",
            "training_table": training_table,
            "features_version": features_version,
            "forecast_horizon_days": 14,
            "max_depth": 9,
            "learning_rate": 0.045,
        }
    )
    mlflow.log_metrics(
        {
            "weighted_mape": metrics.weighted_mape,
            "holiday_week_mape": metrics.holiday_week_mape,
            "stockout_risk_delta": metrics.stockout_risk_delta,
        }
    )
    mlflow.set_tags(
        {
            "git_sha": git_sha,
            "owner": "forecasting-platform",
            "candidate_reason": "lower holiday-week error for dairy and produce",
        }
    )
    mlflow.log_artifact(segment_report_path, artifact_path="evaluation")
    model_info = mlflow.sklearn.log_model(
        sk_model=model,
        name="model",
        input_example=X_valid.head(5),
        signature=signature,
    )
```

The run now has enough evidence for review. Parameters explain what changed. Metrics show the result. Tags add search and ownership metadata. The segment report gives reviewers a file they can open. The logged model includes a signature, which is important when the next system needs to know the expected input and output shape.

MLflow fits well when the platform team wants a tracking API that connects cleanly to packaging and registry workflows. A team can start locally, then point the same training code at a shared tracking server. In a larger company, that server usually sits behind access control and uses durable artifact storage, so experiment history survives laptops and notebook sessions.

## Track The Same Training Job In W&B
<!-- section-summary: W&B records runs, charts, artifacts, tables, reports, and sweeps with a strong collaboration workflow around experiment review. -->

W&B also records run evidence, and its strength shows up when many people need to compare experiments together. Teams use W&B runs for charts, config, metrics, artifacts, tables, notes, and reports. A forecasting team can compare every run in a dashboard, open a report that explains the preferred candidate, and review artifact lineage before a model moves forward.

Here is the same FreshCart idea using W&B. The code logs config, metrics, a model artifact, and aliases that mark the model as a candidate for review.

```python
import wandb

from freshcart.data import load_training_frame
from freshcart.features import build_features
from freshcart.models import train_forecaster
from freshcart.reports import write_segment_report, write_error_table

run = wandb.init(
    project="freshcart-demand-forecasting",
    job_type="train",
    config={
        "algorithm": "lightgbm",
        "training_table": "warehouse.ml.demand_training_2026_06_30",
        "features_version": "demand_features_v12",
        "forecast_horizon_days": 14,
        "max_depth": 9,
        "learning_rate": 0.045,
        "git_sha": "7f4a9c2",
    },
)

df = load_training_frame(run.config["training_table"])
X_train, X_valid, y_train, y_valid = build_features(
    df,
    version=run.config["features_version"],
)
model, metrics = train_forecaster(
    X_train,
    y_train,
    X_valid,
    y_valid,
    max_depth=run.config["max_depth"],
    learning_rate=run.config["learning_rate"],
)

segment_report_path = write_segment_report(model, X_valid, y_valid)
error_table = write_error_table(model, X_valid, y_valid)

wandb.log(
    {
        "weighted_mape": metrics.weighted_mape,
        "holiday_week_mape": metrics.holiday_week_mape,
        "stockout_risk_delta": metrics.stockout_risk_delta,
        "error_by_store_type": wandb.Table(dataframe=error_table),
    }
)

artifact = wandb.Artifact(
    name="freshcart-demand-forecast",
    type="model",
    metadata={
        "model_version_intent": "candidate",
        "training_table": run.config["training_table"],
        "features_version": run.config["features_version"],
    },
)
artifact.add_file("models/model.pkl")
artifact.add_file(segment_report_path, name="evaluation/segment_metrics.csv")
run.log_artifact(artifact, aliases=["candidate", "sku-store-v42"])
run.finish()
```

The W&B run gives the team a visual workspace around the experiment. The forecasting lead can sort runs by `weighted_mape`, inspect the table of forecast errors, open the artifact lineage, and add notes in a report. A product manager can read the report without running the notebook, which matters when model review includes business tradeoffs such as shelf availability and waste.

W&B artifacts are useful because they version the inputs and outputs of runs. FreshCart can store a training dataset artifact, a validation slice artifact, and a model artifact. When someone opens the model artifact later, they can see which run produced it and which data artifact fed the run.

## Artifacts, Reports, And Sweeps
<!-- section-summary: Artifacts preserve files, reports explain decisions, and sweeps automate repeated experiment runs across parameter choices. -->

Run tracking answers what happened during one training attempt. The next layer is comparison. FreshCart wants to know whether deeper trees help holiday promotions, whether weather features help produce, and whether the gains hold across small rural stores. This is where artifacts, reports, and sweeps turn scattered experiments into a review workflow.

An **artifact** is a versioned file or group of files attached to a run. A model artifact might include `model.pkl`, `feature_order.json`, `requirements.txt`, and `evaluation/segment_metrics.csv`. A dataset artifact might include a training table export, a schema digest, or a pointer to a warehouse snapshot. The exact storage layout depends on the platform, yet the goal is stable: reviewers need to connect model files to the run evidence that produced them.

A **report** is the human explanation around the evidence. A FreshCart W&B report might compare the best five runs, show forecast error by department, and explain why `sku-store-v42` helps dairy replenishment while keeping bakery waste inside the allowed range. MLflow teams often write similar review notes in a pull request, model card, registry description, or internal release ticket.

A **sweep** is an automated set of experiment runs over a parameter search space. W&B has a first-class sweep workflow, while MLflow teams often run sweeps through orchestration tools such as Ray Tune, Optuna, Airflow, Databricks Workflows, or Kubernetes Jobs and log each run to MLflow. The useful habit is the same: each trial needs a tracked run with parameters, metrics, and artifacts.

```yaml
method: bayes
metric:
  name: weighted_mape
  goal: minimize
parameters:
  max_depth:
    values: [6, 8, 10, 12]
  learning_rate:
    min: 0.02
    max: 0.12
  min_child_samples:
    values: [20, 50, 100]
  promotion_feature_window_days:
    values: [7, 14, 28]
```

This sweep config teaches the tool what to vary and what to optimize. The forecasting team still reviews the results carefully, because the lowest overall error may hide weak performance in a region or product family. A mature workflow logs segment metrics and keeps the candidate decision separate from the search result.

![FreshCart artifacts, reports, and sweeps feeding one review packet.](/content-assets/articles/article-mlops-experiments-and-reproducibility-mlflow-and-wandb/freshcart-trials-to-review.png)
*Artifacts preserve files, reports explain the tradeoff, and sweeps create the comparison set for FreshCart's review packet.*

## How Teams Usually Choose
<!-- section-summary: Tool choice follows workflow needs around hosting, collaboration, artifact lineage, managed platforms, and registry integration. -->

You can use either tool well, and many companies use more than one tracking surface. The choice should follow the team workflow. A small research team may care most about fast charts and collaborative reports. A platform team may care most about self-hosting, packaging conventions, and registry APIs. A cloud-centered team may use the registry built into SageMaker, Vertex AI, Azure ML, or Databricks while still tracking experiments in MLflow or W&B.

Here is a practical comparison for the FreshCart team:

| Workflow need | MLflow fit | W&B fit |
|---|---|---|
| Basic run tracking | Strong Python API, experiments, runs, params, metrics, tags, artifacts | Strong run dashboard, config, metrics, charts, notes, artifacts |
| Artifact lineage | Tracks artifacts per run and supports model packaging | Strong artifact versioning and lineage across runs, datasets, and models |
| Collaboration | Works well with platform conventions, notebooks, PRs, and registry review | Strong reports, dashboards, tables, and team review workflows |
| Sweeps | Usually paired with an external tuner or orchestrator | First-class sweep workflow with charts and reports |
| Registry handoff | Built-in Model Registry, aliases, tags, model versions | W&B Registry and artifact collections; can also hand off to MLflow or managed cloud registries |
| Hosting and control | Open-source server and managed Databricks patterns are common | SaaS and enterprise patterns are common, with strong product collaboration features |

FreshCart might choose W&B for active forecasting research because charts, tables, reports, and sweeps help the team discuss model behavior. The same company might use MLflow or Databricks Unity Catalog for the final model registry because the serving platform already reads MLflow model URIs. Another company might use only MLflow, or only W&B, if that gives the cleanest path from training to release.

The important engineering rule is to avoid splitting the evidence in a way that breaks the story. If W&B stores the report and MLflow stores the registry version, the registry entry should link back to the W&B run and artifact. If MLflow stores the run and SageMaker stores the approved package, the SageMaker model package should keep the run ID, data version, and evaluation report URI.

## Registry Handoff
<!-- section-summary: A registry handoff turns the best reviewed run into a named model version with aliases, owners, and release evidence. -->

Experiment tracking creates many runs. A model registry creates a smaller set of controlled model versions. FreshCart may run 200 sweep trials, shortlist five candidates, and register one model version for shadow testing. That handoff is the point where experiment evidence enters the release path.

With MLflow, the handoff can register a logged model and attach aliases or tags. The exact URI depends on the MLflow version and platform, so teams should standardize this in a release script rather than copying notebook cells.

```python
import mlflow
from mlflow import MlflowClient

client = MlflowClient()

registered = mlflow.register_model(
    model_uri="models:/m-3f2d8a1c7b9849a9a21f0c5d7b2c1b60",
    name="freshcart-demand-forecast",
)

client.set_model_version_tag(
    name="freshcart-demand-forecast",
    version=registered.version,
    key="source_run",
    value="lgbm-store-sku-v42",
)
client.set_model_version_tag(
    name="freshcart-demand-forecast",
    version=registered.version,
    key="approval_packet",
    value="s3://freshcart-ml-reviews/demand/v42/review.yml",
)
client.set_registered_model_alias(
    name="freshcart-demand-forecast",
    alias="candidate",
    version=registered.version,
)
```

With W&B, the handoff often links a logged artifact version to a registry collection, adds aliases, and uses automation or CI to notify the next release step. If another registry owns deployment, the W&B artifact should still carry the external registry version after handoff.

```yaml
registry_handoff:
  tracked_in: wandb
  project: freshcart-demand-forecasting
  source_run: lgbm-store-sku-v42
  model_artifact: freshcart-demand-forecast:v17
  linked_collection: Models/FreshCart Demand Forecast
  aliases:
    - candidate
  external_registry:
    type: mlflow
    registered_model: freshcart-demand-forecast
    version: 42
```

The registry handoff should be boring and repeatable. The reviewer should see the model name, version, source run, artifact URI, metrics, segment report, owner, and intended next stage. That record keeps release decisions from relying on screenshots or memory.

![FreshCart tracked run and review packet moving into a registry candidate version.](/content-assets/articles/article-mlops-experiments-and-reproducibility-mlflow-and-wandb/freshcart-registry-handoff.png)
*The registry candidate should still point back to the tracked run, review packet, data version, metrics, owner, and segment report.*

## Operational Checks
<!-- section-summary: A tracking setup is healthy when reviewers can reproduce the evidence, compare runs, find artifacts, and follow the model into the registry. -->

Experiment tools help only when the team uses them consistently. FreshCart should treat a missing run record like a failed build. If a training job creates a candidate model without run metadata, the release should pause until the evidence is fixed.

Use a short review checklist before a candidate reaches the registry:

| Check | Healthy evidence |
|---|---|
| Run identity | Experiment name, run ID, owner, code SHA, training job URL |
| Data evidence | Training table or dataset artifact, schema digest, label cutoff date |
| Metrics | Overall metrics plus segment metrics for store type, region, product family, and holiday weeks |
| Artifacts | Model file, input signature, feature order, dependency file, evaluation report |
| Collaboration | Report or review packet that explains the tradeoff and names reviewers |
| Registry link | Candidate model version points back to the tracking run and artifact |

The team should also test search and recovery. Can a new engineer find the run from only the registry version? Can the release owner download the artifact? Can the reviewer see which dataset trained it? Can the team compare the candidate against the current production version? These checks sound simple, and they catch the most painful tracking gaps before an incident.

## Putting It Together
<!-- section-summary: MLflow and W&B both preserve experiment evidence, and the better choice is the one that keeps your team review and registry handoff clear. -->

MLflow and W&B both help you keep experiment work visible and reviewable. MLflow often shines when tracking, packaging, model registry, and platform integration need one open workflow. W&B often shines when collaboration, dashboards, reports, sweeps, tables, and artifact lineage are central to the team's daily work.

For FreshCart, the real goal is a trustworthy run trail. The forecasting team should know which data trained the model, which parameters changed, which metrics moved, which artifact came out, which reviewer approved the candidate, and which registry version points back to the evidence. Once that trail is in place, the next article can focus on the registry itself: the controlled catalog where reviewed model versions live.

## References

- [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) - Official MLflow guide for experiments, runs, metrics, parameters, and artifacts.
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) - Official MLflow guide for registered models, versions, aliases, tags, and model metadata.
- [MLflow Model Signatures](https://mlflow.org/docs/latest/ml/model/signatures/) - Official MLflow guide for input examples and signatures used during model logging and registration.
- [Weights & Biases Models](https://docs.wandb.ai/models) - Official W&B overview for experiment tracking, sweeps, model management, lineage, and model CI/CD workflows.
- [W&B Artifacts](https://docs.wandb.ai/models/artifacts) - Official W&B guide for versioning datasets, models, and other run inputs or outputs.
- [W&B Reports](https://docs.wandb.ai/models/reports) - Official W&B guide for collaborative experiment reports.
- [W&B Sweeps](https://docs.wandb.ai/models/sweeps) - Official W&B guide for hyperparameter search and sweep visualization.
- [W&B Registry](https://docs.wandb.ai/models/registry) - Official W&B guide for registry collections, artifact versions, governance, and automation.
