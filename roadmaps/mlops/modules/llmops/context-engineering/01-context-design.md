---
title: "Context Design"
description: "Design the exact context a model sees at each step, including instructions, user facts, retrieved material, tool outputs, privacy boundaries, and budget controls."
overview: "Context design is the discipline of choosing what enters an LLM request, what stays outside, and how every context item earns its place."
tags: ["MLOps","LLMOps","production","context"]
order: 1
id: "article-mlops-llmops-context-design"
---
## What Context Design Means

<!-- section-summary: Context design is the process of deciding what the model can see for one step of work. The goal is to give the model enough useful context while keeping noise, cost, latency, and private data under control. -->

**Context design** means you decide what the model sees before it writes an answer, calls a tool, or takes the next step in an agent workflow. A model receives a context window, and that window can contain instructions, the user request, recent conversation, retrieved documents, tool definitions, tool results, memory, examples, and output-format rules. The model can only reason over what reaches that window, so context design has a direct effect on accuracy, cost, latency, privacy, and user trust.

In a small demo, you can paste a long prompt into a chat box and hope the model finds the useful part. In a production app, that approach breaks quickly. Some requests need privileged data. Some requests need a citation. Some requests need a tool call. Some requests need a short answer because the model must save room for the final response. Context design turns that messy pile into a repeatable assembly process.

We will use a legal research assistant as the running example. The product is called **CaseDesk Research**, and it helps associates at a law firm answer narrow research questions from internal matter files, public cases, statutes, and approved firm memos. A lawyer asks, "Can we rely on the indemnity clause in the Waverly vendor agreement under New York law?" The assistant needs matter facts, contract text, legal sources, citations, and a careful warning when the evidence is weak. It also needs to avoid leaking privileged client notes into unrelated tool calls.

The spine of the article is simple: a legal team has too much material, context design picks the right material for one model step, the app builds context in layers, and the team checks that each layer improves answers without leaking data.

## The Legal Research Scenario

<!-- section-summary: The scenario gives every context choice a reason. A legal research assistant needs strong instructions, matter facts, retrieved legal sources, citations, and privacy controls in the same request. -->

Imagine a junior associate is reviewing a vendor contract after a security incident. The partner wants to know whether the indemnity clause can cover investigation costs. The associate opens CaseDesk Research and asks a question tied to matter `M-2026-0417`. Behind the screen, the app has access to a document management system, a case-law index, a statute index, and a billing-safe audit log.

The assistant has to handle several kinds of material:

| Context item | Example in CaseDesk Research | Why it matters |
|---|---|---|
| System instructions | "Answer as a legal research assistant. Cite sources. Flag uncertainty." | Sets behavior for every request. |
| User request | "Can we rely on the indemnity clause..." | Defines the current task. |
| Matter facts | Jurisdiction, client role, vendor name, incident date, contract version | Keeps the answer tied to the right file. |
| Retrieved law | Cases, statutes, firm research memos, Restatement excerpts | Provides authority and citations. |
| Tool definitions | Search cases, fetch contract clause, create research memo draft | Gives the model controlled actions. |
| Tool results | Search hits, clause text, memo snippets | Adds current evidence after a tool call. |
| Privacy policy | Privilege level, client consent, redaction rules | Limits what can leave the matter boundary. |
| Budget plan | Token limits by layer | Prevents long sources from crowding out the answer. |

A useful legal assistant needs all of these pieces, yet each piece competes for space. If the retrieved case excerpts are too long, the answer may run out of room. If the instructions are vague, the model may answer like a generic legal explainer. If the tool call receives the whole matter transcript, the tool log may capture privileged notes that the search service never needed. Context design gives each piece a job and a boundary.

![CaseDesk context assembly layers](/content-assets/articles/article-mlops-llmops-context-design/context-assembly-layers.png)

*CaseDesk builds one request from policy, user intent, matter facts, retrieved law, tool results, and a privacy gate.*

## Context Layers: Instructions, Facts, Sources, Tools

