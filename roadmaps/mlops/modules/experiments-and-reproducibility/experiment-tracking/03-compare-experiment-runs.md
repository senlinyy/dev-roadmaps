---
title: "Comparing Experiment Runs"
description: "Show how teams compare tracked runs against a baseline using metrics, segments, artifacts, runtime checks, and release risk."
overview: "Comparing experiment runs means choosing a model candidate with evidence across more than the top score. This article follows a computer vision defect detection team as they compare MLflow and W&B runs against a baseline, inspect guardrails, check artifacts, and write a release recommendation."
tags: ["MLOps", "core", "tracking"]
order: 3
id: "article-mlops-experiments-and-reproducibility-compare-experiment-runs"
---

## Table of Contents

1. [Comparison Is A Model Decision With Evidence](#comparison-is-a-model-decision-with-evidence)
2. [Follow One Defect Detection Review](#follow-one-defect-detection-review)
3. [Start With A Shared Baseline](#start-with-a-shared-baseline)
4. [Build A Comparison Table](#build-a-comparison-table)
5. [Inspect Segments And Failure Examples](#inspect-segments-and-failure-examples)
6. [Check Artifacts And Runtime Readiness](#check-artifacts-and-runtime-readiness)
7. [Choose A Candidate And Record The Decision](#choose-a-candidate-and-record-the-decision)
8. [Failure Modes In Run Comparison](#failure-modes-in-run-comparison)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Comparison Is A Model Decision With Evidence
<!-- section-summary: Comparing runs means judging candidates against a baseline, guardrails, segments, artifacts, and release constraints. -->

Comparing experiment runs is the step where tracked evidence turns into a model decision. The team has several runs, each with parameters, metrics, artifacts, data versions, code commits, environment records, and notes. The comparison asks which candidate should move forward, which should stop, and which needs another experiment.

The title answer is straightforward: **comparing experiment runs means evaluating candidates side by side against the same baseline and validation evidence, then choosing a model based on product metrics, guardrails, segment behavior, runtime readiness, and known risk**. A leaderboard score is part of the decision. The release story around that score is the part that protects production.

This article builds directly on the previous two. Reproducibility gives you the ingredients. Tracking stores those ingredients in run records. Comparison uses those records to decide what happens next.

If you are the person reviewing the run table, start with the product decision instead of the biggest number. Ask whether the candidate improves the product, respects the guardrails, has the files needed for release, and leaves a rollback path the operations team can trust.

## Follow One Defect Detection Review
<!-- section-summary: The running scenario follows a computer vision team choosing a surface defect detector for a factory line. -->

Imagine **BrightForge Electronics**, a manufacturer that inspects tablet screens before packaging. Cameras above each line capture images of screens, and a computer vision model flags scratches, dust blobs, pressure marks, and edge chips. The current production model is `surface-defect-detector:v21`, a YOLO-style detector served through a GPU-backed inspection service.

The quality engineering team has a problem. Line C started using a new protective film, and the old model confuses film glare with scratches. Too many good screens are sent to manual inspection, slowing the shift lead's queue. At the same time, the team must catch real edge chips because defective units create expensive returns.

The review owner is Elena, the MLOps engineer supporting the vision team. She has six tracked runs from a new training batch:

- Three runs fine-tuned `yolov8s-defect` with heavier glare augmentation.
- Two runs used a larger `yolov8m-defect` model.
- One run kept the old model architecture and adjusted the confidence threshold.

The shared validation dataset is `defect_frames_2026_06_holdout:v3`, built from 28,000 labeled images across Lines A, B, and C. The primary metric is `mAP@0.5` for defect localization. Guardrails include scratch recall, edge-chip recall, false rejects per 1,000 screens, Line C glare false positives, and p95 inference latency.

## Start With A Shared Baseline
<!-- section-summary: A fair comparison starts with a baseline evaluated on the same dataset and metric definitions as the candidates. -->

A **baseline** is the reference point for the comparison. For a production replacement, the most useful baseline is the current production model evaluated on the same validation dataset as the candidates. That shared dataset keeps the conversation focused on model changes instead of hidden data changes.

BrightForge uses this baseline record:

```yaml
baseline:
  model: surface-defect-detector:v21
  mlflow_run_id: 9a82c5a331e044e2b3fd8c0f52841c10
  validation_dataset: defect_frames_2026_06_holdout:v3
  code_commit: 77b31af
  container_image: ghcr.io/brightforge/vision-eval@sha256:8d10c2
  metrics:
    map_50: 0.842
    scratch_recall: 0.903
    edge_chip_recall: 0.881
    false_rejects_per_1000: 18.4
    line_c_glare_false_positive_rate: 0.071
    p95_latency_ms: 44
```

The dataset line matters as much as the score lines. If a candidate uses `defect_frames_2026_07_holdout:v1` while the baseline uses the June holdout, the comparison mixes model behavior with a data shift. Elena should rerun the baseline or rerun the candidate so the evidence lines up.

This is the moment where a reviewer can save the team from a bad decision. If you see mismatched datasets, mismatched thresholds, or missing artifacts, pause the comparison and fix the evidence first.

The metric definitions need the same care. If one run calculates false rejects per image and another calculates false rejects per inspected screen, the numbers can mislead the review. A shared evaluation script and attached metric report prevent that confusion.

## Build A Comparison Table
<!-- section-summary: The comparison table should include the primary metric, guardrails, runtime, data version, and run identity. -->

The comparison table is where reviewers first see the tradeoffs. It should include the current baseline, the candidate runs, the shared dataset, the primary metric, guardrails, and runtime checks. A useful table tells the team which candidates deserve deeper inspection and which candidates fail obvious constraints.

For BrightForge, the first pass might look like this:

| Run | Model change | mAP@0.5 | Scratch recall | Edge-chip recall | False rejects / 1000 | Line C glare FP | p95 latency |
|---|---|---:|---:|---:|---:|---:|---:|
| `v21-baseline` | Current production | 0.842 | 0.903 | 0.881 | 18.4 | 0.071 | 44 ms |
| `run-1142` | YOLOv8s + glare aug | 0.856 | 0.917 | 0.887 | 14.9 | 0.041 | 46 ms |
| `run-1208` | YOLOv8s + glare aug + threshold | 0.852 | 0.908 | 0.884 | 12.6 | 0.035 | 46 ms |
| `run-1317` | YOLOv8m + glare aug | 0.864 | 0.922 | 0.891 | 13.8 | 0.033 | 71 ms |
| `run-1420` | Old architecture + threshold | 0.839 | 0.897 | 0.879 | 11.9 | 0.030 | 43 ms |

Run `1317` has the highest primary metric, yet its latency may exceed the inspection service budget. Run `1420` reduces false rejects, although it gives up defect recall. Runs `1142` and `1208` are the realistic candidates because they improve glare behavior while staying close to the existing latency profile.

![BrightForge experiment run comparison table](/content-assets/articles/article-mlops-experiments-and-reproducibility-compare-experiment-runs/brightforge-comparison-table.png)
*BrightForge compares each candidate against baseline v21 on the same holdout dataset, so metric and latency tradeoffs stay visible.*

MLflow can produce this comparison table from tracked runs. The Python API is often easier to review than a manual spreadsheet because the script can live in the repository and use the same filters every week.

```python
import mlflow

experiment_name = "surface-defect-detection"
validation_dataset = "defect_frames_2026_06_holdout:v3"

runs = mlflow.search_runs(
    experiment_names=[experiment_name],
    filter_string=f"tags.validation_dataset = '{validation_dataset}'",
    output_format="pandas",
)

columns = [
    "run_id",
    "tags.model_change",
    "metrics.map_50",
    "metrics.scratch_recall",
    "metrics.edge_chip_recall",
    "metrics.false_rejects_per_1000",
    "metrics.line_c_glare_false_positive_rate",
    "metrics.p95_latency_ms",
    "tags.code.commit",
]

review_table = (
    runs[columns]
    .sort_values(
        by=["metrics.map_50", "metrics.false_rejects_per_1000"],
        ascending=[False, True],
    )
    .head(10)
)

print(review_table.to_markdown(index=False))
```

Weights & Biases can support the same workflow through project workspaces, tables, reports, and the public API. Many teams use the UI for interactive review and keep a small script for repeatable weekly comparison exports.

## Inspect Segments And Failure Examples
<!-- section-summary: Segment checks and example artifacts reveal product risks that aggregate metrics can hide. -->

After the first table, Elena should inspect segments. A computer vision defect detector can improve the average score while regressing on a small defect class, a new camera angle, or one factory line. The model review should look at groups that map to real operational risk.

BrightForge tracks these segments:

| Segment | Why it matters |
|---|---|
| `line_a`, `line_b`, `line_c` | Each line has different lighting, camera placement, and operators |
| `scratch`, `dust_blob`, `pressure_mark`, `edge_chip` | Each defect class has a different customer impact |
| `night_shift`, `day_shift` | Lighting and queue pressure differ by shift |
| `new_film_batch`, `old_film_batch` | The current incident centers on film glare |
| `small_defect_area` | Tiny defects are easier to miss |

The strongest candidate should include an artifact with failure examples. For vision models, this is often more useful than another scalar metric. Reviewers need to see images where the baseline failed and the candidate improved, plus images where the candidate introduced a new error.

```yaml
review_artifacts:
  run_id: run-1208
  files:
    - artifacts/model.onnx
    - artifacts/confusion_by_defect_class.csv
    - artifacts/line_shift_metrics.csv
    - artifacts/false_positive_gallery.html
    - artifacts/false_negative_gallery.html
    - artifacts/sample_predictions/line_c_glare_*.jpg
```

Those artifacts help the quality team make a practical decision. If `run-1208` removes most glare false positives while preserving edge-chip recall, it may deserve a shadow test. If it misses tiny edge chips on Line B, the team may need another dataset slice before release.

![BrightForge segment and failure example review for run-1208](/content-assets/articles/article-mlops-experiments-and-reproducibility-compare-experiment-runs/brightforge-segment-failure-review.png)
*Segment checks and failure galleries help Elena see whether `run-1208` fixes the Line C glare issue while protecting scratch and edge-chip detection.*

## Check Artifacts And Runtime Readiness
<!-- section-summary: A candidate must have the files and runtime evidence needed for registry, shadow testing, or release. -->

A model candidate can win the metric table and still fail readiness. The release path needs files and checks that the serving system can use. For BrightForge, the inspection service expects an ONNX model, a class label map, a preprocessing config, an input image contract, and a latency report from the same GPU class used in production.

The readiness checklist should sit next to the metrics:

| Check | Evidence expected for BrightForge |
|---|---|
| Model artifact | `model.onnx` attached to the run and load-tested |
| Preprocessing | `preprocess.yaml` matches production resize, normalization, and color order |
| Label map | `label_map.json` matches `scratch`, `dust_blob`, `pressure_mark`, `edge_chip` |
| Input contract | Test images include expected dimensions, channels, and metadata fields |
| Runtime | p95 latency under 55 ms on `nvidia-l4-inspection` worker |
| Safety guardrail | Edge-chip recall stays at or above baseline minus the approved tolerance |
| Rollback | Current production model `surface-defect-detector:v21` remains available |
| Owner | Quality engineering and MLOps both signed the review note |

An evaluation job can write a runtime report into the run artifacts:

```json
{
  "candidate_run": "run-1208",
  "model_artifact": "s3://brightforge-mlflow-artifacts/run-1208/model.onnx",
  "hardware": "nvidia-l4-inspection",
  "batch_size": 1,
  "input_shape": [1, 3, 1024, 1024],
  "p50_latency_ms": 31,
  "p95_latency_ms": 46,
  "p99_latency_ms": 54,
  "max_gpu_memory_mb": 1820,
  "load_test_images": 5000,
  "contract_check": "passed"
}
```

This runtime evidence keeps the review grounded. Run `1317` may have the best score, yet the larger model misses the p95 latency budget. Run `1208` has slightly lower mAP and a release-ready artifact set, so it can be the stronger candidate for the next stage.

## Choose A Candidate And Record The Decision
<!-- section-summary: The final comparison output should name the candidate, baseline, evidence, risks, and next step. -->

The output of run comparison is a decision record. It should name the selected candidate, the baseline, the shared dataset, the reason, known risks, owners, and the next step. This record belongs in the tracking tool, a W&B Report, an MLflow tag or artifact, a model registry entry, or the team's approval system.

BrightForge can write a decision like this:

```yaml
model_review_decision:
  selected_candidate: surface-defect-detector run-1208
  baseline: surface-defect-detector:v21
  validation_dataset: defect_frames_2026_06_holdout:v3
  selected_by:
    - elena@brightforge.example
    - quality-review@brightforge.example
  reason:
    - mAP@0.5 improved from 0.842 to 0.852
    - false rejects dropped from 18.4 to 12.6 per 1000 screens
    - Line C glare false positive rate dropped from 0.071 to 0.035
    - p95 latency stayed under the 55 ms inspection budget
    - model artifact, preprocessing config, label map, and runtime report are attached
  known_risks:
    - edge-chip recall improved only slightly, so canary monitoring must watch this class
    - new film batch labels came from one week of data, so shadow test should collect more examples
  next_step: register candidate and run a two-shift shadow test on Line C
  rollback: keep surface-defect-detector:v21 active for production decisions
```

The decision record prevents the common "which run did we choose?" problem. It also gives release, monitoring, and incident response teams the facts they need after the model leaves the experiment workspace.

## Failure Modes In Run Comparison
<!-- section-summary: Bad comparisons often come from mismatched data, weak baselines, missing artifacts, and unclear release criteria. -->

Run comparison can go wrong even when every run is tracked. The most common issue is mismatched evidence. A candidate may use a newer validation dataset, a different label policy, or a changed threshold. The table still has numbers, yet the numbers answer different questions.

Watch for these problems:

| Problem | How the team catches it |
|---|---|
| Different validation snapshots | Filter runs by `validation_dataset` and rerun mismatched candidates |
| Missing baseline on the same data | Evaluate production model with the same script and dataset |
| Primary metric hides product risk | Add guardrails and segment tables before selecting a candidate |
| Strong score lacks artifacts | Block promotion until model, schema, reports, and examples are attached |
| Candidate passes offline checks and fails serving | Require runtime load test and input-contract artifact |
| Decision lives only in chat | Attach a decision YAML, W&B Report, MLflow artifact, or registry note |

The practical lesson is that comparison is an engineering workflow with a complete evidence packet. The team decides from tracked runs, fair baseline, consistent data, product metrics, guardrails, artifacts, runtime checks, and a written next step.

## Putting It Together
<!-- section-summary: A strong comparison picks a candidate through fair evidence, operational checks, and a recorded decision. -->

Comparing experiment runs means using tracked evidence to choose a model candidate responsibly. Start with the current production baseline, evaluate every candidate on the same dataset and metric definitions, build a table with primary metrics and guardrails, inspect segments and failure examples, check runtime readiness, and write the decision.

For BrightForge Electronics, `run-1208` wins because it reduces Line C glare false positives, keeps latency inside the inspection budget, preserves defect recall, and has the artifacts needed for a shadow test. The team can explain the choice because the comparison links the selected run back to its baseline, dataset, code, config, metrics, artifacts, risks, and rollback path.

![BrightForge run comparison decision path](/content-assets/articles/article-mlops-experiments-and-reproducibility-compare-experiment-runs/brightforge-decision-path.png)
*The final decision path keeps baseline evidence, guardrails, artifacts, runtime checks, shadow testing, and rollback in one review story.*

## References

- [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) - Official MLflow guide for tracking and comparing runs with parameters, metrics, tags, and artifacts.
- [MLflow Search Runs](https://mlflow.org/docs/latest/ml/search/search-runs/) - Official MLflow guide for querying runs through the UI and Python API.
- [MLflow Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/) - Official MLflow API guide for programmatic run logging and retrieval.
- [W&B Experiments](https://docs.wandb.ai/models/track) - Official W&B guide for experiment tracking and run metrics.
- [W&B Reports](https://docs.wandb.ai/models/reports) - Official W&B guide for organizing runs, visualizations, and findings in review documents.
- [W&B Artifacts](https://docs.wandb.ai/models/artifacts) - Official W&B guide for tracking versioned datasets and model artifacts.
