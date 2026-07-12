---
title: "Quality and Cost"
description: "Monitor support-copilot quality, task completion, latency, token usage, tool cost, cache behavior, user friction, and incident patterns together."
overview: "Learn how production teams measure a customer-support copilot by connecting answer quality, trace evidence, token cost, latency, cache hits, and support outcomes."
tags: ["MLOps","LLMOps","production","observability"]
order: 3
id: "article-mlops-llmops-quality-and-cost"
---

## What Quality And Cost Mean Together

<!-- section-summary: Quality and cost belong on the same dashboard because a cheaper copilot that frustrates users and an accurate copilot that spends without control both create production risk. -->

Quality and cost monitoring for an LLM application means measuring whether the system helps users complete real tasks at an acceptable price, speed, and risk level. **Quality** includes correctness, usefulness, policy compliance, grounded answers, task completion, user satisfaction, escalation quality, and safety behavior. **Cost** includes model tokens, tool calls, retrieval work, retries, cache misses, long conversations, human review, and incident response time.

This article uses a customer-support copilot as the running example. A company called BrightCart sells inventory software to small retailers. The support team uses a copilot inside the helpdesk. The copilot drafts answers, looks up account settings, searches product documentation, checks outage status, and suggests whether to escalate. Support agents can send the draft, edit it, or ignore it.

At first, the team celebrates because the copilot answers many tickets. Then the finance dashboard shows a large model bill on Monday mornings. Support quality reviews also find a pattern: the copilot gives long answers for simple password-reset tickets and sometimes misses a known workaround for barcode scanner sync issues. The right response is not just "use a cheaper model" or "write a better prompt." The team needs a monitoring system that connects each dollar spent to a support outcome.

That is the core lesson. A production LLM system should report quality and cost together. You want to know the cost per resolved ticket, the cost per useful draft, the cost per escalation avoided, the latency per workflow, the cache hit rate for repeated context, and the failure classes that waste tokens. Once those are visible, you can make targeted changes: route simple tickets to a smaller model, shorten verbose prompts, cache stable knowledge, fix retrieval gaps, or escalate risky cases earlier.

## Build A Quality Scorecard Before A Cost Dashboard

<!-- section-summary: The scorecard defines the outcomes that matter, so cost charts can show spend per useful result instead of spend per raw request. -->

Start with a quality scorecard. A scorecard is a small set of labels and metrics that describe a useful support outcome. If you start with cost alone, the cheapest change is usually to call the model less. That may harm users. If you start with quality alone, teams can spend heavily on every request. The scorecard gives cost numbers a business meaning.

For BrightCart, a first scorecard might look like this:

| Signal | What it measures | How it is collected |
| --- | --- | --- |
| `draft_used` | Support agent sent the draft with small or no edits | Helpdesk event |
| `resolution_confirmed` | Ticket closed without reopening within 7 days | Helpdesk status |
| `citation_coverage` | Draft linked to the docs or account facts that support it | Trace and evaluator |
| `policy_safe` | Draft avoided refunds, privacy, and legal claims outside support policy | Guardrail and reviewer |
| `escalation_correct` | High-risk ticket routed to the right queue | Support workflow label |
| `customer_friction` | User replied with confusion, anger, or repeat request | Conversation analytics |
| `agent_edit_distance` | Human agent changed the draft heavily or lightly | Helpdesk diff event |

These signals mix automation and human review. That is normal. You can collect `draft_used` automatically. You may need reviewer labels for `policy_safe` until your evals mature. You can estimate customer friction from follow-up replies, sentiment, or a simple "customer asked again" label. The goal is a stable set of signals that support, product, and engineering all understand.

Now define a small outcome taxonomy:

```yaml
support_copilot_outcomes:
  resolved_with_draft: "Agent sent the draft and the ticket closed without reopening."
  useful_with_edits: "Agent used the draft after meaningful edits."
  ignored_draft: "Agent ignored the draft and wrote a new answer."
  escalated_correctly: "Copilot recommended a valid escalation."
  unsafe_or_wrong: "Draft failed policy, grounding, or correctness review."
  abandoned_or_timeout: "Run ended too slowly or failed before a useful draft."
```

