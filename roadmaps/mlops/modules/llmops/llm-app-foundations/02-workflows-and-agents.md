---
title: "Workflows and Agents"
description: "Learn how deterministic workflows, agent loops, human approvals, tool calls, state, evals, and traces fit together in production LLM applications."
overview: "A practical guide to designing workflow and agent systems, using an insurance claim assistant that mixes fixed business steps with controlled model decisions."
tags: ["MLOps","LLMOps","production","llms"]
order: 2
id: "article-mlops-llmops-workflows-and-agents"
---
## The Difference In Plain English

<!-- section-summary: A workflow follows a known path, while an agent decides parts of the path at runtime. Production systems often use both, because fixed business steps need predictability and language-heavy steps need flexibility. -->

A **workflow** is a sequence of steps your application controls. It can branch, wait, retry, and call services, yet the allowed path is designed ahead of time. An **agent** is a model-driven loop where the model can decide what to inspect, which tool to request, what to ask next, or which specialist should handle the next part of the task. In production, the strongest systems usually mix the two.

We will use **Harbor Mutual**, a fictional home-insurance company, as the running example. A customer submits a storm damage claim: "A branch fell through my kitchen skylight during the July storm. Water came in overnight. I uploaded photos and a contractor estimate." Harbor Mutual wants an LLM-powered claim assistant that helps adjusters triage claims, request missing documents, summarize evidence, and draft next steps.

The fixed business process still matters. Harbor Mutual must verify the policy, check coverage dates, classify the claim type, collect required evidence, flag fraud indicators, route high-value claims to licensed adjusters, and keep an audit trail. Those steps should be a workflow because the company needs consistency and compliance evidence.

The language-heavy work is where an agent helps. Customers write messy descriptions. Photos and contractor notes use different wording. Policy language is hard to search. The assistant may need to decide whether to look up policy endorsements, request roof photos, ask for a mitigation receipt, or summarize the case for an adjuster. Those choices can sit inside a controlled agent loop.

The beginner-friendly rule is this: **use workflows for the rails and agents for the judgment inside the rails**. The workflow owns durable state, approvals, deadlines, retries, and final side effects. The agent owns interpretation, drafting, tool selection, and handoff recommendations inside the boundaries you give it.

![Harbor Mutual workflow and agent boundary](/content-assets/articles/article-mlops-llmops-workflows-and-agents/harbor-workflow-agent-boundary.png)

*Harbor Mutual keeps claim states on rails while the agent handles the messy evidence-review step.*

## Start With The Claim Workflow

<!-- section-summary: Before adding an agent, name the business process and the evidence each step needs. This keeps the model from turning a regulated claim flow into an open-ended conversation. -->

Harbor Mutual should design the claim process before choosing a model or agent framework. A workflow diagram can be simple, but it needs to name the real business steps. The workflow needs a claim id, policy id, customer id, peril type, loss date, evidence list, review status, and owner. That data lives in Harbor Mutual's systems, not inside the model.

| Workflow step | Purpose | Typical owner | LLM role |
| --- | --- | --- | --- |
| Intake | Capture the customer statement and uploaded files | Claims portal | Extract summary and missing fields |
| Policy check | Confirm active policy and coverage | Policy service | Explain relevant policy clauses |
| Evidence review | Check photos, estimates, receipts, and dates | Claim assistant plus adjuster | Identify missing evidence |
| Triage | Route by severity, value, and risk | Workflow engine | Recommend queue and reason |
| Human review | Licensed adjuster approves sensitive decisions | Adjuster | Draft review packet |
| Customer update | Send next-step message | Adjuster or support team | Draft message after approval |
| Audit closeout | Store decisions and trace links | Claims platform | Summarize outcome and cited evidence |

This table tells you where determinism belongs. Policy status comes from a policy service. Claim ownership comes from the claims platform. Escalation thresholds come from business rules. The model can read and explain these facts, yet it should never invent them.

A workflow configuration might look like this:

```yaml
workflow: storm_damage_claim
version: 2026-07-claims-v2
states:
  - intake_received
  - policy_verified
  - evidence_reviewed
  - adjuster_review_required
  - customer_update_drafted
  - closed
rules:
  human_review_required:
    estimated_loss_usd_gte: 5000
    water_damage: true
    coverage_exception: true
tools:
  read_policy:
    mode: read_only
  request_missing_documents:
    mode: side_effect_after_approval
  draft_customer_update:
    mode: draft_only
```

Notice the shape of the config. The workflow has states. Business rules say when human review is required. Tool modes separate read-only work from side-effecting work. This is the part many beginners skip because the model demo can answer a claim question without it. In real claim handling, the workflow creates the safety net.

