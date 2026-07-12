---
title: "LLM Systems in 2026"
description: "Learn how a modern LLM product is built around a model, prompts, tools, retrieval, memory, evals, tracing, guardrails, and runtime controls."
overview: "A beginner-friendly tour of the production pieces around a 2026 LLM application, using a customer-support copilot as the running example."
tags: ["MLOps","LLMOps","production","llms"]
order: 1
id: "article-mlops-llmops-llm-systems-2026"
---
## The System You Are Really Building

<!-- section-summary: A 2026 LLM system is a product workflow around a model, with context, tools, safety controls, evals, traces, and deployment rules. The model writes and reasons, while the surrounding system decides what it can see, what it can do, and how the team checks its work. -->

An **LLM system** is the full application that surrounds a large language model. The model is the part that reads text, reasons over instructions, and produces text or tool calls. The system around it decides which model to call, which prompt version to use, which customer data to retrieve, which tools the model can request, which actions need review, how much the request can cost, and how engineers inspect the result after something goes wrong.

Think about a customer-support copilot for **BrightCart**, a fictional online shop that sells home goods. A shopper writes, "My garden chair arrived with a cracked leg. I assembled half of it before noticing. Can I return it, and where is my replacement order?" A simple chatbot can produce a polite answer. A production copilot needs much more. It needs the return policy for assembled items, the current order status, a safe way to create a replacement case, a record of why it gave that answer, and a path to a human support specialist when the case touches money or policy exceptions.

That is why LLMOps in 2026 feels different from prompt tinkering. You still care about prompt quality, model choice, and response style, yet the real engineering work lives in the **interfaces around the model**. You define durable prompts, retrieval sources, JSON schemas, tool contracts, memory rules, eval datasets, trace fields, cost budgets, and release gates. The model call sits inside that machinery.

For BrightCart, the first useful definition is simple: **the LLM system is the support workflow that uses an LLM as one decision-making component**. The system includes the web app, the API route, the retrieval index, the order lookup service, the ticketing API, the guardrail checks, the prompt registry, the tracing pipeline, the evaluation suite, and the deployment checklist. When a learner says "we shipped an LLM," a senior engineer usually asks, "What system did you ship around it?"

![BrightCart LLM system controls](/content-assets/articles/article-mlops-llmops-llm-systems-2026/brightcart-llm-system-controls.png)

*BrightCart wraps the model with versioned prompts, retrieved evidence, scoped tools, state, guardrails, evals, traces, and release gates.*

## A Map Of The Moving Parts

<!-- section-summary: Modern LLM applications are easier to reason about when you name each production responsibility. BrightCart's copilot has one flow, yet that flow crosses prompts, context, tools, state, observability, safety, and release controls. -->

BrightCart's copilot has one visible job: help support agents answer customers faster. Under the surface, each request passes through several parts that need separate ownership. A beginner mistake is to place all of these responsibilities inside one giant prompt. A production team splits them into contracts so each part can change safely.

| Part | Plain-English purpose | BrightCart example |
| --- | --- | --- |
| **Prompt config** | The reusable instructions and tone rules for the task | "Answer as a support copilot, cite policy ids, ask for review before discounts." |
| **Runtime input** | The customer message and trusted context for this turn | Chat text, customer id, channel, locale, open case id |
| **Retrieval** | Search over policy or help-center content | Return policy, warranty page, shipping SLA document |
| **Tools** | Typed calls into business systems | `lookup_order`, `create_replacement_case`, `handoff_to_agent` |
| **Structured output** | Machine-readable result for the product UI | Draft reply, citations, confidence, next action |
| **Memory and state** | What the app carries across turns | Case summary, prior confirmed order id, last handoff reason |
| **Guardrails** | Checks that block, redact, or route risky work | PII redaction, policy exception review, unsafe content filter |
| **Evals** | Repeatable examples that measure quality | 200 support questions with expected policy citations |
| **Tracing** | A record of the actual run | Model, prompt version, retrieval ids, tool calls, latency, cost |
| **Release controls** | Rules for changing models, prompts, tools, and indexes | Canary rollout, rollback prompt label, cost alert |

This map also gives you a good review checklist. If the team cannot say which prompt version answered a customer, the prompt layer needs work. If the model can request a refund without an approval path, the tool and guardrail layers need work. If a bad answer cannot be reproduced, tracing and evals need work. Each missing piece creates a different production failure.

