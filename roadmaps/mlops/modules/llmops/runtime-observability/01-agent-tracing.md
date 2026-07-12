---
title: "Agent Tracing"
description: "Trace agent runs across model calls, tool calls, retrieval, guardrails, retries, costs, latency, cache use, and final outcomes."
overview: "Learn how production teams trace an agent run from the user's request through model spans, tool spans, metadata, redaction, dashboards, and incident review."
tags: ["MLOps","LLMOps","production","observability"]
order: 1
id: "article-mlops-llmops-agent-tracing"
---

## What Agent Tracing Means

<!-- section-summary: Agent tracing records one complete agent run as a timeline of connected steps, so you can see which model, tool, prompt, guardrail, and retry shaped the final answer. -->

Agent tracing is the practice of recording the path of an agent run from the first user request to the final response. A **trace** is the whole run. A **span** is one timed step inside that run, such as classifying the request, calling a model, searching documents, invoking a claims API, checking a guardrail, or handing the case to a human queue. A **span event** is a small record attached to a span, such as a retry, a cache hit, a validation warning, or a tool response summary.

In a normal web service, tracing tells you which service called which database and where the latency went. In an LLM agent, tracing has to explain more than latency. You also need to know which prompt version ran, which model answered, which tools the model requested, what arguments went into those tools, which documents were retrieved, how many tokens were used, whether a guardrail fired, which retries happened, and why the final answer passed or failed review.

We will use a claims assistant as the running example. Imagine an insurance company called Harbor Shield. Customers upload documents after a car accident, then ask questions like, "Can I schedule a repair before the adjuster finishes the estimate?" The assistant has access to a policy search tool, a claim status API, a repair-network API, and a human escalation queue. A bad answer can create real customer harm, so the team needs a way to inspect each run in detail without leaking private claim details into every dashboard.

Good tracing gives that team a production record. A support lead can open one trace and see the exact run. An engineer can compare slow runs against normal runs. A privacy reviewer can verify that raw license numbers and medical notes were redacted before export. An evaluator can turn a failed run into a replay case. That is the practical value of agent tracing: it changes a vague "the assistant gave a weird answer" report into a specific chain of evidence.

## The Trace Hierarchy

<!-- section-summary: A useful trace has a parent run span, child spans for each agent step, and small events or logs for details that explain decisions without flooding the trace backend. -->

The easiest way to read an agent trace is from top to bottom. The parent span describes the user-facing task. Child spans describe work that happened under that task. A model span records the model request and response metadata. A tool span records the tool name, arguments, response shape, and status. A guardrail span records a safety or policy check. A handoff span records a transfer to another agent or a human workflow.

For the claims assistant, a healthy run might have this shape:

| Level | Span name | What it answers |
| --- | --- | --- |
| Trace | `claims_assistant.run` | Which customer task happened, for which environment and app version? |
| Child span | `intent.classify` | Did the system route the question as policy, claim status, repair scheduling, or escalation? |
| Child span | `retrieve.policy_sections` | Which policy documents were searched and which snippets came back? |
| Child span | `gen_ai.chat gpt-5.5` | Which model answered, with which prompt version and token usage? |
| Child span | `tool.claim_status.lookup` | Which claim API call ran and what status code came back? |
| Child span | `guardrail.pii_and_coverage_check` | Did the answer expose sensitive data or overstate coverage? |
| Child span | `response.finalize` | Which final answer reached the customer and which review labels were attached? |

This hierarchy matters because agent runs mix deterministic code with model behavior. The claim status API may return exactly the same JSON every time. The model response can vary across prompt versions, model versions, retrieved context, and tool output order. A trace keeps these pieces connected, so you can inspect one part without losing the surrounding context.

OpenTelemetry uses traces and spans as the general language for distributed systems. OpenTelemetry also has Generative AI semantic conventions under the `gen_ai.*` namespace for model requests, token usage, tool calls, and agent spans. Those GenAI conventions are still marked with development status in the current repository, so many teams keep an internal mapping layer. The important habit is stable naming: pick span names and attributes that remain readable after you change tracing vendors.

![Harbor Shield claims assistant trace](/content-assets/articles/article-mlops-llmops-agent-tracing/harbor-shield-trace-hierarchy.png)
*Harbor Shield treats one customer answer as a trace tree: each model call, retrieval step, tool call, guardrail, and final response keeps its own timed span.*

## What To Capture On Every Run

<!-- section-summary: The trace should capture identity, version, timing, tool behavior, token usage, quality labels, and privacy-safe context so engineers can debug and monitor the run later. -->

The trace should answer four questions for every production run: **what was attempted, which system version handled it, what happened step by step, and what evidence supports the outcome**. If you capture only raw prompts and completions, the trace may help during development, yet it will be weak during an incident. If you capture only metrics, you can see that failure rate increased, yet you cannot explain one bad run.