<!-- section-summary: A context layer is a group of input items with the same job. Keeping layers separate makes the request easier to review, budget, cache, and test. -->

The first habit is to separate context into layers. A layer is a group of information that serves the same purpose. Instructions tell the model how to behave. User input tells the model what the person wants. Retrieved context gives evidence. Tool definitions tell the model which actions are available. Tool results show what happened after an action.

That separation matters because layers change at different speeds. The firm-wide instruction changes rarely, so it can sit near the start of the request where prompt caching can help. The user question changes every turn, so it belongs near the end. Retrieved cases change with the query and jurisdiction, so they need their own budget. Tool outputs may arrive after the first model step, so the app must add them carefully rather than rebuilding the whole conversation from scratch.

A simple request contract can make this visible:

```typescript
type ContextLayer =
  | "policy"
  | "task"
  | "matter_facts"
  | "retrieved_authority"
  | "tool_result"
  | "memory";

type ContextBlock = {
  layer: ContextLayer;
  name: string;
  text: string;
  sourceId?: string;
  privilege: "public" | "firm_internal" | "matter_confidential" | "privileged";
  maxTokens: number;
  priority: number;
};

type ContextBundle = {
  requestId: string;
  matterId: string;
  userRole: "associate" | "partner" | "research_librarian";
  blocks: ContextBlock[];
  outputBudgetTokens: number;
};
```

This schema is plain on purpose. The app can review each block before it reaches the model. The `layer` explains why the block exists. The `privilege` field helps enforce privacy rules. The `maxTokens` and `priority` fields let the assembler prune lower-value material before the request exceeds the model budget. In a legal app, that review trail matters because the firm may need to explain why a source appeared in an answer.

Instructions need special care. Put stable policy in one place, and keep it short enough for people to review. The instruction should say the assistant must cite legal sources, separate known facts from legal analysis, ask for missing facts when needed, and refuse to fabricate authority. It should also tell the model how to treat retrieved material. Retrieved context is evidence, while instructions are rules for behavior. A case excerpt should never override the instruction that the assistant must cite sources and flag uncertainty.

## Building a Context Budget

<!-- section-summary: A context budget divides the model window among instructions, user input, retrieved sources, tool results, memory, and output. The budget helps the app choose evidence instead of stuffing every available document into the request. -->

A context window is large, yet it is still a budget. Every token spent on a long contract excerpt is a token unavailable for another case, a tool result, or the final answer. Teams often learn this during the first production pilot. The prototype works with one document. The production request pulls twenty cases, three contract versions, a matter summary, and a firm memo. The answer then misses a crucial citation because the useful paragraph sat near the bottom of a long source block.

CaseDesk Research uses a budget table for the indemnity question:

| Layer | Budget | Rule |
|---|---:|---|
| Stable instructions | 900 tokens | Keep cache-friendly and versioned. |
| User request and matter facts | 700 tokens | Preserve exact user wording and key facts. |
| Contract clause | 1,200 tokens | Include the clause and surrounding definitions. |
| Retrieved legal authority | 5,000 tokens | Prefer high-ranking authority with citations. |
| Tool results | 1,200 tokens | Include only tool output used in the answer. |
| Safety and citation rules | 400 tokens | Keep short and explicit. |
| Answer reserve | 1,500 tokens | Leave room for analysis and citations. |

The exact numbers depend on the model, latency target, and product needs. The important point is the discipline. The app reserves output space before adding sources. It adds high-priority sources first. It trims by section, citation quality, recency, and jurisdiction rather than chopping arbitrary characters from the end.

![CaseDesk context budget reserve](/content-assets/articles/article-mlops-llmops-context-design/context-budget-reserve.png)

*The budget protects answer space first, then spends the remaining room on the highest-value legal evidence.*

Here is a small Python assembler that shows the idea. The token counter is a placeholder wrapper around a provider-aware token counting API or library. In real systems, count messages, tool schemas, files, and images with the same provider path used for production requests whenever that support exists.

