---
title: "Permissions and Data"
description: "Control what agents can read, write, call, remember, and expose across users, tenants, environments, and tools."
overview: "Learn how to design permissions, data boundaries, credentials, memory controls, and trace policies for LLM apps and agents that handle real users and real business systems."
tags: ["MLOps","LLMOps","advanced","security"]
order: 2
id: "article-mlops-llmops-permissions-and-data"
---

## Agents Need Real Authorization
<!-- section-summary: An LLM app often starts as a chat box. Production systems rarely stay there. They search documents, remember preferences, call APIs, create tickets, update records, send... -->

An LLM app often starts as a chat box. Production systems rarely stay there. They search documents, remember preferences, call APIs, create tickets, update records, send messages, and run workflows. Once an assistant can read or write business data, it needs the same authorization discipline as any other application.

Imagine `TenantDesk`, a support agent used by a SaaS company. It can answer customer questions, summarize logs, open billing tickets, and draft account changes. The company has many tenants. A user from tenant A should never see tenant B logs. A support engineer can view more data than a customer. A production agent can draft a refund, but finance approval is required before submission.

The core lesson is simple: the model should not expand a user's authority. If the user cannot read a record through the normal product, the agent should not reveal it. If the user cannot submit an action directly, the agent should not submit it on their behalf without the same approval path.

## Define Permission Scopes
<!-- section-summary: Start with a permission manifest. It should describe what the agent can read, write, call, remember, and expose. -->

Start with a permission manifest. It should describe what the agent can read, write, call, remember, and expose.

```yaml
agent: tenantdesk-support-agent
environment: production
scopes:
  read:
    - customer_visible_docs
    - tenant_logs_own_tenant
    - ticket_history_own_tenant
  write:
    - draft_support_reply
    - draft_billing_ticket
  blocked:
    - cross_tenant_logs
    - raw_payment_data
    - production_secret_values
  approval_required:
    - issue_refund
    - change_plan
    - close_security_incident
```

This file helps engineering, security, product, and support agree on the boundary. It also gives your harness something deterministic to enforce.

![TenantDesk permission manifest](/content-assets/articles/article-mlops-llmops-permissions-and-data/permissions-manifest.png)
*The manifest turns TenantDesk permissions into explicit read, write, approval, and blocked categories that reviewers can check before launch.*

## Pass User Context To Every Tool
<!-- section-summary: Every tool call should carry the authenticated user, tenant, role, request ID, and purpose. Do not let the model invent these values. -->

Every tool call should carry the authenticated user, tenant, role, request ID, and purpose. Do not let the model invent these values.

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class ToolContext:
    user_id: str
    tenant_id: str
    role: str
    request_id: str
    purpose: str


def fetch_tenant_logs(ctx: ToolContext, service: str, minutes: int):
    if ctx.role not in {"support_engineer", "tenant_admin"}:
        raise PermissionError("role_cannot_read_logs")

    return log_store.query(
        tenant_id=ctx.tenant_id,
        service=service,
        since_minutes=min(minutes, 60),
    )
```

The key point is that `tenant_id` comes from authentication rather than the model's tool arguments. The model can ask for "checkout logs"; your code decides which tenant's checkout logs are visible.

## Use Scoped Credentials
<!-- section-summary: Agents should use workload credentials with narrow permissions. A support agent that reads tenant logs should not hold a token that can delete storage buckets, change billing... -->

Agents should use workload credentials with narrow permissions. A support agent that reads tenant logs should not hold a token that can delete storage buckets, change billing plans, and read production secrets.

Prefer:

- Short-lived tokens.
- Workload identity federation for CI and Kubernetes workloads.
- Separate credentials per environment.
- Separate credentials per agent or tool group.
- Read-only access when the tool only reads.
- Approval-gated credentials for high-impact actions.

A tool call can request a short-lived token from a broker:

```json
{
  "subject": "tenantdesk-support-agent",
  "tool": "fetch_tenant_logs",
  "tenant_id": "tenant_487",
  "scope": "logs:read",
  "ttl_seconds": 300,
  "reason": "support_case_9182"
}
```

The broker can deny requests that do not match policy. It can also log who asked, why, and which trace triggered the token.

## Keep Memory On A Diet
<!-- section-summary: Memory is useful, and memory is risky. If your agent stores everything, it can leak private data later or let old instructions poison future sessions. -->

Memory is useful, and memory is risky. If your agent stores everything, it can leak private data later or let old instructions poison future sessions.

Separate memory types:

| Memory type | Example | Retention |
|---|---|---|
| Session state | Current support case ID, selected product area | Minutes or one session |
| User preference | Preferred language, timezone | Until user changes it |
| Case memory | Troubleshooting steps already tried | Case lifetime |
| Prohibited memory | Secrets, payment data, raw access tokens | Never store |

Use a memory policy:

```yaml
memory_policy:
  allow:
    - preferred_language
    - product_area
    - open_case_id
  deny_patterns:
    - access_token
    - password
    - credit_card_number
    - private_key
  retention:
    session_state: "24h"
    user_preferences: "until_deleted"
    case_memory: "90d"
