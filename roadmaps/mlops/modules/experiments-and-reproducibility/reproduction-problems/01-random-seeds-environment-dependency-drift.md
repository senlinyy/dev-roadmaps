---
title: "Seeds and Environment"
description: "Track random seeds, data order, package versions, containers, CUDA, hardware, and dataset snapshots so repeated training runs can be explained."
overview: "A training run depends on code plus hidden inputs: random seeds, data order, dependency locks, container images, CUDA, hardware, and dataset snapshots. This guide follows a computer vision defect model and shows the replay packet teams keep when they need repeatable training evidence."
tags: ["MLOps", "production", "debugging"]
order: 1
id: "article-mlops-experiments-and-reproducibility-random-seeds-environment-dependency-drift"
---

## Table of Contents

1. [What Seeds and Environment Control](#what-seeds-and-environment-control)
2. [The Defect Detection Run We Want to Repeat](#the-defect-detection-run-we-want-to-repeat)
3. [Random Seeds and Data Order](#random-seeds-and-data-order)
4. [Environment and Dependency Drift](#environment-and-dependency-drift)
5. [GPU, CUDA, and Runtime Differences](#gpu-cuda-and-runtime-differences)
6. [The Replay Packet](#the-replay-packet)
7. [Operating Checks](#operating-checks)
8. [Putting It Together](#putting-it-together)
9. [What's Next](#whats-next)
10. [References](#references)

## What Seeds and Environment Control
<!-- section-summary: Seeds and environment are hidden run inputs that can change a model even when the training script is unchanged. -->

**Seeds and environment** are the hidden inputs around a training run. A seed controls pseudo-random choices such as data shuffling, sample selection, weight initialization, and random augmentation. The environment covers the container image, Python version, package versions, CUDA libraries, operating system libraries, hardware, thread counts, and runtime flags that execute the same training code.

That answer matters early because many beginners start reproduction by asking, "Did anyone change `train.py`?" Code is important, and it is only one ingredient in the run. If you rerun the same command with a different dataset snapshot, a new PyTorch build, a different CUDA runtime, or a GPU kernel that chooses a different execution path, the model can land in a slightly different place.

Picture a computer vision team at **Vela Circuit Works**. They train a model named `solder-joint-defect-detector` to flag cracked solder joints from high-resolution camera images on a printed circuit board line. The team wants to compare a June model with a replay in July after a production station reports more false alarms on shiny boards. The first question is simple: did the model really change, or did the training ingredients around the model change?

Here are the ingredients this article connects:

| Ingredient | Plain-English meaning | Example evidence |
|---|---|---|
| Random seeds | Numbers used to repeat random choices in code | `seed: 20260701` for Python, NumPy, PyTorch, and data shuffling |
| Data snapshot | The exact training examples and labels | `lakefs://vision-lake/pcb-inspection@9f4c2a1` |
| Dependency lock | The package versions installed into the run | `requirements.lock`, `conda-lock.yml`, or `uv.lock` |
| Container image | The packaged runtime used for training | `registry.vela.ai/ml/pcb-trainer:2026-07-01@sha256:...` |
| Hardware and CUDA | The accelerator, drivers, and GPU math libraries | `NVIDIA L4`, CUDA `12.4`, cuDNN `9.1` |
| Runtime flags | Settings that choose deterministic or faster paths | `torch.use_deterministic_algorithms(true)` and data-loader worker count |

![Hidden run inputs around a Vela Circuit Works defect model.](/content-assets/articles/article-mlops-experiments-and-reproducibility-random-seeds-environment-dependency-drift/hidden-run-inputs.png)

*The same `train.py` file sits beside hidden inputs such as the seed, data order, lockfile, image digest, and GPU runtime, so replay evidence has to record the full run context.*

The goal is practical. You want a run record that lets a teammate replay the same training job later, see what changed, and decide whether a small metric movement is normal training noise or evidence of a real pipeline change.

## The Defect Detection Run We Want to Repeat
<!-- section-summary: A concrete reproduction target makes seeds and environment easier to reason about because every hidden input has a place in the run record. -->

Vela Circuit Works trains from images stored in object storage and labels reviewed by the manufacturing quality team. Every image belongs to a board revision, a line, a camera station, and a timestamp. The model predicts defect classes such as `crack`, `bridge`, `void`, and `ok`.

The June run is the one the team wants to preserve. It trained an EfficientNet-style classifier on a frozen image snapshot, wrote metrics to MLflow, saved the model artifact, and registered the model after a review. The platform team wants future runs to carry enough evidence that any replay can answer, "same data, same code, same environment, same seeds, same hardware, and close enough metrics?"

The run record should be specific instead of vague:

```yaml
run:
  run_id: pcb-vision-2026-06-30-2140
  model_name: solder-joint-defect-detector
  model_version: 18
  code_commit: 6c8f2a9
  training_entrypoint: train.py
  config: configs/pcb_defects/prod_l4.yml
data:
  snapshot: lakefs://vision-lake/pcb-inspection@9f4c2a1
  train_manifest: manifests/train_2026_06_30.parquet
  validation_manifest: manifests/val_2026_06_30.parquet
  label_schema: solder_labels_v4
metrics:
  val_macro_f1: 0.932
  crack_recall: 0.911
  bridge_precision: 0.947
```

Notice how this packet names the run, code, data, config, and metrics. It still needs the hidden inputs that often cause confusion during replay. The rest of the article fills those in.

## Random Seeds and Data Order
<!-- section-summary: Seeds control random choices, while data order controls which examples arrive in each batch and how the optimizer moves through training. -->

A **random seed** is a number given to a pseudo-random generator so a program can repeat the same sequence of random choices. In machine learning, those choices can appear in many places: train and validation splits, image augmentation, batch shuffling, dropout, model initialization, negative sampling, and hyperparameter search. Recording one seed in a notebook is useful, and production replay usually needs the seed wired through each library that makes random choices.

For the Vela image model, random augmentation is part of training. The model sees rotated boards, brightness changes, random crops, and small blur operations so it can handle real camera variation. Those augmentations help the model generalize, and they also make replay sensitive to the random generator state. If a replay uses a new seed or a new data-loader order, batch one may contain a different set of boards, and the optimizer may take a different path.

A PyTorch training script usually sets seeds near process startup:

```python
import os
import random

import numpy as np
import torch

SEED = 20260701

os.environ["PYTHONHASHSEED"] = str(SEED)
random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
torch.cuda.manual_seed_all(SEED)

torch.use_deterministic_algorithms(True)
torch.backends.cudnn.benchmark = False
```

The important detail is that the seed reaches Python, NumPy, PyTorch CPU operations, and PyTorch CUDA operations. `torch.use_deterministic_algorithms(True)` asks PyTorch to use deterministic operations where PyTorch supports them, and `torch.backends.cudnn.benchmark = False` avoids the cuDNN benchmarking path that can select different kernels after measuring input shapes.

Data-loader workers also need attention because each worker process can have its own random state. The seed should reach the worker and the shuffle generator:

```python
from torch.utils.data import DataLoader

def seed_worker(worker_id: int) -> None:
    worker_seed = (torch.initial_seed() + worker_id) % 2**32
    np.random.seed(worker_seed)
    random.seed(worker_seed)

generator = torch.Generator()
generator.manual_seed(SEED)

train_loader = DataLoader(
    train_dataset,
    batch_size=64,
    shuffle=True,
    num_workers=8,
    worker_init_fn=seed_worker,
    generator=generator,
)
```

This setup gives the run a much better chance of repeating its data order and augmentations on the same platform. It still cannot promise bit-for-bit equality across every PyTorch release, CUDA release, and GPU type. That is why the seed belongs next to the environment details rather than standing alone as the whole reproduction plan.

![Seed fan-out across Python, NumPy, PyTorch, CUDA, data-loader workers, batch order, and augmentations.](/content-assets/articles/article-mlops-experiments-and-reproducibility-random-seeds-environment-dependency-drift/seed-data-order.png)

*The seed has to reach each source of random choice, while the data-loader order and image augmentations still shape the sequence of boards seen during training.*

## Environment and Dependency Drift
<!-- section-summary: Dependency drift happens when the packages, system libraries, or container base image change between runs. -->

**Dependency drift** is the quiet change that happens when a package, system library, container base image, or solver result changes between training runs. A `pip install -r requirements.txt` command can resolve a different transitive dependency later if the file leaves versions open. A Docker tag such as `latest` can point to a different image after a rebuild. A preprocessing package can change how it handles image metadata, missing values, or category ordering.

For a beginner, the safest habit is to record two layers. The first layer is a lockfile that says exactly which Python packages were installed. The second layer is the container image digest that says exactly which operating system files, CUDA libraries, Python runtime, and application files ran the job. A tag is useful for humans, while a digest is the immutable evidence.

Here is a small example of a locked Python environment for the image trainer:

```bash
python -m pip install pip-tools
pip-compile pyproject.toml --generate-hashes --output-file requirements.lock
python -m pip install --require-hashes -r requirements.lock
```

The useful part is the `requirements.lock` file. It should include exact versions and hashes, then travel with the code commit. Teams using conda can generate a platform-specific lock as well:

```bash
conda-lock lock --file environment.yml --platform linux-64
conda-lock install --name pcb-replay conda-lock.yml
```

The container image should be built and recorded with a tag plus digest:

```bash
docker build \
  -t registry.vela.ai/ml/pcb-trainer:run-2026-06-30 \
  .

docker push registry.vela.ai/ml/pcb-trainer:run-2026-06-30

docker image inspect \
  --format='{{index .RepoDigests 0}}' \
  registry.vela.ai/ml/pcb-trainer:run-2026-06-30
```

Example output:

```console
registry.vela.ai/ml/pcb-trainer@sha256:4bc2a6e8f8f3c0d2c7f4a8e9f1b6c5d4a3e2b1c0f9d8e7a6b5c4d3e2f1a0b9c8
```

This digest belongs in the tracking run. If a teammate replays the model three months later, they can pull the digest instead of hoping the old tag still points to the same bytes. The same habit applies to base images, CUDA images, and internal trainer images.

## GPU, CUDA, and Runtime Differences
<!-- section-summary: Hardware, CUDA, cuDNN, thread counts, and distributed settings can change numerical paths even when code and packages match. -->

Deep learning code runs through layers of numerical software. Your Python script calls PyTorch, PyTorch calls CUDA and cuDNN, and those libraries choose kernels that execute on the GPU. Some operations have deterministic implementations, and some operations can use parallel reductions or atomic operations where execution order may vary. Tiny floating-point differences can later change which weights the optimizer reaches.

Vela trains the June model on one NVIDIA L4 GPU. A July replay might run on an A10G because the cluster had spare capacity there. The code commit and lockfile can match, and the replay can still produce slightly different scores. That difference may be acceptable, especially if it stays inside a tolerance the team already agreed on.

Modern production fleets often mix accelerator classes. A team may use L4 or L40S nodes for smaller vision training, batch scoring, and inference, while larger deep learning or generative AI jobs may use H100, H200, B200, GH200, or other Blackwell-generation systems. The lesson for reproducibility is the same across all of them: record the exact GPU SKU, node pool, driver, CUDA runtime, cuDNN version, container digest, and distributed-training settings. The word "GPU" is too vague for an investigation.

Record hardware and runtime details next to the run:

```yaml
runtime:
  container_image: registry.vela.ai/ml/pcb-trainer@sha256:4bc2a6e8f8f3
  python: "3.11.8"
  pytorch: "2.5.1"
  cuda_runtime: "12.4"
  cudnn: "9.1"
  gpu:
    name: "NVIDIA L4"
    count: 1
    driver: "550.54"
  cpu_threads: 16
  dataloader_workers: 8
  deterministic_algorithms: true
  cublas_workspace_config: ":4096:2"
```

The runtime fields help reviewers separate a real modeling change from a platform change. If the replay runs on the same image digest and same GPU class, a close metric match is stronger evidence. If the replay runs on a different GPU, the comparison should say that directly instead of hiding it in a log file.

This is also where scikit-learn and tabular preprocessing enter the story. Even a computer vision project often uses scikit-learn for splitting, metrics, calibration, or metadata models. A changed `random_state`, a changed cross-validation splitter, or an inconsistent preprocessing path can alter the evaluation result around the vision model. The run packet should record those package versions and the exact metric code commit too.

## The Replay Packet
<!-- section-summary: A replay packet groups the code, data, environment, seeds, runtime, metrics, and artifacts a future teammate needs for investigation. -->

A **replay packet** is the evidence bundle for a training run. It can live as an MLflow artifact, a YAML file in object storage, a model registry note, or a generated report attached to the run. The format matters less than the completeness and the habit. A teammate should not need to read old chat threads to know which image, data snapshot, seed, and artifact belonged to a model.

Here is a practical packet for the Vela defect model:

```yaml
replay_packet_version: 1
model:
  name: solder-joint-defect-detector
  version: 18
  registry_alias: production
  release_state: serving
tracking:
  system: mlflow
  experiment: pcb-defect-detection
  run_id: pcb-vision-2026-06-30-2140
  artifact_uri: s3://vela-ml-artifacts/pcb-defects/runs/pcb-vision-2026-06-30-2140
code:
  repo: git@github.com:vela-circuit/ml-vision.git
  commit: 6c8f2a9
  entrypoint: train.py
  config: configs/pcb_defects/prod_l4.yml
data:
  system: lakefs
  snapshot: lakefs://vision-lake/pcb-inspection@9f4c2a1
  train_manifest_sha256: 9a4fb2c7
  validation_manifest_sha256: 41d2f0aa
randomness:
  python_seed: 20260701
  numpy_seed: 20260701
  torch_seed: 20260701
  dataloader_seed: 20260701
environment:
  image_digest: registry.vela.ai/ml/pcb-trainer@sha256:4bc2a6e8f8f3
  dependency_lock: requirements.lock
  python: "3.11.8"
  pytorch: "2.5.1"
  scikit_learn: "1.5.2"
  cuda_runtime: "12.4"
runtime:
  gpu_name: "NVIDIA L4"
  gpu_count: 1
  dataloader_workers: 8
  deterministic_algorithms: true
metrics:
  val_macro_f1: 0.932
  crack_recall: 0.911
  bridge_precision: 0.947
artifacts:
  model_file: model/model.safetensors
  model_sha256: 1022c8d9
  evaluation_report: reports/eval_2026_06_30.json
  confusion_matrix: reports/confusion_matrix.png
```

![Replay packet evidence bundle for the Vela defect detector.](/content-assets/articles/article-mlops-experiments-and-reproducibility-random-seeds-environment-dependency-drift/replay-packet.png)

*A useful replay packet groups code, data, randomness, environment, runtime, metrics, and artifact hashes so the team can judge whether the replay stayed within tolerance.*

A training script can log much of this packet automatically. The script already knows the seed, config path, package versions, and metrics. The platform wrapper usually knows the image digest, GPU type, Git commit, and dataset snapshot. Record those values during the run instead of asking a human to reconstruct them during an incident.

For MLflow, teams often log the packet as a YAML artifact and add searchable tags:

```python
import mlflow

mlflow.set_tag("code_commit", "6c8f2a9")
mlflow.set_tag("data_snapshot", "lakefs://vision-lake/pcb-inspection@9f4c2a1")
mlflow.set_tag("image_digest", "registry.vela.ai/ml/pcb-trainer@sha256:4bc2a6e8f8f3")
mlflow.set_tag("seed", "20260701")
mlflow.log_artifact("replay_packet.yml", artifact_path="reproducibility")
```

Those tags make the run searchable from the UI and API. The artifact keeps the complete packet for review, audits, and replay scripts.

## Operating Checks
<!-- section-summary: Reproduction work needs a few routine checks so teams know which differences are expected and which differences need investigation. -->

A reproduction packet helps only if the team reviews it consistently. The goal is to make hidden inputs visible during normal training, not only during urgent debugging. The Vela team can add a small reproducibility review to every candidate model before registry promotion.

Use checks like these:

| Check | What good evidence shows |
|---|---|
| Seed coverage | Python, NumPy, framework, data-loader, and split seeds are logged |
| Dataset snapshot | Training and validation snapshots point to immutable DVC, lakeFS, Delta, Iceberg, or object-version IDs |
| Lockfile | The package lock used by the job is stored with the run |
| Container image | The run records an image digest, not only a mutable tag |
| CUDA and hardware | GPU model, driver, CUDA runtime, and cuDNN version are logged |
| Determinism flags | Deterministic mode, cuDNN benchmark setting, worker count, and thread count are visible |
| Metric tolerance | The team has a written tolerance for replay differences by metric and segment |
| Artifact hashes | Model file and evaluation report hashes are recorded when exact artifacts matter |

The tolerance line is important. For Vela, a replay might pass if `val_macro_f1` changes by less than `0.002`, crack recall changes by less than `0.004`, and the confusion matrix has no new high-severity defect blind spot. A larger movement sends the team back through data snapshot, environment, seed, hardware, and metric-code checks.

The team can turn the checks into a CI gate around the training launcher:

```yaml
reproducibility_gate:
  required_fields:
    - code.commit
    - data.snapshot
    - environment.image_digest
    - environment.dependency_lock
    - randomness.torch_seed
    - runtime.gpu_name
    - metrics.val_macro_f1
  fail_if_missing: true
  warn_if:
    image_tag_without_digest: true
    unlocked_dependencies: true
    deterministic_flags_missing: true
```

This gate is not about making every model bit-for-bit identical forever. It gives the team enough evidence to explain the model they trained and enough structure to replay it honestly.

## Putting It Together
<!-- section-summary: Seeds help repeat random choices, and environment records explain the runtime that made those choices matter. -->

Seeds control random choices, and the environment controls the software and hardware path that executes the training run. A reproducible run records both. For the Vela defect model, the useful packet names the seed, data snapshot, code commit, dependency lock, Docker image digest, CUDA stack, hardware, metrics, and artifact hashes.

When a replay differs, the team can compare evidence instead of guessing. They can ask whether the data snapshot changed, whether the lockfile changed, whether the container digest changed, whether GPU hardware changed, whether PyTorch or scikit-learn versions changed, and whether the metric movement sits inside the agreed tolerance.

## What's Next
<!-- section-summary: The next article follows a model version back through registry, tracking, code, data, environment, replay, and comparison. -->

Next we use these ingredients to reproduce an old training run. The workflow starts from a model version in the registry and follows the evidence back to the exact run that produced it.

## References

- [PyTorch Reproducibility Notes](https://docs.pytorch.org/docs/stable/notes/randomness.html) - Official notes on randomness, deterministic algorithms, release differences, platform differences, and reproducibility limits.
- [PyTorch deterministic algorithms](https://docs.pytorch.org/docs/stable/generated/torch.use_deterministic_algorithms.html) - API reference for requesting deterministic algorithm behavior where PyTorch supports it.
- [PyTorch CUDA environment variables](https://docs.pytorch.org/docs/stable/cuda_environment_variables.html) - Official reference for CUDA-related environment variables, including `CUBLAS_WORKSPACE_CONFIG`.
- [scikit-learn common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html) - Official guidance on inconsistent preprocessing, data leakage, and randomness controls.
- [MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/) - Official tracking documentation for runs, metrics, parameters, tags, and artifacts.
- [MLflow Dataset Tracking](https://mlflow.org/docs/latest/ml/dataset/) - Official dataset tracking documentation for dataset lineage and reproducibility evidence.
- [DVC data versioning](https://doc.dvc.org/start) - Official DVC guide for tracking data with Git metadata and restoring data versions.
- [lakeFS concepts](https://docs.lakefs.io/understand/model/) - Official lakeFS model for commits, branches, tags, and data version references.
- [Docker image tag reference](https://docs.docker.com/reference/cli/docker/image/tag/) - Official Docker reference for image names, repositories, tags, and image references.
- [conda-lock](https://conda.github.io/conda-lock/) - Official conda-lock documentation for reproducible conda environment lock files.
- [NVIDIA GPU Operator platform support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html) - Official NVIDIA support reference for active data center GPU platforms and Kubernetes GPU operation.
