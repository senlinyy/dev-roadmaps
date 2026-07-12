---
title: "Training Cost and Quotas"
description: "Plan GPU training runs with quota requests, Kubernetes limits, interruptible capacity, budget guardrails, run cost tags, scheduling, and alerts."
overview: "Training cost and quotas are the practical controls that keep expensive GPU jobs from waiting forever, crowding out other teams, or surprising finance after the bill lands."
tags: ["MLOps", "advanced", "compute"]
order: 3
id: "article-mlops-training-pipelines-training-cost-and-quotas"
---

## Table of Contents

1. [The Problem: A Training Run That Needs More Than Code](#the-problem-a-training-run-that-needs-more-than-code)
2. [The Cost and Quota Map](#the-cost-and-quota-map)
3. [Cloud Quotas Before the First Large Run](#cloud-quotas-before-the-first-large-run)
4. [GPU Requests Inside Kubernetes](#gpu-requests-inside-kubernetes)
5. [Spot, Preemptible, and Low-Priority Training](#spot-preemptible-and-low-priority-training)
6. [Budget Guardrails and Run Cost Tags](#budget-guardrails-and-run-cost-tags)
7. [Scheduling the Shared GPU Fleet](#scheduling-the-shared-gpu-fleet)
8. [Alerts and Daily Checks](#alerts-and-daily-checks)
9. [Failure Modes](#failure-modes)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

This article connects the controls around expensive training work in one path. You will see how a team estimates the size of a run, asks the cloud provider for the right quota, requests GPUs in Kubernetes, chooses interruptible capacity carefully, tags every run with cost context, schedules shared GPU time, and sets alerts before the monthly bill turns into a surprise.

The running example is **HarborLens**, a marketplace for used camera gear. The team trains `photo-match-v3`, a PyTorch model that compares listing images, detects duplicate listings, and helps the search system show the best match first. The model uses 18 million product photos, click labels from `search_clicks`, return labels from `seller_returns`, and validation metrics such as `recall@20`, `false_duplicate_rate`, and `gpu_hours_per_run`.

Mia owns the model code, Raj owns the Kubernetes training platform, and Lina owns cloud cost review. Their problem is familiar in real MLOps work: the model team needs enough GPUs to train on time, the platform team needs the cluster to stay fair, and finance needs enough tags and alerts to understand why a run cost money.

## The Problem: A Training Run That Needs More Than Code
<!-- section-summary: Training cost and quotas are the controls that decide how much GPU training a team can run, where it can run, and when the spend needs attention. -->

Training cost is the money spent to produce a model run. For HarborLens, that includes GPU instance time, CPU driver pods, temporary disks, object storage reads, checkpoint writes, container pulls, W&B or MLflow tracking, and sometimes network transfer. The training script may only say `python train.py`, yet the bill sees a larger system around that script.

A quota is a limit on how much infrastructure the team can request. Cloud providers usually apply quotas by account, subscription, project, region, VM family, accelerator family, and purchase type. Kubernetes can add another quota inside the cluster, often by namespace or queue. That means a training run can fail in two very different places: the cloud account may lack enough GPU capacity allowance, or the Kubernetes namespace may lack enough local GPU quota.

HarborLens learns this during a weekly retraining push. Mia changes the image encoder from a small ResNet model to a transformer model and asks for eight GPUs. The job sits pending for an hour. Raj checks the cluster and finds only four GPUs available in the `ml-training` namespace. Then Lina checks the cloud account and sees the region also has a low GPU quota for the target instance family. The code is fine, the data is ready, and the team still cannot train.

That is the point of cost and quota planning. It turns an expensive training run into a reviewed request with a size, owner, reason, budget, schedule, checkpoint plan, and alert path. The controls are practical, and they help the team say yes to the right jobs without letting one experiment consume the whole GPU fleet.

## The Cost and Quota Map
<!-- section-summary: A training run needs a small map that connects model intent, GPU shape, quota pool, budget owner, scheduler path, and alert owner. -->

Before HarborLens asks for quota, the team writes the run shape in plain terms. The run shape explains what the model needs and why it needs it. This matters because quota requests, Kubernetes manifests, budget alerts, and experiment tags should all describe the same job instead of four separate stories.

Here is the map Raj asks every training job owner to fill out. It is small enough to review in a pull request, and it gives Lina enough information to understand the cost later.

| Question | HarborLens answer | Why it matters |
| --- | --- | --- |
| What is the job? | `photo-match-v3` weekly full retrain | Names the workload for tags, alerts, and reviews. |
| Who owns it? | Mia from Search ML | Gives finance and platform a human owner. |
| What data does it read? | `s3://harborlens-features/photo-match/2026-07-01/` | Connects spend to a dataset snapshot. |
| What hardware does it need? | 4 x NVIDIA L40S for normal runs, 8 x H100 for rare benchmark runs | Separates daily training from larger experiments. |
| How long should it run? | 6 hours target, 9 hours maximum | Sets timeout and alert thresholds. |
| Can it restart? | Yes, from 10-minute checkpoints | Decides whether Spot or low-priority capacity is acceptable. |
| What is the budget? | 900 USD per weekly retrain, 2,500 USD per benchmark run | Gives alerts a number to compare against. |
| What metric justifies the run? | `recall@20 >= 0.942` and `false_duplicate_rate <= 0.015` | Keeps cost tied to model value. |

![HarborLens cost and quota map](/content-assets/articles/article-mlops-training-pipelines-training-cost-and-quotas/harborlens-cost-quota-map.png)
*The run map keeps owner, dataset, GPU shape, runtime target, budget, checkpoints, and quota approvals in the same review conversation.*

The important idea is **cost intent**. Cost intent means the team records the expected spend before the run starts, not after the invoice arrives. A run that needs eight H100 GPUs for a benchmark can still be valid. The team simply wants that decision to leave evidence in the training config, tracking run, cloud tags, and scheduler queue.

The job config carries that intent into automation. HarborLens keeps a config like this next to the training code:

```yaml
run_name: photo-match-v3-weekly
owner: search-ml
cost_center: ml-search
cloud_provider: aws
region: us-east-1
gpu_sku: l40s
requested_gpus: 4
max_runtime_hours: 9
budget_usd: 900
interruptible: true
checkpoint:
  uri: s3://harborlens-model-checkpoints/photo-match-v3/
  interval_minutes: 10
tracking:
  tool: wandb
  project: photo-match-training
dataset:
  snapshot_uri: s3://harborlens-features/photo-match/2026-07-01/
  label_table: warehouse.search_clicks_2026_07_01
```

This file teaches a useful habit. The model code still controls learning rate, batch size, and epochs. The run config controls operational facts: owner, GPU shape, region, budget, checkpoint path, and whether interruption is acceptable. When those facts live in a file, the platform can validate them before the job touches a GPU.

## Cloud Quotas Before the First Large Run
<!-- section-summary: Cloud quotas should be requested with the same evidence as a production change: region, GPU family, purchase type, run schedule, owner, and fallback plan. -->

A cloud quota is the provider-side limit that decides how many resources an account, project, or subscription can request. In training work, the quota that hurts most often is accelerator capacity. The team may need quota for a GPU VM family, accelerator count, vCPU count, local SSD, managed training cluster, or low-priority pool.

The exact wording changes by provider. AWS EC2 groups many instance quotas by purchasing option and instance family, including separate quota names for On-Demand and Spot accelerated families such as P, G, DL, Trn, and Inf. Google Cloud Compute Engine has allocation quotas for CPUs, GPUs, local SSDs, and preemptible resources; Spot VMs with GPUs may use standard quota unless preemptible quota has been granted in that region. Azure Machine Learning uses workspace and subscription quotas, with compute limits split by region and VM family, and Azure documents low-priority VM behavior separately from dedicated capacity.

The practical habit stays the same. The team asks for quota in the same region where the data, network, and cluster already live. It asks for the specific GPU family it plans to use, and it separates routine training from benchmark training. HarborLens does not ask for "more GPUs" as a vague request. It asks for the quota needed to run two weekly L40S jobs at the same time and one quarterly H100 benchmark after approval.

Here is the quota request packet Lina expects before she approves the request:

```yaml
quota_request:
  workload: photo-match-v3 weekly retrain
  owner: search-ml
  provider: aws
  account: production-ml-training
  region: us-east-1
  capacity_type: on-demand-and-spot
  routine_gpu_pool:
    sku: NVIDIA L40S
    max_parallel_jobs: 2
    gpus_per_job: 4
    expected_hours_per_job: 6
  benchmark_gpu_pool:
    sku: NVIDIA H100
    max_parallel_jobs: 1
    gpus_per_job: 8
    expected_hours_per_job: 10
    approval_required: true
  fallback:
    smaller_sku: NVIDIA L4
    behavior: slower embedding refresh for non-urgent retrains
  cost_controls:
    monthly_budget_usd: 9000
    alert_channels:
      - search-ml-oncall
      - finops-review
```

This packet gives the cloud team enough detail to request quota before the model launch week. It also prevents a common training failure: a team gets quota for the wrong region, wrong VM family, or wrong purchase type. The job may still wait for real capacity during busy periods, because quota grants permission to request resources and capacity depends on what the provider can allocate at that moment.

The quota review should happen before the Kubernetes review. If the cloud account can only run four GPUs in the target family, a namespace quota of sixteen GPUs only creates a nicer error message. Provider quota is the outer limit. Kubernetes quota is the shared-cluster limit inside that outer limit.

## GPU Requests Inside Kubernetes
<!-- section-summary: Kubernetes only schedules a GPU job correctly when the job declares the accelerator resource and the namespace has enough GPU quota. -->

Kubernetes scheduling is the process of matching a Pod to a Node that can run it. A GPU Node has accelerator hardware, drivers, container runtime support, and usually labels or taints that keep regular workloads away from the expensive hardware. The NVIDIA GPU Operator can help platform teams install and manage the NVIDIA driver, device plugin, container toolkit, node labels, and monitoring components across supported Kubernetes platforms.

The GPU device plugin exposes GPUs to Kubernetes as an extended resource, commonly `nvidia.com/gpu`. Kubernetes treats that resource differently from CPU and memory. A training container usually requests GPUs under `limits`, and if both `requests` and `limits` are used for GPUs, Kubernetes expects the two values to match. This matters because a GPU cannot be overcommitted like CPU in the normal Kubernetes resource model.

Raj gives the `ml-training` namespace a hard quota so one team cannot take every GPU in the cluster. Kubernetes ResourceQuota uses the `requests.` prefix for extended resources such as `nvidia.com/gpu`.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: ml-training-gpu-quota
  namespace: ml-training
spec:
  hard:
    requests.cpu: "96"
    requests.memory: "768Gi"
    requests.nvidia.com/gpu: "8"
    pods: "20"
```

This quota says the namespace can request up to eight GPUs across running Pods. It also caps CPU, memory, and Pod count so the GPU jobs cannot overload the namespace with helper containers. The quota belongs to the namespace, so a second ML team can have a different namespace and a different limit.

Mia's training job then asks for four GPUs. The job also selects the GPU node pool, tolerates the GPU taint, sets a timeout, and cleans up after completion. Those fields make the job easier to operate because the cluster has enough information to place, stop, and clean up the run.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: photo-match-v3-weekly-20260705
  namespace: ml-training
  labels:
    app: photo-match
    owner: search-ml
    cost-center: ml-search
    run-type: weekly-retrain
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 32400
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: OnFailure
      nodeSelector:
        accelerator: nvidia-l40s
      tolerations:
        - key: "dedicated"
          operator: "Equal"
          value: "gpu-training"
          effect: "NoSchedule"
      containers:
        - name: trainer
          image: registry.example.com/ml/photo-match-trainer:2026.07.05
          command: ["python", "-m", "training.train"]
          args:
            - "--config=/configs/photo-match-v3-weekly.yaml"
          env:
            - name: RUN_NAME
              value: "photo-match-v3-weekly-20260705"
            - name: CHECKPOINT_URI
              value: "s3://harborlens-model-checkpoints/photo-match-v3/"
          resources:
            requests:
              cpu: "24"
              memory: "160Gi"
            limits:
              cpu: "24"
              memory: "160Gi"
              nvidia.com/gpu: "4"
```

Several details carry cost control. `nodeSelector` keeps the job on the intended GPU pool. `tolerations` lets it run on nodes reserved for training. `activeDeadlineSeconds` stops a runaway run after nine hours. `ttlSecondsAfterFinished` removes finished job objects after one day, which keeps the namespace readable. Labels carry owner and cost center data into cluster metrics.

When the job waits, Raj checks the same facts in a simple order:

```bash
kubectl -n ml-training describe quota ml-training-gpu-quota
kubectl -n ml-training get pods -l app=photo-match
kubectl -n ml-training describe pod photo-match-v3-weekly-20260705-abcde
kubectl get nodes -l accelerator=nvidia-l40s
```

These commands separate the failure types. The quota output shows whether the namespace has enough GPU allowance. The Pod events show scheduling errors such as missing tolerations, node selector mismatch, or insufficient `nvidia.com/gpu`. The node list confirms whether the expected GPU pool is visible to the cluster.

![GPU request inside Kubernetes](/content-assets/articles/article-mlops-training-pipelines-training-cost-and-quotas/gpu-request-kubernetes.png)
*A pending GPU job can fail at the namespace quota, job request, node-pool label, or pod-event layer, so the runbook checks each one in order.*

## Spot, Preemptible, and Low-Priority Training
<!-- section-summary: Interruptible capacity can lower training cost when the job saves checkpoints, tolerates restart, and has a clear fallback to regular capacity. -->

Interruptible capacity means the provider can reclaim the machine while the job is running. AWS calls this Spot Instances. Google Cloud uses Spot VMs and still documents legacy preemptible VMs. Azure uses Spot Virtual Machines, and Azure Machine Learning exposes low-priority compute choices for jobs that can handle interruption.

This choice is attractive for training because many training runs can restart from checkpoints. If `photo-match-v3` saves a checkpoint every ten minutes, an interruption wastes at most a small slice of work plus startup time. If the run only writes a model at the very end, an interruption can waste hours. The cost decision depends on the restart design, not only the discount.

The team uses this decision table:

| Workload | Capacity choice | Reason |
| --- | --- | --- |
| Weekly retrain with 10-minute checkpoints | Spot or low-priority first, On-Demand fallback after two interruptions | Saves cost while keeping the weekly deadline safe. |
| Quarterly architecture benchmark | On-Demand or reserved capacity | The run compares model changes, so repeated interruptions would muddy the result. |
| Small smoke test | Cheapest available GPU pool | The job is short, and rerunning it costs little. |
| Hotfix retrain after a bad release | On-Demand | The business needs predictable completion more than a discount. |

Provider behavior also shapes the checkpoint plan. AWS Spot interruption notices give a two-minute warning before EC2 stops or terminates the instance in the common stop or terminate flow. Google Cloud Spot VMs can be preempted at any time, have no minimum or maximum runtime by default, and the default shutdown path gives a short best-effort window for shutdown scripts. Azure Spot VMs can be evicted when Azure needs capacity or when price rules trigger, and Azure documents a 30-second notice with Deallocate or Delete eviction policies.

HarborLens puts this into code by making checkpointing part of the training loop rather than a platform afterthought.

```python
import os
import time
from pathlib import Path

import torch


def should_checkpoint(last_checkpoint_at: float, interval_minutes: int) -> bool:
    elapsed_seconds = time.time() - last_checkpoint_at
    return elapsed_seconds >= interval_minutes * 60


def save_checkpoint(model, optimizer, step: int, checkpoint_dir: str) -> str:
    checkpoint_path = Path(checkpoint_dir) / f"step-{step}.pt"
    torch.save(
        {
            "step": step,
            "model_state": model.state_dict(),
            "optimizer_state": optimizer.state_dict(),
        },
        checkpoint_path,
    )
    return str(checkpoint_path)


checkpoint_dir = os.environ["CHECKPOINT_DIR"]
checkpoint_interval_minutes = int(os.getenv("CHECKPOINT_INTERVAL_MINUTES", "10"))
last_checkpoint_at = time.time()

for step, batch in enumerate(train_loader, start=1):
    loss = train_step(batch)

    if should_checkpoint(last_checkpoint_at, checkpoint_interval_minutes):
        path = save_checkpoint(model, optimizer, step, checkpoint_dir)
        tracker.log({"checkpoint/step": step, "checkpoint/path": path})
        last_checkpoint_at = time.time()
```

This code does two useful things for cost. First, it limits wasted GPU time after interruption. Second, it records checkpoint evidence in the tracking system, so the incident review can answer a concrete question: how much work did the interruption waste?

## Budget Guardrails and Run Cost Tags
<!-- section-summary: Budget guardrails catch spend at the account level, while W&B and MLflow tags explain which training run created the spend. -->

Budget guardrails are rules that notify the team when spending crosses a threshold. AWS Budgets, Google Cloud Billing budgets, and Azure Cost Management budgets can all alert teams as actual or forecasted costs approach a limit. These tools operate at billing scope, so they are excellent for account or project spend. They usually need good tags, labels, projects, subscriptions, or resource groups to connect spend back to a team.

Training systems need a second layer inside experiment tracking. Cloud billing may tell Lina that the `production-ml-training` account spent more this week. W&B or MLflow can tell Mia which run requested eight GPUs, which dataset snapshot it used, which queue admitted it, whether it used Spot capacity, and which model metric justified the spend.

HarborLens uses the same cost fields in cloud resource labels and tracking run metadata. The fields are boring on purpose: stable names make dashboards, filters, and chargeback reports easier to maintain.

```python
import os

import mlflow
import wandb


cost_context = {
    "owner": "search-ml",
    "cost_center": "ml-search",
    "run_budget_usd": 900,
    "cloud_provider": "aws",
    "region": "us-east-1",
    "gpu_sku": "nvidia-l40s",
    "requested_gpus": 4,
    "interruptible": True,
    "quota_pool": "ml-training-l40s",
    "checkpoint_uri": "s3://harborlens-model-checkpoints/photo-match-v3/",
}

run_tags = {
    "owner": cost_context["owner"],
    "cost_center": cost_context["cost_center"],
    "gpu_sku": cost_context["gpu_sku"],
    "quota_pool": cost_context["quota_pool"],
    "interruptible": str(cost_context["interruptible"]).lower(),
}

with mlflow.start_run(run_name=os.environ["RUN_NAME"], tags=run_tags):
    mlflow.log_params(cost_context)
    mlflow.set_tag("budget.usd", str(cost_context["run_budget_usd"]))
    mlflow.set_tag("checkpoint.uri", cost_context["checkpoint_uri"])

    with wandb.init(
        project="photo-match-training",
        name=os.environ["RUN_NAME"],
        config=cost_context,
        tags=["weekly-retrain", "ml-search", "gpu-l40s", "interruptible"],
    ) as run:
        run.log({"cost/gpu_hours_estimate": 24, "quality/recall_at_20": 0.944})
```

MLflow tags and params make the run searchable in the MLflow UI and API. W&B config and tags make the run filterable in W&B projects. The goal is the same for both tools: the training run should carry cost context next to model context. A run that lacks `owner`, `cost_center`, `gpu_sku`, and `budget.usd` should fail review before it consumes expensive hardware.

The budget guardrail then has two levels:

| Guardrail | Owner | Example threshold | Action |
| --- | --- | --- | --- |
| Cloud monthly budget | Lina | 70%, 90%, 110% of 9,000 USD | Notify FinOps and Search ML. |
| Run budget | Mia | 900 USD expected weekly retrain | Pause next scheduled run until review. |
| GPU-hour budget | Raj | 200 L40S GPU-hours per week | Queue new low-priority jobs behind approved jobs. |
| Missing cost tags | Platform admission policy | Required tags absent | Reject the job before scheduling. |

This split keeps responsibility clear. Finance watches account spend. The ML team watches run value. The platform team watches shared hardware pressure.

## Scheduling the Shared GPU Fleet
<!-- section-summary: Scheduling decides which GPU jobs run first, which jobs wait, and which jobs can use cheaper or interruptible capacity. -->

Scheduling has two meanings in training platforms. First, a workflow scheduler such as Airflow, Dagster, Argo Workflows, Kubeflow Pipelines, or a managed pipeline service decides when the training job should start. Second, the Kubernetes scheduler and any batch queue decide where the Pods run inside the cluster. Cost-aware training needs both pieces.

HarborLens uses a simple weekly schedule for normal retraining and a manual approval gate for benchmark runs. The workflow submits Kubernetes Jobs only after data validation passes and budget fields are present. That keeps the cluster from spending GPU time on a run that would later fail because the label table is missing or the run lacks owner tags.

The shared GPU fleet then uses queues. In a small cluster, namespace ResourceQuota and PriorityClass may be enough. In a larger cluster, Kubernetes-native batch tools such as Kueue can manage admission, resource flavors, borrowing, and fair sharing across teams. Kueue is useful when the team has several GPU shapes, such as L4 for small experiments, L40S for normal training, and H100 for approved large jobs.

The HarborLens schedule policy is intentionally plain:

| Queue | Who uses it | Hardware | Admission rule |
| --- | --- | --- | --- |
| `gpu-smoke` | Any ML engineer | L4 or small shared GPU | Short jobs under 30 minutes. |
| `gpu-weekly` | Production model owners | L40S | Scheduled retrains with budget tags and passing data checks. |
| `gpu-benchmark` | Approved model changes | H100 | Manual approval, run budget, and rollback owner required. |
| `gpu-backfill` | Offline feature refresh | Spot or low-priority pool | Runs only when capacity is cheap and checkpoints exist. |

Priority should reflect business need, not seniority or who shouted first. A hotfix retrain after a bad model release can preempt a long experiment. A weekly retrain can wait behind a customer-impacting incident job. A benchmark run can wait until the approved window.

The platform review checks four fields before admitting a scheduled training job:

```yaml
admission_checks:
  required_labels:
    - owner
    - cost-center
    - run-type
  required_runtime_controls:
    - activeDeadlineSeconds
    - checkpoint_uri
    - max_runtime_hours
  required_resource_controls:
    - cpu_request
    - memory_request
    - nvidia.com/gpu_limit
  required_finops_controls:
    - run_budget_usd
    - quota_pool
    - interruptible
```

This policy gives Mia a clear path. If the job is urgent, she marks the run type and gets approval. If the job is exploratory, it goes through the lower-priority queue. If the job lacks a checkpoint path, it cannot use Spot or low-priority capacity because an interruption would waste too much work.

## Alerts and Daily Checks
<!-- section-summary: Good alerts connect pending jobs, GPU-hour burn, budget thresholds, missing tags, and interruption rates to the people who can act. -->

Alerts should answer one question: who needs to do something now? A budget email that nobody owns creates noise. A Kubernetes pending Pod alert with the job owner, queue, GPU request, and quota pool gives the right person a path to action.

HarborLens uses four alert families. The first catches cloud spend. The second catches Kubernetes pressure. The third catches tracking metadata gaps. The fourth catches job health and interruption loops.

| Alert | Signal | Owner | First action |
| --- | --- | --- | --- |
| Budget forecast above 90% | Cloud billing budget | Lina | Ask whether the next weekly retrain should pause. |
| GPU queue wait over 45 minutes | Pending training jobs | Raj | Check quota, node availability, and queue priority. |
| Run missing cost tags | MLflow or W&B run metadata | Mia | Fix the launcher and backfill metadata. |
| Same run interrupted twice | Job restart and checkpoint events | Mia and Raj | Move the run to regular capacity or reduce GPU count. |
| GPU quota 80% used for the week | Namespace quota and GPU-hour dashboard | Raj | Hold exploratory runs until weekly jobs finish. |

The daily check is short. Raj looks at namespace quota, pending Pods, and GPU node health. Mia looks at the tracking dashboard for failed runs, missing tags, and metric value per GPU-hour. Lina looks at the cloud budget and cost allocation report by cost center.

![Budget queue and alert loop](/content-assets/articles/article-mlops-training-pipelines-training-cost-and-quotas/budget-queue-alert-loop.png)
*Cost control works best as a loop: tag the run, admit it through the right queue, check it daily, alert owners, and decide whether the next run should proceed.*

```bash
kubectl -n ml-training describe quota ml-training-gpu-quota
kubectl -n ml-training get jobs --sort-by=.metadata.creationTimestamp
kubectl get nodes -l accelerator=nvidia-l40s
```

The result should lead to a decision. If the quota is full because approved weekly runs are active, the team waits. If the quota is full because failed jobs never cleaned up, Raj deletes the stuck jobs and fixes TTL settings. If the cloud budget is trending high because benchmark jobs ran three times, Lina asks for a review before the next scheduled run.

The review also includes model value. A run that costs 700 USD and improves `recall@20` by 0.004 may be worth keeping. A run that costs 1,600 USD and changes no business metric needs a smaller experiment design next time. Cost control should protect learning, not block every expensive idea by default.

## Failure Modes
<!-- section-summary: Most training cost incidents come from quota mismatch, missing metadata, weak checkpointing, unclear queues, or alerts without owners. -->

The first common failure is **quota mismatch**. The team receives cloud quota for one region and schedules the job in another. Or the account has On-Demand quota while the autoscaler tries to launch Spot. The fix is a quota request packet that names region, GPU family, purchase type, and fallback. The scheduler config should use those same names so the platform cannot drift away from the approved pool.

The second failure is **pending Pods without a clear reason**. A Pod can wait because the namespace quota is full, the node selector points to the wrong label, the taint lacks a matching toleration, or the GPU device plugin is missing. The fix is a runbook that checks namespace quota, Pod events, node labels, and GPU operator health in that order.

The third failure is **cheap capacity without restart design**. Spot, preemptible, and low-priority pools can reduce cost, yet they require checkpoints, idempotent data loading, and a clean resume path. HarborLens treats checkpoint URI and interval as admission requirements for interruptible runs. If a training loop cannot resume, it uses regular capacity or a smaller smoke-test dataset.

The fourth failure is **cost without attribution**. Cloud billing shows spend, yet the team cannot connect the bill to a model run. The fix is shared tags: cloud labels, Kubernetes labels, MLflow tags, W&B tags, and config fields that use the same owner and cost center. The tracking run should answer who ran the job, what data it used, which GPU pool it used, how much spend was expected, and which metric justified the spend.

The fifth failure is **alerts without decision rights**. A budget alert sent to a large mailing list rarely changes behavior. HarborLens routes cloud budget alerts to Lina, GPU queue alerts to Raj, and run value alerts to Mia. Each alert has a first action, and the action can pause, reschedule, shrink, move, or approve the next run.

## Putting It Together
<!-- section-summary: A cost-aware training pipeline treats GPU spend as part of the training design, alongside data, code, metrics, and artifacts. -->

Training Cost and Quotas is about making expensive training work visible and reviewable. The title sounds like finance work, yet the best controls live close to the training pipeline. The model owner writes the run intent. The platform owner turns that intent into quota, scheduler, and Kubernetes controls. The finance owner watches budgets and asks for evidence when spend rises.

For HarborLens, the final workflow is steady. Mia submits a run config with owner, budget, GPU count, checkpoint path, and expected metric value. Raj's platform validates tags, namespace quota, GPU requests, timeouts, and queue choice. Lina's budget guardrails watch account spend and route alerts to the right owners. W&B or MLflow records the cost context beside the training metrics, so future reviews can compare quality gain against GPU-hours.

That is the practical outcome you want. A large GPU job can still run, and the team can explain why it ran, where it ran, how it was limited, how it would recover from interruption, and who gets paged when cost or queue pressure crosses the line.

## References

- [Kubernetes: Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [Kubernetes: Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/)
- [Kubernetes: Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kueue overview](https://kueue.sigs.k8s.io/docs/overview/)
- [NVIDIA GPU Operator overview](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/index.html)
- [NVIDIA GPU Operator platform support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [AWS EC2 instance type quotas](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html)
- [AWS Spot Instance interruption notices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html)
- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
- [AWS cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)
- [Google Cloud Compute Engine allocation quotas](https://docs.cloud.google.com/compute/resource-usage)
- [Google Cloud Spot VMs](https://docs.cloud.google.com/compute/docs/instances/spot)
- [Google Cloud budgets and budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [Azure Machine Learning quotas](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-manage-quotas?view=azureml-api-2)
- [Azure Spot Virtual Machines](https://learn.microsoft.com/en-us/azure/virtual-machines/spot-vms)
- [Azure Cost Management budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)
- [W&B `wandb.init` reference](https://docs.wandb.ai/models/ref/python/functions/init)
- [W&B run tags](https://docs.wandb.ai/models/runs/tags)
- [MLflow Tracking APIs](https://mlflow.org/docs/latest/ml/tracking/tracking-api/)
