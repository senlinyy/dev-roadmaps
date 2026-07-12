---
title: "Kubernetes for ML"
description: "Use Kubernetes to run ML training, pipeline, and serving workloads with Jobs, Deployments, GPU scheduling, quotas, storage, service accounts, and observability."
overview: "Kubernetes gives ML teams a shared platform for running containerized training jobs, pipeline steps, and model services. This guide follows a vision training platform through namespaces, node pools, GPU scheduling, Jobs, Deployments, storage, service accounts, and operating checks."
tags: ["MLOps", "advanced", "platform"]
order: 1
id: "article-mlops-mlops-infrastructure-kubernetes-for-ml-workloads"
---

## Table of Contents

1. [What Kubernetes Adds to ML Workloads](#what-kubernetes-adds-to-ml-workloads)
2. [The Workload Map](#the-workload-map)
3. [Namespaces, Quotas, and Node Pools](#namespaces-quotas-and-node-pools)
4. [Training with Jobs](#training-with-jobs)
5. [GPU Scheduling and Device Plugins](#gpu-scheduling-and-device-plugins)
6. [Storage, Images, and Service Accounts](#storage-images-and-service-accounts)
7. [Serving with Deployments](#serving-with-deployments)
8. [Observability and Debugging](#observability-and-debugging)
9. [Practical Checks and Interview-Ready Understanding](#practical-checks-and-interview-ready-understanding)
10. [References](#references)

## What Kubernetes Adds to ML Workloads
<!-- section-summary: Kubernetes gives ML teams a common way to run training, pipeline, batch, and serving containers across shared compute. -->

**Kubernetes for ML** means using Kubernetes as the shared runtime for machine learning containers. The same cluster can run one-off training jobs, scheduled data checks, pipeline steps, batch scoring, and long-running model APIs. Kubernetes handles placement, restart behavior, resource requests, service identity, and rollout mechanics, while the ML team owns the container image, data paths, model code, metrics, and release rules.

Think about a company called ClearSight Labs. It builds a computer vision model that detects defects in circuit boards from factory images. The data team lands labeled images in object storage. The ML team trains PyTorch models on GPU nodes. The platform team runs a Kubernetes cluster with separate node pools for CPU preprocessing, L40S inference, and H100 training. The product team wants a model API that returns `defect_probability` in less than 120 ms for inspection stations.

Without a shared platform, every team invents a different way to run work. One engineer starts a GPU VM manually. Another uses a notebook server that keeps running over the weekend. A batch scoring script writes logs to a laptop. A model API runs in a container, yet nobody can tell which model version is live after a rollback. Kubernetes gives the team one control plane for these runtime questions. It can ask where a workload should run, how much CPU and memory it needs, whether it needs a GPU, which service account it uses, which storage it mounts, and how the team should observe failures.

Kubernetes still needs good ML platform design around it. It will schedule containers, yet it will not decide whether your labels are clean, whether your validation split leaks factory lines, or whether a new model should ship. Those decisions live in pipelines, registries, evaluation gates, monitoring, and human review. In this article, focus on the infrastructure layer: how ML containers reach the right compute with the right constraints and enough evidence for operations.

## The Workload Map
<!-- section-summary: ML platforms usually use several Kubernetes workload types because training, serving, and scheduled checks behave differently. -->

The first mistake beginners make is trying to run every ML task as the same kind of Kubernetes object. A training run and a model API have different life cycles. A training run should finish. A model API should keep serving. A nightly label-quality check should run on a schedule. A distributed training controller may create several pods that need to coordinate.

Here is the ClearSight platform map:

| ML need | Kubernetes shape | Why it fits |
|---|---|---|
| Train one model version | `Job` | Runs to completion, retries failed pods, keeps logs for review |
| Run nightly feature or label checks | `CronJob` | Creates Jobs on a schedule |
| Serve online predictions | `Deployment` plus `Service` | Keeps replicas running and gives clients a stable network name |
| Run pipeline steps | Jobs created by an orchestrator | Each step has its own container, inputs, outputs, and status |
| Store model cache or shared artifacts | `PersistentVolumeClaim` or object storage mount pattern | Keeps data separate from short-lived pods |
| Isolate teams | `Namespace`, `ResourceQuota`, `LimitRange`, RBAC | Separates access and resource budgets |
| Reach GPUs | Node labels, taints, tolerations, device plugins | Places pods on nodes that expose accelerator resources |

A **Pod** is the smallest Kubernetes runtime unit. It wraps one or more containers that run together on the same node. You rarely create pods directly in a production ML platform. You create higher-level objects such as Jobs and Deployments, and those objects create pods for you.

A **Job** is the natural fit for training because training has an end state. The model either trained and uploaded artifacts, or it failed and needs investigation. Kubernetes Jobs retry failed pods until the configured success condition or failure limit is reached. That is useful when a node drains or a container crashes during setup.

A **Deployment** is the natural fit for online serving because serving needs continuous availability. A Deployment manages replicas of the same pod template and updates them in a controlled way. You can scale replicas, roll forward, roll back, and watch readiness probes decide which pods receive traffic.

The important workflow for ClearSight is simple: pipelines prepare data, a Job trains a model, evaluation gates approve it, and a Deployment serves the approved model. Kubernetes supplies the runtime mechanics for each part of that path.

![ClearSight Labs Kubernetes ML workload map](/content-assets/articles/article-mlops-mlops-infrastructure-kubernetes-for-ml-workloads/kubernetes-ml-workload-map.png)
*ClearSight uses one Kubernetes cluster boundary for several ML workload shapes, while each workload still keeps its own compute pool, runtime object, and review evidence.*

## Namespaces, Quotas, and Node Pools
<!-- section-summary: A shared ML cluster needs team boundaries, resource ceilings, and node pools that match CPU, GPU, and serving needs. -->

A **namespace** is a Kubernetes boundary inside a cluster. It groups objects such as Jobs, Deployments, Secrets, and ServiceAccounts. In a shared ML cluster, namespaces usually map to teams, environments, or workload classes. ClearSight uses `vision-dev`, `vision-prod`, and `platform-observability`.

The namespace gives reviewers a place to ask practical questions. Who can create Jobs here? Which service accounts can read training data? How many GPUs can this team consume at once? Which alerts cover pods in this namespace? The namespace alone only groups objects. RBAC, quotas, network policy, and admission rules make it useful.

A **ResourceQuota** sets aggregate limits for a namespace. If every scientist can submit a 16-GPU experiment with no ceiling, the first enthusiastic experiment can starve the rest of the cluster. A quota gives the team a budget that the API server enforces at creation time.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: vision-dev-budget
  namespace: vision-dev
spec:
  hard:
    requests.cpu: "64"
    requests.memory: 256Gi
    limits.cpu: "96"
    limits.memory: 384Gi
    requests.nvidia.com/gpu: "8"
    limits.nvidia.com/gpu: "8"
    count/jobs.batch: "40"
    count/pods: "120"
```

This quota says the development namespace can request up to 8 GPUs at once, plus a bounded amount of CPU, memory, Jobs, and pods. The GPU resource name comes from the vendor device plugin, commonly `nvidia.com/gpu` for NVIDIA devices. The exact resource name matters because Kubernetes treats accelerators as extended resources.

A **LimitRange** can set defaults for pods that omit requests or limits. This helps because quotas for CPU and memory often require workloads to declare resource needs. ClearSight sets small CPU defaults for helper containers so a forgotten request field fails less often during development review.

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: vision-dev-defaults
  namespace: vision-dev
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: "500m"
        memory: 1Gi
      default:
        cpu: "2"
        memory: 4Gi
```

Node pools complete the picture. A **node pool** is a group of Kubernetes nodes with similar machine type, accelerator, operating system image, and labels. Cloud providers expose node pools differently, yet the cluster-level idea is stable. ClearSight has one CPU pool for preprocessing, one L40S pool for low-latency inference testing, and one H100 pool for larger training. The platform team labels nodes so workloads can target the right pool.

```bash
kubectl label node gke-vision-train-h100-01 accelerator=nvidia-h100 workload=training
kubectl label node gke-vision-serve-l40s-01 accelerator=nvidia-l40s workload=inference
```

Labels guide scheduling. Taints and tolerations add a stronger protection layer. The platform team can taint GPU nodes so random CPU-only jobs avoid landing on expensive GPU machines. ML jobs that truly need those nodes add a matching toleration.

## Training with Jobs
<!-- section-summary: A Kubernetes Job gives a training run a clear start, retry policy, logs, resource request, and completion state. -->

ClearSight trains a defect detection model from a container image called `registry.example.com/ml/vision-trainer:2026-07-05-9f21c2a`. That tag includes the date and Git SHA. In production, many teams pin by image digest as well, so a job replay uses the exact same container bytes.

The training script reads a dataset manifest, downloads images from object storage, writes checkpoints to `/mnt/checkpoints`, uploads the final model to the model registry path, and writes metrics as JSON. Kubernetes does not need to know PyTorch internals. It needs to know how to run the container, what resources to reserve, which service account to use, and when to stop retrying.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: board-defect-train-20260705-9f21c2a
  namespace: vision-dev
  labels:
    app: board-defect-training
    model: board-defect-detector
    run_id: "20260705-9f21c2a"
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 21600
  ttlSecondsAfterFinished: 172800
  template:
    metadata:
      labels:
        app: board-defect-training
        run_id: "20260705-9f21c2a"
    spec:
      restartPolicy: Never
      serviceAccountName: vision-training-runner
      nodeSelector:
        workload: training
        accelerator: nvidia-h100
      tolerations:
        - key: "accelerator"
          operator: "Equal"
          value: "nvidia"
          effect: "NoSchedule"
      containers:
        - name: trainer
          image: registry.example.com/ml/vision-trainer@sha256:8ef4c6f2d2a54b31f0f8e7a9a331c9a1d85ed86a6dce969fb2f9e8f1d9f2a111
          imagePullPolicy: IfNotPresent
          args:
            - "--dataset-manifest=s3://clearsight-ml/vision/manifests/boards-2026-07-04.json"
            - "--model-output=s3://clearsight-ml/models/board-defect/20260705-9f21c2a"
            - "--epochs=24"
            - "--batch-size=128"
          env:
            - name: RUN_ID
              value: "20260705-9f21c2a"
            - name: CUDA_VISIBLE_DEVICES
              value: "0"
          resources:
            requests:
              cpu: "8"
              memory: 48Gi
              nvidia.com/gpu: "1"
            limits:
              cpu: "12"
              memory: 64Gi
              nvidia.com/gpu: "1"
          volumeMounts:
            - name: checkpoints
              mountPath: /mnt/checkpoints
      volumes:
        - name: checkpoints
          persistentVolumeClaim:
            claimName: board-defect-checkpoints
```

Several fields matter in review. `backoffLimit` controls retry count after failed pods. `activeDeadlineSeconds` caps total runtime so a stuck training run stops after six hours. `ttlSecondsAfterFinished` lets completed Job objects clean up after two days, while logs and metrics should already live in durable systems. `restartPolicy: Never` makes failed training containers visible as failed pods, which is easier to investigate than a container that restarts forever.

The resource section matters more than beginners expect. Kubernetes uses requests to choose a node. Limits constrain runtime usage. For GPUs, Kubernetes expects the custom GPU resource in `limits`, and if both requests and limits are present, they need to match. For CPU and memory, ClearSight sets requests from measured training runs, then uses limits to protect the node from runaway memory.

Run and inspect the Job:

```bash
kubectl apply -f training-job.yaml
kubectl -n vision-dev get jobs
kubectl -n vision-dev get pods -l run_id=20260705-9f21c2a
kubectl -n vision-dev logs job/board-defect-train-20260705-9f21c2a -f
kubectl -n vision-dev describe job board-defect-train-20260705-9f21c2a
```

The useful evidence is the Job status, pod events, container exit code, and training metrics uploaded by the script. A clean run should show the Job completed, the model artifact written, and evaluation metrics available for the pipeline gate.

## GPU Scheduling and Device Plugins
<!-- section-summary: Kubernetes can schedule GPU workloads after the cluster exposes accelerator resources through vendor device plugins and node labels. -->

Kubernetes does not magically see GPUs as ordinary CPU cores. The node needs the right driver stack and a **device plugin**. A device plugin is a vendor component that advertises specialized hardware to kubelet, the node agent. With the NVIDIA device plugin installed, nodes expose a resource such as `nvidia.com/gpu`. The scheduler can then place pods that request that resource.

For a managed cluster, the platform team often installs or enables the NVIDIA GPU Operator. The operator manages driver, container toolkit, device plugin, feature discovery, and monitoring components across GPU nodes. The current NVIDIA docs list modern data center GPU families such as L4, L40S, H100, H200, GH200, and Blackwell systems, and they also document operator version and driver support. That matters because ML incidents often come from silent drift in the driver, CUDA runtime, or node image.

ClearSight records the GPU runtime packet for every training run:

```json
{
  "run_id": "20260705-9f21c2a",
  "node_pool": "vision-train-h100",
  "accelerator": "nvidia-h100",
  "gpu_count": 1,
  "driver": "580.159.04",
  "cuda_runtime": "12.8",
  "container_image_digest": "sha256:8ef4c6f2d2a54b31f0f8e7a9a331c9a1d85ed86a6dce969fb2f9e8f1d9f2a111",
  "pytorch": "2.8.0",
  "dataset_manifest": "s3://clearsight-ml/vision/manifests/boards-2026-07-04.json"
}
```

This packet makes performance and reproducibility reviews easier. If a model trains slower after a node upgrade, the team can compare driver, CUDA runtime, image digest, and node pool. If a model trains faster on H100 than L40S, the result comes with enough context to make a cost decision.

![GPU scheduling and runtime packet for a Kubernetes ML job](/content-assets/articles/article-mlops-mlops-infrastructure-kubernetes-for-ml-workloads/kubernetes-gpu-scheduling-runtime-packet.png)
*GPU scheduling is a chain of checks: the pod request, quota, node labels, tolerations, device plugin, and runtime packet all help reviewers explain where a training run landed and why.*

GPU scheduling uses the same Kubernetes placement ideas as other workloads, with stricter consequences. A pod that asks for `nvidia.com/gpu: 1` can only land on a node advertising that resource. A pod with a `nodeSelector` for `accelerator: nvidia-h100` can only land on nodes with that label. A tainted GPU node will only accept pods with matching tolerations.

When a GPU pod stays pending, start with events:

```bash
kubectl -n vision-dev describe pod board-defect-train-20260705-9f21c2a-8h2pl
kubectl get nodes -L accelerator,workload
kubectl describe node gke-vision-train-h100-01 | rg -n "Allocatable|nvidia.com/gpu|Taints"
```

Common evidence includes `Insufficient nvidia.com/gpu`, a missing toleration, a typo in the node label, or quota exhaustion in the namespace. If the node advertises zero GPUs, inspect the device plugin and GPU Operator pods before blaming the training code.

## Storage, Images, and Service Accounts
<!-- section-summary: ML pods need durable artifact paths, reviewed container images, and narrowly scoped identities for data access. -->

Training pods are temporary. The data and artifacts they use are durable. ClearSight keeps raw images and model artifacts in object storage, stores checkpoints on a persistent volume for retry speed, and writes metrics to a tracking system. This keeps the Job replaceable. If a node dies, a new pod can read the same manifest and continue from a checkpoint if the training code supports it.

A **PersistentVolumeClaim** is a request for storage. The pod mounts the claim, while the storage class decides how the volume is provisioned. For checkpoints, ClearSight uses a fast regional disk class in development and avoids keeping final model artifacts only on the disk.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: board-defect-checkpoints
  namespace: vision-dev
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: balanced-ssd
  resources:
    requests:
      storage: 500Gi
```

Use PVCs for scratch space, checkpoints, and shared local caches where the access mode fits the workload. Use object storage for datasets, model artifacts, evaluation reports, and manifests that must outlive the Kubernetes object. For very large datasets, teams often add cache warmers, local SSD pools, or data-loading services, yet the same rule holds: the pod can disappear; the important ML evidence survives elsewhere.

Container images need the same discipline. A training image should include pinned dependencies, the training entrypoint, and enough labels to trace the source. Use immutable digests for production jobs. Tags help humans, digests help machines replay exact images.

Service identity is the next piece. A **ServiceAccount** gives pods an identity inside the cluster. With cloud identity integration, the Kubernetes service account can map to a cloud IAM identity that reads only the approved buckets or tables. ClearSight uses `vision-training-runner` for training Jobs and `vision-serving-runner` for online inference. They have different permissions because training reads labeled data and writes model artifacts, while serving reads only approved model bundles and writes prediction logs.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: vision-training-runner
  namespace: vision-dev
  annotations:
    example.com/cloud-service-account: vision-training-runner@clearsight-ml.iam.example.com
```

The annotation key varies by cloud provider and identity integration. The principle stays stable: pods should receive short-lived identity through the platform, and the identity should match the workload. Avoid shared static access keys inside container images, notebooks, or mounted files. If credentials leak through logs or artifact bundles, response gets much harder.

## Serving with Deployments
<!-- section-summary: Model serving uses long-running Deployments, readiness checks, stable Services, and rollout evidence rather than one-off Jobs. -->

After evaluation approves a model, ClearSight serves it through a model API. The serving container loads a model bundle from object storage, exposes `/predict`, and reports health through `/ready`. This is a different life cycle from training. The pod should stay alive, receive traffic only after the model loads, and roll back quickly if latency or errors rise.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: board-defect-api
  namespace: vision-prod
  labels:
    app: board-defect-api
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: board-defect-api
  template:
    metadata:
      labels:
        app: board-defect-api
        model_version: "20260705-9f21c2a"
    spec:
      serviceAccountName: vision-serving-runner
      nodeSelector:
        workload: inference
        accelerator: nvidia-l40s
      tolerations:
        - key: "accelerator"
          operator: "Equal"
          value: "nvidia"
          effect: "NoSchedule"
      containers:
        - name: api
          image: registry.example.com/ml/board-defect-api@sha256:1d4f5f251f2d7cde9af089e404c4f0a98065b668eef05a15ea1c8e6a7d008c22
          ports:
            - containerPort: 8080
          env:
            - name: MODEL_URI
              value: "s3://clearsight-ml/models/board-defect/20260705-9f21c2a"
          resources:
            requests:
              cpu: "2"
              memory: 8Gi
              nvidia.com/gpu: "1"
            limits:
              cpu: "4"
              memory: 12Gi
              nvidia.com/gpu: "1"
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
---
apiVersion: v1
kind: Service
metadata:
  name: board-defect-api
  namespace: vision-prod
spec:
  selector:
    app: board-defect-api
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

The readiness probe protects users from half-started model pods. A pod that has started the Python process while weights are still loading should fail readiness and receive zero traffic. The liveness probe catches processes that have wedged. Use it carefully because a too-aggressive liveness probe can restart a healthy model server during a traffic spike.

Rollout commands give the team a clear release path:

```bash
kubectl -n vision-prod apply -f serving-deployment.yaml
kubectl -n vision-prod rollout status deployment/board-defect-api
kubectl -n vision-prod get deploy board-defect-api -o wide
kubectl -n vision-prod rollout undo deployment/board-defect-api
```

A real platform usually wraps these commands in GitOps or CI/CD. The important ideas stay the same. The desired state lives in version control. The Deployment describes the model version, image digest, resources, probes, and identity. The rollout has observable status. Rollback uses a known previous ReplicaSet or a reviewed previous manifest.

![Kubernetes model service release, serving, and observability flow](/content-assets/articles/article-mlops-mlops-infrastructure-kubernetes-for-ml-workloads/kubernetes-serving-observability.png)
*The serving path connects release approval, Kubernetes Deployment mechanics, readiness-based traffic, and model observability so rollback decisions have real signals.*

## Observability and Debugging
<!-- section-summary: Operating ML on Kubernetes depends on pod events, logs, metrics, GPU telemetry, and model-level quality signals. -->

Kubernetes observability starts with infrastructure evidence: pod status, events, logs, resource usage, and rollout state. ML observability adds model evidence: dataset version, model version, prediction latency, error rate, drift checks, quality labels, and business impact. ClearSight keeps both layers connected through labels such as `run_id`, `model`, and `model_version`.

For failed training:

```bash
kubectl -n vision-dev get pods -l run_id=20260705-9f21c2a
kubectl -n vision-dev describe pod -l run_id=20260705-9f21c2a
kubectl -n vision-dev logs job/board-defect-train-20260705-9f21c2a --all-containers
kubectl -n vision-dev get events --sort-by=.lastTimestamp
```

The platform team checks whether the pod was unschedulable, OOM-killed, image-pull blocked, denied by quota, or failed inside the training script. The ML team checks training logs, dataset availability, checkpoint writes, and metric output. A good incident review separates platform failure from model-code failure instead of treating every red Job as the same problem.

For serving:

```bash
kubectl -n vision-prod rollout status deployment/board-defect-api
kubectl -n vision-prod get pods -l app=board-defect-api
kubectl -n vision-prod describe deploy board-defect-api
kubectl -n vision-prod logs deploy/board-defect-api --since=15m
kubectl -n vision-prod top pods
```

Prometheus and Grafana commonly collect CPU, memory, request rate, latency, and errors. NVIDIA DCGM Exporter commonly exposes GPU utilization, memory, temperature, and error counters from GPU nodes. OpenTelemetry can connect traces from the application path to the model API. Prediction logs should include a request ID, model version, feature schema version, latency, validation outcome, and safe metadata that privacy review approves.

For ClearSight, the release dashboard has these panels:

| Panel | Good evidence |
|---|---|
| Deployment health | All replicas ready, rollout complete, no crash loops |
| API latency | p50 and p95 stay inside the inspection-station budget |
| GPU usage | Inference GPU memory and utilization match expected load |
| Prediction validation | Payload schema errors stay low and explainable |
| Model quality | Delayed labels show defect recall within the approved range |
| Cost guardrail | GPU node count and idle time stay inside the weekly budget |

This is where Kubernetes and MLOps meet. Kubernetes can say the pod is healthy. The product still needs to know whether predictions help inspectors catch defects. A green Deployment and a bad model can coexist. A mature platform watches both.

## Practical Checks and Interview-Ready Understanding
<!-- section-summary: The practical Kubernetes skill is choosing the right workload object, resource boundary, identity, storage path, and debug evidence for each ML task. -->

Before ClearSight lets a new ML workload into the shared cluster, reviewers ask for this packet:

| Check | What reviewers expect |
|---|---|
| Workload type | Job for training or batch work, Deployment for serving, CronJob for schedules |
| Container image | Immutable digest, dependency lock, source commit, vulnerability scan |
| Resources | CPU, memory, and GPU requests based on measured runs |
| Placement | Node labels, tolerations, and pool choice tied to hardware needs |
| Namespace budget | ResourceQuota and LimitRange fit the team and environment |
| Identity | ServiceAccount maps to a narrow cloud identity |
| Storage | Durable artifacts in object storage, PVCs only where they fit |
| Observability | Logs, metrics, GPU telemetry, model version labels, and release dashboard |
| Rollback | Previous serving manifest or model bundle can return quickly |

Common mistakes have clear signatures. A training pod stuck in `Pending` often points to quota, labels, taints, or missing GPU capacity. An `ImagePullBackOff` points to registry auth, image name, or digest availability. An `OOMKilled` training pod points to memory requests, batch size, data loader behavior, or a memory leak. A serving pod that starts yet fails readiness often points to slow model loading, missing artifact permissions, or bad environment configuration.

The interview-ready explanation is this: Kubernetes runs ML containers through workload objects that match the life cycle. Jobs run training and batch tasks to completion. Deployments keep model APIs running and roll them forward or back. GPU workloads need device plugins, node labels, and matching resource requests. Shared clusters need namespaces, quotas, service accounts, durable storage, and observability so teams can run experiments and production services on the same platform without turning the cluster into a mystery box.

## References

- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/) - Official Kubernetes documentation for one-off tasks, retries, completion, deadlines, and cleanup.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official documentation for long-running workloads, rollout status, scaling, and rollback.
- [Kubernetes GPU scheduling](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/) - Official documentation for requesting GPUs and using node labels for accelerator placement.
- [Kubernetes device plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/) - Official documentation for advertising specialized hardware such as GPUs to kubelet.
- [Kubernetes ResourceQuota](https://kubernetes.io/docs/concepts/policy/resource-quotas/) - Official documentation for namespace-level resource constraints.
- [Kubernetes resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Official documentation for requests, limits, CPU, memory, and extended resources.
- [Kubernetes service accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) - Official documentation for pod identities inside a cluster.
- [Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) - Official documentation for PersistentVolumes and PersistentVolumeClaims.
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/) - Official documentation for node labels, selectors, affinity, and placement.
- [NVIDIA GPU Operator platform support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html) - Official NVIDIA support matrix for GPU Operator versions, drivers, Kubernetes versions, and supported GPU families.
