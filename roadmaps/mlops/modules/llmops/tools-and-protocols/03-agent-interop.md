---
title: "Agent Interop"
description: "Design multi-agent handoffs with typed packets, trace IDs, scopes, audit logs, protocol versions, and failure handling across agent frameworks."
overview: "Learn how agents can hand work to each other safely through a research-to-ticket workflow that uses structured handoff packets, scopes, traces, and review gates."
tags: ["MLOps","LLMOps","advanced","tools"]
order: 3
id: "article-mlops-llmops-agent-interop"
---

## What Agent Interop Means

<!-- section-summary: Agent interop is the ability for agents, tools, and runtimes to pass work across boundaries with enough structure for another system to continue safely. -->

**Agent interop** means agents can work together across boundaries without losing task state, permissions, traceability, or user intent. One agent may research an issue. Another may turn that research into an engineering ticket. A third may check policy or ask for approval. Interop is the set of contracts that lets those pieces cooperate.

The simplest multi-agent demo passes a paragraph from one agent to another. Production systems need more. The receiving agent needs the task objective, the evidence already gathered, the user-visible summary, the data sensitivity level, the allowed tools, the trace ID, and the failure state. If the receiving agent has to infer all of that from prose, handoffs will be inconsistent and hard to audit.

In this article, we will use **BrightDesk**, a SaaS company with an AI support workflow. A customer reports that exported CSV files from the analytics page have duplicated rows. The **Research Agent** reads the support conversation, searches runbooks, inspects recent deploy notes, and summarizes likely causes. The **Ticket Agent** turns the research into a Jira-style engineering ticket with reproduction steps, impact, labels, and owners. A **Review Agent** checks whether the ticket includes sensitive customer data before it is created.

That scenario teaches the core interop lesson. A handoff is a controlled transfer of work. It needs a typed packet, scoped access, trace IDs, audit logs, versioning, and failure handling. Frameworks such as the OpenAI Agents SDK, LangGraph, and LlamaIndex give you orchestration patterns, yet your business still needs the packet shape and policy.

## Handoffs, Managers, and Agents-as-Tools

<!-- section-summary: Multi-agent systems usually use manager routing, direct handoffs, or agents exposed as tools. The right choice depends on who should keep control after the next step. -->

There are several ways to make agents cooperate.

| Pattern | How it works | BrightDesk example |
| --- | --- | --- |
| Manager routing | One coordinator calls specialist agents and combines results. | A Support Orchestrator asks Research Agent and Ticket Agent for outputs. |
| Direct handoff | One active agent transfers control to another active agent. | Research Agent hands the case to Ticket Agent after evidence is ready. |
| Agent as tool | A specialist agent is callable like a tool and returns a result. | Ticket Agent drafts a ticket while Research Agent stays in control. |
| Workflow graph | Nodes pass structured state through a graph. | Research, review, ticket creation, and approval run as graph steps. |

The OpenAI Agents SDK describes agents as LLMs configured with instructions, tools, and optional handoffs, guardrails, and structured outputs. It also treats handoffs as tools the model can select. LangGraph documents both supervisor-style subagents and handoff patterns. LlamaIndex documents AgentWorkflow, orchestrator, and custom planner patterns. The vocabulary differs by framework, but the production design question stays the same: who owns control after the next step?

For BrightDesk, direct handoff is useful after research is complete because the next task has a different owner and a different output format. The Research Agent should stop gathering evidence and transfer to Ticket Agent with a packet. If the Ticket Agent only needed a small draft while Research Agent kept control, then agent-as-tool would fit.

The handoff packet is the boundary. It should contain enough structure that the Ticket Agent can continue without re-reading the whole chat transcript or inventing missing state.

## The Handoff Packet

<!-- section-summary: A handoff packet is a typed payload that carries objective, context, evidence, permissions, trace data, and expected output from one agent to another. -->

A **handoff packet** is a JSON object that one agent sends when it delegates work. It is similar to a tool call input, yet it carries broader task context. It should be easy to validate, easy to log, and safe to pass across services.

