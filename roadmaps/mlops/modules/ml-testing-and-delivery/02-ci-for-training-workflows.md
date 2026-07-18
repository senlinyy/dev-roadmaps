---
title: "Training CI"
description: "Show which checks can run before expensive training jobs."
overview: "Learn how to design CI for ML training changes so pull requests catch broken code, data contracts, configs, and release gates before expensive jobs run."
tags: ["MLOps", "production", "ci-cd"]
order: 2
id: "article-mlops-mlops-infrastructure-ci-for-training-workflows"
aliases:
  - roadmaps/mlops/modules/mlops-infrastructure/ci-cd-for-ml/02-ci-for-training-workflows.md
  - roadmaps/mlops/modules/ml-testing-and-delivery/ci-cd-for-ml/02-ci-for-training-workflows.md
  - child-ci-cd-for-ml-02-ci-for-training-workflows
---

## What Training CI Is Trying To Protect
<!-- section-summary: Training CI catches code, configuration, dependency, data-access, and smoke-run failures before expensive jobs start. -->

Training CI is the set of automated checks that runs before a training change is merged or promoted. It is the safety net between a developer's pull request and a pipeline that may use a large dataset, a cloud cluster, expensive accelerators, or a shared model registry.

You are protecting three things:

- Money, because a broken training job can waste compute for hours.
- Time, because failed nightly runs delay releases and experiments.
- Trust, because a pipeline that publishes weak candidates quietly creates production risk.

Imagine `ClaimLens`, an insurance team training a claim-severity model. A developer updates the feature config to add vehicle age and repair-shop history. The real training job takes three hours on a managed cluster, reads from a warehouse, and writes artifacts to object storage. You want CI to answer fast questions before that job starts:

- Does the training package import?
- Do the config files parse and match the code?
- Can the feature transforms run on a tiny fixture?
- Are required secrets and cloud permissions referenced safely?
- Can the training command complete on a sample?
- Will the pipeline publish a candidate only after evaluation gates pass?

Training CI should avoid pretending that a five-minute smoke run proves model quality. Its job is to block broken mechanics early and route expensive validation to the right environment.

## Split Checks By Cost
<!-- section-summary: A healthy training CI workflow has levels. Each level has a different trigger and runtime target. -->

A healthy training CI workflow has levels. Each level has a different trigger and runtime target.

| Level | Typical trigger | Runtime target | What it catches |
|---|---|---|---|
| Static checks | Every PR | 1-3 minutes | Syntax, typing, lint, forbidden imports, config format. |
| Unit and contract tests | Every PR | 3-8 minutes | Feature logic, schemas, tiny pipeline components. |
| Training smoke test | Training-code PRs | 5-15 minutes | Entrypoint, dependencies, artifact writing, metadata. |
| Integration test | Main branch or labeled PR | 15-45 minutes | Warehouse access, object storage, orchestration, registry writes in a sandbox. |
| Full training validation | Nightly, release branch, or manual approval | Hours | Real metrics, segment gates, cost, reproducibility. |

This split keeps PR feedback humane. A developer can fix a config typo in minutes, while full validation still happens in the environment where real data and permissions exist.

![ClaimLens training CI cost ladder](/content-assets/articles/article-mlops-mlops-infrastructure-ci-for-training-workflows/claimlens-training-ci-cost-ladder.png)
*ClaimLens keeps cheap checks close to every pull request and reserves protected jobs for integration and full validation runs.*

## Make Configs Testable
<!-- section-summary: Training pipelines often fail because a YAML config and the Python code drift apart. Treat configs as code. -->

Training pipelines often fail because a YAML config and the Python code drift apart. Treat configs as code.

Here is a small training config for ClaimLens:

```yaml
model:
  name: claim-severity-xgb
  objective: reg:squarederror
  max_depth: 6
  learning_rate: 0.04

data:
  train_table: analytics.claim_training_v12
  validation_table: analytics.claim_validation_v12
  target: paid_amount_90d
  entity_key: claim_id
  feature_columns:
    - claim_type
    - vehicle_age_years
    - repair_shop_score
    - adjuster_region

artifacts:
  output_uri: s3://claimlens-ml-dev/artifacts/claim-severity-xgb
  registry_name: claim-severity-xgb
```