The important design habit is to keep **business authority** outside the model. The model can draft, classify, and request tool calls. The application owns permission checks, tool execution, database writes, and final display decisions. That split gives the product team room to improve model behavior without giving the model unrestricted access to customer accounts.

## The Responses API Shape

<!-- section-summary: A Responses API-style app gives the model instructions, user input, tools, and schema expectations in one request shape. Your server still owns tool execution, retries, logging, and approval decisions. -->

In 2026, a new OpenAI-backed LLM app usually starts from the **Responses API** or a higher-level agent runtime built on top of it. The Responses API is useful because it treats model output, tool calls, and multi-turn context as typed items instead of treating every result as one plain assistant message. That matters for BrightCart because the copilot might answer directly, ask to search policy docs, request an order lookup, or request a replacement-case tool.

Here is a small TypeScript sketch for the first model turn. The code is intentionally server-side. Browser code sends a support question to BrightCart's own backend, and the backend calls the model with only the data this user and support agent can access.

```ts
import OpenAI from "openai";

const client = new OpenAI();

const supportPrompt = {
  name: "brightcart-support-copilot",
  version: "2026-07-returns-v4",
  text: `
You draft support replies for BrightCart agents.
Use policy citations from file search when return or warranty rules matter.
Ask for human review before discounts, refunds, account credits, or policy exceptions.
Return concise answers that a support agent can edit before sending.
`
};

const lookupOrderTool = {
  type: "function",
  name: "lookup_order",
  description: "Look up shipment, replacement, and return status for one BrightCart order.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      order_id: { type: "string" },
      customer_id: { type: "string" }
    },
    required: ["order_id", "customer_id"],
    additionalProperties: false
  }
} as const;

const response = await client.responses.create({
  model: "gpt-5.5",
  instructions: supportPrompt.text,
  input: [
    {
      role: "user",
      content:
        "Customer C-1188 says order BC-77124 arrived damaged after partial assembly. They ask whether they can return it and whether the replacement has shipped."
    }
  ],
  tools: [
    {
      type: "file_search",
      vector_store_ids: [process.env.BRIGHTCART_POLICY_VECTOR_STORE_ID!],
      max_num_results: 4
    },
    lookupOrderTool
  ],
  parallel_tool_calls: false,
  prompt_cache_key: `support:${supportPrompt.name}:${supportPrompt.version}`
});
```

There are several production choices packed into this example. The prompt has a name and version because support leaders will tune it over time. The file-search tool points at a policy vector store so the model can retrieve current support rules instead of relying on training data. The custom order tool uses a strict JSON Schema because your server needs predictable arguments before it calls BrightCart's order system. The request also disables parallel custom tool calls for this path because order lookup and policy interpretation should stay easy to trace in a customer-support case.

The first model response may include a function call. Your application then runs the tool after checking permissions. The tool result goes back to the model as a tool output item, and the next response can draft the answer with the returned status.

```ts
type LookupArgs = {
  order_id: string;
  customer_id: string;
};

for (const item of response.output) {
  if (item.type !== "function_call" || item.name !== "lookup_order") continue;

  const args = JSON.parse(item.arguments) as LookupArgs;
  const order = await orders.getSupportSafeOrder(args.customer_id, args.order_id);

  const final = await client.responses.create({
    model: "gpt-5.5",
    previous_response_id: response.id,
    input: [
      {
        type: "function_call_output",
        call_id: item.call_id,
        output: JSON.stringify({
          order_id: order.orderId,
          shipment_status: order.shipmentStatus,
          replacement_status: order.replacementStatus,
          return_window_days_left: order.returnWindowDaysLeft
        })
      }
    ]
  });

  console.log(final.output_text);
}
```

The model never receives the whole customer record. The tool returns only fields needed for the answer. The application can log the tool call, enforce a support-agent permission check, and redact fields before sending them back. That is the shape you will see again and again in LLMOps: the model proposes or uses typed interfaces, while application code decides what can actually happen.

## Retrieval Gives The Model Current Context

<!-- section-summary: Retrieval gives the model trusted, current documents at request time. It helps support answers cite policies, while chunk quality and source freshness decide whether the result is useful. -->

