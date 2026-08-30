---
title: "Approval Authority, Exceptions, and Periodic Review"
description: "Governance decisions need named authority matched to the decision, while proposer, expert adviser, and accountable approver remain distinct enough to provide real challenge."
overview: "Governance decisions need named authority matched to the decision, while proposer, expert adviser, and accountable approver remain distinct enough to provide real challenge. The worked example and control architecture connect proposers, approvers, evidence, release gates, expiring exceptions, production monitoring, review, and accountable Responsible AI decisions."
tags: ["MLOps", "production", "audit"]
order: 3
id: "article-mlops-governance-and-responsible-ai-who-approved-this-model"
aliases:
  - roadmaps/mlops/modules/governance-and-responsible-ai/governance/03-who-approved-this-model.md
  - child-governance-03-who-approved-this-model
---

## Table of Contents

1. [Who Has Authority to Approve an AI Decision and Why Must Roles Stay Independent?](#who-has-authority-to-approve-an-ai-decision-and-why-must-roles-stay-independent)
2. [How Do Evidence, Scope, Conditions, and a Validity Domain Define Approval?](#how-do-evidence-scope-conditions-and-a-validity-domain-define-approval)
3. [How Should Exceptions, Waivers, Risk Acceptance, Expiry, and Escalation Work?](#how-should-exceptions-waivers-risk-acceptance-expiry-and-escalation-work)
4. [Why Do Scheduled and Event-Driven Reviews Revalidate Material Changes?](#why-do-scheduled-and-event-driven-reviews-revalidate-material-changes)
5. [How Should Review Outcomes, Supplier Changes, Disagreement, Appeals, and Dissent Be Handled?](#how-should-review-outcomes-supplier-changes-disagreement-appeals-and-dissent-be-handled)
6. [How Can Platforms Enforce Authority, Conditions, Exceptions, Review, and Decision Evidence?](#how-can-platforms-enforce-authority-conditions-exceptions-review-and-decision-evidence)
7. [Why Are Approvals and Exceptions Time-Bounded Leases?](#why-are-approvals-and-exceptions-time-bounded-leases)
8. [How Does the Complete Authority and Review Control Work in Practice?](#how-does-the-complete-authority-and-review-control-work-in-practice)
9. [Check Your Answers](#check-your-answers)

A model owner wants to release a candidate today, a risk specialist understands the harm scenarios, and a business leader can accept the remaining operational risk. Treating those three roles as interchangeable makes approval depend on whoever happens to be available.

**Approval authority** names who may authorize a defined action. **Exceptions** govern temporary departures from the normal path. **Periodic review** asks whether the evidence and assumptions that justified the decision still hold after time and change. Each control solves a different problem.

These questions follow authority from role design and evidence through scoped approval, exceptions, technical enforcement, revalidation, and accountable closure:

1. **Who Has Authority to Approve an AI Decision and Why Must Roles Stay Independent?**
2. **How Do Evidence, Scope, Conditions, and a Validity Domain Define Approval?**
3. **How Should Exceptions, Waivers, Risk Acceptance, Expiry, and Escalation Work?**
4. **Why Do Scheduled and Event-Driven Reviews Revalidate Material Changes?**
5. **How Should Review Outcomes, Supplier Changes, Disagreement, Appeals, and Dissent Be Handled?**
6. **How Can Platforms Enforce Authority, Conditions, Exceptions, Review, and Decision Evidence?**
7. **Why Are Approvals and Exceptions Time-Bounded Leases?**
8. **How Does the Complete Authority and Review Control Work in Practice?**

## Who Has Authority to Approve an AI Decision and Why Must Roles Stay Independent?
<!-- section-summary: Governance decisions need named authority matched to the decision, while proposer, expert adviser, and accountable approver remain distinct enough to provide real challenge. -->

Governance decisions need named authority matched to the decision, while proposer, expert adviser, and accountable approver remain distinct enough to provide real challenge.

To understand **approval authority, exceptions, and periodic review**, start with a simple problem:

An AI system is ready to go live. The engineering team says:

“The tests passed.”

The product team says:

“Customers need it.”

The legal team says:

“There are conditions.”

The risk team says:

“Some residual risk remains.”

Who gets to decide whether the system may actually operate That question is the foundation of **approval authority**. Now imagine the system does not fully meet one requirement, but there is a strong reason to deploy temporarily anyway. Who is allowed to accept that deviation That is the foundation of **exceptions and risk acceptance**. Finally, suppose the system was approved a year ago but its model, users, supplier, data, business process, and operating environment have changed.

Does the old approval still mean anything?

That is the foundation of **periodic review**. These three ideas belong together because they solve one underlying governance problem:

> **An organization needs a controlled way to decide when risk is acceptable, who may make that decision, under what conditions it remains valid, and when that decision must be reconsidered.**

An AI system creates some expected benefit:

$$
B
$$

and some residual risk after controls:

$$
R
$$

Someone must decide whether operating the system is acceptable.

Conceptually:

$$
\text{Approve}
\quad\text{if}\quad
R \leq A
$$

where:

$$
A = \text{organization's acceptable risk}
$$

In reality, this is not usually a clean mathematical threshold. Risk includes many dimensions:

$$
R =
f(
\text{safety},
\text{fairness},
\text{privacy},
\text{security},
\text{legal},
\text{financial},
\text{reputation},
\text{operational impact}
)
$$

But the underlying decision is still:

**Do the expected benefits justify the remaining risks under the proposed controls and conditions?**

That decision cannot belong to “the process.” A human or formally constituted authority must own it. Imagine a harmful model is deployed. Afterward, everyone says:

“I thought someone else approved it.”

That means governance failed before the model ever went live. If authority is vague:

$$
\text{Unclear authority}
\rightarrow
\text{unclear accountability}
\rightarrow
\text{weak decisions}
$$

So a governance system needs to answer:

Who has authority to approve this specific kind of risk

For example:

* low-risk internal AI → product or business owner,
* medium-risk customer-facing model → business owner plus risk review,
* high-impact automated decision → senior accountable executive,
* very high-risk or unusual use → specialist committee or executive authority.

The titles are organization-specific. The principle is universal:

$$
\boxed{
\text{Every material approval decision must terminate in identifiable authority}
}
$$

Not:

“AI Governance approved it.”

But:

“The designated Consumer Lending Risk Authority approved release 14 for this use.”

The person who understands a model best is not necessarily the person who should accept its risk. Suppose an ML engineer knows everything about the algorithm. They may be able to answer:

Does the model meet its accuracy target

But they may not have authority to decide:

Is a 2% error rate acceptable when the system influences medical treatment

Similarly, a lawyer may interpret regulatory obligations but may not own the business decision. This gives us an important separation:

$$
\text{Expert opinion}
\neq
\text{Risk acceptance authority}
$$

Governance often needs several roles:

- **Subject-matter experts** provide evidence and judgments.
- **Independent reviewers** challenge assumptions.
- **Accountable authority** makes the final decision.

For example:

```text
Engineering
   ↓
Technical evidence

Privacy
   ↓
Privacy assessment

Security
   ↓
Security assessment

Model Risk
   ↓
Independent challenge

Business Executive
   ↓
Final acceptance of residual risk
```

The approver does not need to personally redo every technical test. They need sufficient trustworthy evidence to make the decision they are authorized to make. Not every governance decision is the same. Consider these four actions:

1. Approving a new model.
2. Approving a minor configuration change.
3. Allowing a temporary deviation from policy.
4. Accepting a severe residual risk.

Treating all four identically would be poor governance. The required authority should reflect the decision's consequence. A useful conceptual rule is:

$$
\text{Required Authority Level}
\propto
\text{Magnitude of Risk Being Accepted}
$$

For example:

| Decision                         | Possible authority                               |
| -------------------------------- | ------------------------------------------------ |
| Low-risk model update            | Model/product owner                              |
| Material model release           | Business owner + risk authority                  |
| Temporary control exception      | Control owner + accountable risk owner           |
| High residual customer harm risk | Senior executive                                 |
| Enterprise-wide critical AI use  | Executive committee / designated governance body |

The important idea is **delegated authority**. The organization defines:

Who may make which decisions up to what level of risk

This is sometimes called a **delegation-of-authority framework**. A weak governance system waits until launch day and asks:

“Who needs to sign this?”

A stronger system determines authority from the system's classification.

For example:

$$
\text{System Risk Tier}
\rightarrow
\text{Required Reviews}
\rightarrow
\text{Required Approvers}
$$

Suppose:

```text
Tier 1 → Product Owner

Tier 2 → Product Owner + Risk Reviewer

Tier 3 → Business Executive + Independent Validation

Tier 4 → Executive Risk Committee
```

Now the path is predictable. This matters because governance should not become negotiable whenever teams are under deadline pressure. Imagine someone builds an AI system, wants it launched, selects the test criteria, evaluates the test results, and then approves their own deployment. There is a structural problem. Their incentives may favor launch. This gives us the basic separation-of-duties principle:

$$
\boxed{
\text{The person seeking approval should not be the sole person granting it}
}
$$

Why?

Because:

$$
\text{Creator}
\rightarrow
\text{motivated to show success}
$$

while:

$$
\text{Independent reviewer}
\rightarrow
\text{motivated to test the claim}
$$

These incentives should balance each other. The required independence can scale with risk. For a harmless internal model, peer review may be enough. For a model affecting people's employment or financial access, independent validation may be necessary. Independent review is sometimes misunderstood as:

“The risk team must stop the product team.”

That is not the purpose. The purpose is **credible challenge**. The reviewer asks:

What assumptions are we making
Where could this fail
Does the evidence actually support the conclusion
Are the controls strong enough
What uncertainty remains

So the governance structure intentionally creates:

$$
\text{Proposal}
+
\text{Challenge}
+
\text{Decision}
$$

rather than:

$$
\text{Proposal}
=
\text{Decision}
$$

This is a general principle of good control design, not something unique to AI.

## How Do Evidence, Scope, Conditions, and a Validity Domain Define Approval?
<!-- section-summary: Approval binds evidence to an exact release, use, population, environment, duration, and set of conditions that together define where the decision remains valid. -->

Approval binds evidence to an exact release, use, population, environment, duration, and set of conditions that together define where the decision remains valid.

An approval should not mean:

“A senior person clicked Approve.”

It should mean:

“An authorized person reviewed sufficient evidence and accepted the residual risk under stated conditions.”

Conceptually:

$$
Approval =
f(
\text{Evidence},
\text{Risk},
\text{Controls},
\text{Conditions},
\text{Authority}
)
$$

Relevant evidence might include:

* model-performance evaluation,
* robustness testing,
* fairness analysis,
* security review,
* privacy assessment,
* legal analysis,
* user testing,
* human-oversight design,
* monitoring plan,
* rollback procedures,
* supplier review.

The exact evidence depends on the use. A low-risk summarization tool and a high-impact credit model should not require identical evidence. One of the most dangerous phrases in governance is:

“The model is approved.”

Approved for what Suppose an LLM is approved to:

summarize internal policy documents.

Later somebody uses the same model to:

generate personalized legal advice for customers.

Technically, the model may be unchanged. Governance-wise, it is a different use. So an approval should have a scope:

$$
A =
(
\text{system},
\text{release},
\text{use},
\text{population},
\text{conditions},
\text{time}
)
$$

For example:

Approved for internal HR policy summarization for UK employees, with human review before external communication.

That is meaningful.

Approved: GPT model.

is not. Sometimes a system is acceptable only because particular controls exist.

For example:

The system may operate only if a human reviews every recommendation.

Or:

The system may operate only in the UK.

Or:

The model may not process special-category personal data.

Or:

Generated code must pass automated security scanning before execution.

These conditions form the system's **approved operating envelope**. We can represent it as:

$$
C =
\{
c_1,c_2,c_3,\ldots,c_n
\}
$$

Approval really means:

$$
\boxed{
\text{System is approved while } C \text{ remains true}
}
$$

That distinction becomes crucial later. If:

$$
c_3 = \text{human review required}
$$

and the product removes human review, then the underlying basis for approval has disappeared. Even if the model weights remain identical. Think of approval like a mathematical statement. It is not:

$$
Approved(M)=True
$$

forever and everywhere. It is closer to:

$$
Approved(M,U,C,T)=True
$$

where:

* $$M$$ = approved release,
* $$U$$ = approved use,
* $$C$$ = approved conditions,
* $$T$$ = valid time period.

This is a much better mental model. Approval is **conditional**, not absolute.

![Governance authority matrix matching six decisions to their accountable authorities, required evidence, and scope limits, with separate maker, checker, and enforcement roles](/content-assets/articles/article-mlops-governance-and-responsible-ai-who-approved-this-model/governance-authority-matrix.png)

*Data use, model validation, production use, exceptions, emergency action, and retirement are different decisions. Each needs a defined authority, evidence packet, and scope.*

## How Should Exceptions, Waivers, Risk Acceptance, Expiry, and Escalation Work?
<!-- section-summary: Exceptions are explicit departures from a normal control, distinct from waivers and risk acceptance, and they require ownership, narrow scope, evidence, expiration, and escalation for repetition. -->

Exceptions are explicit departures from a normal control, distinct from waivers and risk acceptance, and they require ownership, narrow scope, evidence, expiration, and escalation for repetition.

Governance rules cannot perfectly anticipate every real situation. Suppose policy says:

Every high-risk model deployment requires full independent validation.

Now a critical fraud system fails unexpectedly, and a replacement model is needed immediately to prevent major customer losses. The full validation process may take too long for the operational situation.

What should happen?

One possibility is:

Ignore governance.

That is unacceptable. Another is:

Never allow deployment.

That might produce greater harm. The useful solution is a **controlled exception path**. An exception says:

A required condition is temporarily not being met, and authorized people knowingly permit that deviation under bounded conditions.

So exceptions are not failures of governance. Uncontrolled exceptions are. Think of normal governance as:

```text
Build
  ↓
Test
  ↓
Validate
  ↓
Approve
  ↓
Deploy
```

An exceptional situation might require:

```text
Build
  ↓
Reduced emergency evidence
  ↓
Emergency risk assessment
  ↓
Authorized temporary approval
  ↓
Deploy with restrictions
  ↓
Complete missing assurance
  ↓
Full review
```

The path is shorter, but it is not uncontrolled. This distinction is critical.

$$
\boxed{
\text{Emergency process}
\neq
\text{No process}
}
$$

Imagine a system must be deployed quickly. A mature organization might relax:

* review sequence,
* documentation timing,
* test depth,
* committee scheduling.

But it should not eliminate:

* named ownership,
* scope,
* risk assessment,
* expiry,
* logging,
* monitoring,
* retrospective review.

A useful principle is:

$$
\text{Urgency} \uparrow
\Rightarrow
\text{Process latency} \downarrow
$$

but not:

$$
\text{Urgency} \uparrow
\Rightarrow
\text{Accountability} \rightarrow 0
$$

In fact, emergency deployments may deserve **stronger monitoring**, because pre-deployment assurance is weaker. These terms are often used loosely, but separating them helps.

### Exception

A requirement normally applies, but the organization temporarily allows a deviation. Example:

Monitoring must operate continuously, but the required monitoring platform is unavailable for five days.

The rule still exists. The deviation is temporary.

### Waiver

A requirement is formally declared not applicable or not required in a particular case. Example:

The standard requires subgroup fairness testing for systems making person-level decisions, but this system performs machine-temperature prediction and affects no individuals.

The organization may document that the requirement does not apply. A waiver is often about **applicability**.

### Risk acceptance

The risk exists and is understood, but an authorized party consciously accepts it. Example:

The model has a known 1.5% error rate that cannot currently be reduced without making the service unusable. The accountable executive accepts the residual operational risk.

Risk acceptance does not necessarily mean a policy requirement was violated. A useful distinction is:

$$
\text{Exception}
=
\text{temporary deviation from requirement}
$$

$$
\text{Waiver}
=
\text{requirement formally not applied}
$$

$$
\text{Risk Acceptance}
=
\text{known residual risk consciously accepted}
$$

Organizations may use different terminology, but these conceptual differences are useful. Suppose a team receives a temporary exception. That means there is now an unresolved difference between:

$$
\text{Required State}
$$

and:

$$
\text{Actual State}
$$

Call that difference:

$$
D = \text{Governance Debt}
$$

As long as the exception remains:

$$
D > 0
$$

The organization should therefore track it like technical debt. A good exception contains:

$$
E =
(
\text{requirement},
\text{deviation},
\text{reason},
\text{risk},
\text{controls},
\text{owner},
\text{expiry},
\text{remediation}
)
$$

The exception is not complete without a plan for returning to a compliant or otherwise approved state. This is one of the most important controls. Suppose an exception says:

Temporary human review process may be skipped.

But no expiry date exists. Three years later, the “temporary” arrangement is still running. Therefore:

$$
\boxed{
\text{Temporary exception without expiry}
\approx
\text{permanent policy change}
}
$$

A strong exception should have a timestamp:

$$
t_{expiry}
$$

When:

$$
t \geq t_{expiry}
$$

one of several things must happen:

$$
\text{remediate}
$$

or:

$$
\text{renew with approval}
$$

or:

$$
\text{restrict system}
$$

or:

$$
\text{stop system}
$$

The default should not be silent continuation. A weak process sends an email:

“Your exception expires next week.”

A stronger system changes governance state automatically.

For example:

```text
Exception valid until: 2026-09-30

September 23:
owner notified

September 27:
escalation sent

September 30:
exception expires

October 1:
deployment privilege suspended
```

The principle is:

$$
\boxed{
\text{Important governance deadlines should not depend entirely on memory}
}
$$

Automation makes temporal controls real. Suppose a team requests the same 30-day exception ten times. Formally each exception is temporary. Practically, the control does not work. Therefore repeated extensions should trigger stronger authority.

For example:

$$
E_1
\rightarrow
\text{manager approval}
$$

$$
E_2
\rightarrow
\text{director approval}
$$

$$
E_3
\rightarrow
\text{executive/risk committee}
$$

This creates an anti-abuse mechanism.

Conceptually:

$$
\text{Repeated Exception}
\Rightarrow
\text{Evidence of structural problem}
$$

At some point governance should stop asking:

Should we extend this temporary exception

and ask:

Is the underlying standard unrealistic, or is the system fundamentally unable to meet requirements

## Why Do Scheduled and Event-Driven Reviews Revalidate Material Changes?
<!-- section-summary: Periodic review renews the original approval argument, while material events can trigger earlier revalidation regardless of how small the code change appears. -->

Periodic review renews the original approval argument, while material events can trigger earlier revalidation regardless of how small the code change appears.

Suppose a system was responsibly approved at time:

$$
t_0
$$

Does that prove it is acceptable at:

$$
t_1
$$

two years later No. Because:

$$
\text{System}_{t_0}
\neq
\text{System}_{t_1}
$$

even if the model artifact is unchanged. The environment can change:

* data distribution changes,
* users change,
* business purpose changes,
* regulation changes,
* threats change,
* vendor behavior changes,
* harms emerge,
* monitoring reveals new weaknesses.

Approval therefore decays in evidential value over time. Not necessarily because the original decision was wrong, but because its assumptions may become stale. Suppose original approval relied on:

$$
A_1 = \text{Model accuracy is adequate}
$$

$$
A_2 = \text{Human review occurs}
$$

$$
A_3 = \text{Data population is stable}
$$

$$
A_4 = \text{Vendor model version is fixed}
$$

$$
A_5 = \text{No significant customer harm detected}
$$

Periodic review asks:

$$
A_1
$$

$$
A_2
$$

$$
A_3
$$

$$
A_4
$$

$$
A_5
$$

still true That is the core idea. Periodic review is not mainly:

“Fill in the annual governance form again.”

It is:

> **Re-test whether the reasoning that justified continued operation still holds.**

A harmless internal classifier may not need quarterly formal review. A high-impact automated medical or financial system may. So:

$$
\text{Review Frequency}
\propto
\text{Risk}
$$

and often:

$$
\text{Review Depth}
\propto
\text{Risk}
$$

Example:

| Risk     | Possible review cadence            |
| -------- | ---------------------------------- |
| Low      | Event-driven or long interval      |
| Moderate | Annual                             |
| High     | 6–12 months                        |
| Critical | Frequent plus continuous oversight |

The exact schedule depends on the organization and regulatory environment. The principle is simply:

Higher-consequence systems deserve stronger ongoing assurance.

Periodic review answers:

“Has enough time passed that we should reassess?”

Event-driven review asks:

“Has something happened that invalidates the current approval?”

You need both. A useful model is:

$$
\text{Re-review required}
=
\text{Periodic Trigger}
\lor
\text{Material Change Trigger}
$$

Typical material triggers include:

* major model retraining,
* foundation-model replacement,
* new data source,
* new user population,
* changed business purpose,
* greater autonomy,
* new jurisdiction,
* significant incident,
* unexpected fairness issue,
* major security vulnerability,
* change in vendor terms or behavior.

Thus even if annual review is twelve months away, a major change may require reassessment today. Consider a customer-support AI approved under this condition:

It may answer questions but cannot execute transactions.

Then engineers add a payment tool. The system has changed from:

$$
\text{informational assistant}
$$

to:

$$
\text{transaction-capable agent}
$$

The risk profile may increase sharply. The old approval should not automatically cover the new capability. We can express this as:

$$
\Delta S > \tau
\Rightarrow
\text{Approval Reassessment}
$$

where:

$$
\Delta S
$$

represents significance of change and $$\tau$$ is a governance threshold. The hard part of change governance is defining what counts as “material.” Suppose one engineer changes a single line:

```text
AUTO_APPROVE = false
```

to:

```text
AUTO_APPROVE = true
```

Tiny code change. Huge governance change. Meanwhile, an engineering team refactors 50,000 lines without changing behavior. Large code change. Possibly little governance significance. Therefore:

$$
\boxed{
\text{Materiality}
\neq
\text{amount of technical change}
}
$$

Instead:

$$
\text{Materiality}
=
f(
\text{effect on behavior},
\text{risk},
\text{population},
\text{autonomy},
\text{controls},
\text{purpose}
)
$$

This is especially important for generative AI systems, where a small prompt or tool-permission change can materially alter behavior. Suppose a high-risk model is substantially retrained and passes pre-deployment review. It may still be wise to review it soon after production launch.

Why?

Because testing environments are approximations. Production gives new evidence:

$$
E_{production}
$$

that did not exist during approval. An effective pattern can therefore be:

```text
Major change
     ↓
Pre-deployment approval
     ↓
Production release
     ↓
Enhanced monitoring
     ↓
Early post-implementation review
     ↓
Normal review cycle
```

This is particularly useful when uncertainty is high.

## How Should Review Outcomes, Supplier Changes, Disagreement, Appeals, and Dissent Be Handled?
<!-- section-summary: Review can approve, condition, restrict, pause, retire, or demand more evidence, and supplier changes, dissent, and appeals remain visible rather than becoming informal bypasses. -->

Review can approve, condition, restrict, pause, retire, or demand more evidence, and supplier changes, dissent, and appeals remain visible rather than becoming informal bypasses.

A periodic review should not only produce:

$$
\text{Approved}
$$

or:

$$
\text{Rejected}
$$

There are usually multiple reasonable outcomes.

For example:

### Continue

The approval remains valid.

$$
\text{Continue}
$$

### Continue with conditions

The system can run, but new safeguards are required.

$$
\text{Continue} + \text{Controls}
$$

### Restrict

Reduce scope, population, autonomy, or functionality.

$$
\text{Operating Envelope} \downarrow
$$

### Retrain or remediate

Correct identified weaknesses.

$$
\text{Repair}
\rightarrow
\text{Revalidate}
$$

### Suspend

Temporarily stop operation.

$$
\text{Production}=Off
$$

### Retire

Permanently end the system.

$$
\text{Lifecycle}=\text{Closed}
$$

This flexibility allows governance to respond proportionally. Initial approval mostly relies on predictions about behavior. Periodic review has an advantage:

The system has actually been operating.

So now governance can ask:

* Did performance remain within limits
* Did drift occur
* Were users harmed
* Did humans actually review decisions
* Were there complaints
* Did override rates change
* Did incidents occur
* Were monitoring alerts handled
* Were policy breaches recorded
* Were exceptions repeatedly requested
* Did the system's use expand beyond scope

The evidence moves from:

$$
\text{Expected behavior}
$$

toward:

$$
\text{Observed behavior}
$$

That can make periodic review more informative than initial approval. Suppose your organization uses an external foundation model. You approve:

```text
Provider: Vendor A
Model: X-4
Configuration: 17
```

Three months later the vendor silently changes:

* model weights,
* moderation behavior,
* retention policy,
* geographic processing,
* tool-use behavior.

Your application code may remain unchanged. But your system has changed because a dependency changed. This leads to:

$$
\boxed{
\text{External dependency changes can be governance-relevant system changes}
}
$$

Periodic and event-driven review therefore needs supplier awareness. The external model is not the only dependency. A production AI system may depend on:

$$
\text{Foundation Model}
+
\text{Cloud Platform}
+
\text{Vector Database}
+
\text{Identity System}
+
\text{Monitoring Stack}
+
\text{Data Providers}
$$

Suppose the identity platform changes and a tool that was previously read-only gains write access. The model artifact has not changed. But the system's effective capability has. Therefore the governed object should be the **whole relevant system**, not just the model file. Good governance creates legitimate disagreements. A product owner may say:

“The remaining risk is small.”

Risk may say:

“The evidence is insufficient.”

Legal may say:

“Use is permissible only under conditions.”

Engineering may say:

“Those conditions make the system impractical.”

If governance assumes everyone will always agree, it has no mechanism for real decisions. So a mature system needs an escalation or appeal path. An appeal route should answer:

Who can resolve a disagreement when normal authorities cannot

For example:

```text
Model Reviewer
      ↓ disagreement
Risk Committee
      ↓ unresolved
Executive Risk Authority
```

The key idea is that appeal moves the decision to a **different authorized level**. It should not mean:

Keep asking people until someone says yes.

Otherwise you get approval shopping. A strong appeal process preserves:

* original findings,
* objections,
* evidence,
* dissent,
* final rationale,
* final decision authority.

Suppose five reviewers approve, but one specialist raises an important objection.

Should that objection disappear once the final decision is made?

Usually no. The final audit record should preserve material dissent.

For example:

Security approved deployment but noted unresolved exposure to a specific prompt-injection path. The business risk authority accepted the residual risk subject to tool restrictions.

Why preserve this?

Because if an incident later occurs, the organization needs to know:

What was understood at the time

Governance is stronger when it records uncertainty rather than rewriting history as if everyone agreed.

![Controlled exception lifecycle from scoped request and policy check through independent review, compensating controls, a time-bound record, pre-expiry escalation, and a policy-controlled expiry decision](/content-assets/articles/article-mlops-governance-and-responsible-ai-who-approved-this-model/controlled-exception-lifecycle.png)

*A temporary exception names one applicable control, passes independent review, adds measurable safeguards, and ends through a policy-controlled expiry decision. Waivers, risk acceptance, and emergency authority remain separate decisions.*

## How Can Platforms Enforce Authority, Conditions, Exceptions, Review, and Decision Evidence?
<!-- section-summary: Registries and delivery platforms can enforce exact release identity, conditions, machine-readable exceptions, review dates, and audit events instead of relying on memory. -->

Registries and delivery platforms can enforce exact release identity, conditions, machine-readable exceptions, review dates, and audit events instead of relying on memory.

Suppose policy says:

Tier-4 models require approval from the Chief Risk Officer.

But the deployment platform allows any engineer to push the model directly into production. Then the real authority lies with the engineer. This exposes a central truth:

$$
\boxed{
\text{Policy authority without technical enforcement may be nominal authority}
}
$$

A stronger architecture connects governance records to deployment systems.

For example:

```text
Release submitted
       ↓
Risk tier retrieved
       ↓
Required approvers calculated
       ↓
Approvals verified
       ↓
Conditions verified
       ↓
Artifact identity checked
       ↓
Deployment token issued
```

If approval is absent:

```text
DEPLOYMENT DENIED
```

Governance becomes part of infrastructure. Suppose:

$$
M_{42}
$$

is approved. Then someone replaces it with:

$$
M_{43}
$$

If the deployment system only checks:

```text
system_status = approved
```

it may mistakenly allow the new artifact. A stronger check is:

$$
hash(M_{deploy})
=
hash(M_{approved})
$$

and:

$$
config_{deploy}
=
config_{approved}
$$

subject to defined tolerances. Therefore approval is not simply:

```text
system = approved
```

It is closer to:

```text
release 42 + configuration 17 + use case 8 = approved
```

This connects approval authority with auditability. Suppose approval says:

This model may only produce recommendations. Automatic execution is prohibited.

The platform could encode:

```text
tool_permission = recommendation_only
```

Suppose approval says:

Use is permitted only for EU customers.

The runtime could enforce geography or system boundaries. Suppose approval says:

Human review required above €10,000.

The workflow engine can route those decisions accordingly. This gives us the progression:

$$
\text{Approval Condition}
\rightarrow
\text{Technical Policy}
\rightarrow
\text{Runtime Enforcement}
$$

The closer governance moves toward this model, the less it depends on memory. Imagine an exception grants:

Temporary permission to operate without control X until September 30.

A good governance platform might record:

```text
exception_id = E-771
control = X
system = fraud-model
valid_until = 2026-09-30
approved_by = authorized-risk-owner
```

Production systems can then ask:

$$
\text{control satisfied}
\lor
\text{valid exception exists}
$$

If neither is true:

$$
\text{BLOCK}
$$

After expiry:

$$
\text{valid exception} = False
$$

automatically. This is much safer than attaching a PDF saying:

“Exception approved.”

Suppose a Tier-3 AI system requires review every twelve months. The governance platform stores:

$$
t_{next-review}
$$

Then:

```text
60 days before:
owner notified

30 days before:
risk function notified

review overdue:
system enters non-compliant state

after grace period:
new deployments blocked
or escalation triggered
```

Now periodic review is not just a calendar convention. It is a control. A weak record might say:

```text
Status: APPROVED
```

A strong record tells the story. For an approval:

```text
System:
Loan Recommendation System

Release:
42

Decision:
Approved

Scope:
Consumer loan recommendations

Conditions:
Human reviewer required

Evidence:
Validation V-91
Fairness Report F-18
Privacy Assessment P-42

Approver:
Authorized Lending Risk Executive

Decision date:
2026-03-20

Next review:
2027-03-20
```

For an exception:

```text
Exception:
EX-77

Requirement:
Continuous drift monitoring

Reason:
Monitoring platform migration

Compensating control:
Daily manual sampling

Owner:
Model Operations Head

Expiry:
2026-04-15

Escalation:
Chief Risk Officer if extension required
```

This creates reconstructability. A useful abstraction is:

$$
G =
(
\text{Decision},
\text{Subject},
\text{Authority},
\text{Evidence},
\text{Conditions},
\text{Time}
)
$$

For example:

$$
G_{approval}
$$

or:

$$
G_{exception}
$$

or:

$$
G_{review}
$$

A good system records each as an immutable governance event. This makes the history visible:

```text
2025-10-01
Initial approval

2026-01-14
Material model change submitted

2026-01-20
Reapproval granted

2026-03-02
Temporary monitoring exception

2026-03-31
Exception closed

2026-07-20
Periodic review

2026-07-20
Approval continued with new condition
```

Now the approval is not a static label. It is a timeline.

## Why Are Approvals and Exceptions Time-Bounded Leases?
<!-- section-summary: Approval grants temporary authority inside a validity domain, an exception grants a narrower temporary departure, and review renews, changes, or ends those leases as evidence changes. -->

Approval grants temporary authority inside a validity domain, an exception grants a narrower temporary departure, and review renews, changes, or ends those leases as evidence changes.

A useful mental model is to think of approval as a **lease to operate**. The system receives permission:

You may operate within these boundaries while these assumptions remain true.

That permission can expire or be withdrawn.

Conceptually:

$$
Permission(t)
=
\begin{cases}
1  \text{if approval valid and conditions satisfied}\\
0  \text{otherwise}
\end{cases}
$$

This is better than treating approval as a permanent certificate. AI systems evolve too quickly for perpetual approval to make sense. Using the same analogy:

Normal approval gives:

$$
\text{Permission within standard controls}
$$

An exception gives:

$$
\text{Temporary permission despite defined deviation}
$$

but only if:

$$
t < t_{expiry}
$$

and compensating conditions remain satisfied. Thus:

$$
Exception
=
\text{bounded temporary risk decision}
$$

not:

$$
Exception
=
\text{ignore policy}
$$

At review time, governance asks:

Should permission continue

Possible results are:

$$
\text{Renew}
$$

$$
\text{Renew with new conditions}
$$

$$
\text{Reduce scope}
$$

$$
\text{Suspend}
$$

$$
\text{Retire}
$$

So the lifecycle can be visualized as:

```text
            INITIAL ASSESSMENT
                    │
                    ▼
                 APPROVE
                    │
             ┌──────┴──────┐
             │             │
          OPERATE        CHANGE
             │             │
             │             ▼
             │          REASSESS
             │             │
             └──────┬──────┘
                    │
                    ▼
              PERIODIC REVIEW
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
    CONTINUE     RESTRICT      RETIRE
```

Exceptions sit alongside this lifecycle as temporary deviations that themselves expire and require closure. Responsible AI may say:

Humans should remain accountable.

Approval authority makes that concrete:

$$
\text{Named decision authority}
$$

Responsible AI may say:

Systems should be safe.

Approval requires:

$$
\text{evidence of acceptable residual risk}
$$

Responsible AI may say:

AI should be continuously monitored.

Periodic review asks:

$$
\text{does production evidence still support approval?}
$$

Responsible AI may say:

Governance should be transparent.

Audit records preserve:

$$
\text{who decided what, why, and under which conditions}
$$

So these mechanisms are how Responsible AI principles become operational governance. There is a useful way to see the relationship.

### Approval Authority answers:

**Who may permit the system to operate now?**

It solves the **decision-rights problem**.

### Exceptions answer:

**What do we do when the normal requirements cannot temporarily be met?**

They solve the **controlled-deviation problem**.

### Periodic Review answers:

**How do we know yesterday's approval is still justified today?**

It solves the **stale-assurance problem**. Together:

$$
\boxed{
\text{Authority}
+
\text{Controlled Deviation}
+
\text{Revalidation}
}
$$

form a governance loop.

## How Does the Complete Authority and Review Control Work in Practice?
<!-- section-summary: The worked example and control architecture connect proposers, approvers, evidence, release gates, expiring exceptions, production monitoring, review, and accountable Responsible AI decisions. -->

The worked example and control architecture connect proposers, approvers, evidence, release gates, expiring exceptions, production monitoring, review, and accountable Responsible AI decisions.

Imagine a bank develops an AI system that flags suspicious transactions.

### Initial proposal

The fraud team proposes:

Fraud Model Release 12.

Because it can automatically block some transactions, it is classified as high risk.

### Required authority

Governance rules say:

```text
Technical approval:
Head of ML Engineering

Independent validation:
Model Risk

Operational approval:
Head of Fraud

Residual risk acceptance:
Consumer Risk Executive
```

No single development team can self-approve.

### Evidence

Reviewers receive:

* performance results,
* false-positive analysis,
* subgroup testing,
* security review,
* privacy assessment,
* monitoring plan,
* rollback mechanism.

### Approval

The final decision says:

Release 12 may block transactions only above threshold 0.97. Scores between 0.80 and 0.97 require human review.

This condition becomes part of approval.

### Deployment

The pipeline verifies:

$$
model\_hash = approved\_hash
$$

and:

$$
threshold = 0.97
$$

before production deployment.

### Exception

Two months later, the normal monitoring platform fails. Fraud remains operationally critical. An authorized risk owner grants a 7-day exception:

Continue operation with manual daily review of false positives.

The exception records:

$$
expiry = 7\ days
$$

and cannot automatically continue afterward.

### Change

Engineers later propose lowering automatic blocking to:

$$
0.90
$$

No model retraining occurs. But the business effect changes materially:

$$
\text{more automated blocking}
$$

Therefore governance triggers reapproval.

### Periodic review

Six months later reviewers examine:

* actual false-positive rate,
* customer complaints,
* subgroup behavior,
* fraud-loss reduction,
* model drift,
* human overrides,
* incidents,
* prior exceptions.

They discover complaints have increased substantially. The review outcome is:

Continue operation, but raise automatic-block threshold to 0.985 and retrain within 60 days.

The approval is therefore modified. This whole sequence is the governance system working as intended. At any moment, a governed AI system can be thought of as having a state:

$$
S_t =
(
M_t,
U_t,
C_t,
R_t,
E_t
)
$$

where:

* $$M_t$$ = current model/system configuration,
* $$U_t$$ = current use,
* $$C_t$$ = current controls,
* $$R_t$$ = current observed risk,
* $$E_t$$ = current evidence.

Approval at time $$t_0$$ establishes:

$$
Acceptable(S_{t_0}) = True
$$

But over time:

$$
S_{t_1} \neq S_{t_0}
$$

Therefore governance requires a mechanism to determine:

$$
Acceptable(S_{t_1})
$$

That mechanism is reassessment and periodic review. If a requirement temporarily fails, governance also needs:

$$
TemporaryPermission(S_t)
$$

That mechanism is controlled exception handling. And every one of these judgments must come from someone with:

$$
Authority \geq Risk\ Decision\ Required
$$

That is the mathematical skeleton underneath the entire topic. You can reduce the whole subject to this:

```text
                    PROPOSAL
                       │
                       ▼
               Is evidence sufficient
                       │
                       ▼
               Who has authority
                       │
                       ▼
                    APPROVAL
             scope + conditions + expiry
                       │
                       ▼
                 PRODUCTION USE
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
     CHANGE         EXCEPTION       TIME
        │              │              │
        │         expiry + owner       │
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                    REVIEW
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
        CONTINUE    RESTRICT      RETIRE
```

Every arrow should leave an audit record. Approval Authority, Exceptions, and Periodic Review can sound like three administrative processes. They are really three controls over **organizational permission**.

### Approval Authority

answers:

$$
\boxed{\text{Who is allowed to accept this risk?}}
$$

### Exceptions

answer:

$$
\boxed{\text{How may we temporarily operate outside normal requirements without losing control?}}
$$

### Periodic Review

answers:

$$
\boxed{\text{How do we know the old risk decision is still valid?}}
$$

Together they prevent three common governance failures:

$$
\text{Nobody truly owns the decision}
$$

$$
\text{Temporary deviations become permanent}
$$

$$
\text{Old approvals survive long after their assumptions become false}
$$

The deepest formulation is:

**A responsible organization does not treat AI approval as a permanent stamp. It treats deployment as conditional permission granted by named authority, supported by evidence, bounded by explicit conditions, temporarily adjustable through controlled exceptions, and repeatedly reconsidered as the system and its environment change.**

Or, even more compactly:

$$
\boxed{
\text{Named Authority}
\rightarrow
\text{Evidence-Based Permission}
\rightarrow
\text{Bounded Exceptions}
\rightarrow
\text{Continuous Revalidation}
}
$$

That is the first-principles foundation of **Approval Authority, Exceptions, and Periodic Review in Governance and Responsible AI**.

![Approval and periodic-review lifecycle in which only approved decisions enter the exact-release gate, live review triggers converge on current evidence, and reassessment continues, restricts, retrains, replaces, suspends, or retires the system](/content-assets/articles/article-mlops-governance-and-responsible-ai-who-approved-this-model/approval-review-lifecycle-summary.png)

*Approved and conditional decisions pass through an exact deployment gate. Scheduled review, material change, and emergency follow-up return live evidence to reassessment, which must produce and verify a new operating state.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[Who Has Authority to Approve an AI Decision and Why Must Roles Stay Independent?]{kind="recap"}
Governance decisions need named authority matched to the decision, while proposer, expert adviser, and accountable approver remain distinct enough to provide real challenge.
:::

:::expand[How Do Evidence, Scope, Conditions, and a Validity Domain Define Approval?]{kind="recap"}
Approval binds evidence to an exact release, use, population, environment, duration, and set of conditions that together define where the decision remains valid.
:::

:::expand[How Should Exceptions, Waivers, Risk Acceptance, Expiry, and Escalation Work?]{kind="recap"}
Exceptions are explicit departures from a normal control, distinct from waivers and risk acceptance, and they require ownership, narrow scope, evidence, expiration, and escalation for repetition.
:::

:::expand[Why Do Scheduled and Event-Driven Reviews Revalidate Material Changes?]{kind="recap"}
Periodic review renews the original approval argument, while material events can trigger earlier revalidation regardless of how small the code change appears.
:::

:::expand[How Should Review Outcomes, Supplier Changes, Disagreement, Appeals, and Dissent Be Handled?]{kind="recap"}
Review can approve, condition, restrict, pause, retire, or demand more evidence, and supplier changes, dissent, and appeals remain visible rather than becoming informal bypasses.
:::

:::expand[How Can Platforms Enforce Authority, Conditions, Exceptions, Review, and Decision Evidence?]{kind="recap"}
Registries and delivery platforms can enforce exact release identity, conditions, machine-readable exceptions, review dates, and audit events instead of relying on memory.
:::

:::expand[Why Are Approvals and Exceptions Time-Bounded Leases?]{kind="recap"}
Approval grants temporary authority inside a validity domain, an exception grants a narrower temporary departure, and review renews, changes, or ends those leases as evidence changes.
:::

:::expand[How Does the Complete Authority and Review Control Work in Practice?]{kind="recap"}
The worked example and control architecture connect proposers, approvers, evidence, release gates, expiring exceptions, production monitoring, review, and accountable Responsible AI decisions.
:::
