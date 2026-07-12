---
title: "Debugging Runs"
description: "Debug stuck or failed agent runs with trace replay, context inspection, tool response review, version comparison, and incident-ready checklists."
overview: "Learn a practical workflow for debugging an LLM agent run, using a procurement agent that gets stuck while checking purchase approvals."
tags: ["MLOps","LLMOps","production","observability"]
order: 2
id: "article-mlops-llmops-debugging-runs"
---

## What Debugging A Run Means

<!-- section-summary: Debugging a run means following one agent execution step by step, then proving which input, tool result, prompt version, retry, or guardrail changed the outcome. -->

Debugging an LLM agent run means reconstructing the run with enough evidence to explain what happened and what should change next. You are usually answering one of these questions: why did the agent stop, why did it loop, why did it call the wrong tool, why did it ignore a tool response, why did it escalate, why did it spend too much money, or why did two similar requests produce different outcomes.

This article uses a procurement agent as the running scenario. A company called LumaWorks uses an internal assistant to help managers buy software, office equipment, and contractor services. The agent reads a purchase request, checks budget policy, looks up vendor approval status, asks for missing information, and routes high-risk purchases to procurement operations. A manager submits: "Renew the design team's analytics add-on for 45 seats. Current vendor is DataVista. Charge it to cost center ENG-DESIGN."

The agent gets stuck. The user sees a spinning state for several minutes, then a vague message: "I need more information before I can continue." Support opens the trace. The trace shows repeated calls to `vendor_policy.lookup`, repeated prompt turns that ask for the same cost center, and one tool response that says the vendor approval expired yesterday. The key debugging question is no longer "why is the agent bad?" The question is precise: did the agent fail because the policy tool returned a new status, because the prompt missed a rule for expired vendors, because the context hid the renewal amount, or because retry logic looped on the same missing field?

That is the difference between ordinary log reading and run debugging. You are not only reading errors. You are following the causal chain: input, context, retrieval, tool results, model messages, guardrails, retries, state updates, and final outcome. The trace from the previous article gives the map. In this article, you will use that map to investigate a real failure.

## Start With The Symptom And The Trace ID

<!-- section-summary: A good run-debug workflow starts by freezing the reported symptom, finding the trace ID, and writing down what the user expected before you inspect internals. -->

The first habit is to capture the user-facing symptom before you dive into spans. In the LumaWorks case, the symptom is "the procurement agent kept asking for information that the user already gave." Write that down in plain language. Then capture the trace ID, user timestamp, environment, app version, prompt version, and the user-visible final message.

Here is a simple incident note format:

```yaml
incident_id: inc-proc-2026-07-05-014
reported_by: support-queue
trace_id: trc_proc_7d4b913f
environment: prod
workflow: procurement_request
symptom: "Agent repeatedly asked for cost center and never routed expired vendor renewal."
expected_behavior: "Agent should detect expired vendor approval and route the renewal to procurement ops."
user_input_summary: "Renew DataVista analytics add-on, 45 seats, cost center ENG-DESIGN."
first_seen_at: "2026-07-05T09:42:10Z"
severity: sev2
customer_impact: "Managers cannot complete some renewal requests without support help."
```

This note prevents a common mistake: engineers jump straight into model output and forget what the user needed. The expected behavior gives you a target. The trace ID gives you the evidence path. The environment and version fields help you compare with nearby runs.

In a trace backend, search by trace ID first. If the user or support report lacks a trace ID, search by time window, workflow, hashed user ID, request ID, or support ticket ID. Production agents should return or store a trace correlation ID with every user-facing run. That ID saves time during incidents because support can attach it to the ticket before engineering joins.

## Read The Trace As A Timeline

<!-- section-summary: The first trace pass should identify the parent run, the slow spans, the repeated spans, the failed spans, and the span where the agent state changed in the wrong direction. -->

Open the trace and read it from the parent span downward. Avoid starting with the longest model transcript. First, look for the structure:

