---
title: "Cloud Run"
description: "Understand how Cloud Run turns a container into a managed service with an endpoint, revisions, traffic control, scaling, identity, logs, and release safety."
overview: "Cloud Run is a strong first GCP home for containers that already work locally and need a service endpoint, scaling, release history, logs, and runtime identity."
tags: ["gcp", "cloud-run", "containers", "revisions"]
order: 2
id: article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis
aliases:
  - cloud-run-services-for-backend-apis
  - cloud-providers/gcp/compute-application-hosting/cloud-run-services-for-backend-apis.md
---

## Table of Contents

1. [What Problem Does Cloud Run Solve?](#what-problem-does-cloud-run-solve)
2. [How Does a Container Become a Stable Service?](#how-does-a-container-become-a-stable-service)
3. [Why Does Cloud Run Create Immutable Revisions?](#why-does-cloud-run-create-immutable-revisions)
4. [How Do Instances, Concurrency, and Autoscaling Work?](#how-do-instances-concurrency-and-autoscaling-work)
5. [How Do Minimum, Maximum, and Concurrency Set Capacity?](#how-do-minimum-maximum-and-concurrency-set-capacity)
6. [How Do Identity, Secrets, and Logs Fit the Runtime?](#how-do-identity-secrets-and-logs-fit-the-runtime)
7. [How Do You Deploy and Verify a Safe Release?](#how-do-you-deploy-and-verify-a-safe-release)
8. [What Happens During a Complete Cloud Run Request?](#what-happens-during-a-complete-cloud-run-request)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An API handler is only one small part of a production service. Without a managed platform, the path from an internet client to that handler can include a TLS certificate, load balancer, server, operating system, runtime, and application process. The team must also decide what happens after a server failure, a hundredfold traffic increase, a quiet period, a new release, a rollback, an authorization call to Cloud Storage, or an operating-system security update.

**Cloud Run** moves much of that machinery below the application team's abstraction boundary. The team supplies an application and requests CPU, memory, an HTTPS endpoint, identity, logs, and scaling behavior. Google manages underlying placement, the managed HTTPS frontend, instance creation, autoscaling, and much of the runtime infrastructure.

The machine-oriented contract says, “Give me a computer.” The Cloud Run contract says, “Run my application.” That is the fundamental tradeoff: less direct server control in exchange for less server operation.

Keep these questions in view as you work through the lesson:

1. **What Problem Does Cloud Run Solve?**
2. **How Does a Container Become a Stable Service?**
3. **Why Does Cloud Run Create Immutable Revisions?**
4. **How Do Instances, Concurrency, and Autoscaling Work?**
5. **How Do Minimum, Maximum, and Concurrency Set Capacity?**
6. **How Do Identity, Secrets, and Logs Fit the Runtime?**
7. **How Do You Deploy and Verify a Safe Release?**
8. **What Happens During a Complete Cloud Run Request?**

## What Problem Does Cloud Run Solve?
<!-- section-summary: Cloud Run turns an application package into a stable network service while Google creates and removes runtime instances as demand changes. -->

The most useful model contains four separate objects:

```text
SERVICE  -> stable application and front door
REVISION -> immutable application code plus configuration
INSTANCE -> temporary running copy of one revision
REQUEST  -> one unit of work routed to an instance
```

Conceptually, a stable service URL receives a request. A traffic policy chooses a revision, perhaps sending 90 percent to revision A and 10 percent to revision B. Cloud Run then chooses an instance with capacity or creates more instances. Each instance runs the revision's container.

```text
clients -> stable service URL
              |
        traffic policy
          /        \
         v          v
   revision A   revision B
      90%          10%
      / \            \
 instance instance   instance
```

Those four objects explain the rest of Cloud Run. The service gives continuity, the revision gives versioning, the instance gives CPU and memory for execution, and the request supplies the individual work. This article focuses on Cloud Run services because stable HTTP endpoints, revision traffic, and request concurrency are clearest there. Cloud Run also includes jobs and worker pools, but their lifecycles differ from a request-serving service.

## How Does a Container Become a Stable Service?
<!-- section-summary: Cloud Run builds or accepts a container, enforces a small HTTP contract, and places disposable instances behind one long-lived HTTPS service. -->

Cloud Run needs a reproducible execution package. A **container image** bundles application code, its language runtime, libraries, binaries, and the filesystem contents needed at runtime. Because that package can contain many languages and frameworks, Cloud Run does not require one specific programming stack.

“Container first” does not require every developer to write and build a Dockerfile manually. A source deployment such as this lets Google build the image before deployment:

```bash
gcloud run deploy --source .
```

The conceptual pipeline remains the same:

```text
source code
    |
build container image
    |
deploy image and configuration
    |
create Cloud Run revision
```

For a service, the container must satisfy a small runtime contract. Cloud Run sends HTTP requests to a port made available through the `PORT` environment variable. The ingress container listens on that port on `0.0.0.0`, not only on `127.0.0.1`. Port `8080` is the common default.

```python
port = int(os.environ["PORT"])
app.listen(host="0.0.0.0", port=port)
```

Binding only to localhost would leave the listener reachable only from inside the container's own network namespace. The managed Cloud Run frontend needs the container's network interface.

The application also normally avoids public certificate management. A caller connects to the service's HTTPS URL, TLS terminates at Google's managed frontend, and Cloud Run proxies the request to the ingress container. The application operates an HTTP listener while the platform operates much of the public HTTPS service infrastructure.

After deployment, Cloud Run gives the service a stable `run.app` URL. That URL identifies the **service**, not an individual container or host. A thousand users might be served by four instances at one moment, one instance later, and zero active instances after a quiet period. The service continues to exist through all of those states.

```text
service lifetime  -> long lived
instance lifetime -> disposable
```

This is why important local state is unsafe. The container filesystem is writable, and temporary files can be useful during one request, but the filesystem belongs to that instance. When Cloud Run removes the instance, files stored only there disappear. Anything that must survive belongs in an external durable system such as Cloud SQL, Firestore, Cloud Storage, Spanner, or another persistent store.

Statelessness does not forbid memory, caches, or temporary files. It means correctness does not depend on one instance remaining alive. The service supplies the stable public identity; durable systems supply persistent data.

This boundary also changes troubleshooting language. “The service is down” does not identify a machine to repair. Operators ask whether the service configuration is valid, which revision receives traffic, whether that revision has ready instances, whether cold starts or capacity limits delay work, and whether the external state systems are available. The platform can replace an instance automatically, while the team still owns application correctness and dependency health.

The stable URL is what lets clients ignore those replacements. A caller keeps using the same address through scale-out, scale-in, instance recycling, and revision changes. That continuity is a service property rather than evidence that the same container stayed alive.

## Why Does Cloud Run Create Immutable Revisions?
<!-- section-summary: A revision freezes code and revision-scoped configuration so traffic can move safely among known versions. -->

Suppose an `orders-api` service currently uses image `orders:v1`, 512 MiB of memory, concurrency `20`, and `MODE=production`. Deploying `orders:v2` does not edit the running version in place. Cloud Run creates a new **revision**.

```text
orders-api service
|-- orders-api-00001  image=v1
`-- orders-api-00002  image=v2
```

A revision is immutable. It is better understood as a frozen deployment specification than as a server that an operator keeps modifying. Revision-scoped configuration belongs in the freeze as well. Changing memory from 512 MiB to 1 GiB, altering an environment variable, or modifying concurrency can produce a new revision even if the image remains the same.

That gives every version a complete identity:

```text
revision A = code A + configuration A
revision B = code B + configuration B
```

Rolling back to revision A therefore restores its known deployment configuration, not merely an older source file. This property is also what makes traffic splitting meaningful. A stable service URL can send 95 percent of requests to revision A and 5 percent to revision B because each target has a fixed definition.

![A Cloud Run service keeps one stable front door while traffic is divided across immutable revisions](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-release-shape.png)

*Immutability lets a traffic percentage refer to a stable combination of image and configuration.*

The team can progress from `95/5` to `75/25`, `50/50`, and finally `0/100` while observing latency and errors. If revision B behaves badly, traffic returns to A without rebuilding either revision or changing the service URL.

Cloud Run therefore separates **deployment** from **release**. Deploying means the new revision exists. Releasing means production traffic is assigned to it. The following command creates a revision while leaving ordinary production traffic on existing revisions:

```bash
gcloud run deploy orders-api \
  --source . \
  --no-traffic
```

The resulting sequence is build, deploy, test the new revision, shift a small amount of traffic, observe, and then increase or reverse the allocation. A deployment does not have to mean that every user receives the new code immediately.

## How Do Instances, Concurrency, and Autoscaling Work?
<!-- section-summary: Revisions describe a runtime, instances execute it, concurrency shares each instance, and autoscaling changes the number of instances. -->

A revision is a specification. Requests still require actual CPU and RAM, so Cloud Run starts **instances** of that revision. If revision B defines image v2, 1 GiB of memory, and concurrency 20, every B instance follows that same definition. When one instance disappears, another can replace it without changing the revision.

An instance can usually handle more than one request at a time. **Maximum concurrency** controls the number of simultaneous in-flight requests Cloud Run may send to one instance. If concurrency is 20, up to roughly 20 requests can be active inside that instance at once. Cloud Run supports configurable concurrency up to 1000; creation paths have different defaults, so the mechanism is more important than memorizing one number.

Concurrency changes the capacity intuition. With 240 simultaneous requests and a useful concurrency of 80, at least about three instances are needed. If useful concurrency is 10, the same load may require about 24 instances.

```text
required instances
  approximately equals
concurrent demand / useful concurrency per instance
```

That is not the complete autoscaling formula. Cloud Run also evaluates signals including CPU and concurrency utilization. It is the right beginner model for understanding why one setting changes how much horizontal capacity a request burst needs.

Higher concurrency is not automatically better. If requests spend much of their time waiting on a database, an instance can overlap many waits productively. If each request saturates the CPU while processing an image, sending 80 at once to one CPU can create contention and long latency. Concurrency expresses how effectively the application shares one instance's resources among simultaneous requests.

Autoscaling supplies the horizontal half of the model. With no requests, a revision that receives traffic can normally reach zero active instances. As requests arrive, Cloud Run creates instances; as demand increases, it creates more; and after demand subsides, it removes idle instances.

Scale to zero reduces idle resource usage but introduces a **cold start**. When a request arrives with no suitable active instance, Cloud Run starts the container and the application initializes before it can serve the request. A small program may start quickly. A large framework, cache build, dependency setup, or model load can add meaningful latency.

Cold-start work should be separated from per-request work. Loading libraries and creating reusable clients once during instance initialization can be efficient, provided correctness does not depend on that instance surviving. Reading durable request data, authorizing the operation, and writing the result still happen for each request. The platform may reuse a warm instance, but the application must remain correct when the next request lands on a fresh one.

Traffic shape determines how noticeable startup becomes. A steadily busy service is more likely to have active instances, while an infrequently called endpoint may encounter a fresh start after quiet periods. Minimum instances changes that probability by retaining baseline capacity; it does not remove the need for a container that can initialize reliably and within the platform's startup contract.

Cloud Run's minimum-instance setting lets the team trade some ongoing resource cost for lower cold-start probability and baseline capacity. Consider that setting alongside maximum instances and concurrency to understand the full capacity tradeoff.

## How Do Minimum, Maximum, and Concurrency Set Capacity?
<!-- section-summary: Minimum instances set the warm baseline, concurrency sets work per instance, and maximum instances bounds normal horizontal expansion. -->

With `min instances = 0`, a quiet service may have no active instance. With `min instances = 2`, Cloud Run attempts to keep that baseline available even when traffic is low. A minimum can reduce startup latency, provide warmer capacity, or support runtime considerations that require instances to remain available.

```text
minimum = 2

low demand    [I1] [I2]
medium demand [I1] [I2] [I3] [I4]
high demand   [I1] [I2] [I3] [I4] ...
```

Those retained resources have a cost. A production label alone is not a reason to choose a large minimum. The latency or baseline-capacity requirement should justify it.

**Maximum instances** addresses the opposite risk. An application layer can sometimes scale faster than a database or another dependency. If every instance opens ten database connections, ten instances produce about 100 connections, 50 produce about 500, and 100 produce about 1,000. A database that safely supports 500 could be overwhelmed by unbounded application fan-out.

A maximum-instance setting limits normal autoscaling expansion and helps control cost or pressure on backing services. It is not a perfect hard circuit breaker. Cloud Run can temporarily go beyond a configured maximum during conditions such as replacement activity or rapid traffic changes. Revision-level maximums also apply to each revision, so several traffic-serving revisions can have a combined count above one revision's limit.

Downstream safety therefore also needs connection pools, quotas, rate limits, backpressure, and resilience. The design must not assume that the existence of instance number 51 would be catastrophic.

The three controls form one capacity system:

```text
minimum instances -> baseline capacity kept available
concurrency       -> simultaneous work assigned to each instance
maximum instances -> normal limit on horizontal expansion
```

A setting of minimum 2, concurrency 20, and maximum 50 says: keep a warm baseline, let each instance multiplex supported work, expand as demand rises, and constrain normal growth near the configured maximum.

Work through the numbers as a sanity check. Twenty simultaneous requests per instance and a normal maximum of 50 instances describes space for roughly 1,000 in-flight requests if every instance reaches the configured concurrency. That is an upper-bound intuition rather than a throughput promise. A request that finishes in 50 milliseconds creates a different request-per-second rate from one that waits five seconds on a partner API. CPU limits, memory, startup time, autoscaler reaction, downstream latency, and the application's own worker model can all reduce useful capacity.

The baseline has a similar interpretation. Two minimum instances with useful concurrency 20 make about 40 warm request slots available before additional instances start, but they do not guarantee that 40 CPU-heavy requests will meet a latency target. If the container has one CPU and each request consumes it fully, useful concurrency may be much lower than the configured ceiling. The correct tuning process measures the application rather than deriving confidence from arithmetic alone.

Downstream fan-out also depends on concurrency, not only instance count. Fifty instances with ten database connections each suggest 500 connections, but an application that opens one connection per simultaneous request could attempt far more when concurrency is 20. Connection pooling and bounded client libraries must be designed together with the Cloud Run settings. This is why minimum, maximum, and concurrency are a system: each changes how fast work reaches both the container and everything behind it.

![Cloud Run capacity, identity, secrets, logs, and downstream systems form one runtime control boundary](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-runtime-controls.png)

*Runtime controls must protect both request latency and the databases or APIs behind the service.*

Capacity cannot be tuned from request count alone. The team needs evidence about CPU, latency, database pressure, useful concurrency, cold starts, and request duration. The correct values reflect the service's actual resource profile and downstream limits.

## How Do Identity, Secrets, and Logs Fit the Runtime?
<!-- section-summary: Cloud Run separates caller, runtime, and deployer identities; keeps sensitive configuration outside images; and sends disposable-instance logs to a durable service. -->

Name three actors separately to clarify Cloud Run security.

The first is the **caller**. Inbound authentication answers who may invoke the service. Cloud Run services are private by default and can use IAM to authorize invocations. A public service deliberately grants unauthenticated access; a private service expects an authenticated caller with suitable permission.

The second is the **service identity**. This is the service account used by application code when it calls Secret Manager, Cloud Storage, Pub/Sub, or another Google API. IAM roles on that account define what the running workload can do.

The third is the **deployer identity**, such as a developer or CI pipeline. It needs permission to create or update the Cloud Run service and appropriate `actAs` permission when attaching a service account. The deployer does not automatically become the runtime identity.

```text
caller identity   -> who may invoke the service
service identity  -> what the running code may access
deployer identity -> who may create or change the service
```

This separation supports least privilege. A CI identity can deploy `orders-api` without reading customer data. The application's service account can read one secret and publish order events without permission to administer Cloud Run.

Some runtime configuration is sensitive. A database password, external API key, or private key should not be baked into a container image, because that image moves through a registry, build cache, and developer environments. Cloud Run integrates with Secret Manager and can supply secrets as environment variables or mounted files.

Environment-variable secrets are resolved as an instance starts. Secret volumes can retrieve secret data when the file is read, which can better suit some rotation patterns. In both cases, the container image remains a non-secret application artifact while Secret Manager owns the sensitive value's lifecycle.

Disposable instances also change logging. Logs stored only inside an instance would disappear with it. Applications therefore write to standard output and standard error, often using structured JSON. Cloud Run sends supported container output to Cloud Logging and also produces request and platform logs.

```text
request -> request log
      \-> container -> stdout or stderr -> Cloud Logging
      \-> platform and system evidence
```

Structured fields such as severity, request ID, and business operation make the output easier to search than one unstructured line. Cloud Run metadata also associates logs with a service and revision. If the service's aggregate error rate rises, operators can compare revision A and B. A sharp increase isolated to B provides direct evidence for moving traffic back to A.

Immutable revisions, traffic control, and revision-aware telemetry therefore reinforce one another. The revision gives the release a fixed identity, the traffic policy controls exposure, and the logs show whether that identity behaves correctly.

## How Do You Deploy and Verify a Safe Release?
<!-- section-summary: Verification checks the deployment, endpoint, response, revisions, and logs before traffic is progressively moved to a new version. -->

A minimal Python service can use Flask while still keeping the Cloud Run-specific contract visible:

```python
import os
from flask import Flask

app = Flask(__name__)

@app.get("/")
def hello():
    print("received request")
    return "Hello from Cloud Run\n"

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8080")),
    )
```

Flask is only the example framework. Listening on `0.0.0.0:$PORT` is the important platform behavior. With its dependencies present, the service can be built from source and deployed:

```bash
gcloud run deploy hello \
  --source . \
  --region=europe-west1 \
  --allow-unauthenticated
```

The unauthenticated flag is appropriate only when the service is intentionally public.

Verification should move through layers. First, retrieve the service endpoint:

```bash
gcloud run services describe hello \
  --region=europe-west1 \
  --format='value(status.url)'
```

Then call it:

```bash
curl https://YOUR-SERVICE-URL
```

The expected body is:

```text
Hello from Cloud Run
```

Next, confirm that deployment created an immutable revision:

```bash
gcloud run revisions list \
  --service hello \
  --region europe-west1
```

Finally, inspect application and platform evidence:

```bash
gcloud run services logs read hello \
  --limit=10
```

Those steps prove four different things: a deployment exists, the service has an endpoint, the endpoint serves a real request, and the application produced durable logs.

Layered verification matters because each earlier success can coexist with a later failure. A revision can exist while its container never becomes ready because it listens only on localhost. A ready service can have a URL while IAM rejects the caller. An authorized request can reach the container while an environment variable points to the wrong database. A correct response can still leave no useful support trail if the application logs omit request and revision context.

Readiness therefore begins the test rather than ending it. Confirm the created revision name and configuration, invoke through the same authentication and network path that real clients will use, exercise at least one dependency, and locate the corresponding request and application logs. That evidence ties the deployment specification to observable application behavior.

For version 2, change the response and deploy without ordinary traffic:

```bash
gcloud run deploy hello \
  --source . \
  --region=europe-west1 \
  --no-traffic
```

The service now has the old revision at 100 percent and the new revision at zero. After testing the new version, move a small percentage:

```bash
gcloud run services update-traffic hello \
  --to-revisions LATEST=5
```

Observe request success, error rate, and latency. If the revision is healthy, complete the release:

```bash
gcloud run services update-traffic hello \
  --to-latest
```

![A safe release deploys a revision, checks evidence, exposes a small traffic share, and rolls forward or back](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-safe-release-loop.png)

*Deployment creates the candidate; traffic movement and observation decide whether it becomes the release.*

The service URL stays the same throughout. If errors rise, traffic can return to the earlier immutable revision. This is safer than rebuilding during an incident or treating every deployment as an instant 100 percent release.

A percentage rollout also needs enough traffic to be informative. Five percent of ten requests reveals almost nothing; five percent of sustained production traffic may provide a useful sample. The team should watch revision-specific error rate and latency and keep an explicit rollback threshold. The platform supplies traffic controls, while the team decides what evidence is sufficient to increase exposure.

## What Happens During a Complete Cloud Run Request?
<!-- section-summary: A request crosses the managed frontend, authentication, traffic policy, revision, instance, application, dependencies, and telemetry layers. -->

Suppose a client calls `GET https://orders-api....run.app/orders/123`. DNS reaches Google's managed frontend, where TLS terminates. Cloud Run ingress and IAM rules determine whether the request may proceed. The service traffic policy chooses a revision according to the current percentages.

Cloud Run then selects an instance of that revision with concurrency capacity. If current capacity is insufficient, autoscaling can create additional instances. The ingress container receives the request on `PORT`, and application code runs with the revision's CPU, memory, environment, secrets, and service account.

The application may call Cloud SQL, Secret Manager, Cloud Storage, Pub/Sub, or another API. Durable data remains outside the disposable container. The code returns an HTTP response, while request, container, and system telemetry reaches Cloud Logging with service and revision context.

```text
DNS and managed TLS
        |
ingress and caller authorization
        |
service traffic policy
        |
chosen immutable revision
        |
instance with concurrency capacity
        |
container listening on PORT
        |
external state and Google APIs via service identity
        |
response plus logs and platform telemetry
```

Most Cloud Run settings control one part of that path:

| Setting | Runtime question |
|---|---|
| **Container image** | Which code and dependencies execute? |
| **CPU and memory** | Which resources does one instance receive? |
| **Environment variables** | Which ordinary configuration belongs to this revision? |
| **Service account** | Which identity does the running application use? |
| **Secrets** | How does sensitive configuration reach the instance? |
| **Ingress** | Which network paths can reach the service? |
| **IAM Invoker** | Which callers may invoke it? |
| **Concurrency** | How much simultaneous work can one instance accept? |
| **Minimum instances** | How much baseline capacity stays available? |
| **Maximum instances** | How far should normal horizontal scaling expand? |
| **Traffic split** | Which revision receives each request? |
| **VPC egress** | Which outbound network paths may the service use? |
| **Logs** | Which evidence describes execution and failures? |

The complete mental model is compact. A Cloud Run service is stable while instances are temporary. A container is the application package rather than a cherished server. Revision-scoped code and configuration are immutable. Traffic can be divided among those fixed revisions. Concurrency controls multiplexing within one instance; autoscaling controls how many instances exist. Minimum capacity trades cost for warmth, maximum capacity constrains normal fan-out, and external systems preserve durable state.

Service continuity also separates client configuration from release configuration. DNS names and integrations can keep targeting the service while operators change the image, memory, environment, concurrency, and traffic allocation through new revisions. That separation is why instance replacement and version rollout do not require every caller to discover a new destination.

Caller and service identity answer different security directions. Secrets remain outside the image. A safe release creates a revision, exposes a small percentage, observes revision-specific evidence, increases traffic when healthy, and returns to the previous revision if necessary.

That combination is Cloud Run's essential design: service for continuity, revision for versioning, instance for execution, concurrency for per-instance work, autoscaling for horizontal capacity, and external systems for state that must survive.

## Check Your Answers

:::expand[What Problem Does Cloud Run Solve?]{kind="recap"}
Cloud Run turns an application into a stable HTTPS service while Google manages placement, instance creation, autoscaling, and much of the host runtime. Service, revision, instance, and request are separate units.
:::

:::expand[How Does a Container Become a Stable Service?]{kind="recap"}
Cloud Run builds or accepts a container that listens on `0.0.0.0:$PORT`. A stable service URL sits in front of disposable instances, so durable state remains outside their local filesystems.
:::

:::expand[Why Does Cloud Run Create Immutable Revisions?]{kind="recap"}
A revision freezes image and revision-scoped configuration. Stable definitions let the service split traffic, stage releases, and roll back without rebuilding.
:::

:::expand[How Do Instances, Concurrency, and Autoscaling Work?]{kind="recap"}
Instances are running copies of a revision. Concurrency controls simultaneous requests per instance, and autoscaling changes the number of instances as demand rises or falls.
:::

:::expand[How Do Minimum, Maximum, and Concurrency Set Capacity?]{kind="recap"}
Minimum instances keep baseline capacity, concurrency controls useful work per instance, and maximum instances constrains normal horizontal expansion while downstream systems still need their own protection.
:::

:::expand[How Do Identity, Secrets, and Logs Fit the Runtime?]{kind="recap"}
Caller, service, and deployer identities have different jobs. Secret Manager keeps sensitive values outside images, and Cloud Logging preserves request, container, and revision evidence beyond instance lifetime.
:::

:::expand[How Do You Deploy and Verify a Safe Release?]{kind="recap"}
Verify the service, endpoint, response, revision, and logs. Deploy the next revision without traffic, test it, move a small share, observe, and then finish or reverse the release.
:::

:::expand[What Happens During a Complete Cloud Run Request?]{kind="recap"}
A request crosses managed TLS, ingress and authentication, traffic policy, a revision and instance, application dependencies, and telemetry. Each Cloud Run setting controls part of that path.
:::

## References

- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Official service, job, worker-pool, and managed-runtime overview.
- [Container runtime contract](https://docs.cloud.google.com/run/docs/container-contract?authuser=9) - Official port, interface, TLS, and filesystem requirements.
- [Deploy a web application from source](https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-service-other-languages) - Official source-build and deployment flow.
- [Manage Cloud Run services](https://docs.cloud.google.com/run/docs/managing/services?authuser=2&hl=en) - Official service and stable URL guidance.
- [Manage revisions](https://docs.cloud.google.com/run/docs/managing/revisions?authuser=19&hl=en) - Official revision immutability and lifecycle documentation.
- [Cloud Run resource model](https://docs.cloud.google.com/run/docs/resource-model?authuser=1&hl=en) - Official code and configuration versioning model.
- [Rollouts, rollbacks, and traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration?authuser=8&hl=en) - Official traffic-splitting and staged-release commands.
- [Maximum concurrent requests](https://docs.cloud.google.com/run/docs/about-concurrency?authuser=31&hl=en) - Official concurrency behavior and limits.
- [Instance autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling) - Official autoscaling signals and maximum-instance nuances.
- [Minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances?authuser=2) - Official warm-capacity configuration.
- [Maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances?authuser=2) - Official scaling and downstream-protection guidance.
- [Cloud Run authentication](https://docs.cloud.google.com/run/docs/authenticating/overview) - Official inbound authentication overview.
- [Service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity) - Official runtime and deployer identity responsibilities.
- [Configure secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets?authuser=2) - Official Secret Manager integration.
- [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging) - Official request, container, system, and structured logging behavior.
- [Invoke a service with HTTPS](https://docs.cloud.google.com/run/docs/triggering/https-request?authuser=1) - Official endpoint retrieval and invocation guidance.
