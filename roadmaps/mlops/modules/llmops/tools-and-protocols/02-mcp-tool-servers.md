---
title: "MCP Tool Servers"
description: "Build MCP servers that expose tools, resources, and prompts to agents while keeping warehouse credentials, scopes, protocol boundaries, and traces under control."
overview: "Learn how an analytics team can expose a data warehouse through an MCP server with safe query tools, schema resources, reusable prompts, auth scopes, and operational checks."
tags: ["MLOps","LLMOps","advanced","tools"]
order: 2
id: "article-mlops-llmops-mcp-tool-servers"
---

## What an MCP Tool Server Does

<!-- section-summary: An MCP server gives an AI application a standard way to discover tools, read resources, and use prompt templates. The server owns system access, while the client decides which context and tools to offer to the model. -->

An **MCP tool server** is a small service that exposes useful capabilities to AI clients through the Model Context Protocol. MCP stands for Model Context Protocol. The official specification describes three main server features: **tools**, **resources**, and **prompts**. Tools are executable actions, resources are context or data that a client can read, and prompts are reusable templates that a user or client can select.

The key idea is separation. The AI client, such as an agent runtime or an IDE assistant, stays free of direct credentials for every system in your company. The MCP server sits at the boundary. It knows how to talk to the warehouse, the ticketing system, the document store, or the deployment API. The client discovers what the server offers, asks for resources, and requests tool calls. The server handles auth, validation, rate limits, and result formatting.

In this article, we will build around **MetricLake**, an analytics team that runs a warehouse used by product managers, data scientists, and LLM agents. The first agent use case is simple: a product analyst asks, "Which onboarding step lost the most users last week, and can you draft a follow-up analysis plan?" The agent needs schema context, a safe query path, and a reusable prompt for analysis. Giving the model raw warehouse credentials would be reckless. An MCP server gives the team a controlled doorway.

This topic follows naturally from tool contracts. A tool contract defines one action. An MCP server gives clients a standard way to discover many contracts, nearby resources, and prompt workflows. The server can expose a `run_readonly_query` tool, a `warehouse://schema/funnels` resource, and an `investigate_metric_drop` prompt from one place.

## Tools, Resources, and Prompts

<!-- section-summary: MCP tools, resources, and prompts have different jobs. Keeping those jobs separate helps teams avoid turning every piece of context into a risky action. -->

MCP's three server features answer three different questions.

| Feature | Plain-English purpose | MetricLake example |
| --- | --- | --- |
| Tool | "Do this action and return a result." | Run a read-only SQL query with a row limit. |
| Resource | "Here is context the client can read." | Show the schema for approved analytics tables. |
| Prompt | "Here is a reusable workflow template." | Guide the agent through a metric-drop investigation. |

A common beginner mistake is to use tools for everything. If the agent needs table descriptions, expose a resource. If the analyst wants a standard investigation flow, expose a prompt. Save tools for operations with execution cost, access risk, or external side effects. Even a read-only warehouse query can be expensive or privacy-sensitive, so it deserves validation and audit logs.

For MetricLake, the server exposes these capabilities:

- `run_readonly_query`: a tool that executes a validated SELECT query against approved views.
- `warehouse://schema/product_funnels`: a resource that returns table names, columns, descriptions, and freshness.
- `warehouse://sample/onboarding_events`: a resource that returns a small redacted sample.
- `investigate_metric_drop`: a prompt that asks the model to compare baseline, segment, query evidence, and next actions.

The client decides how to present these capabilities to the model. A chat product might show a prompt picker to the analyst. An agent runtime might load the schema resource automatically when the user asks about onboarding. A governance layer might hide the query tool unless the user has the `analytics.query:read` scope.

![MetricLake MCP server capabilities and flow](/content-assets/articles/article-mlops-llmops-mcp-tool-servers/mcp-capabilities-flow.png)

*MetricLake exposes tools, resources, and prompts through one MCP server while credentials, policy checks, row limits, redaction, and trace IDs stay on the server side.*

## Client and Server Boundaries

<!-- section-summary: The MCP client orchestrates the conversation and model calls, while the server owns integrations with protected systems. This boundary keeps secrets and business policy out of prompts. -->