## Put The Agent Inside A Controlled Step

<!-- section-summary: An agent loop is useful when the next useful action depends on the case content. The workflow should call the agent for a bounded task, then inspect the result before the process moves forward. -->

The first agent Harbor Mutual should build is a **claim evidence reviewer**. Its task is narrow: read the claim statement, policy snippets, uploaded-file metadata, and existing claim fields; then return a structured review packet. The agent can call read-only tools such as `lookup_policy`, `list_uploaded_files`, and `search_claim_guidelines`. It can request a document action, yet the workflow decides whether the request is sent.

Here is a simplified Python sketch using an Agents SDK style. The exact production code would include auth, secrets, timeouts, and tool implementations, while the shape shows the important contract.

```python
from pydantic import BaseModel, Field
from agents import Agent, Runner, function_tool, trace

class EvidenceGap(BaseModel):
    field: str
    reason: str
    customer_request: str

class ClaimReview(BaseModel):
    claim_type: str
    severity: str
    coverage_questions: list[str]
    evidence_gaps: list[EvidenceGap]
    recommended_queue: str
    human_review_required: bool
    rationale: str

@function_tool
def lookup_policy(policy_id: str, loss_date: str) -> dict:
    return policy_service.read_support_view(policy_id, loss_date)

@function_tool
def search_claim_guidelines(query: str) -> list[dict]:
    return guideline_index.search(query, limit=5)

claim_agent = Agent(
    name="Storm damage claim evidence reviewer",
    model="gpt-5.5",
    instructions="""
Review one property claim for an adjuster.
Use tools for policy and guideline facts.
Return a review packet with evidence gaps and queue recommendation.
Flag human review for high-value, water-damage, coverage-exception, or unclear-liability cases.
""",
    tools=[lookup_policy, search_claim_guidelines],
    output_type=ClaimReview,
)

with trace(
    workflow_name="storm_damage_claim_review",
    group_id="claim_CLM-20491",
    metadata={
        "workflow_version": "2026-07-claims-v2",
        "prompt_version": "claim-reviewer-2026-07-03",
        "claim_id": "CLM-20491",
    },
):
    result = await Runner.run(
        claim_agent,
        input="""
Claim CLM-20491: branch fell through kitchen skylight during July storm.
Customer reports overnight water intrusion and uploaded 8 photos plus one contractor estimate.
Policy HMO-44821, loss date 2026-07-02, estimated loss 8200 USD.
""",
    )

review = result.final_output
```

The agent's output is a typed review packet. The workflow can store it, show it to an adjuster, run policy checks, and decide the next state. If `human_review_required` is true, the workflow routes the case to an adjuster queue. If evidence gaps exist, the workflow prepares a document request and asks an adjuster to approve it before contacting the customer.

This keeps the agent from owning the entire claim lifecycle. The agent completes one bounded task. The workflow reads the packet and moves the claim through approved states.

## Tool Calls Need Contracts, Permissions, And Approval

<!-- section-summary: Tool calls are where agents touch real systems, so they need strict schemas and policy gates. Read tools can run automatically more often, while write tools usually need approval, idempotency, and an audit record. -->

Tool design decides whether the agent is safe to use in a real insurance operation. Harbor Mutual has tools for policy lookup, guideline search, file listing, document requests, adjuster assignment, reserve updates, and customer messages. These tools have very different risk levels.

Read-only tools can often run automatically after auth checks. A policy lookup tool should return only the policy fields needed for the claim review. A guideline search tool should return source ids and snippets. A file listing tool can return file names, categories, upload dates, and virus-scan status, while withholding raw private content unless the step requires it.

Write tools need approval. A tool that requests documents sends a message to the customer. A tool that assigns an adjuster changes workload. A tool that updates a reserve affects financial reporting. The agent can propose those actions, and the workflow should pause for a human or policy service.

```json
{
  "type": "function",
  "name": "request_missing_documents",
  "description": "Prepare a customer document request for adjuster approval.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "claim_id": { "type": "string" },
      "requested_documents": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "document_type": {
              "type": "string",
              "enum": ["roof_photo", "interior_water_photo", "mitigation_receipt", "contractor_estimate"]
            },
            "reason": { "type": "string" }
          },
          "required": ["document_type", "reason"],
          "additionalProperties": false
        }
      },
      "customer_message_draft": { "type": "string" }
    },
    "required": ["claim_id", "requested_documents", "customer_message_draft"],
    "additionalProperties": false
  }
}
```

The schema is narrow on purpose. It avoids a generic `send_message` tool that can say anything to anyone. It asks for document types from a known enum. It returns a draft rather than sending the message directly. The workflow can display the proposed request to an adjuster with the evidence gaps and policy citations.

