---
title: "Subagents and Handoffs"
description: "Design specialist agents, handoff packets, ownership boundaries, trace links, and merge gates for multi-agent workflows that need coordination."
overview: "Learn how an incident-response team splits an LLM workflow across specialist subagents, passes structured handoff packets, avoids conflicts, and gates the final response."
tags: ["MLOps","LLMOps","advanced","skills"]
order: 2
id: "article-mlops-llmops-subagents-and-handoffs"
---

## What Subagents And Handoffs Solve

<!-- section-summary: Subagents split complex work across specialists, while handoffs transfer context and ownership between those specialists. The goal is controlled delegation: each worker gets a clear task, a safe tool surface, and a structured packet to return. -->

A **subagent** is a specialist agent that handles a bounded part of a larger task. A **handoff** is the structured transfer of work, context, and responsibility from one agent or workflow step to another. You use these patterns when one agent has too much to inspect, too many tools to choose from, or too many policies to follow in one conversation.

We will use **BrightCart**, a fictional ecommerce platform, as the running example. BrightCart has an incident at 02:14 UTC. Customers report duplicate order confirmations, payment webhooks are retrying, and the support queue is filling with angry messages. The on-call engineer opens the incident assistant and asks, "Help triage the duplicate confirmation incident and prepare the first internal update."

A single agent could try to inspect logs, query metrics, summarize customer impact, check recent deployments, draft Slack updates, and recommend rollback. That sounds convenient, yet it creates a coordination problem. The agent may mix evidence from different systems, run too many tools, or draft a confident message before the facts are ready. Incident response needs speed, but it also needs ownership, traceability, and safe action gates.

BrightCart uses subagents for the parts that can run in parallel:

| Specialist | Main task | Tool surface | Output |
| --- | --- | --- | --- |
| Metrics worker | Inspect checkout, payment, and email metrics | Read-only dashboards and query APIs | Timeline and anomaly summary |
| Logs worker | Search service logs and trace errors | Read-only log search | Error patterns and trace IDs |
| Deploy worker | Compare recent deploys and config changes | Git, deployment registry, feature flags | Suspect changes and rollback candidates |
| Support worker | Summarize tickets and customer reports | Support queue read access | Customer impact summary |
| Comms worker | Draft updates from approved evidence | No production tools | Slack and status-page drafts |

The main incident coordinator owns the final packet. It assigns the workers, waits for their results, resolves conflicts, asks humans for approval on risky actions, and produces the internal update. That split gives the team parallel speed without giving every worker every tool.

![BrightCart incident subagents](/content-assets/articles/article-mlops-llmops-subagents-and-handoffs/brightcart-incident-subagents.png)
*BrightCart keeps the coordinator in charge while specialist workers inspect only the evidence and tools they need.*

## Choose The Right Delegation Pattern

<!-- section-summary: Use subagents when the main coordinator should stay in control and collect specialist results. Use handoffs when the next specialist should own the next response or workflow branch. -->

Multi-agent systems have several patterns. The important design question is **who owns the next decision**. If the main coordinator should collect results and synthesize the final answer, subagents as tools fit well. If a specialist should take over a branch of the conversation or workflow, use a handoff. OpenAI's Agents documentation describes the same ownership choice: handoffs transfer control to a specialist, while agents-as-tools keep the manager in charge.

For BrightCart's incident, most work uses the subagent pattern. The coordinator asks the metrics worker, logs worker, deploy worker, and support worker to inspect different evidence. Those workers return findings to the coordinator. They do not post incident updates, roll back services, or page teams directly.

A handoff makes sense when ownership truly moves. If the coordinator finds that the root issue sits inside the payment webhook service and requires a payment-platform owner, the workflow can hand off to a **Payment Incident Lead** agent or human queue. That lead receives the incident packet, trace links, suspected change, customer impact, and pending decisions. From that point, the payment lead owns the technical remediation branch, while the original coordinator may continue owning communications.

Here is a simple decision table:

