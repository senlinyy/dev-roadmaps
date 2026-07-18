---
title: "Caching Predictions"
description: "Use cached inference results safely by choosing stable inputs, versioned cache keys, TTLs, invalidation rules, and monitoring."
overview: "Prediction caching reuses model outputs within an explicit equivalence and freshness boundary. This article explains eligibility, identity, expiry, invalidation, isolation, failure behavior, and quality monitoring."
tags: ["MLOps", "advanced", "performance"]
order: 2
id: "article-mlops-model-serving-caching-predictions"
---

## Prediction Caching Trades Freshness For Speed
<!-- section-summary: Prediction caching stores model outputs for repeated inputs so serving can answer faster, with a clear freshness boundary. -->

**Prediction caching** stores an inference result and reuses it when the same safe request appears again. The cache can reduce latency, cost, and load on the model server. It works best when many users ask for the same answer, the answer stays useful for a short period, and the product can tolerate a defined freshness window.

You already know the basic serving path: a request enters an API, the service builds features, the model scores the input, and the API returns a response. Caching adds a short question before model scoring: "Have we already scored this exact safe input with this exact model and feature version?" If yes, the service can return the stored prediction. If no, it scores the model and stores the result for next time.

Caching is powerful because many ML products repeat work. A travel site might rank the same hotel search many times. A content platform might score the same article for the same region. A catalog search system might embed the same product image again after retries. A batch recommendation endpoint might receive duplicate requests from upstream jobs.

The risk is stale or unsafe reuse. If you cache a prediction after the user changes, the inventory changes, or the model changes, the product may return the wrong answer. That is why prediction caching needs versioned keys, TTLs, invalidation rules, and monitoring.

A cache design has six responsibilities. **Eligibility** defines which predictions may be reused at all. **Equivalence** defines when two requests mean the same thing. **Version identity** binds the result to the model, feature, policy, and schema versions that produced it. **Freshness** sets time-to-live and event-driven invalidation. **Isolation and failure behavior** prevent cross-user leakage and define what happens when the cache is unavailable. **Quality monitoring** checks hit rate alongside stale-result and outcome risk. Redis or another store implements lookup and expiry, while these responsibilities determine whether reuse is correct.

The key is a claim about equivalence, not merely a hash. Omitting a personalization field claims that it cannot change the answer. Omitting the model version claims that old and new releases are interchangeable. A long TTL claims that the relevant world stays stable for that duration. Each omission should therefore be justified by product semantics and tested during changes.

## A Search Ranking Cache As A Supporting Example
<!-- section-summary: A travel-search example shows when repeated ranking requests can safely reuse a narrow, short-lived result. -->

Imagine **TripNest**, a travel marketplace. Users search for hotels with a city, dates, guest count, filters, and sort preferences. The ranking service calls a model named `hotel_search_ranker` to order candidate hotels. During popular travel windows, thousands of users search the same city and dates within minutes.

The online serving path looks like this:

```plaintext
search-api -> candidate-service -> feature-service -> ranker-api -> model-server
```

The model scores 250 hotel candidates per request. Its 95th-percentile latency, abbreviated **p95**, should stay below 450 ms; this means 95 percent of requests should finish within that time. During weekend sale traffic, p95 rises above 900 ms because the same Paris and Barcelona searches repeat across users. The platform team wants a cache that protects the model server without hiding stale inventory or pricing.

TripNest decides to cache only anonymous search ranking results for short windows. Personalized loyalty offers, user-specific discounts, payment risk, and hotel availability checks stay outside the cache. The cache stores the ranking order and model metadata. The final product response still calls the pricing and availability service before showing bookable rooms.

That separation keeps the cached result narrow:

```yaml
cache_policy:
  endpoint: /v1/search/rank
  cached_result: ranked_hotel_ids_and_model_scores
  ttl_seconds: 300
  excluded_inputs:
    - user_id
    - loyalty_tier
    - private_discount
    - payment_risk_score
  live_checks_after_cache:
    - room_availability
    - current_price
    - cancellation_policy
```

![TripNest hotel search cache hit and miss path](/content-assets/articles/article-mlops-model-serving-caching-predictions/tripnest-cache-serving-path.png)

*The cache accelerates the narrow ranking output while price and availability still run live before TripNest shows rooms to the shopper.*

The model cache accelerates ranking. It does not replace the final booking checks.

## Decide What Can Be Cached
<!-- section-summary: A prediction is safe to cache only when the input, output, freshness window, and user impact are clear. -->

