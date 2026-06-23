---
title: "Scanning Code and Secrets"
description: "Use SAST and secret scanning to catch risky code and exposed credentials before code reaches production."
overview: "Static code scanning and secret scanning give a delivery team an early security feedback loop. This article follows a small checkout API team as they add CodeQL, secret scanning, push protection, pull request annotations, and a simple response path for leaked credentials."
tags: ["devsecops", "sast", "secret-scanning", "code-scanning"]
order: 1
id: article-devsecops-pipeline-security-sast-and-codeql
---

## Table of Contents

1. [The Shape of Early Security Testing](#the-shape-of-early-security-testing)
2. [Static Application Security Testing](#static-application-security-testing)
3. [CodeQL in a Pull Request](#codeql-in-a-pull-request)
4. [Secret Scanning and Push Protection](#secret-scanning-and-push-protection)
5. [What the Developer Does With an Alert](#what-the-developer-does-with-an-alert)
6. [Tuning Scans Without Hiding Real Risk](#tuning-scans-without-hiding-real-risk)
7. [A Small Team Workflow](#a-small-team-workflow)
8. [What's Next](#whats-next)

## The Shape of Early Security Testing
<!-- section-summary: Early security testing gives developers feedback while the change is still small enough to fix in the pull request. -->

Imagine a small SaaS team building a checkout API. The app is a Node and TypeScript service. It accepts payment-related requests, stores order records, calls a payment provider, and deploys through GitHub Actions into staging and then production. The team is moving quickly, and most changes start as a pull request from an engineer's branch.

That pull request is the first useful place to run **application security testing**. Application security testing means checking the application for weaknesses that could let someone steal data, bypass access rules, abuse business flows, or get secrets that grant access to other systems. The earlier the team sees the problem, the smaller the fix usually is.

This article focuses on two early checks: **static application security testing**, usually shortened to **SAST**, and **secret scanning**. SAST reads source code and looks for patterns that often lead to vulnerabilities. Secret scanning reads code and commit history for credentials such as API keys, cloud tokens, private keys, and database passwords.

These checks answer different questions. SAST asks, "Could this code create a security weakness?" Secret scanning asks, "Did a credential get exposed in the repository?" For the checkout team, both questions matter. A SQL injection bug can expose order data. A leaked payment-provider token can let someone call the provider API outside the app.

Good security testing in a delivery path works like a friendly reviewer. It points to a line, explains the risk, gives the developer enough context to fix it, and leaves a record for the team. It should catch common mistakes without turning every pull request into a security meeting.

The first check in that path is SAST.

## Static Application Security Testing
<!-- section-summary: SAST reads source code before the application runs, so it can catch risky patterns while the change is still in review. -->

**Static application security testing** means analyzing code without running the application. The scanner reads files, parses functions, follows data through variables when it can, and compares what it sees with security rules. In a TypeScript API, it might inspect route handlers, request parameters, database calls, template rendering, file paths, and authentication checks.

A simple SAST finding might look like this. The checkout API adds an internal order search endpoint:

```ts
app.get("/orders/search", async (req, res) => {
  const term = String(req.query.term ?? "");
  const rows = await db.query(
    `select id, email, total from orders where email like '%${term}%'`
  );

  res.json(rows);
});
```

The developer wants a quick search box for support staff. The scanner sees user input from `req.query.term` flowing into a SQL string. That pattern can create **SQL injection**, where an attacker changes the meaning of a database query by placing SQL syntax inside input. In real production, this could mean a search endpoint returns other customers' orders or runs an unexpected database operation.

The safer version uses a parameterized query:

```ts
app.get("/orders/search", async (req, res) => {
  const term = String(req.query.term ?? "");
  const rows = await db.query(
    "select id, email, total from orders where email like $1",
    [`%${term}%`]
  );

  res.json(rows);
});
```

The SQL text and the user value travel separately. The database treats `term` as data instead of part of the SQL language. This is the kind of fix a SAST alert should lead the developer toward.

SAST can also catch hardcoded credentials, unsafe path handling, weak cryptography, risky deserialization, missing output encoding, command injection, and insecure framework calls. Some of those categories map to the OWASP Top 10, which is OWASP's awareness list of common application security risks. In the 2025 OWASP Top 10, **Broken Access Control**, **Security Misconfiguration**, **Software Supply Chain Failures**, **Injection**, and **Authentication Failures** are all areas that automated code checks can help surface, even though scanners will never understand every business rule by themselves.

That last detail matters. SAST sees code. It usually has limited context about your product, your users, your data sensitivity, and your real deployment. It can point to risky paths, but a human still decides whether the finding is real, reachable, and urgent. Later in this module, we will spend a full article on that triage work.

For now, the checkout team needs to wire SAST into GitHub.

![SAST data flow from request input to risky and safe database paths](/content-assets/articles/article-devsecops-pipeline-security-sast-and-codeql/sast-data-flow.png)

*This visual shows why a SAST alert is more useful than a generic warning: it traces user input from the source, through the risky SQL string path, and toward the database sink.*

## CodeQL in a Pull Request
<!-- section-summary: CodeQL turns security queries into pull request feedback, repository alerts, and reviewable evidence. -->

GitHub's built-in code scanning commonly uses **CodeQL**. CodeQL treats code like data. It builds a database from the repository and runs security queries against that database. A query can ask, for example, whether request input reaches a SQL execution sink without passing through a safe parameterization step.

GitHub gives teams two setup paths. **Default setup** lets GitHub choose the supported languages, query suite, and common trigger behavior for the repository. **Advanced setup** creates a workflow file that the team can customize. A small team usually starts with default setup because it gives coverage quickly. A team with monorepos, unusual build steps, custom query packs, or stricter schedules usually moves to advanced setup.

An advanced CodeQL workflow for a TypeScript API often looks like this:

```yaml
name: CodeQL

on:
  pull_request:
    branches: ["main"]
  push:
    branches: ["main"]
  schedule:
    - cron: "23 3 * * 1"

permissions:
  security-events: write
  packages: read
  actions: read
  contents: read

jobs:
  analyze:
    name: Analyze TypeScript
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: javascript-typescript

      - name: Autobuild
        uses: github/codeql-action/autobuild@v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4
```

The workflow runs on pull requests, on pushes to `main`, and on a weekly schedule. The pull request run gives fast feedback before merge. The push and schedule runs keep the default branch visible because some findings appear only after dependencies, generated files, or analysis behavior changes.

When CodeQL finds a problem in a pull request, GitHub can annotate the changed line and show a code scanning alert. The developer sees the file, the line, the rule, the data flow when available, and a security explanation. This is much better than a separate PDF report because the feedback appears where the developer is already working.

The checkout team should choose the gate carefully. A practical first gate is: block merge on new high-confidence, high-severity alerts in changed code, while sending lower-severity alerts to the repository security queue. This keeps the pull request useful. If the team blocks every warning on day one, people will start looking for ways around the scanner instead of fixing the risk.

Code scanning can also ingest results from other tools through **SARIF**, the Static Analysis Results Interchange Format. SARIF is a standard JSON format for static analysis output. If the team later adds Semgrep, a commercial SAST scanner, or a language-specific analyzer, they can upload SARIF so developers still review findings in one place.

SAST handles risky code. The next problem is more direct: a secret appears in a commit.

## Secret Scanning and Push Protection
<!-- section-summary: Secret scanning finds exposed credentials, and push protection can stop many supported secrets before they enter the repository. -->

A **secret** is a value that proves access to another system. API tokens, cloud access keys, private keys, database passwords, webhook signing secrets, and OAuth client secrets all count. If a secret reaches a Git repository, treat it as exposed. Even a private repository has clones on laptops, CI runners, backups, forks, and integration systems.

Here is a realistic mistake from the checkout team:

```ts
export const paymentClient = new PaymentClient({
  apiKey: "sk_live_51NwExampleDoNotUseThisValue",
  timeoutMs: 3000
});
```

The developer was testing a payment-provider integration and planned to move the key into the secret manager later. The line gets committed. If the key reaches the remote repository, the team now has an incident response task, not just a code cleanup task.

The safer application pattern is to keep the value out of source code and read a named secret at runtime:

```ts
const paymentApiKey = process.env.PAYMENT_API_KEY;

if (!paymentApiKey) {
  throw new Error("PAYMENT_API_KEY is required");
}

export const paymentClient = new PaymentClient({
  apiKey: paymentApiKey,
  timeoutMs: 3000
});
```

In production, the deployment system injects `PAYMENT_API_KEY` from a controlled secret store, such as a GitHub Actions environment secret, a cloud secret manager, or a Kubernetes Secret. The repository stores the secret name and the wiring, not the secret value.

**Secret scanning** looks for known credential patterns in repositories. GitHub secret scanning can detect many provider token formats, and some providers participate in partner alerting so exposed tokens can be reported back to the provider. Detection usually depends on the token format. A random string named `TOKEN` may require custom patterns, while a well-structured provider token is easier to detect with confidence.

**Push protection** moves the check earlier. Instead of waiting until the secret lands in the repository, it scans the pushed commits and blocks supported high-confidence secrets before GitHub accepts the push. The developer sees a message in the terminal or IDE and can remove the secret before it enters shared history.

For the checkout team, the first setup should include three layers:

1. Enable secret scanning for the repository or organization.
2. Enable push protection so supported secrets are blocked before they land.
3. Add custom patterns for internal token formats that GitHub cannot know by default.

A custom internal token might use a prefix like `dp_live_` followed by a long random value. The prefix helps humans and tools recognize the token. Many real teams design internal tokens with recognizable prefixes for exactly this reason. A token that looks like plain random text is harder to scan for without false positives.

When push protection blocks a secret, the developer should remove the secret from the commit, move the value into the approved secret store, and create a new credential if the original value may have been exposed. The exact command depends on the Git state, but the common flow is:

```bash
git restore --source=HEAD~1 -- path/to/file.ts
git add path/to/file.ts
git commit --amend
git push
```

That example restores the file from the previous commit, amends the current commit, and pushes again. If several commits contain the secret, the developer may need an interactive rebase or a history rewrite. The important part is the security step: **rotate the credential**. Removing the line from code reduces future exposure, but a credential that already left the laptop may still be compromised.

Now the scanner has done its job. A developer still needs to act on the alert.

![Secret push protection blocks an exposed key before safe rotation and deployment](/content-assets/articles/article-devsecops-pipeline-security-sast-and-codeql/secret-push-protection.png)

*This flow shows the practical response to a leaked key: block the push when possible, move the value into a secret store, rotate the provider key, and verify the safe deployment path.*

## What the Developer Does With an Alert
<!-- section-summary: A useful alert workflow gives the developer a clear fix path, a way to verify the fix, and an escalation path for real leaks. -->

Security alerts work best when the developer knows the next move. The checkout team should write a small runbook before turning on strict gates. A runbook is a short operating guide that says who does what when a tool reports a problem.

For a CodeQL alert in a pull request, the developer should start by reading the data flow and the rule explanation. The question is practical: can input controlled by a user reach a dangerous operation without the expected protection? In the SQL example, the answer is yes. The fix is to use a parameterized query and add a regression test that sends a suspicious search term.

A useful test might look like this:

```ts
it("searches orders without treating the term as SQL", async () => {
  const response = await request(app)
    .get("/orders/search")
    .query({ term: "' OR '1'='1" })
    .expect(200);

  expect(response.body).toEqual([]);
});
```

That test checks the behavior the team cares about: the input should stay data. The CodeQL re-run then checks the code pattern. Together they give the reviewer confidence.

For a secret scanning alert, the developer and the service owner should move faster. The safe path is:

1. Identify what system the secret opens.
2. Revoke or rotate the credential in that system.
3. Replace the application configuration with a reference to the approved secret store.
4. Remove the secret from the code path and, when needed, from Git history.
5. Check logs for unexpected use of the exposed credential.
6. Close the alert with a note that names the rotation and verification evidence.

For the checkout API, a good closure note might say: "Rotated Stripe restricted key `rk_live_...` at 2026-06-21 14:10 UTC, replaced GitHub Actions secret `PAYMENT_API_KEY`, redeployed staging, searched provider logs from first exposed commit to rotation time, no unknown source IPs found."

That note gives the future reviewer something concrete. It says what changed, when it changed, where the new secret lives, and what evidence was checked.

Once the team knows how to respond, the next task is tuning the tools so alerts stay useful.

## Tuning Scans Without Hiding Real Risk
<!-- section-summary: Tuning should reduce noise through scoped rules, better code patterns, and clear dismissals instead of broad silencing. -->

Every scanner produces some noise. Noise means alerts that do not matter for the application, duplicate alerts from the same root cause, alerts in generated files, or findings that need product context to understand. The answer is tuning, but tuning needs discipline.

Start with scope. Generated files, build output, vendored libraries, and test fixtures often create findings that the application team cannot fix directly. Excluding those paths can make sense. A path exclusion should be specific, like `dist/**` or `fixtures/vulnerable-examples/**`, with a short reason in the workflow or tool configuration.

Then look at code patterns. If CodeQL reports repeated unsafe SQL construction, the strongest fix may be a shared database helper that only accepts parameterized calls. If secret scanning finds test keys in fixtures, the team can replace them with clearly fake values that match no provider token format, such as `example_test_key_for_docs_only`.

Use dismissals carefully. A **false positive** means the scanner reported a problem that the code does not actually have. For example, a CodeQL query might miss a custom sanitizer and report a path that is safe. A **won't fix** or accepted-risk decision means the finding is real, but the team has chosen not to fix it right now. Those are different decisions and should have different evidence.

A good dismissal comment includes four things:

| Evidence | Example |
|---|---|
| Why the alert does not require a code change | `Input passes through validateCheckoutSearchTerm before db.query` |
| What proof was checked | `Unit test covers quote characters and wildcard input` |
| Who owns the decision | `Approved by appsec and checkout service owner` |
| When to revisit | `Review if search parser changes or before external API release` |

This is where industrial practice matters. Mature teams measure scanner health. They watch alert age, reopen rate, number of ignored alerts, and how many repositories have coverage. They also avoid using a single tool as the whole security program. SAST and secret scanning are early signals. They sit beside dependency scanning, software composition analysis, code review, threat modeling, dynamic testing, penetration testing, and incident response.

The checkout team can now put the pieces together.

## A Small Team Workflow
<!-- section-summary: A practical workflow combines early code checks, secret controls, clear gates, and a response path developers can follow. -->

Here is a clean starting workflow for the checkout API.

First, the repository enables CodeQL default setup. The team lets it run for a week, reviews the initial alert list, fixes the obvious high-risk findings, and records the few dismissals with evidence. After that, they decide whether default setup is enough or whether the repository needs an advanced workflow.

Second, the team enables secret scanning and push protection at the organization level for all eligible repositories. They add custom patterns for internal `dp_live_` and `dp_test_` tokens. They also update developer docs so local `.env` files stay local and production secrets live in the deployment secret store.

Third, the pull request rules become clear. New critical or high code scanning alerts in changed application code block the merge. Secret scanning push protection blocks supported secrets before they land. A bypass needs a reason, and a bypass alert goes to the security queue.

Fourth, the team keeps a weekly security review. The meeting stays small: 30 minutes where the service owner and one security-minded engineer check open alerts, old dismissals, and noisy rules. Anything real gets an owner and a due date. Anything unclear gets a short investigation task.

Finally, every fix gets verified in the same place the alert appeared. The SQL injection fix gets a test and a clean CodeQL rerun. The leaked payment key gets rotation evidence and log review. The custom token pattern gets a test token in a private scanner test repository so the team knows the pattern works.

This gives the team an early warning system. Code scanning catches risky code before it merges. Secret scanning catches exposed credentials before or shortly after they appear. Pull request annotations keep the feedback close to the developer. Triage notes keep the history understandable.

![Code and secret scanning loop from pull request through evidence notes](/content-assets/articles/article-devsecops-pipeline-security-sast-and-codeql/code-secret-scanning-loop.png)

*This summary connects the whole article: pull request checks, code scanning, secret scanning, fix or rotation work, merge gates, and evidence notes all support the same delivery loop.*

Early scans still inspect code and commits. The next layer needs to inspect a running application.

## What's Next
<!-- section-summary: The next article runs the application and API, then checks behavior that source scanning cannot fully prove. -->

The checkout team now has code scanning and secret scanning in the delivery path. That is a strong start, but some security bugs only show up when the application is running. Authentication flows, cookies, redirects, CORS behavior, rate limits, object-level authorization, and API response shapes all depend on runtime behavior.

The next article adds **dynamic application security testing** and **API testing**. We will point a scanner at the running checkout API in staging, feed it an OpenAPI definition, use a test user token, and see how runtime testing catches behavior that static scans may miss.

---

**References**

- [GitHub Docs: Code scanning](https://docs.github.com/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/about-code-scanning) - Defines GitHub code scanning and how alerts appear in a repository.
- [GitHub Docs: Code scanning with CodeQL](https://docs.github.com/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql) - Explains CodeQL default setup, advanced setup, and external CI usage.
- [GitHub Docs: Configuring default setup for code scanning](https://docs.github.com/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning) - Documents the default setup path for CodeQL analysis.
- [GitHub Docs: SARIF files for code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/sarif-files) - Describes SARIF version support and upload methods for third-party scanning tools.
- [GitHub Docs: Secret scanning](https://docs.github.com/code-security/secret-scanning/about-secret-scanning) - Describes GitHub secret scanning for exposed credentials.
- [GitHub Docs: Push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection) - Explains how push protection blocks supported secrets before they reach a repository.
- [GitHub Docs: Enabling push protection](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection) - Documents enabling push protection and bypass alert behavior.
- [GitHub Docs: Using secrets in GitHub Actions](https://docs.github.com/actions/security-guides/using-secrets-in-github-actions) - Documents repository, environment, and organization secrets for workflow use.
- [Kubernetes Docs: Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Explains how Kubernetes Secrets can provide credentials to Pods, including environment variables and volume mounts.
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) - Lists the 2025 OWASP Top 10 application security risk categories.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) - Provides a basis for testing application security controls.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - Recommends secure software development practices that can be integrated into SDLC workflows.