```

Before writing memory, validate the content:

```python
def write_memory(user_id: str, key: str, value: str):
    if key in {"password", "access_token", "private_key"}:
        raise ValueError("prohibited_memory_key")
    if secret_detector.find(value):
        raise ValueError("possible_secret_in_memory")
    memory_store.put(user_id=user_id, key=key, value=value)
```

## Protect Prompts And Traces
<!-- section-summary: LLM traces are incredibly useful. They can also contain user messages, retrieved snippets, tool arguments, and model outputs. Treat traces as sensitive operational data. -->

LLM traces are incredibly useful. They can also contain user messages, retrieved snippets, tool arguments, and model outputs. Treat traces as sensitive operational data.

Trace policy should decide:

- Which fields are redacted.
- Which roles can view raw traces.
- How long traces are retained.
- Whether prompts and completions are sampled.
- How tenant boundaries apply to trace search.
- How incident exports are approved.

Example event shape:

```json
{
  "trace_id": "tr_9ac4",
  "tenant_id": "tenant_487",
  "user_id_hash": "u_94b1",
  "agent": "tenantdesk-support-agent",
  "tool": "fetch_tenant_logs",
  "allowed": true,
  "scope": "logs:read",
  "redaction": {
    "prompt": "pii_redacted",
    "tool_result": "log_lines_redacted"
  }
}
```

The trace should help you debug without turning observability into a data leak.

## Approval Flows For High-Impact Actions
<!-- section-summary: Some actions should stay draft-only until a person approves them. A model can prepare the work, but the application should own the approval step. -->

Some actions should stay draft-only until a person approves them. A model can prepare the work, but the application should own the approval step.

For TenantDesk, issuing a refund might look like:

```json
{
  "action": "issue_refund",
  "status": "pending_approval",
  "tenant_id": "tenant_487",
  "amount_usd": 180,
  "reason": "documented outage credit",
  "prepared_by": "tenantdesk-support-agent",
  "approver_role": "finance_ops",
  "trace_id": "tr_9ac4"
}
```

The final submission happens only after a finance user approves in a normal UI. That keeps the agent useful without giving it unchecked authority.

![TenantDesk approval and audit workflow](/content-assets/articles/article-mlops-llmops-permissions-and-data/approval-audit-workflow.png)
*High-impact TenantDesk actions stay draft-only until finance approval, and the audit event records the trace and policy version.*

## Data Boundary Tests
<!-- section-summary: Permission bugs need tests. Add cases like:. -->

Permission bugs need tests. Add cases like:

```yaml
tests:
  - id: cross_tenant_log_denied
    user:
      tenant_id: tenant_a
      role: tenant_admin
    tool_call:
      name: fetch_tenant_logs
      arguments:
        tenant_id: tenant_b
        service: api
    expected:
      allowed: false
      reason: tenant_mismatch

  - id: refund_requires_approval
    user:
      role: support_engineer
    tool_call:
      name: issue_refund
      arguments:
        amount_usd: 200
    expected:
      status: pending_approval
```

Run these tests when you change tools, auth middleware, memory behavior, or retrieval filters.

## Environment Boundaries
<!-- section-summary: Permissions should change across development, staging, and production. A development agent may use synthetic data and a fake ticketing system. A staging agent may use replayed... -->

Permissions should change across development, staging, and production. A development agent may use synthetic data and a fake ticketing system. A staging agent may use replayed traces with redacted content. A production agent may use live data, yet only through approved tools and scoped identities.

```yaml
environments:
  dev:
    allowed_data: ["synthetic_tickets", "sample_docs"]
    tool_targets:
      ticketing: "mock"
      billing: "mock"
    trace_retention_days: 7
  staging:
    allowed_data: ["redacted_replay_tickets", "approved_docs"]
    tool_targets:
      ticketing: "staging"
      billing: "disabled"
    trace_retention_days: 14
  production:
    allowed_data: ["tenant_scoped_live_data", "approved_docs"]
    tool_targets:
      ticketing: "production"
      billing: "draft_only"
    trace_retention_days: 30
```

This matters because agents often move fast from prototype to production. If the environment policy is explicit, your CI/CD pipeline can reject a production deployment that still points at a development memory store or a mock approval path.

## Retrieval Permissions
<!-- section-summary: Retrieval systems need authorization too. A vector search result can leak data even when the final answer sounds harmless. Filter before returning chunks to the model. -->

Retrieval systems need authorization too. A vector search result can leak data even when the final answer sounds harmless. Filter before returning chunks to the model.

```python
def retrieve_for_user(query_embedding, ctx):
    return vector_store.search(
        embedding=query_embedding,
        filters={
            "tenant_id": ctx.tenant_id,
            "visibility": {"$in": ["public", ctx.role]},
            "environment": "production",
            "status": "approved",
        },
        limit=8,
    )
