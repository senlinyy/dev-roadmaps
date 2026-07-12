---
title: "Structured Outputs"
description: "Use JSON Schema, typed parsers, validation, retries, evals, and downstream contracts so LLM output can safely drive product logic."
overview: "A hands-on tutorial on structured outputs for LLM applications, using invoice extraction and validation as the running production scenario."
tags: ["MLOps","LLMOps","production","llms"]
order: 3
id: "article-mlops-llmops-structured-outputs"
---
## Why Structured Outputs Matter

<!-- section-summary: Structured outputs make model responses usable by software instead of leaving downstream systems to guess from prose. The key idea is simple: ask the model for a typed object, validate it, and treat that object as a contract. -->

**Structured output** means the model returns data in a shape your application can parse and validate, usually JSON that follows a schema. Instead of asking for "a summary of this invoice," you ask for an `InvoiceExtraction` object with fields such as vendor name, invoice number, currency, subtotal, tax, total, line items, confidence, and validation warnings. Your code can then check the object and route it into an approval queue, accounting system, or exception workflow.

We will use **Cedar Books**, a fictional bookkeeping service for small businesses. Cedar Books receives invoices by email. Some are PDFs, some are scanned photos, some have tax lines, some have discounts, and some have messy vendor names. The team wants an LLM pipeline that extracts invoice data, validates totals, flags suspicious fields, and sends clean invoices into the accounts-payable system.

Plain text output is fragile for this job. A model might write, "The total appears to be $1,248.20, and the due date is probably August 14." That sentence is readable, yet the accounting system needs exact fields. It needs `total_amount: 1248.20`, `currency: "USD"`, `due_date: "2026-08-14"`, and `needs_review: true` if the model had uncertainty. A human can interpret prose. Software needs a contract.

Structured outputs give you that contract. The schema tells the model what fields to produce. The parser checks whether the result fits. Your application then runs business validation that goes beyond the schema, such as "subtotal plus tax minus discount must equal total within one cent." The schema handles shape. Your accounting rules handle meaning.

## Design The Target Object First

<!-- section-summary: Good structured output work starts with the downstream object, not with the prompt. If the accounts-payable system needs stable fields, enums, ids, and warnings, the schema should say that clearly. -->

Cedar Books should start by asking what the accounts-payable system needs. The extraction object should be small enough to validate, yet rich enough to support review. You can always store the raw OCR text and original PDF separately. The structured object should contain the fields downstream code needs for decisions.

Here is a practical target shape:

| Field group | Purpose | Examples |
| --- | --- | --- |
| Vendor identity | Match the invoice to a supplier record | `vendor_name`, `vendor_tax_id`, `remit_to_address` |
| Invoice identity | Prevent duplicates and support audit | `invoice_number`, `invoice_date`, `due_date` |
| Amounts | Post or review money fields | `subtotal_amount`, `tax_amount`, `discount_amount`, `total_amount`, `currency` |
| Line items | Explain what was purchased | description, quantity, unit price, amount |
| Validation | Tell the workflow what to check next | `needs_review`, `review_reasons`, `confidence` |
| Evidence | Link extracted fields to source text | page number, raw snippet, extraction notes |

The first schema should avoid cleverness. Use simple field names. Use enums for small controlled sets. Represent dates as ISO strings. Represent money as numbers only if you also control decimal handling downstream; many finance teams store decimal strings or integer cents to avoid floating-point surprises. Cedar Books chooses decimal strings in the model output, then converts to integer cents after validation.

The schema should also leave room for uncertainty. If the invoice has two possible invoice numbers, the model should flag review rather than guess. If the tax line is missing, it should return `"tax_amount": "0.00"` only when the source makes that clear. Otherwise it should include a review reason.

![Cedar Books invoice schema contract](/content-assets/articles/article-mlops-llmops-structured-outputs/cedar-invoice-schema-contract.png)

*Cedar Books turns invoice text into a schema-backed object that downstream code can validate and route.*

## A Responses API Structured Output Example

<!-- section-summary: The Responses API can return data that follows a JSON Schema through the `text.format` field, and SDK helpers can parse that into typed objects. This lets your server move from model output to validated application data without fragile string parsing. -->

OpenAI's Structured Outputs guide shows the Responses API using `text.format` with a JSON Schema, and SDK helpers can parse output into typed objects. In Cedar Books, the backend first runs OCR or file processing, then sends the extracted text and a schema to the model. The result should be an `InvoiceExtraction` object, not a paragraph.

This TypeScript example uses Zod because many teams already use it for request validation. The same idea works with Pydantic in Python.

