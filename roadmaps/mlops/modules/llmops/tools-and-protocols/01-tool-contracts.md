---
title: "Tool Contracts"
description: "Design LLM tool calls as production interfaces with schemas, permissions, idempotency, result envelopes, versioning, and validation tests."
overview: "Learn how to turn an LLM tool from a fragile function call into a production contract, using a travel booking assistant that searches fares, reserves seats, and returns auditable results."
tags: ["MLOps","LLMOps","advanced","tools"]
order: 1
id: "article-mlops-llmops-tool-contracts"
---

## What a Tool Contract Is

<!-- section-summary: A tool contract is the agreement between the model, your application, and the system that runs the action. It says which inputs are accepted, which permissions are required, how retries work, and what the tool returns. -->

A **tool contract** is the production interface for an LLM tool. When an agent asks to call a tool, the contract tells your application the name of the action, the JSON shape of the arguments, the security scope needed to run it, the retry behavior, and the shape of the result. You can think of it as the API boundary that protects your real system from vague model output.

In simple demos, a tool might look like a Python function named `get_weather(city)`. In a production travel assistant, a tool can reserve a flight, hold a hotel room, charge a card, or cancel an itinerary. Those actions touch money, inventory, customer data, and partner APIs. The LLM can suggest the action, yet your application still owns validation, authorization, execution, logging, and recovery.

The important shift is this: the model writes a proposed call, and your runtime decides whether that call is valid. Current OpenAI function calling uses tool definitions with JSON Schema so the model can produce structured arguments, and Structured Outputs can enforce schema adherence when strict schemas are supported. That gives you a strong starting point, yet you still need your own business validation. A schema can say that `departure_date` is a string in date format. Your travel system must still check seat availability, fare rules, customer payment state, and whether the user has approved the final price.

In this article, we will build a contract for **TripNest**, a travel booking assistant used by a support team. TripNest helps agents search trip options and place short booking holds for customers. The running tool is `create_booking_hold`. It can reserve a flight-and-hotel package for 15 minutes while the human agent confirms names, passports, loyalty numbers, and payment approval. That is a good teaching example because a booking hold has real side effects, a clear retry story, and strict permission needs.

## The Contract Surface in One Place

<!-- section-summary: A useful contract keeps the model-facing schema, server-side policy, result shape, and operational ownership together. Splitting those pieces across random files makes tool failures hard to debug. -->

Before writing the schema, map the pieces that a real team needs to own. The LLM sees only part of the contract. Your backend, security team, support operations team, and observability system need the rest.

| Contract part | What it answers | TripNest example |
| --- | --- | --- |
| Tool name and purpose | Which action can the model request? | `create_booking_hold` reserves a package for 15 minutes. |
| Input schema | Which arguments can the model send? | Traveler count, flight option ID, hotel option ID, date range, currency, customer approval flag. |
| Business validation | Which valid JSON still needs rejection? | Hold price must match the quoted option, and travel dates must fit the selected fare. |
| Auth scopes | Who can run it? | Support agents with `travel.booking_hold:create`. |
| Idempotency | How do retries avoid duplicate holds? | A client-generated `idempotency_key` links repeated attempts to the same hold. |
| Result envelope | How does the runtime report success, user-fixable errors, and system errors? | `status`, `data`, `error`, `trace_id`, and `retry_after_seconds`. |
| Versioning | How do clients survive contract changes? | `tool_version: "2026-07-01"` and additive fields first. |
| Audit ownership | Who investigates a bad call? | Travel platform owns execution logs; LLMOps owns tool selection traces. |

This map keeps the article grounded. We are designing more than a JSON blob. We are designing the path from a user's sentence to a safe business operation. If the customer says, "Hold the cheapest London to Tokyo option for two adults next Thursday," the model may pick a tool, fill arguments, and ask your runtime to execute it. The runtime then applies the contract.