Here is a practical event shape for the claims assistant. The values are synthetic, and the sensitive fields are either hashed, summarized, or replaced with stable internal identifiers:

```json
{
  "trace_id": "trc_9f3e6d1a2c7b",
  "span_id": "spn_4a91",
  "parent_span_id": "spn_root",
  "name": "tool.claim_status.lookup",
  "kind": "client",
  "start_time": "2026-07-05T10:18:42.117Z",
  "end_time": "2026-07-05T10:18:42.381Z",
  "status": "ok",
  "attributes": {
    "service.name": "claims-assistant-api",
    "deployment.environment.name": "prod",
    "app.workflow": "auto_claim_question",
    "app.prompt.name": "claims_answer_v4",
    "app.prompt.version": "2026-07-03.2",
    "app.agent.name": "harbor-claims-assistant",
    "app.claim.type": "auto_collision",
    "app.claim.region": "CA",
    "app.user.hash": "usr_72ad8d",
    "tool.name": "claim_status_lookup",
    "tool.schema.version": "1.7.0",
    "tool.request.redacted": true,
    "tool.response.status_code": 200,
    "tool.response.summary": "claim open, estimate pending, rental coverage present",
    "failure.class": "none"
  },
  "events": [
    {
      "name": "cache.lookup",
      "time": "2026-07-05T10:18:42.121Z",
      "attributes": {
        "cache.key.hash": "cache_6b8d",
        "cache.hit": false
      }
    }
  ]
}
```

Notice the split between fields used for filtering and fields used for debugging. The `app.prompt.version`, `app.agent.name`, `deployment.environment.name`, `tool.name`, `failure.class`, and region are safe dashboard dimensions if cardinality stays controlled. The detailed user question, raw policy text, claim notes, and tool response body need stronger controls. Many teams store raw payloads only in a restricted trace backend, or they store a short summary plus a link to an internal case system with audit access.

For model spans, capture the model request and response metadata without assuming every provider uses the same names. OpenTelemetry GenAI conventions include fields such as `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, cache token fields, tool definitions, and input or output messages as opt-in data. In production, opt-in message capture deserves an explicit privacy decision because messages can carry customer data.

![Harbor Shield trace capture boundary](/content-assets/articles/article-mlops-llmops-agent-tracing/harbor-shield-trace-boundary.png)
*The trace export boundary keeps dashboard fields small and safe while raw claim details stay behind tighter access and audit controls.*

## Instrumenting A Claims Assistant

<!-- section-summary: Start with framework tracing where it exists, then add manual spans around the business steps that the framework cannot understand by itself. -->

Modern agent frameworks often give you a good first trace. The OpenAI Agents SDK includes built-in tracing for model generations, tool calls, handoffs, guardrails, and custom events, and the current tracing docs say tracing is enabled by default unless you disable it through configuration. That gets you the agent skeleton quickly. You still add your own spans for product-specific work, such as reading claim state, applying policy rules, redacting data, or writing an escalation record.

Here is a small Python example that shows both pieces. The agent framework records the model and tool flow. OpenTelemetry records the product spans and attributes that Harbor Shield needs for dashboards and incident review.

```python
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

trace.set_tracer_provider(
    TracerProvider(
        resource=Resource.create(
            {
                "service.name": "claims-assistant-api",
                "deployment.environment.name": "prod",
                "service.version": "2026.07.05",
            }
        )
    )
)
trace.get_tracer_provider().add_span_processor(
    BatchSpanProcessor(ConsoleSpanExporter())
)

tracer = trace.get_tracer("harbor.claims_assistant")


async def answer_claim_question(agent_runner, user_question, claim_context):
    with tracer.start_as_current_span("claims_assistant.run") as run_span:
        run_span.set_attribute("app.workflow", "auto_claim_question")
        run_span.set_attribute("app.agent.name", "harbor-claims-assistant")
        run_span.set_attribute("app.prompt.name", "claims_answer")
        run_span.set_attribute("app.prompt.version", "2026-07-03.2")
        run_span.set_attribute("app.claim.type", claim_context["claim_type"])
        run_span.set_attribute("app.user.hash", claim_context["user_hash"])

        with tracer.start_as_current_span("context.prepare") as context_span:
            prepared_context = redact_claim_context(claim_context)
            context_span.set_attribute("privacy.redaction.applied", True)
            context_span.set_attribute("context.documents.count", len(prepared_context["documents"]))

        result = await agent_runner.run(
            input=user_question,
            context=prepared_context,
        )

        run_span.set_attribute("gen_ai.usage.input_tokens", result.usage.input_tokens)
        run_span.set_attribute("gen_ai.usage.output_tokens", result.usage.output_tokens)
        run_span.set_attribute("app.answer.outcome", result.outcome)
        return result.final_output