| Question | What to inspect |
| --- | --- |
| Did the run start with the right workflow? | Parent span name, route span, intent classifier span |
| Which step took most time? | Span duration, retries, timeout events |
| Which step repeated? | Repeated child spans with the same tool name or prompt turn |
| Which step failed? | Span status, exception event, `failure.class`, tool status code |
| Which state changed? | Context update events, memory write events, planner output |
| Which version handled the run? | Prompt version, agent config version, tool schema version, retrieval index version |

For the stuck procurement run, the timeline might look like this:

```json
{
  "trace_id": "trc_proc_7d4b913f",
  "name": "procurement_agent.run",
  "duration_ms": 184230,
  "attributes": {
    "app.workflow": "procurement_request",
    "app.prompt.version": "2026-07-04.5",
    "app.agent.config_version": "proc-agent-18",
    "app.user.hash": "usr_8bd0",
    "app.request.type": "software_renewal",
    "failure.class": "agent_loop"
  },
  "children": [
    {"name": "intent.classify", "duration_ms": 91, "status": "ok"},
    {"name": "context.extract_purchase_fields", "duration_ms": 42, "status": "ok"},
    {"name": "tool.vendor_policy.lookup", "duration_ms": 340, "status": "ok"},
    {"name": "gen_ai.chat gpt-5.5", "duration_ms": 2160, "status": "ok"},
    {"name": "tool.vendor_policy.lookup", "duration_ms": 355, "status": "ok"},
    {"name": "gen_ai.chat gpt-5.5", "duration_ms": 2198, "status": "ok"},
    {"name": "guardrail.loop_detector", "duration_ms": 8, "status": "error"}
  ]
}
```

The repeated `vendor_policy.lookup` span is the first clue. The `guardrail.loop_detector` error is the stop signal. The parent failure class says `agent_loop`, which is useful, yet it is only the label. You still need to learn why the loop happened.

A timeline pass should leave you with two or three hypotheses. In this case: the extracted fields dropped the cost center, the vendor policy response used a status value the prompt did not handle, or the loop detector fired too late after repeated model turns. Each hypothesis maps to a span you can inspect.

![LumaWorks stuck procurement run](/content-assets/articles/article-mlops-llmops-debugging-runs/lumaworks-stuck-run-timeline.png)
*The first pass follows the symptom to the trace ID, then finds repeated tool spans and the first clue that changed the run.*

## Inspect Context Before Inspecting The Answer

<!-- section-summary: Context inspection tells you whether the model received the right facts, the right state, and the right tool results before you judge the final response. -->

The model can only respond to the context it receives. When a run fails, inspect the context packet before you judge the answer. For the procurement agent, the context packet should include the request type, vendor, seat count, renewal amount if known, cost center, requester role, budget owner, policy snippets, vendor approval state, and any missing fields.

A context summary event can make this review fast:

```json
{
  "name": "context.purchase_fields.extracted",
  "attributes": {
    "purchase.request_type": "software_renewal",
    "purchase.vendor_name": "DataVista",
    "purchase.seat_count": 45,
    "purchase.cost_center": "ENG-DESIGN",
    "purchase.amount_usd": null,
    "purchase.amount_source": "missing_from_request",
    "requester.role": "engineering_manager",
    "policy.required_fields": "amount_usd,budget_owner,vendor_status",
    "context.missing_fields": "amount_usd,budget_owner"
  }
}
```

This event shows the cost center was extracted correctly. The agent should have stopped asking for it. The missing fields are amount and budget owner. Now inspect the vendor policy response:

```json
{
  "name": "tool.vendor_policy.lookup",
  "attributes": {
    "tool.name": "vendor_policy_lookup",
    "tool.schema.version": "3.2.0",
    "vendor.name.normalized": "datavista",
    "vendor.approval_status": "expired_pending_reapproval",
    "vendor.approval_expires_at": "2026-07-04",
    "tool.response.status_code": 200,
    "tool.response.summary": "vendor approval expired, procurement ops review required",
    "failure.class": "none"
  }
}
```

The tool response is clear to a human. The agent still asked for the cost center. That points toward prompt logic or state update logic. The model may have ignored the tool response because the prompt only listed `approved`, `blocked`, and `unknown` as vendor states. Or the orchestration layer may have stored the tool result under a key the next model call never received.

