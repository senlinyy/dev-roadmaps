---
title: "Memory and State"
description: "Design short-term state, durable memory, task progress, and privacy rules so long-running agents can continue work without losing the thread or over-saving user data."
overview: "Memory and state give an LLM application continuity: what is happening right now, what the system has already done, and what the app may remember for later."
tags: ["MLOps","LLMOps","production","context"]
order: 2
id: "article-mlops-llmops-memory-and-state"
---
## What Memory And State Mean

<!-- section-summary: State records the current workflow, while memory stores selected facts for future use. Production agents need both, with clear rules for what gets saved, updated, expired, and shown to the model. -->

**State** is the structured record of what is happening in the current run. It can include the active job ID, the latest user message, the tools already called, the checklist items completed, the current plan, and the next step. **Memory** is selected information the system may use later, across turns, sessions, or jobs. It can include a site preference, a technician's certified equipment types, or a repeated customer constraint.

The difference matters because LLM applications often fail in two opposite ways. Some forget important work as soon as the next step starts. Others save everything forever and then surface old, private, or irrelevant details in future requests. Memory and state design gives the app continuity without turning every conversation into permanent baggage.

We will use a field-service scenario. **GridWorks Service** maintains commercial refrigeration systems for grocery stores. A technician named Maya is on a late-night repair call at Store 118. She uses a voice-enabled field-service agent to diagnose a rooftop condenser, check warranty coverage, reserve a replacement fan motor, and update the work order. The agent needs to remember the current repair path during the job. It may also store a durable memory that Store 118 requires manager approval before power shutdowns. It should avoid storing a customer's phone number in a long-term memory just because someone said it during a call.

The spine of this article is: a technician has a long repair workflow, state tracks the live workflow, memory saves carefully chosen facts for later, stores and policies make those records safe, and observability shows whether the agent used them well.

## The Field-Service Scenario

<!-- section-summary: A field-service agent is a useful example because the work spans tools, safety steps, parts, customer rules, and follow-up notes. The agent needs continuity across many steps, not just a bigger prompt. -->

Maya arrives at Store 118 because the frozen aisle temperature has been rising for two hours. She opens the GridWorks mobile app and says, "I am at Store 118. The north rooftop condenser fan is cycling, and the controller shows E-47." The agent checks the active dispatch ticket, pulls the equipment record, asks a safety question, retrieves the service manual, and suggests the next diagnostic step.

This workflow can last an hour. Maya may lose signal on the roof. She may switch from voice to typed input. The agent may call tools for inventory, warranty, safety, and work-order updates. The app must know which steps already happened. It must also know which facts should carry into later visits. That is where the state and memory split helps:

| Concept | Example in GridWorks Service | Lifetime |
|---|---|---|
| Turn state | Latest user message, current model output, pending tool call | One model step |
| Session state | Current job, selected equipment, open checklist, current plan | One repair session |
| Task state | Work-order status, reserved part, safety sign-off, photos attached | Until job closure |
| Durable memory | Store 118 requires manager approval for power shutdown | Reused across jobs |
| Audit history | Tool calls, model versions, state transitions, technician approvals | Retained by policy |

The model should see the right slice of these records. During a diagnostic step, it needs the equipment model, E-47 error, safety status, and current plan. It may need the durable shutdown rule before suggesting a power cycle. It probably has no need for every word from the first ten minutes of voice transcript. A state store and memory policy let the app build a compact, reviewable context for each step.

![GridWorks live state and durable memory](/content-assets/articles/article-mlops-llmops-memory-and-state/live-state-durable-memory.png)

*GridWorks separates the active repair session from selected memories that carry source, privacy, expiry, and approval metadata.*

## Short-Term State

<!-- section-summary: Short-term state keeps the current job coherent. It records the task, tool outputs, decisions, and pending actions so the agent can continue after interruptions. -->

Short-term state is the working file for the current interaction. It is more structured than chat history. Chat history says what people and the model said. State says what the application currently knows and what it has already done. In the field-service app, the state should be readable by code, not only by a model.

A basic TypeScript schema might look like this:

```typescript
type WorkOrderStatus = "opened" | "diagnosing" | "waiting_for_part" | "ready_to_close";

type SafetyGate = {
  name: "lockout_tagout" | "roof_access" | "manager_approval";
  status: "missing" | "confirmed" | "waived";
  confirmedBy?: string;
  confirmedAt?: string;
};

type ToolRecord = {
  toolName: string;
  toolCallId: string;
  status: "requested" | "succeeded" | "failed";
  summary: string;
  completedAt?: string;
};

type FieldServiceState = {
  sessionId: string;
  workOrderId: string;
  technicianId: string;
  siteId: string;
  equipmentId?: string;
  status: WorkOrderStatus;
  observedSymptoms: string[];
  suspectedCauses: string[];
  safetyGates: SafetyGate[];
  completedSteps: string[];
  pendingQuestions: string[];
  reservedParts: Array<{ sku: string; quantity: number; reservationId: string }>;
  toolHistory: ToolRecord[];
  lastUpdatedAt: string;
};
```

