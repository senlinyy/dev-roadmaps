---
title: "Handling Bad Predictions"
description: "Learn how to contain harmful ML decisions, find every affected case, diagnose the failing layer, and repair decisions that already reached users."
overview: "A bad-prediction incident can hide behind a healthy API. Responders protect users first, verify that their evidence is trustworthy, trace affected decisions across model and policy layers, and match the repair to the real cause."
tags: ["MLOps", "production", "recovery"]
order: 2
id: "article-mlops-deployment-and-release-management-handling-bad-predictions"
---

## Table of Contents

1. [When Is a Wrong Prediction an Expected Error or a Systemic Breakdown?](#when-is-a-wrong-prediction-an-expected-error-or-a-systemic-breakdown)
2. [How Do You Protect Users, Preserve Evidence, Verify the Signal, and Find the Blast Radius?](#how-do-you-protect-users-preserve-evidence-verify-the-signal-and-find-the-blast-radius)
3. [Which Containment Action Fits the Severity and Confidence?](#which-containment-action-fits-the-severity-and-confidence)
4. [How Do You Diagnose Backward through Decision, Policy, Postprocessing, Model, Features, and Raw Data?](#how-do-you-diagnose-backward-through-decision-policy-postprocessing-model-features-and-raw-data)
5. [How Do You Repair Future and Historical Decisions without Creating New Harm?](#how-do-you-repair-future-and-historical-decisions-without-creating-new-harm)
6. [How Do You Prove Recovery across Service, Prediction, Policy, and Delayed Outcomes?](#how-do-you-prove-recovery-across-service-prediction-policy-and-delayed-outcomes)
7. [Which Prepared Controls and Examples Make Bad-Prediction Response Faster and Safer?](#which-prepared-controls-and-examples-make-bad-prediction-response-faster-and-safer)
8. [What Three Questions Summarize Bad-Prediction Risk Management?](#what-three-questions-summarize-bad-prediction-risk-management)
9. [Check Your Answers](#check-your-answers)

A customer receives an obviously wrong churn intervention, but the prediction server is healthy and the model's aggregate score has barely moved. The cause could be one input, a threshold, calibration, feature code, the deployed artifact, retrieval, a downstream tool, or ordinary model error.

Handling a **bad prediction** starts with the final decision and affected person rather than assuming retraining is the answer. The team protects users, preserves a complete decision trace, verifies the signal, finds the blast radius, contains the narrowest unsafe path, and diagnoses backward through every layer.

These questions follow that response from one report to historical repair and proven recovery:

1. **When Is a Wrong Prediction an Expected Error or a Systemic Breakdown?**
2. **How Do You Protect Users, Preserve Evidence, Verify the Signal, and Find the Blast Radius?**
3. **Which Containment Action Fits the Severity and Confidence?**
4. **How Do You Diagnose Backward through Decision, Policy, Postprocessing, Model, Features, and Raw Data?**
5. **How Do You Repair Future and Historical Decisions without Creating New Harm?**
6. **How Do You Prove Recovery across Service, Prediction, Policy, and Delayed Outcomes?**
7. **Which Prepared Controls and Examples Make Bad-Prediction Response Faster and Safer?**
8. **What Three Questions Summarize Bad-Prediction Risk Management?**

## When Is a Wrong Prediction an Expected Error or a Systemic Breakdown?
<!-- section-summary: Models have ordinary error, but a systemic breakdown changes the decision path, rate, cohort, or consequence beyond its expected behavioural envelope even when the service is healthy. -->

One bad outcome may be expected model error; incident response begins by determining whether the complete decision path has changed systemically.

A **bad prediction** sounds like a model problem:

```text
input
  ↓
model
  ↓
wrong prediction
```

But production ML systems are rarely that simple. A customer may experience a wrong decision because of:

```text
bad source data
bad feature computation
wrong model version
model regression
incorrect calibration
threshold change
postprocessing bug
stale cache
fallback behavior
integration error
policy mistake
```

So the first principle is:

> **A bad observed decision tells you that the end-to-end decision path produced an undesirable result. It does not yet tell you which component failed.**

Handling bad predictions well therefore requires three separate abilities:

```text
1. Stop additional harm.

2. Discover which layer actually caused it.

3. Repair decisions that already happened.
```

And before any of those, we need an important distinction. Suppose a fraud classifier has:

```text
precision = 96%
recall    = 92%
```

That means some predictions will inevitably be wrong.

For example:

```text
Transaction X
true state: legitimate
model prediction: fraud
```

One wrong prediction does not necessarily indicate a production incident. The model may simply have encountered one of the cases it cannot classify perfectly. The real question is:

Is this an expected individual model error, or evidence that the production system has moved outside its expected behavior

That distinction is fundamental. Imagine a model normally makes mistakes on:

```text
2% of cases
```

Today you discover one bad prediction. That might be:

```text
normal model uncertainty
```

Now imagine:

```text
Yesterday:
2% bad decisions

Today:
27% bad decisions
```

That suggests something much larger. Or perhaps:

```text
Overall error rate:
still 2%

Customers in France:
34% errors
```

The aggregate system looks healthy while one cohort is badly affected. So bad predictions should be classified roughly as:

```text
isolated expected error
        ↓
localized systematic problem
        ↓
broad production regression
        ↓
critical decision incident
```

The response should depend on which one you are dealing with. Consider:

```http
POST /predict

HTTP/1.1 200 OK
```

Response:

```json
{
  "fraud_probability": 0.97
}
```

Technically:

```text
request accepted
model executed
response serialized
network healthy
```

But suppose the transaction is legitimate. From an infrastructure perspective:

```text
SUCCESS
```

From a decision-quality perspective:

```text
FAILURE
```

This gives us three separate notions of correctness:

```text
Execution correctness:
Did the system execute

Prediction correctness:
Was the model estimate acceptable

Decision correctness:
Was the action taken from that estimate acceptable
```

A production ML system must monitor all three. This is one of the most useful distinctions. Suppose the model says:

```text
fraud probability = 0.71
```

A policy says:

```text
score >= 0.90 → block
score >= 0.60 → manual review
otherwise     → approve
```

The resulting decision is:

```text
manual review
```

The model produced a **prediction**. The surrounding system produced the **decision**. Now imagine someone changes the threshold:

```text
block threshold:
0.90 → 0.70
```

The exact same prediction now produces:

```text
BLOCK
```

Nothing about the model changed. So when users report:

"The model is making bad decisions."

you should conceptually unpack:

```text
Was the score wrong

Was the score interpreted incorrectly

Was the policy inappropriate

Was the action incorrectly executed
```

These are different failure modes. A useful mental model is:

```text
Real-world event
      ↓
Raw data
      ↓
Feature computation
      ↓
Model input
      ↓
Model
      ↓
Raw model output
      ↓
Calibration / postprocessing
      ↓
Decision policy
      ↓
Action
      ↓
Real-world outcome
```

A bad result can originate at any step.

For example:

```text
wrong raw data
      ↓
perfect model computation
      ↓
bad prediction
```

or:

```text
correct model prediction
      ↓
wrong threshold
      ↓
bad decision
```

or:

```text
correct prediction
      ↓
correct policy
      ↓
downstream system executes wrong action
```

So:

> **Do not debug the model first. Debug the decision path.**

Suppose users report:

```text
"Customers are being incorrectly rejected."
```

That is the **symptom**. Possible causes include:

```text
Model retraining regression
Feature pipeline bug
Input units changed
Threshold changed
Stale features
Wrong model artifact loaded
Label ordering changed
Fallback path activated
Policy configuration changed
Data population shifted
```

The symptom tells you where harm appears. It does not tell you where the defect originated. This distinction prevents a common incident-response failure:

```text
bad outcome
    ↓
assume model bad
    ↓
retrain model
```

when the actual problem might be:

```text
currency conversion bug
```

Retraining would not solve it. Suppose a loan-risk model expects:

```text
annual_income = pounds
```

A feature pipeline changes and begins producing:

```text
annual_income = pence
```

Instead of:

```text
£45,000
```

the model receives:

```text
4,500,000
```

Everything may still type-check:

```text
float → float
```

The model produces a perfectly valid numerical result. The API returns:

```text
HTTP 200
```

The prediction is wrong because the **meaning of the input changed**. If you replace the model without fixing the units:

```text
new model
+
same bad feature
=
same class of problem
```

Hence diagnosis must precede correction.

## How Do You Protect Users, Preserve Evidence, Verify the Signal, and Find the Blast Radius?
<!-- section-summary: Response protects users first while preserving decision traces, verifies the measurement with independent evidence, versions every cause, and identifies affected cohorts and rates. -->

Before deep diagnosis, the team limits harm, preserves evidence, verifies the signal, and identifies the affected population.

Suppose incorrect automatic rejections are happening right now. There are two objectives:

```text
Objective A:
Understand exactly why.

Objective B:
Stop additional incorrect rejections.
```

If harm is continuing rapidly, B usually has higher immediate priority.

Conceptually:

```text
Bad decisions occurring
        ↓
Contain exposure
        ↓
Investigate safely
        ↓
Repair root cause
```

You do not need a perfect causal explanation before taking a safe reversible containment action. There is an important tension. Suppose you immediately:

```text
restart everything
clear caches
overwrite model files
delete intermediate records
```

Production may recover. But you may destroy the information needed to determine why it failed. Before or during containment, preserve critical evidence when doing so does not prolong material harm. Useful evidence can include:

```text
request IDs
timestamps
model version
feature version
policy version
input snapshot
feature values
raw prediction
postprocessed prediction
threshold
final action
fallback path
server instance
deployment version
```

This lets you reconstruct the failure later. For an affected request, you want something like:

```text
Decision ID:        D829731
Timestamp:          14:03:17
Customer cohort:    GB
Model:              fraud-v43
Feature set:        features-v18
Raw score:          0.941
Calibrated score:   0.917
Policy:             fraud-policy-v9
Block threshold:    0.900
Fallback used:      false
Final action:       BLOCK
```

Ideally you can also determine the relevant feature provenance. This allows the investigation to ask:

```text
Was the input correct
Was the feature correct
Did the correct model execute
Was the score interpreted correctly
Did the correct policy execute
```

Without this trace, people are forced to infer production history from current state. That is much less reliable. There is another subtle problem. Suppose monitoring claims:

```text
false-positive rate increased
```

Before changing the model, ask whether your ground-truth data is trustworthy. For example, perhaps:

```text
fraud labels arrive 14 days later
```

and today's dashboard uses incomplete labels. Or:

```text
outcome event pipeline failed
```

making successful transactions appear unsuccessful. Or:

```text
manual-review labels changed definition
```

The model may appear worse because the measurement system changed. So check:

```text
prediction data
+
outcome/label data
+
join between them
```

before concluding model quality truly deteriorated. Suppose the dashboard reports:

```text
approval rate = approvals / all API calls
```

A new system begins retrying requests. Now the denominator contains duplicates. Actual customer approvals may be unchanged while the dashboard falls. Similarly:

```text
model accuracy
```

could change because:

```text
label definition changed
population changed
deduplication broke
late outcomes are missing
```

Monitoring is evidence, not unquestionable truth. If possible, verify the symptom from several sources:

```text
prediction logs
decision database
raw customer outcomes
support reports
downstream actions
manual samples
```

Suppose:

```text
dashboard:
block rate = 30%

transaction database:
block rate = 29.8%

support:
sharp increase in blocked-card complaints
```

Now confidence is high that the production behavior really changed. If instead:

```text
dashboard:
30%

database:
4.1%

support:
normal
```

you probably have a measurement incident rather than a decision incident. Once you know a problem exists, ask:

Which decisions may actually be affected

Imagine a system serving:

```text
10 million predictions/day
```

A bug affects only:

```text
model v43
+
French traffic
+
Android clients
+
between 13:00 and 15:20
```

You do not necessarily have:

```text
10 million suspicious predictions
```

You have a bounded cohort.

Conceptually:

```text
All decisions
     ↓
Affected time
     ↓
Affected release
     ↓
Affected feature/model/policy
     ↓
Affected population
```

This is blast-radius analysis. To identify affected decisions reliably, it helps to record:

```text
model_version
feature_version
preprocessing_version
calibration_version
policy_version
application_version
experiment_variant
```

Why so much? Because this:

```text
model = v43
```

may not uniquely specify behavior.

For example:

```text
09:00:
v43 + features F8 + policy P3

13:00:
v43 + features F9 + policy P3

16:00:
v43 + features F9 + policy P4
```

Only one combination may be bad. Model provenance alone cannot identify it. Do not stop at:

```text
"some predictions are wrong."
```

Break them down.

For example:

```text
Cohort A:
Model v43
iOS users
US
normal behavior

Cohort B:
Model v43
Android users
US
normal behavior

Cohort C:
Model v43
Android users
France
high false-positive rate
```

Now the problem looks much more specific. Possible dimensions include:

```text
model version
region
language
device
client version
customer segment
feature version
time
input type
prediction class
confidence range
traffic route
```

Good cohorting turns a vague ML failure into an engineering hypothesis. Imagine:

```text
Overall false-positive rate

Before: 2.0%
After:  2.3%
```

That seems minor. But by language:

```text
English: 1.9%
Spanish: 2.1%
French:  18.7%
German:  2.0%
```

The production aggregate hides severe harm. This is why segmented monitoring matters. A system can look statistically healthy overall while being systematically broken for a smaller group. Suppose only:

```text
French predictions using feature-set F19
```

are affected. Possible containment:

```text
France/F19 → previous model
everyone else → current model
```

rather than:

```text
shut down entire service
```

The more accurately you understand the affected cohort, the more targeted the response can be. But if boundaries are uncertain and consequences are serious, conservative broader containment may be preferable.

![A sharply lower measured precision branching into six possible causes, each paired with the specific data, model, policy, runtime, outcome, or release repair it requires.](/content-assets/articles/article-mlops-deployment-and-release-management-handling-bad-predictions/quality-symptom-six-causes.png)

*The same quality symptom can require six different repairs, so trustworthy evidence and the first meaningful divergence must determine the response.*

## Which Containment Action Fits the Severity and Confidence?
<!-- section-summary: Containment may restrict a cohort, disable an action, change policy, use human review, roll back, or stop both models according to severity and certainty. -->

The size and certainty of that population determine whether to restrict, disable actions, review manually, roll back, or stop the system.

There is no universal containment strategy. Possible actions include:

```text
rollback model
reduce model traffic
disable a feature
restore previous features
restore previous policy
increase threshold
route uncertain cases to manual review
disable automated action
fall back to rules
pause downstream processing
```

Choosing among them depends on:

```text
What evidence do we have
How severe is the harm
How reversible is the action
How broad is the affected cohort
How trustworthy is the rollback path
```

Suppose Model B was deployed at 12:00. Bad decisions started at 12:05. Rolling back B is a reasonable first containment action. But suppose after rollback:

```text
bad decisions continue
```

That is important evidence. Perhaps the actual problem is:

```text
new feature pipeline
```

which remained active. A dangerous response is:

```text
rollback B
problem continues
assume rollback failed
repeatedly redeploy models
```

A disciplined response updates its hypothesis based on evidence. Imagine a model automatically bans accounts. During uncertainty, you might continue running the model but change:

```text
prediction → automatic ban
```

to:

```text
prediction → human review
```

Now you preserve:

```text
production predictions
diagnostic evidence
shadow comparison
```

while preventing uncertain predictions from creating irreversible actions. This can be a powerful emergency mode. The general principle:

**When prediction quality is uncertain, separate inference from consequential action whenever architecture allows it.**

If:

```text
Model A = known-good
Model B = suspicious candidate
```

and API/data compatibility remains safe, then:

```text
B traffic → 0%
A traffic → 100%
```

is often strong containment. This is why deployment systems should preserve an immutable, known-good release. A rollback strategy invented only after bad predictions appear is likely to be slower and riskier. Suppose the input data pipeline is corrupted.

Then:

```text
bad inputs → Model A
```

and:

```text
bad inputs → Model B
```

may both produce unreliable outputs. Rolling back models accomplishes nothing. The appropriate containment may instead be:

```text
stop automated decisions
```

or:

```text
use a safe rules fallback
```

until input integrity is restored. Again:

Containment should target the failing layer, not whatever happens to be called "the model."

## How Do You Diagnose Backward through Decision, Policy, Postprocessing, Model, Features, and Raw Data?
<!-- section-summary: Diagnosis starts at the observed action and walks backward through policy, calibration, artifact identity, exact inputs, feature computation, raw semantics, replay, rates, drift, retrieval, and tools. -->

With containment in place, investigation works backward from the action and changes one dimension at a time to locate the failing layer.

Once harm is contained, investigate deliberately. For one known-bad decision:

```text
Observed harmful outcome
        ↑
Was the correct action executed
        ↑
Was the decision policy correct
        ↑
Was the prediction interpreted correctly
        ↑
Was the model output correct
        ↑
Were model inputs correct
        ↑
Were features correct
        ↑
Was raw source data correct
```

This backwards investigation starts from something you know is wrong and finds the first point at which reality diverged from expectation. Suppose a customer was rejected. First ask:

```text
Was the customer really rejected
```

Maybe the model approved them but downstream software displayed the wrong status. Check:

```text
action record
API response
database state
external system
```

Do not debug inference before confirming the reported consequence. Suppose the rejection really happened. Ask:

```text
Why did the decision engine reject
```

Perhaps:

```text
score = 0.62
threshold = 0.60
```

Then policy behavior is internally consistent. But maybe the expected threshold was:

```text
0.85
```

Now you have a policy/configuration problem. No need to blame the model. Suppose the raw model produced:

```text
raw score = 0.41
```

but final score became:

```text
0.91
```

There may be an error in:

```text
calibration
normalization
probability conversion
class selection
aggregation
```

For example, a classifier may output logits:

```text
[2.1, -0.4]
```

and buggy postprocessing may select the wrong class. The model itself may be functioning correctly. Check:

```text
Which model version handled this request
```

Not:

```text
Which model did the deployment configuration intend to use
```

These can differ. Possible failures:

```text
old pods never terminated
wrong artifact mounted
model registry alias changed
cache retained previous artifact
partial rollout occurred
```

You need evidence from actual serving. Suppose:

```text
expected income feature:
0.50
```

but production model received:

```text
50.0
```

The root cause is now upstream. This is why logging or reproducibly reconstructing model inputs can be invaluable. For sensitive systems, you may not store every raw field, but you still need enough secure provenance to reproduce decisions appropriately. Check whether the raw data became the expected model feature.

For example:

```text
Raw age:
42 years

Expected transformed feature:
0.42

Actual transformed feature:
42
```

or:

```text
Expected:
transactions_last_7_days

Actual:
transactions_last_7_hours
```

Feature bugs often create valid-looking numbers, making them harder to catch than schema errors. If feature transformation is correct, perhaps the source itself changed.

For example:

```text
country_code:
"GB"
```

used to mean ISO country of transaction. A source update may now populate:

```text
country of card issuer
```

Same field. Same string type. Different semantics. This is one reason semantic contracts matter as much as data schemas. Dashboards tell you:

```text
something changed
```

A detailed request trace tells you:

```text
how one concrete bad result was produced
```

Suppose you choose one false rejection and reconstruct:

```text
Raw amount:          £120
Raw country:         GB

Features:
amount_scaled:       0.12
country_is_domestic: 0   ← suspicious

Model:
fraud-v51

Score:
0.96

Policy:
score > 0.90 → block
```

The surprising feature:

```text
country_is_domestic = 0
```

gives you a strong lead. Trace several representative examples to determine whether the pattern generalizes. Once you have historical inputs, compare system combinations. Suppose:

```text
F1 = old features
F2 = new features

M1 = old model
M2 = new model
```

Replay:

```text
F1 → M1 = 0.21
F1 → M2 = 0.23
F2 → M1 = 0.94
F2 → M2 = 0.96
```

This strongly suggests:

```text
F2 is responsible
```

because both models behave badly with F2. Compare that with:

```text
F1 → M1 = 0.21
F1 → M2 = 0.93
F2 → M1 = 0.22
F2 → M2 = 0.95
```

Now M2 is the stronger suspect. Controlled replay is one of the most powerful ML-debugging techniques. A production model system might be:

```text
F2 + M4 + C3 + P7
```

where:

```text
F = features
M = model
C = calibration
P = policy
```

A deliberate investigation compares:

```text
F1 + M4 + C3 + P7
F2 + M3 + C3 + P7
F2 + M4 + C2 + P7
F2 + M4 + C3 + P6
```

rather than changing everything simultaneously. This is essentially experimental science:

Hold most variables fixed and vary one suspected cause.

Suppose someone reports:

```text
Model B incorrectly classified example X.
```

Replay X through Model A:

```text
Model A → wrong too
Model B → wrong
```

Then B may not have introduced the defect. Perhaps this is an existing hard case. That changes the appropriate response from:

```text
rollback immediately
```

to perhaps:

```text
model-quality improvement backlog
```

depending on severity. This is why baselines matter. One bad example can be very important—especially if consequences are severe—but release decisions should usually also examine populations.

For example:

```text
False-positive rate

Model A:
2.1%

Model B:
2.3%
```

versus:

```text
Model A:
2.1%

Model B:
18.6%
```

Those tell very different stories. Likewise by segment:

```text
                    A        B

English           2.0%     2.1%
French            2.2%    24.0%
German            2.1%     2.3%
```

Anecdotes identify failure modes. Population statistics determine scope. Suppose the score distribution changes sharply:

```text
Old:
median = 0.12

New:
median = 0.67
```

Something changed. But possible explanations include:

```text
bad model
bad feature
new customer population
real-world event
traffic-routing change
```

Distribution drift should trigger investigation. It should not automatically imply:

```text
model regression
```

You need context. Suppose both old and new models rank users correctly. But:

```text
Old model:
score 0.8 ≈ 80% probability

New model:
score 0.8 ≈ 55% probability
```

Downstream code uses:

```text
score >= 0.8 → automatic action
```

The new model may have strong ranking accuracy but poor compatibility with the threshold. So a model can appear good on metrics such as:

```text
AUC
ranking quality
```

while producing bad decisions because its calibration changed. This is why model deployment must evaluate the metrics downstream policies actually depend on. Suppose scores move slightly:

```text
0.78 → 0.82
```

With threshold:

```text
0.80
```

that changes the action. Meanwhile:

```text
0.10 → 0.30
```

is a much larger numerical shift but may not change any decision. Therefore one useful metric is:

```text
fraction of decisions crossing important thresholds
```

rather than only:

```text
mean prediction difference
```

The effect on decisions matters more than raw score distance. For a classifier, a bad prediction may be:

```text
wrong label
```

For a generative model, the output space is much less constrained. "Bad" might mean:

```text
factually incorrect
unsafe
irrelevant
wrong format
wrong tool choice
failed instruction
too expensive
excessively verbose
invalid structured output
```

The same incident principles still apply. You need to determine whether the problem came from:

```text
model
prompt
retrieval
tool result
conversation state
decoder configuration
postprocessing
policy
```

Do not collapse everything into:

```text
"LLM hallucination."
```

Consider:

```text
Question
   ↓
Retriever
   ↓
incorrect/stale document
   ↓
Model
   ↓
confident answer based on wrong evidence
```

The model may have followed the supplied context correctly. The failed layer was retrieval. Possible fix:

```text
repair index
```

not:

```text
replace model
```

Again, the real unit of debugging is the decision system. Suppose a model correctly decides:

```text
refund = £50
```

but the tool adapter sends:

```text
refund = £500
```

The model's reasoning was correct. The production outcome was bad. For agents, tracing requires:

```text
model output
tool call
arguments
authorization
tool execution
side effect
```

Handling bad ML outcomes increasingly resembles distributed-system transaction tracing. Once the fault is isolated:

```text
bad feature pipeline
```

repair the feature pipeline. If it is:

```text
bad calibration
```

repair calibration. If:

```text
wrong model artifact
```

restore the correct artifact. If:

```text
bad threshold
```

restore policy configuration. If:

```text
model quality regression
```

rollback, retrain, recalibrate, or otherwise replace the model. The principle sounds obvious, but ML teams can fall into "model-first" thinking where every bad outcome becomes a retraining project.

**Repair the smallest causal layer that explains the failure.**

Suppose the model suddenly performs badly because:

```text
price feature changed from dollars to cents
```

Retraining on the original feature semantics will not help. Retraining on corrupted data could make things worse. Similarly, if:

```text
threshold configuration is wrong
```

no retraining is necessary. Retraining makes sense when the actual model has become unsuitable—for example:

```text
bad training data
model regression
real population drift
obsolete concept
```

and even then it should go through validation and release controls. Under incident pressure, suppose you quickly patch:

```text
if country == "FR":
    score *= 0.1
```

Perhaps this fixes the observed example. But it may introduce another untested failure. Recovery changes should still receive as much validation as the situation allows:

```text
replay
integration tests
shadowing
small canary
release gates
```

Emergency fixes are still production releases.

## How Do You Repair Future and Historical Decisions without Creating New Harm?
<!-- section-summary: Repair targets the failed layer; affected-decision discovery separates future, reversible past, and irreversible harm, with idempotent remediation and original plus corrected records. -->

Stopping new errors does not repair earlier decisions, so remediation needs affected-case discovery, reversible actions, idempotency, and preserved history.

Imagine bad predictions occurred for two hours. You fix production at 15:00. New decisions are correct. But from 13:00–15:00:

```text
12,000 predictions
```

may already have produced actions. You now need another question:

What should happen to decisions that were already made

This is historical remediation. Suppose the faulty model produced 12,000 predictions. Perhaps:

```text
12,000 predictions executed

3,500 predictions materially wrong

1,200 crossed a decision boundary

700 caused customer-visible actions
```

These are different populations:

```text
potentially affected predictions
        ↓
actually incorrect predictions
        ↓
changed decisions
        ↓
real-world consequences
```

Remediation should target the appropriate level. Suppose the defect affected:

```text
model_version = v43
feature_version = F12
time = 13:00–15:00
country = GB
```

Query:

```text
all decision IDs matching those conditions
```

Call this the **candidate affected set**. Then refine based on the known failure mode. For example, if the bug affects only:

```text
income > £100,000
```

you can narrow further. Start conservatively and reduce the set with evidence. Suppose an affected request originally produced:

```text
faulty system:
score 0.94 → BLOCK
```

Replay using the corrected system:

```text
corrected:
score 0.17 → APPROVE
```

This is clearly a changed decision. Another case:

```text
faulty:
score 0.92 → BLOCK

corrected:
score 0.91 → BLOCK
```

The score was affected, but the final action would be unchanged. That may require different remediation. Suppose yesterday's model used:

```text
account balance at prediction time
```

Today that balance is different. If you replay using current data, you are not reproducing yesterday's decision. Reliable replay may require:

```text
historical raw input
historical feature values
historical context
```

or deterministic reconstruction from versioned source data. This is one reason preserving decision provenance matters. Suppose a prediction created:

```text
refund
email
account action
payment
job
```

Reprocessing it can duplicate the side effect.

For example:

```text
first execution → £50 refund
replay          → another £50 refund
```

That is not a safe correction. Historical repair should distinguish:

```text
recompute decision
```

from:

```text
repeat original side effect
```

and use idempotent correction mechanisms where possible. Examples might include:

```text
restore recommendation eligibility
remove incorrect flag
reopen support ticket
requeue a job
restore access
recompute ranking
```

Other remediation may require:

```text
manual review
customer support
financial reconciliation
specialized operational handling
```

Your ability to repair past bad predictions depends heavily on what the downstream action was. Compare:

```text
Model predicts:
"recommend product X"
```

If wrong, the effect is temporary. Versus:

```text
Model predicts:
"permanently delete account"
```

Now the consequence is much harder to reverse. This yields a deployment principle:

The harder an ML decision is to reverse, the stronger the safeguards should be before automatic execution.

Possible safeguards:

```text
human review
higher thresholds
two-stage approval
delayed activation
shadow evaluation
strict canary
audit logging
```

For important workflows, avoid erasing incident history. Instead of changing:

```text
decision = BLOCK
```

into:

```text
decision = APPROVE
```

without provenance, preserve something like:

```text
Original decision:
model v43
score 0.94
BLOCK

Correction:
model v42
score 0.17
APPROVE

Reason:
incident INC-284

Remediation status:
completed
```

Now future audits can explain what happened.

![A traced live prediction path from the decision API through feature lookup, model scoring, policy evaluation, durable decision recording, and the final product action.](/content-assets/articles/article-mlops-deployment-and-release-management-handling-bad-predictions/live-decision-trace.png)

*The shared trace explains the sampled runtime path, while logs and the governed decision record preserve the identities needed to investigate the product action.*

## How Do You Prove Recovery across Service, Prediction, Policy, and Delayed Outcomes?
<!-- section-summary: Recovery has several layers and needs baseline comparison, known failed cases, fresh traffic, original-signal monitoring, and patience for delayed ground truth. -->

Recovery must then be demonstrated at each layer and may remain uncertain until delayed outcomes arrive.

After a fix, do not ask only:

```text
"Is production working?"
```

Ask:

```text
Infrastructure recovered
Data recovered
Features recovered
Predictions recovered
Decision rates recovered
Customer outcomes recovering
Historical remediation complete
```

These may finish at different times. Suppose the incident was a feature corruption. After correcting it, verify:

### Data

```text
volume normal
freshness normal
missingness normal
semantics correct
```

### Features

```text
distributions returned to expected ranges
training/serving parity restored
```

### Model

```text
expected version running
prediction distribution healthy
known cases replay correctly
```

### Policy

```text
correct thresholds/configuration active
```

### Decisions

```text
approval/block/review rates normal
```

### Outcomes

```text
customer complaints declining
manual-review accuracy restored
business metrics recovering
```

Recovery evidence should match the original failure chain. Suppose:

```text
Fraction blocked

Before incident:   3.9%
Incident:         29.7%
After correction:  4.1%
```

That is strong recovery evidence. Similarly:

```text
Feature median

Before: 0.43
Incident: 43.0
After: 0.44
```

Explicit baselines make recovery much easier to evaluate than subjective dashboard inspection. A particularly useful recovery check is:

```text
Take examples known to fail during incident
        ↓
run through corrected system
        ↓
verify expected behavior
```

For instance:

```text
Decision 8317

Incident system:
0.96 → BLOCK

Corrected system:
0.18 → APPROVE
```

Do this for multiple representative cohorts. This directly demonstrates that the diagnosed failure path was repaired. Offline replay proves:

```text
the fix works on known evidence
```

It does not prove:

```text
the live system is wired correctly
```

So also verify real requests after deployment. A staged recovery can be:

```text
corrected release
      ↓
shadow traffic
      ↓
1% exposure
      ↓
5%
      ↓
25%
      ↓
100%
```

with relevant decision-quality gates. Recovery should often resemble a fresh production release. Suppose the incident involved:

```text
French false-positive rate
```

Do not merely monitor global API errors after recovery. Watch:

```text
French false-positive proxy
French prediction distribution
French threshold-crossing rate
```

The original failure mode deserves targeted monitoring until confidence is restored. Imagine actual fraud labels arrive:

```text
30 days later
```

You cannot prove model accuracy immediately. Instead use layers of evidence. Early indicators:

```text
input distribution
prediction distribution
decision distribution
manual reviews
```

Later indicators:

```text
confirmed labels
fraud losses
customer outcomes
```

So recovery confidence may accumulate over time. The lack of immediate labels makes strong leading indicators even more valuable.

## Which Prepared Controls and Examples Make Bad-Prediction Response Faster and Safer?
<!-- section-summary: Immutable known-good releases, kill switches, history, cohort queries, decision and outcome monitoring, shadowing, canaries, and worked examples make response executable before an incident. -->

Prepared artifacts, switches, traces, queries, monitors, and progressive-release practices turn the response path into an operable system.

The worst time to discover you cannot answer:

```text
Which model handled this decision
```

is during an incident. Production ML should be designed so you can answer:

```text
What happened
Which version produced it
Which input/features did it see
Which policy consumed it
Who was affected
Can we replay it
Can we stop it
Can we restore the previous state
```

These are architectural capabilities. If model B becomes suspicious, rollback should mean:

```text
activate model artifact A
```

where A is exact and immutable. Not:

```text
"try to rebuild whatever was serving last Tuesday"
```

Useful artifact provenance may include:

```text
model hash
training run
training dataset version
runtime configuration
preprocessor version
```

This makes recovery reproducible. Useful controls include:

```text
candidate traffic → 0%
disable automated decision
switch to previous model
disable suspicious feature
force manual review
pause downstream side effects
```

These should be:

```text
documented
permissioned
tested
observable
```

A kill switch that has never been exercised is only a hypothesis. Depending on privacy, security, and regulatory constraints, retain enough securely governed information to reconstruct important decisions. Potential fields:

```text
decision ID
timestamp
model version
feature version
policy version
request provenance
prediction
decision
side-effect ID
experiment assignment
```

The goal is not unlimited logging. It is **sufficient provenance**. Store only what is appropriate while retaining the ability to understand consequential decisions. Imagine an incident occurs and the team asks:

```text
"Which customers were affected?"
```

If answering requires writing an entirely new data pipeline, remediation slows dramatically. A mature system makes common dimensions searchable:

```text
by model version
by deployment
by region
by time
by policy version
by decision type
```

Incident recovery becomes much faster. Infrastructure metrics:

```text
HTTP errors
latency
memory
GPU utilization
```

should be complemented by decision metrics such as:

```text
approval rate
block rate
manual-review rate
positive prediction rate
confidence distribution
fallback rate
```

These detect a class of incidents where:

```text
software healthy
decision behavior unhealthy
```

Prediction behavior may appear stable while actual product outcomes worsen.

For example:

```text
score distribution:
normal
```

but:

```text
customer complaints:
+300%
```

Outcome metrics connect model operation to real-world impact. They are often slower than technical signals, so both levels are needed:

```text
leading signals
+
actual outcome signals
```

Instead of monitoring only:

```text
positive rate
```

define expectations such as:

```text
normal approval rate:
91–95%

normal p99 risk score:
0.84–0.91

normal manual review:
3–6%

normal fallback:
<0.5%
```

Then deployment gates can notice unexpected shifts. Not every deviation is wrong, but it becomes evidence demanding explanation. Suppose a canary produces:

```text
candidate false-positive proxy:
8× baseline
```

A release controller could automatically:

```text
candidate traffic → 0%
```

before full rollout. This converts:

```text
global incident
```

into potentially:

```text
small canary failure
```

Release management is one of the strongest mechanisms for preventing bad predictions from becoming widespread harm. Before Model B controls decisions:

```text
Request
  ├──→ Model A → real decision
  │
  └──→ Model B → logged only
```

Compare:

```text
prediction disagreement
threshold crossing
segment behavior
latency
failure rate
```

If B behaves strangely, you can investigate without allowing its outputs to control production. Shadowing is particularly valuable when decision errors are expensive. Shadowing can tell you:

```text
B's predictions look different.
```

But it cannot always tell you:

```text
What happens when users actually experience B
```

A small canary gives B limited real control:

```text
99% A
1% B
```

Now you can observe actual consequences while limiting blast radius. Thus:

```text
shadow
→ prediction confidence

canary
→ limited decision confidence

A/B experiment
→ causal product impact
```

They solve different problems. Suppose Model A predicts customer churn. A new Model B is released. Normal behavior:

```text
Customers flagged high-risk:
7%
```

After release:

```text
31%
```

All servers report:

```text
healthy
```

First response:

```text
B traffic reduced to 0%
A restored
```

Yet the high-risk rate remains:

```text
29%
```

So Model B was probably not the main cause. Trace one affected decision:

```text
Customer C42

Model: A
Score: 0.91

Important feature:
days_since_last_login = 8,640
```

That seems suspicious. Source data:

```text
last login:
6 days ago
```

Investigation discovers the feature pipeline changed from:

```text
days
```

to:

```text
minutes
```

without changing the model contract. So:

```text
6 days
```

became:

```text
8,640
```

The model was correct given the input it received. The feature was semantically wrong. Correct response:

```text
rollback feature transform
recompute affected predictions
identify actions triggered by those predictions
repair those actions
```

Retraining the model would have attacked the wrong layer. Suppose a medical-priority model normally outputs:

```text
risk score = 0–1
```

and policy says:

```text
score ≥ 0.85 → urgent review
```

A configuration deployment accidentally changes:

```text
0.85 → 0.35
```

Suddenly:

```text
urgent review volume:
4% → 57%
```

Prediction distribution:

```text
unchanged
```

Model version:

```text
unchanged
```

The incident is entirely in decision policy. The correct repair is:

```text
restore threshold
```

followed by reviewing affected prioritization decisions. Now suppose inputs and features are identical. Replay:

```text
old model A:
false-positive rate = 2.1%

new model B:
false-positive rate = 13.4%
```

especially for:

```text
new customers
```

Training investigation finds the retraining dataset accidentally excluded much of that segment. Now the model itself is the causal layer. Appropriate response may include:

```text
rollback B
repair training dataset
retrain candidate
offline evaluate by cohort
shadow
canary
release again
```

The method works because diagnosis determines correction.

## What Three Questions Summarize Bad-Prediction Risk Management?
<!-- section-summary: Ask whether the decision is truly bad, how many cases and people are affected, and which narrow control can stop harm while preserving evidence. -->

The final three questions keep the process centered on validity, blast radius, and the safest evidence-preserving control.

You cannot create a nontrivial ML system that will never make a wrong prediction. So the objective cannot be:

```text
zero errors forever
```

Instead, production engineering should aim for:

```text
Know expected error
        ↓
Detect abnormal error
        ↓
Limit exposure
        ↓
Identify affected decisions
        ↓
Trace causal path
        ↓
Repair correct layer
        ↓
Repair past consequences
        ↓
Verify recovery
```

That is a much more realistic reliability model. When bad predictions appear, ask three questions in order.

### Question 1: What should we stop

```text
Which ongoing actions could continue causing harm
```

This determines containment.

### Question 2: What actually failed

```text
data
features
model
calibration
integration
policy
downstream execution
```

This determines the technical fix.

### Question 3: What already happened

```text
Which historical decisions were affected,
and what must be repaired
```

This determines remediation. These questions correspond to:

```text
future
present
past
```

A complete response handles all three. A "bad prediction" is an observation at the end of a much larger system:

```text
Source data
    ↓
Features
    ↓
Model
    ↓
Prediction
    ↓
Calibration
    ↓
Policy
    ↓
Decision
    ↓
Action
    ↓
Outcome
```

So the wrong mental model is:

```text
bad outcome
   ↓
bad model
   ↓
retrain model
```

The better mental model is:

```text
Bad outcome detected
        ↓
Is the evidence real
        ↓
Which decisions are affected
        ↓
What ongoing harm should be contained
        ↓
Trace representative decisions backward
        ↓
Find the first layer that diverged
        ↓
Repair that layer
        ↓
Replay and identify historical affected decisions
        ↓
Repair reversible consequences
        ↓
Validate every layer against baseline
        ↓
Restore production progressively
```

And the deepest distinction is:

**Models inevitably make some prediction errors. The operational problem is not the existence of every individual error; it is failing to recognize when errors become systematic, failing to limit their consequences, or being unable to reconstruct and repair the decisions they created.**

That is why **handling bad predictions in deployment and release management** is not mainly about retraining models. It is about designing a production decision system in which you can **detect abnormal behavior, identify exactly what changed, contain the affected population, trace predictions back to their causes, restore a known-good path, and repair the decisions that already escaped into the real world.**

![The complete bad-prediction response path from user protection and evidence preservation through cohort analysis, layer-specific repair, past-decision remediation, and recovery proof.](/content-assets/articles/article-mlops-deployment-and-release-management-handling-bad-predictions/bad-prediction-response-summary.png)

*Protect future decisions with the narrowest safe control, repair the proven cause, preserve prior records, and track every consumed decision to a final disposition.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[When Is a Wrong Prediction an Expected Error or a Systemic Breakdown?]{kind="recap"}
Models have ordinary error, but a systemic breakdown changes the decision path, rate, cohort, or consequence beyond its expected behavioural envelope even when the service is healthy.
:::

:::expand[How Do You Protect Users, Preserve Evidence, Verify the Signal, and Find the Blast Radius?]{kind="recap"}
Response protects users first while preserving decision traces, verifies the measurement with independent evidence, versions every cause, and identifies affected cohorts and rates.
:::

:::expand[Which Containment Action Fits the Severity and Confidence?]{kind="recap"}
Containment may restrict a cohort, disable an action, change policy, use human review, roll back, or stop both models according to severity and certainty.
:::

:::expand[How Do You Diagnose Backward through Decision, Policy, Postprocessing, Model, Features, and Raw Data?]{kind="recap"}
Diagnosis starts at the observed action and walks backward through policy, calibration, artifact identity, exact inputs, feature computation, raw semantics, replay, rates, drift, retrieval, and tools.
:::

:::expand[How Do You Repair Future and Historical Decisions without Creating New Harm?]{kind="recap"}
Repair targets the failed layer; affected-decision discovery separates future, reversible past, and irreversible harm, with idempotent remediation and original plus corrected records.
:::

:::expand[How Do You Prove Recovery across Service, Prediction, Policy, and Delayed Outcomes?]{kind="recap"}
Recovery has several layers and needs baseline comparison, known failed cases, fresh traffic, original-signal monitoring, and patience for delayed ground truth.
:::

:::expand[Which Prepared Controls and Examples Make Bad-Prediction Response Faster and Safer?]{kind="recap"}
Immutable known-good releases, kill switches, history, cohort queries, decision and outcome monitoring, shadowing, canaries, and worked examples make response executable before an incident.
:::

:::expand[What Three Questions Summarize Bad-Prediction Risk Management?]{kind="recap"}
Ask whether the decision is truly bad, how many cases and people are affected, and which narrow control can stop harm while preserving evidence.
:::
