---
title: "Caching and Limits"
description: "Control legal-assistant latency and spend with prompt caching, result caching, semantic caching, quotas, rate limits, backpressure, and circuit breakers."
overview: "Caching and limits keep LLM applications usable when prompts are long, users repeat work, and traffic arrives in bursts. You will learn the topic through a legal research assistant that must protect client data, reuse stable legal context, enforce tenant quotas, and degrade safely during load."
tags: ["MLOps","LLMOps","advanced","deployment"]
order: 2
id: "article-mlops-llmops-caching-and-limits"
---

## Why Caching And Limits Matter

<!-- section-summary: Caching saves repeated work, while limits protect the system when demand exceeds capacity. In a legal research assistant, both controls must respect confidentiality, matter boundaries, and user expectations. -->

Caching and limits are the production controls that keep an LLM application fast, affordable, and predictable. **Caching** reuses work that has already been done. **Limits** decide how much work a user, tenant, feature, route, or background job can consume during a time window. Together, they stop the product from treating every request as brand new and every user as unlimited.

Picture a legal research assistant called CaseLens. Lawyers use it to summarize statutes, compare contract clauses, search internal memos, and draft research notes. A partner may ask, "Summarize the latest enforceability cases for non-compete agreements in California." Five associates on the same matter may ask similar questions over the next hour. The system may send the same firm-wide instructions, the same jurisdiction rules, the same citation policy, and the same retrieval context again and again.

If CaseLens pays full price and waits full latency for every repeated prefix, every near-duplicate query, and every background memo, the product feels slow and expensive. If CaseLens caches aggressively without tenant boundaries, it risks leaking privileged work across matters. If CaseLens ignores rate limits, a single large matter review can consume the project quota and slow everyone else. The right design gives every layer a job: prompt caching for stable prefixes, exact result caching for identical safe requests, semantic caching for carefully approved near-duplicates, quotas for fairness, and circuit breakers for failures.

OpenAI prompt caching works automatically for eligible long prompts, and the docs say cache hits require exact prefix matches. That matters for CaseLens because the legal assistant sends a long stable prefix: firm policy, writing style, citation rules, safety rules, and a list of allowed research tools. Dynamic content such as the lawyer's question, matter ID, retrieved snippets, and draft notes should appear later in the request so the stable prefix can hit the provider cache.

Limits come from multiple places. OpenAI rate limits are defined at organization and project levels and vary by model. Your own application also needs tenant quotas, per-user burst controls, queue caps, and maximum context sizes. Provider limits keep the API reliable. Product limits keep your customers from surprising each other.

## The CaseLens Scenario

<!-- section-summary: CaseLens handles repeated legal research in a multi-tenant environment. The scenario forces you to separate provider caching, application caching, semantic reuse, and quota enforcement. -->

CaseLens serves law firms. Each firm has tenants, matters, users, document collections, and practice areas. A single request includes a user question, matter ID, jurisdiction, allowed document corpus, selected research mode, and the user's role. The assistant can search firm documents, retrieve legal memos, summarize results, and produce a draft answer with citations.

The team cares about five production numbers:

| Metric | Why the legal team cares |
|---|---|
| p95 answer latency | Lawyers abandon slow research tools |
| cost per matter | Large document reviews can run for days |
| cache hit rate | Repeated research should reuse stable work |
| quota rejection rate | Limits should protect capacity without blocking normal work |
| data isolation incidents | One cross-matter leak would be severe |

The cache and limit design uses four layers:

| Layer | What it reuses or controls | Example |
|---|---|---|
| Provider prompt cache | Stable prompt prefixes | Firm instructions and citation policy |
| Exact result cache | Identical safe requests | Same question, same matter, same corpus version |
| Semantic cache | Similar approved questions | "summarize arbitration clause" and "explain arbitration provision" |
| Limits and queues | Fairness and protection | Per-matter TPM, daily budget, background queue depth |

The strongest rule is data isolation. Every cache key includes tenant ID, matter ID, corpus version, model route, and policy version where relevant. CaseLens never shares cached legal answers across tenants. It also avoids caching full user prompts when a matter requires stricter retention. Instead, it stores hashes, short metadata, TTLs, and encrypted payloads in tenant-scoped storage.

This setup may sound like a lot of machinery for "make it faster." In legal software, speed and confidentiality have to move together. A cache hit that returns the wrong matter's answer is worse than a slow cache miss.

## Prompt Caching: Make The Prefix Stable

<!-- section-summary: Prompt caching rewards stable prompt prefixes, so put shared instructions and tool definitions first. Dynamic legal facts should stay near the end where they change from request to request. -->