Here is the BrightDesk packet from Research Agent to Ticket Agent.

```json
{
  "handoff_version": "2026-07-01",
  "handoff_id": "hnd_01JZK8R2CKE9B7T3G5ZK5P1QAA",
  "trace_id": "trc_4f79a13d8a20494b9dcd3f7e0e1a9bb2",
  "source_agent": "support_research_agent",
  "target_agent": "engineering_ticket_agent",
  "task": {
    "objective": "Create an engineering ticket for duplicate rows in CSV exports.",
    "priority_hint": "high",
    "requested_output": "ticket_draft"
  },
  "case": {
    "support_case_id": "case_874221",
    "customer_tier": "enterprise",
    "product_area": "analytics_exports",
    "reported_at": "2026-07-05T09:20:00Z"
  },
  "evidence": [
    {
      "kind": "customer_report",
      "summary": "Customer sees duplicate rows when exporting filtered dashboard data to CSV.",
      "source_ref": "support_case:case_874221#message_4"
    },
    {
      "kind": "runbook",
      "summary": "Exports are produced by export-worker using report_snapshot_id as the dedupe key.",
      "source_ref": "runbook:analytics-export-debugging#dedupe"
    },
    {
      "kind": "deploy_note",
      "summary": "export-worker 4.18.0 changed pagination for filtered exports on 2026-07-04.",
      "source_ref": "deploy:export-worker-4.18.0"
    }
  ],
  "constraints": {
    "allowed_tools": ["ticket.create_draft", "ticket.search_similar", "audit.write_event"],
    "forbidden_fields": ["customer_email", "access_token", "raw_csv"],
    "human_approval_required": true,
    "data_classification": "customer_confidential"
  },
  "audit": {
    "handoff_reason": "research_complete",
    "created_by": "support_research_agent",
    "visible_to_user": false
  }
}
```

This packet gives the Ticket Agent concrete inputs. It has a version, ID, trace ID, source, target, task, case metadata, evidence, constraints, and audit details. The receiving agent can validate the packet before doing anything. If `allowed_tools` lacks `ticket.create_draft`, the Ticket Agent should stop and return a rejected result. If the evidence includes `raw_csv`, the Review Agent should block the handoff before ticket creation.

The packet also limits repeated work. The Ticket Agent can cite the deploy note and runbook reference without searching from scratch. That saves tokens and reduces drift between agents.

![BrightDesk duplicate CSV export research-to-ticket handoff](/content-assets/articles/article-mlops-llmops-agent-interop/research-to-ticket-handoff.png)

*BrightDesk passes a typed packet from research to review to ticket drafting, with evidence references, allowed tools, forbidden fields, and approval requirements carried together.*

## Validating Handoffs

<!-- section-summary: Handoff validation protects the receiving agent from vague, stale, or unsafe inputs. Treat packet schemas like API schemas and test them in CI. -->

Use a schema for handoff packets. The schema can live in a shared package used by all agent services. The goal is to reject unsafe or incomplete transfers before a model sees the packet.

