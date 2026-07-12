---
title: "Testing ML Pipelines"
description: "Explain tests for data transforms, training code, and pipeline behavior."
overview: "Learn how to test ML pipelines at the code, data, training, and pipeline-behavior layers before a bad change reaches expensive jobs or production models."
tags: ["MLOps", "production", "ci-cd"]
order: 1
id: "article-mlops-mlops-infrastructure-testing-ml-code-and-pipelines"
---

## Why ML Pipeline Tests Need More Than Unit Tests
<!-- section-summary: Testing an ML pipeline is different from testing a small web function. You still test Python functions, SQL transforms, and API clients, but the pipeline can fail even when... -->

Testing an ML pipeline is different from testing a small web function. You still test Python functions, SQL transforms, and API clients, but the pipeline can fail even when every function imports. A feature column can silently change units. A join can multiply rows. A training job can finish with a model that has terrible recall for the segment that matters most. A pipeline can run in the wrong order and publish a model trained on yesterday's labels.

Think about a company called `FleetLens` that predicts which delivery vans need maintenance next week. The pipeline reads telematics events, joins them with repair tickets, creates rolling features, trains a gradient boosting model, evaluates by vehicle type, registers a candidate model, and publishes batch scores. If a developer changes the tire-pressure transform, a normal unit test may pass while the fleet operations team loses trust in every prediction.

You want a layered test suite:

- Fast code tests for pure functions and feature transforms.
- Data contract tests for schemas, missing values, ranges, and uniqueness.
- Training smoke tests that run on a tiny dataset.
- Evaluation tests that block weak candidates.
- Pipeline tests that check task wiring, artifact names, and promotion gates.
- Production replay tests for scary historical cases.

The goal is early, cheap feedback. A pull request should catch obvious issues in minutes, long before a GPU job, Spark cluster, or managed training service burns money.

![FleetLens ML pipeline test layers](/content-assets/articles/article-mlops-mlops-infrastructure-testing-ml-code-and-pipelines/fleetlens-test-layers.png)
*FleetLens uses several cheap test layers so a pull request can catch feature, data, training, graph, and report problems before a costly run starts.*

## Test The Transform Before The Model
<!-- section-summary: Most production model failures start in the data path. If you only test final metrics, you find data bugs late and with weak clues. Test transforms close to the code that... -->

Most production model failures start in the data path. If you only test final metrics, you find data bugs late and with weak clues. Test transforms close to the code that creates each feature.

Here is a tiny transform for FleetLens:

```python
import pandas as pd


def add_pressure_features(events: pd.DataFrame) -> pd.DataFrame:
    events = events.copy()
    events["pressure_delta"] = events["recommended_psi"] - events["measured_psi"]
    events["under_pressure_flag"] = (events["pressure_delta"] >= 7).astype(int)
    return events
```

A useful unit test checks behavior that matters to the model, rather than only checking that a column exists:

```python
import pandas as pd
from fleetlens.features import add_pressure_features


def test_under_pressure_flag_uses_recommended_minus_measured():
    events = pd.DataFrame(
        {
            "vehicle_id": ["van-7", "van-8"],
            "recommended_psi": [44, 44],
            "measured_psi": [35, 43],
        }
    )

    actual = add_pressure_features(events)

    assert actual["pressure_delta"].tolist() == [9, 1]
    assert actual["under_pressure_flag"].tolist() == [1, 0]
```

That test catches a common bug: reversing the subtraction. It also documents the business rule in a way a new teammate can understand.

## Validate Data Contracts
<!-- section-summary: Data contracts describe what the pipeline expects at a boundary. They are useful at ingestion, after joins, before training, and before publishing scores. -->

Data contracts describe what the pipeline expects at a boundary. They are useful at ingestion, after joins, before training, and before publishing scores.

For local pandas-heavy projects, `pandera` gives you a readable schema:

```python
import pandera as pa
from pandera.typing import Series


class TelematicsBatch(pa.DataFrameModel):
    vehicle_id: Series[str] = pa.Field(str_length={"min_value": 1})
    event_ts: Series[pa.DateTime]
    measured_psi: Series[float] = pa.Field(ge=0, le=120)
    recommended_psi: Series[float] = pa.Field(ge=20, le=80)
    odometer_miles: Series[float] = pa.Field(ge=0)


def validate_telematics(df):
    return TelematicsBatch.validate(df, lazy=True)
```

For warehouse-scale validation, teams often use Great Expectations checkpoints or TensorFlow Data Validation. The shape is the same: define expectations, run them inside the pipeline, store results, and fail the run if the data breaks a release-critical rule.

Example expectations for a training table:

```yaml
expectations:
  - column: vehicle_id
    rule: values_not_null
  - column: maintenance_label
    rule: values_in_set
    allowed: [0, 1]
  - column: measured_psi
    rule: values_between
    min: 0
    max: 120
  - column: event_ts
    rule: freshness_hours
    max_age: 24
```

Keep contracts specific. "The dataframe has rows" is weak. "Each vehicle has at most one label for a target week" is much stronger.

![FleetLens data contract checkpoints](/content-assets/articles/article-mlops-mlops-infrastructure-testing-ml-code-and-pipelines/fleetlens-data-contract-checkpoints.png)
*A data contract turns the FleetLens telematics batch into concrete release checks for freshness, ranges, labels, and leakage.*

## Add A Training Smoke Test
<!-- section-summary: A smoke test proves the training entrypoint can run end to end on a tiny fixture. It should finish quickly and avoid external services where possible. -->

A smoke test proves the training entrypoint can run end to end on a tiny fixture. It should finish quickly and avoid external services where possible.

```python
from pathlib import Path
from fleetlens.train import train_model


def test_training_smoke_run(tmp_path: Path):
    result = train_model(
        train_path="tests/fixtures/tiny_train.parquet",
        valid_path="tests/fixtures/tiny_valid.parquet",
        output_dir=tmp_path,
        max_rounds=5,
    )

    assert (tmp_path / "model.joblib").exists()
    assert result.metrics["valid_auc"] >= 0.50
    assert result.signature.inputs["measured_psi"] == "float"
```

The metric threshold is intentionally low because the dataset is tiny. The test is checking that the code path works, artifacts are written, and model metadata is present. Real quality gates belong in evaluation jobs with real validation data.

Smoke tests should also catch dependency mistakes:

- The training package imports in a clean environment.
- The entrypoint accepts the same config keys used by the orchestrator.
- Artifacts are written to the configured output path.
- The model can be loaded after training.
- The prediction function accepts the expected feature schema.

## Test Pipeline Behavior
<!-- section-summary: An ML pipeline is a graph of steps. A bug in the graph can skip validation, publish the wrong artifact, or run training before the feature backfill finishes. -->

An ML pipeline is a graph of steps. A bug in the graph can skip validation, publish the wrong artifact, or run training before the feature backfill finishes.

For Airflow, you can parse DAGs in CI:

```python
from airflow.models import DagBag


def test_fleetlens_dag_imports():
    dag_bag = DagBag(dag_folder="dags", include_examples=False)
    assert dag_bag.import_errors == {}


def test_validation_runs_before_training():
    dag = DagBag(dag_folder="dags", include_examples=False).get_dag("fleetlens_training")
    assert "validate_training_data" in dag.task_ids
    assert "train_model" in dag.task_ids
    assert dag.get_task("validate_training_data") in dag.get_task("train_model").upstream_list
```

For Kubeflow, Prefect, Dagster, or managed cloud pipelines, apply the same idea: check the compiled graph or pipeline definition before a real run. Look for required steps, artifact names, environment variables, resource requests, and promotion gates.

## Mock Services At The Boundary
<!-- section-summary: Pipeline tests should avoid touching production systems. That sounds obvious, yet many ML projects accidentally run tests against the real warehouse, real registry, or real... -->

Pipeline tests should avoid touching production systems. That sounds obvious, yet many ML projects accidentally run tests against the real warehouse, real registry, or real object bucket because the training script reads environment variables directly.

