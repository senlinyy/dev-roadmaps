---
title: "CI and Regression"
description: "Run agent eval suites in CI, compare against baselines, publish reports, and gate releases for prompts, models, tools, retrieval, and grading changes."
overview: "Learn how to wire LLMOps evals into a CI workflow for an internal coding and research agent, including regression baselines, release thresholds, GitHub Actions, report artifacts, drift checks, and false-signal review."
tags: ["MLOps","LLMOps","production","evals"]
order: 3
id: "article-mlops-llmops-ci-and-regression"
---

## Why CI Regression Evals Exist

<!-- section-summary: CI regression evals run the same agent tests on every important change so prompt, model, tool, retrieval, and grader updates do not quietly break known behavior. -->

**CI and regression evals** are the bridge between agent experimentation and production discipline. CI means the eval suite runs automatically in your development workflow, usually on pull requests and before deployment. Regression means the suite checks whether behavior that used to work still works after a change. For an LLM agent, that change might be a prompt edit, model upgrade, retrieval index update, tool schema change, planner change, or grader change.

In this article, you are working on **Atlas Research**, an internal coding and research agent used by the platform team at Cedar Metrics. Engineers ask Atlas Research to search internal repositories, summarize design docs, inspect test failures, draft migration plans, and propose code snippets. The agent can call tools such as `repo_search`, `read_file`, `run_tests`, `query_rfc_index`, and `summarize_trace`. It can open pull-request context, although it cannot merge code or change production systems.

This kind of agent needs CI evals because failures can look subtle. The agent may still sound confident while citing a file that no longer exists. It may skip tests after a prompt change. It may use a broad repository search and miss the exact package that owns the bug. It may pass easy research questions and fail the known incident playbook question that senior engineers care about. Manual spot checks catch some of this, and a regression suite catches it every time.

OpenAI's current agent evaluation guidance points to traces, graders, datasets, and eval runs for improving agent quality. Its evaluation best-practices guidance also emphasizes task-specific evals, logging, automation, human feedback, and continuous evaluation. For CI, those ideas turn into a practical rule: every meaningful agent change should produce a report that compares the new agent run against a trusted baseline and makes the release decision visible.

## What You Put Under Version Control

<!-- section-summary: A CI-ready eval setup versions the dataset, runner, graders, thresholds, prompts, tools, and baseline reports so every score can be explained later. -->

Before writing a workflow file, decide which eval artifacts live in the repo. The goal is reproducibility. When a pull request changes the coding-agent prompt, reviewers should see exactly which dataset ran, which graders scored it, which baseline was used, and which thresholds controlled the gate.

For Atlas Research, the repo keeps the eval cases in JSONL, the grader code in Python, and the threshold config in YAML. Baseline reports live under a versioned folder and are updated only through an approved "baseline refresh" pull request. That separation is important. A normal prompt change should compare against the current baseline. A baseline refresh should explain why the expected behavior changed.

```yaml
suite: atlas-research-ci
owner: llm-platform
agent: atlas-research
dataset_version: "2026.07.05"
baseline: "baselines/atlas-research/2026-07-01-main.json"
runner:
  repetitions_per_item: 3
  max_concurrency: 6
  timeout_seconds_per_item: 90
gates:
  blockers_allowed: 0
  overall_min_pass_rate: 0.90
  severe_slice_min_pass_rate: 0.98
  max_quality_score_drop: 0.025
  max_cost_increase_ratio: 1.20
slices:
  repo_grounding:
    min_pass_rate: 0.94
  code_change_plan:
    min_pass_rate: 0.90
  research_citations:
    min_pass_rate: 0.92
  incident_playbooks:
    min_pass_rate: 0.98
```

The config says how many repetitions to run, which baseline to compare against, and which gates control release. Repetitions matter because agents can choose slightly different paths across runs. The severe slice has a stricter threshold because incident playbook guidance and internal security instructions carry more risk than ordinary code-search questions.

The dataset item should also be versioned. Here is one regression case that came from a real internal failure. Atlas Research once answered a migration question from an old README and missed the newer RFC that changed the deployment path. The eval case now forces the agent to search the RFC index and cite the correct source.

