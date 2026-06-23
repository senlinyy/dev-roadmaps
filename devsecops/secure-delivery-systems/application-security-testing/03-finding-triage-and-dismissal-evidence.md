---
title: "Finding Triage and Dismissal Evidence"
description: "Decide which findings are real, urgent, reachable, accepted, or false positive, and record the decision."
overview: "Scanner output only helps when a team can turn alerts into decisions. This article follows the checkout API team as they triage code scanning, secret scanning, and runtime findings with ownership, severity, exploitability, reachability, due dates, dismissal notes, accepted risk, and verification evidence."
tags: ["devsecops", "triage", "sarif", "vulnerability-management"]
order: 3
id: article-devsecops-application-security-testing-finding-triage-dismissal-evidence
---

## Table of Contents

1. [Why Triage Exists](#why-triage-exists)
2. [The First Pass: What Is This Finding](#the-first-pass-what-is-this-finding)
3. [Severity, Exploitability, and Reachability](#severity-exploitability-and-reachability)
4. [Owners and Due Dates](#owners-and-due-dates)
5. [Duplicates, False Positives, and Accepted Risk](#duplicates-false-positives-and-accepted-risk)
6. [Dismissal Evidence](#dismissal-evidence)
7. [Verification After the Fix](#verification-after-the-fix)
8. [A Small Team Workflow](#a-small-team-workflow)

## Why Triage Exists
<!-- section-summary: Triage turns scanner alerts into decisions the team can act on, audit, and revisit later. -->

The checkout API team now has several security signals. **CodeQL** is GitHub's code-scanning engine for finding risky code paths, and it comments on pull requests when it sees a data-flow issue. **Secret scanning** looks for credentials such as API keys in commits and either blocks the push or raises an alert. **ZAP**, the OWASP Zed Attack Proxy, sends HTTP requests to the staging API and reports risky responses. Targeted tests check important authorization rules. This is a good place to be, but it creates a new job: someone has to decide what each finding means.

**Triage** is the process of sorting findings into decisions. A finding might be a real production vulnerability, a duplicate of another alert, a test-only issue, a false positive, an accepted risk, or a low-priority cleanup. The scanner gives a signal, and the team adds product context so the result turns into an engineering action.

Without triage, security tools create a messy queue. Developers see hundreds of alerts and lose trust. Security reviewers chase old warnings that no longer matter. Real issues hide beside noisy ones. Managers ask whether the product is safe, and the team can only point to a long list of unowned findings.

Good triage creates a small set of facts for every meaningful finding:

| Fact | Example |
|---|---|
| What is the weakness? | SQL injection in order search |
| Where is it? | `GET /api/orders/search` in checkout API |
| Who owns it? | Checkout service team |
| Can an attacker reach it? | Yes, authenticated support route |
| What could happen? | Order data disclosure |
| What is the decision? | Fix before next production deploy |
| What evidence supports that decision? | CodeQL trace, staging reproduction, test case |

This article uses the same small SaaS checkout team from the previous articles. The team runs a Node and TypeScript API through GitHub Actions into staging and production. Now alerts are arriving, and the team needs a calm way to sort them.

With those facts in place, the first pass stays simple: name the finding in the team's own words before deciding priority.

## The First Pass: What Is This Finding
<!-- section-summary: The first pass gives the finding a plain-English description, affected component, source, and current status. -->

The first pass starts with a plain description. A good description should let a developer understand the issue without reading the whole scanner report first.

For example:

```markdown
Finding: User-controlled search term reaches SQL query construction.
Source: CodeQL code scanning alert.
Component: checkout-api.
Path: GET /api/orders/search.
Current status: New finding in pull request #1842.
```

This small block already helps. It separates the source of the alert from the weakness itself. CodeQL is the source. Unsafe SQL construction is the weakness. The checkout API search route is the affected place.

The source matters because different tools produce different evidence. A CodeQL alert may include a data-flow path from request input to a database call. A ZAP alert may include an HTTP request and response. A secret scanning alert may include the token type, commit, file path, and whether push protection blocked it. A dependency alert may include the package name, version, fixed version, and vulnerability identifier.

The scanner's metadata is useful, but the triage note should translate it into the team's language. If a **SARIF** result, which is a standard JSON format for scanner findings, says `js/sql-injection`, the issue title can say "SQL injection risk in order search." If ZAP reports a missing anti-clickjacking header on an API-only JSON endpoint, the title can say "Missing browser header on API response" and the triage can decide whether it matters.

The first pass also catches obvious mistakes:

| Question | Why it matters |
|---|---|
| Is the finding in the current code? | Old alerts can point at deleted or moved code |
| Is the affected route deployed? | A finding in dead code has different urgency |
| Is this a duplicate? | One root cause can create many scanner rows |
| Is the scanner authenticated? | A runtime scan with only `401` responses has weak coverage |
| Is the secret real? | A fake fixture should be marked clearly and replaced if confusing |

Once the team knows what the finding is, the next question is urgency.

![Finding triage board with source, reachability, impact, owner, and due date columns](/content-assets/articles/article-devsecops-application-security-testing-finding-triage-dismissal-evidence/finding-triage-board.png)

*This board shows how different scanner alerts become comparable once each one has the same fields: source, reachability, impact, owner, due date, and decision state.*

## Severity, Exploitability, and Reachability
<!-- section-summary: Severity describes possible impact, while exploitability and reachability describe whether the issue is usable in this product right now. -->

Security tools often assign **severity**. Severity describes the possible impact of a weakness. A finding might be low, medium, high, or critical. Some vulnerability programs use **CVSS**, the Common Vulnerability Scoring System, to describe characteristics such as attack complexity, required privileges, user interaction, and impact. CVSS version 4.0 organizes metrics into Base, Threat, Environmental, and Supplemental groups.

Severity is useful, but it does not finish the decision. The checkout team also needs **exploitability** and **reachability**.

**Exploitability** asks how practical the attack is. Is there known exploit code? Can an unauthenticated attacker use it from the internet? Does it require a rare internal condition? Can an attacker repeat it reliably?

**Reachability** asks whether the vulnerable code or component can actually be reached in this application. A vulnerable dependency may exist in `package-lock.json`, but the application may never import the vulnerable function. A risky route may exist in code, but the gateway may block it in production. A secret may look valid, but the provider may show it was revoked before exposure.

Here are three checkout findings:

| Finding | Severity signal | Exploitability and reachability |
|---|---|---|
| CodeQL SQL injection in `/orders/search` | High | Authenticated support users can reach it in staging and production |
| ZAP missing `X-Frame-Options` on `/api/health` | Low or medium | Public endpoint, JSON-only, low business impact |
| Vulnerable package in dev-only test runner | High package CVE | Package is used only in local tests, not deployed in the runtime image |

The first finding should block release. The second might become a hardening ticket. The third needs evidence. If the package truly stays out of production, the due date can be lower than a reachable runtime vulnerability.

Many teams use **SSVC**, Stakeholder-Specific Vulnerability Categorization, to make this more decision-oriented. SSVC uses decision points such as exploitation status, technical impact, mission impact, and exposure to choose an action. The useful idea for beginners is this: vulnerability priority should include product context, not only a generic score.

For a small team, a simple decision table is enough:

| Decision | Use when |
|---|---|
| Block release | Confirmed exploitable issue can affect production data, auth, payments, or admin functions |
| Fix this sprint | Real issue is reachable but impact or exposure is limited |
| Backlog with owner | Real issue exists but needs broader cleanup or lower-risk hardening |
| Dismiss with evidence | Finding is false positive, duplicate, test-only, or accepted risk |
| Investigate | The team lacks enough evidence to decide |

After the team chooses one of these decisions, the next piece is ownership: the decision needs an owner and a due date.

![Triage priority filter mapping severity, exploitability, and reachability to release decisions](/content-assets/articles/article-devsecops-application-security-testing-finding-triage-dismissal-evidence/triage-priority-filter.png)

*This filter keeps the priority conversation concrete: critical reachable issues block release, high reachable issues get sprint fixes, lower-risk real issues go to backlog, and duplicates or unreal findings need evidence.*

## Owners and Due Dates
<!-- section-summary: Every real finding needs one owning team, one next action, and a due date that matches risk. -->

A finding without an owner will age quietly. A finding with five owners will age loudly. Each real finding needs one owning team and one next action.

For the checkout API, ownership might look like this:

| Finding type | Owner |
|---|---|
| Unsafe code in route handler | Checkout service team |
| Payment provider secret exposed | Checkout service team plus platform security |
| Missing staging scan authentication | Delivery platform team |
| Shared API gateway misconfiguration | Platform networking team |
| Dependency update needed in service repo | Checkout service team |

The owner should be the team that can change the system. Security can advise, reproduce, and review, but security should avoid becoming the default owner for every product code issue. When product teams own their findings, security work stays connected to normal engineering work.

Due dates should match risk. A critical production auth bypass needs immediate work. A medium hardening finding can fit a sprint. A low-risk cleanup can enter the backlog with a review date. The due date should also consider release timing. If a finding blocks a production deployment, the fix needs to happen before promotion from staging.

For the checkout team, a practical service-level target might be:

| Priority | Target |
|---|---|
| Critical reachable production risk | Same day response, fix or mitigation before next deploy |
| High reachable issue | Fix within 7 days or before release, whichever comes first |
| Medium issue | Fix within 30 days |
| Low issue | Fix through normal backlog or scheduled hardening |
| Accepted risk | Expiration date and named approver |

These targets are examples, not universal law. A bank, hospital system, public-sector service, or consumer checkout platform may need stricter timelines. The important part is that the team writes the expectation down before a wave of alerts arrives.

Some findings will close without a code fix. That is where dismissal quality matters.

## Duplicates, False Positives, and Accepted Risk
<!-- section-summary: Closing an alert without a fix still needs a clear reason because duplicate, false positive, and accepted risk mean different things. -->

A **duplicate** means another finding already tracks the same root cause. For example, ZAP may report several injection-like symptoms from one unsafe search helper. The team can close the duplicates by linking to the main issue, then fix the shared helper.

A **false positive** means the scanner reported a weakness that the code does not actually have. Maybe CodeQL missed the team's custom sanitizer. Maybe a fake secret in a test fixture matched a provider pattern, but it cannot authenticate anywhere. A false-positive dismissal should explain the proof, because future readers need to know why the alert was safe to close.

An **accepted risk** means the issue is real, and the team has chosen to live with it for a defined time or under defined conditions. This decision needs more care. Accepted risk should have a named owner, an approver with the right authority, an expiration date, and a compensating control when possible.

Here is the difference in checkout language:

| Closure | Example |
|---|---|
| Duplicate | `Same root cause as APPSEC-1421: unsafe order search helper` |
| False positive | `CodeQL trace stops at sanitizeOrderSearchTerm; unit tests cover quote and wildcard input` |
| Used in tests | `Fake token is intentionally invalid and uses provider-documented test prefix` |
| Accepted risk | `Admin export lacks rate limit; endpoint restricted to VPN and admin role; product owner accepted until Q3 rate-limit project` |

False positive should stay reserved for alerts where the scanner truly got the code wrong. If the finding is real but lower priority, call it real and assign the right due date. If the team accepts the risk, say accepted risk. If the finding is noisy because of test fixtures, mark it test-only and make the fixture obviously fake.

This distinction matters during audits and incidents. After a breach or customer security review, vague dismissals create pain. Clear dismissals tell the story.

Those closure labels are only useful when the evidence explains them, so the next step is the dismissal note itself.

## Dismissal Evidence
<!-- section-summary: Dismissal evidence should explain the decision, point to proof, name the approver when needed, and set a revisit trigger. -->

**Dismissal evidence** is the note and supporting proof attached to an alert when the team closes it without a normal fix. It should be short, specific, and useful to someone who was not in the conversation.

GitHub code scanning supports alert states and dismissal reasons through the UI and API. The API includes fields such as dismissal reason and dismissal comment for dismissed alerts. SARIF, the standard format many scanners use for static analysis output, also carries structured result data such as rules, locations, messages, and related metadata. These structures help tools move findings around, but the human note still matters.

A weak dismissal says:

```markdown
False positive.
```

A useful dismissal says:

```markdown
False positive. CodeQL does not recognize sanitizeOrderSearchTerm in src/security/search.ts.
The helper rejects SQL metacharacters and the route now uses a parameterized query.
Evidence: tests in order-search.test.ts cover quote, wildcard, and comment marker input.
Revisit if sanitizeOrderSearchTerm changes or the route moves to a new query builder.
```

For accepted risk, the note needs an approval trail:

```markdown
Accepted risk until 2026-09-30. The support export endpoint lacks per-user rate limiting.
Current compensating controls: support-agent role required, VPN required, audit log enabled,
daily export volume alert in Datadog. Approved by checkout product owner and appsec lead
while platform rate limiting is added in APPSEC-2190.
```

For a secret, the evidence should focus on rotation:

```markdown
Closed after rotation. Revoked payment provider key ending in 7fa2 at 2026-06-21 14:10 UTC.
Updated GitHub Actions secret PAYMENT_API_KEY and redeployed staging. Reviewed provider logs
from first exposed commit through rotation time; no unknown source IPs found.
```

For a duplicate, the note should link the surviving issue:

```markdown
Duplicate of APPSEC-1421. This ZAP alert and the CodeQL alert both trace to the same
unsafe order search helper. Keeping APPSEC-1421 open as the root-cause fix.
```

The format can be simple. The habit matters more than the template. Every dismissal should answer: why is closing this acceptable, who can verify the reasoning, and when should the team revisit it?

After a real fix ships, the team still needs verification.

## Verification After the Fix
<!-- section-summary: A finding closes only after the team proves the fix works and records the evidence that proved it. -->

Fixing code and closing a finding are related steps. They should happen together, but one does not automatically prove the other. A developer can change a line and still leave the route vulnerable. A scanner can go green because it lost coverage. Verification closes that gap.

For a **SAST** finding, meaning static application security testing that reviews code without running the app, verification usually includes:

1. A code change that removes the risky pattern.
2. A regression test that covers the dangerous input or behavior.
3. A clean scanner rerun on the affected branch or default branch.
4. A reviewer who understands the security rule.

For the SQL injection alert, the checkout team changes string concatenation to a parameterized query, adds tests for quote-heavy input, and confirms the CodeQL alert closes or no longer appears on the pull request.

For a **DAST** finding, meaning dynamic application security testing that probes a running app over HTTP, verification includes a reproduction and a retest. If ZAP found verbose stack traces on malformed JSON, the team should keep one example request from the report, apply the fix, and run the request again:

```bash
curl -i \
  -X POST https://checkout-staging.example.com/api/orders \
  -H "content-type: application/json" \
  -d "{bad-json"
```

The fixed response should show a safe error shape:

```http
HTTP/2 400
content-type: application/json

{"error":"invalid_request","message":"The request body is not valid JSON."}
```

For a secret, verification means the old credential no longer works and the app uses the new path. If the team rotated a payment provider token, they should confirm the provider marks the old key revoked, the new CI secret exists, staging deploys successfully, and provider logs show no suspicious use during the exposure window.

For an accepted risk, verification means the compensating controls exist. If the team accepts a missing rate limit because VPN, role checks, and audit logs reduce exposure, someone should verify those controls rather than assuming they exist.

Verification evidence should live where the team will look later: the GitHub alert, the issue tracker, the pull request, or the vulnerability management system. A Slack message is useful during the day. It is weak long-term evidence.

The last step is to put the pieces into one small workflow.

## A Small Team Workflow
<!-- section-summary: A lightweight triage loop keeps alerts owned, decisions clear, fixes verified, and old exceptions from becoming permanent. -->

Here is a practical triage workflow for the checkout API team.

Every weekday, a rotating engineer checks new security alerts for the checkout repository. This is a small rotation, not a separate security department. The engineer groups obvious duplicates, labels each new finding by source, and assigns an initial owner.

Every new finding gets one of five states:

| State | Meaning |
|---|---|
| Investigating | The team needs more evidence |
| Fix required | The finding is real and needs remediation |
| Mitigated | A temporary control reduces risk while the fix is underway |
| Dismissed with evidence | The alert is false positive, duplicate, test-only, or accepted risk |
| Verified fixed | The fix shipped and evidence confirms it works |

For high-risk findings, the team does not wait for the weekly meeting. A reachable production auth bypass, leaked live credential, confirmed injection, or cross-user data exposure gets immediate attention. The release pauses until the team fixes or mitigates the issue.

For normal findings, the team runs a weekly 30-minute review. They check new alerts, old findings near due dates, accepted risks near expiration, and noisy rules that need tuning. The meeting output is a small set of decisions, not a long discussion about every scanner row.

The team keeps a simple triage template:

```markdown
Summary:
Source:
Affected component:
Reachability:
Impact:
Decision:
Owner:
Due date:
Evidence:
Verification plan:
```

In a larger company, the same fields may live in a vulnerability management system instead of a markdown note. The checkout team can still use the same shape: one source of truth, one owner, one due date, and evidence attached to the decision.

Here are three completed examples.

```markdown
Summary: SQL injection risk in order search.
Source: CodeQL.
Affected component: checkout-api GET /api/orders/search.
Reachability: Authenticated support route in staging and production.
Impact: Possible order data disclosure.
Decision: Fix required before production deploy.
Owner: Checkout service team.
Due date: Before release 2026.06.24.
Evidence: CodeQL data flow from req.query.term to db.query string construction.
Verification plan: Parameterized query, regression test, clean CodeQL rerun.
```

```markdown
Summary: Payment provider key committed in feature branch.
Source: Secret scanning push protection.
Affected component: Git commit in PR #1849.
Reachability: Push was blocked before remote repository accepted the secret.
Impact: Key existed on developer laptop; provider access possible if copied elsewhere.
Decision: Rotate and close with evidence.
Owner: Checkout service team.
Due date: Same day.
Evidence: Push protection block, provider key ending in 7fa2.
Verification plan: Revoke old key, update CI secret, confirm staging deployment.
```

```markdown
Summary: Missing anti-clickjacking header on JSON health endpoint.
Source: ZAP staging scan.
Affected component: GET /health.
Reachability: Public endpoint, JSON response, no browser session.
Impact: Low for this endpoint.
Decision: Backlog hardening; gateway header policy will cover all routes.
Owner: Platform networking team.
Due date: 30 days.
Evidence: ZAP report `zap-report-2026-06-21`.
Verification plan: Retest headers after gateway policy update.
```

This gives the checkout team a working loop. Alerts arrive from tools. Triage turns them into decisions. Owners fix or document them. Verification proves the decision. Dismissals carry evidence. Accepted risks expire instead of becoming permanent background noise.

That is the end of this module's application security testing path. The team now has early code and secret checks, runtime API testing, and a triage loop that turns scanner output into engineering work.

![Triage operating loop from new finding through evidence and verified fix](/content-assets/articles/article-devsecops-application-security-testing-finding-triage-dismissal-evidence/triage-operating-loop.png)

*This final loop summarizes the article: name the issue, check reachability, assign an owner, record evidence, verify the fix, and return the decision to the review queue.*

---

**References**

- [GitHub Docs: Resolving code scanning alerts](https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts) - Explains viewing, fixing, and dismissing code scanning alerts.
- [GitHub Docs: Triaging code scanning alerts in pull requests](https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/triage-alerts-in-pull-requests) - Covers pull request alert triage and false-positive handling.
- [GitHub REST API: Code scanning](https://docs.github.com/en/rest/code-scanning/code-scanning) - Documents code scanning alert fields, including dismissal reason and dismissal comments.
- [OASIS SARIF Version 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) - Defines the Static Analysis Results Interchange Format standard.
- [FIRST CVSS v4.0 Specification](https://www.first.org/cvss/v4.0/specification-document) - Defines CVSS v4.0 metric groups and scoring concepts.
- [CISA Stakeholder-Specific Vulnerability Categorization Guide](https://www.cisa.gov/sites/default/files/publications/cisa-ssvc-guide%20508c.pdf) - Describes SSVC decision-tree prioritization for vulnerability response.
- [CISA Log4Shell advisory AA21-356A](https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-356a) - Historical example of large-scale vulnerability response and prioritization pressure.
- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) - Provides a basis for testing application security controls.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - Recommends secure software development practices that can be integrated into SDLC workflows.