A CI test can validate the file without launching training:

```python
from pathlib import Path
import yaml

REQUIRED_TOP_LEVEL = {"model", "data", "artifacts"}


def test_training_config_has_required_sections():
    config = yaml.safe_load(Path("configs/claim_severity.yml").read_text())
    assert REQUIRED_TOP_LEVEL <= set(config)
    assert config["data"]["target"] not in config["data"]["feature_columns"]
    assert config["artifacts"]["registry_name"] == config["model"]["name"]
```

You can go further with Pydantic or typed dataclasses, but even this small test catches common mistakes: missing artifact output, target leakage, and model names that diverge across systems.

![ClaimLens config checks in CI](/content-assets/articles/article-mlops-mlops-infrastructure-ci-for-training-workflows/claimlens-config-checks-ci.png)
*The config check makes the target, feature list, artifact path, and registry name visible before the smoke run starts.*

## Use A Tiny Dataset For Smoke Runs
<!-- section-summary: A smoke run should execute the real training command with tiny data and cheap settings. -->

A smoke run should execute the real training command with tiny data and cheap settings.

```bash
python -m claimlens.train \
  --config configs/claim_severity.yml \
  --train-path tests/fixtures/claims_train.parquet \
  --validation-path tests/fixtures/claims_valid.parquet \
  --output-dir /tmp/claimlens-smoke \
  --max-rounds 3 \
  --disable-registry-write
```

In CI, assert the outputs:

```python
from pathlib import Path
import json


def test_smoke_run_outputs_metadata(tmp_path):
    output_dir = run_training_smoke(tmp_path)

    assert (output_dir / "model").exists()
    metrics = json.loads((output_dir / "metrics.json").read_text())
    signature = json.loads((output_dir / "signature.json").read_text())

    assert "rmse" in metrics
    assert "vehicle_age_years" in signature["inputs"]
    assert signature["target"] == "paid_amount_90d"
```

The smoke test should skip registry writes by default. Writing to a shared registry from a PR creates cleanup work and can confuse release history. If you need registry coverage, use a sandbox registry or a temporary model name.

## Check Data Access Without Pulling The Whole Warehouse
<!-- section-summary: Training code often needs cloud access. CI should prove the service account can see the right paths, but it should avoid reading the full dataset. -->

Training code often needs cloud access. CI should prove the service account can see the right paths, but it should avoid reading the full dataset.

For a warehouse-backed job, run a small metadata query:

```sql
select
  count(*) as rows_checked,
  min(training_week) as first_week,
  max(training_week) as last_week
from analytics.claim_training_v12
where training_week >= date_sub(current_date, interval 2 week)
limit 1;
```

For object storage, list a prefix and read a tiny manifest:

```bash
aws s3 ls s3://claimlens-ml-dev/manifests/claim-severity-xgb/
aws s3 cp s3://claimlens-ml-dev/manifests/claim-severity-xgb/latest.json -
```

Keep these checks in integration CI, because they need credentials. Use environment protection, short-lived credentials, and least-privilege roles. A pull request from an untrusted fork should never receive production secrets.

## Check The Training Image
<!-- section-summary: Many teams run training inside a container. CI should test that image before a remote job discovers a missing library three hours later. -->

Many teams run training inside a container. CI should test that image before a remote job discovers a missing library three hours later.

A useful image check has three parts:

- Build the image from the same Dockerfile used by the training platform.
- Run the training entrypoint with `--help` or a tiny fixture.
- Print the versions of critical libraries such as Python, PyTorch, scikit-learn, CUDA, or XGBoost.