LLMs know patterns from training, while BrightCart's support rules change every week. That gap is why **retrieval** matters. Retrieval means the application searches trusted documents, finds relevant chunks, and gives those chunks to the model for the current request. For BrightCart, those documents include return rules, warranty exceptions, assembly instructions, shipping carrier SLAs, and policy updates from legal.

The simplest production choice is to use a managed file-search tool when it fits. OpenAI's file search works with vector stores and can combine semantic and keyword search, so the model can search uploaded knowledge-base files during the Responses request. A larger company may use its own retrieval stack with Postgres, Elasticsearch, Pinecone, Weaviate, or a warehouse-backed index. The principle stays the same: the model should answer from **retrieved evidence** when policy or company data matters.

A good retrieval setup starts before the model call. BrightCart should split policy docs into chunks with stable ids, store each chunk with metadata, and record the source version. A support answer should cite `returns-policy-2026-06-18#assembled-items`, rather than a vague "according to our policy" sentence. That citation gives support agents and auditors a place to check the answer.

```json
{
  "chunk_id": "returns-policy-2026-06-18#assembled-items",
  "title": "Returns after partial assembly",
  "source_uri": "kb://returns-policy/2026-06-18",
  "effective_from": "2026-06-18",
  "owner": "support-operations",
  "text": "Partially assembled furniture can be returned within 30 days when damage is reported with photos before full use."
}
```

Retrieval quality has its own evals. BrightCart should test whether the right chunks appear for questions like "assembled chair cracked," "missing screws after assembly," and "replacement package delayed." The answer model cannot reliably cite a policy chunk that retrieval never found. In real incidents, teams often learn that the model sounded wrong because the index was stale, the chunk title was weak, or a synonym was missing from the document text.

## Tools Turn Text Into Actions

<!-- section-summary: Tools let an LLM system read or act through typed business APIs. The safest pattern is narrow tools, strict schemas, permission checks, idempotency keys, and human review for side effects. -->

A **tool** is a function the model can request through a typed contract. Tools are how BrightCart's copilot moves from "I can talk about orders" to "I can look up this order" or "I can prepare a replacement case." Tools make LLM apps useful, and they also create most of the operational risk.

Start with narrow read tools. `lookup_order` can return shipment status and return-window data. `search_policy` can return policy chunks if you own retrieval yourself. `get_case_history` can return the last few support notes. These tools help the model answer with current data, while their blast radius is small.

Write tools need stricter control. `create_replacement_case` affects a customer workflow. `issue_refund` affects money. `send_customer_email` affects external communication. Those tools should use human approval, queue-based execution, idempotency keys, and explicit audit records. The model can draft the tool request; your product decides whether it runs.

![BrightCart tool call gate](/content-assets/articles/article-mlops-llmops-llm-systems-2026/brightcart-tool-call-gate.png)

*Tool calls stay safe when the backend validates schema, permissions, idempotency, and audit evidence before business systems act.*

```ts
const createReplacementCaseTool = {
  type: "function",
  name: "create_replacement_case",
  description: "Prepare a replacement case for a damaged item after agent approval.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      customer_id: { type: "string" },
      order_id: { type: "string" },
      item_sku: { type: "string" },
      damage_category: {
        type: "string",
        enum: ["shipping_damage", "manufacturing_defect", "missing_parts"]
      },
      evidence_ids: {
        type: "array",
        items: { type: "string" }
      },
      proposed_resolution: {
        type: "string",
        enum: ["replacement", "refund_review", "agent_follow_up"]
      }
    },
    required: [
      "customer_id",
      "order_id",
      "item_sku",
      "damage_category",
      "evidence_ids",
      "proposed_resolution"
    ],
    additionalProperties: false
  }
} as const;
```

That schema teaches the model the exact shape of the request. It also teaches your server what to validate. If the model asks for `proposed_resolution: "free_coupon"` the request fails schema validation. If it asks for a refund review, your application can route it to a senior support queue. If the same request retries after a network timeout, the idempotency key prevents duplicate cases.

Tool design is one of the most interview-friendly parts of LLMOps because it reveals whether someone understands production software. A good answer talks about schemas, auth, least privilege, human approvals, retries, idempotency, rate limits, and audit logs. A weak answer says "let the agent call the API" and stops there.

## Memory, Privacy, And State

<!-- section-summary: Memory is application state with a retention policy. Teams should store only useful, allowed facts, and they should separate short-term case context from long-term customer preferences. -->

