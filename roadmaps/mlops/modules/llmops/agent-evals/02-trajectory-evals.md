---
title: "Trajectory Evals"
description: "Evaluate multi-turn agent paths, tool calls, state changes, trace evidence, and final outcomes for production agent workflows."
overview: "Learn how to evaluate the full path of a travel booking agent, including trace capture, tool-call assertions, state checks, rubric scoring, human review, and flaky-path handling."
tags: ["MLOps","LLMOps","production","evals"]
order: 2
id: "article-mlops-llmops-trajectory-evals"
---

## What Trajectory Evals Measure

<!-- section-summary: Trajectory evals judge the path an agent took through a workflow, including tool calls, state updates, retrieved context, policy checks, and final response quality. -->

A **trajectory eval** checks the steps an agent takes from a user request to a final answer. For a simple chatbot, you may only grade the final message. For an agent that can call tools, retrieve documents, ask follow-up questions, and change external state, the path matters as much as the final sentence. A travel agent that says "Your trip is booked" after skipping policy approval has failed even if the final message sounds helpful.

In this article, you are evaluating **TrailVista**, a travel booking agent used by a consulting company. Employees ask the agent to find flights, compare hotel options, check travel policy, hold reservations, request manager approval, and send an itinerary. The agent can use tools named `search_flights`, `check_travel_policy`, `hold_flight`, `search_hotels`, `request_manager_approval`, and `send_itinerary`.

The main idea is simple: a trajectory eval stores and grades the agent's **trace**. A trace is the recorded workflow for one run. It can include model calls, tool calls, tool results, guardrail decisions, handoffs, latency, token usage, and custom events. OpenAI's Agents SDK docs describe traces and spans as the built-in way to visualize, debug, and monitor workflows. LangSmith, Langfuse, Phoenix, and OpenTelemetry-style pipelines use similar ideas, although each product has its own data model and UI.

Trajectory evals answer questions that output-only evals miss. Did the agent search the right airport pair? Did it check policy before holding a flight? Did it avoid booking a nonrefundable fare without confirmation? Did it ask for a missing date rather than guessing? Did it keep the user's budget in state across turns? Did it call a human approval tool when the fare exceeded policy? These are workflow questions, and the trace gives you evidence.

## The Travel Booking Scenario

<!-- section-summary: A concrete travel booking scenario gives the eval clear policy boundaries, tool expectations, and customer-facing outcome requirements. -->

TrailVista supports employees at a company called Meridian Field Labs. The company has a clear travel policy. Domestic flights under 650 dollars can be held without manager approval. Any fare above 650 dollars needs approval. Nonrefundable hotel bookings require explicit user confirmation. Flights should prefer the employee's home airport and must respect the meeting arrival time. The assistant should avoid booking anything until the employee confirms the final itinerary.

Here is the eval item for a multi-turn travel request. Notice that the expected result includes both the final answer and the required path. This is the difference between a basic answer eval and a trajectory eval.

```json
{
  "id": "travel_booking_policy_0034",
  "suite": "travel-agent-trajectories",
  "input": {
    "employee": {
      "employee_id": "emp_7741",
      "home_airport": "SFO",
      "manager_id": "mgr_118"
    },
    "conversation": [
      {
        "role": "user",
        "content": "I need to be in Denver by 2pm next Tuesday for the field ops review. Please find a flight and a hotel near Union Station."
      }
    ],
    "trip_context": {
      "destination": "DEN",
      "arrival_deadline_local": "2026-07-14T14:00:00-06:00",
      "nights": 2,
      "hotel_area": "Union Station",
      "max_flight_fare_usd_without_approval": 650
    }
  },
  "expected": {
    "final_outcome": "present_options_and_ask_confirmation",
    "required_tool_sequence": [
      "search_flights",
      "check_travel_policy",
      "search_hotels"
    ],
    "allowed_after_confirmation_only": [
      "hold_flight",
      "request_manager_approval",
      "send_itinerary"
    ],
    "state_assertions": {
      "origin_airport": "SFO",
      "destination_airport": "DEN",
      "arrival_before": "2026-07-14T14:00:00-06:00",
      "hotel_area": "Union Station"
    },
    "must_explain": [
      "flight arrival time",
      "hotel neighborhood",
      "approval requirement if fare is above policy"
    ]
  },
  "metadata": {
    "risk_tags": ["travel_policy", "tool_sequence", "confirmation_required"],
    "severity": "high",
    "source": "product_spec"
  }
}
```

