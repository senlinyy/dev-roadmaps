---
title: "Distributed Training"
description: "Learn how distributed data parallel training splits batches across workers, uses ranks and world size, launches PyTorch DDP with torchrun, and survives real cluster failures."
overview: "Distributed training lets one training run use multiple GPU workers together. This guide follows a computer vision team moving from one GPU to PyTorch DistributedDataParallel on Kubernetes, with ranks, world size, checkpoints, failure handling, and NCCL/CUDA evidence."
tags: ["MLOps", "advanced", "compute"]
order: 2
id: "article-mlops-training-pipelines-distributed-training-basics"
---

## Table of Contents

1. [Why One GPU Stops Being Enough](#why-one-gpu-stops-being-enough)
2. [The Core Idea: Data Parallel Training](#the-core-idea-data-parallel-training)
3. [Workers, Ranks, and World Size](#workers-ranks-and-world-size)
4. [Turning a PyTorch Script into DDP](#turning-a-pytorch-script-into-ddp)
5. [Launching with torchrun](#launching-with-torchrun)
6. [Running the Job on Kubernetes](#running-the-job-on-kubernetes)
7. [Checkpoints and Failure Handling](#checkpoints-and-failure-handling)
8. [NCCL and CUDA Evidence](#nccl-and-cuda-evidence)
9. [Where Ray and Spark Fit](#where-ray-and-spark-fit)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

## Why One GPU Stops Being Enough
<!-- section-summary: Distributed training lets one model training run use several workers together when one GPU takes too long for the business window. -->

Distributed training means **one training job runs across multiple worker processes** so the team can train a model with more compute than one process can provide. In this article, we focus on the most common beginner path: **distributed data parallel training** with PyTorch. Each worker has a copy of the model, each worker sees a different slice of the batch, and the workers synchronize gradients so they keep learning as one shared training run.

Imagine a company called TrailCam Health. The product team helps wildlife clinics classify camera-trap images so vets can review injured animals faster. The first model was trained on one GPU with 400,000 labeled images. Now the dataset has grown to 18 million images, the model is larger, and the weekly retraining window is six hours. One GPU takes almost two days. The team has a Kubernetes GPU pool with four H100 nodes available overnight, so the training pipeline needs to use those GPUs together.

This is the moment where distributed training enters the roadmap. The practical goal is clear: finish inside the window, record enough evidence to debug failures, and produce a checkpoint the evaluation pipeline can trust. You still need clean data, a training script, a validation split, experiment tracking, and artifact storage. Distributed training adds the coordination layer that lets several workers act like one training job.

Here is the map for the article:

| Concept | Plain meaning | Why TrailCam needs it |
|---|---|---|
| **Data parallel training** | Several workers train the same model on different data batches | The image dataset is too large for the weekly single-GPU window |
| **Worker** | One training process doing part of the job | Each GPU usually gets one worker process |
| **Rank** | The number that identifies a worker | Logs, checkpoints, and networking need a stable worker identity |
| **World size** | Total number of workers in the job | Four nodes with one GPU each means a world size of 4 |
| **torchrun** | PyTorch's launcher for distributed worker processes | It sets the environment variables DDP uses |
| **DistributedDataParallel** | PyTorch wrapper that synchronizes gradients across model replicas | Each worker trains locally, then the replicas stay aligned |
| **Checkpoint** | Saved training state that can resume the run | A node eviction should cost minutes rather than a full training day |
| **NCCL/CUDA evidence** | GPU communication and runtime facts from the job | Slow or stuck training needs driver, CUDA, NCCL, and topology evidence |

![TrailCam data parallel training](/content-assets/articles/article-mlops-training-pipelines-distributed-training-basics/trailcam-data-parallel-training.png)
*Data parallel training keeps a full model replica on each worker while the dataset shards and gradient synchronization make the workers act like one run.*

The rest of the article follows that table in order. We start with the simple training pattern, then add worker identity, then add real commands and cluster checks.

## The Core Idea: Data Parallel Training
<!-- section-summary: Data parallel training keeps the model logic mostly the same while splitting batches across workers and synchronizing gradients. -->

**Data parallel training** is the easiest distributed training pattern to understand because the model stays whole on every worker. Worker 0 has a full copy of the model. Worker 1 has a full copy of the model. The same is true for workers 2 and 3. During each training step, every worker reads a different mini-batch, runs forward and backward passes locally, and then participates in a communication step that combines gradients across workers.

For TrailCam, that means worker 0 might process deer and fox images from shard A, worker 1 might process bird images from shard B, worker 2 might process night images from shard C, and worker 3 might process clinic-uploaded edge cases from shard D. The exact labels are secondary to DDP. The important part is that each worker receives a different slice of the training data for the same step. If every worker reads the same examples, the team pays for four GPUs while getting one GPU's learning signal repeated four times.

The gradient synchronization is the key behavior. A gradient is the model's update signal after it sees a batch. In DistributedDataParallel, PyTorch synchronizes those gradients across model replicas, usually through a backend such as NCCL for GPU training. After the optimizer step, each replica has matching updated weights, so the run still behaves like one training job rather than four separate experiments.

This pattern changes how you think about batch size. If each worker processes 64 images and the world size is 4, the **global batch size** is 256 images per step. That larger batch can change learning behavior, so production teams usually record:

- Per-worker batch size: `64`
- World size: `4`
- Global batch size: `256`
- Learning rate schedule: `cosine_decay_warmup_2k`
- Gradient accumulation steps: `1`
- Random seed and data manifest version

Those fields belong in the run metadata because they explain the training result. A validation score needs world size and global batch size beside it, or the review packet is missing part of the story.

## Workers, Ranks, and World Size
<!-- section-summary: Ranks and world size give every worker a shared language for identity, logging, device choice, and coordination. -->

A **worker** is one training process. In GPU DDP, the common beginner setup uses one worker process per GPU. A worker loads the training code, chooses its local GPU, builds the model, reads its slice of data, computes gradients, and joins the synchronization step.

A **rank** is the worker's identity number inside the whole job. Rank 0 is usually the coordinator for user-facing logs, checkpoint pointers, and final metric reports. Rank 1, rank 2, and the other ranks do the same training work, yet they avoid duplicate side effects. If all four ranks upload the same `best.pt` file at the same time, the run can corrupt its own evidence. The common rule is simple: every rank trains, rank 0 publishes shared artifacts unless you use a distributed checkpoint format.

**World size** is the total number of workers. If TrailCam runs four workers, the world size is 4. If each of two nodes has eight GPUs and every GPU gets one worker, the world size is 16. The world size matters because it controls data partitioning, gradient communication, effective batch size, and the amount of work the cluster must schedule at the same time.

There are two rank names you will see constantly:

| Name | Example | Meaning |
|---|---:|---|
| `RANK` | `7` | Global worker number across the full job |
| `LOCAL_RANK` | `3` | Worker number inside the current node |
| `WORLD_SIZE` | `16` | Total workers in the full job |
| `LOCAL_WORLD_SIZE` | `8` | Workers on the current node |
| `MASTER_ADDR` | `trailcam-ddp-0.trailcam-ddp` | Address used for process group setup |
| `MASTER_PORT` | `29400` | Port used for process group setup |

TrailCam uses these names in logs. A useful training log line includes `rank`, `local_rank`, `world_size`, `node_name`, `gpu_name`, `cuda_version`, and the dataset shard. That sounds boring until a job hangs for 40 minutes and the team needs to know whether rank 2 failed before the data loader, rank 0 rejected rendezvous traffic, or NCCL selected the wrong network interface.

## Turning a PyTorch Script into DDP
<!-- section-summary: A DDP script initializes the process group, pins each worker to a GPU, shards the DataLoader, and limits shared side effects to rank 0. -->

The single-GPU version of the TrailCam training script already has a model, optimizer, loss function, and DataLoader. DDP keeps most of that code. The important changes happen around setup, data loading, model wrapping, and saving.

PyTorch's `DistributedDataParallel` wraps a module and synchronizes gradients across the process group. PyTorch's docs call out an important detail: DDP synchronizes gradients, and the user remains responsible for splitting input data across workers, often with `DistributedSampler`. That is why the DataLoader section matters as much as the model wrapper.

Here is a compact version of `train_ddp.py`:

```python
import os
from pathlib import Path

import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data import DataLoader
from torch.utils.data.distributed import DistributedSampler

from trailcam.data import TrailCamImageDataset
from trailcam.model import TrailCamClassifier


def setup_distributed():
    local_rank = int(os.environ["LOCAL_RANK"])
    torch.cuda.set_device(local_rank)
    dist.init_process_group(backend="nccl")
    return local_rank, dist.get_rank(), dist.get_world_size()


def save_checkpoint(path, model, optimizer, epoch, step, metrics):
    state = {
        "model": model.module.state_dict(),
        "optimizer": optimizer.state_dict(),
        "epoch": epoch,
        "step": step,
        "metrics": metrics,
    }
    torch.save(state, path)


def main():
    local_rank, rank, world_size = setup_distributed()
    device = torch.device(f"cuda:{local_rank}")

    dataset = TrailCamImageDataset(
        manifest_uri=os.environ["TRAIN_MANIFEST_URI"],
        image_root=os.environ["TRAIN_IMAGE_ROOT"],
    )
    sampler = DistributedSampler(
        dataset,
        num_replicas=world_size,
        rank=rank,
        shuffle=True,
        drop_last=False,
    )
    loader = DataLoader(
        dataset,
        batch_size=64,
        sampler=sampler,
        num_workers=8,
        pin_memory=True,
    )

    model = TrailCamClassifier(num_classes=42).to(device)
    model = DDP(model, device_ids=[local_rank], output_device=local_rank)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=0.01)
    loss_fn = torch.nn.CrossEntropyLoss()

    for epoch in range(20):
        sampler.set_epoch(epoch)
        model.train()
        for step, batch in enumerate(loader):
            images = batch["image"].to(device, non_blocking=True)
            labels = batch["label"].to(device, non_blocking=True)

            optimizer.zero_grad(set_to_none=True)
            logits = model(images)
            loss = loss_fn(logits, labels)
            loss.backward()
            optimizer.step()

            if rank == 0 and step % 200 == 0:
                print(
                    {
                        "epoch": epoch,
                        "step": step,
                        "world_size": world_size,
                        "loss": float(loss.detach().cpu()),
                    },
                    flush=True,
                )

        if rank == 0:
            checkpoint_dir = Path(os.environ["CHECKPOINT_DIR"])
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            save_checkpoint(
                checkpoint_dir / "last.pt",
                model,
                optimizer,
                epoch,
                step,
                {"world_size": world_size},
            )

    dist.destroy_process_group()


if __name__ == "__main__":
    main()
```

The setup code reads `LOCAL_RANK` from the environment and binds the process to one GPU. `dist.init_process_group(backend="nccl")` lets PyTorch read rendezvous details from environment variables that the launcher provides. The sampler receives `num_replicas=world_size` and `rank=rank`, so every worker gets its own slice of the dataset. `sampler.set_epoch(epoch)` changes the shuffle order consistently across epochs.

The checkpoint function saves from rank 0 because this example uses classic DDP with full model replicas. Bigger training approaches such as FSDP can shard model state, and PyTorch's Distributed Checkpoint API exists for those sharded cases. For this beginner article, rank 0 checkpointing keeps the first DDP move understandable.

## Launching with torchrun
<!-- section-summary: torchrun starts the worker processes and supplies the rank, world size, and rendezvous environment used by DDP. -->

**torchrun** is PyTorch's command-line launcher for distributed training. It starts multiple worker processes on each training node and provides the environment variables that `init_process_group` reads. For GPU DDP, PyTorch recommends NCCL as the backend because it is designed for high-performance GPU communication.

The smallest local smoke test uses one node with four GPUs:

```bash
TRAIN_MANIFEST_URI=s3://trailcam-ml/manifests/train-2026-07-05.json \
TRAIN_IMAGE_ROOT=s3://trailcam-ml/images/ \
CHECKPOINT_DIR=/mnt/checkpoints/trailcam-ddp-smoke \
torchrun \
  --standalone \
  --nnodes=1 \
  --nproc-per-node=4 \
  train_ddp.py
```

The important flags are:

- `--standalone` creates a local rendezvous for a single-node test.
- `--nnodes=1` tells PyTorch there is one node in this run.
- `--nproc-per-node=4` starts four worker processes on the node.
- The script receives `LOCAL_RANK`, `RANK`, `WORLD_SIZE`, `MASTER_ADDR`, and `MASTER_PORT` through the environment.

The multi-node shape adds a rendezvous endpoint and a node rank:

```bash
torchrun \
  --nnodes=4 \
  --nproc-per-node=1 \
  --node-rank="${NODE_RANK}" \
  --rdzv-id="trailcam-weekly-2026-07-05" \
  --rdzv-backend=c10d \
  --rdzv-endpoint="trailcam-ddp-0.trailcam-ddp:29400" \
  train_ddp.py
```

Each node runs the same command with a different `NODE_RANK`. The rendezvous endpoint gives the workers a shared place to meet. In Kubernetes, that endpoint is often a stable DNS name for the pod with index 0 in an Indexed Job, or it is provided by a training operator that sets up the workers for you.

## Running the Job on Kubernetes
<!-- section-summary: Kubernetes Jobs give the training run a batch lifecycle, while Indexed Jobs can give each worker a stable index for node rank assignment. -->

Kubernetes is useful for this example because training has a clear batch shape. The job starts, reserves GPUs, runs the training script, writes checkpoints, exits, and leaves logs plus status behind. A long-running web service has a different lifecycle. A training run fits the Job controller well because success and failure are first-class states.

Kubernetes Jobs support parallel completions, and **Indexed Jobs** give each pod an index from `0` to `completions - 1`. The index is available to the container as `JOB_COMPLETION_INDEX`. TrailCam can use that value as `NODE_RANK` when each pod owns one GPU.

This teaching manifest shows the core DDP mapping. Real teams usually add node selectors, tolerations, secrets, object-storage credentials, priority classes, quotas, log shipping, and sometimes a training operator. The same mapping still shows up inside those larger systems.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: trailcam-ddp
spec:
  clusterIP: None
  selector:
    batch.kubernetes.io/job-name: trailcam-ddp
---
apiVersion: batch/v1
kind: Job
metadata:
  name: trailcam-ddp
spec:
  completions: 4
  parallelism: 4
  completionMode: Indexed
  backoffLimit: 2
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      subdomain: trailcam-ddp
      restartPolicy: Never
      containers:
        - name: trainer
          image: registry.example.com/ml/trailcam-trainer:2026-07-05
          imagePullPolicy: IfNotPresent
          resources:
            limits:
              nvidia.com/gpu: 1
          env:
            - name: TRAIN_MANIFEST_URI
              value: s3://trailcam-ml/manifests/train-2026-07-05.json
            - name: TRAIN_IMAGE_ROOT
              value: s3://trailcam-ml/images/
            - name: CHECKPOINT_DIR
              value: /checkpoints/trailcam-weekly-2026-07-05
          command:
            - bash
            - -lc
            - |
              torchrun \
                --nnodes=4 \
                --nproc-per-node=1 \
                --node-rank="${JOB_COMPLETION_INDEX}" \
                --rdzv-id="trailcam-weekly-2026-07-05" \
                --rdzv-backend=c10d \
                --rdzv-endpoint="trailcam-ddp-0.trailcam-ddp:29400" \
                train_ddp.py
          volumeMounts:
            - name: checkpoints
              mountPath: /checkpoints
      volumes:
        - name: checkpoints
          persistentVolumeClaim:
            claimName: trailcam-training-checkpoints
```

The important Kubernetes choices are practical. `completionMode: Indexed` gives every pod a stable index. `parallelism: 4` asks Kubernetes to run all four workers together. `restartPolicy: Never` gives failed pods a clear terminal state that the Job controller can count. `backoffLimit: 2` allows a small number of pod retries before the Job fails. `ttlSecondsAfterFinished` lets the cluster clean up finished Job objects after operators have had time to inspect them.

A production review packet for this job should capture the image digest, GPU node pool, GPU SKU, driver version, CUDA runtime, NCCL version, dataset manifest URI, checkpoint URI, world size, per-worker batch size, and the exact `torchrun` command. Without that packet, the team can still train a model, yet incident review and replay work will have holes.

![torchrun on Kubernetes indexed jobs](/content-assets/articles/article-mlops-training-pipelines-distributed-training-basics/torchrun-on-kubernetes.png)
*An Indexed Job gives each worker a stable pod index, which the launch command can use as `NODE_RANK` for a multi-node DDP run.*

## Checkpoints and Failure Handling
<!-- section-summary: Checkpoints turn distributed training failures into resumable events with clear ownership and evidence. -->

Distributed jobs fail in more ways than single-process jobs. A pod can get evicted. A node can lose a GPU. One worker can hit a bad file. The rendezvous endpoint can fail. NCCL can hang during initialization because workers disagree about network reachability. The response plan needs to assume those failures will happen.

A **checkpoint** is saved training state. For TrailCam's DDP example, a checkpoint needs the model state, optimizer state, epoch, step, scheduler state if one exists, run config, dataset manifest ID, and validation metric history. A checkpoint that only stores model weights is useful for inference, yet it lacks enough state to fully resume training because the optimizer and scheduler state are missing.

The simple DDP policy is:

- Rank 0 writes `last.pt` after every epoch and after every 2,000 steps.
- Rank 0 writes `best.pt` only after validation improves.
- The job writes to a durable path such as object storage or a mounted persistent volume.
- The job writes a small `latest.json` pointer after the checkpoint upload succeeds.
- The resume command reads `latest.json`, downloads the checkpoint, and starts from the recorded epoch and step.

Example `latest.json`:

```json
{
  "run_id": "trailcam-weekly-2026-07-05",
  "checkpoint_uri": "s3://trailcam-ml/checkpoints/trailcam-weekly-2026-07-05/last.pt",
  "epoch": 7,
  "step": 184000,
  "world_size": 4,
  "global_batch_size": 256,
  "manifest_uri": "s3://trailcam-ml/manifests/train-2026-07-05.json",
  "image_digest": "sha256:0c6d4f0f5d8c...",
  "validation_macro_f1": 0.891
}
```

The failure runbook should name owners. The platform owner checks Kubernetes events, pod states, GPU scheduling, and node health. The training owner checks the last successful checkpoint, validation trend, loss spike, and dataset errors. The incident owner decides whether to resume, reduce world size, switch to a smaller batch, or cancel the release training run.

A good first response uses evidence rather than guesses:

```bash
kubectl get job trailcam-ddp -o wide
kubectl get pods -l batch.kubernetes.io/job-name=trailcam-ddp -o wide
kubectl describe pod trailcam-ddp-2
kubectl logs job/trailcam-ddp --all-containers=true --tail=200
```

If one pod failed with an out-of-memory error, the team can reduce per-worker batch size and resume from the last checkpoint. If all pods are waiting for GPUs, the platform owner checks quota and node labels. If ranks started and then hung, the team moves to NCCL and network evidence.

## NCCL and CUDA Evidence
<!-- section-summary: NCCL and CUDA checks prove which GPU runtime, driver, device, and communication path the training job actually used. -->

**CUDA** is NVIDIA's GPU computing platform used by PyTorch builds that run on NVIDIA GPUs. **NCCL** is NVIDIA's communication library for multi-GPU and multi-node collectives, including the gradient synchronization DDP needs. When a distributed GPU job is slow or stuck, the team needs runtime evidence from inside the same container image and node pool that ran the job.

TrailCam's job should print a startup record from every rank:

```python
import os
import socket
import torch


def print_runtime_evidence():
    local_rank = int(os.environ["LOCAL_RANK"])
    torch.cuda.set_device(local_rank)
    print(
        {
            "host": socket.gethostname(),
            "rank": os.environ["RANK"],
            "local_rank": os.environ["LOCAL_RANK"],
            "world_size": os.environ["WORLD_SIZE"],
            "torch": torch.__version__,
            "cuda_runtime": torch.version.cuda,
            "nccl": torch.cuda.nccl.version(),
            "gpu": torch.cuda.get_device_name(local_rank),
            "device_count": torch.cuda.device_count(),
        },
        flush=True,
    )
```

The platform team should also capture node-level output:

```bash
nvidia-smi --query-gpu=index,name,driver_version,memory.total --format=csv
python -m torch.utils.collect_env
```

For a stuck communication issue, a short diagnostic rerun can enable NCCL logs:

```bash
NCCL_DEBUG=INFO \
NCCL_DEBUG_SUBSYS=INIT,ENV,COLL \
torchrun \
  --nnodes=4 \
  --nproc-per-node=1 \
  --node-rank="${NODE_RANK}" \
  --rdzv-id="trailcam-debug-2026-07-05" \
  --rdzv-backend=c10d \
  --rdzv-endpoint="trailcam-ddp-0.trailcam-ddp:29400" \
  train_ddp.py
```

Those variables belong in a debug run, then they should be removed from the normal job. NVIDIA's NCCL documentation warns that debugging variables can affect performance or reliability if teams leave them in production scripts. The evidence to keep is the log bundle, the exact env vars, and the conclusion.

Useful signs in the logs include all ranks reaching `init_process_group`, all ranks reporting the same `WORLD_SIZE`, each worker selecting a unique GPU, NCCL reporting the expected network interface, and rank 0 reaching the first training step. If rank 3 has no runtime evidence log, the issue is probably before DDP. If all ranks log startup and then hang in synchronization, the issue is probably communication, a rank-specific exception, or a data loader stall.

![Distributed checkpoint and runtime evidence](/content-assets/articles/article-mlops-training-pipelines-distributed-training-basics/checkpoint-runtime-evidence.png)
*Checkpoint pointers, failed-rank commands, and CUDA/NCCL startup records give the team a practical trail for resume and incident review.*

## Where Ray and Spark Fit
<!-- section-summary: Ray and Spark can surround distributed training, while the DDP basics still explain what happens inside the training workers. -->

Ray and Spark enter real MLOps stacks around this workflow, so it helps to place them while keeping the article focused. **Spark** often prepares large training datasets before the GPU job starts. TrailCam might use Spark to join image metadata, clinic labels, and quality flags into a manifest. Once the manifest exists, the PyTorch DDP job reads it and trains the model.

**Ray Train** can launch and manage distributed PyTorch workers through a higher-level Python API. Teams choose it when they want Python-native scaling, integration with Ray Data or Ray Tune, or a simpler way to run training across a Ray cluster. Underneath that convenience, the same basics still matter: worker count, GPU assignment, data sharding, checkpointing, and metrics from each worker.

For a first distributed training article, plain `torchrun` is the clearest teaching tool because it exposes the names that other platforms eventually manage for you. After you understand `RANK`, `WORLD_SIZE`, process groups, DDP, and checkpoint ownership, Ray Train, Kubeflow training operators, managed cloud training jobs, and scheduler-specific launchers are much easier to review.

## Putting It Together
<!-- section-summary: Distributed training works well when the team treats code, launch settings, checkpoints, and cluster evidence as one connected training system. -->

TrailCam's weekly retraining job started as one slow GPU run. Distributed training turned it into one coordinated job across four workers. Data parallel training kept a model replica on each worker, DDP synchronized gradients, and `DistributedSampler` kept the workers from reading the same examples. Ranks gave every worker a stable identity, and world size explained the global batch size.

The practical workflow is now clear. First, make the single-GPU script deterministic enough for replay and split the data with a manifest. Next, add DDP setup, local GPU assignment, `DistributedSampler`, rank-aware logging, and rank-aware checkpointing. Then launch a single-node smoke test with `torchrun`. After that, move to Kubernetes with a clear worker count, GPU request, rendezvous endpoint, durable checkpoint path, and failure policy. Finally, capture CUDA, NCCL, GPU, image, and dataset evidence every time the job runs.

The big lesson is that distributed training is an operations topic as much as a modeling topic. The code change is small compared with the evidence discipline around it. A team that records ranks, world size, batch sizes, checkpoint pointers, driver versions, CUDA runtime, NCCL version, dataset manifest, and Kubernetes events can debug the second and third runs from evidence rather than guesswork.

## References

- [PyTorch torchrun (Elastic Launch)](https://docs.pytorch.org/docs/stable/elastic/run.html)
- [PyTorch DistributedDataParallel API](https://docs.pytorch.org/docs/stable/generated/torch.nn.parallel.DistributedDataParallel.html)
- [PyTorch distributed communication package](https://docs.pytorch.org/docs/stable/distributed.html)
- [PyTorch Distributed Checkpoint API](https://docs.pytorch.org/docs/stable/distributed.checkpoint.html)
- [PyTorch Distributed Checkpoint recipe](https://docs.pytorch.org/tutorials/recipes/distributed_checkpoint_recipe.html)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes Job API reference](https://kubernetes.io/docs/reference/kubernetes-api/batch/job-v1/)
- [NVIDIA NCCL environment variables](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/env.html)
- [NVIDIA NCCL troubleshooting](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/troubleshooting.html)
- [NVIDIA GPU Operator platform support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [Ray Train PyTorch guide](https://docs.ray.io/en/latest/train/getting-started-pytorch.html)