```json
{
  "$id": "https://brightdesk.example/schemas/agent-handoff-2026-07-01.json",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "handoff_version": { "type": "string", "enum": ["2026-07-01"] },
    "handoff_id": { "type": "string", "pattern": "^hnd_[A-Z0-9]{26}$" },
    "trace_id": { "type": "string", "pattern": "^trc_[0-9a-f]{32}$" },
    "source_agent": { "type": "string" },
    "target_agent": { "type": "string" },
    "task": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "objective": { "type": "string", "minLength": 20, "maxLength": 300 },
        "priority_hint": { "type": "string", "enum": ["low", "normal", "high", "urgent"] },
        "requested_output": { "type": "string", "enum": ["ticket_draft", "research_summary", "approval_request"] }
      },
      "required": ["objective", "priority_hint", "requested_output"]
    },
    "case": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "support_case_id": { "type": "string" },
        "customer_tier": { "type": "string", "enum": ["free", "team", "business", "enterprise"] },
        "product_area": { "type": "string" },
        "reported_at": { "type": "string", "format": "date-time" }
      },
      "required": ["support_case_id", "customer_tier", "product_area", "reported_at"]
    },
    "evidence": {
      "type": "array",
      "minItems": 1,
      "maxItems": 10,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": { "type": "string", "enum": ["customer_report", "runbook", "deploy_note", "log_summary", "similar_ticket"] },
          "summary": { "type": "string", "minLength": 20, "maxLength": 500 },
          "source_ref": { "type": "string", "minLength": 5, "maxLength": 200 }
        },
        "required": ["kind", "summary", "source_ref"]
      }
    },
    "constraints": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "allowed_tools": { "type": "array", "items": { "type": "string" } },
        "forbidden_fields": { "type": "array", "items": { "type": "string" } },
        "human_approval_required": { "type": "boolean" },
        "data_classification": { "type": "string", "enum": ["public", "internal", "customer_confidential", "regulated"] }
      },
      "required": ["allowed_tools", "forbidden_fields", "human_approval_required", "data_classification"]
    },
    "audit": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "handoff_reason": { "type": "string" },
        "created_by": { "type": "string" },
        "visible_to_user": { "type": "boolean" }
      },
      "required": ["handoff_reason", "created_by", "visible_to_user"]
    }
  },
  "required": ["handoff_version", "handoff_id", "trace_id", "source_agent", "target_agent", "task", "case", "evidence", "constraints", "audit"]
}
```

The schema checks basic structure. You also need policy checks. For example, a packet marked `customer_confidential` should pass through Review Agent before ticket creation. A packet with `human_approval_required: true` should create a draft ticket, then wait for a human approval action before posting it to the engineering queue.

Here are validation tests that catch common handoff failures.

```ts
describe("agent handoff packet", () => {
  it("accepts a research-to-ticket packet with evidence and approval", () => {
    expect(validateHandoff(validResearchToTicketPacket())).toBe(true);
  });

  it("rejects packets with raw customer fields", () => {
    const packet = validResearchToTicketPacket({
      evidence: [
        {
          kind: "customer_report",
          summary: "Customer attached raw CSV output with private account rows.",
          source_ref: "support_case:case_874221#raw_csv"
        }
      ]
    });

    const result = runPolicyChecks(packet);
    expect(result.status).toBe("rejected");
    expect(result.error.code).toBe("forbidden_source_ref");
  });

  it("requires ticket tool scope before draft creation", () => {
    const packet = validResearchToTicketPacket({
      constraints: {
        allowed_tools: ["ticket.search_similar"],
        forbidden_fields: ["customer_email", "access_token", "raw_csv"],
        human_approval_required: true,
        data_classification: "customer_confidential"
      }
    });

    const result = runPolicyChecks(packet);
    expect(result.error.code).toBe("missing_allowed_tool");
  });
});
```

The tests use the same language as the incident review would use: forbidden source reference, missing allowed tool, approval required. That keeps validation understandable for engineers, security reviewers, and support leaders.

## Auth Scopes, Audit Logs, and Trace IDs

<!-- section-summary: Interop needs security and observability fields in every handoff because work crosses agent, service, and team boundaries. -->

Agent interop creates a new access-control question. The Research Agent may read support cases and runbooks. The Ticket Agent may create engineering tickets. The Review Agent may inspect redacted content. Each agent needs a different set of scopes.

Here is a scope manifest for the BrightDesk workflow.

```yaml
workflow: support-research-to-ticket
version: "2026-07-01"
agents:
  support_research_agent:
    scopes:
      - support.case:read
      - runbook:read
      - deploy_notes:read
      - handoff:create
  engineering_ticket_agent:
    scopes:
      - ticket.search:read
      - ticket.draft:create
      - audit.event:write
  handoff_review_agent:
    scopes:
      - handoff:review
      - policy.redaction:check
gates:
  customer_confidential:
    required_agent: handoff_review_agent
    required_human_action: approve_ticket_draft
trace:
  required_fields:
    - trace_id
    - handoff_id
    - source_agent
    - target_agent
audit:
  event_stream: agent_audit_events
  retention_days: 400
  payload_logging: redacted
```