```json
{
  "id": "atlas_rfc_grounding_0048",
  "suite": "atlas-research-ci",
  "split": "regression",
  "input": {
    "task": "Explain how the billing-events service should publish replay-safe events after the July 2026 migration.",
    "repo_context": {
      "repositories": ["billing-platform", "eventing-core"],
      "branch": "main"
    },
    "available_tools": [
      "repo_search",
      "read_file",
      "query_rfc_index"
    ]
  },
  "expected": {
    "required_sources": [
      "RFC-0427-replay-safe-billing-events",
      "billing-platform/services/billing-events/README.md"
    ],
    "forbidden_sources": [
      "RFC-0311-legacy-event-publisher"
    ],
    "must_include": [
      "idempotency key",
      "event schema version",
      "dead-letter replay process"
    ],
    "must_call_tools": [
      "query_rfc_index",
      "repo_search",
      "read_file"
    ],
    "severity": "high"
  },
  "metadata": {
    "source": "production_failure",
    "added_by": "platform-oncall",
    "reviewed_by": "eventing-tech-lead",
    "created_at": "2026-07-03"
  }
}
```

This item tests more than the final paragraph. It checks whether the agent used the RFC index, searched the repo, read the live README, avoided the legacy RFC, and included the operational details that matter for replay-safe events. A CI runner can grade those pieces with trace assertions and answer rubrics.

![Atlas Research versioned eval artifacts](/content-assets/articles/article-mlops-llmops-ci-and-regression/atlas-versioned-eval-artifacts.png)

*Atlas Research keeps cases, graders, thresholds, prompts, tool schemas, baselines, pull-request runs, and report artifacts visible to reviewers.*

## Build a Regression Baseline

<!-- section-summary: A baseline records the accepted behavior of the current production agent so future changes can be compared with score deltas and failure reasons. -->

A **regression baseline** is the accepted report from a known-good version of the agent. It gives CI something concrete to compare against. Without a baseline, every eval run is just a score. With a baseline, you can see which cases improved, which cases regressed, and whether cost or latency moved outside the team's limits.

For Atlas Research, the baseline comes from the current production prompt, production tool schemas, current retrieval index, and current grader version. The team stores the baseline report with metadata. That metadata prevents confusion later when someone asks whether a score changed because the prompt changed or because the grader changed.

```json
{
  "suite": "atlas-research-ci",
  "baseline_id": "atlas-research-main-2026-07-01",
  "agent_version": "atlas-research@2026.07.01",
  "prompt_version": "research-agent-prompt@18",
  "tool_schema_version": "coding-tools@12",
  "retrieval_index_version": "rfc-index@2026.07.01",
  "grader_version": "agent-regression-graders@7",
  "dataset_version": "2026.07.05",
  "summary": {
    "items": 180,
    "overall_pass_rate": 0.933,
    "blockers": 0,
    "quality_score": 0.871,
    "median_latency_ms": 18400,
    "mean_cost_usd": 0.083
  },
  "slices": {
    "repo_grounding": { "pass_rate": 0.948, "items": 58 },
    "code_change_plan": { "pass_rate": 0.914, "items": 43 },
    "research_citations": { "pass_rate": 0.927, "items": 52 },
    "incident_playbooks": { "pass_rate": 0.982, "items": 27 }
  }
}
```

The baseline should be refreshed intentionally. If the company retires an old deployment tool, some eval items should change. If a grader is too strict and human review proves it is wrong, the grader should change. If the model provider releases a new model and the team promotes it, the baseline should change after review. The baseline refresh pull request should include the reason, new report, old report, and a human approval from the owner of the affected slice.

Avoid refreshing baselines casually. If every failing prompt change updates the baseline in the same pull request, the regression suite loses its purpose. A normal change compares against the baseline. A baseline change explains why accepted behavior changed.

![Atlas Research baseline comparison](/content-assets/articles/article-mlops-llmops-ci-and-regression/atlas-baseline-comparison.png)

*The baseline comparison turns a current pull-request run into deltas for pass rate, quality, cost, latency, repo grounding, and incident-playbook slices.*

## Run Evals in GitHub Actions

<!-- section-summary: The CI workflow installs the eval runner, executes the suite, compares against the baseline, and uploads a report artifact that reviewers can inspect. -->

GitHub Actions workflows are YAML files under `.github/workflows`. A workflow can run on pull requests, pushes, schedules, or manual triggers. GitHub's official docs describe workflows as configurable automated processes made of jobs and steps, and its artifact docs describe uploading files from a workflow run for debugging and review.