The **client** is the application running the AI workflow. It connects to the MCP server, lists available tools, reads resources, retrieves prompts, and decides what to include in the model request. The **server** owns the integration with the external system. It validates tool arguments, checks scopes, calls the warehouse, and returns a controlled result.

For MetricLake, the warehouse password stays on the server. The model never sees it. The client receives only the tool definition and the results that the server chooses to return. This matters because prompts and model outputs can travel through logs, traces, evaluation datasets, and support screenshots. Secrets belong in the server runtime and stay out of model context.

Here is the boundary in a simple request flow:

1. The analyst opens the AI analysis client and signs in.
2. The client connects to the MetricLake MCP server with the analyst's access token.
3. The client asks the server which tools, resources, and prompts are available.
4. The client gives the model the safe tool definitions and selected resource context.
5. The model requests `run_readonly_query`.
6. The client forwards the tool call to the MCP server.
7. The server validates SQL, checks scopes, runs the query, redacts rows, and returns an envelope.
8. The client gives the result back to the model so it can answer the analyst.

That flow gives you two useful audit trails. The agent trace shows why the model chose the tool. The MCP server logs show what the server actually ran. During an incident, you need both. The model might have requested a broad query, while the server may have narrowed it, rejected it, or capped the result.

## A Small Warehouse MCP Server

<!-- section-summary: A practical MCP server wraps real business systems with small, well-described tools and resources. The example below uses the official Python SDK style to keep the code compact. -->

The official MCP Python SDK includes a `FastMCP` helper that can expose tools, resources, and prompts with decorators. The exact production server may use Streamable HTTP, a framework integration, or a deployment platform. This teaching example keeps the core shape small.

```python
from typing import Literal

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

mcp = FastMCP("metriclake-warehouse", json_response=True)

class QueryRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=4000)
    purpose: str = Field(min_length=10, max_length=300)
    max_rows: int = Field(ge=1, le=200)
    trace_id: str = Field(pattern=r"^trc_[0-9a-f]{32}$")
    result_format: Literal["table", "summary"] = "table"

@mcp.resource("warehouse://schema/product_funnels")
def product_funnels_schema() -> str:
    return """
    approved_views:
      product_funnels.onboarding_events:
        columns:
          - event_date: DATE
          - account_id_hash: STRING
          - step_name: STRING
          - reached_step: BOOL
          - plan_tier: STRING
        freshness_sla: 2 hours
        pii: redacted
      product_funnels.weekly_conversion:
        columns:
          - week_start: DATE
          - step_name: STRING
          - conversion_rate: FLOAT
          - sample_size: INT
        freshness_sla: 6 hours
        pii: none
    """

@mcp.prompt()
def investigate_metric_drop(metric_name: str, week_start: str) -> str:
    return f"""
    Investigate {metric_name} for the week starting {week_start}.
    Compare the latest week with the previous four-week baseline.
    Segment by plan_tier and onboarding step.
    Use warehouse evidence before drafting a product ticket.
    Include query IDs, assumptions, and follow-up checks.
    """

@mcp.tool()
def run_readonly_query(request: QueryRequest) -> dict:
    auth = current_auth_context()
    require_scope(auth, "analytics.query:read")
    require_scope(auth, "analytics.product_funnels:read")

    parsed = parse_sql(request.sql)
    enforce_select_only(parsed)
    enforce_approved_views(parsed, allowed_prefixes=["product_funnels."])
    enforce_limit(parsed, max_rows=request.max_rows)

    result = warehouse.query(
        sql=request.sql,
        user_id=auth.user_id,
        trace_id=request.trace_id,
        timeout_seconds=15
    )

    return {
        "status": "success",
        "trace_id": request.trace_id,
        "query_id": result.query_id,
        "row_count": len(result.rows),
        "columns": result.columns,
        "rows": redact_rows(result.rows),
        "freshness": result.freshness.isoformat()
    }
```

The code teaches several production habits. The resource gives schema context without running a query. The prompt gives the agent a repeatable investigation workflow. The tool accepts structured input through a Pydantic model, checks scopes, parses SQL, enforces approved views, applies row limits, and returns a compact result.