Prompt caching is provider-side reuse of the repeated prefix in a prompt. OpenAI's prompt caching guide says cache hits rely on exact prefix matches, with stable content at the front and dynamic user-specific content at the end. It also says cached token counts appear in `usage.prompt_tokens_details.cached_tokens`, and cached tokens still count toward rate limits.

For CaseLens, the stable prefix includes:

- the assistant role and boundaries;
- the firm's citation style;
- safety and confidentiality rules;
- the tool definitions for case search, contract search, and memo lookup;
- answer formatting rules;
- a short list of examples that rarely changes.

The dynamic suffix includes:

- the specific lawyer question;
- retrieved snippets;
- matter-specific instructions;
- jurisdiction filters;
- the user's requested output format.

A request builder can enforce that ordering. The code below uses a stable prefix function and passes `prompt_cache_key` so requests with common prefixes route consistently:

```typescript
import OpenAI from "openai";

const openai = new OpenAI();

function stableLegalPrefix(policyVersion: string) {
  return [
    `CaseLens legal research assistant policy ${policyVersion}`,
    "Write concise research notes for licensed legal professionals.",
    "Use citations from provided sources only.",
    "Flag uncertainty clearly.",
    "Respect matter boundaries and tenant data controls.",
    "When source support is weak, ask for human review.",
  ].join("\n");
}

export async function answerResearchQuestion(input: {
  tenantId: string;
  matterId: string;
  policyVersion: string;
  jurisdiction: string;
  question: string;
  retrievedSnippets: string[];
}) {
  const response = await openai.responses.create({
    model: "gpt-5.4-mini",
    reasoning: { effort: "low" },
    prompt_cache_key: `tenant:${input.tenantId}:policy:${input.policyVersion}`,
    input: [
      { role: "system", content: stableLegalPrefix(input.policyVersion) },
      {
        role: "user",
        content: [
          `Matter: ${input.matterId}`,
          `Jurisdiction: ${input.jurisdiction}`,
          "Retrieved sources:",
          ...input.retrievedSnippets,
          "Question:",
          input.question,
        ].join("\n\n"),
      },
    ],
  });

  return {
    answer: response.output_text,
    usage: response.usage,
  };
}
```

The important detail is the split. Stable instructions live in `stableLegalPrefix`. The lawyer question and retrieved snippets arrive later. If the team edits the policy text for every matter, the prefix changes and prompt cache hits drop. If the team places the question before the instructions, every user question changes the prefix and the cache loses value.

CaseLens logs cached token counts after each response:

```typescript
export function logPromptCacheUsage(response: {
  usage?: {
    input_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}) {
  const inputTokens = response.usage?.input_tokens ?? 0;
  const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheRatio = inputTokens === 0 ? 0 : cachedTokens / inputTokens;

  console.log({
    event: "llm.prompt_cache",
    inputTokens,
    cachedTokens,
    cacheRatio,
  });
}
```

In production, that log should go to metrics. A falling cache ratio after a prompt release tells you the stable prefix changed, a tool schema changed too often, or requests are spread across too many prefix variations.

![CaseLens prompt caching keeps stable legal instructions before dynamic matter facts.](/content-assets/articles/article-mlops-llmops-caching-and-limits/caching-prompt-cache.png)

*CaseLens puts shared legal instructions first, keeps matter-specific facts later, and measures cached tokens inside tenant boundaries.*

## Exact Result Caching: Reuse Identical Safe Answers

<!-- section-summary: Exact result caching stores the final answer for a fully identical safe request. The key must include tenant, matter, corpus version, policy version, route, and normalized question text. -->

Provider prompt caching saves prefill work, while exact result caching saves the whole model call. If the same lawyer asks the same question over the same document corpus, CaseLens can return the previous answer quickly. The cache key needs to describe every fact that affects the answer.

An exact result cache key should include:

- tenant ID;
- matter ID;
- normalized question hash;
- jurisdiction;
- corpus version;
- policy version;
- model route;
- answer format;
- permission scope.

The corpus version is especially important. If a new brief, deposition, or memo enters the matter, the old answer may be stale. CaseLens increments a corpus version whenever the retrieval index changes. That version goes into the key, so a refreshed corpus naturally misses the cache and produces a new answer.

Here is a Python sketch using Redis with an explicit TTL. Redis supports key expiration and TTL inspection, which makes it a common fit for short-lived result caches:

```python
import hashlib
import json
from dataclasses import dataclass
from redis import Redis

redis = Redis.from_url("redis://caselens-cache:6379/0", decode_responses=True)

@dataclass(frozen=True)
class ResearchCacheKey:
    tenant_id: str
    matter_id: str
    jurisdiction: str
    corpus_version: str
    policy_version: str
    route: str
    permission_scope: str
    question: str

def normalize_question(question: str) -> str:
    return " ".join(question.strip().lower().split())

def cache_key(parts: ResearchCacheKey) -> str:
    normalized = normalize_question(parts.question)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return ":".join([
        "research_answer",
        parts.tenant_id,
        parts.matter_id,
        parts.jurisdiction,
        parts.corpus_version,
        parts.policy_version,
        parts.route,
        parts.permission_scope,
        digest,
    ])

def get_cached_answer(parts: ResearchCacheKey) -> dict | None:
    raw = redis.get(cache_key(parts))
    return json.loads(raw) if raw else None

def set_cached_answer(parts: ResearchCacheKey, answer: dict, ttl_seconds: int = 900) -> None:
    payload = json.dumps(answer, separators=(",", ":"))
    redis.set(cache_key(parts), payload, ex=ttl_seconds)
```

A 15-minute TTL is a reasonable starting point for live research answers because document state and user instructions can move quickly. A longer TTL may fit public-law explanations over a fixed corpus. A shorter TTL may fit active litigation where new facts arrive throughout the day.

The cache payload should include source IDs, answer text, model route, prompt policy version, created time, and a short validation status. It should avoid storing raw privileged prompts unless the tenant's storage policy allows it. Many enterprise systems encrypt cache payloads with tenant-specific keys and store only hashes in shared infrastructure.

## Semantic Caching: Reuse Similar Questions Carefully

<!-- section-summary: Semantic caching can save near-duplicate work, but the risk is higher than exact caching. Use it only for approved routes, tight similarity thresholds, tenant boundaries, and citation-compatible answers. -->

Semantic caching stores embeddings for previous questions and searches for a similar cached request when a new question arrives. It can help when users ask the same thing in different words. For CaseLens, "Summarize the indemnity clause in section 8" and "What does section 8 say about indemnification?" may be close enough to reuse a cached summary if the matter, document version, permission scope, and answer format all match.

Semantic caching is risky because similar wording can hide different legal meaning. "Can we enforce this clause?" and "Can the other side enforce this clause?" may look close in vector space while requiring different analysis. That is why CaseLens uses semantic caching only for low-risk summarization routes, never for final legal conclusions, safety-sensitive advice, or cross-document conflict analysis.

The semantic cache flow has four gates:

1. The route must allow semantic reuse.
2. Tenant, matter, corpus version, jurisdiction, and permission scope must match exactly.
3. Vector similarity must pass a strict threshold.
4. The cached answer must include citations that still exist in the current corpus version.

Here is a simplified TypeScript interface:

```typescript
type SemanticCacheHit = {
  answer: string;
  sourceIds: string[];
  similarity: number;
  cacheKey: string;
};

type SemanticCacheInput = {
  tenantId: string;
  matterId: string;
  corpusVersion: string;
  permissionScope: string;
  route: "clause_summary" | "research_note" | "policy_reasoning";
  question: string;
};

const SEMANTIC_CACHE_ALLOWED = new Set(["clause_summary"]);

export async function maybeUseSemanticCache(
  input: SemanticCacheInput,
  embed: (text: string) => Promise<number[]>,
  search: (vector: number[], filters: Record<string, string>) => Promise<SemanticCacheHit | null>,
) {
  if (!SEMANTIC_CACHE_ALLOWED.has(input.route)) {
    return null;
  }

  const vector = await embed(input.question);
  const hit = await search(vector, {
    tenantId: input.tenantId,
    matterId: input.matterId,
    corpusVersion: input.corpusVersion,
    permissionScope: input.permissionScope,
    route: input.route,
  });

  if (!hit || hit.similarity < 0.94) {
    return null;
  }

  return {
    answer: hit.answer,
    cacheKey: hit.cacheKey,
    similarity: hit.similarity,
    sourceIds: hit.sourceIds,
  };
}
```

Redis and other vector stores can index vectors with metadata filters, which is useful for this pattern. CaseLens also keeps a kill switch for semantic hits. If reviewers find a bad reuse incident, the team can disable semantic caching for the affected route while keeping exact caching and prompt caching active.

![CaseLens reuse gates require tenant, matter, corpus version, and citation checks before cache hits.](/content-assets/articles/article-mlops-llmops-caching-and-limits/caching-reuse-gates.png)

*Semantic reuse only passes when tenant, matter, corpus version, and citations all match the legal context.*

## Rate Limits, Quotas, And Backpressure

<!-- section-summary: Provider rate limits set the outer API boundary, while product quotas divide capacity fairly inside your application. Backpressure tells callers to wait, retry later, or move work to a queue. -->