| Need | Pattern | BrightCart example |
| --- | --- | --- |
| Parallel read-heavy investigation | Subagents | Metrics, logs, deploy, and support workers run together. |
| One stable final answer | Subagents as tools | Coordinator writes the incident update after workers report back. |
| Specialist owns next branch | Handoff | Payment lead takes over webhook remediation. |
| Deterministic routing by severity | Router | P0 incidents route to incident commander and executive comms. |
| Human approval before side effects | Workflow gate | Rollback or customer-facing status update waits for approval. |

The pattern can change inside one incident. BrightCart starts with subagents for evidence. It uses a handoff when a domain owner must take responsibility. It uses a human approval gate for rollback and public communication.

## Write Worker Briefs Like Production Tickets

<!-- section-summary: A worker brief should define the task, scope, inputs, tools, stop conditions, output schema, and conflict rules. Good briefs make subagent work small enough to run safely and useful enough to merge later. -->

A subagent works best when it receives a brief that looks like a small production ticket. The brief should answer: What should the worker inspect? Which systems may it use? Which actions are blocked? What output should it return? What evidence format should it include? When should it stop and escalate?

BrightCart keeps worker briefs in the incident coordinator prompt and in a versioned workflow file. The metrics worker brief looks like this:

```yaml
worker_brief:
  worker_id: metrics-worker
  incident_id: inc_2026_07_05_0214
  objective: "Find the first abnormal checkout, payment, and email metric changes related to duplicate confirmations."
  allowed_tools:
    - read_prometheus_range
    - read_checkout_funnel_dashboard
    - read_email_delivery_metrics
  blocked_tools:
    - write_feature_flag
    - restart_service
    - post_slack_message
  inputs:
    time_window_utc:
      start: "2026-07-05T01:30:00Z"
      end: "2026-07-05T03:00:00Z"
    services:
      - checkout-api
      - payment-webhook-consumer
      - email-notifier
  stop_conditions:
    - "Tool permission error prevents metric access."
    - "Metric data is stale by more than five minutes."
    - "Evidence suggests customer-facing payment capture risk."
  output_schema:
    timeline: "ordered list of metric events with UTC timestamps"
    suspected_services: "list of services with confidence and evidence"
    customer_impact: "plain-English impact summary"
    trace_links: "dashboard URLs or query IDs"
    unknowns: "questions the coordinator must resolve"
```

The brief avoids vague instructions such as "look at metrics." It names the incident, the time window, the services, and the tools. It blocks side effects. It asks for evidence and unknowns. It also gives stop conditions. If metric data is stale, the worker should say so instead of inventing a timeline.

Workers should receive only the context they need. The metrics worker needs the incident summary, time window, service names, and dashboard access. It does not need customer email text or legal communication policy. The support worker needs ticket excerpts and customer impact labels, yet it should not receive deployment credentials. Narrow context reduces tool mistakes and privacy exposure.

## Design Handoff Packets

<!-- section-summary: A handoff packet is the structured bundle that travels from one owner to the next. It should contain evidence, decisions, open questions, trace IDs, permissions, and expected next action. -->

During the incident, the logs worker finds a burst of `duplicate_confirmation_key` warnings in `email-notifier`. The deploy worker reports that a feature flag changed at 02:03 UTC to enable a new idempotency path for confirmation emails. The coordinator now needs a payment-platform owner and an email-platform owner to inspect remediation. This is where a handoff packet matters.

A handoff packet should be boring and complete. It should avoid storytelling and preserve facts. The receiving agent or human should know what happened, what evidence supports it, what has already been tried, which actions are allowed, and which actions need approval.

