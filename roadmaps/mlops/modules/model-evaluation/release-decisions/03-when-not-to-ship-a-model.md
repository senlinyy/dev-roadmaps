---
title: "When Not to Ship"
description: "Reject, defer, or narrow a model release when its intended use exceeds the evidence, operating controls, or accountable authority."
overview: "A no-ship decision denies the requested production authority while preserving the exact blocker, safe work that may continue, responsible owner, evidence needed for reconsideration, and a fresh path through review."
tags: ["MLOps", "production", "approval"]
order: 3
id: "article-mlops-model-evaluation-when-not-to-ship-a-model"
---

## Table of Contents

1. [Why Is Shipping a Model an Asymmetric Decision under Uncertainty?](#why-is-shipping-a-model-an-asymmetric-decision-under-uncertainty)
2. [When Do Unclear Use, Invalid Evidence, or Unacceptable Behaviour Block Release?](#when-do-unclear-use-invalid-evidence-or-unacceptable-behaviour-block-release)
3. [When Do Residual Harm or Missing Operational Control Make Deployment Unsafe?](#when-do-residual-harm-or-missing-operational-control-make-deployment-unsafe)
4. [Why Do Accountable Authority and Unresolved Uncertainty Matter?](#why-do-accountable-authority-and-unresolved-uncertainty-matter)
5. [How Should a Blocked Release Record Repairs and Reconsider the Full Claim?](#how-should-a-blocked-release-record-repairs-and-reconsider-the-full-claim)
6. [When Is a Restricted Release a Real Boundary rather than a Rename?](#when-is-a-restricted-release-a-real-boundary-rather-than-a-rename)
7. [How Do Safety Cases and Evidence Proportionality Support the Decision?](#how-do-safety-cases-and-evidence-proportionality-support-the-decision)
8. [What Is the Final Standard for Deciding Not to Ship?](#what-is-the-final-standard-for-deciding-not-to-ship)
9. [Check Your Answers](#check-your-answers)

A model can lead its benchmark and still lack permission to affect real users. Its intended use may have expanded beyond the evaluation data, a critical subgroup may remain unsafe, or operators may have no reliable way to detect and reverse bad behaviour.

Choosing **not to ship** is an evidence-based release outcome, not a failure to reward technical progress. The decision concerns one model inside one system, for one population and consequence set, with the monitoring, authority, and recovery controls that actually exist. Missing or invalid evidence can be as important as a failed metric.

Use these questions to identify blocking conditions, record the required repair, and judge whether a narrower release is truly enforceable:

1. **Why Is Shipping a Model an Asymmetric Decision under Uncertainty?**
2. **When Do Unclear Use, Invalid Evidence, or Unacceptable Behaviour Block Release?**
3. **When Do Residual Harm or Missing Operational Control Make Deployment Unsafe?**
4. **Why Do Accountable Authority and Unresolved Uncertainty Matter?**
5. **How Should a Blocked Release Record Repairs and Reconsider the Full Claim?**
6. **When Is a Restricted Release a Real Boundary rather than a Rename?**
7. **How Do Safety Cases and Evidence Proportionality Support the Decision?**
8. **What Is the Final Standard for Deciding Not to Ship?**

## Why Is Shipping a Model an Asymmetric Decision under Uncertainty?
<!-- section-summary: Deployment creates real effects under uncertainty, and the downside of an unjustified release may be much larger than the cost of waiting for evidence. -->

Model evaluation exists to support a deployment decision, and the consequences of an unjustified release make that decision asymmetric.

The purpose of model evaluation is not to prove that a model is “good.” It is to decide whether there is enough justified confidence to expose a particular model, in a particular system, to a particular set of users and consequences. That distinction matters because a model can have excellent benchmark scores and still be unfit for production. Shipping is not a reward for technical progress. It is an authorization to create real-world effects. The central question is:

**Given what this system can do, where it will operate, what can go wrong, and how well we can detect and control failure, is deployment justified by the evidence we actually have?**

Sometimes the correct answer is no. Before deployment, most model failures are observations. After deployment, model failures can become consequences. A hallucination during evaluation may be one bad row in a dataset. The same hallucination in production might become a wrong medical instruction, a fraudulent transaction, corrupted business data, reputational damage, or thousands of users receiving systematically bad advice. This creates an important asymmetry:

$$
\text{Cost of discovering a failure before release}
\ll
\text{Cost of discovering the same failure after release}
$$

Not every system has this asymmetry to the same degree. A model generating game dialogue and a model authorizing financial transfers obviously have different consequences. So the first principle is not:

“Does the model usually work?”

It is:

**“What happens when it does not?”**

The more severe, irreversible, difficult-to-detect, or widespread the answer is, the stronger the evidence required before shipping. A release decision can be represented very roughly as:

$$
\text{Ship if expected benefit exceeds expected harm}
$$

But this simple formulation hides the hardest part. For each failure mode $$i$$:

$$
E[H]
=
\sum_i
P(F_i)
\times
S(F_i)
\times
X(F_i)
$$

where:

* $$P(F_i)$$ is the probability of failure,
* $$S(F_i)$$ is the severity if it occurs,
* $$X(F_i)$$ is the scale of exposure.

For model systems, we should add two more factors:

$$
R_i
=
P(F_i)
\times
S_i
\times
X_i
\times
D_i
\times
C_i
$$

where $$D_i$$ represents how difficult the failure is to detect and $$C_i$$ represents how difficult it is to contain or reverse. Consider two models with the same 1% error rate. Model A occasionally generates an unattractive marketing slogan. Model B incorrectly approves a dangerous action 1% of the time. “99% accuracy” tells us almost nothing about whether either should ship. The production decision depends on the structure of the errors, not merely their average frequency. A model should stay out of production when the organization cannot establish a defensible chain from intended use to evidence to acceptable residual risk. Think of deployment as requiring several propositions to be true simultaneously:

$$
\text{Deployable}
=
U \land E \land B \land K \land A
$$

where:

* $$U$$: the intended use is sufficiently defined,
* $$E$$: the evaluation evidence is valid,
* $$B$$: observed behaviour is acceptable,
* $$K$$: failures can be controlled,
* $$A$$: accountable authority exists.

This is an **AND**, not an average. Strong performance cannot compensate for missing authority. Excellent monitoring cannot make invalid evaluation evidence valid. A narrow safe use cannot prove a much broader deployment is safe. If one indispensable condition is missing, the rational response may be not to ship. This is one of the most important ideas in model evaluation: **some failures are compensatory, but some are gating failures.** “Ship” and “do not ship” are usually too crude. There are at least four meaningful outcomes.

| Decision               | Meaning                                                                              | Appropriate when                                                        |
| ---------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Reject**             | This model/system should not proceed in its present form                             | Evidence shows unacceptable or fundamental failure                      |
| **Defer**              | Do not release yet                                                                   | Critical uncertainty or remediable evidence gaps remain                 |
| **Shadow**             | Run the system without allowing its outputs to affect users or decisions             | You need realistic operational evidence without production consequences |
| **Restricted release** | Deploy only within explicitly bounded users, tasks, permissions, scale, or oversight | Safety is justified inside a narrow envelope but not outside it         |

These choices express different epistemic states. **Reject** means, “We know enough to conclude no.” **Defer** means, “We do not know enough to conclude yes.” That distinction is important. Absence of evidence of danger is not evidence of safety. **Shadow deployment** addresses another problem: laboratory evaluations often fail to reproduce real traffic. The model receives real inputs, but its outputs are prevented from controlling the real system. This lets evaluators observe distribution shift, latency, tool behaviour, failure patterns, and operator interactions with lower consequence. **Restricted release** recognizes that safety claims are conditional.

For example:

$$
\text{Safe for summarizing internal documents}
\not\Rightarrow
\text{Safe for autonomous external communication}
$$

A model does not have a single universal safety status. It has evidence supporting particular behaviours under particular conditions.

## When Do Unclear Use, Invalid Evidence, or Unacceptable Behaviour Block Release?
<!-- section-summary: A release should stop when intended use is unclear or expanding, evaluation evidence is invalid, or important behaviour remains unacceptable despite a good average. -->

The first blocking conditions concern the claim itself: what use is proposed, whether the evidence is valid, and whether important behaviour is acceptable.

You cannot meaningfully evaluate an undefined system. Suppose an evaluation demonstrates that a model performs well when:

* answering questions about internal documentation,
* for trained employees,
* without external tools,
* with human review.

Then someone proposes releasing the same model as an autonomous agent that can email customers and modify records. The original evaluation is no longer sufficient. Why? Because risk depends on the interaction between:

$$
\text{Model}
\times
\text{Task}
\times
\text{Users}
\times
\text{Tools}
\times
\text{Environment}
$$

Changing one of these can change the system's failure modes. This leads to the principle of **evaluation scope matching**:

$$
\text{Deployment scope} \subseteq \text{Evaluated scope}
$$

If production use is broader than the conditions tested, the evidence does not cover the release. This is especially important because scope expansion often happens gradually. A system begins as “draft suggestions.”

Then:

“Mostly automatic drafts.”

Then:

“Automatic unless flagged.”

Then:

“Fully automatic for low-risk cases.” The model may never have changed, but the actual system has. Therefore an unclear or expanding use is itself a reason to defer release until the boundary is explicit. A release can fail even when the reported evaluation numbers look excellent. The reason is simple:

$$
\text{Bad measurement}
\Rightarrow
\text{Bad belief}
\Rightarrow
\text{Bad decision}
$$

Evaluation evidence is invalid if the measurement no longer supports the claim being made. Imagine a model scores 97% on an evaluation. That number is almost meaningless until we know what was measured:

- Were test cases representative of actual users?
- Were difficult cases deliberately included?
- Was the benchmark contaminated by training data?
- Were evaluators blind to which model generated which response?
- Were failures averaged away by easy examples?
- Was the scoring rubric reliable?
- Were tool calls, long conversations, adversarial inputs, and production context included?

A particularly dangerous failure occurs when evaluation measures a convenient proxy rather than the real objective. For instance:

$$
\text{Answer similarity}
\neq
\text{Factual correctness}
$$

and:

$$
\text{User preference}
\neq
\text{Safety}
$$

and:

$$
\text{Benchmark performance}
\neq
\text{Production reliability}
$$

The stricter principle is therefore:

**Never authorize a deployment claim stronger than the evidence that supports it.**

If your test establishes “the model performed reliably on 2,000 English customer-support conversations,” you cannot silently transform that into “the model is reliable.” The qualifiers are part of the conclusion. Aggregate scores are particularly dangerous when failures are unevenly distributed. Suppose a system succeeds 99.9% of the time. That sounds excellent. But imagine the remaining 0.1% always involves a catastrophic failure. At one million interactions:

$$
1{,}000{,}000 \times 0.001 = 1{,}000
$$

You now have roughly 1,000 catastrophic events. Scale transforms rare errors into recurring incidents. The correct question is therefore not simply:

“What is the average failure rate?”

You need to understand the **failure distribution**. Some behaviours should function as hard gates. For example, depending on the system, repeated evidence of unauthorized actions, disclosure of protected information, dangerous instructions, discriminatory decisions, irreversible tool misuse, fabricated evidence, or systematic deception might independently justify blocking release. The relevant principle is:

$$
\text{Acceptability}
\neq
\text{average performance}
$$

Instead:

$$
\text{Acceptability}
=
f(\text{frequency}, \text{severity}, \text{detectability}, \text{recoverability}, \text{scale})
$$

Some errors can be tolerated. Some require mitigation. Some invalidate the release. Good evaluation makes those categories explicit before seeing the final results whenever possible. Otherwise organizations become tempted to redefine “acceptable” after discovering what their preferred model happens to do.

![Decision tree separates rejection, deferral, shadow-only authority, restricted release, and broad-release review according to the evidence available for one exact production use](/content-assets/articles/article-mlops-model-evaluation-when-not-to-ship-a-model/no-ship-outcome-tree.png)

*A no-ship outcome is precise: each branch states what work may continue and which production authority remains closed.*

## When Do Residual Harm or Missing Operational Control Make Deployment Unsafe?
<!-- section-summary: Mitigations do not erase residual harm, and a system without monitoring, fallback, rollback, or operator control cannot contain predictable failures. -->

Even measured mitigations can leave unacceptable harm, especially when operators cannot detect, contain, or reverse failure.

Finding a failure and adding a mitigation does not automatically make a system safe. Suppose a dangerous failure occurs 10% of the time. A safety layer catches 90% of those failures. The dangerous output rate becomes roughly:

$$
10\% \times (1-90\%) = 1\%
$$

The mitigation sounds excellent—“90% effective”—but the residual risk may still be unacceptable. The production question is:

**What risk remains after every realistic mitigation is applied?**

Not:

“Did we add safeguards?”

This distinction prevents safety work from becoming procedural theatre. Mitigations matter only insofar as they change real-world outcomes. Even a reasonably well-performing model can be unsuitable for production if the surrounding system cannot contain it. Every production system eventually encounters something the evaluation did not anticipate. So production safety cannot rely on prediction alone. It also requires control. A healthy production architecture should make it possible to limit things such as scale, permissions, actions, data access, tool access, user populations, and rollout speed, while also making abnormal behaviour observable and stoppable. The underlying engineering principle is:

$$
\text{Unknown failures are inevitable}
$$

Therefore:

$$
\text{Safe operation requires bounded consequences}
$$

This is the same principle used throughout other safety-critical engineering fields. You do not build an aircraft on the assumption that components never fail. You design the system so failures are detectable, isolated, redundant, recoverable, or fail-safe. Model systems need analogous properties. A system that cannot be stopped, rolled back, rate-limited, isolated, audited, or prevented from taking high-impact actions places too much trust in perfect model behaviour. And perfect model behaviour is not a credible assumption. A common mistake is treating the model as if it were the deployed product. Usually it is only one component. A real system may look like:

$$
\text{User}
\rightarrow
\text{Prompting}
\rightarrow
\text{Model}
\rightarrow
\text{Tools}
\rightarrow
\text{Policy}
\rightarrow
\text{UI}
\rightarrow
\text{Human}
\rightarrow
\text{External world}
$$

Failures can arise anywhere. A highly capable model paired with excessive permissions may be unsafe. A weaker model with constrained tools and mandatory verification might be acceptable. This gives us an important conclusion:

> **Release readiness is a property of the deployed system, not of the model checkpoint alone.**

Therefore statements such as “Model X passed safety evaluation” should always provoke the question:

Passed for what system configuration

## Why Do Accountable Authority and Unresolved Uncertainty Matter?
<!-- section-summary: Consequential deployment requires accountable authority, while uncertainty about a critical claim can itself be a blocking evaluation result. -->

Those risks need an accountable decision owner, and missing evidence for a critical claim cannot be converted into confidence by optimism.

Another failure has nothing to do with model accuracy. Suppose the evidence is ambiguous. Engineering believes the model is acceptable. Safety disagrees. Product wants to launch. Legal raises unresolved concerns. Who has authority to decide If nobody can answer that clearly, the release process itself is unsafe. A production decision needs both:

$$
\text{Decision rights}
+
\text{Decision accountability}
$$

Someone or some formally defined body must have the authority to approve, restrict, defer, and stop the deployment. Otherwise organizations fall into a dangerous coordination failure:

Everyone participates in the decision, but nobody owns it. This creates asymmetric incentives. Teams benefit from shipping, while responsibility for future failures becomes diffuse. Model evaluation should therefore culminate not merely in a report but in a decision owned by identifiable authority. That authority should know:

* what evidence supports the release,
* what uncertainties remain,
* what risks have been accepted,
* what limits apply,
* and what conditions would trigger rollback.

Without that, “approval” is merely organizational ambiguity disguised as governance. People sometimes assume an evaluation only fails when it discovers something bad. That is incorrect. An evaluation can also fail because it cannot establish what is true. Suppose a safety-critical behaviour occurs only rarely, and your evaluation has too few samples to estimate its rate. The result is not:

“We did not observe the failure, therefore it is safe.”

The result is:

“Our evidence is insufficient to estimate this risk.”

That may justify defer rather than reject. This reflects a deeper epistemic rule:

$$
\text{Unknown} \neq \text{Safe}
$$

In high-consequence systems, uncertainty itself has a cost. The greater the possible severity, the less uncertainty you should tolerate before release.

## How Should a Blocked Release Record Repairs and Reconsider the Full Claim?
<!-- section-summary: A blocked decision records the evidence, reason, owner, and required repair; retesting must reconsider the complete deployment claim and preserve the history. -->

A blocked release should create a specific repair plan and preserve the failed reasoning, then reopen the entire claim rather than only one checkbox.

A failed release review should not end with a vague instruction to “improve the model.” A blocking finding should establish a clear relationship:

$$
\text{Observed failure}
\rightarrow
\text{Required change}
\rightarrow
\text{Evidence needed for reconsideration}
$$

For example:

“Model sometimes makes unsupported claims.” is weak. A stronger finding would establish the affected use case, observed failure rate, severity, blocking threshold, mitigation requirement, and test needed to demonstrate remediation. That turns rejection into an engineering input rather than an argument. This matters because vague failures are easy to reinterpret later. Specific failures are testable. When a model fails evaluation, preserve the evidence. Do not overwrite the failed result with the successful rerun. A mature evaluation history might conceptually look like:

$$
V_1:
\text{Rejected}
\rightarrow
V_2:
\text{Mitigated}
\rightarrow
V_3:
\text{Approved with restrictions}
$$

This history matters for several reasons. First, it shows what kinds of failures the system has exhibited before. Second, it helps future investigators distinguish newly introduced failures from recurring ones. Third, it prevents institutional memory from becoming:

“This model passed evaluation.”

when the more accurate statement is:

“This system originally failed for reasons A and B, changes C and D were made, and the revised configuration passed under conditions E and F.”

That distinction becomes extremely valuable during incidents. Suppose an evaluation finds a prompt-injection vulnerability. The team modifies system prompts and tool permissions. The prompt-injection test now passes. Can the system ship? Not automatically. Why? Because changes have side effects. A mitigation that reduces one failure may produce another:

$$
\text{Fix}(F_1)
\rightarrow
\Delta(F_2,F_3,\ldots)
$$

For example, stronger refusal behaviour might reduce dangerous outputs but increase refusal of legitimate requests. Restricting tools may improve security while reducing task completion reliability. Changing a model checkpoint can affect almost every evaluated behaviour. Therefore remediation should generally trigger both:

$$
\text{Targeted regression test}
+
\text{broader evaluation regression}
$$

The scale of rerun should depend on how consequential and wide-reaching the change was. A tiny UI correction does not necessarily require rebuilding the entire evaluation campaign. A model update, system-prompt rewrite, tool-policy change, or major safety filter often does. There is an even deeper reason to rerun review after repair. The goal is not merely to ask:

“Did we fix the original bug?”

It is to ask again:

**“Given the system that now exists, do we have enough evidence to authorize the deployment that is now proposed?”**

Those are different questions. Suppose a dangerous autonomous action was fixed by adding human confirmation. The resulting system may now be safe. But it is also a different system. Its latency, user experience, operator workload, error propagation, and responsibility structure have changed. So the safety case itself needs updating.

![Control-plane alias change is insufficient rollback evidence until workers are rerouted or restarted and a traceable new request reports the retained model version](/content-assets/articles/article-mlops-model-evaluation-when-not-to-ship-a-model/no-ship-data-plane-recovery.png)

*Recovery is proved in the data path: new traffic must identify the retained release that actually handled it.*

## When Is a Restricted Release a Real Boundary rather than a Rename?
<!-- section-summary: A restricted release is legitimate only when technical and operational controls actually enforce the smaller population, use, capability, and exposure. -->

Teams sometimes respond with a smaller release, but that scope is meaningful only when the system can enforce it.

Restricted deployment is extremely useful, but only when the restrictions are real. Imagine reviewers approve:

“Internal use only, trained operators, 100 requests per day, no autonomous external actions.”

Six months later:

* contractors are added,
* volume reaches 50,000 requests,
* tool access is expanded,
* human review becomes optional.

Nobody technically “released a new model.” But the original safety case no longer describes reality. This is why restrictions should be considered part of the system specification. You can represent the approved operating envelope as:

$$
\Omega =
(U,T,P,S,O)
$$

where the dimensions might represent users, tasks, permissions, scale, and oversight. Evaluation justifies operation inside $$\Omega$$. Moving materially outside it requires reconsideration. This is essentially a **safety envelope**.

## How Do Safety Cases and Evidence Proportionality Support the Decision?
<!-- section-summary: A safety case assembles claims, evidence, assumptions, controls, and residual risk, with the required strength proportional to harm and reversibility. -->

The safety-case model organizes the full argument and asks how much evidence the severity and reversibility of the proposed use require.

The strongest way to think about release evaluation is not:

Model received 87/100, passing threshold 80.

Instead, treat release as an argument. A simplified safety case looks like:

$$
\text{Claim}
\leftarrow
\text{Evidence}
\leftarrow
\text{Tests}
$$

with assumptions connecting each layer.

For example:

**Claim:** The assistant is acceptably safe for internal document summarization. **Evidence:** It rarely introduces material factual errors, sensitive-data handling is controlled, users can detect uncertainty, and harmful output rates remain below predefined limits. **Tests:** Representative summarization evaluations, adversarial tests, privacy tests, production-like shadow traffic, operator studies, and system-level security tests. **Assumptions:** No external tool execution, trained internal users, documents below certain sensitivity levels, human review before consequential use. A deployment should be blocked if the argument breaks anywhere. Maybe the claim is too broad. Maybe the evidence does not support it. Maybe the tests were invalid. Maybe an assumption will not hold in production. This perspective is far more robust than treating evaluation as a collection of leaderboard scores. There is no universal threshold.

Evidence requirements should scale with possible consequences. We can express the principle loosely as:

$$
\text{Required confidence}
\uparrow
\quad \text{as} \quad
\text{Potential harm}
\uparrow
$$

A system suggesting emoji might tolerate significant uncertainty. A system operating critical infrastructure should not. Similarly:

$$
\text{Required control}
\uparrow
\quad \text{as autonomy}
\uparrow
$$

and:

$$
\text{Required monitoring}
\uparrow
\quad \text{as exposure}
\uparrow
$$

and:

$$
\text{Required evidence}
\uparrow
\quad \text{as reversibility}
\downarrow
$$

These relationships give you a much better evaluation philosophy than fixed benchmark thresholds.

## What Is the Final Standard for Deciding Not to Ship?
<!-- section-summary: Do not ship when the available evidence and controls cannot justify the specific system, scope, users, and consequences being proposed. -->

The final rule returns to justified confidence in one concrete deployment, not to whether the model project deserves a launch.

The deepest principle behind “when not to ship” is that deployment is an **authorization of risk under uncertainty**. A model should not enter production merely because it is impressive, better than the previous model, profitable, statistically strong, or because no one has yet demonstrated catastrophic failure. It should ship only when there is a coherent chain of justification:

$$
\boxed{
\text{Defined Use}
\rightarrow
\text{Valid Evidence}
\rightarrow
\text{Acceptable Behaviour}
\rightarrow
\text{Bounded Residual Risk}
\rightarrow
\text{Operational Control}
\rightarrow
\text{Accountable Approval}
}
$$

If that chain breaks, the correct response is not necessarily “cancel the model.” It may be:

$$
\boxed{
\text{Reject}
\quad
\text{Defer}
\quad
\text{Shadow}
\quad
\text{or}
\quad
\text{Restrict}
}
$$

The important part is that the decision follows the evidence rather than the desire to release. A mature evaluation organization therefore treats **“do not ship” as a successful evaluation outcome** when the evidence warrants it. The evaluator's job is not to get models across a finish line. It is to make sure production exposure occurs only when the claim being made about the system is actually justified. And perhaps the most useful rule to remember is:

$$
\boxed{
\text{When the consequences outrun the evidence or the controls, do not ship.}
}
$$

![Six-step no-ship recovery path preserves the blocked record, states allowed and denied authority, assigns repair, creates a new candidate, repeats the full review, and makes a new scoped decision](/content-assets/articles/article-mlops-model-evaluation-when-not-to-ship-a-model/no-ship-reentry-summary.png)

*The old blocked record remains blocked. A repaired release returns with a new identity and earns a separate decision from complete evidence.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[Why Is Shipping a Model an Asymmetric Decision under Uncertainty?]{kind="recap"}
Deployment creates real effects under uncertainty, and the downside of an unjustified release may be much larger than the cost of waiting for evidence.
:::

:::expand[When Do Unclear Use, Invalid Evidence, or Unacceptable Behaviour Block Release?]{kind="recap"}
A release should stop when intended use is unclear or expanding, evaluation evidence is invalid, or important behaviour remains unacceptable despite a good average.
:::

:::expand[When Do Residual Harm or Missing Operational Control Make Deployment Unsafe?]{kind="recap"}
Mitigations do not erase residual harm, and a system without monitoring, fallback, rollback, or operator control cannot contain predictable failures.
:::

:::expand[Why Do Accountable Authority and Unresolved Uncertainty Matter?]{kind="recap"}
Consequential deployment requires accountable authority, while uncertainty about a critical claim can itself be a blocking evaluation result.
:::

:::expand[How Should a Blocked Release Record Repairs and Reconsider the Full Claim?]{kind="recap"}
A blocked decision records the evidence, reason, owner, and required repair; retesting must reconsider the complete deployment claim and preserve the history.
:::

:::expand[When Is a Restricted Release a Real Boundary rather than a Rename?]{kind="recap"}
A restricted release is legitimate only when technical and operational controls actually enforce the smaller population, use, capability, and exposure.
:::

:::expand[How Do Safety Cases and Evidence Proportionality Support the Decision?]{kind="recap"}
A safety case assembles claims, evidence, assumptions, controls, and residual risk, with the required strength proportional to harm and reversibility.
:::

:::expand[What Is the Final Standard for Deciding Not to Ship?]{kind="recap"}
Do not ship when the available evidence and controls cannot justify the specific system, scope, users, and consequences being proposed.
:::