```python
from dataclasses import dataclass
from typing import Literal

Privilege = Literal["public", "firm_internal", "matter_confidential", "privileged"]

@dataclass
class ContextBlock:
    layer: str
    name: str
    text: str
    privilege: Privilege
    max_tokens: int
    priority: int

def count_tokens(text: str) -> int:
    return max(1, len(text) // 4)

def trim_to_budget(text: str, max_tokens: int) -> str:
    words = text.split()
    approx_words = max_tokens * 3 // 4
    return " ".join(words[:approx_words])

def assemble_context(blocks: list[ContextBlock], request_budget: int, output_budget: int) -> list[dict]:
    available = request_budget - output_budget
    selected: list[dict] = []
    used = 0

    for block in sorted(blocks, key=lambda item: item.priority):
        trimmed = trim_to_budget(block.text, block.max_tokens)
        cost = count_tokens(trimmed)
        if used + cost > available:
            continue
        selected.append({
            "role": "user" if block.layer == "task" else "developer",
            "content": f"[{block.layer}:{block.name}]\n{trimmed}",
            "metadata": {
                "privilege": block.privilege,
                "budgeted_tokens": cost,
            },
        })
        used += cost

    return selected
```

This code leaves out many production details, yet it teaches the core shape. The assembler sorts by priority, trims each block to its layer budget, and skips blocks that would crowd out the answer reserve. In production, you would also log which blocks were excluded, keep deterministic block IDs, and record retrieval scores for later evaluation.

The output reserve matters in legal research because the final answer must show reasoning and citations. A model that receives too much source text may produce a short or truncated answer. A model that receives too little source text may guess. A budget keeps the app away from both failures.

## Tool-Visible Context

<!-- section-summary: Tool-visible context is the subset of information a tool receives. Treating tool context as a separate design choice helps protect private data and reduces messy tool logs. -->

Tools are powerful because the model can ask the system to search cases, fetch a contract clause, or create a draft memo. A tool call also creates a new data flow. The search tool usually needs the query, jurisdiction, date range, and source collection. It rarely needs the whole privileged matter timeline. If the app sends the whole conversation to every tool, the tool log may collect sensitive data that the tool never required.

CaseDesk Research defines each tool with a narrow argument schema:

```typescript
const searchLegalAuthorityTool = {
  type: "function",
  name: "search_legal_authority",
  description: "Search approved legal authority collections for a matter-scoped research question.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query", "jurisdiction", "sourceTypes", "matterId"],
    properties: {
      query: { type: "string" },
      jurisdiction: { type: "string" },
      sourceTypes: {
        type: "array",
        items: { enum: ["case_law", "statute", "firm_memo"] },
      },
      matterId: { type: "string" },
      beforeDate: { type: "string" },
    },
  },
};
```

The tool receives a focused query such as "New York indemnity clause investigation costs data breach vendor agreement" and a matter ID for access checks. The tool service uses the matter ID to filter firm memos and contract files on the server side. The model never has to pass the client name, privileged witness notes, or billing comments as plain tool arguments.

![CaseDesk tool-visible context boundary](/content-assets/articles/article-mlops-llmops-context-design/tool-visible-context-boundary.png)

*The legal search tool receives narrow fields, while privileged notes stay behind the matter boundary.*

Tool results need the same discipline. A search result should return source IDs, titles, citations, excerpts, scores, and permission labels. It should avoid dumping a full 70-page opinion into the next request. The context assembler can then pick the best snippets, include stable citation metadata, and attach a link that the UI can open for lawyer review.

```json
{
  "source_id": "ny-case-2019-0442",
  "title": "Harbor Labs v. Kent Systems",
  "citation": "274 A.D.3d 118",
  "jurisdiction": "NY",
  "excerpt": "The indemnity clause covered third-party claims and reasonable investigation expenses tied to those claims.",
  "score": 0.82,
  "permission": "public"
}
```

The model sees the excerpt and citation. The UI can show the original source. The audit log can show which tool returned the source, which filters were applied, and which answer cited it. That trace helps reviewers debug bad answers without exposing every private note to every subsystem.