The SQL parser is important. String checks such as searching for `"drop"` or `"delete"` are too weak for warehouse access control. Use a real parser in production, then allow only SELECT statements against approved views. Keep the allowlist close to the data governance owner. The agent should query curated views such as `product_funnels.weekly_conversion`, rather than raw event tables with sensitive columns.

## Auth Scopes and Server Manifests

<!-- section-summary: MCP servers need auth rules that match the systems they front. A manifest makes scopes, resources, prompts, owners, and data classes reviewable. -->

MCP can run over local transports or remote transports. Remote servers often sit behind OAuth or another token flow. In either case, the server should make access decisions with the caller's identity rather than a shared superuser identity. MetricLake maps identity provider groups into warehouse scopes.

Here is a manifest for the analytics MCP server.

```yaml
server: metriclake-warehouse
protocol_version: "2025-11-25"
owner: data-platform
transport:
  production: streamable-http
  local_development: stdio
auth:
  token_audience: metriclake-mcp
  required_claims:
    - sub
    - email
    - scope
scopes:
  analytics.query:read:
    allows:
      - tools.run_readonly_query
  analytics.product_funnels:read:
    allows:
      - resources.warehouse_schema_product_funnels
      - prompts.investigate_metric_drop
data_classes:
  product_funnels.weekly_conversion: aggregate
  product_funnels.onboarding_events: pseudonymous
limits:
  max_rows: 200
  query_timeout_seconds: 15
  max_queries_per_user_per_hour: 60
audit:
  log_sql: true
  log_rows: false
  log_resource_reads: true
  trace_header: x-trace-id
```

This manifest gives the security review something concrete to inspect. It says which protocol version the server targets, which transport runs in production, which claims the token must carry, which scopes unlock each capability, and how audit logs treat SQL and row data.

Be careful with server-owned credentials. The server may need a warehouse service account so it can connect efficiently, yet query authorization should still map back to the user's scopes. A common pattern is a service account for connectivity plus row policies, query tags, and audit fields that include the user ID. The warehouse audit log then shows both the technical principal and the human principal.

![MetricLake MCP security boundary for read-only queries](/content-assets/articles/article-mlops-llmops-mcp-tool-servers/security-boundary.png)

*The client carries the analyst identity, while the MCP server keeps warehouse credentials, enforces SELECT-only validation, caps results at 200 rows, and returns redacted output.*

## Result Envelopes and Failure Handling

<!-- section-summary: MCP tool results should return a stable envelope instead of raw system output. The envelope helps the agent handle validation errors, access denials, timeouts, and partial results. -->

The `run_readonly_query` tool should return a controlled envelope. The model needs enough information to answer the analyst, while engineers need enough evidence to debug the run. Avoid dumping raw database driver errors into the model. Translate errors into codes and safe messages.

```json
{
  "status": "success",
  "server": "metriclake-warehouse",
  "tool": "run_readonly_query",
  "protocol_version": "2025-11-25",
  "trace_id": "trc_2b2f4f7d8f3d4c5e9a1b0c7d6e5f4123",
  "data": {
    "query_id": "qry_01JZK77H6WT6",
    "freshness": "2026-07-05T10:15:00Z",
    "row_count": 3,
    "columns": ["step_name", "conversion_rate", "baseline_rate", "delta_points"],
    "rows": [
      ["connect_calendar", 0.41, 0.57, -16],
      ["invite_teammate", 0.36, 0.39, -3],
      ["create_first_report", 0.22, 0.24, -2]
    ]
  },
  "error": null
}
```

For an access failure, keep the same top-level fields.

```json
{
  "status": "rejected",
  "server": "metriclake-warehouse",
  "tool": "run_readonly_query",
  "protocol_version": "2025-11-25",
  "trace_id": "trc_42be2c502f7b457a9dd65f0d47beef42",
  "data": null,
  "error": {
    "code": "missing_scope",
    "message": "The caller lacks analytics.product_funnels:read.",
    "safe_next_step": "Ask a data owner for product funnel read access."
  }
}
```

For a query validation failure, show the specific rule that failed.

```json
{
  "status": "rejected",
  "server": "metriclake-warehouse",
  "tool": "run_readonly_query",
  "protocol_version": "2025-11-25",
  "trace_id": "trc_97edbca30e7c47da8e9319bbdfb41922",
  "data": null,
  "error": {
    "code": "unapproved_table",
    "message": "The query referenced raw_events.clickstream, which is outside the approved view list.",
    "safe_next_step": "Use product_funnels.weekly_conversion or request a new approved view."
  }
}
```