![TripNest create_booking_hold tool contract pipeline](/content-assets/articles/article-mlops-llmops-tool-contracts/tool-contract-pipeline.png)

*TripNest keeps the model on the request side while the server validates the schema, runs business checks, creates the hold, and returns a traceable envelope.*

## The Model-Facing JSON Schema

<!-- section-summary: The schema is the part of the contract the model sees directly. It should use narrow fields, clear descriptions, enums, required properties, and strict handling of extra arguments. -->

A **JSON Schema** tells the model and your validator what the arguments must look like. A beginner mistake is to expose a loose object such as `{ "query": "book something" }`. That gives the model too much room and gives your backend too little evidence. A stronger contract gives each business choice its own field.

Here is the TripNest tool definition in an OpenAI-style function tool shape. The exact SDK wrapper can vary, yet the contract ideas stay the same: name, description, schema, required fields, and strict validation.

```json
{
  "type": "function",
  "name": "create_booking_hold",
  "description": "Create a 15-minute hold for a quoted flight and hotel package after the customer approves the quoted price.",
  "strict": true,
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "tool_version": {
        "type": "string",
        "enum": ["2026-07-01"],
        "description": "Contract version expected by the caller."
      },
      "customer_id": {
        "type": "string",
        "pattern": "^cus_[a-zA-Z0-9]{12,32}$",
        "description": "TripNest customer identifier from the active support case."
      },
      "quote_id": {
        "type": "string",
        "pattern": "^quote_[a-zA-Z0-9]{12,32}$",
        "description": "Quote identifier returned by the trip search tool."
      },
      "flight_option_id": {
        "type": "string",
        "pattern": "^fltopt_[a-zA-Z0-9]{12,32}$",
        "description": "Selected flight option from the quote."
      },
      "hotel_option_id": {
        "type": "string",
        "pattern": "^hotelopt_[a-zA-Z0-9]{12,32}$",
        "description": "Selected hotel option from the quote."
      },
      "traveler_count": {
        "type": "integer",
        "minimum": 1,
        "maximum": 6,
        "description": "Number of travelers included in the hold."
      },
      "approved_total": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "amount": { "type": "number", "minimum": 0 },
          "currency": { "type": "string", "enum": ["USD", "GBP", "EUR", "JPY"] }
        },
        "required": ["amount", "currency"]
      },
      "customer_approved": {
        "type": "boolean",
        "const": true,
        "description": "True only after the customer approves the quoted total in the conversation."
      },
      "idempotency_key": {
        "type": "string",
        "pattern": "^hold_[0-9a-f]{32}$",
        "description": "Stable key generated by the application for this hold attempt."
      }
    },
    "required": [
      "tool_version",
      "customer_id",
      "quote_id",
      "flight_option_id",
      "hotel_option_id",
      "traveler_count",
      "approved_total",
      "customer_approved",
      "idempotency_key"
    ]
  }
}
```

This schema teaches the model exactly what to supply. It also helps your runtime reject unclear calls before they reach the booking engine. `additionalProperties: false` blocks surprise fields. `enum` narrows currencies and versions. `const: true` encodes the approval rule into the shape of the call. The `pattern` fields keep IDs from accepting arbitrary user text.

Schema design also shapes the conversation. If the model lacks a `quote_id`, it should search trips first. If `customer_approved` is missing, it should ask the human agent to confirm the price with the customer. The contract gives the model a route through the workflow without letting it invent business state.

## Server-Side Validation and Idempotency

<!-- section-summary: Schema validation catches malformed calls, while business validation catches risky calls that still match the schema. Idempotency keys make retries safe when a network call times out. -->

Schema validation is the first gate. After the JSON matches the schema, server-side checks decide whether the action is allowed right now. In TripNest, the booking service loads the quote, verifies that the selected options still match the approved total, checks that the support case belongs to the customer, and confirms that the agent has the right scope.