```yaml
  training-image-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: docker/setup-buildx-action@v3
      - run: docker build -t claimlens-train:${{ github.sha }} -f docker/train.Dockerfile .
      - run: docker run --rm claimlens-train:${{ github.sha }} python -m claimlens.train --help
      - run: |
          docker run --rm claimlens-train:${{ github.sha }} python - <<'PY'
          import sklearn, xgboost
          print("sklearn", sklearn.__version__)
          print("xgboost", xgboost.__version__)
          PY
```

For GPU training, CI may run only a CPU smoke test, while a scheduled GPU validation job checks CUDA, the NVIDIA Collective Communications Library (NCCL), and accelerator availability. The key is to make that split explicit. The PR check proves the image shape; the scheduled job proves the expensive runtime.

## A GitHub Actions Shape For Training CI
<!-- section-summary: Here is a practical split using GitHub Actions. The fast job runs for every PR. The integration job runs only when a maintainer applies a label. -->

Here is a practical split using GitHub Actions. The fast job runs for every PR. The integration job runs only when a maintainer applies a label.

:::expand[Inspect the complete GitHub Actions workflow]{kind="example"}

```yaml
name: claimlens-training-ci

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
    paths:
      - "claimlens/**"
      - "configs/**"
      - "pipelines/**"
      - "tests/**"

jobs:
  fast-training-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: astral-sh/setup-uv@v8.3.2
        with:
          python-version: "3.12"
          enable-cache: true
      - run: uv lock --check
      - run: uv sync --locked --all-extras --dev
      - run: uv run python -m compileall claimlens
      - run: uv run pytest tests/unit tests/contracts tests/smoke -q

  integration-training-check:
    if: >-
      contains(github.event.pull_request.labels.*.name, 'run-training-integration') &&
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    environment: ml-dev
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v6
      - uses: astral-sh/setup-uv@v8.3.2
        with:
          python-version: "3.12"
      - run: uv sync --locked --all-extras --dev
      - run: uv run pytest tests/integration/test_training_data_access.py -q
      - run: uv run python -m claimlens.train --config configs/claim_severity_dev.yml --max-rounds 20
```

:::

The repository check keeps forked pull requests out of the credentialed integration job. The `environment` setting adds a maintainer approval boundary for branches inside the repository. OpenID Connect federation can avoid long-lived cloud secrets in CI, and the cloud trust policy should still restrict repository, environment, branch or pull-request context, audience, and role permissions. Teams that need to test forked contributions should run a separate manual workflow against a reviewed commit in an isolated sandbox; a label should never hand an untrusted fork access to warehouse or object-storage credentials.

The committed `uv.lock` also separates deliberate dependency upgrades from ordinary code changes. `uv lock --check` fails when project metadata and the lock disagree, and `uv sync --locked` installs the reviewed resolution instead of selecting new package versions during the workflow.

## Compare Against The Current Champion
<!-- section-summary: Training CI should create evidence that a candidate can be compared with the current champion. The full comparison may run after merge, yet the code path should exist before merge. -->

Training CI should create evidence that a candidate can be compared with the current champion. The full comparison may run after merge, yet the code path should exist before merge.

```python
from mlflow import MlflowClient


def load_champion_metrics(model_name: str) -> dict:
    client = MlflowClient()
    champion = client.get_model_version_by_alias(model_name, "champion")
    run = client.get_run(champion.run_id)
    return run.data.metrics


def assert_candidate_has_release_metadata(candidate_report: dict):
    required = {
        "training_data_snapshot",
        "code_commit",
        "feature_config_hash",
        "evaluation_dataset",
        "segment_metrics",
    }
    missing = required - set(candidate_report)
    assert missing == set()
```

This example again uses aliases rather than deprecated stage APIs. Your deployment system can ask for `models:/claim-severity-xgb@champion`, while CI can check that a candidate has the metadata needed for an approval decision.

## Make Failures Easy To Act On
<!-- section-summary: Training CI should fail with a message that tells the author what to do next. A vague "pipeline failed" message pushes people into log archaeology. -->

Training CI should fail with a message that tells the author what to do next. A vague "pipeline failed" message pushes people into log archaeology.

Good failure messages include:

- The layer that failed: config, contract, smoke run, data access, image, or quality gate.
- The file or table involved.
- The expected rule.
- The observed value.
- The owner or runbook for follow-up.

Example output:

```json
{
  "status": "failed",
  "layer": "data_contract",
  "table": "analytics.claim_training_v12",
  "rule": "target column must be absent from feature list",
  "observed": "paid_amount_90d was included in feature_columns",
  "next_step": "Remove the target from configs/claim_severity.yml and rerun fast-training-checks"
}
```

This style is especially helpful for beginner teams. They learn from the pipeline instead of memorizing tribal debugging steps.

## Keep Expensive Jobs Intentional
<!-- section-summary: Training CI should make expensive work visible. Add labels, manual approvals, or branch rules so people understand when a PR will launch real training. -->

Training CI should make expensive work visible. Add labels, manual approvals, or branch rules so people understand when a PR will launch real training.

Useful controls:

- Only run full training on `main`, release branches, nightly schedules, or explicit labels.
- Print estimated cost or resource class at the start of the job.
- Use quotas for concurrent training runs.
- Cancel superseded training jobs when a newer commit arrives.
- Write artifacts to a dev or candidate area until approval.
- Tag every run with commit SHA, PR number, requester, and config hash.

A small run metadata block helps later:

```json
{
  "run_type": "training_ci_integration",
  "model_name": "claim-severity-xgb",
  "git_sha": "4f3a91c",
  "pull_request": 428,
  "requested_by": "maya",
  "config_hash": "sha256:7baf...",
  "compute": "cpu-standard-8",
  "registry_write": "sandbox"
}
```

![ClaimLens intentional training runs](/content-assets/articles/article-mlops-mlops-infrastructure-ci-for-training-workflows/claimlens-intentional-training-runs.png)
*Protected training runs should show the trigger, controls, and run metadata that explain why the expensive job launched.*

## What Good Training CI Feels Like
<!-- section-summary: Good training CI gives developers fast feedback and platform teams clear controls for costly or privileged jobs. -->

A good setup gives developers fast confidence and gives platform teams guardrails. When a PR breaks a feature transform, the unit test fails. When a config references a missing column, the contract test fails. When training imports a dependency missing from the image, the smoke test fails. When real data permissions drift, the integration job fails in the dev environment.

You should still expect surprises in full training. CI reduces avoidable failures; it cannot prove the future. The practical win is that expensive training jobs fail for interesting reasons instead of typo-level reasons.

## Decide Whether Training CI Covers The Risk
<!-- section-summary: Training CI is complete when each failure surface has a fast check or a deliberate protected job with evidence and ownership. -->

The cost ladder defines completeness. Cheap mechanics belong on every pull request. Data access and external integrations belong in a protected environment. Full training and candidate comparison run only when the change and product risk justify them. A workflow has a gap when a failure surface belongs to no level or when two levels repeat expensive work without a different question.

Use the following checks to find those gaps:

- A new PR can run fast checks without cloud secrets.
- Training configs are parsed by tests, not only by the training job.
- The target column is checked against the feature list.
- A tiny fixture exercises the real training entrypoint.
- The container image can run the training command in CI.
- Cloud data access checks run only in a protected environment.
- Full training jobs are triggered intentionally by schedule, branch, label, or approval.
- Every training run records commit SHA, config hash, data snapshot, and requester.
- Candidate metrics can be compared with the current champion by alias.
- Failure reports name the exact layer, observed value, and next step.

If half are missing, start with config parsing, smoke training, and metadata checks. Then add the protected layer that covers the highest-cost failure still invisible to CI. This keeps the system tied to risk and feedback time and prevents a large undifferentiated checklist from taking over.

## References

- [GitHub Actions workflow syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions)
- [Using uv in GitHub Actions](https://docs.astral.sh/uv/guides/integration/github/)
- [GitHub Actions contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)
- [pytest documentation](https://docs.pytest.org/en/stable/getting-started.html)
- [Docker build with GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [MLflow Model Registry workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/)