```ts
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const client = new OpenAI();

const MoneyString = z.string().regex(/^-?\d+\.\d{2}$/);

const LineItem = z.object({
  description: z.string(),
  quantity: z.string(),
  unit_price: MoneyString,
  amount: MoneyString,
  source_page: z.number().int().min(1),
  source_snippet: z.string()
});

const InvoiceExtraction = z.object({
  vendor_name: z.string(),
  vendor_tax_id: z.string().nullable(),
  invoice_number: z.string(),
  invoice_date: z.string(),
  due_date: z.string().nullable(),
  currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD"]),
  subtotal_amount: MoneyString,
  tax_amount: MoneyString,
  discount_amount: MoneyString,
  total_amount: MoneyString,
  line_items: z.array(LineItem).min(1),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
  review_reasons: z.array(z.string()),
  source_document_id: z.string()
});

const promptVersion = "invoice-extraction-2026-07-02";

const response = await client.responses.parse({
  model: "gpt-5.5",
  input: [
    {
      role: "system",
      content: `
Extract one supplier invoice for Cedar Books.
Return only fields supported by the schema.
Use ISO dates in YYYY-MM-DD form.
Use decimal strings with two digits for money.
Set needs_review when totals fail, required fields are unclear, or the invoice may be a duplicate.
`
    },
    {
      role: "user",
      content: `
source_document_id: doc_inv_8841
OCR text:
ACME Office Supply
Invoice INV-2026-1887
Invoice date 2026-07-14
Due 2026-08-13
Desk chairs, Qty 4, Unit 219.00, Amount 876.00
Delivery, Qty 1, Unit 42.00, Amount 42.00
Subtotal 918.00
Tax 73.44
Total USD 991.44
`
    }
  ],
  text: {
    format: zodTextFormat(InvoiceExtraction, "invoice_extraction")
  },
  prompt_cache_key: `cedar-books:${promptVersion}`
});

const invoice = response.output_parsed;
```

Several details make this production-friendly. The prompt states the extraction rules in operational language. The schema uses enums, nullable fields, arrays, and required fields. The output has a `source_document_id` so the object can be linked back to the original file. `needs_review` and `review_reasons` give the workflow a routing decision without asking downstream code to infer uncertainty from prose.

Structured output is stronger than old JSON mode because schema adherence is part of the request. JSON mode can produce valid JSON with the wrong shape. A strict schema gives the model and parser a shared contract. You still validate the result yourself because a valid shape can contain a wrong amount, wrong date, or wrong vendor match.

## Validate Business Meaning After The Schema

<!-- section-summary: A schema checks shape, while business validation checks whether the extracted fields make sense. Invoice systems need arithmetic checks, duplicate checks, vendor matching, date checks, and review routing. -->

After parsing, Cedar Books runs deterministic validation. This is regular software, and it should be boring. The model extracted fields; now accounting rules decide whether the invoice can move forward.

```ts
import Decimal from "decimal.js";

type ValidationResult = {
  accepted: boolean;
  reviewReasons: string[];
};

function cents(value: string): Decimal {
  return new Decimal(value);
}

function validateInvoice(invoice: z.infer<typeof InvoiceExtraction>): ValidationResult {
  const reviewReasons = [...invoice.review_reasons];

  const lineTotal = invoice.line_items.reduce(
    (sum, item) => sum.plus(cents(item.amount)),
    new Decimal("0.00")
  );

  const expectedTotal = cents(invoice.subtotal_amount)
    .plus(cents(invoice.tax_amount))
    .minus(cents(invoice.discount_amount));

  if (!lineTotal.equals(cents(invoice.subtotal_amount))) {
    reviewReasons.push("Line item total differs from subtotal.");
  }

  if (!expectedTotal.equals(cents(invoice.total_amount))) {
    reviewReasons.push("Subtotal plus tax minus discount differs from total.");
  }

  if (invoice.confidence < 0.86) {
    reviewReasons.push("Extraction confidence below posting threshold.");
  }

  if (invoice.needs_review) {
    reviewReasons.push("Model requested human review.");
  }

  return {
    accepted: reviewReasons.length === 0,
    reviewReasons: [...new Set(reviewReasons)]
  };
}
```

The validation code ignores how persuasive the model sounded. It checks math, confidence, and review flags. A real Cedar Books pipeline would add vendor matching, duplicate detection, tax rules, purchase-order matching, approval thresholds, and sanctions or compliance checks when those apply to the business. These checks should stay outside the model because they need exact, explainable behavior.

The validation result drives the workflow decision:

```yaml
posting_rules:
  auto_post_when:
    validation_accepted: true
    total_amount_usd_lte: 2500
    vendor_match: exact
    duplicate_match: none
  route_to_review_when:
    validation_accepted: false
    confidence_lt: 0.86
    vendor_match: missing
    duplicate_match: possible
    total_amount_usd_gt: 2500
```

