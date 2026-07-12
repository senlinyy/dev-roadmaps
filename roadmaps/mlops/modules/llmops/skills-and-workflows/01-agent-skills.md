---
title: "Agent Skills"
description: "Package reusable instructions, scripts, references, evaluation checks, and rollout rules so agents can perform repeatable work with less drift."
overview: "Learn how a document-review team turns an expert legal workflow into versioned agent skills with tool access, evaluation cases, rollout gates, and reviewer-friendly validation."
tags: ["MLOps","LLMOps","advanced","skills"]
order: 1
id: "article-mlops-llmops-agent-skills"
---

## What Agent Skills Are

<!-- section-summary: Agent skills package repeatable instructions and supporting files so an agent can load the right workflow at the right time. The goal is consistency: the same review task should use the same policy, tool access, examples, and validation checks across many runs. -->

An **agent skill** is a reusable folder of instructions and supporting material that an agent can load when a task matches the skill. In plain English, it is the difference between telling an agent "review this contract" every time and giving the agent a maintained playbook called `vendor-contract-review` that says how to review the contract, which references to read, which tools it may use, what output shape to produce, and which checks must pass before the result is ready.

We will use **Clearpath Legal**, a fictional company that reviews vendor agreements for mid-size software teams. Clearpath has lawyers, procurement specialists, and security reviewers. They receive contracts in messy forms: PDFs from vendors, redlines from customers, exported Word documents, and security addenda. The first internal agent was useful in demos, yet each reviewer kept pasting a slightly different prompt. One person asked for liability caps first. Another asked for privacy terms first. A third forgot to require source citations. The output varied too much for production review.

Skills solve that repeatability problem. Clearpath writes a skill for one job: **review a vendor contract before procurement approval**. The skill says what to inspect, how to use the document tools, what evidence to cite, how to label risk, and how to format the review packet for a human. The agent still uses a model, reads the task, and makes judgment calls, yet the workflow comes from a versioned package rather than a one-off prompt.

The useful way to think about a skill is as **operational knowledge in source control**. It can include a `SKILL.md` file, reference guides, scripts, templates, and test cases. The skill travels with the team process. When the legal team updates its privacy threshold or adds a new clause checklist, they update the skill and review it like any other production artifact.

## The Pieces Inside A Skill

<!-- section-summary: A production skill usually has a small trigger description, clear task steps, optional references, optional scripts, and validation examples. Keep the main instructions focused so the agent loads enough context to work without carrying a whole policy library into every run. -->

The open Agent Skills format and Codex skill guidance both use a simple shape: a skill is a directory with a `SKILL.md` file, and the `SKILL.md` file contains YAML frontmatter plus Markdown instructions. The frontmatter includes at least `name` and `description`. The description matters because the agent sees it early and uses it to decide whether to load the full skill.

Clearpath starts with a folder like this:

```markdown
vendor-contract-review/
├── SKILL.md
├── references/
│   ├── risk-taxonomy.md
│   ├── privacy-addendum-guide.md
│   └── fallback-clauses.md
├── scripts/
│   ├── extract_clauses.py
│   └── validate_review_packet.py
├── templates/
│   └── review-packet.md
└── tests/
    ├── safe-mutual-nda.json
    ├── risky-data-processing-addendum.json
    └── unsupported-jurisdiction.json
```

The main file stays readable. It should tell the agent when to use the skill, what inputs to expect, which steps to follow, where to find deeper references, and how to validate the output. The references folder holds longer material that the agent reads only when needed. Scripts handle deterministic work such as text extraction, schema validation, or clause counting. Templates make the output shape familiar for human reviewers.

Here is a compact `SKILL.md` outline for Clearpath:

```markdown
---
name: vendor-contract-review
description: Review vendor contracts, DPAs, NDAs, and procurement agreements for legal, privacy, security, and commercial risk before approval.
metadata:
  owner: clearpath-legal-ops
  version: "2026.07.0"
  review_queue: legal-ai-change-board
  risk_level: high
compatibility: Requires document extraction tools, citation support, and access to approved legal reference files.
---

# Vendor Contract Review

Use this skill when the user asks for a first-pass review of a vendor contract,
security addendum, data processing addendum, NDA, or procurement agreement.

## Inputs

- Contract text or extracted document sections
- Vendor name and business owner
- Contract type
- Jurisdiction, if known
- Purchase amount or renewal amount, if known

## Workflow

1. Confirm document type and missing inputs.
2. Extract clauses for payment, renewal, termination, liability, indemnity, data processing, security, audit, confidentiality, and governing law.
3. Compare clauses against `references/risk-taxonomy.md`.
4. Flag missing or unusual terms with cited evidence.
5. Produce the review packet using `templates/review-packet.md`.
6. Run `scripts/validate_review_packet.py` before returning final output.

## Output

Return a Markdown review packet with risk level, cited findings, required human decisions, and recommended negotiation language.
```

