---
title: "Production Deployment"
description: "Deploy enterprise copilot systems with environment configuration, eval gates, canary releases, tracing, data controls, background work, and rollback paths."
overview: "Production deployment turns an LLM prototype into an operated service with releases, owners, budgets, safety checks, and rollback. You will follow an enterprise copilots platform from staging to canary to full rollout, with concrete Kubernetes, CI, tracing, and OpenAI API patterns."
tags: ["MLOps","LLMOps","advanced","deployment"]
order: 3
id: "article-mlops-llmops-production-deployment"
---

## What Production Deployment Means For LLM Apps

<!-- section-summary: Production deployment is the full operating path for an LLM feature: configuration, release gates, runtime health, observability, data controls, and rollback. For enterprise copilots, deployment quality matters because users rely on the system inside real business workflows. -->

Production deployment means your LLM application can ship changes safely, serve real users reliably, and recover when something goes wrong. For a normal web service, deployment already includes configuration, health checks, rollout strategy, dashboards, and rollback. For an LLM application, you add prompt versions, model choices, eval gates, tool permissions, retrieval indexes, tracing, safety controls, token budgets, and data-retention rules.

Imagine an enterprise platform called WorkPilot. It gives employees three copilots: an HR policy copilot, a finance analysis copilot, and an engineering incident copilot. Each copilot reads different internal documents, calls different tools, and has different risk. HR answers must avoid exposing private employee data. Finance answers must cite approved reports. Engineering incident answers can call service-status tools and draft remediation notes.

The prototype was easy. A small team put a prompt in a script, connected a document search tool, and showed a demo. Production is a different life. A new prompt can increase tool calls. A model change can change latency. A retrieval index update can remove citations. A permissive tool definition can expose data to the wrong department. A deployment can look successful at the Kubernetes level while the copilot quietly gives weaker answers.

That is why LLM deployment needs two layers of release thinking. The first layer is platform reliability: containers, secrets, probes, autoscaling, rollouts, queues, dashboards, and rollback. The second layer is LLM product reliability: evals, prompt policy versions, model routes, trace review, safety checks, tool permissions, data controls, and user feedback. The safest deployment plan joins those two layers into one release path.

OpenAI's current docs emphasize the Responses API for new direct model requests, tool use, stateful workflows, and agent features. The deployment checklist highlights practical controls such as reasoning effort, verbosity, prompt cache keys, background responses, and compaction. The Agents SDK includes tracing for model calls, tool calls, handoffs, guardrails, and custom spans. WorkPilot uses those patterns as building blocks while keeping infrastructure concerns in Kubernetes and CI/CD.

## The WorkPilot Deployment Shape

<!-- section-summary: WorkPilot separates the API gateway, copilot runtime, retrieval services, background workers, and observability pipeline. That separation lets each part scale, release, and fail in a controlled way. -->

WorkPilot has five services:

| Service | Job | Deployment concern |
|---|---|---|
| `copilot-api` | Receives browser requests and auth context | Low latency and strict auth |
| `copilot-runtime` | Calls models, tools, and retrieval | Prompt versioning and tracing |
| `retrieval-api` | Searches approved enterprise documents | Index freshness and permissions |
| `background-worker` | Runs long summaries, evals, and report jobs | Queue depth and cost control |
| `trace-collector` | Exports traces, metrics, and logs | Data filtering and retention |

The browser never calls the model provider directly. It calls WorkPilot's API. The API verifies the employee, maps the employee to departments and document permissions, creates a request ID, and forwards a typed request to the runtime. The runtime selects a copilot config, calls retrieval, calls the model through the Responses API or Agents SDK, records traces, and returns a response with citations and safety state.

The deployment artifact includes more than a Docker image. It includes:

- app image digest;
- prompt bundle version;
- model route config;
- tool permission manifest;
- retrieval index version;
- eval report ID;
- migration status;
- feature flag state;
- rollout plan;
- rollback target.

That release packet is what reviewers approve. If the image changed but the prompt bundle stayed the same, the release risk may be mostly infrastructure. If the prompt bundle, model route, and retrieval index all changed at once, the release should move slowly and require stronger eval evidence.

![WorkPilot deployment shape keeps employee traffic behind backend services and production controls.](/content-assets/articles/article-mlops-llmops-production-deployment/production-deployment-shape.png)

*WorkPilot keeps employee traffic behind the backend, where secrets, permissions, retrieval, workers, and tracing can be controlled.*

## Configuration And Secrets