This state gives the app a stable handoff between steps. If Maya loses signal after the inventory tool reserves a motor, the app can resume with the reservation ID. If the model already asked for lockout confirmation, the next turn can avoid repeating the same question. If a tool failed, the state can show whether the app should retry, ask Maya for manual confirmation, or escalate to dispatch.

Short-term state also prevents a subtle class of agent bugs: duplicate actions. If the model loses track of a successful tool call, it may reserve the same part twice or update the work order twice. The application should treat important tool calls as idempotent operations keyed by work order, part SKU, and action type. The model can suggest an action, yet the application state should decide whether that action already happened.

## Durable Memory

<!-- section-summary: Durable memory stores a small number of reusable facts across sessions. Each memory needs a reason, owner, source, expiry rule, and privacy class. -->

Durable memory is for facts that help future work. It should be selective. In GridWorks Service, useful durable memories might include: Store 118 requires manager approval before shutdown, the north rooftop unit often needs a second technician for fan assembly access, or Maya is certified for CO2 refrigeration systems. These facts can save time and reduce repeated questions.

Durable memory should never be a dumping ground for transcripts. Field-service conversations can include personal phone numbers, security codes, complaints about staff, and noisy guesses. Saving all of that creates privacy risk and can confuse future repairs. The app needs a memory write policy.

Here is a practical policy format:

```yaml
memory_policy:
  allowed:
    - site_operating_constraint
    - technician_certification
    - equipment_access_note
    - customer_preference
  blocked:
    - raw_voice_transcript
    - payment_data
    - personal_contact_details
    - health_or_family_details
    - unverified_blame_or_opinion
  approval:
    site_operating_constraint: technician_confirmed
    customer_preference: manager_confirmed
    technician_certification: source_of_truth_system
  expiry_days:
    site_operating_constraint: 365
    equipment_access_note: 180
    customer_preference: 365
  visibility:
    site_operating_constraint:
      read_by: ["field_agent", "dispatcher"]
      write_by: ["technician", "dispatcher"]
```

This policy says what the app may save and what it must ignore. It also says who can approve a memory. That approval path matters. If Maya says, "The night manager hates shutdowns," the app should avoid saving that as a durable rule. If Maya confirms, "Store policy requires manager approval before shutdown, confirmed by Luis, store manager," the app can save a site operating constraint with a source and expiry.

The memory record itself should carry metadata:

```json
{
  "memory_id": "mem-site-118-shutdown-approval",
  "type": "site_operating_constraint",
  "subject_id": "site-118",
  "summary": "Manager approval is required before power shutdowns at Store 118.",
  "source": {
    "work_order_id": "WO-88172",
    "confirmed_by": "tech-447",
    "confirmed_at": "2026-07-05T22:18:00Z"
  },
  "privacy_class": "business_confidential",
  "expires_at": "2027-07-05T22:18:00Z"
}
```

Notice that the memory stores a summary, source, privacy class, and expiry time. It avoids raw transcript text. It also names the subject. A memory about Store 118 should surface when the site ID is Store 118, not when Maya works at another store.

## State Stores And Checkpoints

<!-- section-summary: State needs a durable store when a workflow can pause, fail, or resume. Checkpoints capture graph progress, while application tables keep business state and audit records. -->

A production agent needs storage. In simple apps, in-memory state may work during a single request. In field service, the app needs to survive mobile disconnects, worker restarts, tool timeouts, and human handoffs. The state store is the system of record for the live workflow.

Many teams use a combination:

- **Postgres or another relational database** for work orders, state snapshots, tool records, approvals, and audit events.
- **Redis** for short-lived locks, idempotency keys, and fast session lookup.
- **Object storage** for photos, PDFs, diagnostic logs, and generated reports.
- **Vector or keyword search** for manuals, prior repair notes, and relevant durable memories.
- **Agent framework persistence** when using a graph or workflow runtime that supports checkpoints and stores.

LangGraph's persistence docs describe two useful ideas: checkpointers for short-term memory across graph steps, and stores for long-term memory. Even if your team uses another framework, the split is practical. Checkpoints help the runtime resume a workflow. Application state tables help the business explain what happened.

Here is a relational shape for the state table:

```sql
create table field_agent_sessions (
  session_id text primary key,
  work_order_id text not null,
  technician_id text not null,
  site_id text not null,
  state_version integer not null,
  state_json jsonb not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table field_agent_events (
  event_id text primary key,
  session_id text not null references field_agent_sessions(session_id),
  event_type text not null,
  payload_json jsonb not null,
  created_at timestamptz not null
);
```

The `state_version` field supports optimistic concurrency. If the voice worker and mobile app both try to update the same session, the app can reject a stale write and retry with the latest state. The events table gives the team a replay path. If a technician reports that the agent skipped a safety question, the team can inspect state transitions rather than guessing from final chat text.

## Reading Memory Into Context

<!-- section-summary: Memory retrieval should be scoped by the current task and subject. The app should read only memories that are useful for the current step and allowed for the current user. -->

Saving memory is only half the design. The app also needs rules for reading memory back into context. A durable memory can help, distract, or violate a boundary depending on the current task.

For Maya's repair, the app can retrieve memories with a query like:

```typescript
type MemoryQuery = {
  subjectIds: string[];
  memoryTypes: string[];
  technicianId: string;
  purpose: "diagnosis" | "safety" | "work_order_update";
  limit: number;
};

const query: MemoryQuery = {
  subjectIds: ["site-118", "equipment-rtu-north-02", "tech-447"],
  memoryTypes: ["site_operating_constraint", "equipment_access_note", "technician_certification"],
  technicianId: "tech-447",
  purpose: "safety",
  limit: 5,
};
```

The subject IDs constrain the search. The memory types match the current step. The purpose gives policy code a chance to reject unrelated memories. A safety step can read site shutdown rules and technician certifications. A work-order update may need the reserved part and completed checklist. A general diagnostic answer has less need for manager contact details.

The context block that reaches the model should be short and labeled:

```yaml
memory_context:
  source: durable_memory
  policy_version: field-service-memory-v3
  memories:
    - memory_id: mem-site-118-shutdown-approval
      type: site_operating_constraint
      summary: "Manager approval is required before power shutdowns at Store 118."
      source: "WO-88172 confirmed by technician"
      expires_at: "2027-07-05T22:18:00Z"
```

The model receives the memory summary and source. It can say, "Before power cycling the unit, confirm manager approval because Store 118 has a saved shutdown rule." The app still owns the policy. If a user asks the agent to list all saved memories about a site, the app should check permissions before showing them.

## Writing Memory Safely

<!-- section-summary: Memory writes should pass through extraction, validation, approval, and expiry. The model can propose a memory, while application policy decides whether it is saved. -->

A good memory write flow has several stages:

1. Extract a candidate memory from the conversation or tool result.
2. Classify the type and privacy class.
3. Check the policy for allowed types and blocked content.
4. Ask for human confirmation when the policy requires it.
5. Save a compact summary with source and expiry.
6. Record an audit event.

![GridWorks safe memory write flow](/content-assets/articles/article-mlops-llmops-memory-and-state/safe-memory-write-flow.png)

*A memory write passes through extraction, policy review, human confirmation, compact storage, and audit logging.*

The model can help with extraction, yet the application should make the final save decision. That keeps policy enforceable and testable. Here is a small Python example:

```python
from dataclasses import dataclass

@dataclass
class MemoryCandidate:
    memory_type: str
    subject_id: str
    summary: str
    contains_personal_contact: bool
    source_work_order_id: str

ALLOWED_TYPES = {"site_operating_constraint", "equipment_access_note", "technician_certification"}

def review_memory_candidate(candidate: MemoryCandidate) -> dict:
    if candidate.memory_type not in ALLOWED_TYPES:
        return {"decision": "reject", "reason": "memory_type_not_allowed"}

    if candidate.contains_personal_contact:
        return {"decision": "reject", "reason": "contains_personal_contact"}

    if len(candidate.summary.split()) > 35:
        return {"decision": "revise", "reason": "summary_too_long"}

    return {
        "decision": "needs_confirmation",
        "approver": "technician",
        "expires_in_days": 365,
    }
```

This code makes a clear point: memory is a product feature with policy, not a side effect of chatting. It rejects disallowed types, personal contact details, and overly long summaries. In a real system, you would add PII detectors, access checks, duplicate detection, and source validation. You would also build a UI where Maya can approve or edit the proposed memory before saving it.

The same policy should support deletion and correction. If Store 118 changes its shutdown process, the new confirmed memory should supersede the old one. If a saved memory came from a misunderstanding, the UI should let authorized users remove it. Memory without correction paths slowly turns into stale context.

## Tool State, Idempotency, And Human Approval

<!-- section-summary: Agents that act through tools need state records for pending and completed actions. Idempotency keys and approval gates keep the same repair workflow from taking duplicate or unsafe actions. -->