The manifest says which agent can do which work. It also says that customer-confidential handoffs need review and human approval before the ticket leaves draft state. That matters because a model-generated ticket can accidentally include private customer details. The Review Agent can check for forbidden fields and ask for redaction.

Every handoff should create an audit event.

```json
{
  "event_type": "agent_handoff_created",
  "event_version": "2026-07-01",
  "timestamp": "2026-07-05T10:02:11Z",
  "trace_id": "trc_4f79a13d8a20494b9dcd3f7e0e1a9bb2",
  "handoff_id": "hnd_01JZK8R2CKE9B7T3G5ZK5P1QAA",
  "source_agent": "support_research_agent",
  "target_agent": "engineering_ticket_agent",
  "support_case_id": "case_874221",
  "data_classification": "customer_confidential",
  "policy_result": "requires_review",
  "allowed_tools": ["ticket.create_draft", "ticket.search_similar", "audit.write_event"]
}
```

Trace IDs connect the handoff to the model calls, tool calls, MCP server calls, ticket API calls, and audit events. The OpenAI Agents SDK includes tracing for model generations, tool calls, handoffs, guardrails, and custom events. OpenTelemetry's GenAI conventions give teams a common place to standardize spans, metrics, and events across providers and frameworks. Even if your framework has its own trace viewer, emit vendor-neutral trace data for long-term operations and incident response.

![BrightDesk handoff validation and observability gates](/content-assets/articles/article-mlops-llmops-agent-interop/validation-observability.png)

*The handoff runtime validates required fields, checks customer-confidential policy, replays safe retries, and links agents, tools, tickets, and audit events with one trace ID.*

## Producing the Ticket Draft

<!-- section-summary: The receiving agent should transform the packet into a bounded output, then wait for required approval before creating or publishing work in another system. -->

After validation, the Ticket Agent can create a draft. The output should be structured so the UI can display it and a human reviewer can approve it.

```json
{
  "ticket_draft": {
    "title": "CSV exports can duplicate rows for filtered analytics dashboards",
    "product_area": "analytics_exports",
    "priority": "high",
    "customer_impact": "Enterprise customer reports duplicated rows in filtered CSV exports. Impact may affect weekly reporting workflows.",
    "reproduction_steps": [
      "Open an analytics dashboard with a filtered date range.",
      "Export the dashboard to CSV.",
      "Compare account_id_hash and event_date pairs for repeated rows."
    ],
    "evidence": [
      "support_case:case_874221#message_4",
      "runbook:analytics-export-debugging#dedupe",
      "deploy:export-worker-4.18.0"
    ],
    "suspected_change": "export-worker 4.18.0 changed filtered export pagination on 2026-07-04.",
    "labels": ["analytics", "csv-export", "enterprise-impact"],
    "owner_team": "data-experience",
    "approval_state": "pending_human_review"
  },
  "handoff_id": "hnd_01JZK8R2CKE9B7T3G5ZK5P1QAA",
  "trace_id": "trc_4f79a13d8a20494b9dcd3f7e0e1a9bb2"
}
```

This output is useful because it stays bounded. The Ticket Agent can draft, search for similar tickets, and write audit events. It needs human approval before publishing. If a human edits the draft, record that as a separate audit event. During a later incident review, the team should see which parts came from the agent and which parts came from a person.

The ticket body should cite evidence references instead of copying sensitive content. For example, use `support_case:case_874221#message_4` rather than a customer's raw file. Engineers with the right access can follow the reference. People without access still get enough summary to triage the ticket.

## Failure Handling Across Agents

<!-- section-summary: Handoffs fail in predictable ways: missing scopes, stale versions, unsafe evidence, duplicate handoff IDs, and unavailable target agents. Each failure should return a structured result. -->

Interop failure can be messy because more than one system participates. A robust workflow uses a shared failure envelope so the caller can recover.