<!-- section-summary: Production config should be explicit, versioned, and separate from code. Secrets come from secret stores, while route choices, prompt versions, and limits come from reviewable configuration. -->

LLM apps need clear environment configuration because small defaults can change cost and behavior. WorkPilot keeps secrets in Kubernetes Secrets or the enterprise secret manager. It keeps route and product config in ConfigMaps or a versioned config service. The container image should not contain API keys, production prompts, tenant allowlists, or model route secrets.

Here is a practical environment map:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: workpilot-runtime-config
data:
  APP_ENV: "production"
  PROMPT_BUNDLE_VERSION: "hr-finance-eng-2026-07-05"
  OPENAI_MODEL_FAST: "gpt-5.4-mini"
  OPENAI_MODEL_REASONING: "gpt-5.5"
  DEFAULT_REASONING_EFFORT: "low"
  HIGH_RISK_REASONING_EFFORT: "medium"
  DEFAULT_TEXT_VERBOSITY: "medium"
  LLM_REQUEST_TIMEOUT_MS: "12000"
  LLM_MAX_OUTPUT_TOKENS: "1600"
  ENABLE_BACKGROUND_RESPONSES: "true"
  TRACE_SAMPLE_RATE: "1.0"
  OTEL_SERVICE_NAME: "workpilot-runtime"
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector.observability:4318"
---
apiVersion: v1
kind: Secret
metadata:
  name: workpilot-openai-secret
type: Opaque
stringData:
  OPENAI_API_KEY: "replace-in-secret-manager"
```

The Kubernetes Deployment references those values:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workpilot-runtime
spec:
  replicas: 6
  selector:
    matchLabels:
      app: workpilot-runtime
  template:
    metadata:
      labels:
        app: workpilot-runtime
        promptBundle: "hr-finance-eng-2026-07-05"
    spec:
      containers:
        - name: runtime
          image: registry.example.com/workpilot/runtime@sha256:8f1a...
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: workpilot-runtime-config
            - secretRef:
                name: workpilot-openai-secret
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
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
```

Kubernetes readiness probes help keep traffic away from pods that are running but unable to serve requests. For WorkPilot, `/ready` checks that the runtime loaded the prompt bundle, can reach retrieval, can reach the queue, and has the current route config. `/healthz` checks process health. Those endpoints should avoid expensive model calls because probes run often.

The config should also include data-control choices. For example, a tenant that requires strict retention may use stateless Responses calls with stored state disabled where supported, tenant-scoped logging filters, and a short trace retention policy. OpenAI's data controls guide says API data is not used to train OpenAI models unless the customer opts in, and it describes abuse monitoring logs, application state, Zero Data Retention, and Modified Abuse Monitoring controls. Enterprise deployment should document which controls apply to each tenant and route.

## Runtime Calls And Background Work

<!-- section-summary: The runtime should keep live calls short and move long-running work to background paths. Responses API settings such as reasoning effort, verbosity, prompt cache keys, and background execution belong in configuration and traces. -->

WorkPilot has live calls and background calls. A live HR copilot answer should return quickly. A weekly finance-report summary can run in the background. An engineering incident timeline may stream partial progress while tools run. The runtime should choose the path from product need instead of sending every request through one synchronous flow.

Here is a TypeScript runtime function for a live copilot turn:

```typescript
import OpenAI from "openai";

const openai = new OpenAI();

type CopilotTurn = {
  userId: string;
  tenantId: string;
  copilot: "hr" | "finance" | "engineering";
  promptBundleVersion: string;
  question: string;
  retrievedContext: string[];
  risk: "low" | "medium" | "high";
};

export async function runLiveTurn(turn: CopilotTurn) {
  const model = turn.risk === "high"
    ? process.env.OPENAI_MODEL_REASONING
    : process.env.OPENAI_MODEL_FAST;

  const effort = turn.risk === "high"
    ? process.env.HIGH_RISK_REASONING_EFFORT
    : process.env.DEFAULT_REASONING_EFFORT;

  const response = await openai.responses.create({
    model,
    reasoning: { effort },
    text: { verbosity: process.env.DEFAULT_TEXT_VERBOSITY },
    prompt_cache_key: `tenant:${turn.tenantId}:bundle:${turn.promptBundleVersion}:copilot:${turn.copilot}`,
    input: [
      {
        role: "system",
        content: `Use WorkPilot ${turn.copilot} policy bundle ${turn.promptBundleVersion}. Cite retrieved sources.`,
      },
      {
        role: "user",
        content: [
          "Retrieved context:",
          ...turn.retrievedContext,
          "Employee question:",
          turn.question,
        ].join("\n\n"),
      },
    ],
  });

  return {
    text: response.output_text,
    responseId: response.id,
    usage: response.usage,
    model,
    effort,
  };
}
```