Human approval can happen through an Agents SDK approval mechanism, LangGraph human-in-the-loop middleware, your workflow engine, or a custom claims UI. The implementation can vary. The control should be explicit: the run pauses, the human sees the proposed action and evidence, the decision is recorded, and the workflow resumes with approve, edit, or reject.

![Harbor Mutual approval state checkpoint](/content-assets/articles/article-mlops-llmops-workflows-and-agents/harbor-approval-state-checkpoint.png)

*A durable pause gives adjusters a clear approve or reject point before the workflow runs the side effect once.*

## State And Durability Matter More Than The Loop

<!-- section-summary: Long-running agent work needs durable state because claims can pause for hours or days. Store workflow state in your business system and pass only the useful slice into the model. -->

Insurance claims rarely finish in one chat turn. A customer may upload photos tomorrow. A contractor estimate may arrive next week. An adjuster may reject a document request and ask for a different one. That is why the workflow state matters more than the agent loop itself.

The claim system should store durable state after every important step. If the worker crashes after the agent identifies missing documents, the workflow should resume from `evidence_reviewed` instead of repeating the whole claim intake. If the adjuster edits the document request, the workflow should store the edited version and the reason. If the customer replies, the next model request should include the latest approved case summary instead of the entire raw history.

A compact state record might look like this:

```json
{
  "claim_id": "CLM-20491",
  "workflow_version": "2026-07-claims-v2",
  "state": "adjuster_review_required",
  "policy_id": "HMO-44821",
  "loss_date": "2026-07-02",
  "estimated_loss_usd": 8200,
  "case_summary": "Storm branch broke skylight, water entered overnight, photos and contractor estimate uploaded.",
  "agent_review": {
    "prompt_version": "claim-reviewer-2026-07-03",
    "trace_id": "trace_claim_20491_01",
    "recommended_queue": "property_water_damage_senior",
    "human_review_required": true
  },
  "pending_actions": [
    {
      "type": "request_missing_documents",
      "status": "waiting_for_adjuster",
      "idempotency_key": "CLM-20491-docreq-001"
    }
  ]
}
```

Frameworks such as LangGraph focus on long-running, stateful agent orchestration with persistence, human-in-the-loop, streaming, and debugging support. The important architectural idea is portable: save state at step boundaries, treat human review as a real state transition, and make every side effect idempotent. If the same document request runs twice because of a retry, the customer receives duplicate messages and the audit trail gets messy. Idempotency keys prevent that class of failure.

Memory also needs boundaries. The agent can use the current claim summary, previous approved actions, and relevant policy snippets. It should avoid pulling unrelated prior claims or broad customer history unless the adjuster has permission and the step needs it. Claims data is sensitive, so the workflow should pass the minimum necessary context.

## How To Choose Workflow, Agent, Or Hybrid

<!-- section-summary: The choice comes from task shape and risk, rather than excitement around agents. Use fixed workflows for known paths, agents for messy interpretation, and hybrids when both needs appear in one product. -->

Use a **deterministic workflow** when the task path is known and correctness depends on following policy. Claim state transitions, deadline reminders, payment approvals, fraud-review routing, and audit closeout fit this shape. You can still use small model calls inside a deterministic workflow for classification or summarization.

Use an **agent loop** when the task requires flexible investigation. The model may need to inspect a policy, search guidelines, compare customer text with uploaded-file metadata, ask a clarifying question, and then decide whether to recommend a queue. The exact next action depends on what the model finds. Even then, the loop should have a maximum step count, tool allowlist, budget, and stop condition.

Use a **hybrid** for most serious enterprise work. Harbor Mutual's claim assistant uses a fixed workflow for regulated process and an agent for evidence review. The workflow calls the agent at clear points. The agent returns typed output. The workflow validates that output and moves the claim forward only through allowed states.

Here is a simple decision table:

| Situation | Best starting shape | Why |
| --- | --- | --- |
| "Send every storm claim through intake, policy check, triage, and adjuster review" | Workflow | The path is known and auditability matters |
| "Read messy customer text and identify missing evidence" | Agent inside a step | The next useful inspection depends on the case details |
| "Issue payments under policy limits" | Workflow with human approval | Money movement needs deterministic controls |
| "Draft an adjuster summary with policy citations" | Agent with retrieval and structured output | Language work needs context and source references |
| "Handle claims for days while waiting on documents" | Durable workflow plus agent steps | State needs to survive pauses and restarts |

This decision pattern also helps with scoping. Build the workflow first, then add the agent to one step where it has clear value. When that step has evals and traces, add another. This keeps the system understandable while the team learns where the model helps.