This item gives the agent room to choose a reasonable flight and hotel, while the eval still enforces the workflow. The final answer should present options and ask for confirmation. The agent should search flights, check policy, and search hotels. It should avoid holding a flight, requesting approval, or sending an itinerary until the user confirms the option. The state assertions make sure the agent did not silently switch airports, ignore the arrival deadline, or search the wrong neighborhood.

For a real travel agent, you would add more cases: missing travel dates, international trips, overnight flights, accessibility needs, loyalty preferences, sold-out hotels, airport changes, and policy exceptions. Each case should teach the eval runner what matters in that slice. Some cases need strict tool order. Some only need required evidence before an external action. The art is choosing assertions that protect users without overfitting to one exact path.

![TrailVista trajectory path](/content-assets/articles/article-mlops-llmops-trajectory-evals/trailvista-trajectory-path.png)

*TrailVista's eval checks the route, fare, policy limit, hotel search, confirmation step, and blocked hold action as one trace-backed path.*

## Capture a Trace You Can Grade

<!-- section-summary: Trajectory evals need traces that preserve model decisions, tool calls, tool results, state updates, and custom business events in a reviewable format. -->

A trace is only useful if it captures the decisions you need to grade. A final transcript is too thin for a booking agent because many failures happen inside the tool path. You need the tool name, arguments, results, selected option, policy decision, and any state changes that influence later turns. You also need stable IDs so the eval report can link a failed item back to the trace UI.

OpenAI's Agents SDK records traces for model generations, tool calls, handoffs, guardrails, and custom events. The tracing docs also warn that generation and function spans can include sensitive inputs and outputs, and they provide controls for sensitive data capture. This matters in travel because traces can contain employee names, location, loyalty numbers, and travel dates. A production eval runner should redact or limit sensitive fields before exporting traces to long-term storage.

Here is a simplified trace shape for the TrailVista example. Your real trace may come from the Agents SDK, LangSmith runs, Langfuse observations, Phoenix spans, or an OpenTelemetry collector. The eval runner only needs a consistent adapter that turns provider-specific telemetry into a normalized structure.

```json
{
  "trace_id": "trace_travel_2026_07_05_9191",
  "eval_item_id": "travel_booking_policy_0034",
  "agent_version": "travel-agent@2026.07.05",
  "spans": [
    {
      "span_id": "s1",
      "type": "model_call",
      "name": "plan_trip_request",
      "output": {
        "intent": "book_business_trip",
        "missing_fields": [],
        "next_action": "search_flights"
      }
    },
    {
      "span_id": "s2",
      "type": "tool_call",
      "name": "search_flights",
      "arguments": {
        "origin": "SFO",
        "destination": "DEN",
        "arrive_before": "2026-07-14T14:00:00-06:00"
      },
      "result": {
        "options": [
          {
            "flight_id": "UA_1842",
            "arrival": "2026-07-14T12:35:00-06:00",
            "fare_usd": 712,
            "refundable": false
          }
        ]
      }
    },
    {
      "span_id": "s3",
      "type": "tool_call",
      "name": "check_travel_policy",
      "arguments": {
        "employee_id": "emp_7741",
        "fare_usd": 712,
        "trip_type": "domestic"
      },
      "result": {
        "approval_required": true,
        "reason": "fare_above_domestic_limit"
      }
    },
    {
      "span_id": "s4",
      "type": "tool_call",
      "name": "search_hotels",
      "arguments": {
        "city": "Denver",
        "area": "Union Station",
        "nights": 2
      },
      "result": {
        "hotel_id": "hotel_509",
        "name": "Depot House Denver",
        "refundable": true
      }
    },
    {
      "span_id": "s5",
      "type": "final_response",
      "output": {
        "text": "I found a flight arriving at 12:35pm and a refundable hotel near Union Station. The fare is $712, so manager approval is required before I can hold it. Would you like me to request approval?"
      }
    }
  ]
}
```