The model and effort come from config. The prompt cache key includes tenant, prompt bundle, and copilot. The response metadata returns usage and model choice so the runtime can log them with the trace.

For background work, WorkPilot uses a queue and a separate worker deployment. Some jobs call the Responses API with `background: true` when resumability helps. Other large offline workloads use Batch API or a lower-priority processing tier when a 24-hour completion window is acceptable. The key idea is simple: live user paths should not wait behind large report jobs.

```typescript
export async function enqueueFinanceReportJob(input: {
  tenantId: string;
  reportId: string;
  promptBundleVersion: string;
}) {
  return {
    queue: "finance-report-summaries",
    payload: input,
    maxAttempts: 2,
    timeoutMs: 30 * 60 * 1000,
    costCenter: "finance-copilot",
  };
}
```

The worker records job status in a database, emits progress events, and stores the final answer with source references. If the job fails due to rate limits, the worker backs off and retries. If the job fails due to a policy error or retrieval permission error, it stops and asks for human review.

## Eval Gates Before Release

<!-- section-summary: Eval gates catch weak prompt, model, tool, and retrieval changes before the release reaches users. A gate should compare the new bundle against a frozen baseline and block the rollout when required thresholds fail. -->

An eval gate is a CI/CD check that runs representative examples before deployment. WorkPilot has three eval suites: HR policy questions, finance report questions, and engineering incident questions. Each suite includes normal cases, adversarial prompts, missing-context cases, permission-boundary cases, long-context cases, and tool-use cases.

The release gate checks:

- answer correctness against human-reviewed rubrics;
- citation support from allowed sources;
- refusal or human-review behavior for sensitive questions;
- tool call arguments and side effects;
- p95 latency on staging;
- token usage and cost estimate;
- trace completeness;
- prompt-injection resistance;
- regression against the previous prompt bundle.

Here is a GitHub Actions-style gate:

```yaml
name: workpilot-release-gate

on:
  pull_request:
    paths:
      - "services/workpilot/**"
      - "prompts/workpilot/**"
      - "evals/workpilot/**"

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npm run build --workspace services/workpilot
      - run: npm run eval:workpilot -- --suite hr --suite finance --suite engineering --output eval-report.json
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY_STAGING }}
          WORKPILOT_ENV: "staging"
      - run: node scripts/check-workpilot-eval-thresholds.mjs eval-report.json
```

The threshold script can check a JSON report:

```typescript
import fs from "node:fs";

const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const required = {
  minCorrectness: 0.94,
  minCitationSupport: 0.97,
  maxUnsafePassThrough: 0,
  maxP95LatencyMs: 8000,
  maxCostIncreaseRatio: 1.15,
};

const failures = [];

if (report.correctness < required.minCorrectness) failures.push("correctness");
if (report.citationSupport < required.minCitationSupport) failures.push("citationSupport");
if (report.unsafePassThrough > required.maxUnsafePassThrough) failures.push("unsafePassThrough");
if (report.p95LatencyMs > required.maxP95LatencyMs) failures.push("p95LatencyMs");
if (report.costIncreaseRatio > required.maxCostIncreaseRatio) failures.push("costIncreaseRatio");

if (failures.length > 0) {
  console.error(JSON.stringify({ status: "failed", failures, report }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ status: "passed", report }, null, 2));
```

Eval gates should block releases for safety and correctness failures. Cost and latency gates may allow an explicit override with approval, yet the override should leave a visible audit trail. If the finance copilot gets better at answering analyst questions but costs 40% more, leadership can make that choice. Hidden cost changes are the problem.

## Canary Release And Progressive Rollout

<!-- section-summary: A canary release sends a small amount of production traffic to the new version before full rollout. LLM canaries should watch quality signals, tool behavior, cost, latency, and user feedback, not only pod health. -->

A canary release sends a small percentage of traffic to the new version, waits, measures, then either increases traffic or rolls back. Argo Rollouts supports canary steps such as `setWeight` and `pause`, plus analysis hooks. Kubernetes Deployments also support rolling updates and rollout undo, which are useful for simpler services.

WorkPilot releases the runtime in stages:

1. Deploy to staging with production-like data permissions and synthetic documents.
2. Run eval gates and trace checks.
3. Start a 1% internal canary for employees in the AI platform group.
4. Move to 5% of one tenant with friendly users.
5. Move to 25% for low-risk HR and engineering routes.
6. Move to 100% only after cost, latency, safety, and feedback checks pass.