This is already better than a raw prompt because it has ownership, versioning, references, workflow steps, and validation. It also names the scope. A procurement contract review skill should avoid drifting into unrelated work such as drafting a litigation memo or giving country-specific legal advice without the right references and reviewer.

![Clearpath agent skill package](/content-assets/articles/article-mlops-llmops-agent-skills/clearpath-skill-package.png)
*Clearpath treats a skill as a versioned package with instructions, references, tool boundaries, output schema, and eval cases.*

## Tool Access Needs A Contract

<!-- section-summary: Skills should declare the tools they expect and the boundaries around those tools. Document extraction, search, citation, and issue creation are useful, while write actions need approval and audit fields. -->

A skill by itself is instructions. Production work usually needs tools too. Clearpath's review agent needs to extract text from documents, search approved policy references, quote source sections, open a review ticket, and maybe draft a vendor email. Those capabilities should have clear contracts because tool access is where an agent can touch real systems.

The skill should say which tools are allowed, what each tool is for, and which actions need approval. Tool access may come from application functions, hosted tools, MCP servers, or internal APIs. MCP is useful when a team wants a standard way to expose tools and resources from systems such as document stores, contract repositories, ticketing tools, or policy databases.

Clearpath uses a document MCP server with read-only tools for extraction and a separate workflow API for side effects. The skill includes a tool access block like this:

```yaml
tool_access:
  read_tools:
    extract_document_text:
      purpose: "Read uploaded contract text with page and paragraph anchors."
      allowed_inputs: ["pdf", "docx", "markdown"]
      required_output_fields: ["document_id", "sections", "citations"]
    search_legal_references:
      purpose: "Search approved internal playbooks and fallback clauses."
      allowed_collections: ["risk-taxonomy", "privacy-addendum", "fallback-clauses"]
    compare_clause_versions:
      purpose: "Compare vendor text with approved fallback language."
  approval_required_tools:
    create_review_ticket:
      approver: "legal_ops_reviewer"
      idempotency_key: "contract_id + skill_version + review_type"
    draft_vendor_email:
      mode: "draft_only"
      approver: "assigned_attorney"
  blocked_tools:
    - "send_vendor_email"
    - "approve_contract"
    - "modify_source_document"
```

This block teaches the agent and the platform the same boundary. Extraction and approved-reference search can run during the review. Creating tickets and drafting vendor email require a workflow gate. Contract approval stays outside the skill. A human attorney or authorized procurement owner makes that decision.

The tool result shape also matters. A contract review agent should cite exact document sections. If the extraction tool returns loose text without page numbers or section IDs, the reviewer cannot verify the finding quickly. Clearpath asks extraction tools to return stable anchors:

```json
{
  "document_id": "doc_vendor_8127",
  "section_id": "sec_14_limitation_of_liability",
  "page": 9,
  "heading": "Limitation of Liability",
  "text": "Vendor's total liability shall not exceed fees paid in the previous one month.",
  "confidence": 0.94
}
```

The review packet can then say, "Liability cap is one month of fees, which is below Clearpath's standard fallback for this purchase tier. Source: `doc_vendor_8127`, page 9, `sec_14_limitation_of_liability`." That is the level of evidence a human reviewer can use.

![Clearpath skill tool access boundary](/content-assets/articles/article-mlops-llmops-agent-skills/clearpath-tool-access-boundary.png)
*The skill separates read tools from approval-required actions and blocked actions, so contract review can gather evidence without silently changing business state.*

## Versioning Turns A Prompt Into An Artifact

<!-- section-summary: Skills need version metadata because policy, tools, tests, and rollout status change over time. Treat skill updates like production changes: review the diff, evaluate behavior, and keep the old version available during rollout. -->

Once a skill affects real work, it needs versioning. Versioning answers simple operational questions. Which instruction set reviewed this contract? Which references were loaded? Which test set passed? Which tool permissions were active? Which reviewer approved the skill change?

Clearpath stores skill metadata in frontmatter and in a separate release file. The frontmatter gives the agent enough information at runtime. The release file gives operations and compliance teams a richer audit trail.

```yaml
skill:
  name: vendor-contract-review
  version: "2026.07.0"
  owner: clearpath-legal-ops
  status: candidate
  previous_version: "2026.06.2"
  change_type: policy-update
  reviewers:
    - legal: maya.chen
    - privacy: omar.patel
    - mlops: erin.wu
  references:
    risk-taxonomy: "2026.07.0"
    privacy-addendum-guide: "2026.06.1"
    fallback-clauses: "2026.07.0"
  tools:
    document-mcp: "v3.4.1"
    workflow-api: "v2.8.0"
  evaluations:
    dataset: "contract-review-evals-2026-07"
    required_pass_rate: 0.92
    blocked_failure_count: 0
```