Here is a practical workflow for Atlas Research. It runs when agent prompts, tools, graders, datasets, or the workflow itself change. It uses current major versions from the official GitHub actions repositories checked during this audit: `actions/checkout@v6`, `actions/setup-python@v6`, and `actions/upload-artifact@v6`. If your company runs self-hosted runners, verify the runner version supports those action releases before adopting them.

```yaml
name: atlas-research-agent-evals

on:
  pull_request:
    paths:
      - "agents/atlas-research/**"
      - "evals/atlas-research/**"
      - ".github/workflows/atlas-research-agent-evals.yml"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  regression-evals:
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.13"
          cache: "pip"
          cache-dependency-path: "evals/atlas-research/requirements.txt"

      - name: Install eval dependencies
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r evals/atlas-research/requirements.txt

      - name: Run regression suite
        env:
          ATLAS_AGENT_ENV: ci
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}
        run: |
          python evals/atlas-research/run_suite.py \
            --config evals/atlas-research/ci-suite.yml \
            --output reports/atlas-research/current.json \
            --jsonl reports/atlas-research/items.jsonl

      - name: Compare with baseline
        run: |
          python evals/atlas-research/compare_regression.py \
            --config evals/atlas-research/ci-suite.yml \
            --current reports/atlas-research/current.json \
            --baseline baselines/atlas-research/2026-07-01-main.json \
            --output reports/atlas-research/regression-summary.json

      - name: Upload eval report
        if: always()
        uses: actions/upload-artifact@v6
        with:
          name: atlas-research-eval-report
          path: reports/atlas-research/
          retention-days: 14
```

The workflow separates running the suite from comparing the report. That makes debugging easier. If the runner fails because a tool schema changed, you inspect `current.json` and `items.jsonl`. If the runner succeeds and the comparison fails, you inspect `regression-summary.json`. The artifact upload runs with `if: always()` so reviewers still get evidence after a failing gate.

Do not put provider keys or tracing keys in the dataset. Keep them in CI secrets or workload identity. Also keep traces privacy-aware. Internal coding agents can expose private repo names, incident details, customer IDs in logs, or security-sensitive instructions. The OpenAI Agents SDK tracing docs call out sensitive data capture controls, and the same habit applies to any tracing backend.

## Gate Releases Without Freezing Development

<!-- section-summary: Release gates should block severe regressions while allowing reviewed improvements, known flakes, and intentional baseline updates through the right process. -->

A release gate is the rule that decides whether a change can ship. For LLM agents, a single average score is too blunt. You need blocker rules, slice thresholds, score deltas, and cost or latency limits. The goal is to catch real regressions while keeping useful iteration moving.

Here is a compact comparison script. It reads the current report, the baseline, and the thresholds. It fails the CI step when a blocker appears, a pass-rate threshold is missed, or the quality score drops too far. In a production version, you would add richer report formatting and links to trace dashboards.