This taxonomy will appear in traces, dashboards, warehouse tables, and incident reports. Keep it small. If every team invents new names, the dashboards will fragment.

![BrightCart quality and cost scorecard](/content-assets/articles/article-mlops-llmops-quality-and-cost/brightcart-quality-cost-scorecard.png)
*BrightCart puts quality outcomes beside cost signals so spend is measured against useful support work rather than raw request volume.*

## Attribute Cost To The Run, The Step, And The Outcome

<!-- section-summary: Cost attribution should split spend by model call, tool call, retry, workflow, prompt version, customer segment, and final outcome. -->

A support-copilot request can spend money in several places. The model call uses input and output tokens. Retrieval may call an embedding model or a vector database. Tool calls may hit paid services or slow internal APIs. Retries can multiply the cost silently. Human review time also has cost, even if it sits outside the model provider invoice.

The trace should carry the raw ingredients. A warehouse or metrics job can turn those ingredients into cost. Here is an example span summary for one draft:

```json
{
  "trace_id": "trc_support_93ac",
  "name": "support_copilot.run",
  "attributes": {
    "app.workflow": "ticket_draft",
    "ticket.category": "barcode_scanner_sync",
    "ticket.priority": "normal",
    "app.prompt.version": "support_draft_2026-07-01.4",
    "app.model.route": "complex_technical_issue",
    "gen_ai.provider.name": "openai",
    "gen_ai.request.model": "gpt-5.5",
    "gen_ai.usage.input_tokens": 4820,
    "gen_ai.usage.output_tokens": 612,
    "gen_ai.usage.cache_read.input_tokens": 3100,
    "retrieval.documents.count": 6,
    "tool.calls.count": 2,
    "tool.retry.count": 1,
    "app.outcome": "useful_with_edits",
    "quality.citation_coverage": 0.83,
    "quality.policy_safe": true,
    "cost.estimated_usd": 0.0284
  }
}
```

A few fields deserve attention. `gen_ai.usage.cache_read.input_tokens` lets the team see prompt or context cache savings when the provider reports them. `tool.retry.count` explains waste from flaky dependencies. `app.model.route` tells whether the router picked the expensive model for a reason. `app.outcome` connects spend to business value.

![BrightCart cost attribution by run step](/content-assets/articles/article-mlops-llmops-quality-and-cost/brightcart-cost-attribution.png)
*Cost attribution follows the run step by step, so token spend, cache savings, retries, tool calls, and human edits all connect to one outcome.*

Cost estimates should use a versioned price table rather than hardcoded numbers scattered through services. Model prices change, vendors add cache discounts, and teams add providers. Keep pricing logic in one job or library:

```yaml
pricing_catalog:
  version: "2026-07-05"
  currency: "USD"
  models:
    gpt-5.5:
      input_per_million_tokens: 0.00
      cached_input_per_million_tokens: 0.00
      output_per_million_tokens: 0.00
    support-small-router:
      input_per_million_tokens: 0.00
      cached_input_per_million_tokens: 0.00
      output_per_million_tokens: 0.00
  tools:
    account_lookup:
      per_call: 0.0000
    doc_search:
      per_query: 0.0000
```

The zeros are placeholders for your internal current price table. The pattern matters more than the example values: record the price catalog version used for attribution. During a finance review, you should be able to recalculate July spend using the July catalog, even after prices change later.

## Instrument Metrics In The Application

<!-- section-summary: Metrics give the fast production view, while traces and warehouse rows explain individual runs and support slower analysis. -->

You can collect many useful signals directly from the support-copilot service. The example below uses the Prometheus Python client shape because many teams already understand counters and histograms. If your platform standardizes on OpenTelemetry metrics and exports to Prometheus, keep the same metric names and labels.

