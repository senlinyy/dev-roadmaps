---
title: "Model Routing"
description: "Route customer-support LLM traffic across model tiers with accuracy targets, latency budgets, cost controls, fallbacks, and traceable routing decisions."
overview: "Model routing is the production practice of choosing which model should handle each request. You will build the idea through a customer-support triage system that sends simple tickets to fast models, escalates risky cases to stronger reasoning models, and records enough evidence to debug cost, latency, and quality."
tags: ["MLOps","LLMOps","advanced","deployment"]
order: 1
id: "article-mlops-llmops-model-routing"
---

## Why Model Routing Matters

<!-- section-summary: Model routing chooses the right model tier for each request instead of sending every request through the same expensive path. In a support product, routing protects response quality while keeping fast, low-risk work cheap and responsive. -->

Model routing means your application decides which model should handle a request before the final answer is generated. The route can depend on task type, customer tier, risk, latency target, context length, language, confidence, available budget, or provider health. In plain terms, routing is the traffic controller for your LLM system.

Imagine a company called BrightDesk that runs a customer-support triage assistant for a consumer electronics brand. A customer writes, "My headphones will not pair after the update." Another customer writes, "Your charger burned my kitchen counter and I need someone to call me." Both messages arrive in the same chat product, yet they deserve different treatment. The first message may need a quick classification and a link to a troubleshooting flow. The second message touches safety, liability, customer trust, and escalation policy.

If BrightDesk sends every support message to the strongest model with high reasoning effort, the product may answer well, yet the bill grows quickly and routine tickets feel slow. If BrightDesk sends every message to the cheapest model, simple work may pass, while safety-sensitive tickets may get weak routing, poor tone, or missing escalation. A router gives the system a middle path: use fast and cheap models for simple tasks, reserve expensive reasoning for harder cases, and fall back gracefully when a route fails.

Current OpenAI guidance says model choice should balance accuracy, latency, and cost, with accuracy targets checked before cost trimming. The Responses API is the current default surface for new direct model calls, tool use, structured outputs, and agentic workflows. Those two ideas shape a practical router: start from product quality requirements, measure task performance by tier, then move eligible traffic to smaller or cheaper routes only when evals say the route still works.

In BrightDesk, the router has one main promise: every ticket should get the smallest model path that meets the product contract for that ticket. That contract might include "triage within 600 ms," "route safety cases to a human immediately," "use a stronger model when refund policy reasoning is required," and "record why the route was chosen." The rest of this article builds that promise into a working design.

## The Support Triage Scenario

<!-- section-summary: A useful router starts with a concrete workflow, not a generic list of models. BrightDesk splits support traffic into triage, answer drafting, policy reasoning, and escalation so each route has a clear job. -->

BrightDesk receives about 80,000 support messages per day. The support team cares about first-response time, ticket deflection, escalation accuracy, customer satisfaction, and the cost per resolved conversation. The LLM product team owns three workflows:

| Workflow | Example request | Main risk | Target |
|---|---|---|---|
| Fast triage | "How do I reset Bluetooth?" | Wrong category | Under 600 ms |
| Standard answer | "My order says delivered, but I never got it." | Weak policy explanation | Under 2 seconds |
| Risk review | "The battery overheated and caused damage." | Missed safety escalation | Accuracy first |
| Agent assist | "Summarize this long thread for the human agent." | Missing facts | Cost-aware background work |

This split matters because "support assistant" sounds like one feature, while production traffic contains several different jobs. **Triage** asks the model to label the ticket. **Answer drafting** asks the model to write a useful response. **Policy reasoning** asks the model to compare a customer situation against support rules. **Agent assist** asks the model to summarize or prepare notes for a human.

Each job can use a different model tier. BrightDesk might use a nano or mini model for classification, a mini model for routine responses, and a flagship reasoning model for safety, refunds, legal threats, or multi-turn diagnostic cases. The route can also choose different reasoning effort. A simple label extraction route can use low effort. A complex policy case may use medium or high effort after evals show the added latency pays for itself.

A first production design usually looks like this:

```yaml
routes:
  fast_triage:
    model: gpt-5.4-nano
    reasoning_effort: none
    timeout_ms: 700
    max_input_tokens: 2500
    target_accuracy: 0.92
    fallback: standard_triage

  standard_triage:
    model: gpt-5.4-mini
    reasoning_effort: low
    timeout_ms: 1500
    max_input_tokens: 6000
    target_accuracy: 0.96
    fallback: human_queue

  policy_reasoning:
    model: gpt-5.5
    reasoning_effort: medium
    timeout_ms: 7000
    max_input_tokens: 24000
    target_accuracy: 0.985
    fallback: human_queue

  agent_summary_background:
    model: gpt-5.4-mini
    service_tier: flex
    timeout_ms: 900000
    target_accuracy: 0.95
    fallback: retry_later
```

The YAML is simple on purpose. A router should make route choices visible to engineers, product managers, support operations, and finance. If the route table lives only as scattered `if` statements, the team struggles to review cost changes, risk handling, or fallback behavior. A small route table gives the team a common artifact for production review.

![BrightDesk model router routes support tickets by task, risk, and budget.](/content-assets/articles/article-mlops-llmops-model-routing/model-routing-route-map.png)

*BrightDesk keeps simple setup work, standard answers, policy reasoning, and safety handoffs on separate paths so each ticket carries the right risk and cost evidence.*

## What The Router Actually Reads

<!-- section-summary: The router needs request facts, product policy, budget limits, and health signals before it can choose a model path. The model choice should come from observable inputs rather than a hidden guess. -->

A router needs a compact set of facts. BrightDesk uses the ticket text, customer account tier, product family, detected language, previous messages, attachment metadata, and any safety keywords found by deterministic checks. It also reads live budgets: remaining tokens for the project, route-level rate limits, current provider error rate, and p95 latency by route.

The router should use deterministic rules for facts that are cheap and clear. For example, if a ticket includes "fire," "smoke," "burn," or "injury," BrightDesk can force a safety route before asking a model to classify it. The model can still help describe the issue, but the application should own the routing policy for high-risk triggers. This keeps the system easier to audit and prevents a model from silently downplaying a case.

For fuzzy cases, the router can call a small classifier model with a structured output schema. Structured output helps because the router needs fields like `category`, `risk`, `confidence`, and `needs_human`. The OpenAI docs describe Structured Outputs as a way to make responses follow a JSON Schema, which fits routing because downstream code needs reliable fields.

Here is a TypeScript shape for a triage pass using the Responses API and Zod helper style:

```typescript
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const openai = new OpenAI();

const TriageResult = z.object({
  category: z.enum(["setup", "billing", "delivery", "refund", "safety", "other"]),
  risk: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  needsHuman: z.boolean(),
  reason: z.string().max(240),
});

export async function classifyTicket(ticketText: string) {
  const response = await openai.responses.parse({
    model: "gpt-5.4-nano",
    reasoning: { effort: "none" },
    input: [
      {
        role: "system",
        content: "Classify customer support tickets for BrightDesk. Return only the schema fields.",
      },
      {
        role: "user",
        content: ticketText,
      },
    ],
    text: {
      format: zodTextFormat(TriageResult, "support_triage"),
    },
  });

  return response.output_parsed;
}
```

The model here has a narrow job. It labels the ticket and explains the route in one short reason. It should avoid drafting a customer-facing answer.

BrightDesk also keeps a route decision object. This object travels with the request through logs, traces, analytics, and support review. It gives every later system the same answer to "why did this ticket go through that model?"

```typescript
type RouteDecision = {
  route: "fast_triage" | "standard_answer" | "policy_reasoning" | "human_queue";
  model: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh";
  confidence: number;
  budgetCents: number;
  latencyBudgetMs: number;
  reason: string;
  fallbackRoute?: string;
};
```

This is the part many early LLM apps skip. They call a model, return a response, and lose the routing context. Later, when finance asks why costs jumped on Friday, or support asks why a safety ticket missed escalation, there is no clean evidence. The route decision should be as ordinary as an HTTP status code.

## Route By Task, Risk, And Budget

<!-- section-summary: A strong router combines simple rules, model confidence, and product budgets. The goal is to reserve stronger models for cases where the extra quality matters to the user or the business. -->

The first routing dimension is task type. Classification, extraction, translation, short rewriting, and deduplication often fit smaller models. Policy comparison, ambiguous customer intent, high-stakes escalation, and multi-step tool use often need a stronger model or higher reasoning effort. You should prove those assumptions with evals, then keep measuring them as prompts and models change.