Idempotency matters because tool calls happen over networks. Imagine the model requests a booking hold, the booking partner creates the hold, and your server times out before the response reaches the agent. The agent runtime may retry. Without an idempotency key, the second call could create another hold and tie up more inventory. With an idempotency key, the booking service can return the original result.

Here is a small TypeScript validation shape using `ajv`. It shows the split between schema validation and business validation.

```ts
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateCreateBookingHold = ajv.compile(createBookingHoldSchema);

export async function runCreateBookingHold(args, ctx) {
  if (!validateCreateBookingHold(args)) {
    return toolError({
      code: "invalid_arguments",
      message: "The booking hold request has fields that fail the contract.",
      details: validateCreateBookingHold.errors,
      traceId: ctx.traceId
    });
  }

  await requireScope(ctx.auth, "travel.booking_hold:create");

  const quote = await ctx.quotes.get(args.quote_id);
  const priceMatches =
    quote.total.amount === args.approved_total.amount &&
    quote.total.currency === args.approved_total.currency;

  if (!priceMatches) {
    return toolError({
      code: "price_changed",
      message: "The quoted total changed before the hold was created.",
      details: { latest_total: quote.total },
      traceId: ctx.traceId
    });
  }

  return ctx.bookingHolds.createOrReplay({
    idempotencyKey: args.idempotency_key,
    customerId: args.customer_id,
    quoteId: args.quote_id,
    flightOptionId: args.flight_option_id,
    hotelOptionId: args.hotel_option_id,
    travelerCount: args.traveler_count,
    traceId: ctx.traceId
  });
}
```

The important production pattern is `createOrReplay`. That function checks whether the idempotency key already produced a hold. If yes, it returns the stored hold. If the key exists with different arguments, it returns an idempotency conflict because the caller reused a key for a different action.

Validation tests should live next to the contract. Treat them like API tests, because a broken tool schema can cause a broken agent release.

```ts
describe("create_booking_hold contract", () => {
  it("accepts a complete approved hold request", () => {
    const request = {
      tool_version: "2026-07-01",
      customer_id: "cus_abCDef123456",
      quote_id: "quote_abc123DEF456",
      flight_option_id: "fltopt_abc123DEF456",
      hotel_option_id: "hotelopt_abc123DEF456",
      traveler_count: 2,
      approved_total: { amount: 2480.75, currency: "GBP" },
      customer_approved: true,
      idempotency_key: "hold_0123456789abcdef0123456789abcdef"
    };

    expect(validateCreateBookingHold(request)).toBe(true);
  });

  it("rejects extra model-invented fields", () => {
    const request = validHoldRequest({
      special_discount_reason: "customer sounded loyal"
    });

    expect(validateCreateBookingHold(request)).toBe(false);
  });

  it("rejects a hold without approval", () => {
    const request = validHoldRequest({ customer_approved: false });

    expect(validateCreateBookingHold(request)).toBe(false);
  });
});
```

Notice how the tests cover model-specific risks. The model might invent an extra field. It might try to continue the flow before approval. It might use a stale quote. Tests give you a fast signal before an agent rollout reaches support staff.

![TripNest server-side validation and idempotency flow](/content-assets/articles/article-mlops-llmops-tool-contracts/server-validation-idempotency.png)

*The booking runtime checks structure first, then business rules, then the idempotency ledger so a retry can replay the same hold without reserving duplicate inventory.*

## Result Envelopes

<!-- section-summary: A result envelope gives the agent a stable way to understand success, user-fixable errors, system errors, and retry guidance. It also carries trace IDs for debugging. -->

The tool result needs as much design care as the input. A raw partner response can be large, inconsistent, and full of details the model should never see. A **result envelope** is a stable wrapper around every tool response. It tells the agent whether the action worked, which data can be shown to the user, which error can be fixed by asking another question, and which trace ID an engineer can use during an incident.

Here is a result envelope for the booking hold.

