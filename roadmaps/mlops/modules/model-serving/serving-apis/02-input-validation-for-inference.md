---
title: "Input Validation"
description: "Validate inference inputs before model execution with resource limits, strict schemas, semantic and temporal rules, operating-domain checks, safe outcomes, and observable rollout controls."
overview: "Input validation is the layered safety boundary between an inference caller and a model, covering transport, structure, meaning, time, feature readiness, model operating limits, compatibility, and failure behavior."
tags: ["MLOps", "core", "api"]
order: 2
id: "article-mlops-model-serving-input-validation-for-inference"
aliases:
  - roadmaps/mlops/modules/model-serving/serving-apis/03-input-validation-for-inference.md
  - child-serving-apis-03-input-validation-for-inference
---

## Table of Contents

1. [Which Model Assumptions Must Input Validation Enforce at Each Boundary?](#which-model-assumptions-must-input-validation-enforce-at-each-boundary)
2. [How Do Structural, Semantic, Model-Specific, and Resource Checks Differ?](#how-do-structural-semantic-model-specific-and-resource-checks-differ)
3. [How Do You Keep Validation Secure, Bounded, and Unambiguous?](#how-do-you-keep-validation-secure-bounded-and-unambiguous)
4. [How Should Errors, Sanitization, Multimodal Content, and Downstream Tools Be Handled?](#how-should-errors-sanitization-multimodal-content-and-downstream-tools-be-handled)
5. [How Do New Rules, Contract Versions, Time-of-Check Risks, and Scheduling Interact?](#how-do-new-rules-contract-versions-time-of-check-risks-and-scheduling-interact)
6. [Why Should Expensive Checks Run Once and Invalid Work Be Rejected Early?](#why-should-expensive-checks-run-once-and-invalid-work-be-rejected-early)
7. [How Does Validation Narrow the State Space the Model Must Handle?](#how-does-validation-narrow-the-state-space-the-model-must-handle)
8. [What Complete Validation Path Protects an Inference Request?](#what-complete-validation-path-protects-an-inference-request)
9. [Check Your Answers](#check-your-answers)

A request contains valid JSON and a valid string field, yet that string points to a multi-gigabyte image archive. Another request uses the right tensor shape but values in units the model never saw. Parsing succeeded; safe inference did not.

**Input validation** turns the model's assumptions and the product's resource and security limits into checks at several boundaries. It covers structure, semantics, supported model inputs, computational cost, authorization, and downstream actions while keeping the validation work itself bounded.

Use these questions to design a path that rejects invalid or ambiguous work before it consumes scarce inference capacity:

1. **Which Model Assumptions Must Input Validation Enforce at Each Boundary?**
2. **How Do Structural, Semantic, Model-Specific, and Resource Checks Differ?**
3. **How Do You Keep Validation Secure, Bounded, and Unambiguous?**
4. **How Should Errors, Sanitization, Multimodal Content, and Downstream Tools Be Handled?**
5. **How Do New Rules, Contract Versions, Time-of-Check Risks, and Scheduling Interact?**
6. **Why Should Expensive Checks Run Once and Invalid Work Be Rejected Early?**
7. **How Does Validation Narrow the State Space the Model Must Handle?**
8. **What Complete Validation Path Protects an Inference Request?**

## Which Model Assumptions Must Input Validation Enforce at Each Boundary?
<!-- section-summary: Validation derives from model and product assumptions and applies at transport, API, feature, model, and downstream-action boundaries instead of only parsing JSON. -->

Valid syntax says little about whether an input matches the model's domain, resource limits, and product contract.

Input validation in model serving is easiest to understand from one first principle:

> **A model-serving system should only spend resources on inputs that it understands, can safely process, and is prepared to give to the model.**

Everything else follows from that. Imagine a very simple model server:

```text
Client
  ↓
HTTP request
  ↓
Parse input
  ↓
Run model
  ↓
Return output
```

Suppose the model expects:

```json
{
  "prompt": "Explain gravity",
  "max_tokens": 100
}
```

At first glance, validation seems simple:

```text
Is this valid JSON
Does it contain "prompt"
Is max_tokens an integer
```

But those checks answer only:

"Can my software parse this request?"

They do **not** answer:

"Is it safe and meaningful to execute this request?"

Those are very different questions. Consider:

```json
{
  "prompt": "hello",
  "max_tokens": 999999999999
}
```

Perfectly valid JSON. It may even satisfy a loose schema saying:

```text
prompt: string
max_tokens: integer
```

But executing it could be nonsensical or expensive. Or:

```json
{
  "prompt": "A".repeat(500_000_000)
}
```

Again, conceptually valid. But now the server may have to:

1. receive hundreds of megabytes,
2. allocate memory for it,
3. decode Unicode,
4. tokenize it,
5. allocate accelerator memory,
6. run an enormous inference request.

The problem is therefore not syntax. The real property we need is closer to:

```text
acceptable(request)
    =
syntactically_valid
AND semantically_valid
AND resource_safe
AND compatible_with_model
AND allowed_by_system_policy
```

This distinction is fundamental.

### Syntax vs semantics

Consider:

```json
{
  "temperature": -500
}
```

A JSON parser says:

```text
✓ number
```

But the inference server should probably say:

```text
✗ temperature outside supported range
```

Similarly:

```json
{
  "messages": []
}
```

could be valid JSON and valid according to its basic types, while being meaningless for an endpoint requiring at least one message. A schema tells you something about **shape**. The application has to validate **meaning**. A useful way to design validation is to work backward. Ask:

What assumptions does the next component make about its input

Suppose your inference implementation assumes:

```text
token_count <= 128,000
batch_size <= 32
temperature ∈ [0, 2]
top_p ∈ (0, 1]
model ∈ models_we_serve
```

Those assumptions are effectively invariants. If the inference code assumes:

```text
token_count <= 128,000
```

then some component before inference should establish that fact. In other words:

```text
untrusted input
      ↓
validation
      ↓
trusted invariant
      ↓
model code
```

After validation succeeds, downstream code should be able to reason:

```text
"This request satisfies the contract."
```

That dramatically simplifies the rest of the system. Without that boundary, every component has to defensively ask:

```python
if batch_size > 32:
    ...
if max_tokens < 0:
    ...
if model_does_not_exist:
    ...
```

Validation becomes scattered and inconsistent. There is no single moment where an input changes from "bad" to "good." Different failures become detectable at different stages. A robust serving path often looks more like:

```text
Internet
   ↓
[Transport / gateway checks]
   ↓
[Parser / schema checks]
   ↓
[Application semantic checks]
   ↓
[Tokenizer / modality checks]
   ↓
[Model-specific checks]
   ↓
[Scheduler / resource checks]
   ↓
Model
```

Each boundary protects something different.

### Boundary 1: transport and request limits

Before deeply parsing the request, you can often determine:

```text
Is the HTTP body too large
Is the content type supported
Is the client authenticated
Has the client exceeded its rate limit
```

For example:

```text
Content-Length: 8 GB
```

You don't need to parse eight gigabytes of JSON to discover that the request is unacceptable. Reject it early. This gives us another principle:

> **Reject invalid input at the cheapest boundary capable of detecting it.**

If something costs:

```text
HTTP header check       ~ tiny
JSON parse              ~ small
tokenization            ~ larger
GPU inference           ~ very large
```

then rejecting before inference is vastly better than discovering the problem afterward.

## How Do Structural, Semantic, Model-Specific, and Resource Checks Differ?
<!-- section-summary: Structural checks verify form, semantic checks verify meaning, model-specific checks verify supported inputs, and resource checks bound computational work. -->

Those assumptions fall into distinct structural, semantic, model-specific, and resource layers that fail for different reasons.

After basic transport checks, you usually validate the request shape. Suppose an endpoint accepts:

```json
{
  "model": "my-model",
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ],
  "temperature": 0.7
}
```

Structural checks might establish:

```text
request is an object
model is a string
messages is an array
each message is an object
role is an allowed enum
content is a string
temperature is a number
unknown fields are rejected or handled explicitly
```

This catches requests such as:

```json
{
  "temperature": "very creative"
}
```

or:

```json
{
  "messages": "hello"
}
```

This is where JSON Schema, Pydantic, protobuf validation, typed request objects, and similar mechanisms are useful. But structural validation still isn't enough. Now ask whether the values make sense together.

For example:

```json
{
  "temperature": 1.0,
  "top_p": 0.9,
  "max_tokens": -20
}
```

The type is correct. The value isn't. You might define:

```text
0 <= temperature <= 2
0 < top_p <= 1
1 <= max_tokens <= model_output_limit
```

There can also be relationships between fields.

For example:

```text
input_tokens + max_output_tokens
    <= model_context_window
```

Suppose:

```text
model context window = 128k
input = 120k tokens
requested output = 20k tokens
```

Individually:

```text
120k input       ✓
20k output       ✓
```

Together:

```text
140k total       ✗
```

This is an important class of validation:

**Many invalid states arise from relationships between otherwise valid values.**

A serving API may expose multiple models:

```text
model-small
model-large
vision-model
embedding-model
```

Their valid inputs differ.

For example:

```text
vision-model:
    text + images

embedding-model:
    text
    no temperature
    no generation parameters

model-small:
    32k context

model-large:
    256k context
```

Therefore the validity of a request can depend on which model will execute it.

Conceptually:

```python
validate_generic_request(request)

model = resolve_model(request.model)

validate_for_model(request, model)
```

Rather than pretending:

```text
validity(request)
```

exists in isolation, the actual question may be:

```text
validity(request, model, server_configuration)
```

The same request can legitimately be:

```text
valid for model A
invalid for model B
```

Traditional APIs may perform a database query or small computation. Model inference can consume scarce resources:

```text
GPU memory
KV-cache memory
CPU
network bandwidth
tokenizer time
batch capacity
scheduler slots
seconds or minutes of accelerator compute
```

This makes resource validation part of correctness, not merely optimization. Consider:

```json
{
  "n": 10000,
  "max_tokens": 10000
}
```

Even if both values are individually supported, their combination could imply roughly:

```text
100 million generated tokens
```

So you might validate quantities such as:

```text
number of prompts
number of images
image dimensions
audio duration
input token count
requested output tokens
number of return sequences
total batch cost
```

One useful abstraction is a **request budget**.

For example:

```text
estimated_cost(request)
    <= permitted_budget(client, endpoint)
```

The estimate might incorporate:

```text
input tokens
+ expected output tokens
+ number of samples
+ image patches
+ audio frames
```

This protects both system reliability and fair use.

![Six inference validation gates ordered from resource and schema checks through meaning, time, model-domain coverage, and controlled routing, with example failures mapped to the gate that catches them.](/content-assets/articles/article-mlops-model-serving-input-validation-for-inference/layered-validation-gates.png)

*The validation path rejects each unsafe condition at the cheapest boundary that owns the evidence, keeping malformed, stale, or unsupported inputs away from expensive model work.*

## How Do You Keep Validation Secure, Bounded, and Unambiguous?
<!-- section-summary: Validation itself must resist oversized or adversarial inputs, enforce security controls, reject ambiguity, and normalize only with documented semantics. -->

Because untrusted callers control the input, the validation path itself must have bounded work and fail closed on ambiguity.

This produces a subtle but important rule:

**The validation path must be cheaper and safer than the operation it protects.**

Suppose you accept compressed uploads. An attacker sends:

```text
10 MB compressed
→ 100 GB after decompression
```

If your validator eagerly decompresses everything before enforcing limits, then "validation" itself becomes the attack. Similarly, imagine checking image dimensions by fully decoding an enormous malformed image. Or validating token count by repeatedly tokenizing a huge request several times. The validator must itself obey limits. Examples include:

```text
maximum HTTP body size
maximum decompressed size
maximum nesting depth
maximum number of JSON fields
maximum array length
maximum string length
parser timeouts
tokenization limits
image pixel limits
audio-duration limits
```

It is tempting to draw:

```text
request
  ↓
validation
  ↓
security
  ↓
model
```

But security doesn't form one clean stage. Some protections must happen before expensive validation. A more realistic picture is:

```text
                    ┌─ authentication
                    ├─ authorization
Client → Gateway ───┼─ rate limiting
                    ├─ body-size limit
                    └─ connection limits
                           ↓
                       Parsing
                           │
                 parser safety limits
                           ↓
                    Semantic validation
                           │
                    quota / cost checks
                           ↓
                       Inference
                           │
                  runtime resource limits
```

For example, suppose a malicious client sends one million malformed requests per second. Your beautifully designed semantic validator won't save you if every malformed request causes expensive processing. Rate limiting and connection controls have to act earlier. Imagine your API accepts:

```json
{
  "max_tokens": 100,
  "max_completion_tokens": 500
}
```

What happens if both are supplied? Possible implementations might:

```text
use the first
use the second
take the maximum
take the minimum
silently ignore one
```

Ambiguity is dangerous. A safer contract often says:

```text
exactly one may be supplied
```

and rejects the request otherwise. The general principle is:

**When the server cannot determine the client's intent unambiguously, rejection is often safer than guessing.**

Likewise, unknown fields deserve deliberate handling. Given:

```json
{
  "temprature": 2.0
}
```

silently ignoring `temprature` can hide a client bug. Rejecting unknown parameters often makes APIs much easier to operate:

```text
Unknown field "temprature".
Did you mean "temperature"
```

Sometimes input can be represented several equivalent ways.

For example:

```text
MODEL-LARGE
model-large
model-large/
```

Or Unicode strings may have equivalent representations. You may want:

```text
raw input
   ↓
safe normalization
   ↓
validation
```

But normalization can also change meaning. Therefore it is useful to distinguish:

```text
canonicalization
```

from:

```text
accepting arbitrary malformed input and guessing what was intended
```

A good normalization rule should be deterministic and documented.

## How Should Errors, Sanitization, Multimodal Content, and Downstream Tools Be Handled?
<!-- section-summary: Errors are stable API responses, sanitization is a separate transformation, multimodal inputs expand the attack surface, and content or tool safety requires additional controls. -->

A rejected request still needs safe, useful error semantics, and validation must remain distinct from sanitization, content safety, and downstream authorization.

Consider two responses. Bad:

```json
{
  "error": "invalid request"
}
```

Better:

```json
{
  "error": {
    "code": "context_length_exceeded",
    "field": "messages",
    "input_tokens": 130421,
    "maximum_tokens": 128000
  }
}
```

Good validation errors help:

```text
users fix requests
SDKs react programmatically
operators debug incidents
metrics identify common client bugs
```

But error messages should not leak internal implementation details that create security or privacy problems. Think of validation errors as a stable API contract rather than incidental exception strings. Validation also improves error classification. If a client sends:

```json
{"temperature": -9}
```

that is a client problem.

Conceptually:

```text
4xx
```

If:

```text
temperature = 0.7
```

passes validation and then a GPU dies, that's a server problem:

```text
5xx
```

Without clear validation boundaries, invalid client requests can travel deep into the stack and eventually produce something like:

```text
CUDA error
IndexError
assertion failed
```

Now:

```text
the client gets an incomprehensible 500
your error metrics claim the server is broken
operators investigate a non-incident
```

Good validation keeps failures near their true source. This distinction matters. **Validation** asks:

```text
Is this input permitted
```

**Normalization** asks:

```text
Can I put equivalent representations into one canonical form
```

**Sanitization** asks:

```text
Can I modify dangerous input into something acceptable
```

In model serving, silently sanitizing requests can be problematic because it changes what the user asked for.

For example:

```text
requested max_tokens = 1,000,000
```

Silently turning it into:

```text
max_tokens = 4,096
```

may be surprising. Often it's better to reject it explicitly:

```text
max_tokens must be <= 4096
```

There are places where clamping is reasonable, but it should be a deliberate API behavior. For a text-only model, input might initially appear simple. With multimodal models, one request could contain:

```text
JSON
text
URLs
images
audio
video
documents
base64 blobs
```

Every decoder introduces another trust boundary. For an image, for example:

```text
Is the declared MIME type correct
Can the decoder parse it safely
How many pixels will it expand to
How many frames does it contain
Is metadata enormous
Does its format trigger pathological decoder behavior
```

A file being:

```text
valid PNG
```

does not imply:

```text
safe input for this serving system
```

Again:

```text
syntactic validity ≠ operational safety
```

This distinction is also useful. Suppose:

```json
{
  "prompt": "some disallowed request"
}
```

It may satisfy every technical requirement:

```text
valid JSON               ✓
correct schema            ✓
below context limit       ✓
valid model               ✓
resource budget okay      ✓
```

Yet the system may still decide not to process it because of a separate safety policy. So we can separate:

```text
request validity
```

from:

```text
request policy eligibility
```

The precise architecture varies, but mentally distinguishing them prevents one enormous "validator" from becoming responsible for everything. Suppose an LLM can call a tool:

```text
Model
  ↓
{"tool": "transfer_money", "amount": ...}
  ↓
Tool executor
```

The model's output is now an **input to another system**. It must be validated again. Never reason:

```text
"The model produced it, therefore it is trusted."
```

Instead:

```text
User input          = untrusted
External data       = untrusted
Model output        = untrusted
Tool arguments      = untrusted
```

Trust is granted only after checking the contract of the next boundary. This gives us a much broader systems principle:

**Validate whenever information crosses from one trust domain into another.**

## How Do New Rules, Contract Versions, Time-of-Check Risks, and Scheduling Interact?
<!-- section-summary: Rule rollout and versioning preserve compatibility, time-of-check risks require immutable or revalidated resources, and schedulers need validated cost information. -->

Contracts evolve and resources can change between check and use, so rollout, versioning, revalidation, and scheduling need a coordinated design.

Now suppose your production server has accepted this for a year:

```json
{
  "temperature": 4
}
```

You discover that temperatures over 2 are unsupported and decide:

```python
assert temperature <= 2
```

Technically correct. Operationally, it could instantly break thousands of existing clients. Validation rules themselves are API changes. A safer deployment often moves through stages:

```text
Observe
  ↓
Warn
  ↓
Soft-enforce
  ↓
Hard-enforce
```

For example:

### Stage 1 — shadow validation

Evaluate the proposed rule but don't reject anything.

```text
request temperature=4

existing behavior:
    accepted

new validator:
    would reject

metric:
    proposed_temperature_rule_failure += 1
```

Now you can determine:

```text
How many requests would break
Which clients
What values are they sending
```

### Stage 2 — communicate

Return warnings, telemetry, logs, or deprecation notices where appropriate.

### Stage 3 — partial enforcement

Perhaps enable the rule for:

```text
new API versions
a small percentage of traffic
internal clients
newly created accounts
```

### Stage 4 — full enforcement

Once clients have migrated:

```text
temperature > 2 → reject
```

The deeper lesson is:

**Making a contract stricter is often a compatibility change, even if the old behavior was never intended.**

Suppose version 1 allows:

```text
temperature <= 5
```

while version 2 allows:

```text
temperature <= 2
```

Avoid piles of scattered code:

```python
if api_version == 1:
    ...
elif api_version == 2:
    ...
```

Think instead of explicit contracts:

```text
Request
   ↓
API version
   ↓
Validator for that contract
   ↓
Canonical internal request
```

This lets old external representations map into a clean internal representation.

For example:

```text
V1 request ─┐
            ├─→ canonical inference request → model
V2 request ─┘
```

The model-serving core doesn't need to understand every historical API quirk. Validation only helps if the thing you validated is the thing you use. Imagine the request contains:

```json
{
  "image_url": "https://example.com/image.png"
}
```

You validate:

```text
URL looks okay
```

and later fetch it. But between those operations, the URL can resolve or redirect somewhere else. Likewise, a model alias might change:

```text
"model": "latest"
```

between validation and execution. So whenever possible, validation should resolve unstable references into stable internal objects:

```text
"latest"
   ↓ resolve
model revision abc123
   ↓ validate
model revision abc123
   ↓ execute
```

The principle is:

**Validate the actual resource you will operate on, not merely a description that can change afterward.**

Modern inference servers often batch requests. Imagine:

```text
Request A: 1k tokens
Request B: 2k tokens
Request C: 400k tokens
```

Even if C is technically below some global maximum, admitting it might destroy latency for everyone else. So some rules are better understood as **admission control** than basic validation.

```text
Is this request structurally valid     ✓

Is this request semantically valid      ✓

Can this serving pool admit it now      maybe
```

These are different questions. A clean architecture might distinguish:

```text
Validation
    "Could this request ever run?"

Admission control
    "Should this request run here, now?"
```

The latter can consider:

```text
current GPU memory
queue depth
tenant quotas
latency SLO
priority
batch composition
```

![Four controlled outcomes from a failed inference check: caller repair, review, approved fallback, or service error, each with a distinct response contract.](/content-assets/articles/article-mlops-model-serving-input-validation-for-inference/validation-outcome-routing.png)

*A failed check should reveal who can act next: the caller repairs its request, policy chooses review or a tested fallback, or the service reports an unavailable safe path with bounded retry guidance.*

## Why Should Expensive Checks Run Once and Invalid Work Be Rejected Early?
<!-- section-summary: Early rejection saves downstream capacity, while reusable validation evidence prevents repeating the same expensive decoding or inspection without cause. -->

The order of checks protects capacity by rejecting cheap failures early and reusing costly validation results when their identity remains valid.

Suppose invalid requests make up just 1% of traffic. You receive:

```text
100,000 requests/minute
```

So:

```text
1,000 invalid requests/minute
```

If rejection costs:

```text
1 ms CPU
```

that's manageable. If they reach inference and consume:

```text
500 ms GPU
```

then approximately:

```text
1,000 × 0.5
= 500 GPU-seconds/minute
```

are being wasted. That is:

```text
8.3 GPU-seconds every second
```

roughly equivalent to continuously occupying more than eight GPUs just processing requests you eventually shouldn't execute. Validation is therefore directly connected to serving economics. The opposite failure is also common. Imagine:

```text
gateway counts tokens
API server counts tokens
scheduler counts tokens
model worker counts tokens
```

If tokenization is expensive, you have turned validation into duplicated work. Instead, compute trustworthy derived properties once where possible:

```text
raw request
    ↓
tokenize
    ↓
ValidatedRequest(
    token_ids,
    token_count=4812,
    ...
)
    ↓
scheduler
    ↓
worker
```

Downstream layers can still assert invariants cheaply, but they shouldn't repeatedly perform expensive transformations without reason.

## How Does Validation Narrow the State Space the Model Must Handle?
<!-- section-summary: Each accepted constraint removes invalid states from the model's possible input space and makes the remaining behaviour easier to test and operate. -->

The resulting constraints have a deeper effect: they reduce the state space the model service is expected to handle.

Before validation, a field like:

```text
max_tokens
```

could theoretically be:

```text
missing
null
"100"
-5
0
100
10^100
NaN
Infinity
array
object
...
```

After parsing and validation, downstream code might know:

```text
max_tokens ∈ integers from 1 to 4096
```

Validation has dramatically reduced the number of states the rest of your program must handle. This is why strong validation improves more than security. It improves:

```text
correctness
testability
readability
reliability
observability
capacity planning
```

Downstream components can be much simpler when their inputs obey strong invariants.

## What Complete Validation Path Protects an Inference Request?
<!-- section-summary: The complete path moves from transport and authorization through structure, semantics, resources, model assumptions, scheduling, inference, and downstream validation. -->

The final path assembles every boundary from network input to the action performed after inference.

A production model request might pass through something resembling:

```text
                         UNTRUSTED
                             │
                             ▼
                    ┌─────────────────┐
                    │ Network/Gateway │
                    │                 │
                    │ auth            │
                    │ rate limits     │
                    │ request size    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Safe parsing    │
                    │                 │
                    │ JSON syntax     │
                    │ nesting limits  │
                    │ field counts    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Schema          │
                    │                 │
                    │ types           │
                    │ required fields │
                    │ enums           │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Semantics       │
                    │                 │
                    │ ranges          │
                    │ relationships   │
                    │ combinations    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Model limits    │
                    │                 │
                    │ token count     │
                    │ modalities      │
                    │ context window  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Admission       │
                    │                 │
                    │ quota           │
                    │ GPU capacity    │
                    │ scheduling      │
                    └────────┬────────┘
                             │
                             ▼
                           MODEL
```

Not every system needs exactly these layers. The point is that each layer establishes stronger facts for the layer beneath it. If you remember only one model, use this:

```text
                   Can I cheaply reject it
                            ↓
                   Can I safely parse it
                            ↓
                   Do I understand its shape
                            ↓
                   Do its values make sense
                            ↓
                   Does this model support it
                            ↓
                   Can I afford to execute it
                            ↓
                         MODEL
```

Input validation is therefore **not merely checking JSON**. It is the process of converting:

```text
arbitrary, untrusted external data
```

into:

```text
a bounded, well-understood request
whose assumptions the serving system can safely rely on
```

A particularly useful rule for designing the architecture is:

**Every component should clearly state what it assumes about its inputs, and the component immediately before it should either establish those assumptions or reject the request.**

Once you think of validation as **establishing invariants at trust boundaries**, most of the individual rules—schema checks, context limits, size limits, quotas, model compatibility, gradual enforcement—stop looking like unrelated defensive programming tricks and become parts of the same system design.

![Validation-rule rollout from proposal and observe mode through client repair, canary enforcement, full enforcement, and rollback to observation when impact exceeds limits.](/content-assets/articles/article-mlops-model-serving-input-validation-for-inference/validation-rollout-summary.png)

*New compatibility rules move from observation to targeted enforcement with bounded telemetry and a retained adapter, so healthy clients are identified and repaired before the boundary tightens for everyone.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[Which Model Assumptions Must Input Validation Enforce at Each Boundary?]{kind="recap"}
Validation derives from model and product assumptions and applies at transport, API, feature, model, and downstream-action boundaries instead of only parsing JSON.
:::

:::expand[How Do Structural, Semantic, Model-Specific, and Resource Checks Differ?]{kind="recap"}
Structural checks verify form, semantic checks verify meaning, model-specific checks verify supported inputs, and resource checks bound computational work.
:::

:::expand[How Do You Keep Validation Secure, Bounded, and Unambiguous?]{kind="recap"}
Validation itself must resist oversized or adversarial inputs, enforce security controls, reject ambiguity, and normalize only with documented semantics.
:::

:::expand[How Should Errors, Sanitization, Multimodal Content, and Downstream Tools Be Handled?]{kind="recap"}
Errors are stable API responses, sanitization is a separate transformation, multimodal inputs expand the attack surface, and content or tool safety requires additional controls.
:::

:::expand[How Do New Rules, Contract Versions, Time-of-Check Risks, and Scheduling Interact?]{kind="recap"}
Rule rollout and versioning preserve compatibility, time-of-check risks require immutable or revalidated resources, and schedulers need validated cost information.
:::

:::expand[Why Should Expensive Checks Run Once and Invalid Work Be Rejected Early?]{kind="recap"}
Early rejection saves downstream capacity, while reusable validation evidence prevents repeating the same expensive decoding or inspection without cause.
:::

:::expand[How Does Validation Narrow the State Space the Model Must Handle?]{kind="recap"}
Each accepted constraint removes invalid states from the model's possible input space and makes the remaining behaviour easier to test and operate.
:::

:::expand[What Complete Validation Path Protects an Inference Request?]{kind="recap"}
The complete path moves from transport and authorization through structure, semantics, resources, model assumptions, scheduling, inference, and downstream validation.
:::