The second dimension is risk. BrightDesk treats safety, chargeback threats, legal words, executive complaints, and repeated failed troubleshooting as higher-risk traffic. Risky traffic can go straight to a stronger model, a human, or a route that drafts an answer for human review. A good route can still be automated, yet it should match the review level to the possible harm.

The third dimension is budget. Budget has at least three forms: money, latency, and rate-limit headroom. If the customer is waiting in a live chat, a slow route can hurt the product even when the answer is accurate. If the support team is running nightly summaries, slower and cheaper Batch or Flex-style processing may fit. If rate-limit headroom is low, the router can defer background work and protect live support traffic.

Here is a simple routing function. It uses deterministic safety rules first, then the classifier result, then a latency and account-tier policy:

```typescript
const SAFETY_TERMS = ["fire", "smoke", "burn", "injury", "shock", "exploded"];

export function chooseRoute(input: {
  text: string;
  customerTier: "standard" | "business" | "enterprise";
  triage: {
    category: string;
    risk: "low" | "medium" | "high";
    confidence: number;
    needsHuman: boolean;
    reason: string;
  };
  liveChat: boolean;
  remainingDailyBudgetCents: number;
}): RouteDecision {
  const lower = input.text.toLowerCase();
  const hasSafetyTerm = SAFETY_TERMS.some((term) => lower.includes(term));

  if (hasSafetyTerm || input.triage.category === "safety") {
    return {
      route: "human_queue",
      model: "none",
      reasoningEffort: "none",
      confidence: input.triage.confidence,
      budgetCents: 0,
      latencyBudgetMs: 300,
      reason: "Safety trigger requires human escalation.",
    };
  }

  if (input.triage.risk === "high" || input.triage.confidence < 0.72) {
    return {
      route: "policy_reasoning",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      confidence: input.triage.confidence,
      budgetCents: 8,
      latencyBudgetMs: input.liveChat ? 5000 : 12000,
      reason: `Escalated because triage risk=${input.triage.risk} confidence=${input.triage.confidence}.`,
      fallbackRoute: "human_queue",
    };
  }

  if (input.remainingDailyBudgetCents < 5000 && input.customerTier === "standard") {
    return {
      route: "fast_triage",
      model: "gpt-5.4-nano",
      reasoningEffort: "none",
      confidence: input.triage.confidence,
      budgetCents: 1,
      latencyBudgetMs: 700,
      reason: "Low-risk standard-tier request during budget protection window.",
      fallbackRoute: "standard_answer",
    };
  }

  return {
    route: "standard_answer",
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    confidence: input.triage.confidence,
    budgetCents: 3,
    latencyBudgetMs: input.liveChat ? 1800 : 4000,
    reason: "Routine support request with adequate triage confidence.",
    fallbackRoute: "policy_reasoning",
  };
}
```

The route names are product concepts, not provider concepts. That is deliberate. If BrightDesk changes `standard_answer` from one model to another next quarter, the product route stays stable. Dashboards, eval reports, and incident reviews can compare "standard answer route" over time instead of chasing model strings through every chart.

## Fallbacks, Retries, And Circuit Breakers

<!-- section-summary: Routing also decides what happens when a model path fails, times out, or starts producing weak answers. Fallbacks should protect the user experience without hiding reliability problems from the team. -->

A fallback is the next action when the chosen route cannot finish inside the product contract. The fallback might use a stronger model, a smaller model, a cached answer, a static response, a queue, or a human handoff. The right fallback depends on the failure. A timeout in a live chat may use a shorter answer from a faster model. A safety case may skip another model call and move to a human queue.

Retries need care. Repeating the same request three times can multiply cost and pressure rate limits while giving the customer a slower experience. BrightDesk uses one retry for transient errors, then moves to the configured fallback. It also uses idempotency keys around support-side actions so a retried tool call cannot create duplicate refunds or duplicate escalations.

A **circuit breaker** temporarily stops using a route when live health signals are bad. For example, if `policy_reasoning` has a 25% timeout rate for five minutes, the router can send high-risk cases straight to the human queue and pause lower-priority policy drafts. That keeps the product honest. Customers still get a path forward, and the team gets a page or ticket instead of silent quality drift.

Here is a compact Python sketch that wraps route execution:

```python
import time
from dataclasses import dataclass
from openai import OpenAI

client = OpenAI()

@dataclass
class Route:
    name: str
    model: str
    reasoning_effort: str
    timeout_ms: int
    fallback: str | None

ROUTES = {
    "standard_answer": Route("standard_answer", "gpt-5.4-mini", "low", 1800, "policy_reasoning"),
    "policy_reasoning": Route("policy_reasoning", "gpt-5.5", "medium", 7000, "human_queue"),
}

def call_route(route_name: str, prompt: str, circuit_open: set[str]) -> dict:
    route = ROUTES[route_name]
    started = time.monotonic()

    if route.name in circuit_open:
        return {"status": "fallback", "route": route.fallback, "reason": "circuit_open"}

    try:
        response = client.responses.create(
            model=route.model,
            reasoning={"effort": route.reasoning_effort},
            input=prompt,
            timeout=route.timeout_ms / 1000,
        )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        return {
            "status": "ok",
            "route": route.name,
            "model": route.model,
            "latency_ms": elapsed_ms,
            "text": response.output_text,
            "usage": response.usage.model_dump() if response.usage else {},
        }
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        return {
            "status": "fallback",
            "route": route.fallback,
            "failed_route": route.name,
            "latency_ms": elapsed_ms,
            "reason": type(exc).__name__,
        }
```

Production code would use typed exceptions, provider error classes, and structured logging, yet this sketch shows the important pattern. Route execution should return success, failure, model, latency, usage, and fallback reason in a consistent shape. The router should never treat a fallback as invisible. Fallback rate is one of the most useful health metrics you can have.

![BrightDesk fallback ladder with one retry, fallback route, human handoff, and circuit breaker evidence.](/content-assets/articles/article-mlops-llmops-model-routing/model-routing-fallback-ladder.png)

*The fallback ladder gives each failed route one retry, a planned alternate path, and visible circuit-breaker evidence for review.*

## Evals Decide Which Routes Earn Traffic

<!-- section-summary: A route should earn production traffic through evals, not through guesswork. You compare model tiers on real support examples, then set thresholds for quality, cost, and latency before rollout. -->

Before BrightDesk shifts traffic to a cheaper route, the team builds an eval set from real support history. They sample setup questions, delivery problems, refund requests, safety complaints, angry messages, short messages, long messages, and multilingual messages. Each example includes the expected category, escalation decision, acceptable answer traits, and any policy citations the answer should use.

The team then runs each route against the eval set. For triage, metrics might include category accuracy, safety recall, human-escalation precision, and confidence calibration. For answer drafting, metrics might include policy correctness, tone, helpfulness, citation quality, and "requires human review" detection. For latency and cost, the team records p50, p95, output tokens, input tokens, cached tokens, and estimated cents per ticket.

The key habit is comparing the route against the job it performs. The mini model might perform very well on setup questions and poorly on safety complaints. That result should lead to a route rule, not a blanket opinion about the model. The router can send setup questions to the mini path while safety complaints go to a human or stronger reasoning path.

A small eval result table gives reviewers a clear decision:

| Candidate route | Setup accuracy | Safety recall | p95 latency | Cost per 1k tickets | Decision |
|---|---:|---:|---:|---:|---|
| `fast_triage` | 94.2% | 87.1% | 420 ms | $ | Setup only |
| `standard_triage` | 97.4% | 96.8% | 970 ms | $$ | Default triage |
| `policy_reasoning` | 98.1% | 99.2% | 4.8 s | $$$$ | High risk |

BrightDesk also runs shadow evaluation. In shadow mode, the new route processes a copy of production traffic while the old route still serves the customer. The team compares decisions, cost, and latency without changing the customer experience. Shadow runs catch cases your offline set missed, such as a new product launch that causes a wave of unfamiliar language.

## Observability For Routing

<!-- section-summary: Routing needs traces, metrics, and logs that show which model path handled each ticket and why. Without that evidence, cost spikes and quality incidents are hard to explain. -->

OpenTelemetry gives you a vendor-neutral way to create traces, metrics, and logs. For a router, a trace should show the incoming support request, the classifier call, the chosen route, any tool calls, the final model call, and the fallback if one happened. OpenAI Agents SDK tracing can also record model calls, tool calls, handoffs, guardrails, and custom spans when you build with the SDK.

