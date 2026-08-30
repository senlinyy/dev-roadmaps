---
title: "Caching Predictions"
description: "Reuse selected inference results safely with complete cache identities, explicit freshness budgets, isolation, stampede control, and release tests."
overview: "Prediction caching can remove repeated inference work, yet every cache hit makes a strong claim that the stored result remains equivalent, fresh, and safe for the current request. Production Redis or Valkey designs must preserve that claim."
tags: ["MLOps", "advanced", "performance"]
order: 2
id: "article-mlops-model-serving-caching-predictions"
---

## Table of Contents

1. [When Are Two Prediction Requests the Same Reusable Computation?](#when-are-two-prediction-requests-the-same-reusable-computation)
2. [How Do Freshness, Determinism, Security, and Versioning Define Cache Validity?](#how-do-freshness-determinism-security-and-versioning-define-cache-validity)
3. [How Do Cache Placement, Coalescing, Locks, Expiration, and Negative Results Work Safely?](#how-do-cache-placement-coalescing-locks-expiration-and-negative-results-work-safely)
4. [What Can Be Cached for Embeddings, Ranking, RAG, and Tool-Using Models?](#what-can-be-cached-for-embeddings-ranking-rag-and-tool-using-models)
5. [How Do Cache Failure, Memory, Popularity, and Admission Affect Capacity?](#how-do-cache-failure-memory-popularity-and-admission-affect-capacity)
6. [How Do You Measure Cache Correctness, Performance, Serialization, and Release Impact?](#how-do-you-measure-cache-correctness-performance-serialization-and-release-impact)
7. [How Do You Test Cold, Invalidated, Uncached, and Stampede Paths?](#how-do-you-test-cold-invalidated-uncached-and-stampede-paths)
8. [What Checklist and Mental Model Support an Exact Prediction Cache?](#what-checklist-and-mental-model-support-an-exact-prediction-cache)
9. [Check Your Answers](#check-your-answers)

An embedding service receives the same normalized document twice. Recomputing the vector wastes resources. A support chatbot receives the same prompt text from two customers with different conversation history and permissions; reusing one answer could be wrong or expose data.

A **prediction cache** reuses earlier inference only when the new request represents the same valid computation. That identity includes canonical input, model and configuration versions, freshness, determinism, tenant and authorization scope, and external dependencies. The cache also becomes part of capacity and failure behaviour.

These questions move from defining a safe key to operating, measuring, and testing the cache under real releases and load:

1. **When Are Two Prediction Requests the Same Reusable Computation?**
2. **How Do Freshness, Determinism, Security, and Versioning Define Cache Validity?**
3. **How Do Cache Placement, Coalescing, Locks, Expiration, and Negative Results Work Safely?**
4. **What Can Be Cached for Embeddings, Ranking, RAG, and Tool-Using Models?**
5. **How Do Cache Failure, Memory, Popularity, and Admission Affect Capacity?**
6. **How Do You Measure Cache Correctness, Performance, Serialization, and Release Impact?**
7. **How Do You Test Cold, Invalidated, Uncached, and Stampede Paths?**
8. **What Checklist and Mental Model Support an Exact Prediction Cache?**

## When Are Two Prediction Requests the Same Reusable Computation?
<!-- section-summary: A reusable prediction is a function of canonicalized input plus every model, configuration, policy, tenant, and dependency value that affects semantics. -->

Caching is safe only after the service can define when a second request represents the same prediction computation.

Prediction caching starts with a simple observation:

> Model inference is often expensive, but sometimes two requests are asking for the **same computation**.

If the answer to the second request would be identical—or sufficiently equivalent—to an answer we already computed, running the model again wastes resources. So instead of:

$$
\text{request}
\rightarrow
\text{model}
\rightarrow
\text{prediction}
$$

we can sometimes do:

$$
\text{request}
\rightarrow
\text{cache}
\rightarrow
\text{previous prediction}.
$$

The difficult part isn't storing predictions. The difficult part is determining:

$$
\boxed{\text{When is an old prediction still a valid answer to this new request?}}
$$

Almost every caching design decision follows from that question. Imagine a model prediction as:

$$
y = F(x)
$$

where:

* $$x$$ = request
* $$F$$ = model
* $$y$$ = prediction

If two requests contain the same $$x$$, then perhaps:

$$
F(x)=F(x)
$$

and we can reuse the result. But real serving systems are almost never that simple. A more realistic prediction is something like:

$$
y =
F(
x,
M,
P,
C,
R,
S
)
$$

where:

* $$x$$ = user input
* $$M$$ = model and model version
* $$P$$ = inference parameters
* $$C$$ = preprocessing/configuration
* $$R$$ = external state such as retrieved documents
* $$S$$ = security or tenant scope

Two requests are safely cache-equivalent only if every input capable of changing the valid prediction is equivalent. This is the foundation of prediction caching. Without caching:

$$
\text{every request} \rightarrow \text{inference}.
$$

If inference costs 500 ms and $0.002:

```text
10 identical requests
→ 10 model executions
→ 5 seconds of model work
→ $0.020
```

With a cache:

```text
first request
→ model execution
→ cache result

next 9 requests
→ cache hits
```

You might now perform approximately:

$$
1
$$

expensive inference instead of:

$$
10.
$$

That can improve:

* latency;
* throughput;
* accelerator utilization;
* cost;
* resilience during traffic spikes.

But something much deeper has changed. Originally, the model determines every response. After introducing caching:

$$
\boxed{\text{cache correctness becomes part of prediction correctness}}
$$

A bug in the cache key can now return the wrong model output even when the model itself works perfectly. Caching moves some correctness responsibility from the model to the serving infrastructure. For every cacheable request, there are two paths.

### Cache hit

The system finds a reusable prediction:

$$
\text{request}
\rightarrow
\text{cache}
\rightarrow
\text{prediction}.
$$

Suppose:

$$
L_{\text{cache}}=5ms.
$$

### Cache miss

No reusable result exists:

$$
\text{request}
\rightarrow
\text{cache}
\rightarrow
\text{model}
\rightarrow
\text{cache write}.
$$

Suppose:

$$
L_{\text{model}}=500ms.
$$

Caching helps when enough requests hit. If the hit ratio is:

$$
h=0.8,
$$

then a simplified average latency might be:

$$
E[L]
=
hL_{\text{hit}}
+
(1-h)L_{\text{miss}}.
$$

Using:

$$
L_{\text{hit}}=5ms
$$

and

$$
L_{\text{miss}}=505ms,
$$

we get:

$$
E[L]
=
0.8(5)+0.2(505)
=
105ms.
$$

Caching reduced average latency from roughly 500 ms to 105 ms. Suppose you cache an LLM workload. You have:

* 90 tiny requests;
* 10 enormous requests.

The 90 tiny requests hit the cache. The 10 expensive requests miss. Your request hit ratio is:

$$
90\%.
$$

That sounds excellent. But perhaps the tiny requests account for only 10% of model compute. Then caching saved only:

$$
10\%
$$

of your actual inference cost. So there are several useful hit rates.

### Request hit rate

$$
H_{\text{requests}}
=
\frac{\text{cache hits}}
{\text{cacheable requests}}.
$$

### Compute-weighted hit rate

Approximately:

$$
H_{\text{compute}}
=
\frac{\text{model work avoided}}
{\text{model work that would otherwise occur}}.
$$

### Cost-weighted hit rate

$$
H_{\text{cost}}
=
\frac{\text{inference cost avoided}}
{\text{uncached inference cost}}.
$$

For model serving, the last two can matter more than ordinary hit ratio. Caching only makes sense if an older prediction remains valid. Consider an embedding model:

```text
input:
"The quick brown fox"
```

If:

* model version is unchanged;
* preprocessing is unchanged;
* embedding settings are unchanged,

the embedding is generally a strong caching candidate. Now consider:

```text
"What is the current GBP/USD exchange rate?"
```

The same text asked tomorrow should not necessarily return yesterday's answer. The input string is identical, but the required answer depends on external state. So:

$$
\boxed{\text{same request bytes} \not\Rightarrow \text{same valid prediction}}
$$

You must identify the complete logical input to the prediction. Suppose you have:

```text
model = sentiment-v3
text = "This product is amazing"
```

You could define prediction identity as:

$$
I =
(
\text{model version},
\text{normalized text}
).
$$

Then:

$$
K = H(I)
$$

where $$H$$ is a hash function and $$K$$ becomes the cache key. But now suppose inference accepts:

```text
threshold = 0.5
```

versus:

```text
threshold = 0.8
```

If that parameter affects the returned response, it belongs in the identity. So perhaps:

$$
I =
(
M,
x,
P
).
$$

If preprocessing also changes behavior:

$$
I =
(
M,
x,
P,
C
).
$$

The rule is:

> **Anything that can legitimately change the output must either appear in the cache identity or make the request non-cacheable.**

A naïve key might be:

```text
cache["hello world"]
```

This is dangerous. What if:

* model v1 produced the cached entry;
* model v2 is now deployed

The cache could silently make model v2 behave like model v1. A safer conceptual key is:

```text
prediction:
  model=model-v2
  preprocessing=prep-v4
  parameters=...
  request=...
```

Usually you serialize these fields canonically and hash them:

$$
K=
H(
M\Vert
P\Vert
C\Vert
x
).
$$

For example:

```text
pred:v2:7f1d2c...
```

The hash isn't what provides correctness. The correctness comes from putting the **correct fields into the hashed identity**. Consider these JSON requests:

```json
{
  "temperature": 0,
  "text": "hello"
}
```

and:

```json
{
  "text": "hello",
  "temperature": 0
}
```

They are semantically identical but byte-wise different. If you hash raw request bytes, they create separate cache entries. That's not a correctness bug, but it wastes cache capacity. You may therefore create a canonical representation:

```text
sort keys
normalize encoding
normalize default parameters
serialize deterministically
hash
```

But normalization must preserve meaning. For example, blindly converting:

```text
"Hello"
```

to:

```text
"hello"
```

would be unsafe for a case-sensitive task. The principle is:

$$
\boxed{\text{Normalize only transformations known not to change prediction semantics.}}
$$

Suppose:

```text
temperature omitted
```

means:

$$
temperature=1
$$

today. Later the application's default becomes:

$$
temperature=0.2.
$$

If the cache key was generated from the raw request alone, an old cached result might remain addressable despite a semantic configuration change. A strong strategy is to convert requests into their fully resolved configuration before computing the key:

```text
requested:
model = X
temperature = omitted

resolved:
model = X
temperature = 1.0
top_p = 1.0
...
```

Then cache the resolved prediction identity. Suppose the model stays the same, but you change tokenization. Old:

```text
tokenizer-v3
```

New:

```text
tokenizer-v4
```

Predictions might change. So tokenizer version belongs conceptually in the prediction identity. Likewise:

* preprocessing version;
* model weights;
* quantization version if behavior can change;
* prompt template;
* system prompt;
* feature transformation;
* retrieval index version;
* ranking feature definitions;
* business rules;
* safety-policy configuration when it affects responses.

A practical pattern is a composite **serving version**:

```text
prediction-schema-v17
```

which changes whenever any relevant semantic component changes.

Then:

$$
K=
H(
\text{prediction-schema-v17}
\Vert
\text{request identity}
).
$$

Imagine you have 100 million old cache entries. A new model deploys. One option is:

scan Redis and delete all 100 million entries.

That can be slow, expensive, and operationally risky. Instead, old keys might be:

```text
prediction:model-v6:...
```

and new requests use:

```text
prediction:model-v7:...
```

Immediately, model v7 cannot read model-v6 predictions. The old entries can simply expire naturally. This is **logical invalidation**. The general pattern is:

$$
\boxed{\text{change namespace} \rightarrow \text{old results become unreachable}}
$$

rather than needing perfect physical deletion at deployment time.

## How Do Freshness, Determinism, Security, and Versioning Define Cache Validity?
<!-- section-summary: Versioning separates semantic generations, TTL limits age, determinism defines equivalence, and authorization and sensitive data form part of cache identity and storage policy. -->

Prediction identity is still insufficient without rules for freshness, determinism, authorization, and every semantic version.

Versioning asks:

Is this prediction from the correct prediction definition

TTL asks:

How long can this otherwise-correct answer remain usable

TTL means **time to live**. Suppose:

```text
TTL = 1 hour
```

A cached entry created at 13:00 automatically becomes unusable after about 14:00. Why? Because some predictions become stale even though the model itself hasn't changed. Consider an embedding:

```text
embedding("hello")
```

If the embedding model stays unchanged, that result could potentially remain valid for months. Now consider:

```text
"Summarize the current inventory status"
```

The underlying inventory may change every few seconds. A cache entry might need a TTL of:

$$
5s
$$

or caching may be inappropriate entirely. Therefore:

$$
\boxed{\text{TTL should follow the lifetime of the prediction's assumptions.}}
$$

Not some arbitrary company-wide number like "cache everything for one hour." This distinction matters. Suppose an embedding entry has:

```text
TTL = 30 days
model = embedding-v2
```

Tomorrow you deploy `embedding-v3`. Waiting 29 more days for cached v2 entries to expire would be incorrect. Versioning solves that:

```text
embedding:v2:<hash>
embedding:v3:<hash>
```

Conversely, versioning alone doesn't solve rapidly changing external information. So usually:

$$
\boxed{
\text{cache validity}
=
\text{correct version}
\land
\text{not expired}
}
$$

plus authorization and other domain rules. Consider a deterministic classifier:

$$
F(x)=y.
$$

Repeated executions should conceptually return the same prediction. Caching is straightforward. Now consider an LLM with:

```text
temperature = 1
```

Repeated calls can intentionally produce different responses:

$$
F(x)
\rightarrow
y_1,y_2,y_3,\ldots
$$

If you cache the first result and return it forever, you have changed the API from:

sample a response from the model

to:

return the first sample ever produced.

That's a semantic change. Therefore prediction caching is safest when outputs are intended to be reusable. People sometimes assume:

```text
temperature = 0
```

means perfectly deterministic. At the application level, it often greatly reduces variability. But low-level inference can still exhibit variation due to things such as:

* nondeterministic GPU kernels;
* numeric precision differences;
* hardware differences;
* distributed execution;
* tie-breaking;
* runtime changes.

The more useful question isn't:

"Is this mathematically bit-for-bit deterministic?"

It is:

"Does the application's contract allow this previous answer to be reused?"

That is a product-level decision. There are two very different ideas that are both called "LLM caching."

### Exact cache

Only reuse when the prediction identity matches exactly.

```text
"How do I reset my password?"
```

does not hit:

```text
"How can I change my password?"
```

unless your canonicalization explicitly says they are equivalent. Exact caching has relatively clear correctness boundaries.

### Semantic cache

You embed requests and decide that sufficiently similar requests can share answers.

For example:

```text
"How do I reset my password?"
```

might reuse the response for:

```text
"I forgot my password. What do I do?"
```

This potentially creates far more hits. But it introduces a new model:

$$
\text{similarity}(x_1,x_2)>\tau
\Rightarrow
\text{reuse}(y_1).
$$

Now cache correctness depends on:

* embedding quality;
* similarity metric;
* threshold $$\tau$$;
* domain semantics.

Two questions can look similar while requiring different answers:

```text
"Can I withdraw £10,000?"
```

versus:

```text
"Can I withdraw £100,000?"
```

A semantic cache is therefore closer to another approximate inference system than a traditional exact cache. Suppose tenant A asks:

```text
"Summarize our quarterly results."
```

The cached answer contains tenant A's confidential data. Tenant B sends exactly the same text. If the cache key is merely:

$$
H(\text{prompt}),
$$

tenant B could receive tenant A's result. This is a severe data-isolation failure. For tenant-specific predictions, the effective identity may need:

$$
I=
(
tenant,
user/access\ scope,
model,
request,
context
).
$$

At minimum:

$$
K=
H(
tenant\_id
\Vert
prediction\_identity
).
$$

The exact design depends on the application's authorization model. The principle is:

$$
\boxed{\text{If two callers are not allowed to share a prediction, they must not share its cache namespace.}}
$$

Suppose yesterday Alice was allowed to access document X. An LLM generated an answer based on document X and cached it. Today Alice loses access to X. If the cache merely sees:

```text
same user
same question
```

and returns yesterday's answer, the cache has bypassed the new authorization decision. This shows why authorization can't simply be "checked when the entry was originally created." You may need to:

* reevaluate authorization on every read;
* version cache identity by access-control state;
* avoid caching sensitive composite answers;
* use much narrower cache scopes.

Security validation belongs around the cache, not only around model inference. Prediction caches can contain:

* prompts;
* embeddings;
* personal information;
* proprietary documents;
* model responses;
* inferred attributes.

Therefore the cache itself becomes sensitive storage. You should consider:

* encryption in transit;
* encryption at rest where appropriate;
* access controls;
* network isolation;
* tenant separation;
* retention limits;
* auditability;
* deletion requirements;
* avoiding raw request text in observable cache keys.

Hashing a prompt is often preferable to placing the literal prompt in the key:

```text
llm:customer42:What is Jane Smith's salary
```

is a bad cache key to expose in dashboards or logs. Prefer something like:

```text
llm:t42:a8bc971...
```

while remembering that ordinary hashes don't magically solve every privacy problem.

![Three prediction-cache eligibility examples showing reuse of an immutable image embedding, brief reuse of ranking base scores followed by live price and availability checks, and live recomputation of a fraud decision.](/content-assets/articles/article-mlops-model-serving-caching-predictions/cache-eligibility-examples.png)

*Choose the narrowest reusable object: immutable computation can be shared, time-sensitive ranking needs live commercial facts, and consequential decisions must incorporate current evidence.*

## How Do Cache Placement, Coalescing, Locks, Expiration, and Negative Results Work Safely?
<!-- section-summary: Cache-aside placement, request coalescing, disruption-safe locks, valid-result rules, jitter, refresh, and controlled negative caching prevent duplicate or corrupted work. -->

Those rules support an operational pattern that handles concurrent misses, invalid results, expiration, and disruption safely.

A prediction cache can exist at different layers.

For example:

```text
client
  ↓
API gateway cache
  ↓
application cache
  ↓
model-service cache
  ↓
model
```

Each location sees different information.

### Gateway-level cache

Advantages:

* can avoid almost all downstream processing;
* very low latency;
* protects backend traffic.

Disadvantages:

* may lack model-specific context;
* authorization rules can be harder;
* request normalization can be limited.

### Application-level cache

Advantages:

* understands business semantics;
* knows users and tenants;
* knows model versions and contextual dependencies.

Often an excellent place for application predictions.

### Model-server cache

Advantages:

* close to expensive computation;
* can deduplicate calls from many applications.

Disadvantages:

* may not understand business-level freshness or authorization;
* higher layers may have already done substantial work.

The best cache placement is usually the earliest layer that possesses enough information to decide reuse correctly. A simple serving path is:

```text
1. Build cache key
2. GET key
3. If present:
       return result
4. Run model
5. Validate result
6. SET key with TTL
7. Return result
```

This is often called **cache-aside** or **lazy population**.

Conceptually:

$$
\text{read cache}
\rightarrow
\begin{cases}
hit  \rightarrow y\\
miss  \rightarrow F(x)\rightarrow cache(y)
\end{cases}
$$

It is simple and widely useful. But there is an important concurrency problem. Suppose a famous prompt suddenly receives:

$$
10,000
$$

simultaneous requests. The cache entry doesn't exist. Request 1:

```text
MISS → run model
```

Request 2:

```text
MISS → run model
```

Request 3:

```text
MISS → run model
```

and so on. You might trigger 10,000 identical expensive model executions. Eventually they all write the same cache entry. The cache provided almost no protection during the moment you needed it most. This is a **cache stampede** or **thundering herd**. Instead, let one request become the owner of the missing computation.

Conceptually:

```text
request A
    MISS
      ↓
acquire key-specific lock
      ↓
run inference
      ↓
store prediction
      ↓
release lock

requests B...Z
    MISS
      ↓
see computation in progress
      ↓
wait / subscribe
      ↓
reuse A's result
```

Now:

$$
10,000\text{ requests}
$$

might result in:

$$
1\text{ model execution}
$$

rather than 10,000. This technique is called:

* single flight;
* request coalescing;
* duplicate suppression;
* per-key locking.

Suppose worker A acquires the lock and crashes. If the lock lives forever:

```text
everyone waits forever
```

So locks themselves generally need:

* expiration;
* owner identity;
* safe release semantics.

You may also allow another worker to retry after a timeout. The general principle is:

Every mechanism introduced to improve availability must itself have a failure mode.

Caches are no exception. Suppose inference fails with:

```text
GPU out of memory
```

or returns:

```text
HTTP 500
```

If your code blindly stores every response, you might cache the failure. Now one transient model error becomes:

```text
thousands of instantly repeated errors
```

until the TTL expires. Usually, cache only results that have passed the checks required for reuse:

```text
model completed successfully
schema valid
response complete
business validation passed
safety checks complete, when applicable
```

The cache write often belongs **after validation**, not immediately after model execution. Suppose an LLM streams:

```text
"The capital of France is Par..."
```

and the connection dies. You must not cache that incomplete output as a successful final response. For streaming generation, a common strategy is:

```text
stream output to caller
buffer authoritative output internally
mark complete only after successful generation
write cache only after completion
```

Exactly when that is practical depends on architecture. But cache entries should have a clear state:

$$
\text{valid completed prediction}
$$

rather than merely:

$$
\text{some bytes were generated}.
$$

Sometimes "no result" is itself a legitimate reusable result.

For example:

```text
product ID 98123 does not exist
```

If thousands of requests repeatedly query the same nonexistent object, caching the negative lookup briefly can reduce backend pressure. The same concept can apply to some model-serving dependencies. But negative caching normally needs shorter TTLs because the missing condition may change. And you must distinguish:

```text
valid answer = "not found"
```

from:

```text
backend temporarily failed
```

Never confuse absence with failure. Suppose one million entries are written with:

$$
TTL=3600s.
$$

If they were created around the same time, they may expire around the same time. Suddenly:

```text
huge number of cache misses
→ model traffic spikes
→ overload
```

A common mitigation is jitter:

$$
TTL =
3600s
+
U(-300,300)
$$

for some random variable $$U$$. Now expiration is spread over time. This prevents cache expiration from manufacturing its own traffic burst. Suppose one cached prediction receives:

$$
20,000\text{ requests/minute}.
$$

Its TTL is one hour. At exactly the expiration boundary, you don't necessarily want the first user request to pay for an expensive refresh while everyone else waits. You can refresh before expiration:

```text
entry still valid
      ↓
nearing expiration
      ↓
background refresh
      ↓
replace value
```

or use stale-while-revalidate semantics where appropriate:

```text
serve slightly stale result
while one worker computes fresh result
```

This trades freshness against availability and latency. It is only safe when the application explicitly allows some staleness.

## What Can Be Cached for Embeddings, Ranking, RAG, and Tool-Using Models?
<!-- section-summary: Embeddings often cache exactly, while rankings, conversations, RAG dependencies, and tool calls require more identities or a lower reusable layer. -->

Different model products expose different reusable layers, and stateful or tool-using systems make final-answer identity much harder.

Consider:

$$
e = E(text)
$$

where $$E$$ is an embedding model. If:

* text is unchanged;
* embedding model/version is unchanged;
* preprocessing is unchanged,

then recomputing the vector usually provides no benefit. A cache identity could be:

$$
K =
H(
model\_version
\Vert
normalization\_version
\Vert
text
).
$$

For example:

```text
embedding:v5:<text-hash>
```

Embedding caches can be particularly valuable when the same documents are repeatedly embedded. Suppose:

```text
document embedding → model-v2
query embedding    → model-v3
```

Even if both vectors have dimension 1536, their vector spaces may not be compatible. So caching embeddings without model-version identity can silently corrupt retrieval. Never assume:

$$
\text{same vector dimension}
\Rightarrow
\text{same embedding semantics}.
$$

Version identity is essential. Imagine a ranking model computes:

$$
score =
R(
query,
candidate,
user,
context
).
$$

A naïve key:

```text
(query, candidate)
```

may be wrong if ranking also depends on:

* user profile;
* location;
* current inventory;
* device;
* time;
* recent behavior;
* candidate features.

The real identity might be much larger:

$$
I=
(
query,
candidate,
user\_features,
context,
ranker\_version
).
$$

At some point, exact cache hit probability may become tiny. That itself is useful information:

If complete prediction identity is highly specific, full prediction caching may not be economically worthwhile.

Perhaps you should cache a cheaper intermediate feature instead. Suppose an online recommendation pipeline is:

```text
user
 ↓
feature retrieval
 ↓
candidate generation
 ↓
embedding
 ↓
ranking
 ↓
business filtering
 ↓
result
```

The final recommendation may change constantly. But perhaps:

* item embeddings change rarely;
* expensive feature transformations are reusable;
* candidate sets can be cached briefly.

Then caching intermediate computations gives better correctness and better hit rates. The principle is:

$$
\boxed{\text{Cache the most expensive stable computation you can safely reuse.}}
$$

Not necessarily the final API response. Suppose an LLM request contains:

```text
system prompt
developer instructions
user message
conversation history
tools
retrieved context
model
temperature
top_p
max_tokens
```

The prediction identity potentially includes all of these. Caching only:

```text
user message
```

is often incorrect.

For example:

```text
User: "What is my balance?"
```

could produce completely different answers depending on external account context. Likewise:

```text
"Summarize this"
```

is meaningless without knowing **what "this" refers to**. Consider:

```text
Turn 1:
User: My name is Alice.

Turn 2:
User: What's my name
```

If you cache only:

```text
"What's my name?"
```

another conversation may hit the same entry despite having different history. For conversational models, prediction identity may need the entire effective context:

$$
I =
(
system\ prompt,
conversation\ history,
current\ turn,
model,
inference\ config
).
$$

This can make exact response caching less effective because contexts change continually. Suppose:

$$
answer =
LLM(
question,
retrieved\ documents
).
$$

The same question asked twice can produce a different valid answer because retrieval results changed. Therefore the final prediction identity might need:

$$
I=
(
question,
model,
retriever\ version,
retrieved\ content,
prompt\ template
).
$$

You might hash the retrieved document IDs plus versions:

$$
H(
doc_1:v7,
doc_8:v4,
doc_{12}:v9
).
$$

Then a change in source material produces a new key. Alternatively, you may decide final-answer caching is too risky and cache:

* document embeddings;
* retrieval results;
* extracted intermediate data;

instead. Suppose an LLM can call:

```text
get_weather()
get_stock_price()
check_order_status()
```

The answer depends on live external systems. Caching:

```text
"Where is my package?"
```

for one hour could return obsolete information. The LLM's static prompt may be identical, but its effective environment isn't. For tool-using models, think of prediction as:

$$
y=F(x,\text{world state}).
$$

If world state matters and changes rapidly, cache either:

* nothing;
* a very short-lived result;
* individual stable subcomputations.

## How Do Cache Failure, Memory, Popularity, and Admission Affect Capacity?
<!-- section-summary: The service should survive cache failure, size memory and values, understand skew and hot keys, and admit entries whose saved inference is worth their footprint. -->

The cache is also a capacity system with its own outages, memory limits, popularity distribution, and admission choices.

Suppose Redis is unavailable. You have two broad designs.

### Fail closed

```text
cache unavailable
→ request fails
```

This makes sense only if the cache is required for correctness or coordination.

### Fail open / bypass

```text
cache unavailable
→ run model directly
```

This preserves functionality. For an optimization cache, bypass is usually more graceful. But there's a catch. If Redis fails and suddenly every request reaches inference:

$$
\text{model traffic may jump dramatically}.
$$

A service running at 80% cache hit rate could suddenly see approximately 5× as many model executions. So the model tier must either tolerate cache loss or protect itself using:

* rate limiting;
* bounded queues;
* admission control;
* reduced service modes.

Suppose:

$$
\text{incoming requests}=10,000/s
$$

and cache hit rate is:

$$
90\%.
$$

The model normally receives:

$$
1,000/s.
$$

You might size the inference fleet for:

$$
1,500/s.
$$

Now the cache fails. Model demand becomes approximately:

$$
10,000/s.
$$

Your fleet has no chance. This means caching changed not just cost but your failure model. You need to know:

$$
\boxed{\text{How much uncached traffic can the serving tier survive?}}
$$

Possible answer:

* all of it;
* some of it;
* almost none.

Each requires different incident handling. A common cache implementation is Redis or Valkey. You should still think of it as a finite distributed service. Operations consume:

* CPU;
* memory;
* network bandwidth;
* connection capacity;
* command-processing capacity.

Very large model outputs can turn cache traffic into substantial network traffic. Suppose:

$$
50,000\text{ hits/s}
$$

with responses averaging:

$$
100KB.
$$

That's:

$$
5,000,000KB/s
\approx5GB/s
$$

of returned data before considering overhead. The model may disappear from your bottleneck only for the cache/network to become the new one. Caching a classifier response:

```json
{"class":"cat","probability":0.98}
```

is tiny. Caching:

* 8 MB tensors;
* huge token-level metadata;
* long LLM responses;

is different. Large cache objects increase:

* memory consumption;
* network transfer;
* serialization cost;
* deserialization cost;
* eviction pressure.

So a cache is worthwhile only if:

$$
\text{cost saved by avoiding inference}

\text{cost introduced by caching}.
$$

Usually true for expensive inference—but not automatically. Suppose the cache has:

$$
100GB
$$

available. Average cached prediction:

$$
100KB.
$$

Ignoring overhead, it holds roughly:

$$
\frac{100GB}{100KB}
\approx1,000,000
$$

entries. If your active keyspace is 100 million predictions, most entries can't remain resident. You need an eviction policy. Common goals include evicting entries that are:

* least recently used;
* least frequently used;
* near expiration;
* relatively low value.

For ML inference, the best entries aren't necessarily those requested most often. A single cached 20-second inference might be more valuable than many cached 5-ms inferences. That suggests an ideal cache value function resembles:

$$
\text{cache value}
\propto
\text{reuse probability}
\times
\text{inference cost avoided}.
$$

Many workloads have something like:

```text
small number of keys → enormous traffic
large number of keys → rarely reused
```

For example:

```text
"What are your opening hours?"
```

might occur thousands of times. Meanwhile highly personalized prompts may never repeat. Caching works especially well when request popularity is skewed. If every request is effectively unique:

$$
H\approx0.
$$

Then the cache mostly adds:

* lookup latency;
* infrastructure;
* complexity.

You should measure reuse before assuming a cache is valuable. Suppose your cache has limited memory. An attacker or badly behaved client sends millions of unique requests:

```text
x0000001
x0000002
x0000003
...
```

Every miss produces a new entry. These one-time entries push valuable hot entries out. That's cache pollution. Possible responses include:

* cache only after the second access;
* limit entries per tenant;
* cap cacheable object size;
* skip low-value requests;
* use admission policies.

Not every successfully computed prediction deserves to occupy cache memory. For every miss you could ask:

Is this result likely enough to be reused to justify storing it

Suppose prediction A costs:

$$
\$0.000001
$$

to recompute and is unlikely to repeat. Prediction B costs:

$$
\$0.10
$$

and often repeats. Giving both equal cache priority isn't economically ideal.

Conceptually:

$$
V_i =
P(\text{future reuse}_i)
\times
C_{\text{recompute},i}.
$$

Entries with high $$V_i$$ deserve more cache budget. Real systems approximate this using practical policies rather than calculating exact probabilities.

![Cache-aside request flow from field-specific canonicalization through a complete prediction identity and versioned key, branching to validated hits or single-flight fresh inference and an expiring write.](/content-assets/articles/article-mlops-model-serving-caching-predictions/complete-prediction-identity.png)

*A governed hit requires more than a matching request hash: the complete dependency identity, value envelope, age, and caller scope must all still match before reuse.*

## How Do You Measure Cache Correctness, Performance, Serialization, and Release Impact?
<!-- section-summary: Correctness and performance need separate metrics, distributed and local tiers, versioned serialization, untrusted-entry validation, and capacity-aware rollout evidence. -->

Operating it requires correctness evidence distinct from hit rate or latency and a rollout view that includes serialization and service capacity.

A cache can have:

```text
99% hit rate
```

and still be disastrous if 1% of hits return somebody else's prediction. Correctness comes first. Useful correctness metrics include:

* wrong-version hits;
* cross-tenant hit attempts;
* expired-entry reads;
* malformed cached values;
* cache/model disagreement from sampled recomputation.

One powerful strategy is **shadow recomputation**. For a tiny fraction of cache hits:

```text
return cached result
and
silently recompute model result
```

then compare them. This can detect bad cache identity or stale entries. You shouldn't necessarily do it for every request because that destroys the economic benefit. A useful cache dashboard might include:

$$
\text{lookup requests/sec}
$$

$$
\text{hit rate}
$$

$$
\text{miss rate}
$$

$$
\text{compute-weighted hit rate}
$$

$$
\text{cache p50/p95/p99 latency}
$$

$$
\text{model calls avoided/sec}
$$

$$
\text{estimated accelerator-seconds saved}
$$

$$
\text{estimated cost saved}
$$

$$
\text{eviction rate}
$$

$$
\text{memory utilization}
$$

$$
\text{cache errors}
$$

$$
\text{request-coalescing effectiveness}
$$

and, above all:

$$
\text{incorrect reuse incidents}.
$$

Suppose inference takes:

$$
10ms
$$

and your remote cache takes:

$$
15ms
$$

on a hit. The cache has made the request slower. Prediction caching is most compelling when:

$$
L_{\text{cache}}
\ll
L_{\text{inference}}
$$

or when cost avoidance is significant enough to justify it. For a 5-second LLM generation, a 5 ms cache lookup is negligible. For a tiny linear model taking 100 μs, networked Redis might be absurd. Caching should be evaluated relative to what you're replacing. Sometimes systems use:

```text
request
 ↓
in-process cache
 ↓ miss
distributed Redis/Valkey cache
 ↓ miss
model
```

The local cache gives extremely low latency:

$$
\text{memory lookup}
$$

while the distributed cache provides reuse across replicas. But local caches introduce another invalidation problem. If you have:

```text
replica A
replica B
replica C
```

each with independent memory, they can disagree about freshness. Versioned keys and short TTLs make this much easier to reason about. Suppose one cache key receives one million requests per second. Even though it avoids model inference, a single cache node may become overloaded by that one key's network traffic. This is called a **hot key** problem. Mitigations may include:

* small local caches;
* replicated reads;
* application-side memoization;
* request coalescing;
* key-aware load distribution.

Caching moves load; it doesn't eliminate physics. Imagine you've stored:

```json
{
  "label": "cat",
  "score": 0.98
}
```

Then application code changes expected format to:

```json
{
  "predictions": [...]
}
```

Old cache entries can become unreadable or, worse, be misinterpreted. A cache entry should often have a schema or format version:

```text
schema_version = 3
```

or encode that in its namespace. Model version and cache-value schema version are related but not necessarily the same thing. Even though your own application wrote the values, distributed caches can contain:

* stale formats;
* truncated data;
* corrupted values;
* values produced by old code;
* operational mistakes.

So the read path should validate enough structure to fail safely.

Conceptually:

```text
GET cache
   ↓
deserialize
   ↓
validate
   ↓
usable
 /      \
yes      no
 |        |
return   treat as miss
```

Malformed entries should generally not crash the whole serving process. Suppose before caching:

$$
5,000\text{ model calls/sec}.
$$

After rollout:

$$
80\%\text{ hit rate}.
$$

Model calls become approximately:

$$
1,000/s.
$$

That can reduce accelerator requirements massively. But now imagine disabling the cache during an incident. Traffic immediately returns to:

$$
5,000/s.
$$

If you've already scaled the model fleet down to handle only 1,500/s, turning off the cache creates a second incident. This is why rollout and rollback planning matter.

## How Do You Test Cold, Invalidated, Uncached, and Stampede Paths?
<!-- section-summary: Tests cover key canonicalization, invalidation, stampedes, cold starts, uncached failure, deployment changes, and the mathematical capacity effect of hits and misses. -->

Failure and deployment tests must exercise the uncached, cold, invalidated, and simultaneous-miss paths rather than only warm hits.

Before relying heavily on a prediction cache, test:

```text
normal cache
cache latency elevated
cache returns errors
cache completely unavailable
cache cold after restart
cache accidentally flushed
```

Ask:

* Does serving continue
* What happens to model throughput
* Do queues grow
* Does autoscaling respond
* Does the system reject excess load safely
* Does latency remain within acceptable bounds

The worst cache incident is often not:

"Redis is down."

It is:

"Redis is down and the uncached model tier collapses."

Imagine restarting the cache. Before restart:

$$
90\%\text{ hit rate}.
$$

Immediately afterward:

$$
0\%.
$$

The cache needs time to warm. During warm-up:

```text
misses
→ inference
→ writes
→ hit rate gradually recovers
```

This temporary surge may overload the model fleet. You may mitigate with:

* gradual traffic ramp-up;
* prewarming selected hot keys;
* preserving cache data across restart;
* temporary extra inference capacity;
* stricter admission control.

Imagine your prediction identity contains:

```text
model
prompt
temperature
tenant
```

You should test cases such as:

```text
same inputs
→ same key

different model
→ different key

different tenant
→ different key

different temperature
→ different key

JSON field order changes only
→ same key

preprocessing version changes
→ different key
```

These are not trivial implementation details. A key-generation bug is effectively a prediction-routing bug. For a deployment from:

```text
model-v4
```

to:

```text
model-v5
```

verify:

```text
v4 request → old namespace
v5 request → new namespace
v5 cannot accidentally read v4 prediction
```

Then test rollback:

```text
v5 → v4
```

Will v4 reuse its old entries? Should it? Maybe yes. Maybe you deliberately bumped a broader prediction namespace because other semantics changed. Design rollback behavior rather than discovering it during an incident. One valuable load test is:

```text
delete one hot key
send 10,000 simultaneous identical requests
```

Without coalescing:

$$
10,000\text{ inference calls}.
$$

With effective coalescing, perhaps:

$$
1\text{ or a handful of inference calls}.
$$

Measure:

* model call amplification;
* wait latency;
* lock contention;
* lock failures;
* timeout behavior.

Caching under steady state and caching during a hot miss are different operating conditions. Suppose:

* request rate = $$\lambda$$
* cache hit probability = $$h$$
* inference cost/request = $$C_m$$
* cache lookup cost/request = $$C_c$$

Without caching:

$$
C_{\text{no-cache}}
=
\lambda C_m.
$$

With caching:

$$
C_{\text{cache}}
\approx
\lambda C_c
+
\lambda(1-h)C_m.
$$

Savings:

$$
\Delta C
=
\lambda C_m
-
[
\lambda C_c+\lambda(1-h)C_m
].
$$

Simplifying:

$$
\Delta C
=
\lambda(hC_m-C_c).
$$

So caching is economically useful when roughly:

$$
\boxed{hC_m>C_c}
$$

although real systems include storage, networking, operational costs, and variable inference work. The intuition is more important than the exact equation:

The expected model work avoided must exceed the additional cost of operating and consulting the cache.

Suppose your model fleet can process:

$$
2,000\text{ inference calls/sec}.
$$

Incoming requests:

$$
5,000/s.
$$

Without caching, you're overloaded. With:

$$
h=70\%,
$$

only approximately:

$$
5,000(1-0.7)=1,500
$$

requests/sec reach inference. Now your existing model tier can keep up. So caching changes effective capacity. A simplified relationship is:

$$
\text{model demand}
=
\lambda(1-h).
$$

If model inference is the bottleneck, the effective externally served request rate can theoretically increase by approximately:

$$
\frac{1}{1-h}.
$$

At:

$$
h=80\%,
$$

that's:

$$
\frac{1}{0.2}=5\times.
$$

But only while the cache itself can support the traffic. Because cache hits make the model tier look lightly loaded, you may reduce model capacity aggressively. Then your architecture becomes dependent on a high hit rate. Suppose:

$$
h=90\%.
$$

Normal model traffic:

$$
0.1\lambda.
$$

If hit rate suddenly drops to:

$$
50\%,
$$

model traffic becomes:

$$
0.5\lambda.
$$

That is:

$$
5\times
$$

the previous model load. So capacity planning should consider not only:

$$
\text{normal hit rate}
$$

but also:

$$
\text{degraded hit rate}.
$$

Suppose an embedding service receives:

$$
20,000\text{ requests/sec}.
$$

One model replica safely handles:

$$
1,000\text{ requests/sec}.
$$

Without caching, you need at least:

$$
20
$$

replicas before adding headroom. Now measure that:

$$
75\%
$$

of embedding requests refer to content previously embedded. Then model demand becomes:

$$
20,000\times(1-0.75)
=
5,000/s.
$$

Ignoring headroom, that needs approximately:

$$
5
$$

replicas. Huge improvement. Your cache key is:

$$
K =
H(
tenant
\Vert
embedding\ model\ version
\Vert
normalization\ version
\Vert
input\ bytes
).
$$

Embeddings remain valid as long as the embedding definition stays unchanged, so you choose a long TTL. Then you deploy:

```text
embedding-model-v7
```

Instead of deleting all v6 entries, you switch namespaces:

```text
emb:v6:...
→
emb:v7:...
```

Everything initially misses. Model load temporarily jumps from:

$$
5,000/s
$$

toward:

$$
20,000/s.
$$

If your model tier has only six replicas, the deployment overloads it. So you might:

```text
add temporary model capacity
→ deploy new namespace gradually
→ warm cache
→ observe hit rate
→ remove extra capacity
```

Notice what happened. A seemingly simple caching decision affected:

* deployment strategy;
* capacity planning;
* autoscaling;
* reliability;
* cost.

That's why prediction caches belong in the architecture, not as an afterthought.

## What Checklist and Mental Model Support an Exact Prediction Cache?
<!-- section-summary: An exact cache is a versioned, security-scoped reuse system whose hit is valid only when the original prediction would still be the correct computation. -->

The checklist returns to exact computation identity and treats a cache hit as a claim that must remain true.

Before caching a prediction, answer these questions:

1. **What computation are we trying to avoid?**

Full model inference, embedding generation, ranking, retrieval, preprocessing

2. **What completely determines that computation's valid output?**

Input, model version, parameters, preprocessing, context, tenant, external state.

3. **Which of those dimensions belong in the key?**
4. **How long do those assumptions remain valid?**

That determines TTL or whether caching is possible.

5. **Who is allowed to reuse the result?**

Global, tenant, user, session

6. **What happens when 10,000 callers miss the same key?**
7. **Which outputs are valid enough to write?**
8. **What happens if the cache is unavailable?**
9. **Can the inference fleet survive reduced hit rate or a cold cache?**
10. **How will we prove that cache hits are correct?**

If you can answer those ten questions, most implementation details become much easier. A normal model-serving system computes:

$$
y=F(I)
$$

where $$I$$ represents the entire prediction identity. Caching introduces another function:

$$
C(I)
$$

that may contain a previously computed result. The system becomes:

$$
\hat y=
\begin{cases}
C(I),  \text{if cached result is valid}\\
F(I),  \text{otherwise}.
\end{cases}
$$

Correctness therefore requires:

$$
\boxed{
C(I)\text{ is returned only when it remains a valid substitute for }F(I)
}
$$

Everything else follows. **Cache key design** asks:

Did we identify $$I$$ correctly

**TTL** asks:

Does $$I$$'s meaning change with time

**Versioning** asks:

Has the definition of $$F$$ changed

**Tenant isolation** asks:

Who is authorized to observe $$C(I)$$

**Stampede prevention** asks:

What happens when many callers simultaneously discover that $$C(I)$$ is missing

**Cache failure handling** asks:

Can we still execute $$F(I)$$ safely when $$C$$ disappears

**Metrics** ask:

Is $$C$$ both correct and economically worthwhile

Prediction caching is not fundamentally about Redis. It is about recognizing repeated computation. Without caching:

$$
\boxed{
\text{Request}
\rightarrow
\text{Compute prediction}
}
$$

With caching:

$$
\boxed{
\text{Request}
\rightarrow
\text{Prove previous prediction is reusable}
\rightarrow
\text{reuse or recompute}
}
$$

The word **prove** is the important part. A cached prediction is safe only when the aspects that determine prediction validity are still equivalent:

$$
\boxed{
\text{same prediction semantics}
+
\text{valid freshness}
+
\text{correct authorization scope}
}
$$

A good cache key captures prediction identity. A TTL limits temporal validity. Versioned namespaces make semantic changes safe. Tenant boundaries prevent data leakage. Request coalescing stops hot misses from turning into inference storms. Graceful cache bypass prevents an optimization layer from becoming a mandatory dependency, while capacity planning accounts for what happens when hit rate collapses. And economically:

$$
\boxed{
\text{Caching is valuable when the cost of recognizing reuse is much smaller than the computation it avoids.}
}
$$

So the real question is never merely:

**"Can we cache this model response?"**

It is:

**"Under exactly what conditions is an old prediction still a correct substitute for performing this inference again?"**

Once that is precisely defined, the rest of the caching architecture becomes much easier to reason about.

![Six controls for safely releasing and operating a prediction cache, followed by an incident path that bypasses unsafe reuse, protects inference, restores a compatible namespace, and proves recovery.](/content-assets/articles/article-mlops-model-serving-caching-predictions/cache-release-summary.png)

*Cache safety is a release property: eligibility, keys, freshness, failure behaviour, canary isolation, and operating evidence must pass together, with bypass and complete recovery ready when evidence points to unsafe reuse.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[When Are Two Prediction Requests the Same Reusable Computation?]{kind="recap"}
A reusable prediction is a function of canonicalized input plus every model, configuration, policy, tenant, and dependency value that affects semantics.
:::

:::expand[How Do Freshness, Determinism, Security, and Versioning Define Cache Validity?]{kind="recap"}
Versioning separates semantic generations, TTL limits age, determinism defines equivalence, and authorization and sensitive data form part of cache identity and storage policy.
:::

:::expand[How Do Cache Placement, Coalescing, Locks, Expiration, and Negative Results Work Safely?]{kind="recap"}
Cache-aside placement, request coalescing, disruption-safe locks, valid-result rules, jitter, refresh, and controlled negative caching prevent duplicate or corrupted work.
:::

:::expand[What Can Be Cached for Embeddings, Ranking, RAG, and Tool-Using Models?]{kind="recap"}
Embeddings often cache exactly, while rankings, conversations, RAG dependencies, and tool calls require more identities or a lower reusable layer.
:::

:::expand[How Do Cache Failure, Memory, Popularity, and Admission Affect Capacity?]{kind="recap"}
The service should survive cache failure, size memory and values, understand skew and hot keys, and admit entries whose saved inference is worth their footprint.
:::

:::expand[How Do You Measure Cache Correctness, Performance, Serialization, and Release Impact?]{kind="recap"}
Correctness and performance need separate metrics, distributed and local tiers, versioned serialization, untrusted-entry validation, and capacity-aware rollout evidence.
:::

:::expand[How Do You Test Cold, Invalidated, Uncached, and Stampede Paths?]{kind="recap"}
Tests cover key canonicalization, invalidation, stampedes, cold starts, uncached failure, deployment changes, and the mathematical capacity effect of hits and misses.
:::

:::expand[What Checklist and Mental Model Support an Exact Prediction Cache?]{kind="recap"}
An exact cache is a versioned, security-scoped reuse system whose hit is valid only when the original prediction would still be the correct computation.
:::