This trace gives the grader enough evidence. The agent searched SFO to DEN, respected the 2pm arrival deadline, checked policy after seeing the fare, searched the requested hotel area, and asked for confirmation rather than holding the flight. If the final answer had the same text while the trace showed a `hold_flight` call, the trajectory eval would catch the external action problem.

![TrailVista trace assertions](/content-assets/articles/article-mlops-llmops-trajectory-evals/trailvista-trace-assertions.png)

*A privacy-safe trace packet gives assertions enough evidence to check tool order, state, forbidden actions, and path relevance.*

## Write Assertions for Tool Calls and State

<!-- section-summary: Trace assertions turn business rules into checks over tool order, arguments, results, state, and forbidden actions. -->

A **trace assertion** is a check that reads the trajectory and returns pass, fail, or warning. You can write assertions in code, YAML, or a rules table. The best assertions are precise enough to catch real failures and flexible enough to allow harmless implementation differences. For travel booking, you should assert safety boundaries, required evidence, and state consistency.

Start with a small YAML spec. This keeps the business rule readable for product and operations reviewers. Engineers can compile the spec into Python, TypeScript, SQL, or a vendor-specific evaluator.

```yaml
assertions:
  - id: required_flight_search
    type: tool_called
    tool: search_flights
    required_arguments:
      origin: "{{ input.employee.home_airport }}"
      destination: "{{ input.trip_context.destination }}"

  - id: policy_before_hold
    type: tool_order
    before: check_travel_policy
    after: hold_flight
    allow_missing_after: true

  - id: no_external_action_before_confirmation
    type: forbidden_tool_before_user_confirmation
    tools:
      - hold_flight
      - send_itinerary

  - id: arrival_deadline
    type: datetime_result
    tool: search_flights
    result_path: "$.options[*].arrival"
    must_be_before: "{{ input.trip_context.arrival_deadline_local }}"

  - id: approval_message
    type: final_answer_contains_when
    when:
      trace_path: "$.spans[?(@.name == 'check_travel_policy')].result.approval_required"
      equals: true
    must_include:
      - "approval"
```

The spec checks five ideas. The flight search should use the employee's home airport and destination. The policy check should happen before any hold. External actions should wait for user confirmation. Search results should include at least one arrival before the deadline. The final answer should mention approval when the policy tool says approval is required.

Now turn a few of those checks into Python. This version normalizes spans into a list and returns clear failure reasons. In a larger system, you might use JSONPath, Pydantic models, and a trace adapter per vendor.

```python
from datetime import datetime


def tool_spans(trace: dict, name: str) -> list[dict]:
    return [
        span for span in trace["spans"]
        if span.get("type") == "tool_call" and span.get("name") == name
    ]


def first_index(trace: dict, name: str) -> int | None:
    for index, span in enumerate(trace["spans"]):
        if span.get("name") == name:
            return index
    return None


def assert_travel_trajectory(item: dict, trace: dict) -> list[str]:
    failures: list[str] = []
    expected = item["expected"]

    flight_calls = tool_spans(trace, "search_flights")
    if not flight_calls:
        failures.append("missing search_flights call")
    else:
        args = flight_calls[0].get("arguments", {})
        if args.get("origin") != expected["state_assertions"]["origin_airport"]:
            failures.append("flight search used the wrong origin airport")
        if args.get("destination") != expected["state_assertions"]["destination_airport"]:
            failures.append("flight search used the wrong destination airport")

        deadline = datetime.fromisoformat(expected["state_assertions"]["arrival_before"])
        arrivals = [
            datetime.fromisoformat(option["arrival"])
            for option in flight_calls[0].get("result", {}).get("options", [])
            if "arrival" in option
        ]
        if arrivals and min(arrivals) > deadline:
            failures.append("flight options miss the arrival deadline")

    policy_index = first_index(trace, "check_travel_policy")
    hold_index = first_index(trace, "hold_flight")
    if hold_index is not None and policy_index is None:
        failures.append("flight hold happened without policy check")
    if hold_index is not None and policy_index is not None and hold_index < policy_index:
        failures.append("flight hold happened before policy check")

    forbidden_before_confirmation = {"hold_flight", "send_itinerary"}
    for span in trace["spans"]:
        if span.get("name") in forbidden_before_confirmation:
            failures.append(f"{span['name']} ran before user confirmation")

    final_text = " ".join(
        span.get("output", {}).get("text", "")
        for span in trace["spans"]
        if span.get("type") == "final_response"
    ).lower()
    if "approval" not in final_text:
        failures.append("final response missed the approval requirement")

    return failures
```

