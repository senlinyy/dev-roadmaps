---
title: "MLOps Tooling Overview"
description: "Place Kubeflow Pipelines, Ray, BentoML, Triton, KServe, and TorchServe on the ML lifecycle map through a production recommender platform."
overview: "MLOps tooling makes sense when each tool has a job in the lifecycle: pipelines coordinate steps, distributed systems run heavy work, service frameworks package APIs, inference servers optimize model execution, and Kubernetes-native serving layers expose stable production endpoints."
tags: ["MLOps", "advanced", "platform"]
order: 2
id: "article-mlops-mlops-infrastructure-kubeflow-ray-bentoml-triton-torchserve"
---

## Table of Contents

1. [Why These Tools Exist](#why-these-tools-exist)
2. [The Recommender Platform Map](#the-recommender-platform-map)
3. [Kubeflow Pipelines for Workflow Evidence](#kubeflow-pipelines-for-workflow-evidence)
4. [Ray for Distributed Training and Serving Logic](#ray-for-distributed-training-and-serving-logic)
5. [BentoML for Python Model APIs](#bentoml-for-python-model-apis)
6. [Triton for High-Throughput Inference](#triton-for-high-throughput-inference)
7. [KServe for Kubernetes-Native Serving](#kserve-for-kubernetes-native-serving)
8. [TorchServe as a Legacy PyTorch Serving Choice](#torchserve-as-a-legacy-pytorch-serving-choice)
9. [Choosing a Stack Without Collecting Tools](#choosing-a-stack-without-collecting-tools)
10. [Practical Checks and Interview-Ready Understanding](#practical-checks-and-interview-ready-understanding)
11. [References](#references)

## Why These Tools Exist
<!-- section-summary: MLOps tools make more sense when you map each one to a lifecycle job instead of memorizing product names. -->

An **MLOps tooling overview** is a map of responsibilities. It tells you which tool coordinates work, which tool runs distributed compute, which tool packages a model API, which tool serves tensors efficiently, and which layer exposes the service on Kubernetes. The goal is to understand the shape of a production platform before choosing products.

Use a company called Meridian Books as the running example. Meridian sells technical books and courses. Its recommender system powers three surfaces: "similar books" on product pages, "next course" inside the learning app, and a weekly email that suggests titles based on reading history. The recommender team has data engineers, ML engineers, backend engineers, and a small platform team.

The first version was simple. A notebook trained a ranking model. A Python service loaded a pickle file. A cron script refreshed recommendations once a week. That worked while traffic was small. Then the product changed. The website needed lower latency. The learning app needed fresh recommendations every day. The email team wanted a batch scorer for millions of subscribers. The ML team wanted A/B tests, model lineage, and a reliable way to compare candidate models. The platform team wanted fewer mystery scripts running on random machines.

That is where the tools in this article fit. **Kubeflow Pipelines** can turn training and evaluation into a repeatable workflow. **Ray** can run distributed Python work for candidate generation, tuning, training, and flexible serving logic. **BentoML** can package a Python model service with a clean API and runtime definition. **NVIDIA Triton Inference Server** can serve optimized model formats with batching and GPU utilization. **KServe** can expose model servers as Kubernetes-native inference services. **TorchServe** can still appear in older PyTorch estates, yet current PyTorch Serve docs mark it as Limited Maintenance, so new platform decisions need care.

These tools overlap in places. Ray Serve can serve models. BentoML can deploy APIs. KServe can use runtimes such as Triton. Kubeflow Pipelines can run containers that call Ray or build Bentos. A mature platform does not install everything and hope a pattern appears. It chooses a small set of tools with clear handoffs.

## The Recommender Platform Map
<!-- section-summary: The recommender system needs orchestration, distributed compute, packaging, inference serving, rollout control, and operating evidence. -->

Start with the actual workflow at Meridian. The recommender platform has five recurring jobs:

| Platform need | Example in Meridian | Tool family |
|---|---|---|
| Coordinate steps | Validate events, train model, evaluate metrics, register candidate | Kubeflow Pipelines or a managed pipeline service |
| Run distributed Python | Generate embeddings, train ranking model, tune hyperparameters | Ray Jobs, Ray Train, Ray Data, Ray Tune |
| Package Python API logic | Candidate filtering, business rules, fallback responses | BentoML or Ray Serve |
| Optimize tensor inference | Batch ranking requests on GPU with strict latency budget | Triton |
| Expose on Kubernetes | Autoscaling, traffic split, stable endpoint, runtime abstraction | KServe or plain Deployment/Service |

This table matters because it keeps the discussion grounded. Kubeflow Pipelines should not be judged as a low-latency inference server. Triton should not be judged as a general workflow orchestrator. BentoML should not be asked to replace data lineage. Each tool solves a different part of the platform.

The high-level path looks like this:

1. Daily events land in the warehouse and object storage.
2. Kubeflow Pipelines starts a training workflow with versioned inputs.
3. A pipeline component submits a Ray Job for distributed training.
4. Evaluation compares recall, click-through lift, latency, and segment fairness.
5. Approved model artifacts move to the registry and serving repository.
6. BentoML packages business logic around the model, or Triton serves the optimized ranking graph.
7. KServe or a Deployment exposes the endpoint, with traffic split and rollback evidence.
8. Metrics and logs connect each request to model version, feature version, and experiment arm.

![Meridian Books recommender platform tool map](/content-assets/articles/article-mlops-mlops-infrastructure-kubeflow-ray-bentoml-triton-torchserve/mlops-tooling-recommender-map.png)
*Meridian maps each tool to one lifecycle job so orchestration, distributed compute, API packaging, tensor inference, rollout, and monitoring stay connected.*

The rest of the article walks through each tool at the point where it naturally appears in this flow.

## Kubeflow Pipelines for Workflow Evidence
<!-- section-summary: Kubeflow Pipelines describes ML workflows as components and pipeline graphs so runs can be repeated, inspected, and compared. -->

**Kubeflow Pipelines**, often shortened to KFP, is a workflow system for ML pipelines. A pipeline is a graph of steps. Each step runs a component, and each component usually maps to one container execution. That container can validate data, train a model, evaluate metrics, or write an artifact. The important idea is repeatability: the run has inputs, code, outputs, metadata, logs, and status.

Meridian uses KFP for the daily recommender training workflow. The pipeline does not train the entire model inside one giant script. It separates work into steps that reviewers can inspect:

| Step | Owner | Output |
|---|---|---|
| Validate events | Data engineering | Data quality report |
| Build training set | Feature team | Versioned training dataset |
| Train ranker | ML engineering | Model artifact and run metrics |
| Evaluate candidate | ML engineering and product | Metrics report and approval signal |
| Publish candidate | Platform team | Registry entry and serving manifest |

Here is a small KFP-style pipeline sketch. The code is intentionally simple so you can see the shape. Real production code would move the component bodies into reviewed modules and pin container images.

```python
from kfp import compiler, dsl


@dsl.component(
    base_image="python:3.11",
    packages_to_install=["pandas==2.3.1", "pyarrow==18.1.0"],
)
def validate_events(events_uri: str, report: dsl.Output[dsl.Artifact]) -> None:
    import json
    from pathlib import Path

    summary = {
        "events_uri": events_uri,
        "min_rows": 50_000_000,
        "required_columns": ["user_id", "item_id", "event_time", "event_type"],
        "status": "passed",
    }
    Path(report.path).write_text(json.dumps(summary), encoding="utf-8")


@dsl.component(
    base_image="python:3.11",
    packages_to_install=["ray[default]==2.56.0"],
)
def submit_ray_training(dataset_uri: str, model_uri: str) -> str:
    import subprocess

    command = [
        "ray",
        "job",
        "submit",
        "--address",
        "http://ray-head.ray.svc.cluster.local:8265",
        "--working-dir",
        ".",
        "--",
        "python",
        "train_ranker.py",
        "--dataset-uri",
        dataset_uri,
        "--model-uri",
        model_uri,
    ]
    subprocess.run(command, check=True)
    return model_uri


@dsl.pipeline(name="daily-recommender-training")
def recommender_pipeline(events_uri: str, dataset_uri: str, model_uri: str):
    validation = validate_events(events_uri=events_uri)
    training = submit_ray_training(dataset_uri=dataset_uri, model_uri=model_uri)
    training.after(validation)


compiler.Compiler().compile(
    pipeline_func=recommender_pipeline,
    package_path="daily_recommender_training.yaml",
)
```

The useful part is the contract. The validation step writes a report artifact. The training step receives a dataset URI and a model URI. The pipeline graph records which inputs produced which output. If tomorrow's model performs worse, the team can compare pipeline run IDs instead of trying to remember which notebook cell ran.

KFP also gives teams a place to enforce gates. Meridian refuses to publish a recommender if validation fails, if the candidate model loses more than 1 percent recall on new users, or if the inference latency estimate exceeds the serving budget. A gate can be a component that reads metrics and writes an approval artifact. The release job should read that artifact before updating production manifests.

The main beginner trap is treating the pipeline as a giant Python program. Keep each component small enough to test and retry. Put data contracts and model artifacts into explicit inputs and outputs. Use components to create evidence, not only to run commands.

![Kubeflow Pipelines to Ray handoff](/content-assets/articles/article-mlops-mlops-infrastructure-kubeflow-ray-bentoml-triton-torchserve/kfp-ray-handoff.png)
*The pipeline owns run evidence and handoff contracts, while Ray owns the distributed training work and returns status, logs, and metrics to the workflow.*

## Ray for Distributed Training and Serving Logic
<!-- section-summary: Ray fits Python workloads that need distributed execution, from training and data processing to flexible multi-model serving. -->

**Ray** is a distributed Python system. It lets a team take Python work that is too large for one process and spread it across a cluster using tasks, actors, datasets, training workers, tuning jobs, and serving replicas. In Meridian's recommender platform, Ray handles two kinds of work: heavy training jobs and serving logic that composes several models.

Ray Jobs give the platform a clean submission path. A Ray job is one application submitted to a Ray cluster. The driver script starts on the cluster, then creates tasks and actors across Ray workers. The Ray Jobs CLI can submit a working directory, set runtime environment details, stream logs, and report status.

```bash
export RAY_API_SERVER_ADDRESS="http://ray-head.ray.svc.cluster.local:8265"

ray job submit \
  --working-dir ./recommender_training \
  --runtime-env-json='{"pip":["ray[data,train]==2.56.0","torch==2.8.0","xgboost==3.0.2"]}' \
  -- python train_ranker.py \
    --dataset-uri s3://meridian-ml/features/recsys/ds=2026-07-05 \
    --model-uri s3://meridian-ml/models/recsys/ranker/20260705-a31fd0
```

Important details in this command:

- `RAY_API_SERVER_ADDRESS` points at the Ray Dashboard and Jobs endpoint.
- `--working-dir` uploads the training code to the cluster.
- `--runtime-env-json` describes Python packages for the job environment.
- The script arguments keep dataset and output locations visible in run history.

Ray Serve is a serving library built on Ray. It is useful when inference is more than "send one tensor to one model." Meridian's online recommendation flow has a candidate generator, a ranker, a policy filter, and a fallback recommender for cold-start users. The platform can express those pieces in Python and scale each deployment separately.

```yaml
proxy_location: EveryNode
http_options:
  host: 0.0.0.0
  port: 8000
applications:
  - name: recommender
    route_prefix: /recommend
    import_path: serving.recommender:app
    runtime_env:
      pip:
        - ray[serve]==2.56.0
        - torch==2.8.0
        - pydantic==2.11.7
    deployments:
      - name: CandidateGenerator
        num_replicas: 2
        ray_actor_options:
          num_cpus: 1
      - name: Ranker
        num_replicas: 4
        ray_actor_options:
          num_cpus: 2
          num_gpus: 0.25
      - name: PolicyFilter
        num_replicas: 2
        ray_actor_options:
          num_cpus: 1
```

This YAML is a Serve config. Ray's production docs recommend Serve config files for deployment and updates because they describe the desired Serve applications, routes, runtime environment, and deployment parameters. On Kubernetes, teams commonly embed this config in a RayService custom resource through KubeRay.

Ray gives Meridian flexibility, yet it also asks for platform discipline. Ray clusters need autoscaling, dependency management, network access, authentication, dashboard access control, log collection, and cost guardrails. If every team creates its own always-on Ray cluster, the platform cost story gets messy quickly. Many teams start with one shared development cluster, then create isolated production clusters for high-value services.

## BentoML for Python Model APIs
<!-- section-summary: BentoML packages Python serving code, model dependencies, and API methods into a reproducible service artifact. -->

**BentoML** is useful when the model service is Python-heavy and the team wants a clean package around serving logic. A BentoML Service defines API methods, runtime resources, dependencies, and model loading behavior. The packaged artifact, called a Bento, includes the service code, dependencies, model references, and configuration needed for deployment.

Meridian uses BentoML for a support-facing recommendation explanation API. The API returns the top reasons a book was recommended, combines model scores with product metadata, and applies a few business rules. That service is more application logic than tensor optimization, so a Python service framework is a good fit.

```python
from __future__ import annotations

from pydantic import BaseModel
import bentoml


class RecommendationRequest(BaseModel):
    user_id: str
    surface: str
    max_items: int = 10


class RecommendationItem(BaseModel):
    item_id: str
    score: float
    reason: str


@bentoml.service(
    resources={"cpu": "2"},
    traffic={"timeout": 2},
)
class RecommendationExplainer:
    def __init__(self) -> None:
        self.model_ref = "s3://meridian-ml/models/recsys/explainer/20260705-a31fd0"

    @bentoml.api
    def explain(self, request: RecommendationRequest) -> list[RecommendationItem]:
        return [
            RecommendationItem(
                item_id="book-ml-platforms",
                score=0.92,
                reason=f"Strong match for {request.surface} reading history",
            )
        ][: request.max_items]
```

The Service definition shows the public API shape, input schema, output schema, resource hint, and timeout in one place. That makes review easier for backend engineers who need to call the service and for platform engineers who need to deploy it.

A modern BentoML project can define runtime details in Python or configuration files. The current docs describe a newer Python SDK for runtime specifications, while `pyproject.toml` and `bentofile.yaml` remain supported. A simple build configuration can still help beginners see the package boundary:

```toml
[tool.bentoml.build]
service = "service:RecommendationExplainer"
description = "Recommendation explanation API for support and merchandising tools"
include = ["service.py", "rules/*.yaml"]
python.packages = [
  "bentoml==1.4.20",
  "pydantic==2.11.7",
  "boto3==1.39.0"
]
```

Build and inspect the service:

```bash
bentoml build --name recommendation-explainer --version 20260705-a31fd0
bentoml list
bentoml containerize recommendation-explainer:20260705-a31fd0
```

BentoML shines when your service has Python preprocessing, postprocessing, validation, and business logic around a model. It is less compelling when the serving path is mostly high-throughput tensor execution on GPU. For that path, Triton often fits better.

## Triton for High-Throughput Inference
<!-- section-summary: Triton focuses on efficient model execution, model repositories, batching, model instances, and metrics for latency-sensitive inference. -->

**NVIDIA Triton Inference Server** is an inference server for optimized model execution. It can serve models from a file-system-based model repository, accept HTTP or gRPC requests, route each request to a per-model scheduler, batch requests, run model instances, and expose metrics. Triton is especially useful when the team needs high GPU utilization, dynamic batching, multiple model formats, and strict latency measurements.

Meridian uses Triton for the ranker that scores hundreds of candidate books per request. The model has already been exported to TensorRT. The online path sends feature tensors to Triton and receives scores. The surrounding API still handles user context, policy filters, and fallbacks, yet the hot ranking operation runs inside Triton.

Triton expects a model repository layout like this:

```bash
model_repository/
  book_ranker/
    config.pbtxt
    1/
      model.plan
```

The model name is `book_ranker`. Version `1` contains the model file. `config.pbtxt` describes inputs, outputs, batch size, model instances, and batching policy.

```protobuf
name: "book_ranker"
platform: "tensorrt_plan"
max_batch_size: 64

input [
  {
    name: "features"
    data_type: TYPE_FP32
    dims: [256]
  }
]

output [
  {
    name: "score"
    data_type: TYPE_FP32
    dims: [1]
  }
]

dynamic_batching {
  max_queue_delay_microseconds: 100
}

instance_group [
  {
    kind: KIND_GPU
    count: 2
  }
]
```

Dynamic batching lets Triton combine compatible requests inside a short queue window. That can improve throughput when many small requests arrive at the same time. The delay budget is a product decision. Meridian can afford 100 microseconds inside the ranker because the end-to-end API target is 80 ms. A different system, such as fraud authorization, might use a much tighter queue delay or skip batching.

Run Triton locally against the model repository:

```bash
docker run --rm --gpus all \
  -p 8000:8000 \
  -p 8001:8001 \
  -p 8002:8002 \
  -v "$PWD/model_repository:/models" \
  nvcr.io/nvidia/tritonserver:26.06-py3 \
  tritonserver --model-repository=/models
```

The three ports expose HTTP, gRPC, and metrics in common Triton configurations. In production, Meridian deploys Triton behind Kubernetes or KServe, scrapes metrics, and load-tests every model version before shifting user traffic. The release check includes latency percentiles, GPU utilization, batch-size distribution, error rate, and response correctness on a fixed validation payload set.

Triton is powerful, yet it wants a well-prepared model artifact. The team needs export scripts, model repository validation, compatibility tests, and performance testing. If the model still needs rich Python business logic around every call, wrap Triton behind a service rather than forcing all logic into the inference server.

## KServe for Kubernetes-Native Serving
<!-- section-summary: KServe adds Kubernetes custom resources for inference services, runtimes, autoscaling, canary rollout, transformers, and explainers. -->

**KServe** extends Kubernetes with custom resources for AI and ML serving. The central object is an `InferenceService`. Instead of writing a raw Deployment, Service, autoscaler, and networking setup each time, the platform describes the model serving intent, and KServe manages the serving resources.

For Meridian, KServe is attractive because the platform team already runs Kubernetes and wants a common serving API for several model formats. Some models use Triton. Some use custom containers. Some need a transformer for preprocessing. KServe gives the platform a standard resource shape while still allowing different runtimes underneath.

Here is a simplified KServe `InferenceService` for the Triton ranker:

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: book-ranker
  namespace: recommender-prod
  labels:
    app: meridian-recommender
    model_version: "20260705-a31fd0"
spec:
  predictor:
    model:
      modelFormat:
        name: triton
      storageUri: s3://meridian-ml/triton-model-repository/book_ranker/20260705-a31fd0
      resources:
        requests:
          cpu: "2"
          memory: 8Gi
          nvidia.com/gpu: "1"
        limits:
          cpu: "4"
          memory: 12Gi
          nvidia.com/gpu: "1"
```

This object says the predictor uses a Triton-format model from a storage URI and needs one GPU. KServe can handle serving lifecycle concerns such as runtime selection, autoscaling, networking, health, and rollout behavior depending on installation mode and configuration. The official KServe docs also describe data-plane pieces such as predictors, transformers, and explainers, which map well to ML serving patterns.

KServe is especially useful when many teams serve models on the same cluster. The platform can publish approved runtimes, standardize logging and metrics, and enforce namespace rules. A team that needs pure custom Python can use a custom runtime. A team that needs optimized GPU inference can use Triton. A team that needs LLM serving can use a runtime suited to that path.

The caution is operational complexity. KServe sits on top of Kubernetes and integrates with networking, autoscaling, storage initializers, runtime images, and security policy. A small team with two simple APIs may prefer plain Deployments or BentoML. A platform team serving dozens of models across many teams often gets value from the standard `InferenceService` API.

## TorchServe as a Legacy PyTorch Serving Choice
<!-- section-summary: TorchServe can still appear in existing PyTorch estates, yet current official docs place it in Limited Maintenance. -->

**TorchServe** is a PyTorch model serving system that packages models into model archives, loads handlers, exposes inference APIs, and reports metrics. Many teams used it as the default way to serve PyTorch models before newer platform patterns matured. You may still find it inside older estates, vendor examples, or systems that packaged `.mar` files years ago.

The current official PyTorch Serve documentation marks TorchServe as **Limited Maintenance**. It says existing releases remain available and lists no planned updates, bug fixes, new features, or security patches. That is a serious platform signal. For new production work, Meridian would usually choose Triton, Ray Serve, BentoML, KServe with an approved runtime, or a managed provider serving layer instead.

If you inherit TorchServe, understand the packaging flow so you can support and migrate it safely:

```bash
torch-model-archiver \
  --model-name book_ranker \
  --version 20260705 \
  --serialized-file ranker.pt \
  --handler handler.py \
  --export-path model-store

torchserve \
  --start \
  --model-store model-store \
  --models book_ranker=book_ranker.mar
```

The `.mar` file packages the serialized model and handler. The handler controls preprocessing, inference, and postprocessing. In a legacy estate, the practical review questions are direct: which Python and PyTorch versions does this need, who owns the handler code, how is the model archive scanned, how are management APIs protected, and what is the migration path if a security issue appears?

The right way to teach TorchServe today is with status context. It is a tool you may need to operate during migration. It should receive extra scrutiny as a new default because the maintenance signal affects patching and long-term risk.

## Choosing a Stack Without Collecting Tools
<!-- section-summary: A good platform chooses the smallest set of tools that covers orchestration, compute, packaging, serving, rollout, and evidence. -->

Meridian could assemble the recommender platform in several valid ways. The stack depends on traffic, team skill, latency, hardware, governance, and managed-service appetite.

| Situation | Practical stack |
|---|---|
| Small team, Python API, modest traffic | BentoML service on Kubernetes or a managed container platform |
| Heavy distributed training in Python | Kubeflow Pipelines submits Ray Jobs and records artifacts |
| High-throughput GPU ranking | Triton behind KServe or a hand-written Kubernetes Deployment |
| Multi-step online service with Python composition | Ray Serve, with model calls to Triton for hot paths |
| Many teams serving many model types | KServe with approved runtimes, platform guardrails, and shared observability |
| Existing PyTorch TorchServe estate | Operate with maintenance caveats and plan a migration path |

A good decision starts with the bottleneck. If the bottleneck is workflow evidence, start with pipelines. If the bottleneck is distributed Python compute, start with Ray. If the bottleneck is clean Python API packaging, start with BentoML. If the bottleneck is GPU inference throughput, start with Triton. If the bottleneck is serving standardization across Kubernetes teams, start with KServe.

Avoid a platform where every model has a different release path. Meridian writes a simple contract for every serving project:

```yaml
model_contract:
  owner: recommender-ml
  model_name: book-ranker
  model_version: 20260705-a31fd0
  training_run: kfp-run-8ad31
  serving_runtime: triton
  endpoint: /recommend/rank
  latency_budget_ms:
    p50: 30
    p95: 80
  rollback:
    previous_model_version: 20260704-7bb911
    command: kubectl -n recommender-prod rollout undo deployment/book-ranker
  required_dashboards:
    - request-rate
    - error-rate
    - latency
    - gpu-utilization
    - model-quality-by-segment
```

This contract matters more than the logo on the runtime. It tells operators who owns the model, which run created it, where it is served, what latency is acceptable, how rollback works, and which dashboards must stay healthy.

![Serving tool choices by platform need](/content-assets/articles/article-mlops-mlops-infrastructure-kubeflow-ray-bentoml-triton-torchserve/serving-tool-choice.png)
*Meridian chooses serving tools by the shape of the workload: Python logic, tensor throughput, or Kubernetes rollout control.*

## Practical Checks and Interview-Ready Understanding
<!-- section-summary: The practical skill is explaining which lifecycle job each tool owns and which evidence proves the handoff works. -->

Before Meridian approves a tool choice, reviewers ask these questions:

| Check | What good evidence shows |
|---|---|
| Lifecycle fit | The tool has a clear job in orchestration, distributed compute, packaging, serving, or rollout |
| Artifact path | Dataset, model, image, and config versions connect across the workflow |
| Runtime ownership | One team owns upgrades, security review, and incident response |
| Release path | The model can move from candidate to production with metrics and approval evidence |
| Rollback path | The previous model version or service config can return quickly |
| Observability | Logs, metrics, traces, and model quality dashboards connect to model version |
| Cost guardrail | GPU clusters, Ray clusters, and serving replicas have budgets and idle controls |
| Maintenance status | Legacy tools such as TorchServe receive migration review |

Common mistakes are predictable. A team installs Kubeflow and expects it to solve serving latency. A team uses Ray for every small task and leaves clusters idle. A team deploys Triton before it has a reliable model export process. A team wraps every model in a custom Python service and later discovers the hot path needs batching and GPU metrics. A team chooses KServe because it sounds standard, then forgets the networking and runtime operations behind it.

The interview-ready explanation is this: Kubeflow Pipelines coordinates repeatable ML workflows and captures run evidence. Ray runs distributed Python work and can serve flexible model graphs. BentoML packages Python model APIs and serving logic. Triton optimizes inference execution with model repositories, model instances, batching, and metrics. KServe gives Kubernetes teams a standard inference service API. TorchServe is mainly a legacy PyTorch serving system now that official docs mark it as Limited Maintenance. The platform skill is choosing the smallest set that covers the lifecycle with clear handoffs.

## References

- [Kubeflow Pipelines overview](https://www.kubeflow.org/docs/components/pipelines/overview/) - Official KFP documentation defining pipelines as DAGs of components and container executions.
- [Kubeflow Pipelines component specification](https://www.kubeflow.org/docs/components/pipelines/reference/component-spec/) - Official component model for metadata, inputs, outputs, and implementation.
- [Kubeflow Pipelines artifacts](https://www.kubeflow.org/docs/components/pipelines/user-guides/data-handling/artifacts/) - Official documentation for pipeline artifacts and ML Metadata integration.
- [Ray Jobs CLI quickstart](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/quickstart.html) - Official Ray documentation for submitting and inspecting jobs.
- [Ray Jobs CLI reference](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/cli.html) - Official Ray command reference for job submission flags.
- [Ray Serve overview](https://docs.ray.io/en/latest/serve/index.html) - Official Ray Serve documentation for scalable model serving and model composition.
- [Ray Serve config files](https://docs.ray.io/en/latest/serve/production-guide/config.html) - Official production guidance for Serve YAML configuration.
- [BentoML Services](https://docs.bentoml.com/en/latest/build-with-bentoml/services.html) - Official BentoML documentation for class-based service definitions and APIs.
- [BentoML packaging for deployment](https://docs.bentoml.com/en/latest/get-started/packaging-for-deployment.html) - Official documentation for packaging services and runtime environments.
- [BentoML build options](https://docs.bentoml.com/en/latest/reference/bentoml/bento-build-options.html) - Official reference for build configuration and the newer Python SDK note.
- [NVIDIA Triton Inference Server](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/index.html) - Official Triton architecture and feature documentation.
- [Triton model repository](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_repository.html) - Official documentation for repository layout and `--model-repository`.
- [Triton dynamic batching](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html) - Official documentation for dynamic batcher behavior and tuning.
- [KServe introduction](https://kserve.github.io/website/docs/intro) - Official KServe overview for InferenceService, runtimes, predictors, transformers, explainers, autoscaling, and rollout features.
- [KServe InferenceService LLM tutorial](https://kserve.github.io/website/docs/getting-started/genai-first-isvc) - Official example showing the `serving.kserve.io/v1beta1` InferenceService shape.
- [TorchServe documentation](https://docs.pytorch.org/serve/) - Official PyTorch Serve documentation with the Limited Maintenance notice.