These envelopes help the model recover. It can ask for access, switch to an approved view, or tell the analyst that the query timed out. The envelope also helps automated evals. You can test whether the agent handles `missing_scope`, `query_timeout`, and `unapproved_table` in the right way.

## Protocol Versioning and Compatibility

<!-- section-summary: MCP server releases need a compatibility plan because clients, host applications, SDKs, and protocol versions can move at different speeds. -->

The MCP specification has dated protocol versions. A server should record which version it targets and test clients against that version. The manifest above uses `2025-11-25`, matching the current specification path checked for this article. If the server later adopts new MCP features, release that change with a compatibility note.

There are two version layers to track:

- **Protocol version:** The MCP version used for server/client behavior.
- **Capability version:** The version of your own tool, resource, or prompt contract.

For MetricLake, the protocol version is `2025-11-25`, while the query tool might have a capability version such as `run_readonly_query@2026-07-05`. If the team adds a `cost_center` argument to the query tool, that is a capability change. If the transport or MCP feature negotiation changes, that is a protocol compatibility concern.

Keep release notes plain and operational:

```yaml
release: metriclake-warehouse-mcp-2026-07-05
protocol_version: "2025-11-25"
changes:
  - added optional result_format to run_readonly_query
  - added warehouse://sample/onboarding_events resource
  - lowered max_rows from 500 to 200 for privacy review
client_requirements:
  minimum_client: metriclake-agent-client-1.8.0
rollback:
  previous_server_image: metriclake-mcp:2026-06-18
  compatible_protocol_version: "2025-11-25"
checks:
  - list tools
  - read product_funnels schema resource
  - run approved SELECT query
  - reject raw_events table query
```

This release note helps operators during a bad deploy. They can see which image to restore, which checks to run, and which behavior changed.

## Operational Checks for an MCP Server

<!-- section-summary: A production MCP server needs the same discipline as any API: tests, traces, rate limits, dashboards, access reviews, and incident runbooks. -->

Run these checks before exposing a warehouse MCP server to agents:

- **Discovery check:** The client can list tools, resources, and prompts, and the descriptions match the current registry.
- **Auth check:** A user without `analytics.query:read` can read allowed resources only when policy permits it, and query execution is rejected.
- **SQL safety check:** Non-SELECT statements, raw tables, cross-database references, and missing limits are rejected by parser-backed validation.
- **Cost check:** The server enforces timeouts, row limits, rate limits, and warehouse query tags.
- **Privacy check:** Results are redacted, row samples are small, and logs avoid row payloads.
- **Trace check:** Every tool call carries a trace ID across client, MCP server, warehouse query, and model run.
- **Prompt check:** Prompt templates use current table names and tell the agent to cite query IDs in its answer.
- **Failure check:** The agent receives stable envelopes for missing scopes, invalid SQL, timeouts, and warehouse outages.

Common mistakes show up when the server is treated as a thin proxy. A thin proxy forwards whatever SQL the model wrote. A production MCP server should behave like a governed API. It exposes a narrow surface, validates arguments, limits output, and records evidence. Another common mistake is mixing resources and tools. A schema description should usually be a resource; a query execution path should be a tool. That difference helps the client decide which capabilities can be loaded freely and which ones need stronger review.

In an interview, a strong answer is practical: "I would use MCP to expose warehouse capabilities as tools, resources, and prompts. The server keeps credentials and policy. The client controls model context and tool availability. I would use scoped auth, parser-backed SQL validation, row limits, result envelopes, protocol and capability versioning, and OpenTelemetry traces across the model run and server call."

![MetricLake MCP release and compatibility summary](/content-assets/articles/article-mlops-llmops-mcp-tool-servers/release-compatibility.png)

*MetricLake tracks MCP protocol compatibility separately from its own query capability, then proves each release with discovery, resource, query, rejection, trace, and rollback checks.*

## References

- [Model Context Protocol specification: 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP server tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP server resources specification](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP server prompts specification](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [OpenAI API docs: MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai)