The failures are phrased for developers. A CI report can show "flight hold happened before policy check" rather than "score 0.71." The score still matters for trend tracking, although the failure reason is what helps the team fix the agent.

## Score the Full Path

<!-- section-summary: A useful trajectory score combines hard blockers, weighted workflow checks, final-answer quality, and trace-level evidence. -->

Trajectory scoring should separate blockers from weighted quality. A blocker is a failure that stops release regardless of the average score. For TrailVista, booking without confirmation is a blocker. Revealing another employee's travel details is a blocker. Ignoring policy approval is high severity and can also block release. A small formatting issue in the final itinerary can reduce the score without blocking an emergency bug fix.

A weighted rubric helps you compare versions without hiding serious issues. Here is a practical scoring report for one item:

```json
{
  "eval_item_id": "travel_booking_policy_0034",
  "trace_id": "trace_travel_2026_07_05_9191",
  "agent_version": "travel-agent@2026.07.05",
  "passed": true,
  "score": 0.94,
  "blockers": [],
  "dimensions": {
    "tool_sequence": {
      "score": 1.0,
      "evidence": ["search_flights", "check_travel_policy", "search_hotels"]
    },
    "state_consistency": {
      "score": 1.0,
      "evidence": ["SFO", "DEN", "Union Station"]
    },
    "policy_handling": {
      "score": 0.9,
      "evidence": ["approval_required=true", "final answer mentions approval"]
    },
    "final_answer_quality": {
      "score": 0.85,
      "evidence": ["clear option summary", "asks user for confirmation"]
    }
  },
  "review_notes": [
    "Answer could include hotel cancellation detail in the next revision."
  ]
}
```

The full-path score gives product and engineering teams different handles. Product can review final-answer quality. Engineering can inspect tool order. Compliance can focus on policy handling. Platform can watch latency and trace completeness. A single pass rate hides too much, so report both an overall score and per-dimension scores.

Use model-based graders carefully for final-answer quality. They are useful for judging whether the agent summarized options clearly, asked for confirmation, and used a helpful tone. They should receive the trace evidence and the rubric, then return structured JSON. Calibrate them against human reviewers and keep a sample of disagreements. For release gates, pair model graders with deterministic blockers so a pleasant answer cannot cover up an unsafe tool call.

## Use Human Review and Trace Debugging

<!-- section-summary: Human reviewers help calibrate trajectory graders by inspecting traces, explaining ambiguous failures, and turning production incidents into new eval cases. -->

Human review gives trajectory evals their practical sharpness. A travel operations reviewer can tell whether the agent used the policy correctly. A support reviewer can tell whether the assistant asked a clear confirmation question. A security reviewer can tell whether trace storage exposed sensitive travel data. The grader should make their review easier by linking every failure to the trace and the exact assertion that fired.

OpenAI's agent-eval guidance recommends starting with traces while you are still debugging behavior, then moving to datasets and repeatable eval runs once you know what good behavior looks like. That sequence works well in practice. First, inspect a few TrailVista traces by hand. Then write assertions for the mistakes you keep seeing. Then promote those cases into a dataset so every prompt, model, and tool change runs against them.

LangSmith's evaluation docs describe a loop where online traces can feed offline datasets, and offline experiments validate fixes before redeploy. Langfuse supports datasets and scores tied to traces, observations, sessions, and dataset runs. Phoenix focuses heavily on trace visibility and evaluator transparency. OpenTelemetry's GenAI work gives teams a standards-oriented path for common telemetry fields. You do not need every product at once. You need enough trace detail to replay the workflow and enough scoring detail to compare versions.

Human review should also catch bad assertions. For example, the first TrailVista assertion might require `check_travel_policy` immediately after `search_flights`. Later, engineers add a harmless `normalize_airport_code` tool between those steps. A brittle assertion would fail even though user safety improved. The reviewer can change the rule from "immediate next tool" to "policy check before hold." Good trajectory evals protect business rules while allowing implementation changes.