```

This example uses the OpenTelemetry Python SDK pattern of setting a tracer provider, attaching a span processor, then creating spans with `start_as_current_span`. In a real service, you would usually export with OTLP to a collector or observability backend instead of printing to console. The code also avoids placing raw claim notes into span attributes. Span attributes work well for small filterable values. Large text belongs in a carefully governed payload store, or in a redacted trace field with retention and access rules.

The custom spans should use names your support and engineering teams understand. `context.prepare` is better than `helper_1`. `tool.claim_status.lookup` is better than `api_call`. In a high-volume system, clear span names help you group latency, error rate, and cost without opening a single trace.

## Tool Calls, Prompt Versions, And Failure Classes

<!-- section-summary: The most useful agent traces treat tools, prompts, and failures as first-class production metadata instead of loose text hidden inside the model transcript. -->

Tool-call logs deserve special care because tools are where an agent touches real systems. A tool span should record the tool name, schema version, sanitized arguments, external dependency, status code, latency, retry count, and response summary. If a tool can make changes, such as booking a repair appointment, capture the idempotency key and approval state. If a tool reads sensitive data, capture the data category and redaction status.

For the claims assistant, the tool metadata might look like this:

```json
{
  "name": "tool.repair_network.find_shop",
  "attributes": {
    "tool.name": "repair_network_find_shop",
    "tool.schema.version": "2.3.1",
    "tool.side_effect": "read_only",
    "tool.retry.count": 1,
    "tool.timeout_ms": 1200,
    "tool.response.status_code": 200,
    "tool.response.items.count": 5,
    "app.claim.region": "CA",
    "failure.class": "none"
  }
}
```

Prompt metadata is just as important. A trace should record the prompt name and version, the agent config version, the retrieval index version, the tool schema version, and the deploy version. If the assistant starts recommending out-of-network repair shops after a release, the team needs to separate prompt changes from retrieval changes and tool changes. A trace that only says "the model answered" gives you almost no release evidence.

Failure classes turn messy production behavior into countable data. The exact taxonomy depends on your app, but a beginner-friendly first version can use these labels:

| Failure class | Meaning in the claims assistant |
| --- | --- |
| `none` | The run completed and passed policy checks. |
| `tool_timeout` | A dependency timed out or returned too slowly. |
| `tool_contract_error` | A tool response missed a required field or used an unexpected shape. |
| `retrieval_empty` | The policy search returned no useful documents. |
| `grounding_mismatch` | The answer made a coverage statement unsupported by retrieved policy text. |
| `guardrail_blocked` | A privacy, safety, or policy guardrail stopped the response. |
| `human_escalated` | The system routed the case to a human because confidence or permissions were low. |

Do this classification in code close to the failing step. A generic `error=true` field forces every later dashboard and incident review to repeat the classification work. A low-cardinality field like `failure.class` supports alerts, trend charts, and sampling rules.

## Redaction And Data Boundaries

<!-- section-summary: Agent traces can contain highly sensitive prompts, tool arguments, and retrieved documents, so production tracing needs data minimization before export. -->

Claims data can include names, addresses, license plate numbers, medical notes, phone numbers, payment details, and free-form adjuster comments. Agent tracing has to protect that data because traces often travel to observability systems used by many engineers. The safe habit is **data minimization**: capture enough evidence to debug and measure the system, and keep raw sensitive payloads behind tighter access.

You can apply redaction in the application before data leaves the service:

```python
import re

CLAIM_NUMBER = re.compile(r"\bCLM-[0-9]{8}\b")
PHONE = re.compile(r"\b\+?1?[-. ]?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b")


def redact_text(value: str) -> str:
    value = CLAIM_NUMBER.sub("[claim-number]", value)
    value = PHONE.sub("[phone]", value)
    return value


def trace_safe_tool_args(args: dict) -> dict:
    return {
        "claim_type": args.get("claim_type"),
        "region": args.get("region"),
        "customer_tier": args.get("customer_tier"),
        "free_text_summary": redact_text(args.get("free_text_summary", ""))[:500],
    }
```

You can also use an OpenTelemetry Collector layer to remove or transform attributes before export. The OpenTelemetry sensitive-data guidance lists processors for attribute modification, filtering, redaction, and transform-based changes. A collector rule gives platform teams one more control point, especially when several services emit traces.

```yaml
processors:
  attributes/privacy:
    actions:
      - key: user.email
        action: hash
      - key: user.full_name
        action: delete
      - key: claim.raw_notes
        action: delete
  transform/privacy:
    trace_statements:
      - context: span
        statements:
          - set(attributes["app.user.hash"], SHA256(attributes["app.user.id"]))
          - delete_key(attributes, "app.user.id")

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [attributes/privacy, transform/privacy, batch]
      exporters: [otlp]