BrightDesk tracks these fields on every route decision:

| Field | Why it matters |
|---|---|
| `route.name` | Groups dashboards by product path |
| `model.name` | Shows which model served the request |
| `reasoning.effort` | Explains latency and reasoning-token changes |
| `ticket.category` | Finds weak segments |
| `risk.level` | Confirms risky traffic gets proper handling |
| `fallback.reason` | Detects provider, timeout, and quality problems |
| `usage.input_tokens`, `usage.output_tokens`, `usage.cached_tokens` | Links cost to request shape |
| `eval.policy_version` | Shows which policy prompt was active |

Prometheus can hold route metrics such as request count, error count, timeout count, fallback count, and latency histograms. Grafana can put p95 latency and fallback rate next to exemplars that jump to individual traces. That link is useful during an incident because a dashboard spike can take an engineer to the exact support request path that caused it.

Here is a Prometheus-style alert for fallback spikes:

```yaml
groups:
  - name: llm-routing
    rules:
      - alert: HighPolicyReasoningFallbackRate
        expr: |
          sum(rate(llm_route_fallback_total{route="policy_reasoning"}[10m]))
          /
          sum(rate(llm_route_requests_total{route="policy_reasoning"}[10m]))
          > 0.08
        for: 15m
        labels:
          severity: page
          team: support-ai
        annotations:
          summary: Policy reasoning fallback rate is above 8 percent
          runbook: Check provider latency, route circuit breaker state, and latest prompt release.
```

The alert checks a ratio for fifteen minutes. That matters because raw fallback count rises during traffic spikes, while the fallback rate tells you whether the route itself is unhealthy. During review, the team can open traces for recent fallbacks and see whether the issue came from timeouts, rate limits, prompt regression, or a new ticket type.

## Practical Checks Before Shipping

<!-- section-summary: A production router needs reviewable route tables, eval thresholds, fallback paths, and dashboards before it handles real customers. The checks help you prove that model choice is deliberate rather than accidental. -->

Use this checklist before you send real support traffic through a model router:

- Each route has a named job, owner, model, reasoning effort, timeout, fallback, and quality target.
- High-risk cases have deterministic triggers before model classification.
- Smaller models receive only the tasks they passed in evals.
- Route decisions are logged with model, latency, tokens, confidence, route reason, and fallback reason.
- Live chat routes have strict latency budgets and short fallbacks.
- Background routes use Batch or Flex-style processing when immediate response time is unnecessary.
- Circuit breakers can protect the product during provider errors or route-specific timeouts.
- Shadow traffic compares old and new routes before canary release.
- Dashboards separate product route names from provider model names.
- Cost dashboards group by route, customer tier, feature, and prompt version.

Common mistakes are easy to recognize. A team sends all traffic to one flagship model because it feels safer, then the feature misses its cost target. Another team routes by customer tier alone, so enterprise users get expensive models even for trivial classification. A third team creates a clever router without evals, so no one can explain whether the cheap path is good enough.

Interview-ready understanding sounds like this: model routing is the practice of matching each LLM request to the smallest model path that satisfies the product quality, risk, latency, and cost contract. You prove the route with evals, enforce it with route tables and deterministic risk rules, protect it with fallbacks and circuit breakers, and observe it with route-level traces and metrics. The router is part product policy, part reliability system, and part cost-control layer.

![Model routing readiness loop with route policy, eval gate, shadow run, and trace review.](/content-assets/articles/article-mlops-llmops-model-routing/model-routing-readiness-loop.png)

*A production router earns traffic through route policy, eval gates, shadow runs, and trace review before teams widen rollout.*

## References

- [OpenAI model selection](https://developers.openai.com/api/docs/guides/model-selection)
- [OpenAI models guide](https://developers.openai.com/api/docs/models)
- [OpenAI Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI API deployment checklist](https://developers.openai.com/api/docs/guides/deployment-checklist)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI Batch API](https://developers.openai.com/api/docs/guides/batch)
- [OpenAI Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
- [OpenAI Agents SDK integrations and observability](https://developers.openai.com/api/docs/guides/agents/integrations-observability)
- [OpenTelemetry documentation](https://opentelemetry.io/docs/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Grafana exemplars](https://grafana.com/docs/grafana/latest/fundamentals/exemplars/)