## Retrieved Context And Instruction Priority

<!-- section-summary: Retrieved context supplies evidence, while instructions set behavior. The app should label retrieved material clearly so the model can use it as a source rather than treating it as a new rule. -->

Legal retrieval is tricky because source text may contain instructions of its own. A contract might say "vendor shall provide notice within five business days." A case might quote a party's argument. A firm memo might include a partner's preferred phrasing. These are sources to analyze, not rules that control the assistant.

A clean context format helps. Each retrieved block should carry a label, a source ID, a citation, and a boundary. The model should know where the excerpt starts and ends. The instruction should say that retrieved material may contain quoted language, party arguments, or outdated analysis, and the assistant must evaluate it against the current user question.

```yaml
retrieved_context:
  - source_id: ny-case-2019-0442
    citation: "274 A.D.3d 118"
    source_type: case_law
    jurisdiction: NY
    retrieved_at: "2026-07-05T10:31:00Z"
    use_policy: "cite if relied upon"
    excerpt: |
      The court treated investigation expenses as covered only when the clause linked
      expenses to third-party claims and used broad cost language.
```

This structure gives the model a cleaner reading task. It can compare the Waverly clause against the retrieved case. It can cite the source if it uses the source. It can also say that the case may have limited value if the clause wording differs. The model receives a clear job: analyze sources, cite them, and flag uncertainty.

Instruction priority also matters for prompt injection. In a legal context, a retrieved document could contain hostile or irrelevant text, especially if the index includes uploaded emails or scraped public documents. The app should tell the model that retrieved text can provide facts and authority, while behavior rules come from the system and developer instructions. That rule needs tests, because prompt injection usually fails quietly before someone notices the answer style has shifted.

## Compression, Pruning, And Long Conversations

<!-- section-summary: Long workflows need controlled compression and pruning. The app should summarize prior work into reviewable state instead of carrying every message forever. -->

Legal research often takes many turns. The associate may ask for a first answer, request a narrower jurisdiction, ask for a memo outline, add a newly found contract amendment, and then ask for a partner-ready summary. Carrying the entire transcript forever can raise cost and latency. Dropping the transcript blindly can lose important commitments.

A useful approach is to keep a **working research state** separate from the raw conversation. The state records the current question, known facts, relied-on sources, open issues, excluded sources, and draft answer constraints. The app can pass that compact state into the next model step, while preserving the full transcript in the database for audit and review.

```json
{
  "matter_id": "M-2026-0417",
  "research_question": "Coverage for investigation costs under NY indemnity clause",
  "known_facts": [
    "Vendor agreement version dated 2025-11-18",
    "Clause covers third-party claims and reasonable costs",
    "Incident involved customer notification and forensic review"
  ],
  "relied_on_sources": [
    "ny-case-2019-0442",
    "firm-memo-indemnity-costs-2026"
  ],
  "open_issues": [
    "Need partner confirmation on whether costs arose from third-party demand"
  ],
  "answer_constraints": {
    "cite_sources": true,
    "include_uncertainty": true,
    "audience": "partner"
  }
}
```

Some platforms also provide server-side or standalone compaction for long-running interactions. That can help carry prior state with fewer tokens. Treat compaction as part of the context plan, not as a magic cleanup step. You still need to decide which facts, sources, decisions, and unresolved questions must survive into the next turn.

The safest pattern is reviewable compression. A lawyer or product owner should be able to inspect the compact research state and say, "Yes, this captures the work so far." If the state hides too much inside an opaque blob, debugging gets harder. If the state keeps everything, the cost problem returns.

## Evals And Observability For Context

<!-- section-summary: Context design needs tests and traces because bad context failures can look like model failures. Measure which blocks were selected, which sources were cited, and which answers improved after context changes. -->

When an LLM answer fails, teams often blame the model first. In many LLMOps incidents, the model answered from weak context. The app retrieved the wrong jurisdiction. The assembler dropped the contract clause. The source formatter removed citation metadata. The tool call used the wrong matter ID. Context observability helps you see those failures.