This is why debugging agents requires context inspection. The final answer is the last symptom. The context packet and tool response show the materials that shaped that symptom.

![LumaWorks compare context, tool, and state](/content-assets/articles/article-mlops-llmops-debugging-runs/lumaworks-context-tool-state.png)
*LumaWorks compares the context packet, tool response, and stored state before blaming the model answer.*

## Compare Prompt, Tool, And State Versions

<!-- section-summary: Version comparison helps you separate a model behavior issue from a deploy issue, a tool contract change, or a missing state update. -->

A production trace should record prompt version, agent config version, tool schema version, retrieval index version, and service version. When a run fails after a release, version fields help you find the changed surface quickly.

For the procurement failure, compare a successful renewal from the previous day:

| Field | Successful run | Stuck run |
| --- | --- | --- |
| Prompt version | `2026-07-02.1` | `2026-07-04.5` |
| Agent config | `proc-agent-17` | `proc-agent-18` |
| Vendor tool schema | `3.1.0` | `3.2.0` |
| Vendor status | `approved` | `expired_pending_reapproval` |
| Loop detector threshold | `4 repeated asks` | `6 repeated asks` |
| Final outcome | `submitted_to_budget_owner` | `agent_loop` |

This comparison suggests two likely changes: the vendor tool introduced a new status value, and the prompt or state policy did not route that value. The loop detector threshold also allowed too many repeated turns. The fix may need one prompt change, one contract test, and one guardrail threshold update.

You can store a compact version snapshot on the parent span:

```json
{
  "app.release.sha": "f6a41c2",
  "app.prompt.name": "procurement_triage",
  "app.prompt.version": "2026-07-04.5",
  "app.agent.config_version": "proc-agent-18",
  "retrieval.index.version": "proc-policy-2026-07-01",
  "tool.vendor_policy.schema_version": "3.2.0",
  "tool.purchase_request.schema_version": "2.8.4"
}
```

This metadata costs very little and pays off during incidents. You can filter all failed runs from one prompt version. You can compare tool schema changes against failure classes. You can find whether the issue only affects one retrieval index or one region.

## Replay The Run With Controls

<!-- section-summary: Replay lets you rerun the same case against controlled prompt, context, tool, and model settings so you can confirm the cause before shipping a fix. -->

Replay means running the same or equivalent input through a controlled environment. The replay goal is proof. You want to know whether a change fixes the stuck behavior, and you want to keep the evidence for regression testing.

Create a replay packet from the trace. It should include the user input summary, sanitized context, tool responses, prompt version, agent config version, model settings, and expected outcome. Avoid raw customer data in the packet unless your eval storage has the right privacy controls.

```yaml
case_id: proc-renewal-expired-vendor-001
source_trace_id: trc_proc_7d4b913f
workflow: procurement_request
input:
  user_message: "Renew the design team's analytics add-on for 45 seats. Current vendor is DataVista. Charge it to cost center ENG-DESIGN."
context:
  requester_role: engineering_manager
  cost_center: ENG-DESIGN
  seat_count: 45
  amount_usd: null
tool_fixtures:
  vendor_policy_lookup:
    approval_status: expired_pending_reapproval
    response_summary: "vendor approval expired, procurement ops review required"
expected:
  outcome: route_to_procurement_ops
  required_message_contains:
    - "vendor approval needs review"
    - "procurement operations"
```

Then write a small replay harness. This example shows the shape rather than a full framework:

```python
import json
from pathlib import Path


async def replay_case(agent_runner, case_path: str, prompt_version: str):
    case = json.loads(Path(case_path).read_text())

    tool_fixtures = case["tool_fixtures"]
    runner = agent_runner.with_fixtures(tool_fixtures)

    result = await runner.run(
        input=case["input"]["user_message"],
        context=case["context"],
        prompt_version=prompt_version,
    )

    expected = case["expected"]
    assert result.outcome == expected["outcome"]
    for phrase in expected["required_message_contains"]:
        assert phrase.lower() in result.final_output.lower()

    return {
        "case_id": case["case_id"],
        "prompt_version": prompt_version,
        "outcome": result.outcome,
        "trace_id": result.trace_id,
    }
```