People use the word **memory** in many ways, so define it plainly. In an LLM system, memory is the information your application carries across turns or sessions. BrightCart's copilot may remember that the active case is about order `BC-77124`, that the customer already uploaded two photos, and that the support agent has confirmed the item SKU. That memory helps the next turn stay focused.

Memory should have scope. **Working memory** lives inside one support case. It can include a short summary, confirmed order ids, retrieved policy ids, and pending tool approvals. **Long-term memory** crosses sessions and needs stronger privacy review. It might include a customer's language preference or accessibility preference. It should avoid sensitive facts unless the product has a clear user benefit, consent path, retention rule, and deletion path.

Here is a small case-state record that stays outside the model and gets selectively injected into future requests.

```json
{
  "case_id": "case_90217",
  "customer_id": "C-1188",
  "confirmed_order_ids": ["BC-77124"],
  "case_summary": "Customer reports cracked chair leg after partial assembly and asks about return plus replacement status.",
  "retrieved_policy_ids": ["returns-policy-2026-06-18#assembled-items"],
  "pending_approval": {
    "type": "replacement_case",
    "requested_by": "support-copilot",
    "status": "waiting_for_agent"
  }
}
```

The data-control question is part of the architecture. If you use a provider's stateful conversation feature, read the retention rules and decide whether that fits your product. If your organization has Zero Data Retention requirements, you may need to send full allowed context each turn and store state in your own systems. If you connect MCP servers, connectors, or hosted tools, data sent to those services follows their own policies too. A production design review should write those choices down before launch.

## Evals, Traces, And Prompt Versions

<!-- section-summary: Evals and traces turn subjective LLM behavior into reviewable evidence. Prompt versions give teams a way to connect a behavior change to the exact instructions, tools, retrieval index, and model used in a run. -->

An **eval** is a structured test for model behavior. Traditional unit tests check deterministic code. LLM evals check whether a system gives acceptable answers across realistic examples, including edge cases and adversarial inputs. BrightCart needs evals for policy accuracy, citation quality, tool-use correctness, escalation behavior, refusal behavior, latency, and cost.

A tiny eval dataset might look like this:

```yaml
suite: brightcart_support_copilot
prompt_version: 2026-07-returns-v4
cases:
  - id: assembled_damaged_chair
    input: "The chair leg cracked after I assembled half of it. Can I return it?"
    expected:
      required_policy_ids:
        - returns-policy-2026-06-18#assembled-items
      must_include:
        - "photo"
        - "30 days"
      tool_calls:
        lookup_order: optional
      requires_human_review: false
  - id: refund_exception_request
    input: "The return window closed yesterday. Give me a refund anyway."
    expected:
      required_policy_ids:
        - returns-policy-2026-06-18#late-exceptions
      requires_human_review: true
      disallowed_actions:
        - "issue_refund"
```

You can score these examples with rule checks, human review, LLM-as-judge graders, or a combination. The strongest teams start with simple checks that match product risk. Did the answer cite the correct policy? Did it avoid promising a refund? Did it ask for a human review when money was involved? Did it call only allowed tools? These checks help catch regressions when you change prompts, models, retrieval chunks, or tool schemas.

**Tracing** gives you the runtime story for one request. A useful trace shows the prompt version, model, user channel, retrieval query, retrieved chunk ids, tool calls, tool outputs, guardrail results, latency, token usage, and final answer id. OpenAI's Agents SDK includes tracing for model calls, tool calls, handoffs, guardrails, and custom spans. Teams that use other stacks often send similar data through OpenTelemetry, Langfuse, Phoenix, LangSmith, or a warehouse table.

```ts
span.setAttributes({
  "app.workflow": "support_copilot_reply",
  "app.prompt.name": supportPrompt.name,
  "app.prompt.version": supportPrompt.version,
  "app.case_id": "case_90217",
  "gen_ai.request.model": "gpt-5.5",
  "gen_ai.response.id": response.id,
  "llm.retrieval.chunk_ids": [
    "returns-policy-2026-06-18#assembled-items"
  ].join(","),
  "llm.tool.names": ["lookup_order"].join(",")
});
```

Prompt versions close the loop. BrightCart should store prompts in code, a prompt-management system, or a configuration service with review and labels. A prompt change should have a diff, an owner, an eval report, and a rollback label. If the support team says, "The copilot started over-escalating returns this morning," engineering should compare prompt version `2026-07-returns-v4` against `2026-06-returns-v3`, review traces, and roll back the active label if needed.

