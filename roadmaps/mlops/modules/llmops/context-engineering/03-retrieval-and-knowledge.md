---
title: "Retrieval and Knowledge"
description: "Build retrieval systems that bring the right knowledge into LLM context with chunking, metadata filters, hybrid search, reranking, freshness checks, citations, permissions, and retrieval evals."
overview: "Retrieval connects an LLM application to documents, records, and knowledge sources so the model can answer from governed evidence instead of memory alone."
tags: ["MLOps","LLMOps","production","context"]
order: 3
id: "article-mlops-llmops-retrieval-and-knowledge"
---
## What Retrieval Adds To An LLM App

<!-- section-summary: Retrieval is the part of an LLM app that finds relevant knowledge before the model answers. It turns documents, policies, tickets, database rows, and other sources into evidence the model can cite. -->

**Retrieval** means the application searches knowledge sources and brings selected evidence into the model's context. The model may know general language patterns, yet your company's policy, product rules, contract terms, and latest incident notes live outside the model. Retrieval gives the model a controlled way to use that knowledge.

Retrieval is often called RAG, which stands for retrieval-augmented generation. RAG is one pattern inside a larger knowledge system. A real system has ingestion, chunking, metadata, permissions, freshness, search, reranking, context assembly, citations, evaluation, and observability. If any of those pieces is weak, the final answer can sound confident while relying on the wrong source.

We will use an internal policy assistant for **Meridian Devices**, a company that builds medical device components. Employees ask questions about travel, supplier gifts, security, procurement, and quality policies. A sales manager asks, "Can I accept a dinner invitation from a supplier during the Munich trade show?" The assistant must retrieve the gift policy, the Germany travel addendum, the supplier compliance note, and maybe a role-specific approval matrix. It must cite the policy sections, respect employee permissions, and avoid using a stale PDF that compliance replaced last quarter.

The spine of this article is: employees need current internal answers, retrieval turns company knowledge into model context, the system needs strong ingestion and search design, and evals prove the right source reaches the model.

## The Internal Policy Scenario

<!-- section-summary: Internal policy retrieval is a strong example because answers depend on version, region, role, and permissions. The model needs evidence, citations, and freshness rules rather than generic advice. -->

Meridian Devices has policies in several places. The compliance team owns the official policy repository. HR stores travel rules in a knowledge base. Procurement keeps supplier onboarding rules in a vendor portal. Security owns acceptable-use rules in a handbook. Older PDFs still sit in shared drives because people copied them during projects.

The employee question about a supplier dinner sounds simple. In practice, the answer depends on several details:

| Detail | Why it matters |
|---|---|
| Employee role | Sales, procurement, and quality teams may have different gift rules. |
| Supplier status | Active suppliers often have stricter limits. |
| Region | Germany and EU policy addenda may apply. |
| Gift value | Dinner cost may trigger approval thresholds. |
| Source version | The current policy supersedes older PDF copies. |
| Permission | Some compliance notes may be internal-only or manager-only. |
| Citation | The employee needs policy section links for approval. |

A generic answer such as "check your company policy" is not useful. A confident answer from an old policy is worse. The retrieval system needs to find the current policy sections, filter by region and role, rank the best chunks, and provide the model with citation-ready evidence.

## Knowledge Sources And Ingestion

<!-- section-summary: Retrieval quality starts before search. Ingestion decides which sources are trusted, how they are parsed, which metadata is attached, and which old versions are retired. -->

The first production decision is source authority. Internal companies often have many copies of the same policy. Retrieval should prefer the governed source of truth. For Meridian Devices, compliance publishes a signed policy bundle every month. The ingestion job reads that bundle first, then reads HR and procurement addenda that compliance has approved. Shared-drive copies can stay searchable for discovery, yet they should have a lower trust tier and a clear warning.

An ingestion record should include source metadata:

```json
{
  "document_id": "policy-gifts-entertainment-2026-04",
  "title": "Gifts and Entertainment Policy",
  "owner": "Compliance",
  "source_system": "policy_portal",
  "version": "2026.04",
  "effective_date": "2026-04-01",
  "review_after": "2026-10-01",
  "region": ["global", "EU"],
  "audience": ["employee", "manager"],
  "permission_groups": ["all_employees"],
  "supersedes": ["policy-gifts-entertainment-2025-11"],
  "trust_tier": "authoritative"
}
```

This metadata is not decoration. It powers filters, freshness checks, permissions, and citations. The app can answer, "This came from the 2026.04 policy, effective April 1, 2026." It can also exclude the 2025.11 policy during normal retrieval because the current document supersedes it.