```python
from prometheus_client import Counter, Histogram

RUNS = Counter(
    "support_copilot_runs_total",
    "Support copilot runs by workflow, prompt, model route, and outcome.",
    ["workflow", "prompt_version", "model_route", "outcome"],
)

TOKENS = Counter(
    "support_copilot_tokens_total",
    "Tokens used by support copilot runs.",
    ["workflow", "model", "token_type", "cache_state"],
)

COST = Counter(
    "support_copilot_estimated_cost_usd_total",
    "Estimated support copilot cost in USD.",
    ["workflow", "prompt_version", "model_route", "outcome"],
)

LATENCY = Histogram(
    "support_copilot_run_duration_seconds",
    "End-to-end support copilot latency.",
    ["workflow", "prompt_version", "model_route", "outcome"],
    buckets=(0.5, 1, 2, 4, 8, 15, 30, 60),
)


def record_run_metrics(result):
    labels = {
        "workflow": result.workflow,
        "prompt_version": result.prompt_version,
        "model_route": result.model_route,
        "outcome": result.outcome,
    }

    RUNS.labels(**labels).inc()
    COST.labels(**labels).inc(result.estimated_cost_usd)
    LATENCY.labels(**labels).observe(result.duration_seconds)

    TOKENS.labels(result.workflow, result.model, "input", "uncached").inc(
        result.usage.input_tokens - result.usage.cache_read_input_tokens
    )
    TOKENS.labels(result.workflow, result.model, "input", "cache_read").inc(
        result.usage.cache_read_input_tokens
    )
    TOKENS.labels(result.workflow, result.model, "output", "uncached").inc(
        result.usage.output_tokens
    )
```

Keep metric labels low-cardinality. Good labels include workflow, prompt version, model route, outcome, environment, and failure class. Risky labels include raw ticket ID, user ID, full customer name, exact prompt text, and error message strings. Use traces or warehouse tables for high-cardinality investigation. Use metrics for fast aggregation.

For traces, add the same labels as span attributes:

```python
span.set_attribute("app.workflow", result.workflow)
span.set_attribute("app.prompt.version", result.prompt_version)
span.set_attribute("app.model.route", result.model_route)
span.set_attribute("app.outcome", result.outcome)
span.set_attribute("quality.citation_coverage", result.citation_coverage)
span.set_attribute("quality.policy_safe", result.policy_safe)
span.set_attribute("cost.estimated_usd", result.estimated_cost_usd)
span.set_attribute("gen_ai.usage.input_tokens", result.usage.input_tokens)
span.set_attribute("gen_ai.usage.output_tokens", result.usage.output_tokens)
span.set_attribute("gen_ai.usage.cache_read.input_tokens", result.usage.cache_read_input_tokens)
```

This shared vocabulary lets an on-call engineer move from a Grafana spike to trace examples with the same labels.

## Dashboard Queries That Explain Tradeoffs

<!-- section-summary: Good dashboards show cost per useful result, quality by prompt version, latency percentiles, retry waste, and cache behavior by workflow. -->

A useful dashboard should have a small number of panels that lead to action. BrightCart starts with these:

- Run volume by workflow and outcome.
- Cost per outcome and cost per resolved ticket.
- p50, p95, and p99 latency by workflow and model route.
- Input tokens, output tokens, and cache-read tokens by prompt version.
- Draft-use rate and heavy-edit rate by ticket category.
- Citation coverage and policy-safe rate by prompt version.
- Failure classes and retry counts by tool.
- Top ticket categories by spend and low-quality outcome.

Example PromQL for cost per useful draft:

```promql
sum by (prompt_version) (
  rate(support_copilot_estimated_cost_usd_total{outcome=~"resolved_with_draft|useful_with_edits"}[1h])
)
/
sum by (prompt_version) (
  rate(support_copilot_runs_total{outcome=~"resolved_with_draft|useful_with_edits"}[1h])
)
```

