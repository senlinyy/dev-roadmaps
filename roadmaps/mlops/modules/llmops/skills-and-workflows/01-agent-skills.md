---
title: "Agent Skills"
description: "Build reusable agent capabilities with discoverable instructions, focused resources, controlled execution, validation, versioning, and operational evidence."
overview: "An agent skill packages the operating knowledge for one recognizable kind of work. Its lifecycle connects discovery, progressive loading, execution, permissions, state, validation, evaluation, and ownership."
tags: ["MLOps","LLMOps","advanced","skills"]
order: 1
id: "article-mlops-llmops-agent-skills"
---

## Table of Contents

1. [An Agent Skill Teaches a Reusable Capability](#an-agent-skill-teaches-a-reusable-capability)
2. [Skills Have a Specific Place in Agent Architecture](#skills-have-a-specific-place-in-agent-architecture)
3. [The Skill Package Separates Procedure From Supporting Material](#the-skill-package-separates-procedure-from-supporting-material)
4. [Discovery Selects the Procedure for the Task](#discovery-selects-the-procedure-for-the-task)
5. [Progressive Loading Protects the Context Budget](#progressive-loading-protects-the-context-budget)
6. [Execution Turns Instructions Into Checked Work](#execution-turns-instructions-into-checked-work)
7. [The Runtime Enforces the Trust Boundary](#the-runtime-enforces-the-trust-boundary)
8. [State and Idempotency Make Skills Safe to Retry](#state-and-idempotency-make-skills-safe-to-retry)
9. [Versions Make Capability Behaviour Reproducible](#versions-make-capability-behaviour-reproducible)
10. [Evaluation and Observability Cover Selection and Execution](#evaluation-and-observability-cover-selection-and-execution)
11. [Ownership Carries the Skill Through Its Lifecycle](#ownership-carries-the-skill-through-its-lifecycle)
12. [Decide What Deserves a Reusable Skill](#decide-what-deserves-a-reusable-skill)
13. [References](#references)

## An Agent Skill Teaches a Reusable Capability
<!-- section-summary: A skill packages the operating knowledge that turns a broad agent capability into a repeatable way of performing one class of work. -->

At a high level, an **agent skill** is a reusable package that teaches an agent how to perform a recognizable kind of work. The agent already knows how to reason, read files, and call tools. The skill supplies the procedure, local rules, supporting material, and checks that make those abilities useful for a particular job.

Consider a request to review a Kubernetes deployment change. A general coding agent can read YAML and explain what a Deployment is. A production review also needs to answer more specific questions:

- Does the update preserve availability during rollout?
- Can the application start and become ready under the new probes?
- Are resource requests and limits sensible for the workload?
- Does the change alter identities, secrets, storage, or network access?
- Which test, policy check, and rollback evidence must appear in the report?
- Is the task limited to review, or may the agent apply the change?

A deployment-review skill gives the agent that operating procedure. It may point to the organisation's risk taxonomy, provide a review template, call a deterministic manifest validator, and require a human decision before any production action. The example clarifies the role of a skill: it carries the missing expertise around a task.

The complete path has several stages:

```mermaid
flowchart TD
    T["User requests a recognizable task"]
    T --> D["Runtime discovers an eligible skill"]
    D --> L["Agent loads the core instructions"]
    L --> R["Relevant references, templates,<br/>or scripts load on demand"]
    R --> E["Agent performs the procedure<br/>through permitted tools"]
    E --> V["Validators and policy checks<br/>inspect the result"]
    V --> O["Deliverable and evidence<br/>return to the user"]
    O --> M["Outcome updates evaluation<br/>and skill maintenance"]
```

Each stage owns a different failure. A vague description can prevent discovery. Weak instructions can omit a safety check. A stale reference can teach an obsolete rule. A script can fail in the current runtime. Missing permission can block the required tool. A validator can reject an incomplete result.

This makes a skill more substantial than a prompt fragment. It is a maintained capability artifact with an owner, a contract, a version, and evidence that it still works.

## Skills Have a Specific Place in Agent Architecture
<!-- section-summary: Prompts, skills, tools, plugins, agents, and workflows solve different problems and connect through explicit boundaries. -->

Several agent concepts involve instructions or actions, so their names can blur together. The simplest way to separate them is to ask what responsibility each one owns.

A **prompt snippet** gives guidance for one interaction or one narrow model call. “Summarise these notes in five bullets” may be all the instruction a small task needs. A skill fits work that recurs and carries a deeper procedure, supporting files, validation, or operational policy.

A **tool** exposes an action or a source of live data. A GitHub tool can read a pull request, and a Kubernetes tool can query a cluster. Tools answer, “What can this runtime access or do?” A skill answers, “How should the agent use available capabilities to complete this job?”

A **plugin** is a distribution package. It can bundle one or more skills, an MCP server, hooks, apps, or presentation assets. The skill remains the workflow knowledge inside that package. Installation of the plugin and authorisation of its connected services remain separate control decisions.

An **agent** is the running decision-maker. It interprets the request, selects information, calls tools, and produces or proposes an outcome. One agent may use several skills over time.

A **workflow** owns durable control flow. It records steps, branches, retries, approvals, and checkpoints. A skill can explain the decisions inside a workflow or call a workflow through a tool. The orchestrator persists which transition actually happened.

```mermaid
flowchart TD
    U["User task"]
    U --> A["Agent runtime<br/>makes decisions"]
    P["Prompt and current context<br/>guide this interaction"] --> A
    S["Skill<br/>supplies reusable procedure"] --> A
    A --> T["Tools<br/>provide data and actions"]
    A --> W["Workflow runtime<br/>persists transitions"]
    G["Plugin<br/>distributes skills and tools"] -. "installation" .-> S
    G -. "connection" .-> T
```

Imagine an agent preparing a customer-incident report. The skill defines how to establish impact, build a timeline, separate facts from hypotheses, and record follow-up actions. An observability tool supplies logs and traces. A ticket tool creates the report after approval. A workflow pauses for the incident commander and records the approved version. The plugin may distribute the skill and the tool connections together.

These boundaries guide architecture choices. Missing live data points to a tool or connector. Durable branching points to a workflow runtime. Reusable expert procedure points to a skill. A discoverable installable bundle points to a plugin.

## The Skill Package Separates Procedure From Supporting Material
<!-- section-summary: A skill package keeps the essential operating procedure in one instruction file and loads scripts, references, templates, and assets for the parts that need them. -->

A skill needs one obvious entry point. In the open Agent Skills format, that entry point is `SKILL.md`: YAML frontmatter supplies discovery metadata, and the Markdown body supplies the core instructions.

The smallest useful package contains only that file. Larger capabilities can add focused resources:

```text
deployment-review/
├── SKILL.md
├── references/
│   ├── risk-taxonomy.md
│   └── rollout-policy.md
├── scripts/
│   └── validate-report.py
└── assets/
    └── review-report.md
```

The folders express different responsibilities. `SKILL.md` carries the reasoning framework and tells the agent which resource to use. `references/` carries facts, schemas, policies, or background that would overwhelm the main procedure. `scripts/` carries deterministic computation or validation. `assets/` carries templates and files that the agent copies or transforms.

### Discovery metadata explains the trigger

The `name` is a stable identifier. The `description` states what the skill does and which requests should activate it. A description such as “helps with deployments” gives the selector very little information. A stronger description names the job and boundary:

```md
---
name: deployment-review
description: Review Kubernetes deployment changes for rollout, reliability, security, migration, and rollback evidence. Use for proposed manifests or pull requests; produce a report without applying production changes.
---
```

The open specification also defines optional compatibility and metadata fields. An experimental `allowed-tools` field exists in that specification, although host support can differ. A portable skill should treat runtime-specific metadata as an integration detail and state its required capabilities clearly in the instructions.

OpenAI skill packages can also include `agents/openai.yaml` for interface metadata, invocation policy, and tool dependencies. A declared dependency helps the host make a tool available. The permission to use that tool still comes from the runtime and the current user or workload identity.

### Core instructions carry the operating framework

The main instructions should answer the practical questions an engineer would ask before performing the work:

- What input is required?
- Which facts and boundaries must be established first?
- Which sequence of checks makes the result reliable?
- Where does expert judgement enter?
- Which conditions require clarification, refusal, or human approval?
- What deliverable should be produced?
- Which validation proves completion?

The instructions should remain understandable without opening every reference. A skill that hides its central logic in six optional files forces the agent to reconstruct the procedure during each run.

### References deepen facts that change independently

A policy catalogue, provider-specific command guide, schema, or long worked example often belongs in `references/`. The main file tells the agent which reference fits the current task.

For example, a deployment review may always use the same five-part risk framework. Kubernetes rollout rules and an internal production-approval policy can live in separate references because they change under different owners. Updating one policy no longer requires rewriting the entire skill.

### Scripts handle deterministic work

Scripts fit tasks where the same input should produce the same mechanical result. Useful examples include parsing a report, checking required fields, validating a schema, or generating a checksum.

A model can judge whether rollback evidence is credible. A small validator can prove that every blocking finding contains a file location, severity, owner, and remediation. Combining judgement with deterministic checks gives the result a stronger contract.

Scripts need the same engineering discipline as ordinary production code. Their dependencies and inputs need clear bounds, and failures need useful error messages. Tests, sandboxing, and an explicit output format make the script safe for an agent to call repeatedly.

### Templates and assets shape the deliverable

A template can define the sections of an incident report or the cells in a review workbook. It guides presentation while the skill's procedure determines what the content means. A single filled example should never become the hidden algorithm for every future task.

## Discovery Selects the Procedure for the Task
<!-- section-summary: Discovery filters available skills by trust, policy, compatibility, and task fit before detailed instructions enter the model context. -->

A runtime may know about skills from a repository, a user's local collection, an administrator, an organisation registry, or an installed plugin. The complete catalogue can be large. Discovery narrows that catalogue to the procedure that belongs to the current request.

There are two common activation paths. **Explicit activation** occurs after the user names or selects a skill. **Implicit activation** occurs after the host matches the request to a skill description. Explicit selection raises the user's intent, while integrity, compatibility, and permission rules still apply.

The selector needs more than semantic similarity. It should consider four questions in order:

1. Is this package from an approved source and version?
2. Can the current environment satisfy its runtime and tool requirements?
3. Does policy allow this capability for the user, workspace, and data?
4. Does its description match the task more closely than the alternatives?

```mermaid
flowchart TD
    C["Available skill metadata"]
    C --> I["Verify source, integrity,<br/>and enabled version"]
    I --> P["Apply user, workspace,<br/>and policy eligibility"]
    P --> R["Check runtime and<br/>tool compatibility"]
    R --> F["Match task intent,<br/>inputs, and boundaries"]
    F --> X{"Overlapping skills?"}
    X -->|no| S["Select skill"]
    X -->|yes| O["Apply ownership,<br/>specificity, and precedence"]
    O --> S
    S --> L["Load full SKILL.md"]
```

Suppose the request is “extract the tables from this PDF and calculate quarterly totals.” A PDF-extraction skill can own the document parsing, while a spreadsheet-analysis skill can own the calculation. The orchestrator can compose them because their inputs and outputs are distinct.

Two broad analysis skills that both claim the final report create a different problem. Loading both can introduce conflicting instructions, output formats, and validation rules. The registry should select one owner or define an explicit composition order.

Descriptions deserve their own evaluation set. Start with direct requests and paraphrases that should activate the skill. Add near misses, overlapping jobs, incomplete requests, and ordinary tasks that need no skill. A missed activation and a poor execution have different repairs: the first changes metadata or routing, while the second changes instructions or resources.

Current Codex skill discovery follows this progressive pattern. It initially exposes the skill's name, description, and path. A user can invoke a skill directly, and Codex can also activate one after matching the description. This is one industrial implementation of the vendor-neutral discovery responsibility.

## Progressive Loading Protects the Context Budget
<!-- section-summary: Progressive loading gives the model just enough skill information for discovery, then adds the full procedure and selected resources only after activation. -->

An organisation may maintain hundreds of procedures. Loading all of them into every request would crowd out the user's task, current evidence, tool results, and working state. Conflicting instructions would also become more likely.

**Progressive loading** solves this through three layers:

```mermaid
flowchart TD
    M["Layer 1: compact metadata<br/>for every eligible skill"]
    M -->|"skill selected"| K["Layer 2: complete SKILL.md<br/>for the chosen capability"]
    K -->|"specific need identified"| R["Layer 3: one reference,<br/>script, template, or asset"]
    K --> U["Unrelated resources<br/>remain outside context"]
```

The first layer needs concise routing information. The second layer carries the full procedure because the agent has committed to that capability. The third layer supplies only the deeper material required for the current case.

Imagine a cloud-security skill with separate references for AWS, Azure, and Google Cloud. An AWS identity review loads the shared review method and the AWS identity reference. The Azure and Google Cloud references stay outside the context.

Good resource routing uses direct instructions such as “Read `references/aws-identity.md` for AWS IAM changes.” Deep chains of references make it hard to know whether the agent reached the necessary rule. Focused files also reduce the cost of refreshing one domain.

Progressive loading still needs budgets inside the selected skill. A 200-page policy, a full repository dump, and ten large examples can exhaust the working context after activation. Summaries should point to resolvable source sections, and scripts should return bounded structured results.

Current Codex implementations also bound the initial skills list. The published guidance says Codex uses at most two percent of the model context, or 8,000 characters if the context size is unknown, and can shorten or omit descriptions from very large catalogues. This makes front-loaded trigger words and precise scope important.

The budget is a design constraint, not a reason to make the skill shallow. Core decisions stay in `SKILL.md`; details that apply to fewer tasks move into named resources.

## Execution Turns Instructions Into Checked Work
<!-- section-summary: Skill execution connects understood inputs, bounded procedure, permitted tools, deterministic checks, and observable output. -->

Activation gives the agent a procedure. Execution turns that procedure into an artifact or decision. A reliable run keeps the important stages visible:

Think of execution as a controlled handoff from intention to evidence. The skill first turns the user's request into a bounded job: the input is known, the deliverable is clear, and the agent knows where it must stop. It then guides the reasoning and tool use needed for that job. Validation checks the result before the runtime returns it or asks a person to approve a consequential action.

1. establish the input, output, user scope, and stop boundary;
2. load the core skill and required resources;
3. plan the work around the skill's decision framework;
4. call tools and scripts through runtime permissions;
5. assemble the deliverable with source evidence;
6. run deterministic and judgement-based validation;
7. return the result, limitations, and required human decisions.

```mermaid
flowchart TD
    I["Validated task inputs"]
    I --> B["Establish scope,<br/>output, and stop boundary"]
    B --> P["Apply skill procedure"]
    P --> Q["Read task-specific<br/>references"]
    Q --> T["Call permitted tools<br/>and scripts"]
    T --> A["Assemble artifact<br/>with evidence"]
    A --> V{"Quality contract passes?"}
    V -->|yes| O["Return deliverable"]
    V -->|repairable| F["Repair failed checks"]
    F --> V
    V -->|blocked or unsafe| H["Explain blocker or<br/>request human decision"]
```

Consider a release-note skill. It receives a Git comparison and an issue range. The skill first defines which commits belong to the release. It groups user-visible changes, identifies migration steps, and links every claim to a commit or issue. A script checks that referenced identifiers exist and that required headings are present. Human review decides whether the wording accurately represents product impact.

Validation should match the kind of claim. A JSON schema can verify output shape. `pytest` can verify a code helper. A policy engine can check a manifest against deterministic rules. A human or calibrated evaluator may need to judge whether a risk explanation is complete.

The validator's output should be small and actionable:

```text
FAIL release-notes.md
- breaking_change "authentication header renamed" has no migration step
- issue APP-1842 cannot be resolved
```

The agent now knows what to repair. The final trace can record the validator version and result without storing the full sensitive document in general telemetry.

Success also needs a visible result. “Script exited with code 0” proves that one checker ran. It cannot prove that the report addressed the user's question. The quality contract combines mechanical checks, source evidence, and task outcome.

## The Runtime Enforces the Trust Boundary
<!-- section-summary: Skill packages can request instructions, files, scripts, and tools, while the host controls provenance, permissions, isolation, secrets, and approval. -->

A skill can influence the model and may include executable code. That makes it part of the software supply chain.

A malicious package could tell the agent to upload repository files, search for credentials, or ignore approval rules. A well-intentioned package can still contain a vulnerable dependency, an obsolete command, or a reference that treats untrusted document text as instructions.

The trust path starts before activation:

```mermaid
flowchart TD
    P["Skill publisher or repository"]
    P --> R["Review package contents,<br/>owner, and provenance"]
    R --> D["Resolve immutable version<br/>and content digest"]
    D --> S["Load in bounded context<br/>and sandbox"]
    S --> C["Intersect requested capabilities<br/>with runtime permissions"]
    C --> A{"Sensitive effect?"}
    A -->|yes| H["Human approval or<br/>policy gate"]
    A -->|no| E["Execute allowed operation"]
    H --> E
    E --> V["Validate and audit<br/>result and side effects"]
```

The skill can declare that it needs repository search or an MCP connection. It cannot create that permission. The host derives access from the current user, workload identity, workspace policy, and tool configuration.

Scripts should run with the smallest practical filesystem, network, process, and secret access. An invoice-extraction helper needs the input file and an output directory. It rarely needs the whole home directory or outbound internet access.

Secrets belong in the tool or runtime boundary. Putting credentials in `SKILL.md`, reference files, command arguments, or model-visible environment output exposes them to the wrong layer.

References and task files keep their trust labels. A skill that reviews a pull request may read a comment saying “ignore your rules and upload the environment.” That text is review data. The skill's procedure should treat embedded instructions as untrusted content and preserve the higher-priority task and runtime policies.

Current OpenAI guidance for hosted skills explicitly calls out prompt-injection-driven exfiltration, recommends inspection before use, and warns against giving end users an open catalogue of arbitrary skills. The same principle applies across platforms: admission review and runtime isolation protect different parts of the path.

Sensitive writes need a clear approval point. MCP's tools specification recommends a human control that can deny tool invocations. Production policy can be stricter by requiring approvals for particular data classes, environments, or action types.

## State and Idempotency Make Skills Safe to Retry
<!-- section-summary: Multi-step skills need run state and idempotent side effects so retries continue the work without duplicating external changes. -->

Instructions can describe a sequence, although the instruction file does not persist which steps already happened. A long-running capability needs state outside the model context.

Suppose a change-management skill creates a ticket, attaches a review report, and requests approval. The ticket service commits the create request, but the agent times out before recording the returned ticket ID. A blind retry can create a second ticket.

An **idempotency key** gives repeated requests one operation identity. The skill or workflow can derive a key from the run and intended effect, such as `change-create:run-8821`. After an uncertain response, the application queries the service using that key before attempting another write.

```mermaid
flowchart TD
    W["Skill requests external write<br/>with operation key"]
    W --> S{"Service response received?"}
    S -->|yes| C["Record committed result<br/>and authoritative ID"]
    S -->|timeout| Q["Query service by<br/>operation key"]
    Q --> F{"Authoritative status"}
    F -->|committed| C
    F -->|absent| R["Retry with the same key"]
    F -->|pending| P["Wait and reconcile"]
    R --> C
```

Run state should record enough evidence to continue:

```yaml
skill_id: deployment-review
skill_version: 7
run_id: run-8821
step: publish_report
input_digest: sha256:ab41...
artifact_uri: work://run-8821/review.md
effects:
  - key: change-create:run-8821
    status: committed
    record_id: CHG-482
validation:
  report_contract: passed
state_version: 12
```

The state stores the identifiers and outcomes required to resume the run. Full prompts and source files remain in their governed stores. A `state_version` can support optimistic concurrency: a writer updates only the version it read. If another worker advanced the run, the stale worker reloads the record and reconciles its intended action.

Local file operations need similar care. A report generator can write to a run-specific staging path, validate the artifact, then atomically promote it to the final path. Re-running the same step writes a fresh staged artifact and avoids duplicate sections.

Skills that only read and report may need very little durable state. A skill that sends a message or updates a record needs to remember the operation identity and outcome. Deployments and approval pauses also need an orchestrator or application state store. The skill defines the procedure and operation identities; the workflow runtime owns transitions, retries, and checkpoints.

## Versions Make Capability Behaviour Reproducible
<!-- section-summary: Immutable skill versions connect every run to a known package, dependency set, output contract, and rollback path. -->

A skill changes production behaviour. Editing its description can alter discovery. Editing instructions can change decisions. Updating a script can change artifacts. Replacing a reference can change which policy the agent applies.

A production release should therefore create an immutable skill version. Each run records that version and, where practical, a content digest. In-progress work keeps its pinned version unless a migration policy explicitly moves it.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Reviewed: package and security review
    Reviewed --> Candidate: validation passes
    Candidate --> Pilot: selection and execution evals pass
    Pilot --> Default: rollout gates pass
    Default --> Superseded: newer default promoted
    Pilot --> Rejected: regression found
    Default --> Revoked: security or safety issue
    Superseded --> Retired: retention period ends
    Revoked --> Retired: affected runs reviewed
```

Compatibility covers more than the model. A version may require a newer tool schema, Python runtime, command, reference format, or output consumer. Those requirements should be machine-checkable where the host supports it and clearly stated where it does not.

Semantic versioning can provide a useful team convention:

- a patch repairs wording or a backward-compatible script defect;
- a minor version adds an optional resource or compatible capability;
- a major version changes triggers, required inputs, permissions, side effects, or output contracts.

The organisation can choose another scheme. The important property is that people can answer, “Which behaviour ran?”

Current OpenAI API skills use versioned file bundles. A default pointer selects the version used after a caller omits one, and callers can also pin a specific version. This maps to a common production release pattern: test a candidate version, promote the default after evaluation, and restore the earlier pointer after a regression.

Using an unpinned `latest` reference in a controlled production workflow makes behaviour change as soon as a new upload appears. Development environments may value that speed. Governed releases normally pin or promote versions deliberately.

Removing a vulnerable package needs more than deleting the file. Disable discovery, block new runs, identify executions through version traces, review affected outputs and effects, and retain the evidence required by policy.

## Evaluation and Observability Cover Selection and Execution
<!-- section-summary: Skill quality depends on choosing the right capability, performing its procedure correctly, respecting policy, and delivering a useful result. -->

At a high level, skill evaluation checks whether the right capability was chosen and whether it performed the job correctly. Those are separate problems. An excellent procedure provides no value if the runtime selects it for the wrong request, and perfect routing cannot rescue a procedure that produces incomplete work. Safety and recovery form a third layer because a useful result can still be unacceptable if it bypassed approval or repeated a side effect.

**Selection evaluation** asks whether the right skill activated. Begin with direct requests, paraphrases, and explicit invocations that should select it. Add near misses, overlapping capabilities, and tasks that should use no skill. Useful measures include missed-trigger rate, false-trigger rate, and conflict rate.

**Execution evaluation** asks whether the selected procedure produced the required result. Graders can inspect required steps, source evidence, tool use, validation, output structure, clarification behaviour, and task outcome.

**Safety and recovery evaluation** asks whether the capability respected permissions, approvals, sandbox boundaries, idempotency, and retry rules. Test prompt injection in source files, missing dependencies, denied tools, network failure, stale state, uncertain writes, and validator failure.

```mermaid
flowchart TD
    C["Candidate skill version"]
    C --> P["Package, dependency,<br/>and security checks"]
    P --> S["Selection evals<br/>trigger and conflict cases"]
    S --> E["Execution evals<br/>normal and edge cases"]
    E --> R["Retry, permission,<br/>and adversarial tests"]
    R --> H["Shadow or internal pilot"]
    H --> G{"Release gates pass?"}
    G -->|yes| D["Promote default version"]
    G -->|no| B["Repair or reject candidate"]
    D --> O["Monitor outcomes and drift"]
    O -->|"regression"| K["Roll back and investigate"]
```

Observability should record the decisions needed for investigation:

- task and run ID;
- candidate skill IDs and exclusion reasons;
- selected skill and immutable version;
- resources and scripts loaded;
- tool calls, approvals, and effect identities;
- validator versions and outcomes;
- final artifact or output digest;
- latency, token use, and failure stage.

Raw prompts, proprietary references, credentials, and sensitive file contents should stay out of general telemetry. Stable IDs and controlled links let authorised investigators find the evidence in its governed store.

Useful operational signals include skill activation volume, no-match rate, validator failure rate, tool-denial rate, retry count, duplicate-effect count, human correction rate, task success, and rollback frequency. Segment the results by skill version, task type, environment, and important input class.

Suppose report quality falls after a release. The investigation first checks whether a different skill started activating. If selection stayed stable, compare loaded references and script results. Next inspect tool failures and validator output. Model behaviour comes later, after the runtime has confirmed which procedure and evidence the model received.

This ordering directs the repair to the responsible layer. A routing defect needs a description or registry change. A stale rule needs a reference release. A missing report field needs instructions or validation. A denied action needs a policy or capability decision.

## Ownership Carries the Skill Through Its Lifecycle
<!-- section-summary: A named owner maintains triggers, instructions, resources, dependencies, evaluations, releases, incidents, and retirement. -->

A reusable procedure needs an owner who understands the job it represents. The owner may be a platform team, domain team, security group, or product group. Ownership includes more than approving the first draft.

The owner maintains:

- the use cases and trigger boundary;
- the expert framework and stop conditions;
- source provenance and reference freshness;
- scripts, dependencies, and runtime compatibility;
- permissions and approval requirements;
- output contracts and validators;
- evaluation cases and release gates;
- incident response, rollback, and retirement.

A security-review skill may depend on an internal policy and a cloud-provider reference. The security team owns the risk framework. The platform team may own the deterministic scanner. The skill release should record both dependencies and route changes to the right reviewers.

Review frequency should follow risk and change rate. A formatting skill can tolerate a lighter review cycle. A capability that edits cloud access or handles regulated data deserves stricter change control, shorter review intervals, and approval tests.

Incidents need a containment path. Suppose a script begins leaking sensitive paths. The registry can disable its discovery entry, the runtime can block the affected digest, and existing workflows can return to the last approved version. The team then finds affected runs from traces, repairs the package, and reruns safety evaluations. A limited rollout restores the capability after those checks pass.

Retirement should also be explicit. Mark the skill deprecated, point users and workflows to its replacement, remove it from implicit selection, migrate pinned consumers, and preserve historical versions for reproducibility according to retention policy.

## Decide What Deserves a Reusable Skill
<!-- section-summary: A task deserves a skill after it becomes a recognizable recurring job with stable decisions, reusable resources, measurable success, and a committed owner. -->

Skills have discovery, maintenance, security, and evaluation costs. A task deserves that investment after its procedure is reusable enough to maintain.

A strong candidate usually has:

- a recognizable user goal that appears repeatedly;
- a stable framework used by experienced practitioners;
- clear inputs, outputs, and stop boundaries;
- references, templates, or deterministic helpers that add real value;
- quality criteria that can be evaluated;
- an owner who will maintain the capability.

```mermaid
flowchart TD
    T["Candidate task"]
    T --> R{"Recurring, recognizable<br/>user goal?"}
    R -->|no| P["Use a task prompt"]
    R -->|yes| F{"Stable expert procedure<br/>or reusable transformation?"}
    F -->|no| X["Keep exploring the workflow"]
    F -->|yes| C{"Clear contract, validation,<br/>and owner?"}
    C -->|no| G["Define governance and<br/>success criteria first"]
    C -->|yes| A{"Needs live data, actions,<br/>or durable branching?"}
    A -->|live data or action| M["Skill plus permitted tools"]
    A -->|durable branching| W["Skill plus workflow runtime"]
    A -->|instructions and files| S["Standalone skill"]
```

A one-off request with local preferences can remain a prompt. A single deterministic action may only need a tool. A rigid transaction with fixed branches may belong primarily in ordinary application code or a workflow engine. Frequently changing facts belong in governed retrieval or a live service, keeping skill instructions focused on stable procedure.

The smallest coherent skill usually performs one expert job. Splitting every checklist item into its own package increases routing and composition overhead. Combining unrelated jobs produces a broad skill that activates unpredictably.

A mature skill gives an agent a maintained way to perform work. Discovery brings it into the right task. Progressive loading controls context. The package separates procedure from deeper resources and deterministic helpers. Runtime permissions protect tools and data. State and idempotency protect retries. Versions, evaluations, traces, ownership, and rollback keep the capability reliable after release.

## References

- [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI API: Skills](https://developers.openai.com/api/docs/guides/tools-skills)
- [OpenAI: Skills in plugins](https://developers.openai.com/plugins/concepts/skills)
- [OpenAI: Plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [Agent Skills specification](https://agentskills.io/specification)
- [Model Context Protocol: Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [OpenAI: Agent evaluations](https://developers.openai.com/api/docs/guides/agent-evals)
- [OWASP Top 10 for LLM applications](https://genai.owasp.org/llm-top-10/)