The ingestion pipeline should do four jobs:

1. Pull documents from approved source systems.
2. Parse text, tables, headings, links, and section numbers.
3. Attach metadata for owner, version, region, audience, permissions, and dates.
4. Write chunks into search indexes and record lineage back to the source document.

Do this work outside the model request. A model call should not parse every policy PDF on demand. Ingestion makes retrieval fast, repeatable, and auditable.

![Meridian Devices policy ingestion pipeline](/content-assets/articles/article-mlops-llmops-retrieval-and-knowledge/policy-ingestion-metadata.png)

*Meridian indexes current policy chunks with owner, version, region, and permission metadata while stale copies are superseded.*

## Chunking With Metadata

<!-- section-summary: Chunking splits source documents into retrievable pieces. Good chunks preserve headings, section numbers, dates, and policy owners so the answer can cite the right authority. -->

A **chunk** is a piece of a source document that search can return. Chunking sounds simple until policy documents enter the picture. If a chunk is too small, it may lose the exception or definition that makes the rule understandable. If a chunk is too large, it may bury the relevant sentence and waste context. Policy chunks should preserve section structure.

For the gift policy, a chunk might represent one section plus a small amount of surrounding context:

```python
from dataclasses import dataclass
from datetime import date

@dataclass
class PolicyChunk:
    chunk_id: str
    document_id: str
    section_id: str
    title_path: list[str]
    text: str
    owner: str
    version: str
    effective_date: date
    region: list[str]
    audience: list[str]
    permission_groups: list[str]
    trust_tier: str
    source_url: str

gift_dinner_chunk = PolicyChunk(
    chunk_id="policy-gifts-2026-04-sec-4-2",
    document_id="policy-gifts-entertainment-2026-04",
    section_id="4.2",
    title_path=["Gifts and Entertainment Policy", "Supplier Events", "Meals"],
    text="Employees may accept ordinary business meals with active suppliers up to the regional limit when a business purpose is documented. Meals above the limit require manager and compliance approval before attendance.",
    owner="Compliance",
    version="2026.04",
    effective_date=date(2026, 4, 1),
    region=["global", "EU"],
    audience=["employee", "manager"],
    permission_groups=["all_employees"],
    trust_tier="authoritative",
    source_url="https://policy.meridian.example/policies/gifts/2026.04#section-4.2",
)
```

The text alone is useful for semantic search. The metadata is useful for control. The app can filter to EU policy, current effective dates, employee-visible permissions, and authoritative sources. It can also build a citation from `title_path`, `section_id`, `version`, and `source_url`.

Chunking rules should be tested. Policy documents often contain tables and exceptions. A table of gift thresholds may need a chunk per row plus a parent chunk for the whole table. A definition section may need to travel with several sections that use the term. Some systems store parent-child relationships so retrieval can find a narrow chunk and then bring the parent section into context.

## Vector, Keyword, And Hybrid Retrieval

<!-- section-summary: Vector search finds semantic matches, keyword search finds exact terms, and hybrid search combines both. Internal policy assistants usually need hybrid retrieval because employees mix natural language with exact policy terms. -->

Vector search and keyword search solve different retrieval problems. Vector search uses embeddings, so it can match "supplier dinner" with "business meal." Keyword search can match exact terms such as "E-47," "section 4.2," "Munich," or "active supplier." Internal policy assistants need both because employees use a mix of natural language and exact terms.

Hybrid retrieval combines dense vector search with lexical search. Tools such as Weaviate, Qdrant, Pinecone, Elasticsearch, OpenSearch, and Postgres-based stacks can support parts of this pattern in different ways. The exact product matters less than the design: run candidate retrieval, apply filters, rerank, and pass citation-ready evidence into context.

Here is a simplified retrieval request:

```typescript
type PolicySearchRequest = {
  query: string;
  employeeId: string;
  role: "sales" | "procurement" | "quality" | "engineering";
  region: string;
  supplierId?: string;
  effectiveOn: string;
  topK: number;
};

const request: PolicySearchRequest = {
  query: "Can I accept a dinner invitation from a supplier during the Munich trade show?",
  employeeId: "emp-3818",
  role: "sales",
  region: "EU",
  supplierId: "supplier-774",
  effectiveOn: "2026-07-05",
  topK: 12,
};
```

The retrieval service can turn that into filters:

```json
{
  "region": { "$in": ["global", "EU"] },
  "audience": { "$in": ["employee", "manager"] },
  "permission_groups": { "$contains": "all_employees" },
  "effective_date": { "$lte": "2026-07-05" },
  "trust_tier": { "$in": ["authoritative", "approved_addendum"] }
}
```

