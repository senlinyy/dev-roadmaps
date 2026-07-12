---
title: "Agent Harness Basics"
description: "Learn how the application layer around an LLM controls agent steps, state, tools, retries, approvals, traces, and safe recovery paths."
overview: "An agent harness is the production software around a model call. This tutorial follows an ecommerce support assistant through the harness loop: state, tool calls, retries, checkpoints, permission checks, audit logs, and human approval."
tags: ["MLOps","LLMOps","advanced","harness"]
order: 1
id: "article-mlops-llmops-agent-harness-basics"
---

## Table of Contents

1. [Why Agent Harnesses Exist](#why-agent-harnesses-exist)
2. [The Ecommerce Support Scenario](#the-ecommerce-support-scenario)
3. [The Agent Loop](#the-agent-loop)
4. [State and Checkpoints](#state-and-checkpoints)
5. [Tool Calls and Typed Results](#tool-calls-and-typed-results)
6. [Retries, Timeouts, and Idempotency](#retries-timeouts-and-idempotency)
7. [Permissions and Human Approval](#permissions-and-human-approval)
8. [Traces and Audit Events](#traces-and-audit-events)
9. [Practical Checks, Common Mistakes, and Interview Readiness](#practical-checks-common-mistakes-and-interview-readiness)
10. [References](#references)

## Why Agent Harnesses Exist
<!-- section-summary: An agent harness is the application runtime around an LLM. It owns state, tools, permissions, recovery, and evidence. -->

An **agent harness** is the software layer around a language model that lets the model do useful multi-step work. The model can read a request, reason about the next action, and ask for a tool call. The harness receives that request, checks whether the action is allowed, runs the tool in your application environment, records what happened, and feeds the result back into the next model turn.

That definition matters because a production agent is more than a prompt. A support assistant that can only draft a message is a chat feature. A support assistant that can check an order, inspect shipment events, prepare a refund, pause for approval, and explain the final decision needs a runtime. That runtime is the harness.

The current OpenAI platform splits the work in a useful way. The Responses API gives you direct model requests with tools when your application owns the loop. The Agents SDK gives you a higher-level runtime when your server owns orchestration, tool execution, state, approvals, and tracing. Those are different starting points for the same engineering problem: the model proposes work, and your application controls how work actually runs.

For a beginner, the safest way to picture the harness is as the shift lead around the model. The model can suggest the next move. The harness holds the checklist, the allowed tools, the customer record boundaries, the timeout rules, and the approval workflow. When the model asks for a risky action, the harness can stop, ask a person, or return a structured refusal to the model.

The harness gives you three production gifts. First, it gives you **control**, because tool calls pass through code you own. Second, it gives you **memory for the run**, because every step has structured state. Third, it gives you **evidence**, because traces and audit logs show why an answer was produced.

## The Ecommerce Support Scenario
<!-- section-summary: The running example is a support agent for an online store that handles order questions, delivery issues, and refund preparation. -->

Imagine you work at **BrightCart**, a mid-size ecommerce company selling home office equipment. Customers ask support questions such as "Where is my chair?", "Why was I charged twice?", and "Can I return this desk lamp?" The company already has a support portal, an orders database, a shipment API, a refund service, and a human support team.

The first prototype is a simple chat assistant. A customer writes a message, the model drafts a reply, and a support agent reads it before sending. That helps with tone, yet it leaves the hard work with the human. The human still checks the order page, opens the shipment tracker, looks up the return window, and decides whether a refund needs manager approval.

The second version adds tools. Now the assistant can call `get_order`, `list_shipments`, `check_return_policy`, and `prepare_refund`. That is where the harness matters. The assistant may ask for an order lookup, and that is safe. It may ask to prepare a refund, and that needs policy checks. It may ask to send a refund immediately, and BrightCart wants a human approval when the amount is high or the reason is suspicious.

The core workflow has a few moving parts:

| Piece | Plain-English meaning | BrightCart example |
|---|---|---|
| User request | The customer's message and identity | "My chair arrived damaged" from `customer_8842` |
| Agent state | The run record the harness updates | Intent, order ID, tool results, risk flags |
| Model turn | One call where the model chooses a response or tool | Ask for `get_order` with `order_id` |
| Tool dispatcher | The code that executes allowed tools | Calls the order API with service credentials |
| Policy gate | Deterministic rules before risky actions | Refund over `$150` needs approval |
| Checkpoint | Saved state after a step | Run can resume after a crash or approval wait |
| Trace and audit log | Evidence for debugging and compliance | Tool call ID, duration, policy decision |

Notice how the table separates "thinking" from "doing." The model can propose a tool call because it has enough context to choose a next step. The harness executes the actual business action because it has database credentials, permission rules, retry settings, and logging obligations.

That separation is the first habit to build. The model should never hold production credentials directly. The model should never quietly skip your return policy. The harness receives the model's request, checks the real application rules, and gives the model a structured result it can use for the next turn.

## The Agent Loop
<!-- section-summary: The agent loop repeatedly calls the model, handles tool requests, saves state, and exits only when a final reply or controlled failure is ready. -->

The **agent loop** is the repeatable control flow for a run. A run starts with a user request, then the harness calls the model. The model may answer directly or ask for a tool. If the model asks for a tool, the harness dispatches the tool, records the result, and calls the model again with that result. The loop continues until the agent has a final reply, hits a policy gate, waits for approval, or fails in a controlled way.

OpenAI's tool-calling flow describes the same shape: send tools to the model, receive a tool call, execute application code, send the tool output back, then receive a final response or more tool calls. A harness turns that API flow into a product runtime with named steps, saved state, and rules for each transition.

![BrightCart support agent harness loop](/content-assets/articles/article-mlops-llmops-agent-harness-basics/harness-loop-brightcart.png)

*BrightCart keeps the model turn, policy gate, tool call, checkpoint, final reply, run state, and audit trail inside one controlled harness loop.*

Here is a compact TypeScript sketch for the BrightCart support harness:

```ts
type StepName =
  | "receive_request"
  | "classify_intent"
  | "call_model"
  | "dispatch_tool"
  | "check_policy"
  | "request_human_approval"
  | "compose_reply"
  | "finish"
  | "fail";

type AgentState = {
  runId: string;
  customerId: string;
  message: string;
  step: StepName;
  orderId?: string;
  intent?: "delivery" | "return" | "billing" | "other";
  toolCalls: ToolCallRecord[];
  approvals: ApprovalRecord[];
  riskFlags: string[];
  finalReply?: string;
};

const terminalSteps = new Set<StepName>(["finish", "fail"]);

export async function runSupportAgent(input: CustomerMessage) {
  let state = await createInitialState(input);

  while (!terminalSteps.has(state.step)) {
    const nextState = await runStep(state);
    await saveCheckpoint(nextState);
    await writeTraceEvent(nextState);
    state = nextState;
  }

  return state;
}
```

This code is small, yet it shows the important shape. The state is explicit. The loop has terminal states. Every step saves a checkpoint and emits trace data. The harness can crash after a shipment lookup and still know what already happened when it restarts.

The `runStep` function is where you keep deterministic application logic:

```ts
async function runStep(state: AgentState): Promise<AgentState> {
  switch (state.step) {
    case "receive_request":
      return classifyCustomerIntent(state);
    case "classify_intent":
      return callModelForNextAction(state);
    case "call_model":
      return routeModelOutput(state);
    case "dispatch_tool":
      return dispatchRequestedTool(state);
    case "check_policy":
      return evaluatePolicyGate(state);
    case "request_human_approval":
      return waitForApprovalDecision(state);
    case "compose_reply":
      return callModelForFinalReply(state);
    default:
      return {
        ...state,
        step: "fail",
        riskFlags: [...state.riskFlags, "unknown_step"]
      };
  }
}
```

In a real service, this loop usually runs inside a web worker, queue consumer, workflow engine, or agent runtime. LangGraph is one popular option for long-running stateful workflows because it gives you graph nodes, checkpoints, interrupts, and fault-tolerant resume behavior. The same principle applies if you build your own loop with a queue and database row. You still need explicit states, saved progress, and rules for side effects.

## State and Checkpoints
<!-- section-summary: State is the structured run record. Checkpoints save that record so the harness can resume, debug, and pause safely. -->

**State** is the data the harness carries through the run. It should be easy for code to inspect. It should contain facts, tool results, policy decisions, and enough metadata to resume the next step. It should avoid vague scratchpad text as the only source of truth, because vague text is hard to validate and hard to replay.

For the BrightCart support agent, state might live in a `support_agent_runs` table:

```json
{
  "run_id": "run_01j8support9m3",
  "customer_id": "customer_8842",
  "conversation_id": "conv_20260705_771",
  "status": "waiting_for_approval",
  "step": "request_human_approval",
  "intent": "return",
  "order_id": "order_77191",
  "risk_flags": ["refund_amount_over_threshold"],
  "tool_calls": [
    {
      "tool_call_id": "call_order_001",
      "name": "get_order",
      "status": "ok",
      "duration_ms": 214
    },
    {
      "tool_call_id": "call_refund_002",
      "name": "prepare_refund",
      "status": "ok",
      "duration_ms": 441
    }
  ],
  "pending_approval": {
    "approval_id": "approval_5521",
    "amount_cents": 22900,
    "reason": "damaged_item_reported",
    "reviewer_group": "support-leads"
  }
}
```

This state gives the support team a clear snapshot. The agent found the order, prepared a refund, and paused because the amount crossed the approval threshold. The run can wait for a support lead without losing the previous work.

A **checkpoint** is a saved state snapshot at a known boundary. LangGraph checkpointers save graph state at super-step boundaries, and they require a thread ID to find the right state when resuming. If you build your own harness, you can use the same idea with database transactions: save state after each completed step and use `run_id` as the resume pointer.

Checkpoint boundaries need attention because side effects can repeat after a retry or resume. If a step writes a refund request, crashes before saving the checkpoint, and then runs again, you can create duplicate refund requests unless the write is idempotent. The safest pattern is to generate an idempotency key from the run and business action, then use an upsert or external API idempotency feature.

For BrightCart, `prepare_refund` can use this idempotency key:

```ts
function refundIdempotencyKey(state: AgentState) {
  return [
    "support-agent",
    state.runId,
    state.orderId,
    "prepare-refund"
  ].join(":");
}
```

That key says the same run should prepare the same refund once. If the harness retries after a timeout, the refund service can return the existing prepared refund instead of creating another one. You still log the retry, yet the customer's money is protected from duplicate actions.

![BrightCart checkpoint recovery and idempotency flow](/content-assets/articles/article-mlops-llmops-agent-harness-basics/checkpoint-recovery-brightcart.png)

*Saved checkpoints let BrightCart pause for approval, resume after a crash, and prepare one refund record with the same idempotency key.*

## Tool Calls and Typed Results
<!-- section-summary: Tool calls need schemas, dispatch code, typed success and error results, and enough context for the model to recover. -->

An agent tool is a controlled way for the model to ask your application for an action. The model sees a name, description, and schema. Your harness sees a structured request. The tool dispatcher validates the arguments, checks permissions, runs application code, and returns a typed result.

OpenAI function calling uses JSON schemas for function tools, and MCP tools also expose names, descriptions, input schemas, optional output schemas, and execution metadata. Those schemas are the contract between a probabilistic model and deterministic software. A weak schema creates guesswork. A strong schema tells the model what values are required, what each value means, and what kind of output it can expect.

Here is a small dispatcher shape for the support agent:

```ts
type ToolName = "get_order" | "list_shipments" | "check_return_policy" | "prepare_refund";

type ToolCall = {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
};

type ToolTrace = {
  toolCallId: string;
  name: ToolName;
  startedAt: string;
  durationMs: number;
};

type ToolError = {
  code: "validation_error" | "permission_denied" | "timeout" | "upstream_error";
  message: string;
  retryable: boolean;
};

type ToolResult<T> =
  | { ok: true; value: T; trace: ToolTrace }
  | { ok: false; error: ToolError; trace: ToolTrace };

export async function dispatchTool(call: ToolCall, state: AgentState): Promise<ToolResult<unknown>> {
  const startedAt = new Date().toISOString();
  const start = performance.now();

  try {
    await assertToolAllowed(call, state);

    const value = await toolHandlers[call.name]({
      arguments: call.arguments,
      customerId: state.customerId,
      runId: state.runId
    });

    return {
      ok: true,
      value,
      trace: {
        toolCallId: call.id,
        name: call.name,
        startedAt,
        durationMs: Math.round(performance.now() - start)
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeToolError(error),
      trace: {
        toolCallId: call.id,
        name: call.name,
        startedAt,
        durationMs: Math.round(performance.now() - start)
      }
    };
  }
}
```

The result type matters. A timeout, validation error, and permission denial should reach the model in different shapes. A validation error may let the model correct an argument. A permission denial should steer the model toward an explanation or approval path. A timeout may allow a retry if the tool is read-only or idempotent.

Typed results also help humans. When a support lead opens the run, they should see "prepared refund succeeded" or "refund blocked by policy" instead of a blob of model text. The model can still draft a friendly reply, yet the real decision evidence sits in structured application data.

## Retries, Timeouts, and Idempotency
<!-- section-summary: Reliable harnesses treat tool calls like distributed systems work: timeout each call, retry only safe failures, and use idempotency for side effects. -->

Agent reliability uses the same habits as any production integration. Every external call needs a timeout. Retrying every failure creates new problems, so retry only the errors that have a real chance of succeeding on another attempt. Every side-effecting tool needs an idempotency plan before retries are enabled.

BrightCart can keep retry rules in configuration instead of scattering them across tool handlers:

```yaml
tools:
  get_order:
    timeout_ms: 1200
    retries:
      max_attempts: 2
      backoff_ms: 200
      retry_on:
        - timeout
        - http_502
        - http_503
  list_shipments:
    timeout_ms: 1500
    retries:
      max_attempts: 2
      backoff_ms: 250
      retry_on:
        - timeout
        - http_503
  prepare_refund:
    timeout_ms: 2000
    retries:
      max_attempts: 1
      backoff_ms: 0
      retry_on: []
    idempotency_key: "support-agent:{run_id}:{order_id}:prepare-refund"
```

Read-only tools such as `get_order` can retry short outages. A side-effecting tool such as `prepare_refund` should either avoid automatic retry or use a strong idempotency key that the downstream service honors. The config shows that decision in a reviewable form.

The harness should also record retry attempts in state and traces. A final answer that says "your refund is prepared" should be backed by a successful tool result. If the order API timed out twice and the harness guessed, that should be treated as a failure, not a completed support answer.

Retries also need a customer experience rule. If the order service is slow, the assistant can say it cannot verify the order right now and route the case to a human queue. That answer is less exciting than a magic instant fix, yet it is honest and supportable.

## Permissions and Human Approval
<!-- section-summary: Permission checks decide which tools the agent may use, and approval gates pause the run before risky customer-impacting actions. -->

A production harness needs a permission layer because different tools have different blast radius. Reading an order is lower risk than issuing a refund. Drafting a reply is lower risk than sending an email to a customer. The permission layer should check the customer, the user session, the tool name, the action amount, and the agent version.

Here is a simple permission manifest for BrightCart:

```json
{
  "agent": "brightcart-support-agent",
  "version": "2026.07.05",
  "tools": {
    "get_order": {
      "access": "read",
      "allowed_scopes": ["support:orders:read"]
    },
    "list_shipments": {
      "access": "read",
      "allowed_scopes": ["support:shipments:read"]
    },
    "check_return_policy": {
      "access": "read",
      "allowed_scopes": ["support:returns:read"]
    },
    "prepare_refund": {
      "access": "write",
      "allowed_scopes": ["support:refunds:prepare"],
      "approval_required_when": {
        "amount_cents_greater_than": 15000,
        "risk_flags_any": ["duplicate_claim", "address_mismatch"]
      }
    }
  }
}
```

This file should be reviewed like code. It says which tools exist, which scopes are required, and when approval is required. The model should receive a short description of those rules, yet the manifest is the source of enforcement. If the model asks for a refund above the threshold, the harness pauses even if the generated text sounds confident.

Human approval should carry a clear packet:

```json
{
  "approval_id": "approval_5521",
  "run_id": "run_01j8support9m3",
  "requested_action": "prepare_refund",
  "amount_cents": 22900,
  "order_id": "order_77191",
  "customer_id": "customer_8842",
  "evidence": {
    "return_window_days_remaining": 12,
    "shipment_status": "delivered",
    "customer_reason": "damaged_item_reported"
  },
  "decision_options": ["approve", "reject", "request_more_info"],
  "reviewer_group": "support-leads"
}
```

A good approval packet avoids forcing the reviewer to read the whole chat transcript. It gives the action, amount, evidence, and decision choices. After the reviewer decides, the harness saves the decision, resumes the run, and lets the model draft the customer-facing explanation based on the approved action.

![BrightCart permissions, approval, trace, and audit controls](/content-assets/articles/article-mlops-llmops-agent-harness-basics/permissions-audit-brightcart.png)

*Permissions, approval packets, traces, and audit events give BrightCart a reviewable path from risky refund request to saved evidence.*

## Traces and Audit Events
<!-- section-summary: Traces help engineers debug a run, while audit events give durable evidence for sensitive customer-impacting actions. -->

Traces and audit logs answer different questions. A **trace** helps engineers see the runtime path: model call, tool call, duration, retry count, approval wait, and final response. An **audit event** records important actions in a durable format for support, security, and compliance review.

OpenTelemetry's GenAI conventions are useful because they give common field names for model requests, responses, tool calls, token usage, provider names, and workflow names. The conventions moved into a dedicated GenAI semantic conventions repository, so teams should check the current repository when naming new telemetry fields.

Here is a trace metadata shape BrightCart could attach to each run:

```json
{
  "trace_id": "tr_70b5c5e6",
  "span_name": "support_agent.run",
  "attributes": {
    "gen_ai.workflow.name": "brightcart_support_refund_review",
    "gen_ai.agent.name": "BrightCart Support Agent",
    "gen_ai.conversation.id": "conv_20260705_771",
    "gen_ai.request.model": "configured-support-model",
    "support.intent": "return",
    "support.run_id": "run_01j8support9m3"
  }
}
```

And here is a durable audit event for the approval path:

```json
{
  "event_id": "audit_938122",
  "event_type": "agent.approval.decision_recorded",
  "occurred_at": "2026-07-05T14:28:31Z",
  "actor": {
    "type": "human",
    "id": "support_lead_17"
  },
  "agent": {
    "name": "brightcart-support-agent",
    "version": "2026.07.05",
    "run_id": "run_01j8support9m3"
  },
  "resource": {
    "type": "refund_request",
    "id": "refund_prep_9012",
    "order_id": "order_77191"
  },
  "decision": "approve",
  "policy": {
    "name": "refund-approval-policy",
    "matched_rules": ["amount_cents_greater_than_15000"]
  }
}
```

Audit events should avoid storing secrets, full prompts, payment data, or private customer details unless your retention and access rules explicitly allow it. The goal is useful evidence with controlled exposure. A support lead needs enough detail to understand the action. A security reviewer needs policy and actor metadata. Very few people need raw prompt content.

## Practical Checks, Common Mistakes, and Interview Readiness
<!-- section-summary: A strong harness can be explained through its state, tool dispatch, permission checks, resume behavior, and evidence trail. -->

Before shipping a support harness, run through these practical checks:

- Can you point to the database row or workflow state for a single agent run?
- Can you replay the sequence of model calls, tool calls, policy decisions, approvals, and final reply?
- Do all external calls have timeouts?
- Do retry rules differ for read-only tools and side-effecting tools?
- Does every write action have an idempotency key or a human approval boundary?
- Can a policy gate block an action even when the model asks for it?
- Can a reviewer approve, reject, or request more information from a clear packet?
- Do traces include model, tool, token, latency, retry, and workflow metadata?
- Do audit logs avoid secrets while still keeping enough decision evidence?

Common mistakes usually come from treating the prompt as the whole system. Teams let the model decide whether a refund is allowed, then discover that policy enforcement was only prose. They store state as one long transcript, then struggle to resume cleanly after a crash. They retry a payment or refund tool without idempotency, then create duplicate side effects. They keep traces for engineering, yet forget audit events for customer-impacting actions.

For interview-ready understanding, say it this way: an agent harness is the production runtime around an LLM. It owns the loop, state, tool dispatch, permissions, retries, approvals, checkpoints, traces, and audit logs. The model can choose a next step, while the harness decides what is allowed, executes deterministic work, records evidence, and resumes safely after delays or failures.

## References

- [OpenAI Agents SDK guide](https://developers.openai.com/api/docs/guides/agents)
- [OpenAI Agents SDK overview](https://openai.github.io/openai-agents-python/)
- [OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI tools guide](https://developers.openai.com/api/docs/guides/tools)
- [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)
- [LangGraph graph API: re-execution and idempotency](https://docs.langchain.com/oss/python/langgraph/graph-api)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
- [OpenTelemetry semantic-conventions v1.42.0 GenAI migration note](https://github.com/open-telemetry/semantic-conventions/releases)