Example PromQL for p95 latency:

```promql
histogram_quantile(
  0.95,
  sum by (le, workflow, model_route) (
    rate(support_copilot_run_duration_seconds_bucket[10m])
  )
)
```

Example PromQL for cache-read share:

```promql
sum by (prompt_version) (
  rate(support_copilot_tokens_total{token_type="input",cache_state="cache_read"}[1h])
)
/
sum by (prompt_version) (
  rate(support_copilot_tokens_total{token_type="input"}[1h])
)
```

Example warehouse query for quality and cost by ticket category:

```sql
select
  ticket_category,
  prompt_version,
  count(*) as runs,
  avg(case when outcome in ('resolved_with_draft', 'useful_with_edits') then 1 else 0 end) as useful_rate,
  avg(case when outcome = 'unsafe_or_wrong' then 1 else 0 end) as unsafe_rate,
  avg(citation_coverage) as avg_citation_coverage,
  sum(estimated_cost_usd) as total_cost_usd,
  sum(estimated_cost_usd) / nullif(count(*), 0) as cost_per_run_usd
from support_copilot_run_fact
where created_at >= current_date - interval '7 days'
group by 1, 2
order by total_cost_usd desc;
```

This query tells the product story. If barcode scanner tickets have high cost and low useful rate, the team can inspect traces for that category. Maybe retrieval misses the latest scanner workaround. Maybe the prompt asks for too much explanation. Maybe the model route sends every scanner issue to a large model because the classifier treats the category as complex.

## Read Quality Signals With Trace Evidence

<!-- section-summary: Quality metrics should link back to examples, trace IDs, retrieved documents, evaluator notes, and human edits so teams can explain the number. -->

Quality metrics are easy to misunderstand when they float away from examples. A draft-use rate of 82 percent sounds good until you learn agents send many drafts after heavy edits. A low unsafe rate sounds good until reviewers only sample easy tickets. A high resolution rate sounds good until customers reopen tickets after a week.

Store quality signals with trace IDs:

```json
{
  "trace_id": "trc_support_93ac",
  "ticket_id_hash": "tkt_44ab",
  "ticket_category": "barcode_scanner_sync",
  "prompt_version": "support_draft_2026-07-01.4",
  "outcome": "useful_with_edits",
  "quality": {
    "draft_used": true,
    "heavy_edit": true,
    "resolution_confirmed": true,
    "reopened_within_7d": false,
    "citation_coverage": 0.83,
    "policy_safe": true,
    "reviewer_label": "minor_missing_step"
  },
  "cost": {
    "estimated_usd": 0.0284,
    "input_tokens": 4820,
    "output_tokens": 612,
    "cache_read_input_tokens": 3100,
    "tool_calls": 2,
    "retries": 1
  }
}
```

This row supports several workflows. An evaluator can sample `minor_missing_step` examples. A prompt engineer can open traces where `heavy_edit=true`. A finance partner can see spend by successful and weak outcomes. An on-call engineer can inspect traces where `retries>0` and `estimated_usd` is high.

Quality signals should include at least one direct human signal. Fully automated judges are useful, especially for citation checks, policy checks, and rough correctness scoring. Human edits and ticket outcomes keep the system anchored to actual support work. If agents constantly rewrite a draft before sending, the copilot may still save time. If agents ignore the draft, the system is paying for noise.

## Control Cost Without Hiding Quality Problems

<!-- section-summary: Cost controls should reduce waste while preserving quality, and each control needs a metric that proves the change helped rather than only lowering spend. -->

Once quality and cost share a dashboard, you can tune the system responsibly. The best cost controls for a support copilot usually target waste:

| Control | What it saves | Quality check |
| --- | --- | --- |
| Model routing | Sends simple tickets to a smaller or faster model | Useful-rate and unsafe-rate by route |
| Prompt shortening | Reduces repeated instructions and verbose outputs | Citation coverage and heavy-edit rate |
| Retrieval pruning | Sends fewer, better documents into context | Grounding failures and reopen rate |
| Prompt caching | Reuses stable prompt or context prefixes when available | Cache-read share and answer quality |
| Retry limits | Stops repeated failed calls | Failure class, timeout rate, escalations |
| Early escalation | Avoids expensive uncertain loops | Correct escalation rate and customer friction |
| Tool caching | Avoids repeated account or outage lookups | Freshness errors and stale-data incidents |

OpenAI's latency guidance emphasizes that generated output tokens often dominate latency, and reducing output length can reduce response time. That advice lines up with support-copilot cost work because output tokens also cost money. However, shorter answers need quality checks. A 60-word answer can save spend and still fail if it omits the scanner reset sequence that closes the ticket.

Here is a model-routing policy in config form:

```yaml
model_routing:
  default_route: support_standard
  routes:
    password_reset:
      model: support-small-router
      max_output_tokens: 220
      require_citations: false
      escalation_on_confidence_below: 0.55
    barcode_scanner_sync:
      model: gpt-5.5
      max_output_tokens: 700
      require_citations: true
      retrieval_profile: scanner_docs_v3
      escalation_on_confidence_below: 0.72
    billing_dispute:
      model: gpt-5.5
      max_output_tokens: 500
      require_citations: true
      require_policy_guardrail: true
      escalation_on_confidence_below: 0.80
```

Each route needs a review query after release:

```sql
select
  model_route,
  count(*) as runs,
  avg(estimated_cost_usd) as avg_cost,
  avg(duration_seconds) as avg_latency,
  avg(case when outcome in ('resolved_with_draft', 'useful_with_edits') then 1 else 0 end) as useful_rate,
  avg(case when outcome = 'unsafe_or_wrong' then 1 else 0 end) as unsafe_rate,
  avg(case when reopened_within_7d then 1 else 0 end) as reopen_rate
from support_copilot_run_fact
where created_at >= timestamp '2026-07-05 00:00:00'
group by 1
order by avg_cost desc;
```

If cost drops and reopen rate rises, the route change hurt customers. If latency drops, useful rate holds, and unsafe rate stays flat, the route change is a good candidate for broader rollout.

## Incident Triage For Quality And Cost Spikes

<!-- section-summary: Quality incidents and cost incidents use the same evidence path: metric spike, label breakdown, trace examples, failure class, rollback or mitigation, and replay cases. -->

BrightCart's Monday spike gives us a concrete incident flow. The dashboard shows cost per useful draft doubled between 08:00 and 10:00. The first breakdown shows the spike only affects `barcode_scanner_sync`. The second breakdown shows prompt version `support_draft_2026-07-01.4`. Trace samples show repeated retrieval of six long docs plus a retry on `account_lookup`. Reviewer labels say `minor_missing_step` for many drafts.

![BrightCart cost spike triage](/content-assets/articles/article-mlops-llmops-quality-and-cost/brightcart-cost-spike-triage.png)
*The cost incident flow starts with a business ratio, narrows by ticket category and prompt version, then opens trace examples before choosing a mitigation.*

The triage packet might look like this:

```yaml
incident_id: inc-support-2026-07-05-009
metric_triggered: "cost_per_useful_draft > 2x 7-day baseline"
scope:
  workflow: ticket_draft
  ticket_category: barcode_scanner_sync
  prompt_version: support_draft_2026-07-01.4
symptoms:
  - "Input tokens increased after scanner docs update."
  - "Heavy-edit rate rose from 18% to 41%."
  - "Account lookup retry rate rose from 1% to 12%."
trace_examples:
  - trc_support_93ac
  - trc_support_a81e
root_cause_hypothesis:
  - "Retrieval profile includes outdated scanner migration guide."
  - "Prompt asks for full setup steps even when ticket asks about sync failure."
mitigation:
  - "Pin retrieval profile to scanner_docs_v2 while docs owner reviews v3."
  - "Route lookup timeout failures to human review after one retry."
follow_up:
  - "Add eval case for scanner sync missing reset sequence."
  - "Add alert on tool retry cost share."
```