```json
{
  "handoff_id": "hnd_01JZKB9W7S8Q",
  "incident_id": "inc_2026_07_05_0214",
  "from_owner": "incident-coordinator",
  "to_owner": "email-platform-lead",
  "handoff_reason": "Evidence points to duplicate confirmation emails after idempotency flag change.",
  "severity": "SEV-2",
  "trace_id": "trace_inc_2026_07_05_0214_root",
  "time_window_utc": {
    "start": "2026-07-05T01:30:00Z",
    "end": "2026-07-05T03:00:00Z"
  },
  "evidence": [
    {
      "source": "logs-worker",
      "summary": "Warnings for duplicate_confirmation_key increased from 0/min to 180/min after 02:05 UTC.",
      "link": "logs://query/qry_7341",
      "confidence": "high"
    },
    {
      "source": "deploy-worker",
      "summary": "Feature flag email_idempotency_v2 enabled for 100 percent of traffic at 02:03 UTC.",
      "link": "deploy://flags/email_idempotency_v2/events/evt_88"
    }
  ],
  "actions_already_taken": [
    "No rollback performed.",
    "No customer-facing status update posted.",
    "Support macro draft prepared but not sent."
  ],
  "allowed_next_actions": [
    "Inspect email-notifier logs.",
    "Check feature flag configuration.",
    "Draft rollback recommendation."
  ],
  "approval_required_actions": [
    "Disable production feature flag.",
    "Post customer-facing status update.",
    "Send bulk customer email."
  ],
  "open_questions": [
    "Did duplicate emails include successful payment captures or confirmation emails only?",
    "Can the flag be disabled without losing valid confirmations?"
  ],
  "expected_response": "Return remediation recommendation, rollback risk, validation query, and owner decision needed."
}
```

The receiving owner can act quickly because the packet carries a ready-made incident context. The trace ID lets them inspect the whole path. Evidence links let them verify claims. Approval-required actions protect the system from a worker taking risky action alone.

![BrightCart handoff packet](/content-assets/articles/article-mlops-llmops-subagents-and-handoffs/brightcart-handoff-packet.png)
*A handoff packet moves ownership with evidence, trace links, open questions, allowed actions, and approval gates already attached.*

## Ownership Boundaries And Conflict Avoidance

<!-- section-summary: Multi-agent work needs clear ownership because parallel workers can produce overlapping or contradictory recommendations. Assign one owner per decision, lock write actions behind gates, and merge evidence through a coordinator. -->

Parallel work creates conflicts if ownership is vague. The logs worker may say the problem is `email-notifier`. The deploy worker may blame a feature flag in `checkout-api`. The support worker may report that customers mention duplicate payment confirmations, which sounds more serious than duplicate emails. The coordinator must merge those signals without letting one worker overwrite another.

BrightCart uses these ownership rules:

- Each worker owns evidence collection inside its scope.
- The coordinator owns the merged incident timeline.
- Domain leads own remediation recommendations for their services.
- Humans own production rollbacks and customer-facing messages.
- The comms worker drafts updates only from evidence marked approved by the coordinator.

Conflict avoidance also needs technical controls. Side-effecting tools should require approval. Write actions should use idempotency keys. Workers should use branch-like workspaces for file edits or draft outputs. Shared incident state should accept append-only findings, then let the coordinator publish the merged summary.

Here is a small conflict policy:

```yaml
conflict_policy:
  evidence_store: append_only
  merge_owner: incident-coordinator
  write_locks:
    feature_flags:
      owner: human-incident-commander
      approval_required: true
    status_page:
      owner: communications-lead
      approval_required: true
    incident_timeline:
      owner: incident-coordinator
      approval_required: false
  disagreement_rules:
    - "If two workers identify different first-bad timestamps, include both with source links."
    - "If customer impact is unclear, label impact as unconfirmed and request support validation."
    - "If rollback risk is unknown, escalate to the owning service lead before action."
```

This policy keeps the final incident packet honest. The coordinator can say, "Logs indicate warnings at 02:05 UTC; deployment data shows flag rollout at 02:03 UTC; support impact is still under review." That is more useful than forcing premature certainty.

## Trace IDs Make Handoffs Auditable

<!-- section-summary: Trace IDs connect the coordinator run, worker runs, tool calls, handoff packets, human approvals, and final updates. Without trace links, incident review turns into a hunt through chat messages and logs. -->

