---
title: "GPU Inference"
description: "Introduce accelerator-backed inference and its operational tradeoffs."
overview: "GPU inference runs prediction workloads on accelerator hardware so a serving team can handle heavier models, larger batches, and stricter latency goals with clear evidence about the driver, CUDA runtime, container image, batching behavior, and GPU allocation."
tags: ["MLOps", "advanced", "performance"]
order: 3
id: "article-mlops-model-serving-gpu-inference-basics"
---

## Table of Contents

1. [What GPU Inference Means](#what-gpu-inference-means)
2. [The Serving Pieces You Need To Connect](#the-serving-pieces-you-need-to-connect)
3. [The GPU Software Stack](#the-gpu-software-stack)
4. [Batching Requests With Triton](#batching-requests-with-triton)
5. [Scheduling GPU Pods On Kubernetes](#scheduling-gpu-pods-on-kubernetes)
6. [Sharing A GPU With MIG And Time-Slicing](#sharing-a-gpu-with-mig-and-time-slicing)
7. [The Evidence Packet For A GPU Release](#the-evidence-packet-for-a-gpu-release)
8. [Operating Checks](#operating-checks)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## What GPU Inference Means
<!-- section-summary: GPU inference uses accelerator hardware for the prediction path, so the team must manage performance and infrastructure evidence together. -->

**GPU inference** means the model serving system uses a graphics processing unit, usually an NVIDIA data center GPU in modern ML clusters, to run the prediction step. The client still sends an HTTP or gRPC request. The API still returns a score, class, embedding, token stream, or ranking result. The difference lives inside the serving path: tensor operations move to an accelerator that can run many parallel math operations at once.

Imagine a company called LensCart that lets shoppers search a product catalog with photos. A customer uploads a picture of a jacket. The service turns the image into an embedding, compares that embedding against a vector index, and returns visually similar products. A small CPU endpoint can handle a few requests per second during a prototype. During a sale, the same endpoint sees hundreds of image requests per second, each request runs a vision transformer, and p95 latency climbs above the product team's 250 ms target.

That is the kind of moment where GPU inference enters the conversation. The team wants more throughput without changing the product behavior. They also need clear proof that the endpoint runs on the expected GPU type, with the expected NVIDIA driver, CUDA runtime, container image, model server, and batching settings. GPU inference work mixes two skills: model serving and platform evidence.

This article follows LensCart's image embedding service as it moves from a CPU pod to a GPU-backed Triton endpoint on Kubernetes. The goal is simple: understand what the GPU accelerates, how batching helps, how Kubernetes sees the hardware, how MIG changes sharing, and which checks make the setup safe enough for production.

## The Serving Pieces You Need To Connect
<!-- section-summary: A GPU endpoint works only when model code, serving runtime, Kubernetes resources, and monitoring all agree on the same contract. -->

Before touching GPU settings, connect the pieces in the serving path. A model can run perfectly in a notebook and still fail in production because the endpoint shape, model server, container runtime, and node hardware disagree. A GPU speeds up math. It also adds new places where version mismatch and scheduling mistakes can break the release.

For LensCart, the first clean structure is this:

| Piece | Plain-English role | LensCart example |
| --- | --- | --- |
| **Model artifact** | The trained model file and its expected tensors | `catalog-embedder` exported as ONNX |
| **Model server** | The process that receives inference requests and runs the model | NVIDIA Triton Inference Server |
| **Container image** | The packaged runtime that holds the server, framework libraries, and startup command | `registry.lenscart.dev/ml/catalog-embedder@sha256:...` |
| **GPU node pool** | Kubernetes nodes that have supported NVIDIA GPUs and drivers | `gpu-l4-serving` for real-time image embeddings |
| **Scheduling request** | The Kubernetes resource request that reserves GPU capacity for the pod | `nvidia.com/gpu: 1` or a MIG resource |
| **Batching policy** | The server-side rule that groups compatible requests | Triton `dynamic_batching` in `config.pbtxt` |
| **Observability** | Metrics, logs, and traces that show latency, failures, and GPU use | Prometheus scraping Triton and DCGM metrics |

That table matters because GPU inference problems rarely say "the GPU is wrong" in a neat error message. You might see a pod stuck in `Pending`, a model server loading on CPU, an image that cannot find CUDA libraries, a batch queue that adds too much latency, or a driver mismatch that appears only after a node replacement. A good production setup names each piece and records evidence for it.

The first practical question is the request contract. LensCart sends one image at a time from the web app, but the model can process many images as a tensor batch. That means the external API can stay simple while the server groups requests inside the model server. The next section explains why the software stack must support that plan before batching can help.

## The GPU Software Stack
<!-- section-summary: GPU serving depends on a matching chain from hardware and driver through CUDA, container access, model framework, and model server. -->

A GPU endpoint has more layers than a CPU endpoint. The **GPU** is the physical accelerator. The **NVIDIA driver** runs on the node and lets the operating system talk to the GPU. **CUDA** is NVIDIA's programming platform and runtime layer for GPU computation. The **NVIDIA Container Toolkit** lets containers access the GPU devices and driver libraries. A **model server** such as Triton loads the model and uses framework backends such as TensorRT, ONNX Runtime, PyTorch, or Python.

In production, treat this as a compatibility chain:

| Layer | Evidence to capture | Why it matters |
| --- | --- | --- |
| Hardware | GPU SKU, node pool, MIG profile | Performance and support depend on exact hardware |
| Driver | Driver branch and version from the node | CUDA and GPU Operator support depend on driver compatibility |
| CUDA runtime | Runtime version in the serving image | Framework wheels and model server builds depend on it |
| Container access | NVIDIA Container Toolkit and device plugin status | Kubernetes must pass the GPU into the pod |
| Model server | Triton version and backend | Batching, metrics, and model config behavior live here |
| Model artifact | Model format, tensor names, max batch size | The server must know the exact input and output contract |

![LensCart GPU inference software stack and evidence packet](/content-assets/articles/article-mlops-model-serving-gpu-inference-basics/gpu-software-stack-evidence.png)

*The GPU stack needs evidence at every layer, from the L4 node pool and driver through CUDA, container access, model server, and model artifact.*

NVIDIA's GPU Operator exists because cluster teams need this chain installed and updated consistently. A default GPU Operator installation deploys the NVIDIA GPU driver, NVIDIA Container Toolkit, NVIDIA Device Plugin, DCGM Exporter, and MIG Manager on GPU worker nodes. The operator does not remove the need for checks. It gives the platform team a standard way to manage the GPU software stack inside Kubernetes.

Here is a small evidence command set a serving engineer might run before releasing LensCart's endpoint:

```bash
kubectl get pods -n gpu-operator
kubectl get clusterpolicy
kubectl describe node gpu-l4-serving-01 | rg "nvidia.com|Allocatable|Capacity"
kubectl exec deploy/catalog-embedder-triton -- nvidia-smi
kubectl get deploy catalog-embedder-triton -o jsonpath='{.spec.template.spec.containers[0].image}'
```

The first two commands show whether the operator components and cluster policy are ready. The node description shows what Kubernetes advertises as schedulable GPU capacity. `nvidia-smi` inside the serving pod proves the container can see the GPU and reports the driver-level CUDA capability. The image command records the exact container reference, ideally a digest rather than a mutable tag.

Notice the shape of the evidence. You record the exact GPU SKU, driver, CUDA runtime, container image, model artifact, and server config. Later, if a rollback or incident happens, the team can compare the bad release with the last known good release instead of guessing which layer changed.

## Batching Requests With Triton
<!-- section-summary: Batching lets the model server group compatible requests so the GPU does more useful work per execution. -->

After the software stack can see the GPU, the next question is utilization. GPUs like larger chunks of work. If LensCart sends one tiny image tensor at a time and waits for each result, the GPU can sit mostly idle while request overhead, preprocessing, and scheduling dominate. **Batching** groups compatible requests so the model runs a larger tensor through the GPU in one execution.

NVIDIA Triton supports **dynamic batching** for stateless models. Stateless means one request does not rely on private memory from an earlier request. LensCart's image embedding model fits that pattern: each image produces one embedding, and request order only matters because each response must return to the right caller. Triton can wait for a very short queue delay, collect several requests, and run them as a batch.

The model must support batching before the server can safely do this. Triton's `max_batch_size` tells Triton the largest batch size the model supports. For models with a first batch dimension, the input shape in the config describes one item, and Triton adds the batch dimension around it. For models that cannot accept a batch dimension, `max_batch_size` should be `0`.

Here is a practical `config.pbtxt` for LensCart's ONNX model:

```protobuf
name: "catalog_embedder"
backend: "onnxruntime"
max_batch_size: 32

input [
  {
    name: "pixel_values"
    data_type: TYPE_FP32
    dims: [ 3, 224, 224 ]
  }
]

output [
  {
    name: "embedding"
    data_type: TYPE_FP32
    dims: [ 768 ]
  }
]

dynamic_batching {
  preferred_batch_size: [ 8, 16, 32 ]
  max_queue_delay_microseconds: 2000
}

instance_group [
  {
    count: 1
    kind: KIND_GPU
  }
]
```

The important parts are small and very concrete. `max_batch_size: 32` says Triton may form batches up to 32 images. `dims: [ 3, 224, 224 ]` describes one image after preprocessing. `dynamic_batching` gives Triton preferred sizes and a two millisecond queue window. `instance_group` asks Triton to run this model instance on GPU.

Two milliseconds can sound tiny, but it is a real product tradeoff. If traffic is steady, Triton can fill batches quickly and throughput rises. If traffic is sparse, the queue delay may add latency without much benefit. The team should test several values with production-like traffic rather than copying one config everywhere.

Triton metrics help you see whether batching works. The count metrics distinguish request count, inference count, and execution count. A useful average batch size estimate is inference count divided by execution count over the same time window:

```promql
sum(rate(nv_inference_count{model="catalog_embedder"}[5m]))
/
sum(rate(nv_inference_exec_count{model="catalog_embedder"}[5m]))
```

If the result stays near `1`, the endpoint is running one item per execution. If it rises toward `8`, `16`, or `32` during traffic bursts while p95 latency remains inside the service target, the batching policy is doing useful work. Pair that query with request failures, pending requests, and latency histograms so the team can see both throughput and user impact.

![LensCart dynamic batching with an L4 GPU](/content-assets/articles/article-mlops-model-serving-gpu-inference-basics/dynamic-batching-l4.png)

*Dynamic batching lets compatible image requests wait briefly, run as larger tensor batches, and raise throughput while p95 latency stays inside the target.*

## Scheduling GPU Pods On Kubernetes
<!-- section-summary: Kubernetes schedules GPU workloads through device plugins and extended resources, so the pod must request the advertised GPU resource. -->

Now the model server has a batching plan. The pod still needs to land on a node that has GPU capacity. Kubernetes handles GPUs through **device plugins**. A vendor plugin advertises hardware to the kubelet, and the node reports an extended resource such as `nvidia.com/gpu`. A pod consumes that resource by placing it in the container `limits` block.

Here is a compact Kubernetes deployment shape for the LensCart Triton server:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-embedder-triton
  labels:
    app: catalog-embedder
    model_id: catalog-embedder
    model_version: "2026-07-01"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog-embedder
  template:
    metadata:
      labels:
        app: catalog-embedder
        model_id: catalog-embedder
        model_version: "2026-07-01"
    spec:
      nodeSelector:
        accelerator: nvidia-l4
      containers:
        - name: triton
          image: registry.lenscart.dev/ml/catalog-embedder@sha256:8f1a...
          args:
            - tritonserver
            - --model-repository=/models
            - --allow-metrics=true
          ports:
            - containerPort: 8000
            - containerPort: 8001
            - containerPort: 8002
          resources:
            requests:
              cpu: "2"
              memory: 8Gi
            limits:
              cpu: "4"
              memory: 12Gi
              nvidia.com/gpu: "1"
```

The GPU request sits under `limits`. Kubernetes documentation calls out that GPUs are specified in `limits`; if you also set `requests`, the GPU request and limit must match. The `nodeSelector` gives the scheduler an extra hint so this image embedding service lands on the intended GPU pool. The labels carry model identity and version into logs, metrics, and incident queries.

After applying the deployment, the first checks are ordinary Kubernetes checks:

```bash
kubectl rollout status deploy/catalog-embedder-triton
kubectl get pods -l app=catalog-embedder -o wide
kubectl describe pod -l app=catalog-embedder
kubectl logs deploy/catalog-embedder-triton
```

If pods sit in `Pending`, inspect the events in `kubectl describe pod`. Common causes include no allocatable GPU resource, the wrong node selector, a taint without a matching toleration, or a resource name mismatch after MIG or time-slicing configuration. If pods run but the server logs show CPU execution, inspect the Triton config, container image, and `nvidia-smi` output inside the pod.

## Sharing A GPU With MIG And Time-Slicing
<!-- section-summary: MIG partitions supported GPUs into isolated instances, while time-slicing shares execution time and offers less isolation. -->

LensCart's first release uses one full L4 GPU per Triton pod. That is easy to reason about. Later, the platform team buys H100 or H200 nodes for several model services. Some workloads need a full GPU. Some only need a slice. This is where **MIG**, short for Multi-Instance GPU, enters the design.

MIG partitions a supported NVIDIA GPU into smaller GPU instances. Each instance has its own memory and fault isolation at the hardware layer. That makes it useful for serving several smaller models on the same physical GPU while keeping noisy workloads apart. A product image embedder, a moderation model, and a lightweight OCR model might each fit into a MIG slice instead of consuming a whole high-end GPU.

Time-slicing takes a different approach. It lets the device plugin expose multiple replicas of a GPU so several pods can share execution time on the same underlying GPU. NVIDIA's GPU Operator documentation explains an important tradeoff: time-slicing lacks the memory and fault isolation that MIG provides. It can help many small, tolerant workloads share a device. Strict isolation needs a stronger partitioning choice.

In a Kubernetes cluster with a mixed MIG strategy, the node can advertise resources with MIG profile names. The exact resource names come from the node configuration, so the release checklist should discover them from the node rather than assume them:

```bash
kubectl describe node gpu-h100-serving-01 | rg "nvidia.com/mig|nvidia.com/gpu|Allocatable"
```

A pod that targets a MIG profile uses the advertised resource name:

```yaml
resources:
  requests:
    cpu: "2"
    memory: 8Gi
  limits:
    cpu: "4"
    memory: 12Gi
    nvidia.com/mig-1g.10gb: "1"
```

For LensCart, MIG makes sense only after measurement. If a full GPU serves 400 requests per second at p95 140 ms and the product only needs 80 requests per second most of the day, a MIG profile might reduce cost. If the model needs large batches to meet throughput, a small slice might reduce GPU memory and compute so much that latency suffers. Treat MIG as a capacity design, then prove it with a load test.

One current support detail deserves a place in the runbook. NVIDIA documents a known GPU Operator issue for several 570 driver versions where workloads can stay pending on nodes that mix MIG slices and full GPUs, and recommends upgrading to driver 580.65.06 or later for that issue. This is exactly why a GPU release packet records driver version and MIG strategy together.

![LensCart GPU scheduling choices across full GPU, MIG, and operating checks](/content-assets/articles/article-mlops-model-serving-gpu-inference-basics/gpu-scheduling-mig-checks.png)

*The scheduling view separates full-GPU placement, MIG slice placement, and operating checks so the team chooses a resource shape from measured workload evidence.*

## The Evidence Packet For A GPU Release
<!-- section-summary: A GPU release should carry enough evidence for another engineer to reproduce, compare, and roll back the endpoint. -->

GPU inference costs more than CPU serving, and failures can hide in infrastructure details. The release packet should let another engineer answer one question quickly: what exactly changed between the last good endpoint and this endpoint?

Here is the LensCart release packet:

| Evidence | Example value |
| --- | --- |
| Model id and version | `catalog-embedder`, `2026-07-01` |
| Model artifact | `s3://ml-artifacts/catalog-embedder/2026-07-01/model.onnx` |
| Serving image | `registry.lenscart.dev/ml/catalog-embedder@sha256:8f1a...` |
| Model server | Triton Inference Server, recorded from image build metadata |
| GPU SKU | NVIDIA L4 in `gpu-l4-serving` |
| Driver | Collected from `nvidia-smi` |
| CUDA runtime | Collected from image metadata and framework runtime output |
| GPU Operator | `kubectl get clusterpolicy` and operator chart version |
| Resource request | `nvidia.com/gpu: 1` |
| Batching policy | `max_batch_size=32`, preferred batch sizes `8,16,32`, queue delay `2000us` |
| Load test result | p50, p95, p99 latency, throughput, average batch size, error rate |
| Rollback target | Previous image digest and model artifact |

The load test should use realistic request data. For LensCart, that means images from the same preprocessing path the web app uses. Random tensors can test server mechanics, yet real catalog images catch image decoding errors, oversized payloads, preprocessing drift, and model behavior that synthetic inputs miss.

A small prediction log table also helps:

```sql
CREATE TABLE serving_prediction_log (
  request_id STRING,
  event_time TIMESTAMP,
  model_id STRING,
  model_version STRING,
  endpoint STRING,
  image_hash STRING,
  input_width INT64,
  input_height INT64,
  predicted_embedding_norm FLOAT64,
  latency_ms FLOAT64,
  trace_id STRING
);
```

This table avoids storing raw customer images in the analytics warehouse. It stores evidence that supports debugging: which model answered, which endpoint handled it, how large the input was, how long it took, and which trace connects the app request to the model server. If privacy rules allow deeper sampling, teams often store a small audited payload sample in restricted object storage with retention limits.

## Operating Checks
<!-- section-summary: GPU inference needs checks for latency, queueing, GPU use, failures, and compatibility drift. -->

Once the endpoint runs, the daily checks should match the ways GPU serving fails. You want service-level checks, model-server checks, and hardware checks in the same dashboard.

Start with user-facing service checks:

```promql
histogram_quantile(
  0.95,
  sum(rate(http_request_duration_seconds_bucket{service="catalog-search"}[5m])) by (le)
)
```

Then add Triton model checks:

```promql
sum(rate(nv_inference_request_failure{model="catalog_embedder"}[5m]))
```

```promql
sum(rate(nv_inference_pending_request_count{model="catalog_embedder"}[5m]))
```

```promql
sum(rate(nv_inference_count{model="catalog_embedder"}[5m]))
/
sum(rate(nv_inference_exec_count{model="catalog_embedder"}[5m]))
```

The first Triton query catches request failures. The second catches growing queue pressure. The third estimates average batch size. Pair these with GPU utilization and memory metrics from DCGM Exporter so you can tell whether the bottleneck is request traffic, batching policy, GPU saturation, CPU preprocessing, or a bad deployment.

Set alerts around symptoms first. A customer feels latency and errors. They do not care that a GPU is 98% busy if the endpoint still meets the product target. A useful alert might page when p95 latency stays above the SLO for ten minutes and the error budget burn rate crosses a threshold. A lower-priority ticket can track low GPU utilization during steady traffic, because that is usually a cost and tuning issue rather than an immediate user incident.

Finally, keep compatibility drift visible. Driver upgrades, kernel upgrades, CUDA runtime changes, Triton version changes, and node pool replacements can all change behavior. Add a small release checklist item that compares the current evidence packet with the previous one. When the model stays fixed while latency shifts, the infrastructure evidence may show the reason.

## Putting It Together
<!-- section-summary: GPU inference works well when the team treats accelerator serving as a measured production system instead of only a faster machine. -->

GPU inference is the production practice of running model predictions on accelerator hardware, then proving that the runtime, hardware, batching policy, and monitoring match the product goal. The LensCart image embedding service needed a GPU because CPU serving could not keep up with sale traffic and the model had a natural batch shape.

The workflow is steady. Start with the request contract and model tensor shape. Pick a model server such as Triton. Verify the GPU software stack through the driver, CUDA runtime, container access, and operator status. Configure batching only after the model supports it. Request the GPU resource that Kubernetes actually advertises. Use MIG only when the workload fits a partition and the support matrix allows it. Record a release evidence packet so later debugging and rollback have facts.

The practical habit is to keep performance and evidence together. A fast endpoint without driver, CUDA, image, and batching evidence is hard to operate. A perfect evidence packet without latency and failure checks is paperwork. A reliable GPU inference service needs both.

## References

- [NVIDIA GPU Operator Platform Support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [NVIDIA GPU Operator Installation Guide](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/getting-started.html)
- [NVIDIA AI Enterprise Infrastructure Support Matrix](https://docs.nvidia.com/ai-enterprise/support-matrix/latest/index.html)
- [NVIDIA Multi-Instance GPU User Guide](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/latest/getting-started-with-mig.html)
- [NVIDIA GPU Operator Time-Slicing GPUs In Kubernetes](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-sharing.html)
- [NVIDIA Triton Model Configuration](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_configuration.html)
- [NVIDIA Triton Dynamic Batcher](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html)
- [NVIDIA Triton Metrics](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/metrics.html)
- [Kubernetes Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)
