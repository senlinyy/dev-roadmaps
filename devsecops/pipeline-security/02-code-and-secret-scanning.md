---
title: "Scanning Code and Secrets"
description: "Audit source files for vulnerabilities and exposed credentials before code runs."
overview: "Static scanners inspect code syntax and configuration history. This article explains static application security testing (SAST), data flow paths, pre-push secret blocking, and alert triage."
tags: ["sast", "codeql", "secret-scanning", "pre-commit"]
order: 2
id: article-devsecops-pipeline-security-sast-and-codeql
aliases:
  - sast-and-codeql
  - article-devsecops-pipeline-security-sast-and-codeql
  - devsecops/pipeline-security/sast-and-codeql.md
  - secret-scanning
  - article-devsecops-pipeline-security-secret-scanning
  - devsecops/pipeline-security/secret-scanning.md
---

## Table of Contents

1. [The Danger of Exposed Secrets and Vulnerabilities](#the-danger-of-exposed-secrets-and-vulnerabilities)
2. [What Is Static Analysis (SAST)?](#what-is-static-analysis-sast)
3. [Understanding Sources and Sinks](#understanding-sources-and-sinks)
4. [Tracing the Data Flow Path](#tracing-the-data-flow-path)
5. [Configuring a CodeQL Workflow](#configuring-a-codeql-workflow)
6. [Triage and Dismissal Evidence](#triage-and-dismissal-evidence)
7. [Secrets Scanning and Push Protection](#secrets-scanning-and-push-protection)
8. [Writing a Local Git Pre-Push Hook](#writing-a-local-git-pre-push-hook)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Danger of Exposed Secrets and Vulnerabilities

A Git repository is more than just a folder of files; it is an append-only archive of a software product's entire historical development. Every commit, every line of code, and every configuration tweak is stored permanently inside the `.git` database. Even if a developer deletes a line of code in a subsequent commit, that line remains perfectly preserved in the repository's history, fully accessible to anyone who clones or inspects the project. This persistent, immutable design creates extreme security risks when we accidentally commit sensitive credentials or write insecure code. Consider these three common engineering failures:

First, consider the accidental exposure of cloud credentials. A developer, trying to debug an active database connection locally, temporarily pastes an active cloud API access key directly into a configuration file. Intending to clean it up before merging, they accidentally stage the file, create a commit, and push it to a public repository. Within seconds, automated crawling bots—which constantly monitor public Git feeds looking for credential patterns—scrape the key. Before the developer can even load their browser to delete the commit, the bots have already assumed the cloud identity, spun up thousands of unauthorized compute instances, and generated massive financial liabilities.

Second, consider the unvetted path of dynamic code execution. A developer adds a simple search input to a web application, constructing the SQL query by directly appending the client's search string. During local testing, the search works perfectly. Because the team has not established automated code analysis, the change is merged directly to the main branch after a brief review of the interface layout. Shortly after deployment, an attacker notices that the search endpoint is unprotected. By sending a custom SQL command in the query string, they manipulate the database into bypassing authentication checks, dumping private user tables, or purging database schemas.

Third, consider the silent leak of high-privilege credentials on private branches. A security team sets up automated static scanning on their main branch, believing they have secured the perimeter. However, because they have no active push gates, developers continue committing active keys, database passwords, and OAuth tokens to remote feature branches. Although the main branch appears clean, these secrets lie fully exposed inside the repository's history. When a contractor is onboarded or the repository is shared, the credentials are leaked, forcing the operations team to execute emergency, high-stress rotations of all database passwords and API tokens.

To shield our source code repositories from these exposures, we must implement two distinct automated scanning disciplines: **Static Application Security Testing (SAST)** to audit our application logic, and **Secret Scanning** to intercept hardcoded credentials.

## What Is Static Analysis (SAST)?

Static Application Security Testing (SAST) is the practice of reading and analyzing application source files before the application is compiled or executed. 

Unlike dynamic testing (which runs the server and sends mock exploit requests), a SAST scanner parses the code structure, converts the text into an abstract syntax tree (AST), and matches code patterns against a database of known security vulnerabilities (like SQL injection, cross-site scripting, and path traversal).

SAST is incredibly valuable because it audits every single code path automatically, catching edge cases that human reviewers might miss in a large pull request. However, because static scanners only read the code text, they do not understand operational reality. An alert represents a *potential* vulnerability that requires a human reviewer to verify.

## Understanding Sources and Sinks

To investigate and resolve SAST alerts quickly, we must understand the core architecture of data-flow analysis. Static scanners do not merely read your code as raw text; they compile it into an Abstract Syntax Tree (AST), which represents the grammatical structure of your program. Using this tree, the scanner performs a technique called **Taint Tracking**. Taint tracking treats untrusted user inputs as a "tainted" fluid that enters the system. The scanner maps the paths this fluid can take as it flows through variables, operations, and functions, ensuring it never reaches a critical system operation without being disinfected. This analysis relies on three fundamental concepts:

The first concept is the **Source**. A source is any entry point in the application where external, unverified data can enter the program's memory. This includes HTTP query parameters, request bodies, header strings, command-line arguments, or environment variables. Because this data is completely controlled by the user, we must assume it is hostile.

The second concept is the **Sink**. A sink is a sensitive system function that performs a critical execution or system operation. Examples of sinks include database query engines, system command shells, filesystem read-and-write APIs, and HTML rendering engines. Sinks are highly powerful; if they receive raw, untrusted data, they can be manipulated into executing malicious commands, leaking sensitive files, or running arbitrary scripts.

The third concept is the **Path**. The path represents the complete, chronological journey that tainted data takes as it moves through your codebase. It documents how a variable is passed from one function to another, converted to a string, concatenated with other values, and eventually passed into a sink.

Consider this vulnerable Node.js endpoint:

```typescript
// src/routes/orders.ts
app.get('/orders/search', async (req, res) => {
  const status = String(req.query.status ?? '');
  
  // Vulnerable SQL concatenation
  const rows = await db.query(`select * from orders where status = '${status}'`);
  res.json(rows);
});
```

By analyzing this endpoint, the static scanner constructs a clear data-flow graph. The input `req.query.status` is identified as the **Source** because it is a client-controlled URL parameter. The function `db.query(...)` is flagged as the **Sink** because it accepts an SQL query string and executes it directly against the active database. The **Path** is the string interpolation that places the raw, unverified `status` variable directly inside the executable query string. 

If a client sends the string `shipped' OR '1'='1`, the database engine parses the string as active SQL commands rather than a literal value. It executes `select * from orders where status = 'shipped' OR '1'='1'`. Because `1=1` is always true, the database bypasses all filters and returns every single order in the system, leaking private transaction history.

## Tracing the Data Flow Path

In modern enterprise applications, data is rarely processed in a single, simple router function. It is passed through middleware, routed to utility libraries, validated in helper classes, and executed in separate database abstraction layers. Modern SAST engines, such as CodeQL, are designed to perform inter-procedural data-flow analysis, tracing taint propagation across multiple functions, files, and dependency boundaries.

For example, if your application processes a search parameter through an external utility function in a different directory before querying the database, CodeQL compiles a step-by-step path detailing exactly how the untrusted input travelled through the application graph:

First, the data enters the application at the input source, where `req.query.status` is captured in the router file `src/routes/orders.ts`. The scanner labels this exact memory allocation as tainted.

Second, the code passes the tainted variable to a utility helper, calling a conversion function in `src/utils/sanitize.ts`. The scanner follows this call, updating the AST path to show that the return value of `String(req.query.status)` remains tainted because no sanitization occurred.

Third, the tainted string is passed into a query generation class in `src/lib/order-search.ts`. The code concatenates the tainted input with an SQL template string. The scanner notes that the resulting query string inherits the taint.

Fourth, the fully constructed query string is returned to the main database execution layer and passed directly into the SQL execution sink `db.query(sql)` back in `src/routes/orders.ts`. 

This step-by-step trace explains exactly *why* the scanner flagged the code. The human reviewer does not have to guess or manually search the codebase to understand the vulnerability. They can inspect the path, verify that no parameter validation or sanitization occurred along the way, and implement the standard mitigation: **parameterized queries**.

```typescript
// Secure parameterized query
app.get('/orders/search', async (req, res) => {
  const status = String(req.query.status ?? '');
  
  // Value passes as separate parameter ($1), not SQL syntax
  const rows = await db.query('select * from orders where status = $1', [status]);
  res.json(rows);
});
```

Using a parameterized query completely secures the sink. The database engine treats the parameter `$1` strictly as a literal data value, never executing it as SQL commands. Even if the attacker passes the same `shipped' OR '1'='1` string, the query safely searches for orders where the status literally matches that exact text, returning zero results and keeping the system secure.

## Configuring a CodeQL Workflow

CodeQL is GitHub's native semantic analysis engine. It compiles your codebase into a queryable database and executes security rules against it. We integrate CodeQL into our pipelines using a simple workflow file:

```yaml
name: codeql-analysis

on:
  pull_request:
    branches: ["main"]
  push:
    branches: ["main"]

permissions:
  contents: read
  security-events: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Initialize CodeQL database
      - uses: github/codeql-action/init@v4
        with:
          languages: javascript-typescript
          queries: security-extended
          
      # Run queries and upload results to GitHub
      - uses: github/codeql-action/analyze@v4
```

Notice the security choices in this configuration:
* **Scoped Write Permissions**: The runner is granted `security-events: write` so it can upload the scanning results to GitHub's code security panel. It is denied generic repository write permissions.
* **Extended Queries**: We configure `queries: security-extended` to ensure CodeQL scans for deep logic flaws and OWASP Top 10 vulnerabilities rather than only basic syntax errors.

## Triage and Dismissal Evidence

When a SAST scanner runs across a large, complex codebase, it will occasionally flag data-flow paths that appear to be vulnerabilities but are actually secure. These are called **False Positives**. For example, the scanner might flag a potential SQL injection path because it cannot trace that a robust, custom validation middleware has already sanitized the input before it reached the query. When this happens, we must never simply ignore the alert, delete the scanner rule, or bypass the build gate. Instead, we must perform a formal security triage, recording explicit **dismissal evidence** directly in the repository's security dashboard.

To document a secure bypass, the triaging engineer must build a complete, auditable record. This starts by identifying the exact rule flagged, such as `js/sql-injection`, and declaring the formal triage decision, which in this case is "Dismissed as a False Positive." 

Next, the engineer must document the active **Compensating Control**. A compensating control is the specific operational safeguard that makes the path safe. For instance, you would document that the client-controlled status parameter is validated against a strict, hardcoded allowlist—such as `['created', 'paid', 'shipped']`—in the router's validation middleware. Because the middleware throws an immediate HTTP 400 error for any value not in that list, malicious SQL syntax can never reach the database query.

Finally, the engineer must provide an active evidence link, referencing the exact file and line number of the validation logic (for example, `src/middleware/validate.ts`, line 12), and secure a formal sign-off from a peer or platform security lead.

These structured triage records are essential for team alignment and compliance. Without documented evidence, other developers cannot know why a security warning was bypassed, leading to confusion and potential regressions where someone accidentally removes the validator. Furthermore, security auditors will immediately flag open, undocumented alerts during regulatory compliance reviews. By recording clear, verifiable triage evidence, we maintain a secure, auditable codebase without blocking development velocity.

## Secrets Scanning and Push Protection

Secret scanning is the practice of scanning committed files to detect hardcoded credentials (like passwords, OAuth tokens, and private keys) before or after they reach the remote repository.

Traditional scanners operate *after* a push has landed on the remote server. While this flags the leak, the secret is already recorded in the Git history. Rotating the secret is the only secure resolution.

To solve this, modern platforms use **Push Protection**. When a developer attempts to execute a `git push`, the remote server scans the incoming commits *before* accepting them. If a secret pattern is detected, the push is rejected instantly:

```text
git push origin main
[remote rejected] main -> main (pre-receive hook declined)
error: Push rejected due to exposed secrets.
- Secret Type: AWS Access Key
- File: src/config/aws.js
- Line: 42
- Resolution: Remove the secret, squash commits, and push again.
```

Push protection blocks the leak before the secret ever enters the remote Git history, preventing exposure and saving hours of rotation cleanup.

## Writing a Local Git Pre-Push Hook

We can implement local push protection on our own machines using a Git pre-push hook. This script executes locally on your laptop whenever you run `git push`, blocking the operation if it detects potential keys:

```bash
#!/bin/bash
# .git/hooks/pre-push

# Patterns matching sensitive keys (e.g., private keys, slack tokens)
SECRET_PATTERNS="(xoxb-|BEGIN PRIVATE KEY|aws_access_key_id)"

# Scan commits being pushed for sensitive patterns
if git diff --cached | grep -E -q "$SECRET_PATTERNS"; then
  echo "=================================================================="
  echo "ERROR: Potential credential leak detected in your local commit!"
  echo "The push has been blocked locally to prevent exposure."
  echo "Please remove the credential from your code and try again."
  echo "=================================================================="
  exit 1
fi

exit 0
```

To activate this hook locally:
* Save the script as `.git/hooks/pre-push`.
* Make the file executable by running `chmod +x .git/hooks/pre-push` in your terminal.

Once active, the hook scans your staged changes locally, sandboxing your credentials on your laptop before they can ever reach the remote server.

## Putting It All Together

Auditing our first-party codebase and intercepting credential leaks are the primary repository guardrails of DevSecOps. By combining CodeQL's automated inter-procedural data-flow analysis with Git remote push-protection gates, we catch both structural code flaws and hardcoded secrets before they can ever reach our active build runners or land in our active commits.

When securing and auditing your code repositories, ensure you maintain these five core practices:

First, implement source-sink analysis as a standard part of your threat modeling. Map all entry points where untrusted user input enters your application, trace their variables across helper functions, and ensure they are thoroughly sanitized or validated before they reach any database, shell command, or filesystem execution sink.

Second, mandate parameterized queries across all database operations. Never construct SQL statements, command line parameters, or filesystem arguments by interpolating raw strings. By passing variables as separate, literal parameters, you ensure the database engine never parses user inputs as executable commands.

Third, run automated static analysis on every pull request. Integrate tools like CodeQL into your validation pipelines, granting them minimal `security-events: write` permissions so they can publish scan results to your security dashboard while keeping your source code write-protected.

Fourth, enable platform-level push protection. Configure your Git hosting platform to scan incoming commits before they are merged into the remote repository. By rejecting pushes that contain active API keys, Slack tokens, or private certificates, you block credential leaks before they become permanent parts of your Git history.

Fifth, distribute local git pre-push hooks within your engineering team. Share standard pre-push scripts that automatically scan staged changes on a developer's laptop. By running these checks locally before the commit is sent to the remote host, you create an immediate, desktop-level sandbox that prevents secrets from ever leaving the machine.

## What's Next

Auditing our first-party codebase secures the code we write. In the next chapter, we will cover **Dependency and Artifact Security**, learning how to analyze third-party packages, verify Software Bills of Materials (SBOMs), and cryptographically sign completed build artifacts before deployment.

---

**References**

- [GitHub Security Guides - About CodeQL Code Scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql) - Reference on database compilation, scanning runs, and query packs.
- [GitHub Security Guides - Secret Scanning and Push Protection](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning-with-push-protection) - Official documentation on intercepting exposed credentials before remote commits.
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) - Technical guidance on parameterized queries, input validation, and stored procedures.
- [Git Hook Reference - Pre-Push Hooks](https://git-scm.com/docs/githooks#_pre_push) - Documentation on Git hooks syntax, execution triggers, and exit codes.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST recommendations on automated static code analysis, vulnerability remediation, and secret detection.