## Cost, Latency, And Deployment Checks

<!-- section-summary: Production LLM systems need budgets and launch gates, just like any other customer-facing service. The team should control context size, cache stable prefixes, route models by task, batch offline jobs, and ship behind observability. -->

LLM systems have two costs that users feel quickly: money and waiting time. BrightCart's support copilot might run thousands of requests each hour during a holiday sale. If every request sends a huge policy dump, calls the largest reasoning model, runs multiple tool loops, and waits for slow downstream APIs, the support queue will feel sluggish and finance will notice the usage bill.

Cost control starts with input design. Keep stable prompt content at the front so prompt caching can help. Retrieve a few high-quality chunks rather than twenty weak chunks. Use smaller or faster models for classification and routing, and reserve stronger reasoning models for complex cases. Use asynchronous batch processing for offline evals, nightly policy checks, or large classification jobs. Record `input_tokens`, `cached_tokens`, `output_tokens`, latency, model, prompt version, and route name for each run.

```yaml
routes:
  support_triage:
    model: gpt-5.4-mini
    max_output_tokens: 220
    timeout_ms: 2500
    fallback: rules_based_queue
  support_policy_answer:
    model: gpt-5.5
    retrieval_max_chunks: 4
    max_output_tokens: 700
    timeout_ms: 7000
    fallback: handoff_to_agent
  support_case_summary:
    model: gpt-5.4-mini
    batch_ok: true
    max_output_tokens: 300
```

Deployment needs the same care. Before BrightCart launches the copilot to all agents, it should run an eval suite, compare traces against the previous prompt version, run a small canary, set cost and latency alerts, test the human handoff path, and practice rollback. The rollback should include prompt label rollback, retrieval-index rollback, and tool kill switches. A model change alone can shift tool-call frequency, so the canary should measure tool counts and escalation rates, not only answer ratings.

Use this launch checklist for a first production LLM system:

- Prompt version has an owner, changelog, and rollback label.
- Tool schemas use strict validation, least-privilege auth, and idempotency keys.
- Retrieval chunks have stable ids, source versions, and freshness checks.
- Evals cover happy paths, edge cases, unsafe requests, tool failures, and policy conflicts.
- Traces capture prompt version, model, retrieval ids, tool calls, latency, token usage, and safety outcomes.
- Human approval exists for refunds, credits, cancellations, and external messages.
- Cost alerts watch total spend, route-level spend, cache hit rate, and output-token spikes.
- A fallback path sends the case to a human agent when the model, retrieval, or tools fail.

![BrightCart copilot operating loop](/content-assets/articles/article-mlops-llmops-llm-systems-2026/brightcart-copilot-ops-loop.png)

*The launch loop ties quality, rollout, traces, cost, latency, and rollback to the same copilot release.*

## Practical Checks, Common Mistakes, And Interview-Ready Understanding

The practical check for this article is simple: take any LLM feature and draw the system around it. Name the prompt, model route, retrieval source, tool contracts, state store, guardrails, eval suite, tracing fields, cost controls, and rollback path. If one of those boxes is empty, you have found the next engineering task.

Common mistakes usually come from treating the model as the whole product. Teams hardcode prompts with no version history. They paste entire documents into every request and skip retrieval quality checks. They give broad tools to the model and rely on the prompt for safety. They save conversation state without a privacy review. They run a few manual demos and call that evaluation. They log raw customer data without trace hygiene. Each mistake has a straightforward fix: turn hidden behavior into a typed, reviewable contract.

In an interview, explain LLM systems with BrightCart's copilot shape. "The model drafts and reasons, retrieval gives current policy context, tools connect to order systems through strict schemas, the app enforces permissions and approvals, memory is scoped state with retention rules, evals test behavior over examples, traces show what happened, and deployment controls manage cost, latency, and rollback." That answer shows you understand the system, not only the model call.

## References

- [OpenAI: Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI: File search](https://developers.openai.com/api/docs/guides/tools-file-search)
- [OpenAI: Retrieval](https://developers.openai.com/api/docs/guides/retrieval)
- [OpenAI: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI: Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [OpenAI: Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI: Safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
- [OpenTelemetry: Semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