```

Do not retrieve everything and ask the model to ignore chunks it should not see. The safest chunk is the one that never enters the context.

![TenantDesk retrieval permission filter](/content-assets/articles/article-mlops-llmops-permissions-and-data/retrieval-permission-filter.png)
*TenantDesk filters by authenticated tenant and role before retrieval results enter the model context.*

## A Permission Review Packet
<!-- section-summary: Before launch, create a small packet that reviewers can understand:. -->

Before launch, create a small packet that reviewers can understand:

```yaml
permission_review:
  agent: tenantdesk-support-agent
  release: 2026-07-05.1
  users:
    - tenant_admin
    - support_engineer
  tools:
    fetch_tenant_logs:
      scopes: ["logs:read"]
      tenant_filter: required
      max_window_minutes: 60
    create_billing_ticket:
      scopes: ["ticket:draft"]
      approval_required: true
  memory:
    store: tenant_scoped_memory
    prohibited: ["secrets", "payment_data", "raw_tokens"]
  traces:
    raw_prompt_access: ["security_oncall"]
    redaction: enabled
```

This packet gives security and product reviewers a concrete artifact. It also gives future maintainers a starting point when someone asks why the agent can or cannot perform an action.

## Common Mistakes
<!-- section-summary: Watch for these permission problems:. -->

Watch for these permission problems:

- Tool arguments include `tenant_id` and the backend trusts it.
- One service token can read every tenant.
- Memory stores are global by default.
- Trace search ignores tenant boundaries.
- A low-risk summarization workflow receives high-risk action tools.
- Production uses the same fake approval path as staging.
- Retrieval filters happen after chunks enter the model context.
- A model refusal is treated as the main privacy control.

The fix is to make permissions boring and explicit. Let the agent help users, while normal application code enforces identity, scope, tenant, environment, and approval.

## A Small Implementation Plan
<!-- section-summary: If your agent already exists, improve permission safety in a staged way:. -->

If your agent already exists, improve permission safety in a staged way:

1. List every tool and mark it read, draft, or action.
2. Add a `ToolContext` object that comes from authentication.
3. Remove user-controlled `tenant_id`, `user_id`, and `role` fields from tool arguments.
4. Add allowlists for each workflow.
5. Move high-impact actions to draft or approval mode.
6. Add memory filters for secrets and sensitive values.
7. Add trace redaction before traces leave the application.
8. Add regression tests for cross-tenant access and approval paths.

This plan is intentionally practical. You can ship it one slice at a time. The biggest early win is usually step three: stop trusting identity fields that arrive through model-generated tool arguments.

## What To Log For Audits
<!-- section-summary: A permission audit should answer who tried to do what, which policy applied, and what the application decided. Keep an audit event for every sensitive tool call:. -->

A permission audit should answer who tried to do what, which policy applied, and what the application decided. Keep an audit event for every sensitive tool call:

```json
{
  "event": "agent_tool_authorization",
  "trace_id": "tr_9ac4",
  "agent": "tenantdesk-support-agent",
  "tool": "create_billing_ticket",
  "user_id_hash": "u_94b1",
  "tenant_id": "tenant_487",
  "role": "support_engineer",
  "requested_scope": "ticket:draft",
  "decision": "allowed",
  "approval_required": true,
  "policy_version": "tenantdesk-permissions-2026-07-05"
}
```

For blocked calls, keep the reason:

```json
{
  "event": "agent_tool_authorization",
  "tool": "fetch_tenant_logs",
  "decision": "blocked",
  "reason": "tenant_mismatch",
  "requested_tenant": "tenant_b",
  "authenticated_tenant": "tenant_a"
}
```

These records are useful during incident response, customer escalations, and internal reviews. They also discourage vague permission rules because every decision needs a policy reason.

## What Good Feels Like
<!-- section-summary: In a well-designed system, the agent can still feel helpful. It answers questions, fetches allowed records, drafts useful work, and remembers safe preferences. The difference... -->

In a well-designed system, the agent can still feel helpful. It answers questions, fetches allowed records, drafts useful work, and remembers safe preferences. The difference is that every powerful action passes through normal application control. A user who has access gets help quickly. A user who lacks access gets a clear boundary. A reviewer can trace the decision later.

One quick test: ask the agent to fetch another tenant's record, store a fake secret in memory, and submit a refund. All three should produce clear policy outcomes with traceable audit reasons.

## Practical Checks
<!-- section-summary: Before shipping an agent, ask:. -->

Before shipping an agent, ask:

- Does every tool receive authenticated context from the application?
- Are user-provided tenant IDs ignored or validated?
- Are credentials short-lived and scoped?
- Does memory reject secrets and sensitive values?
- Are raw traces protected by role and tenant?
- Do high-impact actions require approval?
- Can you explain which data the agent can read in dev, staging, and production?
- Does CI include permission-boundary tests?

The interview-ready answer is: an agent should act with the user's authority, limited by task scope, environment, and policy. The model proposes actions; the application authorizes them.

## References

- [OpenAI Safety Best Practices](https://developers.openai.com/api/docs/guides/safety-best-practices)
- [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI Workload Identity Federation](https://developers.openai.com/api/docs/guides/workload-identity-federation)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [OWASP LLM02: Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm02-sensitive-information-disclosure/)
- [Kubernetes Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/)
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect)