Incident response needs an audit trail. Agents add another layer: model calls, tool calls, handoffs, validation checks, and human approvals. A trace ID gives the team one handle that connects those events.

OpenAI's Agents SDK tracing records model calls, tool calls, handoffs, guardrails, and custom events. LangSmith and LangGraph systems also use traces and graph state to inspect multi-agent flows. The exact platform can vary, yet the operating principle stays the same: every worker and handoff should carry the incident ID and trace ID.

BrightCart uses this trace envelope for worker output:

```json
{
  "incident_id": "inc_2026_07_05_0214",
  "worker_id": "logs-worker",
  "parent_trace_id": "trace_inc_2026_07_05_0214_root",
  "worker_trace_id": "trace_inc_2026_07_05_0214_logs",
  "started_at": "2026-07-05T02:18:11Z",
  "completed_at": "2026-07-05T02:20:46Z",
  "tools_used": [
    {
      "name": "search_logs",
      "query_id": "qry_7341",
      "time_window": "2026-07-05T01:30:00Z/2026-07-05T03:00:00Z"
    }
  ],
  "findings_count": 3,
  "validation_status": "passed"
}
```

When the incident review happens later, the team can answer practical questions. Which worker found the first bad signal? Which tool returned the evidence? Did any worker request a blocked action? Which human approved the rollback? Which draft did comms use for the first update? These questions matter because post-incident learning depends on evidence, not memory.

Trace IDs also help evaluation. You can collect past incident traces, label whether the coordinator picked the right specialists, and run regression tests against new prompts or workflow changes. A multi-agent workflow should improve through traces, datasets, and review, just like any other production LLM system.

![BrightCart merge gates before action](/content-assets/articles/article-mlops-llmops-subagents-and-handoffs/brightcart-merge-gates.png)
*The coordinator merges worker evidence through conflict checks, human approval, and trace-linked updates before any rollback or public-facing message.*

## Review And Merge Gates

<!-- section-summary: The coordinator should merge worker outputs through validation and review gates before the workflow sends updates or changes production. Gates protect the team from fast, polished, unsupported answers. -->

Subagents can run quickly, and that speed creates pressure to act. BrightCart uses gates before any merged result reaches a high-impact channel.

The first gate is **schema validation**. Every worker response must match the expected structure. The second gate is **evidence validation**. Claims need source links, timestamps, and confidence. The third gate is **conflict review**. If two workers disagree, the coordinator includes the disagreement and asks a domain owner to decide. The fourth gate is **human approval** for rollbacks, customer-facing updates, and bulk messages.

Here is the validation checklist BrightCart runs before the coordinator publishes the internal update:

```yaml
validation_checklist:
  worker_outputs:
    - "Every worker response has worker_id, parent_trace_id, worker_trace_id, and completed_at."
    - "Every finding has a timestamp, source, evidence link, and confidence."
    - "Every unknown is assigned to an owner or follow-up worker."
  merge_quality:
    - "The incident timeline is ordered by UTC timestamp."
    - "Conflicting evidence is preserved with source links."
    - "Customer impact is labeled confirmed, likely, or unconfirmed."
  safety_gates:
    - "No worker performed production write actions."
    - "Rollback recommendation includes risk and validation query."
    - "Customer-facing drafts require communications approval."
  final_packet:
    - "The internal update names current severity, scope, owner, next action, and next update time."
    - "The packet includes trace IDs for coordinator and workers."
    - "The packet includes a decision log for approvals and rejected actions."
```

The internal update can then stay concise:

```markdown
Incident inc_2026_07_05_0214 is SEV-2.

Current evidence points to duplicate confirmation emails after `email_idempotency_v2` reached 100 percent traffic at 02:03 UTC. Log warnings increased at 02:05 UTC. Support reports duplicate confirmation emails from 37 customers so far. Payment capture duplication is unconfirmed and under active validation.

Current owner: email-platform lead.
Next action: evaluate disabling `email_idempotency_v2` and run the validation query for payment captures.
Next update: 02:45 UTC.
Trace bundle: trace_inc_2026_07_05_0214_root.
```