Rate limits define how much traffic can reach a provider or route during a time window. OpenAI rate limits vary by model and can apply at organization and project levels. Long-context models can have separate long-context limits, and usage limits also cap monthly spend. Your product needs its own layer on top because provider limits do not know which law firm, matter, feature, or user should get priority.

CaseLens uses these limits:

```yaml
limits:
  tenant:
    default_daily_budget_cents: 30000
    enterprise_daily_budget_cents: 250000
  user:
    live_requests_per_minute: 12
    background_jobs_per_hour: 20
  matter:
    live_tokens_per_minute: 180000
    background_tokens_queued: 4000000
  route:
    clause_summary:
      max_context_tokens: 16000
      max_output_tokens: 900
    research_note:
      max_context_tokens: 64000
      max_output_tokens: 2500
    policy_reasoning:
      max_context_tokens: 32000
      max_output_tokens: 1800
```

Backpressure is the product response when a limit is close or exceeded. CaseLens uses three responses:

- live requests get a short retry-after response when the user is above their burst limit;
- background jobs go into a queue when the provider has headroom later;
- large jobs offer a lower-cost batch mode with a completion window.

The following Python limiter shows the shape. It uses separate keys for user and matter so you can protect both individual behavior and shared matter capacity:

```python
import time
from redis import Redis

redis = Redis.from_url("redis://caselens-cache:6379/1", decode_responses=True)

def allow_counter(key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    bucket = int(time.time() // window_seconds)
    redis_key = f"limit:{key}:{bucket}"
    count = redis.incr(redis_key)
    if count == 1:
        redis.expire(redis_key, window_seconds + 5)
    remaining = max(0, limit - count)
    return count <= limit, remaining

def check_live_request(user_id: str, matter_id: str) -> dict:
    user_ok, user_remaining = allow_counter(f"user:{user_id}:rpm", 12, 60)
    matter_ok, matter_remaining = allow_counter(f"matter:{matter_id}:rpm", 200, 60)

    if user_ok and matter_ok:
        return {"allowed": True, "remaining": min(user_remaining, matter_remaining)}

    return {
        "allowed": False,
        "retry_after_seconds": 60,
        "reason": "live research limit reached",
    }
```

Production limiters often use sliding windows, token buckets, or managed API gateway quotas. The important idea stays the same: check the limit before creating expensive model work, and give the caller a clear path forward.

## Batch And Background Work

<!-- section-summary: Legal assistants often mix live chat with large offline work. Batch and lower-priority processing move document-scale tasks away from the live path and help control cost. -->

CaseLens has two types of work. Live research needs an answer while the lawyer is reading. Background work can wait: summarize 3,000 contracts, label clauses overnight, run an eval suite, or prepare a matter notebook. The production design should keep those paths separate.

OpenAI's Batch API is designed for asynchronous groups of requests with a separate rate-limit pool and a 24-hour turnaround target. Flex processing offers lower costs for slower, lower-priority Responses or Chat Completions requests, with model availability limits. Those features fit legal background work such as nightly document labeling or large eval runs.

A batch item for clause classification might look like this:

```json
{"custom_id":"matter-842:contract-001:clause-12","method":"POST","url":"/v1/responses","body":{"model":"gpt-5.4-mini","input":"Classify this clause by type and risk level:\n\n<clause text>","text":{"format":{"type":"json_schema","name":"clause_risk","schema":{"type":"object","additionalProperties":false,"properties":{"clauseType":{"type":"string"},"risk":{"type":"string","enum":["low","medium","high"]},"reason":{"type":"string"}},"required":["clauseType","risk","reason"]},"strict":true}}}}
```

The application should write one JSONL line per request, upload the file, create the batch, and store the batch ID with matter metadata. When the batch completes, the worker reads results, validates schema, stores outputs with corpus version, and updates progress for the matter.

Background workers also need quotas. CaseLens limits queued background tokens per matter and per tenant. It also pauses background work when live traffic uses too much provider headroom. This is a common production pattern: live work has the shortest path, background work uses spare capacity, and eval jobs run in lower-priority windows.

## Circuit Breakers And Graceful Degradation

<!-- section-summary: Circuit breakers pause unhealthy routes before they hurt every user. Graceful degradation offers a smaller response, a queued job, or a human handoff instead of repeated expensive failures. -->

A circuit breaker watches error rate, timeout rate, rate-limit responses, and fallback rate. When a route crosses a threshold, the breaker opens and the router stops sending new work to that route for a short period. After a cool-down, a small number of trial requests can check whether the route has recovered.

CaseLens has a circuit breaker for each route:

```yaml
circuit_breakers:
  research_note:
    open_when:
      timeout_rate_5m: 0.12
      provider_error_rate_5m: 0.05
      p95_latency_ms_5m: 12000
    cooldown_seconds: 180
    half_open_trial_requests: 20
    fallback: queue_background_research

  clause_summary:
    open_when:
      timeout_rate_5m: 0.10
      provider_error_rate_5m: 0.04
    cooldown_seconds: 90
    half_open_trial_requests: 50
    fallback: exact_cache_or_retry
```

Graceful degradation is the user-facing plan. For a live research note, CaseLens can say that the full answer is queued and provide a short list of retrieved sources. For a clause summary, it can return an exact cached result if one exists. For a high-risk legal conclusion, it can ask the user to route the question to a human reviewer.

The key is honesty. A degraded answer should clearly show its state. A lawyer should know whether they are reading a complete model answer, a cached summary, a queued research job, or a retrieval-only preview. Hidden degradation creates trust problems because the user cannot judge the answer correctly.

## Observability And Practical Checks

<!-- section-summary: Cache and limit systems need metrics that show hit rates, token usage, rejection reasons, and fallback paths. Practical review focuses on data isolation, cost control, user fairness, and safe degradation. -->

CaseLens measures cache and limit behavior at every layer:

| Metric | Healthy question |
|---|---|
| `prompt_cache.cached_tokens_ratio` | Are stable prefixes actually stable? |
| `result_cache.hit_rate` | Are identical safe requests reusing answers? |
| `semantic_cache.hit_rate` | Are approved near-duplicates saving work? |
| `semantic_cache.rejection_reason` | Are misses caused by threshold, corpus version, or permissions? |
| `quota.rejected_total` | Which user, matter, tenant, or route is limited? |
| `llm.provider_429_total` | Are app limits failing to protect provider limits? |
| `background_queue.depth` | Are offline jobs piling up? |
| `circuit_breaker.state` | Which route is open, half-open, or closed? |

OpenTelemetry traces should include cache lookup spans, route decisions, provider calls, and fallback paths. Prometheus alerts can watch provider 429s, cache hit-rate drops, and background queue depth. Grafana dashboards can connect high-latency exemplars to traces so the team can inspect the exact request shape that caused a spike.

Use this checklist before shipping caching and limits:

- Every cache key includes tenant, matter, corpus version, permission scope, policy version, and route where they affect the answer.
- Prompt cache logs track `cached_tokens` and cache ratio by route and policy version.
- Exact result caching has TTLs, encryption, and invalidation on corpus updates.
- Semantic caching is limited to low-risk routes with strict thresholds and citation validation.
- Cached results are never shared across tenants or matters.
- App-level quotas protect users, matters, tenants, background queues, and live routes.
- Provider 429s are rare because the app slows traffic earlier.
- Background jobs can move to Batch or Flex-style processing when live latency is unnecessary.
- Circuit breakers have clear fallbacks and cool-down behavior.
- Degraded responses are visible to the user or reviewer.

Common mistakes include caching without corpus versions, sharing semantic hits too broadly, logging full privileged prompts in shared observability tools, and retrying rate-limited requests without backoff. Another common mistake is treating prompt caching as a replacement for app-level limits. Prompt caching can reduce latency and input-token cost for repeated prefixes, while rate-limit pressure and product fairness still need separate controls.

Interview-ready understanding sounds like this: prompt caching speeds up repeated long prefixes, exact result caching reuses identical safe answers, semantic caching reuses near-duplicate approved requests, and limits protect fairness and provider headroom. In sensitive domains such as legal research, cache keys and retention rules are part of the security design. A good system makes reuse measurable, bounded, revocable, and traceable.

![CaseLens control stack separates safe reuse, fair limits, clear degradation, and observability.](/content-assets/articles/article-mlops-llmops-caching-and-limits/caching-control-stack.png)

*The control stack separates safe reuse, fair limits, and clear degradation so legal research stays bounded and auditable.*

## References

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI Batch API](https://developers.openai.com/api/docs/guides/batch)
- [OpenAI Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
- [OpenAI API deployment checklist](https://developers.openai.com/api/docs/guides/deployment-checklist)
- [Redis TTL command](https://redis.io/docs/latest/commands/ttl/)
- [Redis SET command](https://redis.io/docs/latest/commands/set/)
- [Redis vector search concepts](https://redis.io/docs/latest/develop/ai/search-and-query/vectors/)
- [OpenTelemetry documentation](https://opentelemetry.io/docs/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Grafana exemplars](https://grafana.com/docs/grafana/latest/fundamentals/exemplars/)