## Evals And Traces For Agentic Work

<!-- section-summary: Agentic systems need evals that inspect process, not only final text. You should score tool choices, state transitions, approval decisions, citations, latency, and cost. -->

Agentic work creates more ways to fail than a single model answer. The final customer message may sound fine, while the agent used the wrong policy, skipped a required document, or requested a side-effecting tool too early. Harbor Mutual needs evals that inspect the whole run.

A useful eval case includes input, tools allowed, expected tool calls, required citations, approval expectations, and final packet checks.

```yaml
suite: harbor_mutual_claim_agent
version: 2026-07-claims-v2
cases:
  - id: skylight_water_damage_high_value
    input:
      claim_text: "A branch broke the kitchen skylight and water came in overnight."
      estimate_usd: 8200
      uploaded_files:
        - exterior_roof_photo.jpg
        - kitchen_ceiling_photo.jpg
        - contractor_estimate.pdf
    expected:
      required_tools:
        - lookup_policy
        - search_claim_guidelines
      forbidden_tools:
        - update_reserve
        - send_customer_message
      required_queue: property_water_damage_senior
      human_review_required: true
      required_evidence_questions:
        - mitigation_receipt
```

The trace should then prove how the result happened. It should show which policy snippets were retrieved, which tools were called, how long each step took, whether a guardrail fired, which approval paused the run, and which model version produced the structured packet. Without a trace, debugging turns into guesswork.

Cost and latency evals matter too. A claim review that takes 40 seconds may frustrate adjusters. An agent that calls guideline search ten times per case may burn budget. Add route-level limits such as `max_agent_steps`, `max_tool_calls`, `timeout_ms`, and `budget_usd`. If the agent hits a limit, route the claim to a human with a clear reason.

```yaml
runtime_limits:
  claim_evidence_reviewer:
    max_agent_steps: 5
    max_tool_calls: 6
    timeout_ms: 12000
    max_input_tokens: 20000
    max_output_tokens: 900
    budget_usd: 0.18
    on_limit: route_to_adjuster
```

OpenAI's docs currently show an Evals platform transition timeline, so a production team should check the latest hosted-evaluation surface before committing to it. The engineering idea remains stable: keep repeatable datasets, compare changes before release, run continuous checks on important changes, and use trace samples for deeper grading.

![Harbor Mutual agent eval and trace scorecard](/content-assets/articles/article-mlops-llmops-workflows-and-agents/harbor-agent-eval-trace.png)

*Agent evals inspect tool choices, queues, approvals, citations, latency, and cost across the full run.*

## Deployment Checks, Common Mistakes, And Interview-Ready Understanding

Before Harbor Mutual ships the claim assistant, it should run a deployment review. The review should include claims operations, legal, security, engineering, and support leaders. The team should walk through one happy-path claim, one high-value claim, one missing-evidence claim, one prompt-injection attempt, one tool outage, and one rollback.

The checklist should cover these points:

- Workflow states and allowed transitions are documented in config or code.
- Agent tasks are bounded by step count, timeout, tool allowlist, and budget.
- Tool schemas are strict, narrow, and tested with invalid arguments.
- Human approval gates exist for customer messages, payments, reserves, and coverage exceptions.
- State is durable and resumes cleanly after worker restarts.
- Evals inspect tool calls, citations, approval decisions, structured output, cost, and latency.
- Traces link claim id, workflow version, prompt version, model, tools, retrieved sources, and approval decisions.
- Rollback can disable the agent step while leaving the deterministic claim workflow running.

Common mistakes are easy to spot after you know the pattern. Teams build a free-form agent before mapping the business workflow. They give the agent broad write tools. They store all conversation history as memory and pass too much sensitive data into every call. They grade only the final answer and skip process checks. They forget that a human approval pause needs durable state. Each mistake points to the same fix: move authority into the workflow and give the agent a smaller, typed job.

In an interview, explain the difference this way: "A workflow is the controlled path through the business process. An agent is a model loop that can choose tools or next steps inside a bounded task. In production I would usually build a hybrid: deterministic workflow for state, approvals, retries, and audit; agent step for messy language work; strict tools for system access; evals and traces for every change." That answer shows practical LLMOps judgment.

## References

- [OpenAI: Agents SDK overview](https://developers.openai.com/api/docs/guides/agents)
- [OpenAI Agents SDK Python docs](https://openai.github.io/openai-agents-python/)
- [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI: Guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
- [OpenAI: Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI: Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [LangChain human-in-the-loop middleware](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)
- [Langfuse prompt management](https://langfuse.com/docs/prompt-management/overview)