Then it can search. A dense retriever might find sections about business meals even if the word "dinner" never appears. A keyword retriever might find "Munich trade show" in a regional addendum. A hybrid retriever can merge those candidate sets. A reranker can then read the query and candidate chunks more carefully to choose the top few for the model.

The retrieval output should be small, structured, and ready for context assembly:

```json
{
  "query_id": "qry-20260705-00931",
  "results": [
    {
      "chunk_id": "policy-gifts-2026-04-sec-4-2",
      "title": "Gifts and Entertainment Policy",
      "section": "4.2 Supplier Events - Meals",
      "version": "2026.04",
      "score": 0.91,
      "source_url": "https://policy.meridian.example/policies/gifts/2026.04#section-4.2",
      "excerpt": "Employees may accept ordinary business meals with active suppliers up to the regional limit..."
    }
  ]
}
```

The model can use this result to answer with a citation. The UI can show the source link. The trace can show why this result appeared.

![Meridian hybrid retrieval and reranking](/content-assets/articles/article-mlops-llmops-retrieval-and-knowledge/hybrid-retrieval-reranking.png)

*Hybrid retrieval combines semantic matches, exact terms, metadata filters, and reranking before evidence reaches context.*

## Reranking, Freshness, And Source Quality

<!-- section-summary: Initial search creates candidates; reranking and freshness rules decide which candidates deserve context space. This step is where policy assistants avoid stale, duplicate, or low-authority sources. -->

Initial search should usually return more candidates than the model will see. The app might retrieve 50 chunks, merge duplicates, apply permission filters, rerank, and pass only the top 5 to 8 chunks into context. This keeps recall high while protecting the final context budget.

Reranking can use a cross-encoder, a hosted reranking model, an LLM-based reranker, or a product-specific scoring formula. Reranking is useful when several chunks mention similar words, yet only one answers the actual question. For the supplier dinner question, the app may retrieve sections about gifts, travel meals, supplier events, trade show sponsorship, and anti-bribery rules. The reranker should prefer chunks that mention active suppliers, business meals, regional limits, and approvals.

Freshness and quality should influence ranking too. A stale PDF copy from a shared drive may have a strong lexical match, yet the authoritative policy portal version should win. A source quality score can include:

- `trust_tier`: authoritative, approved addendum, archive, user-uploaded
- `effective_date`: active on the question date
- `review_after`: warning when review date has passed
- `superseded_by`: exclude when a newer document supersedes it
- `owner`: compliance-owned policy versus informal team note
- `citation_quality`: stable section URL and section ID available

Here is a simple scoring function that can run after candidate retrieval:

```python
from datetime import date

TRUST_WEIGHT = {
    "authoritative": 1.0,
    "approved_addendum": 0.85,
    "archive": 0.25,
    "user_uploaded": 0.15,
}

def freshness_multiplier(effective_date: date, review_after: date | None, query_date: date) -> float:
    if effective_date > query_date:
        return 0.0
    if review_after and review_after < query_date:
        return 0.7
    return 1.0

def policy_score(search_score: float, trust_tier: str, effective_date: date, review_after: date | None, query_date: date) -> float:
    return search_score * TRUST_WEIGHT[trust_tier] * freshness_multiplier(effective_date, review_after, query_date)
```

This example is small, yet the design is important. Search relevance alone should not decide policy answers. Source authority and freshness belong in the ranking path.

## Permissions And PII Boundaries

<!-- section-summary: Retrieval must enforce permissions before chunks reach the model. Filters should use the caller's role, region, groups, and task purpose so private material stays out of context. -->

Internal retrieval can expose sensitive material if permission checks happen too late. The safest default is to enforce permissions before the model sees the chunk. The model should never receive manager-only investigation notes for an employee self-service question. It should never receive HR accommodation details when answering a travel policy question. It should never use another employee's private record as a general policy source.

For Meridian Devices, permission checks happen in the retrieval service:

```typescript
type Caller = {
  employeeId: string;
  groups: string[];
  region: string;
  role: string;
};

type ChunkPermission = {
  permissionGroups: string[];
  regions: string[];
  piiClass: "none" | "employee_personal" | "supplier_confidential";
};

function canReadChunk(caller: Caller, chunk: ChunkPermission): boolean {
  const groupAllowed = chunk.permissionGroups.some(group => caller.groups.includes(group));
  const regionAllowed = chunk.regions.includes("global") || chunk.regions.includes(caller.region);
  const piiAllowed = chunk.piiClass === "none";
  return groupAllowed && regionAllowed && piiAllowed;
}
```