Replay is strongest when you control tool responses. If the replay calls live vendor systems, a changed vendor record can hide the original cause. Use fixtures for the failing tool output first. Then run a separate integration test against the real tool to verify the live contract.

![LumaWorks replay turns a bug into a test](/content-assets/articles/article-mlops-llmops-debugging-runs/lumaworks-replay-to-test.png)
*A replay packet freezes the evidence, uses tool fixtures, and turns the prompt fix into a CI regression case.*

Run the case against the failing prompt and the proposed prompt:

```bash
python -m procurement_agent.replay \
  --case cases/proc-renewal-expired-vendor-001.json \
  --prompt-version 2026-07-04.5

python -m procurement_agent.replay \
  --case cases/proc-renewal-expired-vendor-001.json \
  --prompt-version 2026-07-05.1
```

The first command should reproduce the failure. The second command should pass. If both pass, your fixture did not capture the original problem. If both fail, the issue may live in orchestration code, state updates, or tool schema handling instead of prompt text.

## Use Logs And Metrics With The Trace

<!-- section-summary: Trace spans show the run path, while correlated logs and metrics show repeated patterns, payload validation failures, latency spikes, and deployment-wide impact. -->

OpenTelemetry logs can carry trace and span IDs, which lets you jump from a trace span to the log lines emitted during that span. For stuck agents, correlated logs often explain state transitions better than the model transcript. You might see a validation warning like `unknown vendor status`, a loop detector event, or a state write that overwrote a field.

Example structured log:

```json
{
  "timestamp": "2026-07-05T09:42:34.220Z",
  "level": "warning",
  "service.name": "procurement-agent-api",
  "trace_id": "trc_proc_7d4b913f",
  "span_id": "spn_vendor_policy_02",
  "event.name": "tool_contract.unmapped_enum",
  "tool.name": "vendor_policy_lookup",
  "field": "approval_status",
  "value": "expired_pending_reapproval",
  "known_values": ["approved", "blocked", "unknown"],
  "failure.class": "tool_contract_error"
}
```

This log would confirm a contract mismatch. Now dashboard the impact:

```promql
sum by (field, value) (
  rate(agent_tool_contract_errors_total{workflow="procurement_request"}[15m])
)
```

```promql
sum by (failure_class, app_prompt_version) (
  rate(agent_run_failures_total{workflow="procurement_request"}[15m])
)
```

```promql
histogram_quantile(
  0.95,
  sum by (le, app_prompt_version) (
    rate(agent_run_duration_seconds_bucket{workflow="procurement_request"}[10m])
  )
)
```

Metrics help you decide severity. If only one trace failed, you can treat it as a product bug. If failures spike for every renewal with a vendor status of `expired_pending_reapproval`, you have an incident. Grafana can show the spike by prompt version, release SHA, tool schema version, and failure class if your traces and metrics share those labels.

## The Run-Debug Checklist

<!-- section-summary: A checklist keeps the investigation grounded, repeatable, and easy to hand off between support, engineering, product, and operations. -->

Use this checklist when a production agent run fails, loops, or gives a suspicious answer:

```yaml
run_debug_checklist:
  identify:
    - Capture trace_id, user timestamp, environment, release SHA, prompt version.
    - Write the user-visible symptom and expected behavior in one sentence.
    - Confirm the run came from the expected workflow and agent.
  timeline:
    - Find failed, slow, and repeated spans.
    - Check model call count, tool call count, retries, and guardrail events.
    - Mark the first span where state moved away from expected behavior.
  context:
    - Inspect extracted fields, retrieval results, memory reads, and tool outputs.
    - Verify the model received the facts that the user already supplied.
    - Check whether raw sensitive data was redacted before export.
  versions:
    - Compare prompt, agent config, tool schema, retrieval index, and release SHA.
    - Compare against a similar successful trace from the same day.
    - Check whether a new enum, status code, or tool response shape appeared.
  replay:
    - Build a sanitized replay case from the trace.
    - Reproduce the failure against the old version.
    - Verify the proposed fix against the same replay packet.
  follow_up:
    - Add or update contract tests for the tool response.
    - Add the replay case to evals.
    - Add a dashboard or alert if the failure class can repeat.
```