Create a boundary around each external dependency:

- A data reader that can load from a fixture path during tests.
- An artifact writer that can write to a temporary directory.
- A registry client wrapper that can run in dry-run mode.
- A feature store client that can return a small in-memory table.
- A notification client that records messages instead of posting to Slack.

Here is a small registry wrapper:

```python
class CandidateRegistry:
    def __init__(self, client, dry_run: bool = False):
        self.client = client
        self.dry_run = dry_run

    def register_candidate(self, model_name: str, model_path: str, metadata: dict):
        if self.dry_run:
            return {"model_name": model_name, "version": "dry-run", "metadata": metadata}

        return self.client.create_model_version(
            name=model_name,
            source=model_path,
            tags=metadata,
        )
```

Then CI can assert the release metadata without writing a real model version:

```python
def test_candidate_registration_uses_required_metadata():
    registry = CandidateRegistry(client=None, dry_run=True)
    result = registry.register_candidate(
        model_name="fleetlens-maintenance",
        model_path="/tmp/model",
        metadata={
            "git_sha": "abc123",
            "training_data_snapshot": "snapshot-2026-07-05",
            "feature_config_hash": "sha256:123",
        },
    )

    assert result["version"] == "dry-run"
    assert "training_data_snapshot" in result["metadata"]
```

This pattern keeps tests fast and safe while still exercising the release path. You are testing the shape of the integration, then saving live credentials for integration environments that are built for that risk.

## Gate Candidate Models With Evaluation Tests
<!-- section-summary: Training can pass while the model should still stay out of production. Evaluation tests decide whether a candidate is good enough for the next environment. -->

Training can pass while the model should still stay out of production. Evaluation tests decide whether a candidate is good enough for the next environment.

FleetLens could use gates like:

```yaml
model_quality_gates:
  global:
    roc_auc_min: 0.82
    precision_at_10_percent_min: 0.35
  segments:
    electric_vans:
      recall_min: 0.62
    diesel_vans:
      recall_min: 0.58
  regression_checks:
    compare_to_alias: champion
    max_auc_drop: 0.01
    max_segment_recall_drop: 0.03
```

Then the evaluator can fail the pipeline with a clear message:

```python
def assert_candidate_quality(candidate, champion, report):
    failures = []

    if candidate["roc_auc"] < 0.82:
        failures.append("global roc_auc below 0.82")

    for segment, metrics in candidate["segments"].items():
        champion_recall = champion["segments"][segment]["recall"]
        if metrics["recall"] < champion_recall - 0.03:
            failures.append(f"{segment} recall dropped by more than 0.03")

    if failures:
        report["release_decision"] = "blocked"
        report["failures"] = failures
        raise AssertionError("; ".join(failures))
```

Use gates carefully. A single global accuracy number can hide harm. Segment gates make the release process more honest.

## Run The Right Tests In CI
<!-- section-summary: Your pull-request workflow should separate fast checks from expensive checks. Fast checks run on every PR. Heavier checks run on main, nightly, or when training code changes. -->

Your pull-request workflow should separate fast checks from expensive checks. Fast checks run on every PR. Heavier checks run on main, nightly, or when training code changes.

```yaml
name: ml-pipeline-tests

on:
  pull_request:
    paths:
      - "src/**"
      - "pipelines/**"
      - "tests/**"
      - ".github/workflows/ml-pipeline-tests.yml"

jobs:
  fast-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
          cache: "pip"
      - run: pip install -r requirements-dev.txt
      - run: pytest tests/unit tests/contracts tests/pipeline -q

  training-smoke:
    runs-on: ubuntu-latest
    needs: fast-tests
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: pip install -r requirements-dev.txt
      - run: pytest tests/smoke/test_training_entrypoint.py -q
```

This workflow avoids running a full training job on every documentation change. It still protects the main code paths that usually break.

## Save Test Reports As Artifacts
<!-- section-summary: When a pipeline blocks a model, the reviewer should see why without digging through raw logs. CI can upload validation reports, feature summaries, smoke-run metrics, and... -->