This code is intentionally strict. A normal policy question should read policy chunks, not employee personal records. A specialized HR workflow might allow employee personal data under a different purpose, with stronger audit controls and a narrower prompt. Purpose-based access helps because the same caller may have different rights in different workflows.

The final answer should also avoid exposing hidden source titles. If the retrieval layer rejects manager-only notes, the model cannot cite or paraphrase them. If the model asks a tool for more information, the tool should apply the same permission checks. Retrieval permissions and tool permissions need the same identity and policy backbone.

## Citations And Answer Grounding

<!-- section-summary: Citations turn retrieval from a hidden helper into reviewable evidence. Each answer should show which source sections support the claim and where the user can verify them. -->

Citations are essential for internal policy assistants. Employees need to show managers, auditors, or compliance reviewers why they acted. A model answer that says "You need approval" without a policy link creates extra work. A citation lets the user verify the rule and open the source of truth.

The context passed to the model should include citation metadata:

```yaml
context_sources:
  - source_number: 1
    chunk_id: policy-gifts-2026-04-sec-4-2
    title: "Gifts and Entertainment Policy"
    section: "4.2 Supplier Events - Meals"
    version: "2026.04"
    source_url: "https://policy.meridian.example/policies/gifts/2026.04#section-4.2"
    excerpt: |
      Employees may accept ordinary business meals with active suppliers up to the regional limit
      when a business purpose is documented. Meals above the limit require manager and compliance
      approval before attendance.
```

The instruction can then require source-number citations for every policy claim. The answer might say: "You can accept an ordinary business meal with an active supplier if the cost is within the EU regional limit and the business purpose is documented [1]. If the expected cost is above the limit, get manager and compliance approval before attending [1]."

Citation checks should run after generation. The app can verify that every cited source ID appeared in the retrieved context. It can also flag uncited policy claims. For stricter workflows, the app can require the model to return structured claims with source IDs:

```json
{
  "answer": "You may accept the dinner if it stays within the EU meal limit and has a documented business purpose. Approval is required above the limit.",
  "claims": [
    {
      "claim": "Ordinary business meals with active suppliers are allowed within the regional limit.",
      "source_ids": ["policy-gifts-2026-04-sec-4-2"]
    },
    {
      "claim": "Meals above the limit require manager and compliance approval before attendance.",
      "source_ids": ["policy-gifts-2026-04-sec-4-2"]
    }
  ],
  "missing_information": ["expected dinner cost"]
}
```

This structure gives the app a reviewable bridge between retrieval and the final answer.

![Meridian grounding checks and retrieval evals](/content-assets/articles/article-mlops-llmops-retrieval-and-knowledge/grounding-citations-evals.png)

*Grounding checks connect selected chunks, answer citations, freshness, permissions, and retrieval eval results.*

## Retrieval Evals

<!-- section-summary: Retrieval evals check whether the right chunks were found before evaluating the answer. They measure recall, precision, freshness, permissions, and citation coverage. -->

Retrieval quality needs its own evals. If the right chunk never reaches the model, answer-level evaluation can waste time. The prompt may look weak, while the real issue is chunking, metadata, filters, or reranking.

An eval set for Meridian Devices can include questions, caller attributes, expected source chunks, blocked source chunks, and freshness expectations:

```python
retrieval_eval_cases = [
    {
        "id": "supplier-dinner-eu-sales-001",
        "query": "Can I accept a dinner invitation from a supplier during the Munich trade show?",
        "caller": {"role": "sales", "region": "EU", "groups": ["all_employees"]},
        "expected_chunks": {
            "policy-gifts-2026-04-sec-4-2",
            "policy-eu-travel-2026-02-sec-2-1",
        },
        "blocked_chunks": {
            "policy-gifts-entertainment-2025-11-sec-4-2",
            "investigation-note-supplier-774-private",
        },
    }
]

def evaluate_retrieval(case: dict, retrieved_chunk_ids: list[str]) -> dict:
    retrieved = set(retrieved_chunk_ids)
    expected = set(case["expected_chunks"])
    blocked = set(case["blocked_chunks"])
    return {
        "recall_at_k": len(expected & retrieved) / max(1, len(expected)),
        "blocked_hits": sorted(blocked & retrieved),
        "first_expected_rank": min(
            (retrieved_chunk_ids.index(chunk) + 1 for chunk in expected if chunk in retrieved),
            default=None,
        ),
    }
```