This checklist also defines the handoff between teams. Support owns the symptom and trace ID. Engineering owns the timeline, context, versions, and replay. Product or operations owns the expected behavior when policy is ambiguous. Security or privacy reviews the data captured in traces and replay packets.

## Turn Findings Into Fixes

<!-- section-summary: A good debugging session ends with a narrow fix, a replay case, a metric or alert, and a written explanation that future responders can use. -->

For the stuck procurement agent, the likely fix set is small:

- Add `expired_pending_reapproval` to the vendor status contract and route it to procurement operations.
- Update the prompt instructions for expired vendor approvals.
- Lower the repeated-question guardrail threshold for already-extracted fields.
- Add a replay case for expired vendor renewal.
- Add a metric panel for unmapped tool enum values by tool schema version.

The fix should include a rollout plan. First run replay cases locally and in CI. Then deploy to staging and compare traces for the failing case. Then release to a small production cohort if your platform supports it. Watch `agent_loop`, `tool_contract_error`, run duration, and support tickets for procurement renewals.

The incident write-up should include concrete evidence:

```yaml
root_cause: "Vendor policy tool introduced approval_status=expired_pending_reapproval. Agent prompt and contract mapping treated the value as unknown, then asked for fields already present in context."
fixed_by:
  - "Mapped expired_pending_reapproval to route_to_procurement_ops."
  - "Added prompt rule for expired vendor renewals."
  - "Added replay case proc-renewal-expired-vendor-001."
verified_with:
  - "Old prompt reproduced agent_loop."
  - "New prompt routed to procurement ops in replay."
  - "Production failure_class=agent_loop returned to baseline after release."
follow_up:
  - "Alert on unmapped enum values from procurement tools."
  - "Review loop detector threshold for other procurement workflows."
```

This write-up is short enough for an incident review and specific enough for future debugging. It names the tool, status value, prompt behavior, replay case, and monitoring check.

## Practical Checks And Interview-Ready Understanding

Debugging a run is evidence work. You start with the trace ID and user symptom, read the trace timeline, inspect context and tool outputs, compare versions, replay the failing case, and turn the finding into a fix plus an eval case. A strong interview answer should mention traces, spans, correlated logs, tool contracts, prompt versions, replay fixtures, failure classes, privacy-safe payloads, and dashboards.

Watch for these mistakes:

- Debugging only the final answer while skipping context, retrieved documents, and tool outputs.
- Treating a model issue as the first explanation before checking tool contracts and state updates.
- Replaying against live tools and losing the original failing condition.
- Keeping replay cases in a private notebook instead of adding them to shared evals.
- Logging raw purchase details or employee names into a broad observability system.
- Shipping a prompt fix without a dashboard check for repeated failures.

The practical goal is simple: every serious failure should leave the system easier to debug next time. Add the missing label, contract test, replay case, redaction test, or dashboard panel while the incident is still fresh. That habit turns one stuck procurement run into a stronger production agent.

## References

- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK integrations and observability](https://developers.openai.com/api/docs/guides/agents)
- [OpenTelemetry traces concepts](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenTelemetry logs specification](https://opentelemetry.io/docs/specs/otel/logs/)
- [OpenTelemetry GenAI agent and framework spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)
- [OpenTelemetry Python manual instrumentation](https://opentelemetry.io/docs/languages/python/instrumentation/)
- [LangSmith OpenAI Agents SDK tracing](https://docs.langchain.com/langsmith/trace-with-openai-agents-sdk)
- [Phoenix tracing overview](https://arize.com/docs/phoenix/tracing/llm-traces)
- [Langfuse observability overview](https://langfuse.com/docs/observability/overview)
- [Prometheus query functions](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- [Grafana Prometheus query editor](https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/)