This is where structured output pays off. The product can say, "Auto-post clean invoices under $2,500 from known vendors. Send everything else to an AP reviewer with reasons and source snippets." You cannot build that safely from an unstructured paragraph.

![Cedar Books business validation flow](/content-assets/articles/article-mlops-llmops-structured-outputs/cedar-business-validation-flow.png)

*Schema validation checks shape first; deterministic accounting checks decide review queue or draft bill routing.*

## Retries, Refusals, And Fallbacks

<!-- section-summary: Structured output reduces parsing failures, yet production code still needs paths for incomplete output, refusals, low confidence, OCR errors, and invalid business checks. Retrying should be targeted and limited. -->

Structured outputs improve reliability, yet they do not remove every failure. A response can hit a token limit. The model can refuse a request for safety reasons. OCR text can be unreadable. The invoice can be missing a total. The model can return a valid object that fails business validation. Cedar Books needs explicit paths for each case.

Use targeted retries. If the parser fails because the response was incomplete, retry once with a shorter source text or a higher output limit. If business validation fails because totals differ, send a repair prompt with the validation errors and source text. If the second attempt fails, route to human review. Avoid endless self-repair loops because they add latency and can hide data-quality problems.

```ts
async function extractWithRepair(ocrText: string, sourceDocumentId: string) {
  const first = await runInvoiceExtraction(ocrText, sourceDocumentId);
  const firstValidation = validateInvoice(first);

  if (firstValidation.accepted) {
    return { invoice: first, validation: firstValidation, attempts: 1 };
  }

  const repaired = await runInvoiceExtraction(
    `
Previous extraction failed these checks:
${firstValidation.reviewReasons.map((reason) => `- ${reason}`).join("\n")}

Read the invoice text again and correct only fields supported by the schema.

${ocrText}
`,
    sourceDocumentId
  );

  const repairedValidation = validateInvoice(repaired);
  return { invoice: repaired, validation: repairedValidation, attempts: 2 };
}
```

Fallbacks should be visible to users and operators. If extraction fails twice, the AP reviewer should see the raw document, OCR text, trace id, attempted extraction, and validation reasons. If OCR quality is poor, the workflow should request a better scan rather than asking the model to guess. If the supplier is unknown, the invoice should wait for vendor setup. Each fallback should help someone finish the work rather than dumping a vague error into a queue.

It also helps to separate model confidence from business confidence. The model may be highly confident about text extraction, while the vendor match is weak because the supplier database has old names. The model may be uncertain about a due date, while the invoice can still be posted after AP confirms payment terms. Use separate flags for extraction quality, vendor matching, duplicate checks, and approval status.

## Feeding Downstream Systems

<!-- section-summary: Structured outputs should enter downstream systems through stable events or APIs, not by directly trusting the raw model response. Use idempotency, review queues, audit records, and source links. -->

After Cedar Books validates an invoice, it still should not let the raw model response write directly into the accounting database. The pipeline should convert the parsed object into an internal command or event. That event should include an idempotency key, validation status, source document id, prompt version, model, trace id, and reviewer status.

```json
{
  "event_type": "invoice.extraction.completed",
  "event_version": "2026-07-01",
  "idempotency_key": "doc_inv_8841:invoice-extraction-2026-07-02",
  "source_document_id": "doc_inv_8841",
  "prompt_version": "invoice-extraction-2026-07-02",
  "model": "gpt-5.5",
  "trace_id": "trace_invoice_8841_01",
  "validation": {
    "accepted": true,
    "review_reasons": []
  },
  "invoice": {
    "vendor_name": "ACME Office Supply",
    "invoice_number": "INV-2026-1887",
    "invoice_date": "2026-07-14",
    "due_date": "2026-08-13",
    "currency": "USD",
    "total_amount": "991.44"
  }
}
```

The receiving service can then decide what to do. A clean invoice can create a draft bill. A review invoice can create a task. A duplicate candidate can attach to the existing bill record. The model output enters the business system through normal software boundaries.

The database should store both the normalized fields and the evidence. Cedar Books should keep the original document, OCR text or extracted text, structured output, validation result, reviewer decision, prompt version, model, and trace link. That audit record matters when a supplier disputes a payment or an accountant asks why an invoice went to review.

```sql
create table invoice_extractions (
  id text primary key,
  source_document_id text not null,
  prompt_version text not null,
  model text not null,
  trace_id text not null,
  vendor_name text not null,
  invoice_number text not null,
  invoice_date date not null,
  due_date date,
  currency text not null,
  total_amount_cents integer not null,
  validation_accepted boolean not null,
  review_reasons jsonb not null,
  structured_output jsonb not null,
  created_at timestamptz not null default now()
);
```