Run these evals whenever you change chunking, embeddings, metadata filters, reranking, source ingestion, or access control logic. Keep a slice of hard questions: vague employee wording, exact section references, old policy names, regional addenda, and permission-sensitive cases. The best retrieval evals include examples where the right answer requires saying, "I found the policy, yet I need the expected dinner cost before giving a final approval path."

Answer evals still matter. After retrieval passes, test whether the model uses the chunks correctly, cites them, asks for missing information, and avoids policy claims unsupported by sources. Retrieval evals and answer evals work together.

## Observability And Operations

<!-- section-summary: Production retrieval needs traces and dashboards. Teams should monitor source freshness, retrieval latency, filter decisions, reranker scores, citation use, and user corrections. -->

Retrieval systems age every day. Policies change. Search indexes drift. Permission groups change. Employees ask new questions. Without observability, the assistant may slowly lose quality while still returning polished answers.

Track these signals:

- ingestion freshness by source system and document owner
- documents parsed, skipped, failed, superseded, and retired
- chunk counts by source, owner, trust tier, region, and permission group
- retrieval latency by vector search, keyword search, rerank, and permission filtering
- top queries with no results
- retrieval recall and blocked-source hits from eval runs
- answer citation coverage
- user feedback such as "outdated policy" or "wrong region"
- stale-source citations in production answers

Tracing should connect the user request to retrieval. A trace can show query text, filters, source IDs, scores, reranker decisions, context token counts, and cited chunks. Avoid logging raw confidential chunks in general-purpose traces when your retention policy or access model is not ready for that. IDs, hashes, and structured metadata are often enough for dashboards, while source content stays in the governed repository.

Operational ownership is just as important as code. Compliance should own source authority. Engineering should own retrieval infrastructure. Security should own permission patterns. Product should own answer behavior and feedback loops. If no team owns retired documents, the assistant will eventually cite an old PDF.

## Practical Checks And Common Mistakes

<!-- section-summary: A strong retrieval system can explain where knowledge came from, why it was allowed, how fresh it is, and how well it performs on test questions. -->

Use this checklist before shipping an internal policy assistant:

- Can you name the source of truth for each policy family?
- Can every chunk link back to a document, section, version, owner, and URL?
- Can retrieval filter by role, region, permission group, source type, and effective date?
- Can old documents be superseded and excluded from normal answers?
- Can the answer cite the exact sections used?
- Can evals measure retrieval recall before answer quality?
- Can traces show selected chunks, scores, filters, reranker output, and citation coverage?
- Can users report stale or wrong sources from the answer UI?
- Can the system answer "I need the dinner cost" when retrieval finds a threshold rule but the user omitted the value?

The common mistakes are easy to recognize. Teams index every file they can find instead of defining trusted sources. They chunk documents without preserving section numbers. They rely only on vector search and miss exact policy terms. They skip metadata filters and try to solve permissions in the prompt. They pass too many chunks into context and crowd out the answer. They trust answer-level evals while retrieval recall is weak. They cite source titles without stable section links. Each mistake weakens the evidence chain.

For interview-ready understanding, say it this way: **retrieval is the governed knowledge path between company sources and model context**. It includes ingestion, chunks, metadata, search, filters, reranking, freshness, citations, permissions, evals, and traces. The model can write a useful answer only after the retrieval system gives it the right evidence.

## References

- [OpenAI API docs: Retrieval](https://developers.openai.com/api/docs/guides/retrieval)
- [OpenAI API docs: File search](https://developers.openai.com/api/docs/guides/tools-file-search)
- [OpenAI API docs: Vector embeddings](https://developers.openai.com/api/docs/guides/embeddings)
- [OpenAI API docs: Optimizing LLM accuracy](https://developers.openai.com/api/docs/guides/optimizing-llm-accuracy)
- [OpenAI API docs: Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [LlamaIndex docs: Retriever](https://developers.llamaindex.ai/python/framework/module_guides/querying/retriever/)
- [LlamaIndex docs: Defining and customizing nodes](https://developers.llamaindex.ai/python/framework/module_guides/loading/documents_and_nodes/usage_nodes/)
- [LlamaIndex docs: Node postprocessors and rerankers](https://developers.llamaindex.ai/python/framework/module_guides/querying/node_postprocessors/node_postprocessors/)
- [Pinecone docs: Filter by metadata](https://docs.pinecone.io/guides/search/filter-by-metadata)
- [Pinecone docs: Hybrid search](https://docs.pinecone.io/guides/search/hybrid-search)
- [Qdrant docs: Hybrid queries](https://qdrant.tech/documentation/search/hybrid-queries/)
- [Weaviate docs: Hybrid search](https://docs.weaviate.io/weaviate/search/hybrid)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
