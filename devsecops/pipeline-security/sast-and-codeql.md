---
title: "SAST and CodeQL"
description: "Use static analysis to find risky source-code paths before the application runs."
overview: "Static application security testing reads code as evidence. This article explains sources, sinks, data flow, CodeQL alerts, and how to turn findings into useful fixes."
tags: ["sast", "codeql", "code-scanning"]
order: 3
id: article-devsecops-pipeline-security-sast-and-codeql
---

## Table of Contents

1. [What SAST Reads](#what-sast-reads)
2. [Sources and Sinks](#sources-and-sinks)
3. [Data Flow](#data-flow)
4. [CodeQL Alerts](#codeql-alerts)
5. [False Positives and Real Fixes](#false-positives-and-real-fixes)
6. [Review Evidence](#review-evidence)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What SAST Reads

Static application security testing, usually called SAST, reads source code before the application runs. It looks for code patterns that commonly produce security problems: user input reaching SQL queries, shell commands, templates, redirects, file paths, deserialization, or secrets.

For `devpolaris-orders-api`, SAST belongs in the pull request path. It should help reviewers notice risky code while the change is still small.

Here is a simple route handler:

```ts
app.get('/orders/search', async (req, res) => {
  const status = String(req.query.status ?? '');
  const rows = await db.query(`select * from orders where status = '${status}'`);
  res.json(rows);
});
```

The risky part is the query string. `req.query.status` comes from the HTTP request. The SQL string is built by concatenating that input into a query. A scanner does not need to run the app to see that path.

SAST is useful because humans miss repeated patterns when reviewing large changes. It is limited because it reads code through rules and models. It may misunderstand framework behavior, miss runtime configuration, or report a path that cannot happen in practice.

## Sources and Sinks

Most SAST findings are easier to understand through sources and sinks.

```text
source -> transformation -> sink
```

A source is where data enters the program. A sink is where data can cause harm if it is untrusted. Transformations are the steps in between.

| Term | Example in orders API |
|------|-----------------------|
| Source | `req.query.status`, request body, header, uploaded file |
| Transformation | `String(...)`, parser, validator, mapper |
| Sink | SQL query, shell command, file path, template render |

The vulnerable example has a request query source and a SQL query sink.

```text
req.query.status
  -> String(...)
  -> SQL query string
  -> database engine
```

The fix is to break the dangerous data flow by using a parameterized query.

```ts
app.get('/orders/search', async (req, res) => {
  const status = String(req.query.status ?? '');
  const rows = await db.query('select * from orders where status = $1', [status]);
  res.json(rows);
});
```

The input still reaches the database, but it reaches the database as a parameter, not as executable SQL text.

## Data Flow

Data flow is how a scanner follows values through the program. CodeQL is built around this idea. It treats code as a database that can be queried, then uses language models and security queries to find paths from sources to sinks.

Here is a slightly longer path:

```ts
function requestedStatus(req: Request): string {
  return String(req.query.status ?? '');
}

app.get('/orders/search', async (req, res) => {
  const status = requestedStatus(req);
  const sql = `select * from orders where status = '${status}'`;
  const rows = await db.query(sql);
  res.json(rows);
});
```

The source is now hidden behind `requestedStatus`. A simple text search for `req.query` near `db.query` may miss it. A data-flow query can still follow the returned value into the SQL string.

This is the practical value of CodeQL-style analysis. It can find paths that are spread across helper functions and files. The reviewer still has to decide whether the path is real, whether the framework model is accurate, and which fix is safest.

## CodeQL Alerts

A useful CodeQL alert should give you the rule, severity, location, path, and explanation.

```text
Rule: js/sql-injection
Severity: high
File: src/routes/orders.ts
Line: 18
Source: req.query.status
Sink: db.query(sql)
Path: req.query.status -> requestedStatus -> sql template -> db.query
```

Read the alert from bottom to top if you are debugging it. The sink tells you where harm could happen. The source tells you where untrusted input entered. The path tells you why the tool believes the two are connected.

The first question is whether the source is attacker-controlled. The second question is whether the sink interprets the value in a dangerous way. The third question is whether validation, escaping, or parameterization occurs on the path.

## False Positives and Real Fixes

A false positive is a finding that does not represent a real vulnerability in the current code. False positives happen. The response should still leave evidence.

```text
Finding: js/sql-injection
Decision: dismissed
Reason: value is selected from a fixed enum before reaching the query
Evidence: validateOrderStatus rejects values outside allowed set
Reviewer: maya-dev
```

A real fix should change the code path. Comments and suppressions should be rare. If the issue is SQL injection, use parameterization. If the issue is command injection, avoid shell interpretation or pass arguments safely. If the issue is path traversal, normalize and restrict paths to an allowed root.

For the orders API example, the useful fix is the parameterized query. It is better than adding a comment that says the input should be safe.

## Review Evidence

Keep SAST evidence small.

```text
Alert: js/sql-injection
Service: devpolaris-orders-api
Source: req.query.status
Sink: db.query
Fix: parameterized query
Pull request: #421
Status: fixed
Regression: test covers apostrophe in status input
```

The `Regression` line matters. A security fix should usually have a small test or example that proves the risky input path changed.

## Putting It All Together

SAST reads source code before the application runs. The beginner model is source, path, sink. CodeQL makes that model practical by querying code structure and data flow.

For `devpolaris-orders-api`, SAST is useful when it helps reviewers find a risky path early. It should not become a wall of unexplained alerts. Each meaningful finding needs a source, sink, path, decision, fix, and evidence.

## What's Next

SAST finds risky code paths. Secret scanning finds sensitive values that accidentally enter source, logs, or workflow output. The next article covers the small strings that can act like identities.

---

**References**

- [GitHub CodeQL documentation](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql) - GitHub explains CodeQL code scanning and how CodeQL treats code as data.
- [CodeQL data flow analysis](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/) - CodeQL documentation explains sources, sinks, and data-flow paths.
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) - OWASP documents parameterized queries and other SQL injection defenses.