The same packet works for a quality spike. Replace the cost trigger with an unsafe-rate or reopen-rate trigger. The investigation still uses labels, traces, examples, failure classes, and replay cases.

Good alerts avoid noisy thresholds. Alert on a customer-visible ratio such as unsafe rate, cost per useful draft, p95 latency for active workflows, or reopen rate for copilot-assisted tickets. Add labels that tell responders where to look: workflow, category, prompt version, model route, and failure class.

```yaml
alert: SupportCopilotCostPerUsefulDraftHigh
expr: |
  (
    sum(rate(support_copilot_estimated_cost_usd_total[1h]))
    /
    sum(rate(support_copilot_runs_total{outcome=~"resolved_with_draft|useful_with_edits"}[1h]))
  ) > 2 * support_copilot_cost_per_useful_draft_7d_baseline
for: 30m
labels:
  severity: warning
  owner: support-copilot
annotations:
  summary: "Support copilot cost per useful draft is above baseline"
  runbook: "Check workflow, ticket_category, prompt_version, model_route, retry_count, cache_read_share, and trace examples."
```

In a real Prometheus setup, you would usually calculate the baseline with a recording rule or warehouse-driven metric. The alert shape is the key idea: tie spend to useful outcomes and give responders the labels they need.

## Practical Checks And Interview-Ready Understanding

Quality and cost monitoring asks one production question: are we spending the right amount to deliver safe, useful support outcomes? A strong answer should mention outcome taxonomies, prompt and model versions, token attribution, cache-read tokens, latency histograms, tool retry cost, human edit signals, trace-linked quality labels, dashboards, alerts, and replay cases.

Use these checks before calling a support copilot production-ready:

- Every run records outcome, workflow, prompt version, model route, token usage, estimated cost, latency, cache-read tokens when reported, tool call count, retry count, and failure class.
- Quality metrics include user or support outcomes such as draft used, heavy edits, reopen rate, escalation correctness, citation coverage, policy safety, and customer friction.
- Cost metrics connect spend to useful outcomes, such as cost per resolved ticket and cost per useful draft.
- Prometheus or OpenTelemetry metrics use low-cardinality labels; traces and warehouse rows carry high-cardinality investigation fields.
- Dashboard panels link to trace examples for expensive, slow, unsafe, or low-quality segments.
- Model-routing, prompt-shortening, caching, and retry-limit changes include quality guardrails before rollout.
- Incidents produce replay cases and eval rows, not only a dashboard screenshot.

Common mistakes include tracking total tokens without outcome labels, celebrating lower spend while reopen rate climbs, measuring only average latency while p95 users wait, counting every generated draft as success, using raw user or ticket IDs as metric labels, and treating cache hit rate as a win without checking answer quality.

The interview-ready summary is short: quality and cost are two views of the same production system. Traces explain individual runs. Metrics show live patterns. Warehouse tables support deeper business analysis. Evals and replay cases turn incidents into regression tests. The team wins when a dashboard can answer, "Which workflows cost more this week, did users get better outcomes, and which traces prove the reason?"

## References

- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI cost optimization guide](https://developers.openai.com/api/docs/guides/cost-optimization)
- [OpenAI latency optimization guide](https://developers.openai.com/api/docs/guides/latency-optimization)
- [OpenTelemetry GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md)
- [OpenTelemetry metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)
- [OpenTelemetry traces concepts](https://opentelemetry.io/docs/concepts/signals/traces/)
- [Prometheus query functions](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- [Prometheus histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [Grafana Prometheus query editor](https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/)
- [Langfuse observability overview](https://langfuse.com/docs/observability/overview)
- [Langfuse masking docs](https://langfuse.com/docs/observability/features/masking)
- [Phoenix tracing overview](https://arize.com/docs/phoenix/tracing/llm-traces)