```

Redaction needs tests. Add fixture prompts with fake phone numbers, claim numbers, account IDs, and medical words. Send them through the trace exporter in a staging environment, then assert the exported span payload contains the replacements you expect. Privacy controls that only live in a checklist drift over time because new tools, fields, and prompts appear during normal product work.

## From Traces To Dashboards

<!-- section-summary: Traces explain individual runs, while metrics and dashboard queries show patterns across many runs by prompt version, model, tool, failure class, and customer segment. -->

A trace backend helps you inspect one run. A dashboard helps you notice that a class of runs changed. The two should share labels. If traces use `app.prompt.version`, metrics should use the same label. If traces use `failure.class`, logs and metrics should use that label too. This is how a dashboard click can lead straight to a filtered trace search.

Many teams send metrics to Prometheus and build dashboards in Grafana. Prometheus supports `histogram_quantile()` for estimating latency percentiles from histogram data, and Grafana's Prometheus query editor lets teams write PromQL in dashboard panels. For the claims assistant, a first dashboard can include run volume, p95 run latency, tool latency by tool name, model token usage, cache hit rate, guardrail block rate, and failure classes by prompt version.

Example PromQL panels:

```promql
sum by (app_prompt_version) (
  rate(agent_runs_total{workflow="auto_claim_question"}[5m])
)
```

```promql
histogram_quantile(
  0.95,
  sum by (le, tool_name) (
    rate(agent_tool_latency_seconds_bucket{workflow="auto_claim_question"}[10m])
  )
)
```

```promql
sum by (failure_class, app_prompt_version) (
  rate(agent_run_failures_total{workflow="auto_claim_question"}[15m])
)
```

Traces also feed evaluation work. When a run has `grounding_mismatch`, store the trace ID, prompt version, retrieved document IDs, final answer, and reviewer label in an eval dataset. The next prompt or retrieval change can replay that dataset before release. That loop is where tracing moves from passive observability into product improvement.

![Harbor Shield traces feed dashboards and evals](/content-assets/articles/article-mlops-llmops-agent-tracing/harbor-shield-trace-dashboard-evals.png)
*The same trace IDs that explain incidents also seed replay evals, so the next release can test failures that happened in production.*

## Practical Checks And Interview-Ready Understanding

Agent tracing gives you the evidence trail for one agent run. A strong answer in an interview should mention the trace/span hierarchy, model spans, tool spans, prompt and deploy metadata, token and cost attribution, latency, cache hits, failure classification, redaction, and the connection between traces, dashboards, and eval datasets.

Use these checks before you call a production agent observable:

- Every run has one trace ID that can travel through the API, worker, tool layer, and final response log.
- Every model call records provider, requested model, response model when available, prompt name, prompt version, input tokens, output tokens, cache token fields when available, latency, and finish reason.
- Every tool call records tool name, schema version, sanitized arguments, response summary, status, retry count, latency, timeout, and side-effect class.
- Every run ends with a low-cardinality outcome and failure class such as `none`, `tool_timeout`, `retrieval_empty`, `grounding_mismatch`, or `human_escalated`.
- Sensitive payloads receive application-level redaction before export, and collector-level rules remove risky attributes again.
- Dashboards group by the same names used in traces, especially prompt version, model, workflow, tool name, environment, and failure class.
- Incident reviews save trace IDs and turn repeated failures into replay or eval cases.

Common mistakes are easy to spot. Teams log full prompts with personal data because it helps one developer debug faster. They use high-cardinality labels such as raw user ID in metrics and then overload the monitoring system. They forget prompt versions, which makes release comparison guesswork. They trace model calls while skipping tool calls, even though tools often explain the real failure. They collect huge traces with no failure taxonomy, then struggle to build useful dashboards.

If you remember one thing, make it this: a production agent trace should tell the story of the run in a privacy-safe, queryable form. The trace should show the business task, the model and prompt versions, the tool decisions, the timing, the token and cost shape, the guardrail decisions, and the final outcome. That is enough for debugging, incident triage, cost review, and the next evaluation pass.

## References

- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK overview](https://developers.openai.com/api/docs/guides/agents)
- [OpenTelemetry traces concepts](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
- [OpenTelemetry GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- [OpenTelemetry GenAI agent and framework spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- [OpenTelemetry Python manual instrumentation](https://opentelemetry.io/docs/languages/python/instrumentation/)
- [OpenTelemetry handling sensitive data](https://opentelemetry.io/docs/security/handling-sensitive-data/)
- [Prometheus histogram practices](https://prometheus.io/docs/practices/histograms/)
- [Grafana Prometheus query editor](https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/)
- [Langfuse observability overview](https://langfuse.com/docs/observability/overview)
- [Phoenix tracing overview](https://arize.com/docs/phoenix/tracing/llm-traces)