Before you add Redis or any other cache, decide what kind of prediction you are dealing with. Some predictions are good cache candidates. Some need live scoring every time.

Use this table during design review:

| Prediction type | Cache fit | Reason |
|---|---|---|
| Anonymous search ranking | Strong fit | Many users repeat the same city/date/filter search |
| Product image embedding | Strong fit | Same image and model version produce the same vector |
| Fraud authorization | Weak fit | User, device, merchant, and recent attempts change quickly |
| Medical triage | Weak fit | Safety and audit requirements usually favor live evaluation |
| Demand forecast by store/day | Medium fit | Forecast can be cached after the forecast window is defined |
| LLM response for public FAQ | Medium fit | Prompt and retrieval context must be versioned carefully |

TripNest chooses search ranking because the repeated request shape is clear. A cache hit can save work without deciding whether a hotel is still available. The risky live parts stay live.

The design review should answer these questions:

| Question | TripNest answer |
|---|---|
| What exact output is cached? | Ordered hotel IDs and model scores |
| How fresh must it be? | Five minutes for sale traffic |
| What inputs define the result? | City, dates, guest count, filters, candidate set, feature snapshot, model version |
| What inputs are excluded? | User identity, loyalty offers, payment risk |
| What must still run live? | Price, availability, and final eligibility |
| How can the cache be bypassed? | Request header and feature flag |

That review prevents a common mistake: caching a broad API response that contains personalized or fast-changing fields. Cache the narrow prediction when possible.

## Build A Versioned Cache Key
<!-- section-summary: The cache key must include every stable input that can change the prediction. -->

The cache key is the most important part of prediction caching. If the key is too small, the service can return a prediction for the wrong input. If the key is too large, the cache never hits.

TripNest builds the key from normalized search inputs, candidate IDs, feature view versions, and model version:

```python
import hashlib
import json


def stable_hash(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:24]


def ranking_cache_key(request, candidates, feature_versions, model_version: str) -> str:
    payload = {
        "city": request.city.lower().strip(),
        "check_in": request.check_in.isoformat(),
        "check_out": request.check_out.isoformat(),
        "guests": request.guests,
        "filters": sorted(request.filters),
        "candidate_ids": sorted(candidates.hotel_ids),
        "feature_versions": feature_versions,
        "model_version": model_version,
        "schema_version": "ranker-cache-v3",
    }
    return f"hotel-ranker:{stable_hash(payload)}"
```

The model version belongs in the key. When TripNest moves the production alias from version `18` to version `19`, the new model automatically uses new keys. The old cached responses can expire naturally.

The feature versions matter too. If the `hotel_quality_score` feature view changes from `v11` to `v12`, the same city and dates may score differently. The cache key should carry the feature version or feature snapshot ID. That makes the cache safer during feature releases.

Do not put raw personal data in the key. If a cache truly needs user-specific state, hash only the stable identifier you need, store the cache in a protected namespace, and review privacy requirements. For TripNest, the safer decision is to keep user-specific ranking outside this shared cache.

![TripNest versioned cache key builder](/content-assets/articles/article-mlops-model-serving-caching-predictions/versioned-cache-key.png)

*The versioned key includes request-defining inputs, candidate IDs, feature versions, model version, and schema version so a hit matches the scored input.*

## Use TTLs And Invalidation Rules
<!-- section-summary: TTLs set the normal freshness window, while invalidation handles model, feature, and product changes. -->

A **TTL**, or time to live, says how long a cached prediction can be reused. TripNest starts with five minutes because search demand repeats heavily during sale traffic, while hotel inventory and price can change. The final availability check still runs live, so the ranking cache can tolerate a short window.

The TTL should come from product risk:

| Use case | Typical TTL shape |
|---|---|
| Product embedding by image hash | Hours or days, tied to model version |
| Anonymous search ranking | Minutes |
| Batch recommendation preview | Minutes to hours |
| Fraud decision | Usually live scoring |
| Support routing suggestion | Minutes, with queue-specific freshness |

TTL alone is not enough. You also need invalidation rules. TripNest invalidates or bypasses cache when:

- The model production alias changes.
- A feature view version changes.
- A hotel candidate set changes materially.
- A high-risk incident flag is active.
- A user sends `Cache-Control: no-cache` through an internal debug tool.

A small release checklist keeps this visible:

```yaml
cache_release_checklist:
  model_version_in_key: true
  feature_versions_in_key: true
  schema_version_in_key: ranker-cache-v3
  ttl_seconds: 300
  bypass_flag: ranker_cache_bypass
  incident_disable_flag: disable_hotel_ranker_cache
  owner: search-platform
```

If your serving stack uses a feature flag platform, keep cache bypass as a separate flag from model rollback. During an incident, you may want to keep the model online and disable only the cache.

## Add A Redis Cache Around Inference
<!-- section-summary: A Redis-style cache wraps the model call with a safe key, a short TTL, and clear hit/miss logging. -->

Redis is a common choice for low-latency cache storage. The same design can work with another managed cache, but Redis-style commands make the workflow easy to see.

Here is a compact FastAPI-style cache wrapper:

:::expand[Implement the complete Redis cache path]{kind="example"}

```python
import json
import time

from redis.asyncio import Redis


async def rank_hotels(request, redis: Redis, model_client, feature_client):
    candidates = await load_candidates(request)
    feature_versions = await feature_client.current_versions(["hotel_quality", "city_demand"])
    model_version = await model_client.production_version("hotel_search_ranker")
    cache_key = ranking_cache_key(request, candidates, feature_versions, model_version)

    started = time.perf_counter()
    try:
        cached = await redis.get(cache_key)
    except Exception as exc:
        record_cache_error(operation="get", error=type(exc).__name__)
        cached = None
    if cached:
        payload = json.loads(cached)
        log_prediction_cache(
            request_id=request.request_id,
            cache_key=cache_key,
            cache_hit=True,
            model_version=payload["model_version"],
            latency_ms=(time.perf_counter() - started) * 1000,
        )
        return payload["ranking"]

    lock_key = f"{cache_key}:fill-lock"
    owns_fill = False
    try:
        owns_fill = bool(await redis.set(lock_key, request.request_id, nx=True, ex=10))
    except Exception as exc:
        record_cache_error(operation="lock", error=type(exc).__name__)

    if not owns_fill:
        await asyncio.sleep(0.05 + random.random() * 0.05)
        try:
            filled = await redis.get(cache_key)
        except Exception:
            filled = None
        if filled:
            return json.loads(filled)["ranking"]

    features = await feature_client.fetch_online_features(request, candidates.hotel_ids)
    ranking = await model_client.score(features)

    payload = {
        "model_version": model_version,
        "feature_versions": feature_versions,
        "ranking": ranking,
        "created_at_ms": int(time.time() * 1000),
    }
    try:
        await redis.set(cache_key, json.dumps(payload), ex=300)
    except Exception as exc:
        record_cache_error(operation="set", error=type(exc).__name__)
    finally:
        if owns_fill:
            await release_lock_if_owned(redis, lock_key, request.request_id)

    log_prediction_cache(
        request_id=request.request_id,
        cache_key=cache_key,
        cache_hit=False,
        model_version=model_version,
        latency_ms=(time.perf_counter() - started) * 1000,
    )
    return ranking
```

:::

The wrapper assumes `asyncio`, `random`, and a small compare-and-delete `release_lock_if_owned` helper are available. The `try` blocks implement **failure-open** behavior: if Redis is unavailable, the request still reaches the model path. That choice fits ranking because a fresh prediction is safe, although it can increase model load. The service pairs it with concurrency limits and a circuit breaker so a cache outage cannot overwhelm the model server.

The short fill lock controls a **cache stampede**, where many requests miss the same key and all run the expensive model call. One request owns the fill; other requests wait with jitter and check once more. If the result still has not appeared, they compute normally so a lost lock cannot stall users. The owner token prevents one request from deleting a lock acquired later by another request after expiry.

The wrapper logs hit and miss events. Those logs help answer operational questions later:

- Is the cache actually reducing model calls?
- Are cache hits faster than model calls?
- Which model version created the cached result?
- Did a recent release change hit rate?
- Did a cache incident affect one city or every city?

TripNest stores cache metadata in structured logs and prediction logs:

```json
{
  "event": "prediction_cache",
  "request_id": "req_84d9",
  "endpoint": "/v1/search/rank",
  "cache_hit": true,
  "model_name": "hotel_search_ranker",
  "model_version": "19",
  "cache_key_prefix": "hotel-ranker",
  "ttl_seconds": 300,
  "latency_ms": 41,
  "trace_id": "4c1a9d2f9a"
}
```

Do not log the full cache key when it can reveal sensitive input details. A prefix, hash, and request ID usually provide enough debugging context.