The field-service agent can call tools with real consequences. It can reserve a part, update a work order, request a second technician, or create a customer-facing note. These actions need state outside the model. The model can suggest the action, while the app enforces safety gates.

For the fan motor reservation, the tool call might use an idempotency key:

```json
{
  "tool": "reserve_part",
  "work_order_id": "WO-88172",
  "sku": "FAN-MOTOR-460V-1420RPM",
  "quantity": 1,
  "idempotency_key": "WO-88172:reserve_part:FAN-MOTOR-460V-1420RPM"
}
```

If the network drops and the app retries, the inventory service can return the existing reservation instead of creating another one. The session state then records the reservation ID and status. The next model step sees a short summary: "Fan motor SKU FAN-MOTOR-460V-1420RPM is reserved under reservation R-44091." That is enough for the assistant to continue.

Human approval gates also live in state. The app may require manager approval before power shutdown, technician confirmation before lockout-tagout guidance, and dispatcher approval before rescheduling a customer visit. Those gates should be explicit fields, not hidden in chat text. When the model proposes "power cycle the unit," the app can check `manager_approval` and ask Maya to confirm the manager sign-off first.

![GridWorks checkpoints and idempotency](/content-assets/articles/article-mlops-llmops-memory-and-state/state-checkpoints-idempotency.png)

*Checkpoints, locks, approval gates, and idempotency keys help the field agent resume work without duplicate actions.*

## Observability For Memory And State

<!-- section-summary: State bugs can look like model bugs. Traces and audit events should show what the agent remembered, what it read, what it wrote, and which policy allowed it. -->

Memory and state need observability because failure can hide inside continuity. If the agent repeats a question, state may have failed to persist. If it suggests a shutdown without manager approval, memory retrieval may have missed the site rule. If it mentions a stale preference, expiry policy may have failed. If it saves personal contact details, write policy may be too loose.

Track these signals:

- state load and save latency
- state version conflicts and retry counts
- checkpoint IDs and resume events
- tool action idempotency hits
- memory candidates proposed, accepted, rejected, and deleted
- memory reads by type, subject, policy version, and user role
- prompt context tokens from state and memory
- user corrections tied to specific memories
- safety gate blocks and approvals

An event record can keep this easy to audit:

```json
{
  "event_type": "memory_read",
  "session_id": "sess-20260705-8841",
  "work_order_id": "WO-88172",
  "memory_ids": ["mem-site-118-shutdown-approval"],
  "policy_version": "field-service-memory-v3",
  "purpose": "safety",
  "decision": "allowed",
  "created_at": "2026-07-05T22:26:03Z"
}
```

The trace should avoid raw private content unless your access controls, retention policy, and customer terms allow it. Hashes, IDs, summaries, token counts, and policy decisions often give engineers enough evidence for debugging. For high-risk flows, store raw content in the system of record with stricter access rather than scattering it through logs.

## Practical Checks And Common Mistakes

<!-- section-summary: A good memory and state design has clear lifetimes, owners, approval rules, expiry, and audit trails. You should be able to explain why a fact was remembered and why a tool action was safe to continue. -->

Use this checklist before shipping:

- Can you point to the current state schema for one live workflow?
- Can the app resume after a worker restart, mobile disconnect, or failed tool call?
- Can you distinguish chat transcript, state snapshot, tool event, durable memory, and audit event?
- Can every durable memory show a source, owner, privacy class, and expiry?
- Can users correct or delete memories they are allowed to manage?
- Can the app prevent duplicate tool actions with idempotency keys?
- Can the model see a compact state summary instead of the full transcript?
- Can traces show which memories were read and which policy allowed them?

The common mistakes are familiar. Teams store raw transcripts as long-term memory. They rely on the model to remember tool results instead of writing state. They let memories apply across subjects too broadly. They miss expiry. They save facts without approval. They store sensitive data in ordinary logs. They treat framework checkpoints as a full business audit trail. Checkpoints help resume execution; business state and audit records still need product-specific tables.

For interview-ready understanding, say it this way: **state is the live workflow record, and memory is selected reusable knowledge with policy around it**. Short-term state helps the agent continue a job. Durable memory helps future jobs. Both need schemas, lifetimes, permissions, tests, and observability. The model can read and propose changes, while the application owns the rules that decide what persists.

## References

- [LangGraph docs: Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph reference: Checkpoints](https://reference.langchain.com/python/langgraph/checkpoints)
- [OpenAI API docs: Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI API docs: Compaction](https://developers.openai.com/api/docs/guides/compaction)
- [OpenAI API docs: Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI API docs: Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI API docs: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