An Argo Rollouts shape might look like this:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: workpilot-runtime
spec:
  replicas: 8
  selector:
    matchLabels:
      app: workpilot-runtime
  template:
    metadata:
      labels:
        app: workpilot-runtime
    spec:
      containers:
        - name: runtime
          image: registry.example.com/workpilot/runtime@sha256:8f1a...
          envFrom:
            - configMapRef:
                name: workpilot-runtime-config
            - secretRef:
                name: workpilot-openai-secret
  strategy:
    canary:
      steps:
        - setWeight: 1
        - pause:
            duration: 30m
        - setWeight: 5
        - pause:
            duration: 1h
        - setWeight: 25
        - pause:
            duration: 2h
        - setWeight: 100
```

The canary should measure LLM-specific signals:

- refusal or human-review rate;
- citation coverage;
- tool error rate;
- retrieval empty-result rate;
- model timeout rate;
- p95 latency;
- input, output, and cached token counts;
- cost per conversation;
- user thumbs-down rate;
- support tickets about poor answers.

If the new version increases latency but improves answer quality for engineering incident workflows, the team may continue the canary for that copilot while pausing HR and finance. This is why WorkPilot routes by copilot and risk. A release can move in smaller pieces.

![WorkPilot release path passes a release packet through eval gates before staged canary rollout.](/content-assets/articles/article-mlops-llmops-production-deployment/production-release-path.png)

*A WorkPilot release packet passes eval gates before canary traffic expands across tenants and risk levels.*

## Tracing, Metrics, And Audit Evidence

<!-- section-summary: LLM deployment needs traces that connect user requests, retrieval, model calls, tool calls, and fallbacks. Metrics show service health, while audit records show what changed and who approved it. -->

OpenTelemetry can instrument services with traces, metrics, and logs. A trace is a timeline of spans for one request. In WorkPilot, a single trace includes auth, permission resolution, retrieval, model call, tool calls, guardrail checks, response formatting, and user feedback event. The Agents SDK also provides built-in tracing for agent runs when you use its orchestration.

WorkPilot records these attributes:

| Attribute | Example |
|---|---|
| `copilot.name` | `hr` |
| `tenant.id` | hashed tenant identifier |
| `prompt.bundle_version` | `hr-finance-eng-2026-07-05` |
| `model.route` | `fast` or `reasoning` |
| `model.name` | `gpt-5.4-mini` |
| `reasoning.effort` | `low` |
| `retrieval.index_version` | `legal-docs-2026-07-05.2` |
| `tool.names` | `policy_search`, `incident_status` |
| `usage.cached_tokens` | `1840` |
| `fallback.reason` | `rate_limit` |

The trace should avoid raw sensitive content unless the tenant and retention policy allow it. Many enterprise teams store request IDs, hashes, source IDs, and short redacted snippets in traces, while the full prompt payload stays in a secure tenant data store with restricted access. That setup supports debugging while respecting data controls.

Prometheus metrics track aggregate health:

```yaml
groups:
  - name: workpilot-runtime
    rules:
      - alert: WorkPilotCanaryQualityDrop
        expr: |
          avg_over_time(workpilot_eval_live_score{release_track="canary"}[30m])
          <
          avg_over_time(workpilot_eval_live_score{release_track="stable"}[30m]) - 0.04
        for: 20m
        labels:
          severity: page
          team: ai-platform
        annotations:
          summary: WorkPilot canary quality score dropped below stable baseline
          runbook: Pause rollout, inspect traces, compare prompt bundle and retrieval index versions.