For CaseDesk Research, a trace should capture:

- `request_id`, `matter_id`, user role, and context policy version
- selected block IDs, excluded block IDs, and token counts by layer
- retrieval query, filters, top source IDs, scores, and reranker scores
- tool call names, argument hashes, permission decisions, and latency
- final cited source IDs and whether each cited source appeared in context
- reviewer feedback, such as "missing authority" or "wrong jurisdiction"

OpenTelemetry GenAI semantic conventions have been split into a dedicated GenAI conventions repository, and the general idea is useful even if your exact instrumentation library differs. Use spans for retrieval, context assembly, model calls, and tool calls. Add attributes for source IDs, token counts, prompt version, and eval case IDs. Avoid logging raw privileged text in traces unless your retention and access controls explicitly allow it.

The eval set should include real question types:

```python
eval_cases = [
    {
        "id": "indemnity-ny-investigation-costs-001",
        "question": "Can Waverly rely on the indemnity clause for forensic investigation costs?",
        "matter_id": "M-2026-0417",
        "required_sources": ["contract-waverly-vendor-2025-11", "ny-case-2019-0442"],
        "must_include": ["third-party claim", "reasonable costs", "uncertainty"],
        "forbidden_sources": ["ca-case-2024-0211"],
    },
    {
        "id": "indemnity-ny-notice-002",
        "question": "Did the five-business-day notice provision change the answer?",
        "matter_id": "M-2026-0417",
        "required_sources": ["contract-waverly-amendment-2026-02"],
        "must_include": ["notice timing", "factual confirmation needed"],
        "forbidden_sources": [],
    },
]

def score_context_selection(case: dict, selected_source_ids: set[str]) -> dict:
    required = set(case["required_sources"])
    forbidden = set(case["forbidden_sources"])
    return {
        "required_recall": len(required & selected_source_ids) / max(1, len(required)),
        "forbidden_hits": sorted(forbidden & selected_source_ids),
    }
```

This evaluation checks context before judging the final prose. If required sources never reached the model, the prompt wording is probably the wrong place to start. Fix retrieval, filters, reranking, budget allocation, or permissions first. Then judge whether the answer used the context well.

## Practical Checks And Common Mistakes

<!-- section-summary: A strong context design can be reviewed before any answer is generated. You should be able to explain each context layer, its budget, its source, and its privacy boundary. -->

Before shipping a context design, run a practical review with product, engineering, legal, and security:

- Can you name every layer in the request and explain why it exists?
- Can you show token counts by layer for a real production-like request?
- Can you prove the answer reserve stays available after retrieval?
- Can you show which retrieved source supported each citation?
- Can you keep privileged matter facts away from tools that only need public search terms?
- Can you reproduce a bad answer from the logged context bundle?
- Can you run an eval that scores source recall before scoring final answer quality?
- Can you rotate a prompt or retrieval policy version and compare results?

The common mistakes are predictable. Teams put too much faith in one giant prompt. They mix instructions and retrieved sources in the same blob. They send full transcripts to every tool. They count only user-visible text and forget that tools, schemas, files, and images also consume context. They trim by character count instead of source value. They log raw sensitive text without a retention plan. Each mistake is fixable once context assembly is treated as application logic rather than a prompt pasted into a dashboard.

For interview-ready understanding, say it this way: **context design is the production discipline of assembling the model's working view for one step**. It covers the layers, budgets, priorities, tool-visible data, privacy rules, compression plan, and evidence trail. A good context design lets a team answer the hard review question: "Why did the model see exactly this information, and how do we know it was enough?"

## References

- [OpenAI API docs: Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI API docs: File search](https://developers.openai.com/api/docs/guides/tools-file-search)
- [OpenAI API docs: Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI API docs: Compaction](https://developers.openai.com/api/docs/guides/compaction)
- [OpenAI API docs: Counting tokens](https://developers.openai.com/api/docs/guides/token-counting)
- [OpenAI API docs: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI API docs: Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI API docs: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