```python
import argparse
import json
import sys
from pathlib import Path

import yaml


def load_json(path: str) -> dict:
    return json.loads(Path(path).read_text())


def load_yaml(path: str) -> dict:
    return yaml.safe_load(Path(path).read_text())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    config = load_yaml(args.config)
    current = load_json(args.current)
    baseline = load_json(args.baseline)
    gates = config["gates"]
    failures: list[str] = []

    current_summary = current["summary"]
    baseline_summary = baseline["summary"]

    if current_summary["blockers"] > gates["blockers_allowed"]:
        failures.append(
            f"blockers: {current_summary['blockers']} > {gates['blockers_allowed']}"
        )

    if current_summary["overall_pass_rate"] < gates["overall_min_pass_rate"]:
        failures.append(
            "overall pass rate: "
            f"{current_summary['overall_pass_rate']:.3f} < "
            f"{gates['overall_min_pass_rate']:.3f}"
        )

    quality_drop = baseline_summary["quality_score"] - current_summary["quality_score"]
    if quality_drop > gates["max_quality_score_drop"]:
        failures.append(
            f"quality score drop: {quality_drop:.3f} > "
            f"{gates['max_quality_score_drop']:.3f}"
        )

    cost_ratio = current_summary["mean_cost_usd"] / baseline_summary["mean_cost_usd"]
    if cost_ratio > gates["max_cost_increase_ratio"]:
        failures.append(
            f"mean cost ratio: {cost_ratio:.2f} > {gates['max_cost_increase_ratio']:.2f}"
        )

    for slice_name, slice_config in config["slices"].items():
        pass_rate = current["slices"][slice_name]["pass_rate"]
        if pass_rate < slice_config["min_pass_rate"]:
            failures.append(
                f"{slice_name} pass rate: {pass_rate:.3f} < "
                f"{slice_config['min_pass_rate']:.3f}"
            )

    report = {
        "decision": "fail" if failures else "pass",
        "failures": failures,
        "current": current_summary,
        "baseline": baseline_summary,
    }
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n")

    if failures:
        print("Regression gate failed")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Regression gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

The script keeps policy out of code as much as possible. Thresholds live in YAML where owners can review them. The code only applies the thresholds. This makes release decisions easier to audit. If the incident-playbook threshold changes from 0.98 to 0.95, the diff is visible and reviewers can challenge it.

Some teams use soft gates for early projects. A soft gate posts a report without blocking merge. That can be useful while the dataset and graders are still being calibrated. For production agents, severe slices should eventually block release. The exact timeline should be written down so the suite does not stay advisory forever.

## Read the Report Artifact

<!-- section-summary: A good CI artifact explains the release decision, score deltas, failing items, trace links, grader reasons, and follow-up owners. -->

The report artifact is the object reviewers actually use. It should answer five questions quickly: did the gate pass, what changed from the baseline, which items failed, where is the trace evidence, and who owns the next step. A report that only says "pass rate 88 percent" leaves reviewers with detective work.

Here is a useful JSON artifact for Atlas Research:

```json
{
  "suite": "atlas-research-ci",
  "decision": "fail",
  "current_run_id": "evalrun_2026_07_05_1142",
  "baseline_id": "atlas-research-main-2026-07-01",
  "agent_version": "atlas-research@pr-2187",
  "dataset_version": "2026.07.05",
  "summary": {
    "overall_pass_rate": {
      "current": 0.889,
      "baseline": 0.933,
      "delta": -0.044
    },
    "quality_score": {
      "current": 0.842,
      "baseline": 0.871,
      "delta": -0.029
    },
    "blockers": 1,
    "mean_cost_usd": {
      "current": 0.091,
      "baseline": 0.083,
      "ratio": 1.10
    }
  },
  "failed_gates": [
    "overall pass rate below 0.900",
    "quality score drop above 0.025",
    "blockers above 0"
  ],
  "top_regressions": [
    {
      "item_id": "atlas_rfc_grounding_0048",
      "slice": "repo_grounding",
      "severity": "high",
      "baseline_status": "pass",
      "current_status": "fail",
      "reasons": [
        "missing required source RFC-0427-replay-safe-billing-events",
        "used forbidden source RFC-0311-legacy-event-publisher"
      ],
      "trace_url": "https://traces.example.com/trace/trace_atlas_8842",
      "owner": "eventing-tech-lead"
    },
    {
      "item_id": "atlas_test_plan_0019",
      "slice": "code_change_plan",
      "severity": "medium",
      "baseline_status": "pass",
      "current_status": "fail",
      "reasons": [
        "answer recommended code change without test command"
      ],
      "trace_url": "https://traces.example.com/trace/trace_atlas_8849",
      "owner": "llm-platform"
    }
  ],
  "next_steps": [
    "Inspect trace_atlas_8842 retrieval spans",
    "Check whether the new prompt demotes RFC index search",
    "Rerun the suite after prompt fix"
  ]
}
```

This report tells a clear story. The pull request failed because it regressed grounding and quality. The top item used a forbidden legacy source and missed the current RFC. The trace link points to the evidence. The owner knows where to start. This is the level of detail that makes CI evals useful instead of annoying.

You can also produce a Markdown summary for pull-request comments. Keep it short: decision, gate failures, top regressions, and artifact link. The detailed JSON stays in the artifact for scripts and dashboards. Over time, store these reports in object storage or a warehouse so you can trend pass rate, cost, latency, and flaky items across releases.

## Handle Drift, Flakes, and Bad Graders

<!-- section-summary: Mature CI evals include a maintenance loop for dataset drift, flaky cases, grader false positives, grader false negatives, and intentional baseline changes. -->

CI evals need maintenance because agents, products, and repositories change. **Dataset drift** happens when the suite stops matching current work. Atlas Research might gain a new monorepo, a new incident response process, or a new source-of-truth system for RFCs. The dataset should evolve with those changes. Each item should carry source, owner, and last-reviewed metadata so stale cases can be found.

Flaky cases need their own lane. A flaky case is one that passes and fails across repetitions without a clear code change. Some flakiness comes from model variability. Some comes from tools returning different search results. Some comes from a vague grader. Track flakes separately from hard regressions. If a severe safety or incident slice is flaky, fix the agent or orchestration. If a low-risk wording item is flaky, adjust the grader or move it out of the blocking gate.

False positives and false negatives deserve regular review. A false positive blocks a change that human reviewers accept. A false negative passes a result that human reviewers reject. Both can damage trust. In CI, false positives create wasted time and pressure to bypass the suite. False negatives allow broken agent behavior into production. The review process should sample both failed and passed cases, then update graders and examples through pull requests.

Here is a maintenance checklist you can run weekly:

- Review every blocker failure with a human owner.
- Sample passed items from severe slices and check for false negatives.
- Sample failed medium-severity items and check for false positives.
- Promote real production failures into the regression split.
- Retire duplicate cases with a reason in metadata.
- Refresh policy, RFC, tool, and retrieval versions in dataset metadata.
- Compare production trace distribution with eval slice distribution.
- Keep baseline refreshes separate from ordinary agent changes.

The maintenance loop should also include grader tests. A grader is code, and code can regress. Create small fixtures where the expected grader decision is obvious. Run those fixtures in CI before the agent suite. If a grader change makes old passing and failing fixture decisions flip, reviewers should see that directly.

![Atlas Research regression gate loop](/content-assets/articles/article-mlops-llmops-ci-and-regression/atlas-regression-gate-loop.png)

*The regression gate loop links golden cases, pull requests, eval runs, privacy-safe trace packets, baseline comparison, reports, failure review, baseline refreshes, and release decisions.*

## Practical Checks, Common Mistakes, and Interview-Ready Understanding

<!-- section-summary: A production CI eval system has versioned datasets, baselines, trace evidence, release gates, report artifacts, and an explicit process for maintaining trust. -->

Before calling a CI regression setup ready, check that the whole chain is versioned. Dataset version, prompt version, model version, tool schema version, retrieval index version, grader version, and baseline ID should appear in the report. Each failed item should have a reason, severity, slice, owner, and trace link. Each release gate should have a threshold and a human owner.

Common mistakes follow a pattern. Teams run evals manually and forget them during urgent prompt changes. They compare only the overall score and miss a severe slice regression. They let the same pull request update the prompt and the baseline. They use brittle string graders for research answers that need citation and source checks. They upload no artifacts, so failed CI leaves no evidence. They allow stale eval items to block releases months after the source-of-truth document moved.

The interview-ready explanation is straightforward. CI regression evals run the agent suite automatically on every meaningful change. The runner executes versioned dataset items, captures traces, applies deterministic and model-based graders, compares the current report against a baseline, and enforces release gates. The report artifact shows pass rates, score deltas, blockers, failing items, trace evidence, and owners. The team maintains the suite by adding production failures, reviewing false positives and false negatives, tracking flakes, and refreshing baselines only through explicit approval.

That is the industrial practice: evals are part of the delivery pipeline. They are reviewed like code, run like tests, stored like build artifacts, and maintained like any other production signal. When the agent changes, the CI report gives the team evidence about quality instead of a debate about whether a demo felt good.

## References

- [OpenAI: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenAI: Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [OpenAI: Graders](https://developers.openai.com/api/docs/guides/graders)
- [OpenAI Agents SDK: Tracing](https://openai.github.io/openai-agents-python/tracing/)
- [LangSmith: Evaluation](https://docs.langchain.com/langsmith/evaluation)
- [LangSmith: Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
- [Langfuse: Datasets](https://langfuse.com/docs/evaluation/experiments/datasets)
- [Phoenix: Evaluation](https://arize.com/docs/phoenix/evaluation/llm-evals)
- [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai)
- [GitHub Actions: Workflow syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions)
- [GitHub Actions: Workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
- [actions/upload-artifact releases](https://github.com/actions/upload-artifact/releases)