This metadata lets Clearpath trace a review packet back to a skill release. If a reviewer later asks why the agent flagged a data retention clause, the team can inspect the exact skill version, reference version, and evaluation set.

Use simple version rules. A documentation-only wording fix can be a patch. A new clause category or new output schema can be a minor version. A change that affects approval rules, tool access, or risk labels deserves a release note and a stronger evaluation pass. Keep previous versions available while a new version rolls out, especially when current review tickets may still reference old outputs.

## Evaluation Before Rollout

<!-- section-summary: A skill should pass realistic examples before it handles live work. The evaluation set should cover normal contracts, tricky clauses, missing text, tool failures, prompt injection, and reviewer expectations. -->

Clearpath tests the skill before production rollout. The first mistake many teams make is testing only happy paths. A legal review skill needs examples that stress the exact ways the workflow can fail: missing pages, low extraction confidence, vendor instructions hidden inside the document, unsupported jurisdictions, confusing renewal terms, and clauses that require a human decision.

The evaluation cases are small JSON files. Each case includes the task, document fixture, expected findings, blocked actions, and reviewer notes.

```json
{
  "case_id": "risky-data-processing-addendum",
  "skill": "vendor-contract-review",
  "skill_version": "2026.07.0",
  "input": {
    "vendor": "Atlas Forms",
    "contract_type": "Data Processing Addendum",
    "purchase_amount_usd": 85000,
    "document_fixture": "fixtures/atlas-forms-dpa.md"
  },
  "expected": {
    "risk_level": "high",
    "must_find": [
      "subprocessor notice period below policy threshold",
      "data deletion deadline missing",
      "audit rights limited to vendor summary report"
    ],
    "must_cite_sections": true,
    "must_require_human_review": true,
    "must_not_call_tools": ["approve_contract", "send_vendor_email"]
  },
  "reviewer_notes": "The answer should give negotiation language, yet final approval stays with legal."
}
```

The validation script checks the output schema and some deterministic rules. It cannot judge every legal nuance, yet it can catch missing citations, missing risk labels, unsupported actions, or failure to request human review.

```yaml
validation_checklist:
  output_shape:
    - "Risk level is one of low, medium, high, blocked."
    - "Every finding has a source citation with document_id and section_id."
    - "Every recommended action has an owner."
  safety:
    - "The agent did not approve, reject, or modify the contract."
    - "The agent did not send external email."
    - "The agent flagged low-confidence extraction."
  legal_review:
    - "High-risk findings include why the clause matters."
    - "Negotiation language cites approved fallback clauses."
    - "Unsupported jurisdiction routes to human review."
  observability:
    - "Review packet includes skill_version."
    - "Review packet includes trace_id."
    - "Tool calls include idempotency keys where side effects are requested."
```

Then human reviewers inspect a sample of runs. They look for practical quality: Did the agent explain risk in language a procurement manager can use? Did it over-flag normal clauses? Did it miss hidden auto-renewal language? Did it cite the right passage? Did it preserve uncertainty when extraction was weak?

OpenAI's agent evaluation guidance recommends moving from trace inspection during debugging to repeatable datasets and evaluation runs when quality criteria are known. That same sequence fits skills well. First inspect traces to see whether the agent loaded the right references and used the right tools. Then run the skill against a dataset each time the instructions, references, model, or tools change.

## Safe Rollout In Production

<!-- section-summary: Roll out skills gradually because a small instruction change can alter tool usage and reviewer workload. Start with shadow mode, compare against the previous version, then move to limited live use with clear rollback rules. -->

A skill rollout should look like a software rollout. Clearpath uses four stages.

| Stage | What happens | Exit criteria |
| --- | --- | --- |
| Draft | Legal ops edits the skill in a branch. | Required reviewers approve the diff. |
| Shadow | The new skill reviews historical or live copies without affecting workflow. | Evaluation pass rate meets threshold and reviewer disagreements stay within limit. |
| Limited live | A small queue uses the new skill for review packets. | No blocked failures, acceptable reviewer feedback, trace quality is clean. |
| Default | The new skill handles the normal queue. | Old version remains available for rollback during the retention window. |

Shadow mode is especially useful. The agent can review the same contract with `2026.06.2` and `2026.07.0`, and the team can compare outputs. If the new skill catches better privacy issues yet doubles the false-positive rate for liability clauses, the release needs adjustment before live reviewers see it.