```

Grafana exemplars can connect a latency spike in a histogram to a specific trace. During a canary, that helps the on-call engineer move from "p95 latency rose" to "finance copilot started retrieving 80 documents for one route." The fix may be a retrieval cap, prompt change, or rollback.

## Rollback And Incident Response

<!-- section-summary: Rollback needs a prepared target and a clear decision rule. LLM incidents can require rolling back code, prompt bundles, retrieval indexes, model routes, or feature flags. -->

A rollback returns users to a known healthier state. For WorkPilot, rollback can happen at several layers:

| Layer | Rollback action |
|---|---|
| Code image | Use Kubernetes or Argo rollback to the prior ReplicaSet |
| Prompt bundle | Flip `PROMPT_BUNDLE_VERSION` back to the previous approved bundle |
| Model route | Move high-risk traffic back to the prior model |
| Retrieval index | Repoint to the previous index snapshot |
| Tool manifest | Disable or revert the risky tool |
| Feature flag | Turn off the new copilot behavior for affected tenants |

Kubernetes supports rollout undo for Deployments, and Argo Rollouts can abort or roll back a progressive rollout. WorkPilot also keeps prompt bundles and route configs versioned so an incident responder can revert without building a new image.

A practical rollback command set looks like this:

```bash
kubectl -n copilots rollout status deployment/workpilot-runtime
kubectl -n copilots rollout undo deployment/workpilot-runtime --to-revision=18
kubectl -n copilots rollout status deployment/workpilot-runtime
kubectl -n copilots get pods -l app=workpilot-runtime
```

Prompt and route rollback may use config:

```bash
kubectl -n copilots create configmap workpilot-runtime-config \
  --from-literal=PROMPT_BUNDLE_VERSION=hr-finance-eng-2026-06-28 \
  --from-literal=OPENAI_MODEL_FAST=gpt-5.4-mini \
  --from-literal=OPENAI_MODEL_REASONING=gpt-5.5 \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n copilots rollout restart deployment/workpilot-runtime
```

The incident runbook should define decision rules. For example, roll back immediately if unsafe pass-through is above zero, if citation support drops below the release threshold, if p95 latency doubles for high-risk routes, or if tenant data isolation checks fail. Pause the rollout for lower-severity issues such as small cost increases or non-critical formatting regressions.

After rollback, the team should preserve the eval report, canary dashboard, trace IDs, prompt bundle diff, route config diff, and user feedback samples. That evidence helps the post-incident review identify whether the cause was model behavior, prompt wording, retrieval changes, a tool bug, missing eval coverage, or traffic shape.

## Practical Checks Before Shipping

<!-- section-summary: Production readiness is a checklist across infrastructure, model behavior, data controls, rollout, and rollback. The strongest teams test the release path and the failure path before users depend on the system. -->

Use this checklist for an enterprise copilot deployment:

- The browser calls your backend, never the model provider directly.
- API keys live in a secret manager or Kubernetes Secret.
- Prompt bundle, model routes, tool manifests, and retrieval index versions are reviewable release artifacts.
- Runtime config includes model, reasoning effort, verbosity, timeouts, output caps, prompt cache keys, and trace settings.
- Readiness probes verify config, retrieval, queue, and dependency readiness without expensive model calls.
- Eval gates cover correctness, citation support, sensitive data handling, tool behavior, latency, and cost.
- Canary rollout watches LLM quality signals as well as CPU, memory, and pod health.
- Traces connect auth, retrieval, model calls, tool calls, guardrails, fallbacks, and feedback.
- Observability filters respect tenant data controls and retention policy.
- Background jobs have separate queues, budgets, and retry rules.
- Rollback can revert code, prompt bundle, model route, retrieval index, tool manifest, and feature flags.
- The on-call runbook names owners, thresholds, commands, dashboards, and escalation contacts.

Common mistakes include shipping prompt changes as invisible config edits, evaluating only happy-path questions, canarying by pod health alone, logging sensitive prompts into shared traces, and treating rollback as a code-only action. Another mistake is mixing live user work and offline document jobs in one queue. Large background jobs should never starve an employee who is waiting for a live copilot response.

Interview-ready understanding sounds like this: LLM production deployment is a coordinated release of code, prompts, model routes, retrieval indexes, tools, safety controls, and observability. You ship through eval gates, canary traffic, trace review, data-control checks, and rollback-ready artifacts. A strong deployment plan proves that the system can answer well, fail visibly, protect sensitive data, control cost, and return to a known good state quickly.

![WorkPilot readiness loop connects config, eval gate, canary, tracing, and rollback.](/content-assets/articles/article-mlops-llmops-production-deployment/production-readiness-loop.png)

*The readiness loop connects config, eval gates, canary signals, tracing, and rollback into one operated release path.*

## References

- [OpenAI production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
- [OpenAI API deployment checklist](https://developers.openai.com/api/docs/guides/deployment-checklist)
- [OpenAI Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
- [OpenAI Agents SDK integrations and observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability)
- [OpenAI Batch API](https://developers.openai.com/api/docs/guides/batch)
- [OpenTelemetry documentation](https://opentelemetry.io/docs/)
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Grafana exemplars](https://grafana.com/docs/grafana/latest/fundamentals/exemplars/)
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes liveness, readiness, and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Argo Rollouts canary strategy](https://argo-rollouts.readthedocs.io/en/stable/features/canary/)