When a pipeline blocks a model, the reviewer should see why without digging through raw logs. CI can upload validation reports, feature summaries, smoke-run metrics, and evaluation decisions as artifacts.

For example, a PR check can produce:

```json
{
  "pipeline": "fleetlens_training",
  "commit": "abc123",
  "checks": {
    "unit_tests": "passed",
    "data_contracts": "passed",
    "training_smoke": "passed",
    "pipeline_graph": "passed"
  },
  "fixtures": {
    "tiny_train_rows": 32,
    "tiny_valid_rows": 16
  },
  "release_ready": false,
  "reason": "full validation runs after merge on scheduled training data"
}
```

In GitHub Actions, upload it:

```yaml
- name: Upload ML test evidence
  uses: actions/upload-artifact@v4
  with:
    name: ml-pipeline-test-report
    path: reports/ml-pipeline-test-report.json
```

Evidence turns CI from a red or green icon into a teaching tool. A junior engineer can open the report and learn which layer failed.

![FleetLens test evidence report](/content-assets/articles/article-mlops-mlops-infrastructure-testing-ml-code-and-pipelines/fleetlens-test-evidence-report.png)
*The report gives reviewers a quick path from a failed gate to the next fix, instead of sending them through raw CI logs first.*

## Build Useful Test Fixtures
<!-- section-summary: Fixtures are small datasets designed to catch mistakes. They should be tiny, readable, and intentionally awkward. -->

Fixtures are small datasets designed to catch mistakes. They should be tiny, readable, and intentionally awkward.

Good ML fixtures include:

- A row with a missing optional feature.
- A row with a missing required feature.
- A rare category.
- A known leakage column that should be dropped.
- A segment with a different label rate.
- A duplicate entity and timestamp.
- A historical incident example.

For FleetLens, keep `tests/fixtures/tiny_train.parquet` small enough for CI and add a markdown note describing why each row exists. A future developer should be able to say, "Row 8 protects us from the tire-pressure units bug."

## Common Mistakes
<!-- section-summary: The easiest mistake is treating model quality as the only test. A production ML pipeline also needs tests for data shape, feature logic, artifact metadata, orchestration, and... -->

The easiest mistake is treating model quality as the only test. A production ML pipeline also needs tests for data shape, feature logic, artifact metadata, orchestration, and release decisions.

Other common mistakes:

- Tests depend on live production databases.
- Tests use random data without fixed seeds.
- Fixtures are too large for PR feedback.
- Pipeline graph checks are skipped because the graph is "just configuration."
- Evaluation gates use only global metrics.
- CI checks write to the real model registry.
- The same test suite handles every risk, so no one knows which layer failed.

Start small. Add one good transform test, one data contract, one smoke test, and one quality gate. Then extend the suite each time an incident or review exposes a missing guardrail.

## A Review Checklist You Can Use Tomorrow
<!-- section-summary: When you review an ML pipeline pull request, ask these questions before approving:. -->

When you review an ML pipeline pull request, ask these questions before approving:

- Which transform changed, and where is the focused test for that transform?
- Which schema or data contract protects the new column?
- Which tiny fixture proves the code path runs without a warehouse-sized dataset?
- Which artifact metadata will help you reproduce the run later?
- Which test fails if the target leaks into the feature list?
- Which segment metric protects the users most likely to be harmed?
- Which external service is mocked or isolated during CI?
- Which report will a reviewer open when the check fails?

That checklist keeps the review grounded in evidence. You are no longer asking, "Does this ML code look fine?" You are asking whether the pipeline can prove the important parts of its own behavior.

## References

- [pytest documentation](https://docs.pytest.org/en/stable/getting-started.html)
- [GitHub Actions workflow syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions)
- [Great Expectations validation workflow](https://docs.greatexpectations.io/docs/0.18/oss/guides/validation/validate_data_overview/)
- [TensorFlow Data Validation](https://www.tensorflow.org/tfx/data_validation/get_started)
- [pandera documentation](https://pandera.readthedocs.io/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