Notice that the update separates confirmed facts from open questions. That is the point of the merge gate. It turns fast parallel investigation into a careful shared record.

## How This Maps To Agent Frameworks

<!-- section-summary: Frameworks provide different names and primitives, yet the same design choices appear across them: specialists, tools, handoffs, state, traces, and human review. Learn the pattern first, then pick the framework details. -->

OpenAI Agents SDK, LangChain, and LangGraph all expose ways to design specialist workflows. OpenAI Agents supports agents, tools, handoffs, guardrails, tracing, and evaluation workflows. LangChain's multi-agent docs describe subagents, handoffs, skills, routers, and custom workflows. LangGraph models workflows as graphs, with commands that can update state and route execution, plus interrupts for human review.

For BrightCart, an OpenAI Agents style design might keep the coordinator as the main agent and expose specialists as tools. A handoff can transfer control to an email-platform lead when that branch owns remediation. Tracing records the coordinator run, worker calls, handoff, guardrails, and custom incident events.

In LangGraph, the coordinator can be a graph node, each worker can be a node or subgraph, and a `Command` can update state and route to the next node. Interrupts can pause before rollback approval. Subgraphs help when different teams own different pieces, such as payment, email, and support workflows, as long as each subgraph has a clear input and output schema.

The framework choice matters for implementation, yet the article's production lesson is framework-neutral:

- Give each specialist a narrow job.
- Keep tool access scoped to that job.
- Pass structured handoff packets.
- Record trace IDs across the whole run.
- Preserve conflicting evidence until an owner resolves it.
- Gate side effects behind human or policy approval.
- Evaluate routing, tool use, handoff quality, and final packets with real incident examples.

If the design cannot explain ownership and evidence flow on paper, the code will struggle in production.

## Practical Checks, Mistakes, And Interview-Ready Understanding

<!-- section-summary: A strong multi-agent workflow has bounded workers, structured handoffs, traceable evidence, conflict rules, and review gates. Interview answers should focus on ownership and observability rather than the number of agents. -->

Use this checklist before you ship a subagent workflow:

- Each worker has one objective, a narrow tool surface, blocked actions, and stop conditions.
- Worker outputs use a schema with evidence links, confidence, unknowns, and trace IDs.
- Handoff packets state the reason, owner change, evidence, allowed actions, approval-required actions, and expected response.
- The coordinator owns merge decisions and final packet quality.
- Side effects such as rollback, feature-flag writes, status updates, and bulk messages require approval.
- Conflict rules preserve disagreement until a domain owner resolves it.
- Traces link coordinator, workers, handoffs, tool calls, approvals, and final updates.
- Evaluation cases include normal incidents, noisy evidence, stale dashboards, tool failures, and conflicting worker findings.
- Rollout starts in shadow mode against historical incidents before live incident use.

Common mistakes include spawning many workers without a merge owner, giving every worker every tool, passing entire chat history into every specialist, allowing a comms worker to publish without approval, and hiding conflicts in a polished summary. Multi-agent workflows can make teams faster, yet they also create more places for unclear ownership to cause trouble.

For interviews, explain it this way: **subagents are bounded specialists, and handoffs are structured ownership transfers**. Production quality comes from worker briefs, scoped tools, handoff packets, trace IDs, conflict policy, review gates, and evaluation. The point is not having many agents. The point is giving each piece of work the right owner, context, tools, and evidence trail.

## References

- [OpenAI API: Orchestration and Handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration)
- [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI Agents SDK: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI API: Guardrails and Human Review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
- [OpenAI API: Evaluate Agent Workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [LangChain Docs: Multi-Agent Overview](https://docs.langchain.com/oss/python/langchain/multi-agent)
- [LangChain Docs: Subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents)
- [LangGraph Docs: Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api)
