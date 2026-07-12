---
title: "Reproduce Old Runs"
description: "Follow a past model version through registry, tracking, code, dataset, environment, replay, and comparison evidence."
overview: "Reproducing an old training run starts with the model version, then follows registry metadata to the tracking run, code commit, dataset snapshot, config, environment, replay command, metrics, artifacts, and gaps. This guide uses a warehouse demand forecast run to show a practical replay workflow."
tags: ["MLOps", "production", "debugging"]
order: 2
id: "article-mlops-experiments-and-reproducibility-reproducing-old-training-run"
---

## Table of Contents

1. [What Reproducing an Old Run Means](#what-reproducing-an-old-run-means)
2. [Start From the Model Version](#start-from-the-model-version)
3. [Follow the Registry to the Tracking Run](#follow-the-registry-to-the-tracking-run)
4. [Recover Code, Data, and Config](#recover-code-data-and-config)
5. [Rebuild the Environment](#rebuild-the-environment)
6. [Replay and Record a New Run](#replay-and-record-a-new-run)
7. [Compare the Replay](#compare-the-replay)
8. [When Evidence Is Missing](#when-evidence-is-missing)
9. [Putting It Together](#putting-it-together)
10. [What's Next](#whats-next)
11. [References](#references)

## What Reproducing an Old Run Means
<!-- section-summary: Reproducing an old run means following evidence from a model version back to the exact run ingredients and replaying or inspecting them honestly. -->

To **reproduce an old training run**, you start from the model version someone cares about and follow the evidence back to the original training ingredients. The useful chain is model version -> registry -> tracking run -> code commit -> dataset snapshot -> config -> environment -> replay -> comparison. Each arrow should be backed by metadata, artifacts, or commands a teammate can inspect.

That chain sounds formal, so let us make it concrete. **HarborMart Supply** runs warehouses for home goods retailers. Its planning team uses a model named `harbormart-demand-forecast` to predict daily demand for each SKU and fulfillment center. One Monday morning, the Chicago warehouse runs out of shelf brackets even though the forecast expected normal demand. The operations lead asks whether model version `27` can be reproduced from the run that trained it.

The replay has a narrow production goal: can the team reconstruct the run that produced model version `27`, rerun it under the recorded inputs, and compare the result with the original metrics and artifacts? A better forecast can come later, after the team understands the version already in production.

The investigation should produce a packet like this:

| Evidence | What it answers | Example |
|---|---|---|
| Model version | Which deployed model are we investigating? | `harbormart-demand-forecast` version `27` |
| Tracking run | Which training run created that model? | MLflow run `demand-2026-05-31-0315` |
| Code commit | Which source code executed? | Git commit `4f2c8d1` |
| Dataset snapshot | Which rows and labels trained it? | `lakefs://demand-lake/forecasting@7a91cf2` |
| Config | Which horizons, features, and parameters were used? | `configs/demand/prod_14_day.yml` |
| Environment | Which image, lockfile, Python, and package versions ran it? | `registry.harbor.ai/ml/demand-trainer@sha256:...` |
| Replay output | Did the rerun match the old evidence? | WAPE, bias, row counts, artifact hash, logs |

![HarborMart old-run reproduction chain from model version to replay comparison.](/content-assets/articles/article-mlops-experiments-and-reproducibility-reproducing-old-training-run/old-run-evidence-chain.png)

*HarborMart starts from model version `27`, follows the registry and tracking run back to the recorded inputs, then compares the replay against the original evidence.*

This workflow gives beginners a stable order. You do not jump straight into rerunning a script. You first collect the evidence that defines the old run, then choose the replay path that matches the question.

## Start From the Model Version
<!-- section-summary: The model version is the safest investigation entry point because it is the object production actually served. -->

The model version is the right starting point because production systems usually serve a named registered model or a model artifact promoted from a registry. A service log, a feature flag, or a deployment manifest should tell you which model version was active when the warehouse saw the bad forecast. In HarborMart's case, the serving metadata says Chicago used `harbormart-demand-forecast` version `27` from May 31 through June 18.

In MLflow, the registry entry should carry the link back to the training run. A small export script can read the registry and create the first replay packet:

```python
from mlflow import MlflowClient

client = MlflowClient()

model_version = client.get_model_version(
    name="harbormart-demand-forecast",
    version="27",
)

run = client.get_run(model_version.run_id)

print(
    {
        "model_name": model_version.name,
        "model_version": model_version.version,
        "run_id": model_version.run_id,
        "source": model_version.source,
        "artifact_uri": run.info.artifact_uri,
        "code_commit": run.data.tags.get("code_commit"),
        "data_snapshot": run.data.tags.get("data_snapshot"),
    }
)
```

Example output:

```console
{
  "model_name": "harbormart-demand-forecast",
  "model_version": "27",
  "run_id": "demand-2026-05-31-0315",
  "source": "s3://harbormart-ml-artifacts/demand/runs/demand-2026-05-31-0315/model",
  "artifact_uri": "s3://harbormart-ml-artifacts/demand/runs/demand-2026-05-31-0315",
  "code_commit": "4f2c8d1",
  "data_snapshot": "lakefs://demand-lake/forecasting@7a91cf2"
}
```

The output gives the investigation a clean anchor. If the registry lacks a run ID, the team can still inspect deployment manifests and artifact paths, yet the replay confidence is lower. The gap should be recorded right away because missing lineage is part of the incident evidence.

## Follow the Registry to the Tracking Run
<!-- section-summary: The tracking run should hold parameters, metrics, tags, artifacts, and dataset links that define the training job. -->

The **tracking run** is where the experiment system stores the details that the registry entry usually summarizes. For HarborMart, MLflow should hold the forecast horizon, feature list, validation period, random seed, input snapshots, training metrics, plots, model artifact, and replay packet. This is where a reproduction effort shifts from "Which model?" to "What exactly trained it?"

Run metadata should answer these questions:

| Question | Tracking field or artifact |
|---|---|
| Which code ran? | `code_commit`, repository URL, training entrypoint |
| Which data trained it? | `data_snapshot`, manifest artifact, MLflow dataset input |
| Which config controlled it? | Config file artifact and logged parameters |
| Which environment ran it? | Image digest, lockfile artifact, Python and package tags |
| Which metrics did it report? | WAPE, MAE, bias by warehouse, service-level metrics |
| Which artifacts should match? | Model file, feature schema, evaluation report, plots |

The replay export script should download the key artifacts into a local review folder:

```python
import mlflow.artifacts

RUN_ID = "demand-2026-05-31-0315"

for artifact_path in [
    "reproducibility/replay_packet.yml",
    "config/prod_14_day.yml",
    "reports/evaluation.json",
    "schemas/feature_schema.json",
]:
    local_path = mlflow.artifacts.download_artifacts(
        run_id=RUN_ID,
        artifact_path=artifact_path,
        dst_path="replay-work/demand-v27",
    )
    print(local_path)
```

The replay folder now has the human-readable packet, the training config, the original evaluation report, and the feature schema. Those files matter because the run may have used a config that no longer matches the current repository default. Reproduction should follow the old run's recorded config, not the latest training default.

## Recover Code, Data, and Config
<!-- section-summary: A replay needs the old code commit, immutable dataset snapshot, and original training config before any training command runs. -->

Code, data, and config are the visible inputs that most teams remember first. They still need exact versions. A branch name such as `main`, a table name such as `warehouse_demand_train`, or a config name such as `prod.yml` is too loose for replay because those names can point to different contents later.

For HarborMart, the run says:

```yaml
code:
  repo: git@github.com:harbormart/ml-forecasting.git
  commit: 4f2c8d1
  entrypoint: training/train_forecast.py
data:
  lakefs_snapshot: lakefs://demand-lake/forecasting@7a91cf2
  dvc_pointer: data/warehouse_demand_train.parquet.dvc
  row_count: 238441912
  min_event_date: "2025-12-01"
  max_event_date: "2026-05-30"
config:
  path: configs/demand/prod_14_day.yml
  forecast_horizon_days: 14
  target: units_shipped
```

The code recovery uses Git:

```bash
git clone git@github.com:harbormart/ml-forecasting.git replay-harbormart-demand
cd replay-harbormart-demand
git checkout 4f2c8d1
```

The data recovery depends on the team's versioning system. With DVC, the Git commit can carry the `.dvc` metadata that points to the exact data content:

```bash
dvc pull data/warehouse_demand_train.parquet.dvc
dvc pull data/warehouse_demand_validation.parquet.dvc
```

With lakeFS, the replay packet can point to a commit-like ref for the data lake:

```bash
lakectl fs ls lakefs://demand-lake/forecasting@7a91cf2/curated/demand/
```

The important habit is to verify counts before training. A replay that uses the wrong data snapshot can still execute and produce a model, and that model tells you little about the original run.

```sql
SELECT
  COUNT(*) AS rows,
  MIN(event_date) AS min_event_date,
  MAX(event_date) AS max_event_date,
  COUNT(DISTINCT fulfillment_center_id) AS centers,
  COUNT(DISTINCT sku_id) AS skus
FROM demand_training_examples
WHERE snapshot_id = '7a91cf2';
```

Expected output:

```console
rows       min_event_date  max_event_date  centers  skus
238441912  2025-12-01      2026-05-30      42       184921
```

If the row count, date range, center count, or SKU count differs, the team should fix the data recovery before touching the model training command.

![Code, data, and config recovered into a HarborMart replay workspace.](/content-assets/articles/article-mlops-experiments-and-reproducibility-reproducing-old-training-run/recover-code-data-config.png)

*The replay workspace is only trustworthy after the team has recovered the old code commit, immutable data snapshot, forecast config, and row count evidence.*

## Rebuild the Environment
<!-- section-summary: The old environment includes the image digest, lockfiles, Python packages, CUDA libraries, hardware class, and runtime flags. -->

The environment is the next layer. A demand forecast may use LightGBM, XGBoost, PyTorch, or scikit-learn pipelines depending on the team. HarborMart uses a PyTorch temporal model for high-volume SKUs and a scikit-learn fallback model for sparse SKUs. That mix makes the run sensitive to PyTorch, CUDA, NumPy, pandas, and scikit-learn versions.

The replay packet should name the exact container image and lockfile:

```yaml
environment:
  image_digest: registry.harbor.ai/ml/demand-trainer@sha256:8e73aa19c4d2
  dockerfile_commit: 4f2c8d1
  lockfiles:
    pip: requirements.lock
    conda: conda-lock.yml
  python: "3.11.8"
  packages:
    pytorch: "2.5.1"
    cuda_runtime: "12.4"
    numpy: "2.0.2"
    pandas: "2.2.3"
    scikit_learn: "1.5.2"
runtime:
  gpu: "NVIDIA A10G"
  gpu_count: 1
  cpu_threads: 24
  seed: 1407
```

Pull the image by digest where possible:

```bash
docker pull registry.harbor.ai/ml/demand-trainer@sha256:8e73aa19c4d2
```

If the old image is gone, rebuild from the recorded Dockerfile commit and the lockfile. That replay has weaker evidence than a digest pull, so the result should say "rebuilt equivalent image" instead of "original image." The wording matters because the team may later need to explain why the replay carried more environment uncertainty.

You can record the runtime inside the container before training:

```bash
docker run --rm --gpus all \
  registry.harbor.ai/ml/demand-trainer@sha256:8e73aa19c4d2 \
  python tools/print_runtime.py
```

Example output:

```console
python=3.11.8
torch=2.5.1
cuda_runtime=12.4
sklearn=1.5.2
gpu=NVIDIA A10G
driver=550.54
```

This output should be stored as a replay artifact. It proves the replay used the intended runtime rather than the developer laptop or the current training image.

## Replay and Record a New Run
<!-- section-summary: A replay should create its own tracking run linked to the original so later reviewers can inspect both records. -->

Now the team can run the training command. The replay run should write a new MLflow record and link itself to the original run. That keeps the audit trail clear: the original run produced model version `27`, and the replay run tested whether those old ingredients still produce a close match.

A replay command might look like this:

```bash
docker run --rm --gpus all \
  -e MLFLOW_TRACKING_URI=https://mlflow.harbor.ai \
  -e RUN_TYPE=replay \
  -e ORIGINAL_RUN_ID=demand-2026-05-31-0315 \
  -v "$PWD":/workspace \
  -w /workspace \
  registry.harbor.ai/ml/demand-trainer@sha256:8e73aa19c4d2 \
  python training/train_forecast.py \
    --config configs/demand/prod_14_day.yml \
    --data-snapshot lakefs://demand-lake/forecasting@7a91cf2 \
    --seed 1407 \
    --run-name replay-demand-v27-2026-07-04
```

The replay should log a tag set like this:

```yaml
run_type: replay
original_run_id: demand-2026-05-31-0315
model_version_under_review: harbormart-demand-forecast/27
replay_reason: chicago_stockout_investigation
replay_operator: ml-platform-oncall
replay_date: "2026-07-04"
```

That tag set protects the registry from accidental promotion. The replay is evidence for an investigation, and any candidate promotion should use a separate training and approval path.

The replay should also log the same packet fields as the original run. If a field differs, such as GPU type or image recovery method, the replay packet should show both original and replay values.

## Compare the Replay
<!-- section-summary: Replay success comes from comparing data counts, metrics, artifacts, logs, and accepted tolerances against the original run. -->

The comparison should be written before anyone declares success. Forecasting models rarely need byte-for-byte model files to count as a useful replay. HarborMart cares more about business metrics, segment behavior, and whether the replay used the same rows, config, and runtime.

For the demand model, the comparison table can be direct:

| Evidence | Original run | Replay run | Tolerance | Result |
|---|---:|---:|---:|---|
| Training rows | 238,441,912 | 238,441,912 | exact | pass |
| Validation rows | 14,882,004 | 14,882,004 | exact | pass |
| WAPE overall | 0.184 | 0.185 | <= 0.002 | pass |
| WAPE Chicago | 0.213 | 0.217 | <= 0.003 | review |
| Bias Chicago brackets | -7.4% | -7.6% | <= 0.5 percentage points | pass |
| Feature schema hash | `91ab2e` | `91ab2e` | exact | pass |
| Model file hash | `6c10fa` | `a413e2` | informational | expected difference |

![Original run and replay run comparison with HarborMart tolerance decisions.](/content-assets/articles/article-mlops-experiments-and-reproducibility-reproducing-old-training-run/replay-comparison.png)

*The replay can pass row, WAPE, and feature-schema checks while Chicago WAPE still needs review, which keeps the investigation focused on the warehouse segment that failed tolerance.*

WAPE means weighted absolute percentage error. It is common in demand forecasting because one expensive SKU should matter more than one slow-moving SKU with tiny volume. HarborMart also checks bias for critical categories because under-forecasting shelf brackets hurts warehouse picking more than over-forecasting a slow item by one unit.

A small comparison script can pull the original evaluation artifact and the replay evaluation artifact:

```bash
python tools/compare_forecast_replay.py \
  --original-run demand-2026-05-31-0315 \
  --replay-run replay-demand-v27-2026-07-04 \
  --metrics reports/evaluation.json \
  --out reports/replay_comparison.md
```

The output should include row counts, metric deltas, segment deltas, artifact hashes, runtime differences, and an overall status. If Chicago WAPE exceeds tolerance, the status can be `review` even when the overall metric passes. That status tells the team where to continue the investigation.

## When Evidence Is Missing
<!-- section-summary: Missing evidence should be recorded as a replay limitation with a practical next step, rather than hidden inside a successful rerun. -->

Old runs often have gaps. The image registry may have garbage-collected the old digest. The data team may have overwritten a table snapshot. The tracking run may have logged metrics and artifacts while leaving out the seed. A replay can still be useful, as long as the final report names the missing evidence clearly.

Use a gap table:

| Missing evidence | Risk | Practical next step |
|---|---|---|
| Image digest unavailable | Runtime may differ from original | Rebuild from Dockerfile commit and lockfile, then label replay as rebuilt |
| Dataset snapshot unavailable | Replay may train on changed rows | Use raw event replay or warehouse time travel if available; lower confidence if neither exists |
| Seed missing | Small metric movement may be hard to explain | Replay several seeds and compare distribution around the original metric |
| Feature schema missing | Feature order or encoding may differ | Reconstruct from model artifact and training logs, then add schema logging to future runs |
| Artifact hash missing | Exact model bytes cannot be checked | Compare metrics, predictions on a frozen sample, and generated reports |

This is the production lesson. A replay report with honest limitations is better than a clean-looking rerun that hides uncertainty. The report helps the platform team fix tracking gaps for future runs while still giving operations a useful answer for the current incident.

## Putting It Together
<!-- section-summary: Old-run reproduction is a chain from model version to registry, tracking run, code, data, environment, replay, and comparison. -->

Reproducing old runs is a workflow, not a single command. For HarborMart, the team starts with `harbormart-demand-forecast` version `27`, reads the MLflow registry entry, finds run `demand-2026-05-31-0315`, recovers commit `4f2c8d1`, checks out dataset snapshot `7a91cf2`, pulls the old container digest, runs a labeled replay, and compares metrics, counts, artifacts, and runtime.

That chain gives the business answer more weight. If the replay matches within tolerance, the team can investigate production demand shifts or serving data next. If the replay diverges, the team has a structured path through data, dependencies, seeds, hardware, and metric code instead of guessing from memory.

## What's Next
<!-- section-summary: The next article explains why identical source code can still train a different model and how teams decide whether the difference matters. -->

Next we look at same-code differences. The source commit can match while data, dependencies, hardware, randomness, and evaluation details still move the trained model.

## References

- [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) - Official tracking documentation for runs, parameters, metrics, tags, artifact storage, and team tracking setups.
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) - Official registry documentation for model versions, aliases, tags, and lineage back to runs.
- [MLflow artifacts API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.artifacts.html) - Official Python API for listing and downloading run or model artifacts.
- [MLflow Dataset Tracking](https://mlflow.org/docs/latest/ml/dataset/) - Official documentation for dataset lineage and dataset version evidence in MLflow.
- [DVC Get Started](https://doc.dvc.org/start) - Official DVC guide showing data tracking, `dvc pull`, and switching data versions through Git-tracked metadata.
- [lakeFS concepts](https://docs.lakefs.io/understand/model/) - Official lakeFS documentation for commits, branches, tags, and immutable data references.
- [Docker image tag reference](https://docs.docker.com/reference/cli/docker/image/tag/) - Official Docker reference for image references, repositories, and tags.
- [PyTorch Reproducibility Notes](https://docs.pytorch.org/docs/stable/notes/randomness.html) - Official notes on release, platform, seed, and deterministic-operation limits.
- [scikit-learn common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html) - Official guidance on preprocessing, leakage, pipelines, and randomness issues that affect replay comparisons.