The review gate should include people from the affected workflow. Legal approves clause policy. Privacy approves data processing guidance. MLOps approves evaluation coverage and trace metadata. Security approves tool access and MCP scopes. Procurement approves whether the packet is understandable for business owners.

Rollback needs a simple rule. Clearpath stores the skill version in every review packet and keeps old skill versions in source control. If `2026.07.0` creates bad outputs in production, the orchestrator can route new review jobs back to `2026.06.2` while engineers investigate. Existing packets keep their original `skill_version`, so nobody rewrites history by accident.

![Clearpath skill release loop](/content-assets/articles/article-mlops-llmops-agent-skills/clearpath-skill-release-loop.png)
*A skill release moves through evals, reviewer sampling, shadow mode, limited rollout, and rollback evidence like any other production change.*

## Skills In The Agent Runtime

<!-- section-summary: At runtime, the agent should load a skill because the task matches its description or because the user explicitly requests it. The runtime should record the selected skill, tool calls, trace ID, and validation result so operators can inspect the work later. -->

The runtime flow is straightforward. The user asks for a contract review. The agent runtime sees available skill metadata, selects `vendor-contract-review`, loads its `SKILL.md`, reads referenced files as needed, calls allowed tools, produces a packet, validates the packet, and returns a draft for human review.

Clearpath records a trace for every review. The trace links the user request, selected skill, skill version, reference files, model calls, tool calls, validation result, and final packet ID. Traces are valuable because reviewers often ask "why did the agent say this?" A trace lets the team inspect the path instead of guessing from the final answer.

```json
{
  "trace_id": "trace_contract_01JZK9Q6M8H0R1",
  "workflow": "vendor_contract_review",
  "skill": {
    "name": "vendor-contract-review",
    "version": "2026.07.0"
  },
  "input": {
    "contract_id": "ctr_8127",
    "vendor": "Atlas Forms",
    "review_type": "procurement_preapproval"
  },
  "tool_calls": [
    {
      "name": "extract_document_text",
      "status": "success",
      "document_id": "doc_vendor_8127"
    },
    {
      "name": "search_legal_references",
      "status": "success",
      "collection": "privacy-addendum"
    }
  ],
  "validation": {
    "status": "passed",
    "script": "scripts/validate_review_packet.py",
    "version": "2026.07.0"
  },
  "human_review": {
    "required": true,
    "queue": "legal-ai-change-board"
  }
}
```

Runtime records also help with skill maintenance. If traces show the agent reads `fallback-clauses.md` for every NDA review, that reference may belong in the main workflow or a smaller NDA-specific skill. If the agent never uses a long privacy appendix, the description or routing rules may be unclear. Treat traces as feedback for the skill design.

## Practical Checks, Mistakes, And Interview-Ready Understanding

<!-- section-summary: A good skill is specific, versioned, tested, observable, and owned by the team that understands the workflow. The strongest interview answer explains skills as production artifacts, not clever prompts. -->

Before you call an agent skill production-ready, check these points:

- The skill answers one clear job and has a concise trigger description.
- The frontmatter includes owner and version metadata.
- The workflow steps match how the human team already reviews work.
- References stay focused and load only when useful.
- Tool access is explicit, scoped, and separated into read tools and approval-required actions.
- Outputs have a schema or template that humans can review quickly.
- Evaluation cases cover normal, risky, missing-input, tool-failure, and prompt-injection scenarios.
- Traces record skill name, skill version, reference versions, tool calls, validation results, and human review status.
- Rollout uses draft, shadow, limited live, and default stages.
- Rollback can route new jobs to the previous skill version without rewriting old packets.

Common mistakes are easy to recognize. A skill that says "review contracts carefully" is only a prompt with a filename. A skill that bundles hundreds of pages into `SKILL.md` wastes context and hides the actual workflow. A skill that can call write tools without approval will scare every reviewer in the room. A skill without evaluation cases will drift quietly until a bad output reaches a live workflow.

For interviews, say it this way: **agent skills turn repeatable expert work into versioned, testable, observable instruction packages**. They help teams reuse workflows, control tool access, run evaluations, and roll changes out safely. The production value comes from the surrounding discipline: ownership, references, tool contracts, traces, review gates, and rollback.

## References

- [OpenAI Codex: Agent Skills](https://developers.openai.com/codex/skills)
- [Agent Skills Specification](https://agentskills.io/specification)
- [OpenAI API: Agents SDK Overview](https://developers.openai.com/api/docs/guides/agents)
- [OpenAI API: MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Model Context Protocol: Tools Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [OpenAI API: Evaluate Agent Workflows](https://developers.openai.com/api/docs/guides/agent-evals)