## Monitor Cache Quality
<!-- section-summary: Cache monitoring should track hit rate, latency, fallback behavior, stale-risk signals, and model-server load. -->

Cache monitoring has two sides. The first side is system performance: hit rate, latency, Redis errors, and model-server load. The second side is prediction quality: rejection rate, downstream conversion, availability misses, or support tickets.

TripNest tracks these metrics:

| Metric | Why it matters |
|---|---|
| `prediction_cache_hit_rate` | Shows whether the cache earns its complexity |
| `prediction_cache_latency_ms` | Shows whether Redis remains faster than model scoring |
| `prediction_cache_error_rate` | Shows cache store or serialization failures |
| `model_server_request_rate` | Should drop during repeated searches |
| `availability_recheck_fail_rate` | Shows cached rankings that point at unavailable hotels |
| `search_conversion_rate` | Product guardrail |
| `cache_bypass_rate` | Shows incidents or debug traffic |

A Prometheus-style hit-rate query might look like this:

```promql
sum(rate(prediction_cache_requests_total{endpoint="/v1/search/rank", result="hit"}[5m]))
/
sum(rate(prediction_cache_requests_total{endpoint="/v1/search/rank"}[5m]))
```

A latency comparison helps prove the cache still helps:

```promql
histogram_quantile(
  0.95,
  sum(rate(prediction_request_duration_seconds_bucket{path="/v1/search/rank"}[5m])) by (le, cache_result)
)
```

Alerts should focus on user impact. Page the on-call engineer when cache errors cause request failures or when cached rankings create a sharp availability recheck failure. Create a ticket when hit rate falls after a release, because that is often a key-design issue rather than an outage.

## Failure Modes
<!-- section-summary: Prediction caches fail through stale keys, missing version fields, overbroad responses, and hidden quality regressions. -->

Prediction caches usually fail in familiar ways.

| Failure mode | Symptom | Fix |
|---|---|---|
| Missing model version in key | New release returns old predictions | Add model version or alias target to key |
| Missing feature version in key | Feature release changes scores under same key | Add feature view versions |
| Overbroad cached response | User-specific offers leak or go stale | Cache only narrow model output |
| TTL too long | Product shows stale ranking | Shorten TTL and add invalidation |
| TTL too short | Cache adds complexity with few hits | Increase TTL or remove cache |
| No bypass flag | Incident response is slow | Add runtime cache-disable flag |
| No hit/miss logs | Team cannot explain behavior | Log cache metadata with request traces |
| Redis outage fails the endpoint | Search returns errors although the model works | Fail open, cap model concurrency, and alert on cache errors |
| Hot-key cache stampede | Model request rate spikes when one popular key expires | Use a short per-key fill lock, jitter, and stale-if-safe policy |

The safest review question is simple: "What would make this cached answer wrong?" For TripNest, wrong answers come from model version changes, feature changes, candidate set changes, and fast-moving availability. The design handles those by keying model and feature versions, hashing candidates, keeping TTL short, and running live availability checks after ranking.

## Putting It Together
<!-- section-summary: Safe prediction caching starts with a narrow output, a complete key, a clear TTL, and production monitoring. -->

Caching predictions can make serving faster and cheaper when repeated requests use stable inputs. TripNest used caching for anonymous hotel search ranking because many users repeat the same city and date searches during sale traffic. The cache stores ranked IDs and model scores, while price and availability still run live.

The workflow is straightforward. Choose a prediction where reuse is safe. Define the exact cached output. Build a cache key from normalized inputs, candidate IDs, feature versions, model version, and schema version. Set a TTL that matches product freshness. Add invalidation and bypass flags. Log hit and miss events. Monitor latency, hit rate, model-server load, and product-quality guardrails.

![TripNest cache runbook for TTL, invalidation, monitoring, and response actions](/content-assets/articles/article-mlops-model-serving-caching-predictions/cache-runbook-ttl-invalidation.png)

*The cache runbook ties TTL, release invalidation, monitoring, and the bypass flag to the same operational workflow.*

A cache is a serving feature, not only an infrastructure trick. It changes how predictions reach users. Treat it with the same release discipline as a model version: review the policy, record the evidence, monitor the result, and keep a fast off switch.

## References

- [Redis SET command](https://redis.io/docs/latest/commands/set/)
- [Redis key expiration](https://redis.io/docs/latest/commands/expire/)
- [Redis distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [FastAPI lifespan events](https://fastapi.tiangolo.com/advanced/events/)
- [OpenTelemetry HTTP metrics semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