```json
{
  "status": "success",
  "tool_name": "create_booking_hold",
  "tool_version": "2026-07-01",
  "trace_id": "trc_7f0e8b1e2c914f2c9ad3b5a6d44e7801",
  "idempotency_key": "hold_0123456789abcdef0123456789abcdef",
  "data": {
    "hold_id": "hold_live_8x3Kp19Q",
    "expires_at": "2026-07-05T16:45:00Z",
    "approved_total": { "amount": 2480.75, "currency": "GBP" },
    "customer_message": "I placed a 15-minute hold for the selected flight and hotel package."
  },
  "error": null,
  "retry_after_seconds": null
}
```

Here is the same envelope shape for a user-fixable error.

```json
{
  "status": "rejected",
  "tool_name": "create_booking_hold",
  "tool_version": "2026-07-01",
  "trace_id": "trc_4728d3651f5c4a07ad6c2f4141f3a192",
  "idempotency_key": "hold_0123456789abcdef0123456789abcdef",
  "data": null,
  "error": {
    "code": "price_changed",
    "message": "The selected package total changed before the hold was created.",
    "user_action": "Ask the customer to approve the latest total before creating a hold.",
    "latest_total": { "amount": 2522.10, "currency": "GBP" }
  },
  "retry_after_seconds": null
}
```

The model can use `user_action` to continue the support conversation. It should never need to parse a partner API error such as `FARE_BUCKET_17_EXPIRED`. Your envelope translates partner details into the next safe step.

For system failures, keep the customer message calm and push details into logs.

```json
{
  "status": "failed",
  "tool_name": "create_booking_hold",
  "tool_version": "2026-07-01",
  "trace_id": "trc_e4d78b71f4c24b57951e9b2c6f55819a",
  "idempotency_key": "hold_0123456789abcdef0123456789abcdef",
  "data": null,
  "error": {
    "code": "partner_timeout",
    "message": "The booking partner timed out while creating the hold.",
    "user_action": "Tell the agent that the hold status is unknown and route the case to the travel desk."
  },
  "retry_after_seconds": 30
}
```

The `trace_id` connects the model run, the tool call, the booking service request, partner API logs, and audit records. If your team uses OpenTelemetry, carry that trace context through the tool runtime and record GenAI/tool spans with consistent names and attributes. The exact attributes will evolve with the semantic conventions, so keep your instrumentation library current and wrap provider-specific fields in one telemetry module.

## Auth Scopes and Approval Rules

<!-- section-summary: Tool contracts need security metadata because tool calls can read private data or change real systems. Scopes, approval gates, and audit fields keep that access reviewable. -->

A model-facing schema can describe what the tool does, yet the runtime still needs security policy. TripNest uses scopes that line up with business operations. A support agent who can search trips might lack permission to create holds. A supervisor might create holds up to a certain amount. A payment tool would need a separate scope and a stronger approval gate.

Here is a simple scope manifest that can live in the tool registry.

```yaml
tool: create_booking_hold
version: "2026-07-01"
owner: travel-platform
runtime_service: tripnest-booking-tools
required_scopes:
  - travel.booking_hold:create
approval:
  required: true
  source: active_support_case
  evidence_fields:
    - customer_approved
    - approved_total
    - quote_id
limits:
  max_travelers: 6
  max_hold_minutes: 15
  max_total_without_supervisor:
    amount: 5000
    currency: GBP
audit:
  log_arguments: redacted
  log_result: envelope_only
  pii_fields:
    - customer_id
```

This manifest helps reviewers answer concrete questions. Which team owns the tool? Which service runs it? Which scope unlocks it? Which fields count as approval evidence? Which fields need redaction? During a security review, the team can compare this manifest to the code path and the logs.

For approval, avoid relying on the model's confidence. A safe runtime checks evidence. The UI can show the exact quoted total and require the human agent to press an approval button. The tool call then receives `customer_approved: true` from the application state, rather than from a model guess. The model can request the action, while the application supplies trusted evidence.

## Versioning and Change Management