```json
{
  "status": "rejected",
  "handoff_id": "hnd_01JZK8R2CKE9B7T3G5ZK5P1QAA",
  "trace_id": "trc_4f79a13d8a20494b9dcd3f7e0e1a9bb2",
  "source_agent": "support_research_agent",
  "target_agent": "engineering_ticket_agent",
  "error": {
    "code": "review_required",
    "message": "Customer-confidential evidence needs policy review before ticket draft creation.",
    "safe_next_step": "Route the packet to handoff_review_agent."
  }
}
```

Here are the failures BrightDesk tests:

- **Unsupported version:** The receiving agent only accepts `handoff_version: "2026-07-01"`.
- **Missing scope:** The target agent lacks `ticket.draft:create`.
- **Unsafe evidence:** A `source_ref` points to raw CSV or a token-bearing attachment.
- **Duplicate handoff ID:** The runtime receives the same `handoff_id` with different content.
- **Unavailable target:** The Ticket Agent service is down or over its rate limit.
- **Approval timeout:** The draft approval remains pending past the support SLA.

Each failure should tell the caller where to route the work next. Some failures go back to the source agent for more research. Some go to the Review Agent. Some create a human queue item. Avoid asking the receiving model to improvise recovery from a stack trace. Give it a clear code and a safe next step.

Idempotency matters here too. `handoff_id` should be stable for one transfer attempt. If the Research Agent retries after a timeout, the workflow can replay the same result. If the same ID arrives with different evidence, reject it as a conflict and write an audit event.

## Practical Checks, Common Mistakes, and Interview-Ready Understanding

<!-- section-summary: Good agent interop feels like API design plus workflow operations. Typed packets, scopes, traces, review gates, and failure envelopes are the core skills to explain. -->

Use this checklist before shipping a multi-agent handoff:

- **Packet schema:** The handoff has a typed schema with version, ID, trace ID, source, target, task, evidence, constraints, and audit fields.
- **Policy checks:** The runtime checks data classification, allowed tools, forbidden fields, human approval requirements, and target-agent scopes.
- **Trace continuity:** The same trace ID connects model calls, tool calls, MCP calls, handoff events, and ticket API calls.
- **Audit events:** Every handoff, review decision, draft creation, human edit, and publish action writes a redacted audit event.
- **Idempotency:** The workflow can replay duplicate handoff attempts and reject conflicting attempts.
- **Versioning:** Agents agree on `handoff_version`, and old versions have an explicit migration window.
- **Failure envelopes:** Rejections and system failures return stable codes and safe next steps.
- **Human gates:** Customer-confidential or external side-effecting work waits for human approval where policy requires it.

Common mistakes usually come from passing prose where a packet is needed. The receiving agent gets a long summary and has to guess the product area, priority, evidence links, and permissions. Another mistake is giving every agent the same broad tool access. That makes audit trails vague and raises the blast radius of a bad prompt or bad handoff. Teams also forget that handoff traces need to cross framework boundaries. A LangGraph step, an OpenAI Agents SDK handoff, a LlamaIndex AgentWorkflow call, and an MCP tool call can all participate in one business workflow. Use trace IDs and audit events that outlive any single framework.

In an interview, a strong answer ties the pieces together: "Agent interop is a contract for transferring work. I would use a versioned handoff packet with objective, evidence, constraints, scopes, trace ID, and audit fields. The receiving agent validates the packet, checks policy, emits audit events, and returns a structured result or failure envelope. Framework handoffs help orchestration, while the business contract keeps the transfer safe."

![BrightDesk agent interop shipping checklist](/content-assets/articles/article-mlops-llmops-agent-interop/shipping-checklist.png)

*BrightDesk ships interop only after the packet schema, scoped agents, review gate, trace continuity, failure envelopes, and rollback path are ready for the duplicate CSV export workflow.*

## References

- [OpenAI Agents SDK overview](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK: Agents](https://openai.github.io/openai-agents-python/agents/)
- [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [LangChain docs: Multi-agent patterns](https://docs.langchain.com/oss/python/langchain/multi-agent)
- [LlamaIndex docs: Multi-agent patterns](https://developers.llamaindex.ai/python/framework/understanding/agent/multi_agent/)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
