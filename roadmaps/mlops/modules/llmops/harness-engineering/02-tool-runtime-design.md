---
title: "Tool Runtime Design"
description: "Design the layer that registers agent tools, validates schemas, dispatches calls, controls permissions, handles failures, and returns typed results."
overview: "A tool runtime is the deterministic execution layer behind model tool calls. This tutorial follows a finance data assistant through tool registration, schemas, dispatch code, retry policy, permission checks, typed errors, audit logs, and MCP-style tool boundaries."
tags: ["MLOps","LLMOps","advanced","harness"]
order: 2
id: "article-mlops-llmops-tool-runtime-design"
---

## Table of Contents

1. [What a Tool Runtime Does](#what-a-tool-runtime-does)
2. [The Finance Data Assistant Scenario](#the-finance-data-assistant-scenario)
3. [Tool Registry and Schemas](#tool-registry-and-schemas)
4. [Descriptions, Examples, and Tool Choice](#descriptions-examples-and-tool-choice)
5. [The Dispatcher](#the-dispatcher)
6. [Typed Results and Recoverable Errors](#typed-results-and-recoverable-errors)
7. [Retries, Timeouts, and Idempotency](#retries-timeouts-and-idempotency)
8. [Permission Checks and Data Boundaries](#permission-checks-and-data-boundaries)
9. [MCP and Remote Tool Servers](#mcp-and-remote-tool-servers)
10. [Audit Logs, Trace Metadata, and Operations](#audit-logs-trace-metadata-and-operations)
11. [Practical Checks, Common Mistakes, and Interview Readiness](#practical-checks-common-mistakes-and-interview-readiness)
12. [References](#references)

## What a Tool Runtime Does
<!-- section-summary: A tool runtime turns model tool requests into validated, permission-checked, observable application actions. -->

A **tool runtime** is the part of an agent harness that manages tools from definition to execution. It stores the available tools, exposes tool schemas to the model, validates the model's arguments, checks permissions, calls the real application code, handles timeouts and retries, and returns typed results that the model can use in the next step.

That definition sounds dry until you put a real system behind it. A model can say, "I need the ledger entries for account 4000 last quarter." The runtime decides whether that tool exists, whether the user can access that legal entity, whether the date range is allowed, how long the warehouse query may run, and how to return the result safely.

OpenAI's current tool-calling flow makes this responsibility clear. The model can request a tool call, yet your application executes the tool and sends the tool output back. The model suggests the action. Your runtime validates and performs the action. Structured Outputs also matter here: function calling is the right path when the model needs to call application tools, while structured final responses are useful when your UI needs a predictable answer shape.

MCP, the Model Context Protocol, gives another useful reference point. MCP servers expose tools with names, descriptions, input schemas, optional output schemas, and tool call results. The protocol also calls out human control, access checks, rate limits, timeouts, and audit logging as core safety work. Those ideas fit any tool runtime, even when your tools are local functions rather than remote MCP servers.

## The Finance Data Assistant Scenario
<!-- section-summary: The running example is an internal finance assistant that answers questions from governed ledger and reporting data. -->

Imagine you work at **Harbor Ledger**, a subscription analytics company with customers in the United States, Canada, and the United Kingdom. The finance team closes the books every month. Analysts ask questions such as "Why did revenue for the UK entity drop last week?", "Show expense entries over $25,000 for cloud infrastructure", and "Prepare a variance summary for the CFO review."

The company has a warehouse with general ledger entries, a permissions service, a reporting database, and a secure export system. The assistant should help analysts query and summarize data. It should never move money, post a journal entry, or email a report to external recipients. It can prepare drafts and exports for approved reviewers.

That scenario gives us a clean tool set:

| Tool | Purpose | Risk level |
|---|---|---|
| `get_ledger_entries` | Return ledger rows for approved entities and date ranges | Medium read risk |
| `run_variance_query` | Compare actuals against forecast by account and period | Medium read risk |
| `get_policy_note` | Fetch finance policy text for account treatment | Low read risk |
| `create_report_export` | Create a governed CSV or PDF export for review | Write-like operational risk |
| `draft_adjustment_memo` | Prepare a memo for a proposed adjustment | Medium workflow risk |

The runtime has to treat these tools differently. A policy note lookup is safe for most finance users. Ledger rows may contain sensitive vendor names and employee reimbursements. Exports create durable files, so they need rate limits, retention settings, and review metadata. Adjustment memos should stay drafts because posting journal entries belongs to the accounting system approval workflow.

## Tool Registry and Schemas
<!-- section-summary: A tool registry is the reviewed catalog of available tools, including schemas, owners, risk, examples, and execution settings. -->

A **tool registry** is the catalog of tools the agent may use. The registry can be code, a database table, a manifest file, or a remote MCP server. The important point is that it is reviewed and versioned. A tool should have a stable name, a clear description, an input schema, an output schema when possible, an owner, permission requirements, and execution settings.

![Harbor Ledger tool registry and schema contracts](/content-assets/articles/article-mlops-llmops-tool-runtime-design/tool-registry-harbor-ledger.png)

*Harbor Ledger reviews each finance tool as a contract with schema, owner, risk, timeout, approved boundary, and governed export rules.*

Here is a compact registry entry for `get_ledger_entries`:

```json
{
  "name": "get_ledger_entries",
  "description": "Return approved general ledger rows for a legal entity, account range, and posting date window.",
  "owner": "finance-data-platform",
  "risk": "sensitive_read",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["legal_entity", "account_prefix", "posted_from", "posted_to"],
    "properties": {
      "legal_entity": {
        "type": "string",
        "enum": ["US_MAIN", "CA_MAIN", "UK_MAIN"]
      },
      "account_prefix": {
        "type": "string",
        "pattern": "^[0-9]{1,4}$"
      },
      "posted_from": {
        "type": "string",
        "format": "date"
      },
      "posted_to": {
        "type": "string",
        "format": "date"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 100
      }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["rows", "row_count", "truncated"],
    "properties": {
      "rows": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["entry_id", "account", "posted_at", "amount_usd", "memo_redacted"],
          "properties": {
            "entry_id": { "type": "string" },
            "account": { "type": "string" },
            "posted_at": { "type": "string", "format": "date" },
            "amount_usd": { "type": "number" },
            "memo_redacted": { "type": "string" }
          }
        }
      },
      "row_count": { "type": "integer" },
      "truncated": { "type": "boolean" }
    }
  }
}
```

The schema does more than help the model. It protects the warehouse and the finance team. The enum limits legal entities. The date fields force a clear time window. The `limit` prevents a casual prompt from pulling every row in the table. The output schema says memos should be redacted before the model sees them.

The registry should also record operational settings:

```yaml
tool_settings:
  get_ledger_entries:
    timeout_ms: 2500
    max_rows: 500
    data_classification: confidential_finance
    cache_ttl_seconds: 60
    owner_slack_channel: "#finance-data-platform"
  run_variance_query:
    timeout_ms: 5000
    max_period_days: 92
    data_classification: confidential_finance
    cache_ttl_seconds: 300
    owner_slack_channel: "#finance-analytics"
  create_report_export:
    timeout_ms: 8000
    max_exports_per_user_per_hour: 5
    retention_days: 14
    data_classification: restricted_finance
    owner_slack_channel: "#finance-systems"
```

Operational fields tell on-call engineers who owns a broken tool, how much data can flow through it, how long a call may run, and how long generated artifacts live.

## Descriptions, Examples, and Tool Choice
<!-- section-summary: The model chooses tools from names, descriptions, schemas, and examples, so those fields need to be specific and honest. -->

Tool descriptions are part of the product contract. A vague description such as "query finance data" invites wrong tool selection. A precise description such as "Return approved general ledger rows for a legal entity, account range, and posting date window" gives the model a better chance to choose correctly.

Descriptions should include the business boundary. For `create_report_export`, the description can say:

```json
{
  "name": "create_report_export",
  "description": "Create a governed CSV or PDF export from an already approved finance query result. Use this only after the user asks for an export and the result set has a query_id.",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["query_id", "format", "title"],
    "properties": {
      "query_id": { "type": "string" },
      "format": { "type": "string", "enum": ["csv", "pdf"] },
      "title": { "type": "string", "minLength": 3, "maxLength": 120 }
    }
  }
}
```

The phrase "already approved finance query result" matters because the export tool should never run against arbitrary SQL written by the model. The model should use a previous query result ID. The runtime should enforce that too. Description helps selection, while code enforces the boundary.

Examples help when tools are close together. The assistant may need to decide between a raw ledger query and a variance query:

| User request | Best tool | Why |
|---|---|---|
| "Show UK revenue entries over $10,000 last month" | `get_ledger_entries` | The user wants rows |
| "Why is UK revenue 8 percent below forecast?" | `run_variance_query` | The user wants actuals versus forecast |
| "What is our policy for recognizing annual prepaid contracts?" | `get_policy_note` | The user asks for accounting policy |
| "Export this variance summary for the close packet" | `create_report_export` | The user already has a result and asks for an artifact |

In production, examples can live in the registry as metadata and feed eval cases, so tool descriptions improve through trace review.

## The Dispatcher
<!-- section-summary: The dispatcher is deterministic code that validates the call, checks permissions, invokes the handler, and returns a structured result. -->

The **dispatcher** is the runtime function that receives a model tool call and routes it to the right handler. It should be deterministic and boring. The dispatcher should never trust the model's arguments just because they match a schema in the prompt. It should validate again in application code, check permissions, apply runtime limits, and return a typed result.

Here is a simplified TypeScript dispatcher for Harbor Ledger:

```ts
type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

type RuntimeContext = {
  runId: string;
  userId: string;
  userScopes: string[];
  legalEntities: string[];
  traceId: string;
};

type RuntimeResult =
  | {
      ok: true;
      callId: string;
      name: string;
      value: unknown;
      durationMs: number;
    }
  | {
      ok: false;
      callId: string;
      name: string;
      error: RuntimeError;
      durationMs: number;
    };

export async function dispatch(call: ToolCall, ctx: RuntimeContext): Promise<RuntimeResult> {
  const started = performance.now();
  const registryEntry = registry.get(call.name);

  if (!registryEntry) {
    return runtimeFailure(call, started, {
      code: "unknown_tool",
      message: "The requested finance tool is unavailable.",
      retryable: false
    });
  }

  const parsed = validateArguments(registryEntry.inputSchema, call.arguments);

  if (!parsed.ok) {
    return runtimeFailure(call, started, {
      code: "validation_error",
      message: parsed.message,
      retryable: false,
      modelHint: "Revise the tool arguments to match the schema."
    });
  }

  const permission = await authorizeToolCall(registryEntry, parsed.value, ctx);

  if (!permission.ok) {
    return runtimeFailure(call, started, {
      code: "permission_denied",
      message: permission.reason,
      retryable: false,
      modelHint: "Explain the access boundary and ask for an approved reviewer."
    });
  }

  try {
    const value = await runWithTimeout(
      registryEntry.handler(parsed.value, ctx),
      registryEntry.timeoutMs
    );

    const output = validateOutput(registryEntry.outputSchema, value);

    return {
      ok: true,
      callId: call.id,
      name: call.name,
      value: output.value,
      durationMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    return runtimeFailure(call, started, normalizeRuntimeError(error));
  }
}
```

This dispatcher does five important things in order. It finds the tool. It validates inputs. It checks permissions. It runs the tool with a timeout. It validates the output. Each failure path returns a structured error, including a `modelHint` when the model can usefully recover.

That ordering protects the finance system. A user without `finance:ledger:read` should fail before a warehouse query starts. A malformed date range should fail before it reaches SQL construction. A tool handler should never leak raw database exceptions to the model.

## Typed Results and Recoverable Errors
<!-- section-summary: Tool errors should tell the model whether it can retry, revise arguments, ask for approval, or stop gracefully. -->

A good tool runtime treats errors as product behavior. The model needs to know whether it should try again, correct arguments, ask the user for missing information, or stop. Humans need to know whether the failure came from validation, access, timeout, or the upstream system.

![Harbor Ledger dispatcher and typed error recovery](/content-assets/articles/article-mlops-llmops-tool-runtime-design/dispatcher-error-recovery-harbor-ledger.png)

*The dispatcher validates, checks permission, runs with a timeout, and returns typed errors with recovery hints the assistant can follow.*

For Harbor Ledger, a recoverable validation error might look like this:

```json
{
  "ok": false,
  "call_id": "call_ledger_009",
  "name": "get_ledger_entries",
  "error": {
    "code": "validation_error",
    "message": "posted_to must be on or after posted_from.",
    "retryable": false,
    "model_hint": "Ask for a valid date range or correct the date order."
  }
}
```

A warehouse timeout needs a different result:

```json
{
  "ok": false,
  "call_id": "call_variance_014",
  "name": "run_variance_query",
  "error": {
    "code": "timeout",
    "message": "The variance query exceeded the 5000 ms runtime limit.",
    "retryable": true,
    "model_hint": "Narrow the date range, account set, or legal entity before retrying."
  }
}
```

A permission failure should guide the conversation toward the correct boundary:

```json
{
  "ok": false,
  "call_id": "call_export_021",
  "name": "create_report_export",
  "error": {
    "code": "permission_denied",
    "message": "The user lacks finance:exports:create for UK_MAIN.",
    "retryable": false,
    "model_hint": "Explain that an approved finance reviewer must create this export."
  }
}
```

These shapes help the model respond without inventing facts. The model can say, "I need a valid date range," or "Please ask a UK finance reviewer to create that export." The answer is grounded in runtime evidence rather than a guess.

## Retries, Timeouts, and Idempotency
<!-- section-summary: Tool runtime reliability depends on bounded calls, selective retries, and idempotency keys for artifact-producing actions. -->

Finance tools often call warehouses, reporting APIs, object storage, and permission services. Those systems fail in normal ways: a query queue fills up, a network hop times out, or an export service returns a temporary error. A runtime needs retry rules that fit the tool.

Here is a retry policy for Harbor Ledger:

```yaml
retry_policy:
  get_policy_note:
    timeout_ms: 1000
    max_attempts: 2
    backoff:
      initial_ms: 100
      multiplier: 2
    retry_on:
      - timeout
      - http_503
  get_ledger_entries:
    timeout_ms: 2500
    max_attempts: 2
    backoff:
      initial_ms: 250
      multiplier: 2
    retry_on:
      - warehouse_queue_timeout
      - http_502
      - http_503
  create_report_export:
    timeout_ms: 8000
    max_attempts: 1
    idempotency_key: "finance-export:{run_id}:{query_id}:{format}"
    retry_on: []
```

Read tools can retry temporary failures because repeated reads should return the same governed result. Export creation is different because it creates an artifact. If the runtime retries after the export service created the file and failed to return the response, you could create duplicates. The policy disables automatic retry and still includes an idempotency key for the export service.

Timeouts also control cost. A broad variance query across every entity and every account can scan a lot of warehouse data. The runtime should reject or narrow oversized requests before the query starts. It can ask the model to request a smaller date range or a specific entity.

Idempotency should be visible in logs:

```json
{
  "run_id": "fin_run_7129",
  "tool_call_id": "call_export_021",
  "tool": "create_report_export",
  "idempotency_key": "finance-export:fin_run_7129:query_6621:pdf",
  "attempt": 1,
  "status": "created",
  "artifact_id": "export_88a12"
}
```

This event gives on-call engineers a fast path when an analyst says the assistant created duplicate files. They can search by idempotency key and prove whether the same action produced one artifact or many.

## Permission Checks and Data Boundaries
<!-- section-summary: Finance tools need explicit scopes, legal-entity boundaries, row-level rules, export limits, and approval gates. -->

Finance data has access boundaries that a prompt cannot safely enforce. The runtime needs a permission manifest that maps users, scopes, legal entities, and tool risk. It should check access before calling the warehouse or export service.

Here is a simple manifest:

```json
{
  "agent": "harbor-ledger-finance-assistant",
  "version": "2026.07.05",
  "tool_permissions": {
    "get_policy_note": {
      "required_scopes": ["finance:policy:read"],
      "legal_entity_scope": "none"
    },
    "get_ledger_entries": {
      "required_scopes": ["finance:ledger:read"],
      "legal_entity_scope": "argument.legal_entity",
      "row_filters": ["mask_employee_reimbursements", "redact_vendor_bank_details"]
    },
    "run_variance_query": {
      "required_scopes": ["finance:variance:read"],
      "legal_entity_scope": "argument.legal_entity",
      "max_period_days": 92
    },
    "create_report_export": {
      "required_scopes": ["finance:exports:create"],
      "legal_entity_scope": "query_result.legal_entity",
      "approval_required_for": ["restricted_finance", "external_recipient"]
    }
  }
}
```

The manifest shows several real production concerns. `legal_entity_scope` prevents a US analyst from accidentally pulling UK data. `row_filters` remove details that the model should never see. `max_period_days` stops very broad warehouse scans. Export approval rules handle artifact risk separately from query risk.

The runtime should also pass a filtered view of data to the model. If the tool result contains 500 rows, the model may only need summary totals plus the top exceptions. Keep raw rows in the application result store and provide the model with redacted data, aggregate values, and references such as `query_id`.

For example:

```json
{
  "query_id": "query_6621",
  "summary": {
    "legal_entity": "UK_MAIN",
    "period": "2026-06",
    "variance_usd": -184200,
    "largest_accounts": [
      { "account": "4000", "label": "Subscription revenue", "variance_usd": -142100 },
      { "account": "6100", "label": "Cloud infrastructure", "variance_usd": -42100 }
    ]
  },
  "available_actions": ["create_report_export", "draft_adjustment_memo"],
  "redaction": {
    "vendor_bank_details": "removed",
    "employee_reimbursement_memos": "masked"
  }
}
```

This result gives the model enough information to explain the variance. It keeps sensitive row-level detail behind a query ID and permissioned UI. The user can still export the governed result if their role allows it.

## MCP and Remote Tool Servers
<!-- section-summary: MCP is useful when tools live behind a separate server, while the same validation, permission, timeout, and audit rules still apply. -->

MCP is useful when tools live outside the agent service. A finance data platform team may run an MCP server that exposes approved finance tools to multiple assistant products. The agent runtime can discover tools with `tools/list` and invoke them with `tools/call`.

The MCP tool definition includes a name, description, input schema, optional output schema, annotations, and execution metadata. The current MCP tools specification also explains that clients should show exposed tools, confirm sensitive operations, validate tool results, implement timeouts, and log usage.

Here is a simplified MCP-style tool entry:

```json
{
  "name": "finance.get_ledger_entries",
  "title": "Get Ledger Entries",
  "description": "Return approved ledger entries for a legal entity, account prefix, and posting date window.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["legal_entity", "account_prefix", "posted_from", "posted_to"],
    "properties": {
      "legal_entity": { "type": "string" },
      "account_prefix": { "type": "string" },
      "posted_from": { "type": "string", "format": "date" },
      "posted_to": { "type": "string", "format": "date" }
    }
  },
  "outputSchema": {
    "type": "object",
    "required": ["query_id", "summary", "redaction"],
    "properties": {
      "query_id": { "type": "string" },
      "summary": { "type": "object" },
      "redaction": { "type": "object" }
    }
  },
  "execution": {
    "taskSupport": "optional"
  }
}
```

MCP can standardize tool discovery, yet it does not remove runtime responsibility. The host application still needs to choose trusted servers, bind user identity to tool calls, apply approval UX, validate results, redact sensitive content, and log activity. Treat tool descriptions and annotations as metadata from the server, then enforce your own product policy in the harness.

## Audit Logs, Trace Metadata, and Operations
<!-- section-summary: Finance tool runs need trace spans for debugging and durable audit events for governed read and artifact actions. -->

A finance assistant needs two evidence streams. Traces help engineers debug latency, retries, model behavior, and tool selection. Audit logs record sensitive reads and artifact creation for finance, security, and compliance review.

OpenTelemetry GenAI conventions give useful attribute names for model calls and tools, including provider, request model, response model, token usage, tool definitions, tool call IDs, tool arguments, and tool results. Because these conventions now live in a dedicated GenAI repository, teams should pin their instrumentation package versions and review migration notes during upgrades.

Here is a trace span shape for a tool call:

```json
{
  "trace_id": "tr_fin_8842",
  "span_name": "tool.get_ledger_entries",
  "attributes": {
    "gen_ai.workflow.name": "finance_data_assistant",
    "gen_ai.agent.name": "Harbor Ledger Finance Assistant",
    "gen_ai.tool.name": "get_ledger_entries",
    "gen_ai.tool.call.id": "call_ledger_009",
    "finance.legal_entity": "UK_MAIN",
    "finance.query_id": "query_6621",
    "tool.duration_ms": 2140,
    "tool.retry_count": 0
  }
}
```

Here is a durable audit event for an export:

```json
{
  "event_id": "audit_fin_4412",
  "event_type": "agent.finance_export.created",
  "occurred_at": "2026-07-05T16:14:07Z",
  "actor": {
    "type": "user",
    "id": "analyst_42"
  },
  "agent": {
    "name": "harbor-ledger-finance-assistant",
    "version": "2026.07.05",
    "run_id": "fin_run_7129"
  },
  "tool": {
    "name": "create_report_export",
    "tool_call_id": "call_export_021"
  },
  "resource": {
    "type": "finance_export",
    "id": "export_88a12",
    "legal_entity": "UK_MAIN",
    "classification": "restricted_finance",
    "retention_days": 14
  },
  "policy": {
    "decision": "allow",
    "matched_rules": ["finance_exports_create_scope", "uk_main_entity_access"]
  }
}
```

This event avoids raw ledger rows and keeps the high-value facts: who requested it, which agent run created it, which tool ran, which artifact was created, what legal entity it covered, and which policy rules allowed it.

During finance close week, useful dashboards include tool latency, timeout rate, permission-denied rate, export count by user, top validation errors, and tool-selection accuracy from eval cases.

![Harbor Ledger finance evidence chain](/content-assets/articles/article-mlops-llmops-tool-runtime-design/finance-evidence-chain-harbor-ledger.png)

*Redacted results, idempotency keys, trace spans, and audit events give finance operators a clean evidence chain for governed exports.*

## Practical Checks, Common Mistakes, and Interview Readiness
<!-- section-summary: A strong tool runtime has reviewed schemas, deterministic dispatch, permissions, typed failures, idempotency, and evidence. -->

Use this checklist before giving an agent access to finance tools:

- Does every tool have a stable name, owner, input schema, output shape, risk level, and timeout?
- Are descriptions specific enough for the model to choose the right tool?
- Does the dispatcher validate inputs and outputs in code?
- Do permission checks run before warehouse queries and export creation?
- Are row-level redaction rules applied before data reaches the model?
- Do retries differ by tool risk and side effects?
- Do artifact-producing tools use idempotency keys?
- Do recoverable errors include clear model hints?
- Do traces and audit logs use stable field names and avoid raw secrets?
- Are tool-selection mistakes captured as eval cases?

Common mistakes show up quickly in finance systems. A team exposes a broad SQL tool, then the model writes expensive queries and sees data it should never receive. A tool description says "get finance data," then the model uses it for every request. A runtime returns raw exception strings, then the assistant repeats internal table names to users. An export tool creates files without idempotency, then a retry produces duplicate close packets.

For interview-ready understanding, explain tool runtime design like this: the model can ask for a tool, and the runtime owns everything after that. The runtime validates schema, enforces permission, applies timeouts, dispatches deterministic code, returns typed results, records evidence, and keeps side effects safe through approval and idempotency. A good runtime makes tools useful to the model and safe for the business.

## References

- [OpenAI tools guide](https://developers.openai.com/api/docs/guides/tools)
- [OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI MCP and connectors guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [Model Context Protocol tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
- [OpenTelemetry Python GenAI attributes reference](https://github.com/open-telemetry/opentelemetry-python/blob/main/opentelemetry-semantic-conventions/src/opentelemetry/semconv/_incubating/attributes/gen_ai_attributes.py)
