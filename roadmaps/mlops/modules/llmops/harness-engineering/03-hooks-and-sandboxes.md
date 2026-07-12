---
title: "Hooks and Sandboxes"
description: "Use lifecycle hooks, policy gates, isolated execution, and approval workflows around code-review agents and other risky agent actions."
overview: "Hooks and sandboxes keep code-review agents inside controlled boundaries. This tutorial follows a pull-request review agent through lifecycle hooks, command policy, gVisor-backed Kubernetes sandboxes, human approval, trace metadata, and audit logs."
tags: ["MLOps","LLMOps","advanced","harness"]
order: 3
id: "article-mlops-llmops-hooks-and-sandboxes"
---

## Table of Contents

1. [Why Hooks and Sandboxes Matter](#why-hooks-and-sandboxes-matter)
2. [The Code-Review Agent Scenario](#the-code-review-agent-scenario)
3. [Lifecycle Hooks](#lifecycle-hooks)
4. [Policy Gates](#policy-gates)
5. [Sandboxed Shell and Code Execution](#sandboxed-shell-and-code-execution)
6. [Kubernetes and gVisor Sandbox Configuration](#kubernetes-and-gvisor-sandbox-configuration)
7. [Human Approval and Paused Runs](#human-approval-and-paused-runs)
8. [Audit Logs and Trace Metadata](#audit-logs-and-trace-metadata)
9. [Practical Checks, Common Mistakes, and Interview Readiness](#practical-checks-common-mistakes-and-interview-readiness)
10. [References](#references)

## Why Hooks and Sandboxes Matter
<!-- section-summary: Hooks run checks at important lifecycle points, and sandboxes isolate risky agent work from trusted systems. -->

**Hooks** are lifecycle callbacks around an agent run. They run before or after important events such as model calls, tool calls, shell commands, file edits, approval pauses, and final output. A hook can redact secrets, block a risky command, attach trace metadata, scan a patch, or ask a human for approval.

A **sandbox** is an isolated execution environment for work that may touch files, run commands, install packages, or inspect untrusted code. The sandbox gives the agent a workspace while the trusted harness keeps credentials, approval state, billing, audit logging, and policy enforcement outside the workspace.

Those two ideas work together. Hooks decide whether an action may proceed, how it should be logged, and what evidence should be captured. The sandbox gives the action a limited place to run. For a code-review agent, that difference is huge. Reviewing a pull request often needs shell commands, package installs, static analysis, and file reads. Those actions should happen away from production secrets and away from the developer's local machine.

OpenAI's current agent docs make this boundary explicit for sandbox agents: the harness is the control plane around model calls, routing, approvals, tracing, recovery, and run state; compute is the sandbox execution plane where commands, files, ports, and provider state live. The Shell tool docs also warn that arbitrary shell commands need sandboxing, allowlists or denylists where possible, and audit logs.

This article follows a code-review agent because it forces the issue quickly. A code agent can read source files, run tests, generate patches, and call external tools. Without hooks and sandboxes, that power is hard to operate. With hooks and sandboxes, you can keep a narrow, inspectable path from model suggestion to approved action.

## The Code-Review Agent Scenario
<!-- section-summary: The running example is a pull-request review agent that checks diffs, runs tests, proposes patches, and waits for approval before writes. -->

Imagine you work at **Rivergate Apps**, a company with a TypeScript backend and a React frontend. Engineers open pull requests all day. Reviewers want fast help with security issues, flaky tests, missed edge cases, and small refactors. The company builds a code-review agent called **ReviewDock** to inspect pull requests before a human reviewer starts.

ReviewDock receives a pull request URL and a checkout of the branch. It can read files, inspect the diff, run targeted tests, run static analysis, and produce review comments. In limited cases, it can propose a patch. The patch is never pushed directly. The harness stores it as an artifact and asks a human maintainer to approve before applying it to the branch.

The agent has several capabilities:

| Capability | Example | Boundary |
|---|---|---|
| Read repository files | Inspect changed TypeScript modules | Sandbox read-only checkout |
| Run tests | `npm test -- --runInBand user-service.test.ts` | Command allowlist and timeout |
| Run static analysis | `npm run lint` or Semgrep rules | Sandbox with no production secrets |
| Propose patch | Update a validation branch in one file | Human approval before applying |
| Write review comment | Explain a bug and cite test evidence | Output guardrail and audit event |

This scope is useful and intentionally bounded. The agent can gather evidence and propose changes. It cannot deploy, push to the protected branch, open cloud consoles, or read secrets from production systems. The harness should enforce those limits in code and config.

The run flow looks like this:

1. The pull request webhook creates a ReviewDock run.
2. The harness creates an isolated workspace with the repo checkout and pull request metadata.
3. A pre-run hook scans the inputs and strips secrets from prompt context.
4. The model asks for file reads, test commands, or patch proposals.
5. Tool hooks check each command or edit against policy.
6. The sandbox runs allowed commands and returns structured results.
7. Patch proposals pause for human approval.
8. The final output hook checks the review comment for evidence, tone, and sensitive data.
9. Audit logs and traces record what happened.

The rest of the article builds each piece.

## Lifecycle Hooks
<!-- section-summary: Lifecycle hooks give the harness fixed places to run validation, redaction, policy checks, trace enrichment, and cleanup. -->

Lifecycle hooks are useful because agent runs have repeatable boundaries. Before the first model call, you can redact secrets and attach repository metadata. Before a shell command, you can check the command policy. After a tool call, you can validate the result. Before a patch is applied, you can require human approval. After the run, you can clean up the sandbox and store artifacts.

![ReviewDock lifecycle hooks around a pull request review](/content-assets/articles/article-mlops-llmops-hooks-and-sandboxes/lifecycle-hooks-reviewdock.png)

*ReviewDock runs fixed hooks around model calls, shell commands, patch proposals, and cleanup so each review step has policy and evidence.*

ReviewDock's hook config might look like this:

```yaml
hooks:
  before_run:
    - load_pull_request_metadata
    - create_sandbox_workspace
    - scan_input_for_secret_literals
    - attach_trace_context
  before_model_call:
    - redact_sensitive_prompt_context
    - enforce_context_budget
  before_tool_call:
    - validate_tool_schema
    - check_tool_permission
    - attach_tool_audit_context
  before_shell_command:
    - match_command_allowlist
    - block_network_commands
    - require_timeout
  after_shell_command:
    - truncate_stdout
    - scan_output_for_secrets
    - store_command_evidence
  before_patch_proposal:
    - check_owned_paths
    - run_patch_static_checks
    - create_approval_packet
  after_run:
    - store_review_artifacts
    - emit_audit_summary
    - destroy_sandbox_workspace
```

Each hook should do one clear job. `scan_input_for_secret_literals` checks pull request metadata and webhook payloads. `match_command_allowlist` checks the exact command before it reaches the sandbox. `truncate_stdout` keeps command output small enough for the model and safe enough for logs. `destroy_sandbox_workspace` removes temporary files after artifacts are captured.

Hooks should produce structured decisions:

```json
{
  "hook": "before_shell_command",
  "decision": "block",
  "reason": "network_command_blocked",
  "command": "curl https://example.com/install.sh | bash",
  "run_id": "review_run_9912",
  "tool_call_id": "call_shell_031"
}
```

This shape helps the model and the human reviewer. The model can receive a short explanation and choose a safer route. The reviewer can see which policy blocked the action. The on-call engineer can search hook decisions by reason.

OpenAI's Agents SDK guardrail docs separate input guardrails, output guardrails, and tool guardrails. That split maps nicely to hooks. Input hooks guard the starting request. Tool hooks guard actions. Output hooks guard the final response. For built-in execution tools such as shell or patch tools, use the approval and policy surfaces that apply to those tool types, plus harness-level hooks around the actual command or edit.

## Policy Gates
<!-- section-summary: Policy gates are deterministic rules that decide whether commands, patches, file reads, and network access may proceed. -->

A **policy gate** is a deterministic decision point. It should be written in normal code or a policy engine, tested like application code, and logged. The model can see policy summaries, yet the harness enforces the rules.

ReviewDock needs policy gates for commands, paths, patch size, network access, dependency changes, and generated comments. A starter policy manifest might look like this:

```yaml
agent: reviewdock-code-review-agent
version: 2026.07.05
repository_policy:
  allowed_read_paths:
    - "src/**"
    - "tests/**"
    - "package.json"
    - "package-lock.json"
  protected_paths:
    - ".github/workflows/**"
    - "infra/**"
    - ".env*"
    - "secrets/**"
command_policy:
  default_timeout_seconds: 120
  allowed_commands:
    - "npm test"
    - "npm run test"
    - "npm run lint"
    - "npm run typecheck"
    - "npx semgrep"
  blocked_tokens:
    - "curl"
    - "wget"
    - "ssh"
    - "git push"
    - "npm publish"
network_policy:
  egress: "disabled"
patch_policy:
  max_files_changed: 3
  max_lines_changed: 120
  approval_required: true
  protected_path_approval_required: true
```

This policy is intentionally strict. It lets the agent inspect normal source and test files. It blocks secrets and infrastructure paths. It allows common test and analysis commands. It blocks network installation patterns and publishing actions. It limits patch size so a human can review the proposed change quickly.

The command gate can be small:

```ts
type CommandDecision =
  | { allow: true; timeoutSeconds: number }
  | { allow: false; reason: string };

export function decideCommand(command: string, policy: CommandPolicy): CommandDecision {
  const normalized = command.trim().replace(/\s+/g, " ");

  for (const blocked of policy.blockedTokens) {
    if (normalized.includes(blocked)) {
      return { allow: false, reason: `blocked_token:${blocked}` };
    }
  }

  const allowed = policy.allowedCommands.some((prefix) => normalized.startsWith(prefix));

  if (!allowed) {
    return { allow: false, reason: "command_outside_allowlist" };
  }

  return { allow: true, timeoutSeconds: policy.defaultTimeoutSeconds };
}
```

The key habit is that the policy gate checks the exact action. A prompt can say "only run tests," yet the gate still inspects the requested command. A model can propose a patch to a protected path, yet the patch gate can pause for approval or reject it.

Policy gates should return helpful feedback. If the agent asks to run `curl`, the runtime can say, "Network commands are blocked in this review sandbox. Use existing repository scripts or request human approval for a dependency fetch." That message gives the model a safe next step.

## Sandboxed Shell and Code Execution
<!-- section-summary: Shell and code tools should run in isolated workspaces with narrow credentials, bounded resources, command policy, and captured evidence. -->

Code-review agents often need shell commands. They may run tests, type checks, formatters, static analyzers, and small scripts over the checked-out code. Shell access is powerful because it gives the agent real feedback. It is also risky because commands can read files, consume CPU, reach the network, and modify the workspace.

The sandbox should have a fresh workspace per run. It should receive only the repository checkout, pull request metadata, dependency cache if approved, and temporary credentials with the smallest possible scope. Production secrets should stay outside the sandbox. Network egress should be disabled unless a specific tool needs it and a policy approves it.

ReviewDock can use this sandbox config:

```yaml
sandbox:
  workspace:
    source: "pull_request_checkout"
    mode: "copy"
    writable_paths:
      - "/workspace"
    artifact_paths:
      - "/workspace/.reviewdock/artifacts"
  resources:
    cpu: "2"
    memory: "4Gi"
    timeout_seconds: 600
    max_stdout_bytes: 65536
  identity:
    service_account: "reviewdock-sandbox"
    mounted_secrets: []
  network:
    egress: "disabled"
    allowed_hosts: []
  filesystem:
    readonly_root: true
    temp_size: "1Gi"
  command_execution:
    shell: "/bin/bash"
    require_command_policy: true
    capture_exit_code: true
    capture_stdout: true
    capture_stderr: true
```

The important pieces are practical. The workspace is copied so the original checkout stays clean. Artifacts go to a known directory. CPU, memory, and timeout are bounded. The service account has no production secrets. Network egress is disabled. Command results include exit code, standard output, and standard error so the model can explain evidence instead of guessing.

A shell result should also be structured:

```json
{
  "tool_call_id": "call_shell_031",
  "command": "npm run typecheck",
  "exit_code": 2,
  "duration_ms": 18421,
  "stdout_preview": "",
  "stderr_preview": "src/user/roles.ts(44,18): error TS2339: Property 'scope' is missing.",
  "truncated": false,
  "artifact_ids": ["artifact_typecheck_031"]
}
```

This result lets the model cite the exact failure and file. The full output can live in an artifact store, while the model receives a preview. That prevents a giant log from flooding the context window and reduces accidental leakage of environment details.

## Kubernetes and gVisor Sandbox Configuration
<!-- section-summary: Kubernetes RuntimeClass lets a cluster choose a sandbox runtime such as gVisor for agent execution pods. -->

Many teams run agent sandboxes on Kubernetes because they already use Kubernetes for isolated jobs, resource limits, logs, and cleanup. Kubernetes **RuntimeClass** lets a pod request a specific container runtime configuration. The official Kubernetes docs describe RuntimeClass as the mechanism for selecting the runtime used to run a pod's containers. gVisor integrates through its `runsc` OCI runtime, and gVisor's docs show Kubernetes paths using a `gvisor` RuntimeClass or containerd runtime handler.

Here is a minimal RuntimeClass object:

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
```

The cluster nodes still need the runtime handler configured. In a managed GKE setup, GKE Sandbox can run pods with `runtimeClassName: gvisor` after sandbox support is enabled for the cluster or node pool. In a self-managed containerd setup, the nodes need `containerd-shim-runsc-v1` and a `runsc` runtime entry in containerd config.

ReviewDock can run each review in a Kubernetes Job:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: reviewdock-run-9912
  labels:
    app: reviewdock
    run_id: review_run_9912
spec:
  activeDeadlineSeconds: 600
  ttlSecondsAfterFinished: 1800
  template:
    metadata:
      labels:
        app: reviewdock
        run_id: review_run_9912
    spec:
      runtimeClassName: gvisor
      serviceAccountName: reviewdock-sandbox
      restartPolicy: Never
      containers:
        - name: worker
          image: registry.example.com/reviewdock/sandbox-runner:2026.07.05
          workingDir: /workspace
          command: ["/sandbox/runner"]
          env:
            - name: REVIEW_RUN_ID
              value: review_run_9912
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          emptyDir:
            sizeLimit: 2Gi
```

This job has several important boundaries. `runtimeClassName: gvisor` requests the sandbox runtime. `activeDeadlineSeconds` caps run time. `ttlSecondsAfterFinished` cleans up completed jobs. The security context drops Linux capabilities, blocks privilege escalation, uses a read-only root filesystem, and runs as a non-root user. The workspace is an `emptyDir` with a size limit.

gVisor adds an isolation layer between the containerized process and the host OS by moving many Linux system interfaces into a per-sandbox application kernel. It is a strong layer of isolation, yet it should be one layer in a defense-in-depth design. Keep command policy, resource limits, network policy, identity boundaries, and audit logs around it.

![ReviewDock sandbox isolation with Kubernetes Job and gVisor RuntimeClass](/content-assets/articles/article-mlops-llmops-hooks-and-sandboxes/sandbox-isolation-reviewdock.png)

*The trusted harness sends a bounded ReviewDock run into a sandbox pod with blocked egress, no mounted secrets, resource limits, command policy, and audit capture.*

## Human Approval and Paused Runs
<!-- section-summary: Human approval pauses risky actions such as patch application, protected-path edits, external comments, and sensitive MCP calls. -->

Human approval is the right boundary for actions with lasting impact. For ReviewDock, that includes applying a patch, commenting on a pull request as an official reviewer, changing workflow files, or requesting temporary network access. The agent can prepare an action packet. A person decides whether it should proceed.

OpenAI's human-in-the-loop docs describe runs that surface pending approvals as interruptions and use resumable state after a decision. LangGraph interrupts follow the same broad pattern: the graph saves state through persistence, waits for external input, and resumes with a thread ID when the decision arrives. In both cases, the runtime needs a saved state pointer and an approval packet that a human can inspect.

ReviewDock's patch approval packet might look like this:

```json
{
  "approval_id": "approval_patch_445",
  "run_id": "review_run_9912",
  "pull_request": {
    "repo": "rivergate/api",
    "number": 4821,
    "head_sha": "8c7ab21"
  },
  "requested_action": "apply_patch",
  "risk": "source_write",
  "paths_changed": ["src/user/roles.ts", "tests/user/roles.test.ts"],
  "summary": "Add missing scope fallback for custom user roles and test the null role case.",
  "evidence": {
    "failing_command": "npm run typecheck",
    "failing_artifact_id": "artifact_typecheck_031",
    "patch_artifact_id": "artifact_patch_445"
  },
  "decision_options": ["approve", "reject", "request_changes"]
}
```

This packet keeps the reviewer focused. It names the PR, head SHA, changed paths, action, risk, summary, and evidence. The patch itself is stored as an artifact. The reviewer can inspect it in a normal code review UI.

After approval, run hooks should re-check time-sensitive facts. The branch head SHA may have changed while the approval was pending. A dependency file may have changed. A protected path may have appeared in the patch artifact after generation. Revalidation after approval is a key habit because approval is a pause, and the world can change during a pause.

![ReviewDock approval packet, audit log, and rollback lane](/content-assets/articles/article-mlops-llmops-hooks-and-sandboxes/approval-audit-rollout-reviewdock.png)

*Approval packets, patch artifacts, head-SHA checks, audit logs, and rollback-ready agent versions keep ReviewDock changes reviewable.*

## Audit Logs and Trace Metadata
<!-- section-summary: Sandboxed agent work needs traces for debugging and audit events for commands, policy decisions, approvals, patches, and final comments. -->

For code-review agents, traces help engineers understand how the agent behaved: which model ran, which tools were available, which commands ran, how long they took, which policy gates fired, and why the final comment said what it said. Audit events record the durable security story: who triggered the run, what code was inspected, which sandbox executed commands, which actions were blocked, which approvals were granted, and which artifacts were created.

OpenTelemetry GenAI conventions are useful for common model and tool fields, including workflow name, agent name, tool name, tool call ID, request model, response model, token usage, and tool results. Add product-specific attributes for repository, pull request, commit SHA, sandbox ID, and policy decision.

A trace span for a shell command can look like this:

```json
{
  "trace_id": "tr_review_9912",
  "span_name": "sandbox.shell_command",
  "attributes": {
    "gen_ai.workflow.name": "code_review_agent",
    "gen_ai.agent.name": "ReviewDock",
    "gen_ai.tool.name": "shell",
    "gen_ai.tool.call.id": "call_shell_031",
    "repo.name": "rivergate/api",
    "pull_request.number": 4821,
    "git.head_sha": "8c7ab21",
    "sandbox.runtime_class": "gvisor",
    "command.exit_code": 2,
    "command.duration_ms": 18421
  }
}
```

An audit event for a blocked command can look like this:

```json
{
  "event_id": "audit_review_7201",
  "event_type": "agent.command.blocked",
  "occurred_at": "2026-07-05T18:05:42Z",
  "actor": {
    "type": "agent",
    "id": "reviewdock-code-review-agent"
  },
  "run": {
    "run_id": "review_run_9912",
    "trace_id": "tr_review_9912"
  },
  "repository": {
    "name": "rivergate/api",
    "pull_request": 4821,
    "head_sha": "8c7ab21"
  },
  "tool": {
    "name": "shell",
    "tool_call_id": "call_shell_044"
  },
  "policy": {
    "name": "reviewdock-command-policy",
    "decision": "block",
    "reason": "blocked_token:curl"
  },
  "sandbox": {
    "provider": "kubernetes",
    "runtime_class": "gvisor",
    "job": "reviewdock-run-9912"
  }
}
```

For final review comments, keep the evidence chain. If the agent says a test failed, the trace should point to the command result artifact. If the agent proposes a patch, the approval event should point to the patch artifact and reviewer decision. If the agent blocks itself from reading a protected file, the audit event should show the path policy.

## Practical Checks, Common Mistakes, and Interview Readiness
<!-- section-summary: A safe code-review agent can explain every command, file access, policy decision, approval, sandbox boundary, and artifact. -->

Before shipping a code-review agent, check these items:

- Does every run create an isolated workspace with bounded CPU, memory, disk, and time?
- Does the sandbox receive only the files and credentials it needs?
- Are shell commands checked against an allowlist and blocked-token list before execution?
- Is network egress disabled or routed through an approved gateway?
- Are protected paths blocked or routed to human approval?
- Are stdout and stderr truncated and scanned before reaching the model?
- Are patch proposals stored as artifacts and reviewed before application?
- Does approval re-check the branch head SHA and policy rules before continuing?
- Do audit events record commands, blocks, approvals, sandbox IDs, and artifacts?
- Can an engineer trace the final review comment back to tests, files, and tool calls?

Common mistakes are predictable. Teams give the agent a normal developer shell with broad credentials. They let the agent install random packages from the internet during review. They treat final comments as harmless text and skip output scanning. They approve a patch once, then apply it after the branch changed. They log huge command output into traces and accidentally store secrets. Each mistake has the same fix shape: define the boundary, enforce it in hooks, run risky work in a sandbox, and record evidence.

For interview-ready understanding, say it this way: hooks are the lifecycle checkpoints where the harness validates, blocks, redacts, logs, or pauses. Sandboxes are the limited compute environments where risky model-directed work runs. A production code-review agent uses both: hooks enforce policy around every tool and command, while the sandbox isolates file and shell execution from trusted systems. Human approval handles lasting changes, and audit logs make every action explainable later.

## References

- [OpenAI Agents SDK guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
- [OpenAI Agents SDK human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/)
- [OpenAI sandbox agents guide](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [OpenAI shell tool guide](https://developers.openai.com/api/docs/guides/tools-shell)
- [OpenAI code interpreter guide](https://developers.openai.com/api/docs/guides/tools-code-interpreter)
- [OpenAI skills safety guidance](https://developers.openai.com/api/docs/guides/tools-skills)
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
- [Model Context Protocol tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [Kubernetes RuntimeClass](https://kubernetes.io/docs/concepts/containers/runtime-class/)
- [gVisor overview](https://gvisor.dev/docs/)
- [gVisor Kubernetes quick start](https://gvisor.dev/docs/user_guide/quick_start/kubernetes/)
- [gVisor containerd quick start](https://gvisor.dev/docs/user_guide/containerd/quick_start/)
- [GKE Sandbox guide](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/sandbox-pods)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