<!-- section-summary: Versioning lets you improve tool contracts without breaking active clients. Additive changes are easiest; renamed fields and changed meanings need a new version and a migration window. -->

Tool contracts need versioning because agent prompts, schemas, validators, and dashboards move together. If you rename `approved_total` to `total`, an older agent may keep sending the old field. If you add a required `passport_country` field, an older UI may lack the data. A version lets both sides know which contract they are using.

Use a clear version string such as a date. Date versions are easy for humans to compare during incidents. TripNest uses `2026-07-01`. The booking service accepts that version and rejects unknown versions with a result envelope that tells the agent to refresh tool definitions.

```json
{
  "status": "rejected",
  "tool_name": "create_booking_hold",
  "tool_version": "2026-06-01",
  "trace_id": "trc_6cfdd62e12d64b03a50f5892fd4562d5",
  "data": null,
  "error": {
    "code": "unsupported_tool_version",
    "message": "The caller used an older booking hold contract.",
    "user_action": "Reload the tool catalog and retry with version 2026-07-01."
  },
  "retry_after_seconds": null
}
```

Prefer additive changes when possible. Adding an optional field such as `loyalty_program_id` gives clients time to adopt it. Changing the meaning of an existing field needs a new version because old traces, tests, and dashboards will otherwise lie to you. Keep a small compatibility matrix in the registry so release managers know which agent version can call which tool version.

## Practical Checks, Common Mistakes, and Interview-Ready Understanding

<!-- section-summary: A strong tool contract is testable, auditable, and boring during incidents. The best interview answer ties schemas to permissions, idempotency, envelopes, traces, and rollout discipline. -->

Use this checklist before shipping an LLM tool that touches production systems:

- **Schema:** The tool has a JSON Schema with required fields, descriptions, enums, ranges, and `additionalProperties: false`.
- **Business validation:** The service checks real state after schema validation, including price, ownership, approval, inventory, and policy limits.
- **Idempotency:** Every side-effecting call includes an idempotency key, and the backend can replay or reject conflicting retries.
- **Result envelope:** Success, rejected calls, and system failures all use the same envelope shape with `status`, `data`, `error`, `trace_id`, and retry guidance.
- **Auth scopes:** A manifest lists required scopes, owners, approval sources, limits, and redaction rules.
- **Audit logs:** Logs connect user ID, support case ID, tool name, tool version, idempotency key, trace ID, and redacted arguments.
- **Versioning:** The registry lists active versions, compatibility, deprecation dates, and migration notes.
- **Tests:** Contract tests reject extra fields, missing approval, unsupported versions, stale prices, and reused idempotency keys with different arguments.

Common mistakes usually show up as missing boundaries. Teams expose one giant `do_travel_task` tool and wonder why the agent sends messy requests. They put secrets in tool arguments instead of server-side credentials. They return raw partner errors and expect the model to decide which ones are safe to show. They skip idempotency and create duplicate side effects after a timeout. They log full customer data in traces and create a privacy problem while trying to debug the agent.

In an interview, a strong answer sounds practical: "I would treat tool calling as an API contract. The model gets a strict JSON Schema, while the runtime enforces auth, business validation, idempotency, and approval. Every tool returns a stable result envelope with a trace ID. I would version the contract, test it in CI, and audit every side-effecting call." That answer shows that you understand both the LLM side and the production systems side.

![TripNest tool contract release readiness checklist](/content-assets/articles/article-mlops-llmops-tool-contracts/release-readiness.png)

*A release-ready tool contract has schema tests, scoped auth, approval evidence, envelope checks, trace logs, and a rollback path tied to the same contract version.*

## References

- [OpenAI API docs: Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI API docs: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API docs: Using tools](https://developers.openai.com/api/docs/guides/tools)
- [OpenAI Agents SDK: Tools](https://openai.github.io/openai-agents-python/tools/)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
- [OpenTelemetry blog: GenAI observability](https://opentelemetry.io/blog/2026/genai-observability/)
