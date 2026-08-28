---
title: "Scanning Code and Secrets in Pull Requests"
description: "Learn how SAST, CodeQL, secret scanning, and push protection create useful security evidence before a proposed change becomes trusted code."
overview: "Follow the trust transition from a developer's branch into a protected branch. Learn how static analysis models sources, flows, sinks, and sanitizers; how CodeQL turns that model into pull-request evidence; why secret exposure needs an earlier boundary; and how gates, dismissals, baselines, and layered testing keep the feedback both strict and usable."
tags: ["devsecops", "sast", "secret-scanning", "code-scanning"]
order: 1
id: article-devsecops-pipeline-security-sast-and-codeql
---

## Table of Contents

1. [Why Scan a Change Before It Becomes Trusted Code?](#why-scan-a-change-before-it-becomes-trusted-code)
2. [How Does SAST Reason About Dangerous Code Paths?](#how-does-sast-reason-about-dangerous-code-paths)
3. [How Does CodeQL Turn a Pull Request into Security Evidence?](#how-does-codeql-turn-a-pull-request-into-security-evidence)
4. [How Does Scan Evidence Become a Useful Merge Gate?](#how-does-scan-evidence-become-a-useful-merge-gate)
5. [Why Must Secret Detection Start Earlier Than Pull-Request Review?](#why-must-secret-detection-start-earlier-than-pull-request-review)
6. [How Should Developers Fix, Dismiss, and Tune Findings?](#how-should-developers-fix-dismiss-and-tune-findings)
7. [How Do Baselines and Layered Tests Prevent Blind Spots?](#how-do-baselines-and-layered-tests-prevent-blind-spots)
8. [What Does a Practical Small-Team Scanning Workflow Look Like?](#what-does-a-practical-small-team-scanning-workflow-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A pull request protects a transition:

```text
developer's proposed code
          |
          v
     pull request
          |
          | security evidence and review
          v
     trusted branch
```

The proposed code is close enough to the application for meaningful analysis, but it has not yet become part of the trusted codebase. The author still understands the change, the reviewer can see the exact diff, and a correction can usually remain inside the same pull request. That makes this boundary valuable for finding defects before later systems build, distribute, and run them.

“Scan the pull request” hides two different security questions. Consider a search handler:

```python
def search(request):
    name = request.args["name"]
    db.execute("SELECT * FROM users WHERE name = '" + name + "'")
```

There is no password in the code. The risk is a relationship: untrusted HTTP input becomes part of a command interpreted by a database. **Static application security testing**, or **SAST**, examines code without running the application and tries to find dangerous behavior such as that path.

Keep these questions in view as you work through the lesson:

1. **Why Scan a Change Before It Becomes Trusted Code?**
2. **How Does SAST Reason About Dangerous Code Paths?**
3. **How Does CodeQL Turn a Pull Request into Security Evidence?**
4. **How Does Scan Evidence Become a Useful Merge Gate?**
5. **Why Must Secret Detection Start Earlier Than Pull-Request Review?**
6. **How Should Developers Fix, Dismiss, and Tune Findings?**
7. **How Do Baselines and Layered Tests Prevent Blind Spots?**
8. **What Does a Practical Small-Team Scanning Workflow Look Like?**

## Why Scan a Change Before It Becomes Trusted Code?
<!-- section-summary: A pull request is the decision boundary where proposed code is still untrusted and the developer can fix a problem before the protected branch accepts it. -->

Secret scanning starts from a different failure mode. Consider this line:

```python
STRIPE_KEY = "sk_live_..."
```

The problem does not depend on program flow. A value that may grant authority has entered source code. **Secret scanning** recognizes credential-like data, while **push protection** tries to stop supported secrets before a remote repository accepts them.

The distinction affects both analysis and remediation:

```text
                       proposed change
                              |
                 +------------+------------+
                 |                         |
                 v                         v
                SAST                 secret detection
                 |                         |
      dangerous behavior path?      credential present?
                 |                         |
      change code structure       revoke, remove, replace
```

A code vulnerability normally needs a reachable path, attacker influence, and a sensitive operation. A leaked credential can be directly useful to whoever possesses it. Deleting vulnerable composition can repair the former. Deleting a credential string does not invalidate copies of the latter.

The pull request is therefore not a magic security location. It is one decision point in a layered delivery path. SAST often fits there because the scanner can compare proposed code with the trusted branch and return feedback while the change is still cheap to correct. Secret detection should begin even earlier, ideally before the first remote push. Dynamic testing belongs later because it needs a running system.

The useful first-principles question is not “Which scanner can we add?” It is:

```text
What security evidence can we obtain at this trust transition,
and what decision should that evidence influence?
```

That question keeps scanning connected to an actual control instead of turning it into a background report that nobody must act on.

## How Does SAST Reason About Dangerous Code Paths?
<!-- section-summary: Useful static analysis models how attacker-influenced data moves from a source toward a dangerous sink and whether a suitable sanitizer or safe API breaks the path. -->

At its simplest, static analysis can search for suspicious syntax such as `eval(user_input)`. More capable SAST parses program structure and reasons across variables, function calls, types, control flow, and data flow. It is still a model of the program rather than a complete execution of every possible runtime state, but that model can find security relationships spread across several functions.

A practical vocabulary is:

- A **source** introduces potentially untrusted data.
- A **sink** performs an operation where attacker-controlled data can become dangerous.
- A **sanitizer** or **barrier** changes the value or the operation so the path becomes safe.
- **Data flow** tracks how values move.
- **Taint tracking** keeps treating a derived value as influenced by untrusted input even after transformations such as concatenation.

Sources can include HTTP input, command-line arguments, message content, or database records influenced by users. Sinks can include SQL and shell execution, filesystem paths, HTML output, deserialization, or network requests. The central question is whether attacker-influenced information can reach a sensitive operation without an adequate control.

Consider a file endpoint:

```python
filename = request.args["file"]
open("/uploads/" + filename)
```

The interesting property is not merely that `open()` appears. A fixed call such as `open("/uploads/help.txt")` has a different security meaning. The scanner tries to model this path:

```text
request.args["file"]
        |
        v
     filename
        |
        v
 string concatenation
        |
        v
      open()
```

The same distinction applies to shell commands. Searching for `os.system()` would flag `os.system("date")`, but the more important case is an HTTP value concatenated into a command. A path query can explain how the value travels through helper functions before reaching the interpreter.

A safe barrier changes the result. Parameterized SQL separates code from data:

```python
identifier = request.args["id"]

if not identifier.isdigit():
    abort(400)

query("SELECT * FROM users WHERE id = ?", [identifier])
```

The validation constrains the input, and the parameterized API prevents the value from becoming SQL syntax. The strongest repair usually changes the dangerous composition model rather than filtering a short list of known characters.

Static analysis can misunderstand custom abstractions. An organization may have a `safe_sql_identifier()` helper that the scanner does not recognize. It then sees untrusted input, an unknown function, and a SQL sink, so it reports a path that developers know is protected. The disciplined response is to verify the helper and, when possible, teach the scanner about the custom sanitizer. Similar modeling may be needed for organization-specific sources, sinks, frameworks, and wrapper APIs.

This explains both the power and limits of SAST. It can connect distant code and explain a path that a simple pattern search would miss. It can also report false positives when its model lacks relevant context and false negatives when runtime configuration, business semantics, new vulnerability classes, or opaque components fall outside that model.


_The security question is the relationship between an untrusted source and a sensitive sink, including any barrier between them._

That relationship also explains why a scanner result needs human context. A suspicious data path matters only after the team checks whether the source is attacker-controlled, whether validation actually constrains it, and whether the sink performs a security-sensitive operation.

## How Does CodeQL Turn a Pull Request into Security Evidence?
<!-- section-summary: CodeQL extracts a queryable model of one code revision, runs security queries against it, and presents relevant paths where the developer is reviewing the change. -->

CodeQL makes the source queryable. Conceptually, extraction turns a particular code revision into representations of syntax, types, control flow, and data flow. Security queries then ask questions such as whether an HTTP value can influence a shell command without an appropriate barrier.

```text
source revision
      |
      v
CodeQL extraction
      |
      v
queryable program model
      |
      +-- syntax and types
      +-- control flow
      +-- data and taint flow
      |
      v
security queries and path explanations
```

This is more expressive than asking whether a file contains `exec`. A query can identify the source, intermediate steps, and sink, then present that path with the alert. The explanation matters because the developer needs to understand the claimed invariant before choosing a repair.

Pull-request scanning and scheduled scanning answer different questions. If trusted `main` is revision A and the pull request proposes changes B, the PR scan asks what risk A+B introduces. A default-branch or scheduled scan asks what risk exists in the repository now. Scheduled analysis can find older problems after rules improve, framework models change, or broader queries become available.

```text
pull-request scan       -> what risk are we introducing now?
scheduled branch scan   -> what risk currently exists?
```

Both views are needed. The PR view supports change control and immediate correction. The scheduled view supports inventory and ongoing discovery.

GitHub can configure CodeQL through a lower-maintenance default setup or a workflow that the team controls. Default setup is a practical starting point when supported languages and ordinary build behavior are enough. An advanced setup becomes useful for unusual builds, monorepos, custom query packs, or deliberate scheduling. Whatever setup is chosen, the evidence must apply to the exact revision being considered for merge.

A developer should see more than `SECURITY FAILED`. A useful alert names the rule and location, describes why the operation is dangerous, and displays the path when the analysis can reconstruct it. GitHub can surface alerts as checks and pull-request annotations when the relevant code appears in the diff. The feedback then remains beside the code and discussion instead of arriving weeks later as a detached report.

This placement is the practical value often described as **shift left**. It does not mean moving every security tool to the earliest imaginable stage. It means putting feedback near the earliest responsible decision point at which the required evidence exists and the person who can correct the defect still has context. SAST can often operate on the pull request; dynamic testing cannot work until something runs.

The result of analysis is evidence, not enforcement by itself. It records that a configured query suite examined a revision and produced particular alerts. Branch or repository policy decides whether those results permit the trust transition.

## How Does Scan Evidence Become a Useful Merge Gate?
<!-- section-summary: A scanner acts as a gate only if protected merge policy consumes its result, and the policy should block unacceptable new risk without converting all historical noise into a delivery outage. -->

Running CodeQL does not automatically prevent a merge. A pull request can contain passing tests and a high-severity alert while an authorized user still merges it. That is detection. Prevention requires a decision rule on the protected transition:

```text
scanner evidence
      +
security decision rule
      +
protected merge boundary
      =
security gate
```

A ruleset can require analysis to finish and reject a merge when configured findings meet a threshold. The exact rule should reflect the application's exposure and threat model, but a common starting shape is to block new critical and high-confidence high-severity findings while keeping lower-confidence or lower-impact findings visible for review.

Blocking every alert is rarely sustainable. Suppose a tool reports one critical, two high, forty-one medium, and 170 low findings. Treating all 214 as identical merge failures spends developer attention without distinguishing likely harm. Work stops, pressure to bypass the scanner rises, and the control loses credibility.

The better objective is not maximum alert volume. It is meaningful risk reduction per unit of developer attention. A PR can use a high-precision query set for reliable gates while a scheduled scan uses broader coverage to build a security backlog. Higher coverage normally brings more uncertain results; higher precision normally misses some true problems. The architecture should place that tradeoff deliberately.

Do not confuse scanner confidence with business impact. A tool may be highly confident that weak hashing appears in code, while the consequence depends on what is being hashed. A medium-confidence path in production authentication may deserve urgent investigation because the asset and exposure are important. A more complete risk model considers technical severity, exploitability, reachability, exposure, asset value, and confidence.

Mature repositories also need a baseline. Enabling a new scanner on an old codebase might reveal hundreds of findings. If every historical alert immediately blocks every unrelated change, old debt prevents new security work. Separate the two transitions:

```text
existing findings          -> owned remediation backlog
new findings in a change   -> strong merge rule
```

This creates a ratchet. The current state is not declared safe, but new work should not silently make it worse while the team reduces the baseline over time.

Gates must also fail safely when expected evidence is absent. If required analysis never ran, was cancelled, examined the wrong revision, or cannot upload its result, “no alert” is not the same as a passing scan. Policy should distinguish completed clean analysis from missing evidence.

The scan result is one input to ordinary review, not a replacement for it. Humans understand product intent, authorization semantics, data sensitivity, and business impact that generic queries may not. Conversely, automated analysis follows paths and applies repeatable checks that reviewers can miss. The two controls are complementary.

## Why Must Secret Detection Start Earlier Than Pull-Request Review?
<!-- section-summary: A secret is portable authority, so the preferred control blocks it before a remote push and treats any successful exposure as an authentication incident. -->

A credential is best understood as authority encoded as data. Depending on its permissions, a cloud key, private key, database password, webhook secret, or API token may authorize reading data, changing infrastructure, or calling a production service. Possession can be enough to act.

Waiting for pull-request review is therefore late. Once a developer pushes a branch, a real secret may exist in remote Git history, caches, clones, logs, integrations, and security systems even if the pull request never merges. **Push protection** tries to examine supported credential patterns during the push and reject the transfer at that border.

**Secret scanning** is the detective partner. It searches repository history and other supported locations for credentials that already entered the territory. Preventive controls can miss unknown formats, be bypassed, or be introduced after an old leak, so both layers matter:

```text
developer machine
      |
      v
push protection ---- secret found ---> block before repository
      |
      v
repository and history
      |
      v
secret scanning ---- secret found ---> alert and remediate
```

Secret detectors reason differently from SAST. They commonly use recognizable provider formats, generic patterns, high entropy, contextual clues, and sometimes provider validation. A token prefix can make a credential easier to identify. An unknown internal format, an obfuscated value, or a credential assembled from several pieces may escape detection.

False positives also have different causes. SAST may misunderstand a sanitizer in a data-flow path. Secret scanning may mistake a documentation example, test fixture, random string, or fake private key for a real credential. Tuning should match the detector: improve program models and query selection for SAST; improve token patterns, test-data conventions, and precise exclusions for secrets.

When a real secret is found, deleting the line is not sufficient. The credential may already have been copied. The security response starts with containment:

1. Revoke or rotate the exposed credential.
2. Inspect relevant access and provider logs for use.
3. Remove the credential from active code and configuration.
4. Replace it with retrieval through an approved secret boundary.
5. Address repository history where appropriate.

The source should contain how the application obtains authority, not the authority itself. For example:

```python
DB_PASSWORD = os.environ["DB_PASSWORD"]
```

This line does not, by itself, solve secret management. It only separates source from the value. The value should originate from a secret manager or another controlled store and reach the application through an authenticated runtime identity and authorized delivery path.

![Secret push protection blocks an exposed credential before rotation and safe runtime retrieval](/content-assets/articles/article-devsecops-pipeline-security-sast-and-codeql/secret-push-protection.png)

_Push protection is preventive; repository secret scanning remains necessary for credentials that already crossed the boundary._

The durable mental model is that a leaked secret is an authentication incident, not merely a code-quality defect. Rotation makes every copied old value useless. Code cleanup prevents the next exposure. Both actions are necessary.

## How Should Developers Fix, Dismiss, and Tune Findings?
<!-- section-summary: Developers should understand the claimed invariant, repair the underlying structure, rerun the check, and preserve narrow evidence for any dismissal or exclusion. -->

For a SAST alert, begin with the path. Identify the source, transformations, barrier if any, and sink. Ask whether an attacker can control the source, whether the path is reachable, and whether the supposed barrier actually prevents the dangerous interpretation.

If the path is real, change the security structure. For SQL injection, replace string composition with a parameterized API. For command injection, avoid the shell or pass constrained arguments through an API that does not reinterpret them as command text. Add a regression test that captures the intended safe behavior, then rerun analysis and confirm the alert disappears on the exact revision.

Sometimes the scanner is wrong. A value may come from a closed trusted enum, or a verified organization-specific sanitizer may break the path. Dismissal is not inherently unsafe; unexplained dismissal is. Record why the result is false or why a real risk is temporarily accepted, what evidence supports the decision, who owns it, and when the conclusion should be revisited.

The principle is to suppress a conclusion narrowly without discarding the evidence that produced it. Do not silence an entire rule set because one alert is inconvenient. A future code path may use the same sink without the safe condition.

Generated code illustrates the difference. If `generated/client.py` is overwritten on every build, editing the output is not durable. Trace the finding to the generator, schema, or template and fix the upstream control. If the generated output is genuinely inappropriate to analyze independently, exclude that directory precisely, document why, and review the exclusion as the build changes.

Broad exclusions create blind spots. Ignoring every path removes noise in the same way removing a smoke detector removes alarms. Start by asking why a path is noisy: it may contain deliberate vulnerable fixtures, vendored code, build output, an unsupported framework abstraction, or a single irrelevant query. Change only the responsible scope or model.

Secret findings require their own evidence. Record the affected system, revocation or rotation event, time window, replacement boundary, deployment verification, and log review. Removing a string and dismissing the alert as “fixed” does not prove that the exposed credential can no longer authenticate.

Scanner health should be measured by actionability, not raw alert count. Twenty findings that lead to fifteen real corrections can produce more value than one thousand findings that yield three fixes. Useful measures include alert age, reopen rate, dismissal reasons, baseline reduction, coverage, and the ratio of actionable findings to findings presented.

Do not optimize for zero false positives by disabling analysis. The real goal is to catch meaningful vulnerabilities early while keeping investigation cost acceptable. Teams protect trust in the control by combining high-signal gates, broader non-blocking discovery, evidence-based tuning, and predictable developer guidance.

## How Do Baselines and Layered Tests Prevent Blind Spots?
<!-- section-summary: A clean scanner result is bounded evidence, so complementary controls must observe different stages and a baseline must separate current debt from newly introduced risk. -->

Neither CodeQL nor secret scanning can prove that software is secure. A clean SAST run means the configured rules found no policy-breaking evidence in the analyzed program model. It can miss runtime configuration, subtle authorization logic, environment behavior, closed components, or unfamiliar vulnerability classes. A clean secret scan can miss unknown formats, custom credentials, obfuscation, or dynamically assembled values.

Layered testing compensates by observing different things:

```text
developer and IDE       -> immediate coding feedback
local commit            -> local secret checks
push                    -> push protection
pull request            -> SAST, dependency review, IaC checks, tests, review
trusted branch          -> broader and scheduled scanning
staging                 -> DAST and integration security tests
production              -> monitoring and incident evidence
```

The value comes from complementary observations, not six tools that all search for the same pattern. SAST inspects program structure. Secret scanning searches for authority encoded as data. Dependency review examines newly introduced package relationships. IaC scanning evaluates infrastructure configuration. DAST stimulates a running application. Human review connects behavior to product intent.

Each control also belongs at a point where the necessary evidence exists. Pushing SAST earlier into an editor can improve feedback but may lack full-project context. Waiting until production makes a code repair expensive. Push protection should precede repository acceptance because a credential exposure occurs at that transfer. DAST cannot move before deployment because it needs a reachable runtime.

The PR remains especially powerful for code defects because it concentrates context and accountability. Compare a five-line command-injection repair inside the open change with a production finding that becomes a ticket, waits for prioritization, requires a developer to reconstruct three-month-old context, and needs another release. The vulnerability is the same; remediation cost is not.

The baseline makes layered adoption workable. Inventory historical findings, assign owners and priorities, and schedule reduction. Apply stricter policy to new findings in proposed changes. As the backlog falls and the signal improves, the team can tighten thresholds or expand query coverage without freezing delivery.

Finally, preserve the meaning of a pass. Record the source revision, scanner and query configuration, time, outcome, and any dismissals or exceptions. If the trusted branch changed after analysis, rerun the required check. If generated outputs or dependencies are part of the released artifact, make sure the relevant stage examines them. Evidence is useful only within the scope and object it actually covered.

## What Does a Practical Small-Team Scanning Workflow Look Like?
<!-- section-summary: A small team can build credible protection by starting with push protection, repository secret scanning, CodeQL, ordinary review, narrow merge rules, and a regular backlog loop. -->

Suppose six developers and one security-aware platform engineer use GitHub Actions. They do not need a large AppSec organization to establish a sound trust transition.

Start with high signal and low operating complexity:

1. Enable push protection for supported secret formats.
2. Enable repository secret scanning for credentials already present.
3. Enable CodeQL default setup for supported application languages.
4. Run analysis for pull requests targeting the protected branch.
5. Keep ordinary peer review and tests mandatory.
6. Block clearly unacceptable new findings, and treat missing required analysis as missing evidence.
7. Review open alerts and the historical baseline on a regular schedule.
8. Add custom secret patterns, data-flow models, or broader queries when actual gaps justify them.

The resulting flow is compact:

```text
developer writes code
        |
        v
      push
        |
        v
push protection -- credential found --> reject and rotate if exposed
        |
        v
pull request
   |        |         |
   v        v         v
 tests    CodeQL    review
   |        |         |
   +--------+---------+
            |
            v
      protected rule
       |           |
 unacceptable   acceptable
       |           |
     reject       merge
                    |
                    v
          scheduled broader scan
                    |
                    v
             owned backlog
```

Give developers a short response guide. For SAST, inspect the path, fix the structural cause, add a regression test, and rerun the exact check. For secrets, revoke first, inspect use, move retrieval behind the approved secret boundary, clean the code and relevant history, and record evidence. For a false positive or accepted risk, preserve the finding and write a narrow, owned, reviewable decision.

Review the system, not only individual alerts. Ask whether every repository receives expected scans, whether required jobs analyze the final revision, whether bypasses are logged, whether exclusions remain narrow, whether secret formats are recognized, whether old findings have owners, and whether developers can understand why a gate failed.

![Code and secret scanning loop from proposed change through evidence, policy, correction, and scheduled review](/content-assets/articles/article-devsecops-pipeline-security-sast-and-codeql/code-secret-scanning-loop.png)

_SAST and secret detection answer different questions; each acts as a control only if its evidence drives a protected decision and a clear response._

The final mental model is a proposed trust transition. SAST tries to stop insecure behavior from becoming trusted code. Push protection tries to stop credentials from entering the repository at all. Secret scanning searches what has already crossed the boundary. Branch policy consumes the evidence, careful tuning protects the signal, and scheduled review prevents the current inventory from being forgotten.

Each result should remain tied to its analyzed revision, configuration, and decision so the team can later prove why that proposed change was accepted or rejected.

## Check Your Answers

:::expand[Why Scan a Change Before It Becomes Trusted Code?]{kind="recap"}
Use the pull request for evidence that needs full change context, while placing controls such as push protection at an earlier boundary when exposure occurs before review.
:::

:::expand[How Does SAST Reason About Dangerous Code Paths?]{kind="recap"}
Model attacker-controlled sources, transformations, sanitizers, and sensitive sinks instead of treating every appearance of a dangerous API as equivalent.
:::

:::expand[How Does CodeQL Turn a Pull Request into Security Evidence?]{kind="recap"}
CodeQL queries a program model for one revision and presents security relationships beside the proposed change; policy still decides what the result permits.
:::

:::expand[How Does Scan Evidence Become a Useful Merge Gate?]{kind="recap"}
Combine completed scan evidence, a risk-based decision rule, and a protected merge boundary, then separate new risk from the historical backlog.
:::

:::expand[Why Must Secret Detection Start Earlier Than Pull-Request Review?]{kind="recap"}
A secret is portable authority, so block supported credentials before the remote push and treat any successful exposure as an incident requiring revocation.
:::

:::expand[How Should Developers Fix, Dismiss, and Tune Findings?]{kind="recap"}
Repair the underlying invariant, verify the result, and use narrow evidence-backed dismissals or exclusions instead of creating broad blind spots.
:::

:::expand[How Do Baselines and Layered Tests Prevent Blind Spots?]{kind="recap"}
Treat a clean scan as bounded evidence and combine complementary observations across development, pull request, branch, staging, and production.
:::

:::expand[What Does a Practical Small-Team Scanning Workflow Look Like?]{kind="recap"}
Begin with push protection, secret scanning, CodeQL, peer review, focused merge rules, developer runbooks, and a regular owned-backlog review.
:::

## References

- [OWASP Source Code Analysis Tools](https://owasp.org/www-community/Source_Code_Analysis_Tools) - Places static analysis in the implementation and CI stages.
- [OWASP Static Code Analysis](https://owasp.org/www-community/controls/Static_Code_Analysis) - Describes static-analysis techniques and their false-positive and false-negative limits.
- [CodeQL data-flow analysis](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/) - Explains local and global data flow and taint tracking.
- [CodeQL path queries](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/) - Explains how queries display paths from sources to sinks.
- [About CodeQL](https://codeql.github.com/docs/codeql-overview/about-codeql/) - Describes extraction and queryable code databases.
- [GitHub code-scanning setup types](https://docs.github.com/en/code-security/concepts/code-scanning/setup-types) - Compares default, advanced, and external setup.
- [GitHub code-scanning alerts](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts) - Explains alert presentation and pull-request mapping.
- [GitHub ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) - Documents rules that require code-scanning results.
- [GitHub code-scanning merge protection](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/set-merge-protection) - Documents severity-based merge protection.
- [CodeQL query suites](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-query-suites) - Describes precision and coverage tradeoffs between suites.
- [GitHub push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection) - Describes blocking supported credentials during a push.
- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) - Describes repository scanning and remediation of exposed credentials.
- [Supported secret-scanning patterns](https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns) - Describes provider, generic, and other supported patterns.
- [Resolving code-scanning alerts](https://docs.github.com/en/enterprise-cloud%40latest/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts) - Documents alert closure and dismissal records.
- [CodeQL workflow configuration](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options) - Documents analysis path and workflow controls.
- [Configuring CodeQL](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning) - Documents the lower-maintenance default starting point and later customization.