This table design shows a useful pattern. Store the fields you query often as typed columns. Store the full structured output as JSON for audit and debugging. Store source ids so a reviewer can jump back to the document. Store prompt and model versions so evaluation and incident review can group failures by release.

## Evals For Structured Extraction

<!-- section-summary: Structured extraction evals should check schema validity, field accuracy, arithmetic, routing decisions, and reviewer burden. A good eval set includes clean invoices, ugly scans, duplicates, missing fields, and adversarial vendor text. -->

Invoice extraction needs evals before launch and after every meaningful change. Cedar Books should build a dataset of invoices with human-approved labels. Include easy invoices from known vendors, hard scans, international formats, missing due dates, negative line items, discounts, duplicate invoice numbers, handwritten notes, and emails with extra text around the invoice.

A useful eval case looks like this:

```yaml
suite: cedar_books_invoice_extraction
prompt_version: invoice-extraction-2026-07-02
cases:
  - id: acme_clean_two_line_invoice
    source_document_id: fixture_acme_001
    expected:
      vendor_name: "ACME Office Supply"
      invoice_number: "INV-2026-1887"
      invoice_date: "2026-07-14"
      due_date: "2026-08-13"
      currency: "USD"
      subtotal_amount: "918.00"
      tax_amount: "73.44"
      discount_amount: "0.00"
      total_amount: "991.44"
      needs_review: false
  - id: blurry_unknown_vendor
    source_document_id: fixture_unknown_014
    expected:
      needs_review: true
      review_reason_contains:
        - "vendor"
        - "confidence"
```

Score more than one metric. **Schema pass rate** tells you whether the model and parser produced a valid object. **Field accuracy** checks exact values. **Amount consistency** checks arithmetic. **Review routing accuracy** checks whether uncertain cases reached humans. **Reviewer burden** checks whether too many clean invoices went to review. **Latency and cost** tell you whether the pipeline can handle month-end volume.

Tracing closes the loop. For each eval and production invoice, record document type, OCR provider, prompt version, schema version, model, response id, token counts, validation errors, retry count, and reviewer outcome. If Cedar Books sees a spike in review volume after a prompt change, it can compare traces and find whether the model started setting `needs_review` too often or the OCR provider changed text formatting.

![Cedar Books structured output release loop](/content-assets/articles/article-mlops-llmops-structured-outputs/cedar-structured-output-release-loop.png)

*The release loop keeps extraction, validation, limited repair, routing, evals, and trace review tied to one invoice contract.*

## Deployment Checks, Common Mistakes, And Interview-Ready Understanding

Before Cedar Books ships structured invoice extraction, it should run a launch review with engineering, AP operations, security, and finance. The team should inspect real examples in the review UI, run evals on labeled fixtures, test duplicate handling, test low-quality scans, and verify rollback.

The practical checklist:

- Schema has stable field names, enums, nullable fields, and a version.
- Prompt config has an owner, version, eval report, and rollback label.
- Parser checks schema output before business logic runs.
- Business validation checks totals, dates, duplicate candidates, vendor match, and approval thresholds.
- Retry logic is limited, targeted, and visible in traces.
- Human review receives source snippets, document links, validation reasons, and trace ids.
- Downstream posting uses idempotency keys and internal events or commands.
- Evals cover clean, messy, missing-field, duplicate, high-value, and adversarial invoices.
- Dashboards track schema pass rate, field accuracy, review rate, retry rate, latency, cost, and reviewer overrides.

Common mistakes usually come from stopping at "valid JSON." Valid JSON can still have a wrong total. A schema-compatible object can still refer to the wrong vendor. A model can fill a required field with a guess when the source is unclear. A pipeline can auto-post an invoice without preserving the evidence reviewers need later. The fix is to treat structured output as the first gate, then use deterministic validation, review workflows, and audit records.

In an interview, explain structured outputs with the Cedar Books flow: "I design the target object from downstream needs, ask the model for schema-conforming output, parse it with a typed SDK helper, run deterministic business validation, retry only when useful, route uncertain cases to review, send clean results through an idempotent event, and evaluate field accuracy plus routing quality over labeled fixtures." That answer shows you can connect LLM output to real software instead of leaving it as text on a screen.

## References

- [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI: File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [OpenAI: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI: Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [OpenAI: Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
- [LlamaIndex: Using structured output](https://developers.llamaindex.ai/python/framework/understanding/agent/structured_output/)
- [Langfuse evaluations and prompt management](https://langfuse.com/docs)