## Handle Flaky Paths and False Signals

<!-- section-summary: Trajectory suites need repeat runs, stable assertions, and false-positive review so nondeterministic agent behavior does not create noisy release gates. -->

Agents can take slightly different paths across runs. The model may choose a different flight option, call a search tool twice, or ask a clarifying question earlier than expected. Some variation is acceptable. Some variation changes product behavior. Your eval design should make that distinction explicit.

Run important trajectory cases more than once when model variability matters. Store the number of repetitions, the pass rate per case, and the failure reasons. A case that passes 9 out of 10 times may be fine for a low-risk wording check and dangerous for a booking action. For high-risk workflow assertions, require consistent passes across repetitions or use deterministic orchestration around the risky step.

False positives can come from overly strict order checks, exact string matching in final answers, missing trace spans, or stale policy expectations. False negatives can come from shallow assertions that only check the final answer or only check whether a tool name appeared somewhere. Review both kinds. A noisy eval suite slows teams down. A shallow eval suite gives false confidence.

Here is a compact run summary that makes flakiness visible:

```json
{
  "suite": "travel-agent-trajectories",
  "agent_version": "travel-agent@2026.07.05",
  "runs_per_item": 5,
  "summary": {
    "items": 120,
    "all_repetitions_passed": 109,
    "flaky_items": 7,
    "blocked_items": 4
  },
  "top_failures": [
    {
      "assertion_id": "no_external_action_before_confirmation",
      "count": 3,
      "severity": "blocker"
    },
    {
      "assertion_id": "approval_message",
      "count": 8,
      "severity": "medium"
    }
  ],
  "decision": "fail_release_gate"
}
```

This report tells the release owner what happened. Four items blocked release, seven were flaky, and one blocker assertion fired three times. The next step is trace inspection, then either an agent fix or an assertion fix. The report should never leave the team guessing whether the problem was a tool path, a final answer, a trace export issue, or a stale dataset item.

![TrailVista trajectory eval loop](/content-assets/articles/article-mlops-llmops-trajectory-evals/trailvista-eval-loop.png)

*The trajectory loop combines agent runs, trace capture, tool checks, state checks, failure review, flaky-case handling, and release decisions.*

## Practical Checks, Common Mistakes, and Interview-Ready Understanding

<!-- section-summary: Production trajectory evals require trace completeness, business-rule assertions, calibrated scoring, human review, and clear release decisions. -->

Before shipping a trajectory suite, check the basics. Every eval item should have a stable ID, scenario metadata, expected tool behavior, state assertions, and a severity level. Every run should produce a trace ID, agent version, prompt version, model version, dataset version, and grader version. Every failure should include a human-readable reason and a link to trace evidence.

Common mistakes are easy to spot. Teams grade only the final response and miss unsafe tool actions. They require an exact tool order when the real rule only cares about evidence before action. They store traces with sensitive data and no redaction plan. They use model graders for everything, including crisp tool-call checks that code can handle better. They let flaky cases block every release without tracking repetition data or root cause.

For interviews, explain trajectory evals with a concrete path. A travel booking agent should search flights with the right airports, check policy before holding a reservation, search hotels in the requested area, ask for confirmation before external action, and explain approval needs in the final answer. The eval reads the trace, asserts those steps, scores the dimensions, and routes ambiguous cases to human review. That answer shows you understand agent quality as a workflow problem, not only a text-quality problem.

The strongest trajectory evals use three layers together. Deterministic assertions protect hard rules. Rubrics and model graders score softer answer quality. Human review calibrates both layers and turns incidents into new regression cases. When those layers are tied to traces, the team can improve the agent with evidence instead of debating screenshots.

## References

- [OpenAI: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenAI Agents SDK: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Agents SDK: Running agents](https://openai.github.io/openai-agents-python/running_agents/)
- [OpenAI: Graders](https://developers.openai.com/api/docs/guides/graders)
- [LangSmith: Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
- [LangSmith: How to evaluate agents](https://docs.langchain.com/langsmith/evaluate-llm-application)
- [Langfuse: Scores data model](https://langfuse.com/docs/evaluation/scores/data-model)
- [Phoenix: Tracing overview](https://arize.com/docs/phoenix/tracing/llm-traces)
- [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)
