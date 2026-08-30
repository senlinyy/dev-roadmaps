---
title: "ML A/B Testing"
description: "Compare model versions with controlled product experiments, stable assignment, guardrail metrics, delayed labels, and clear analysis before widening traffic."
overview: "ML A/B testing estimates whether a model-driven product change caused a meaningful improvement. It connects random assignment, real exposure, outcome data, statistical evidence, and release decisions."
tags: ["MLOps", "production", "delivery"]
order: 3
id: "article-mlops-deployment-and-release-management-ab-testing-for-ml-products"
aliases:
  - roadmaps/mlops/modules/deployment-and-release-management/release-strategies/02-ab-testing-for-ml-products.md
  - child-release-strategies-02-ab-testing-for-ml-products
---

## Table of Contents

1. [How Does Random Assignment Estimate the Causal Effect of an ML Product Change?](#how-does-random-assignment-estimate-the-causal-effect-of-an-ml-product-change)
2. [How Do Randomization Unit, Eligibility, Assignment, Exposure, and Intention-to-Treat Fit Together?](#how-do-randomization-unit-eligibility-assignment-exposure-and-intention-to-treat-fit-together)
3. [How Should Primary, Guardrail, Proxy, Delayed, and Windowed Metrics Be Defined?](#how-should-primary-guardrail-proxy-delayed-and-windowed-metrics-be-defined)
4. [How Do Sample Size, Power, Intervals, Integrity Checks, and the Analysis Unit Support Valid Results?](#how-do-sample-size-power-intervals-integrity-checks-and-the-analysis-unit-support-valid-results)
5. [How Do Peeking, Multiple Tests, Interference, Feedback, Novelty, and Learning Threaten the Experiment?](#how-do-peeking-multiple-tests-interference-feedback-novelty-and-learning-threaten-the-experiment)
6. [How Do Durable Assignment, Exposure, Outcome Data, Precommitment, and Staged Release Operate the Test?](#how-do-durable-assignment-exposure-outcome-data-precommitment-and-staged-release-operate-the-test)
7. [How Do Worked Results, Heterogeneity, Variance Reduction, Constraints, and Inappropriate Cases Shape Decisions?](#how-do-worked-results-heterogeneity-variance-reduction-constraints-and-inappropriate-cases-shape-decisions)
8. [What Checklist and Mental Model Define a Trustworthy ML A/B Test?](#what-checklist-and-mental-model-define-a-trustworthy-ml-ab-test)
9. [Check Your Answers](#check-your-answers)

A recommendation model increases clicks after a gradual rollout. That does not establish that the model caused the increase; the exposed users, time period, or traffic mix may also have changed. To estimate a causal effect, the product needs comparable alternative realities.

An **A/B test** assigns eligible units randomly to stable treatments and measures outcomes under a predeclared analysis. Assignment, actual exposure, and observed outcome are different events. The design must also control interference, delayed effects, peeking, multiple metrics, data joins, and safety guardrails.

These questions follow the experiment from causal objective and randomization through production operation and the final product decision:

1. **How Does Random Assignment Estimate the Causal Effect of an ML Product Change?**
2. **How Do Randomization Unit, Eligibility, Assignment, Exposure, and Intention-to-Treat Fit Together?**
3. **How Should Primary, Guardrail, Proxy, Delayed, and Windowed Metrics Be Defined?**
4. **How Do Sample Size, Power, Intervals, Integrity Checks, and the Analysis Unit Support Valid Results?**
5. **How Do Peeking, Multiple Tests, Interference, Feedback, Novelty, and Learning Threaten the Experiment?**
6. **How Do Durable Assignment, Exposure, Outcome Data, Precommitment, and Staged Release Operate the Test?**
7. **How Do Worked Results, Heterogeneity, Variance Reduction, Constraints, and Inappropriate Cases Shape Decisions?**
8. **What Checklist and Mental Model Define a Trustworthy ML A/B Test?**

## How Does Random Assignment Estimate the Causal Effect of an ML Product Change?
<!-- section-summary: An A/B test uses randomized potential alternatives to estimate a causal product effect that cannot be observed for the same unit in both realities. -->

A rollout shows whether a system survives limited exposure, while an experiment estimates what would have happened under an alternative treatment.

ML A/B testing answers a question that offline evaluation and ordinary deployment monitoring cannot reliably answer:

**What changed in the real product because users were served Model B instead of Model A?**

That sounds simple, but it is fundamentally a **causal inference** problem. Suppose:

```text
Model A → 8.2% purchase rate
Model B → 8.8% purchase rate
```

Can we conclude that Model B caused the improvement? Not necessarily. Perhaps B happened to serve:

```text
more returning customers
more users in high-income regions
more weekend traffic
more mobile users
```

The purpose of a controlled experiment is to make those alternative explanations implausible. The central mechanism is **random assignment**. Imagine an ML recommendation system. Current production model:

```text
Model A
```

Candidate:

```text
Model B
```

Offline evaluation says:

```text
Precision@10

A = 0.31
B = 0.35
```

So B looks better. But the product does not fundamentally care about:

```text
Precision@10
```

It may actually care about:

```text
purchases
watch time
successful searches
retention
revenue
customer satisfaction
```

A model can improve an offline metric while hurting the product.

For example:

```text
Model B
   ↓
more clickable recommendations
   ↓
users click more
   ↓
recommendations are repetitive
   ↓
long-term satisfaction falls
```

Or:

```text
Model B
   ↓
higher ranking relevance
   ↓
more expensive inference
   ↓
page becomes slower
   ↓
conversion falls
```

Therefore offline evaluation answers:

How does B perform on a dataset under an evaluation procedure

An A/B test asks:

What happens to the real system when eligible units actually experience B instead of A

Those are different questions. Suppose Alice sees Model B. We observe:

```text
Alice + Model B → purchase
```

What we really want to know is:

```text
Would Alice also have purchased
if she had received Model A
```

But we cannot go back in time and run the same Alice through an alternate universe. For each user there are conceptually two possible outcomes:

```text
Y(A) = outcome if assigned Model A
Y(B) = outcome if assigned Model B
```

But we can observe only one:

```text
Alice receives A → observe Y(A)

or

Alice receives B → observe Y(B)
```

Never both simultaneously. This is the fundamental problem of causal inference. Instead of comparing the same individual to themselves, we create two statistically comparable groups. Randomly assign many users:

```text
Eligible users
      |
      | random assignment
      |
   ┌──┴──┐
   v     v
   A     B
control treatment
```

Because the assignment is random, sufficiently large groups should be similar, on average, in characteristics unrelated to the experiment.

For example:

```text
                 A              B

Returning users  42.1%          42.0%
Mobile users     61.4%          61.6%
Avg. age         similar        similar
Region mix       similar        similar
Traffic time     similar        similar
```

The important difference is:

```text
A gets Model A
B gets Model B
```

Therefore if outcomes systematically differ:

```text
E[Y | B] - E[Y | A]
```

we can attribute that difference to the treatment, subject to the experiment's assumptions. That is the first-principles reason randomization works. Suppose purchase rate is:

```text
Control A:   8.0%
Treatment B: 8.6%
```

The estimated absolute effect is:

```text
8.6% - 8.0%
= +0.6 percentage points
```

The relative effect is:

```text
(8.6 - 8.0) / 8.0
= 7.5%
```

These are different statements.

```text
absolute lift = +0.6 percentage points

relative lift = +7.5%
```

It is usually worth reporting both. But statistical uncertainty matters too. The observed difference could partly reflect random variation. That leads to confidence intervals, statistical tests, and statistical power, which we will get to. This distinction is extremely important in release management. A **canary rollout** might ask:

Is Model B safe enough to expose to more traffic

An **A/B experiment** asks:

What causal effect does Model B have relative to Model A

Consider:

```text
Model A → 95%
Model B → 5%
```

This could be a canary. You might monitor:

```text
error rate
latency
crashes
GPU memory
safety incidents
prediction distribution
```

If everything looks healthy, increase B to 20%. But that does not automatically make it a valid experiment. Perhaps traffic was assigned like this:

```text
first 5% of traffic each minute → B
```

or:

```text
European region → B
everything else → A
```

Now differences may reflect the population rather than the model. An experiment requires deliberate assignment that supports causal comparison. A rollout is primarily:

```text
Candidate
   ↓
limited exposure
   ↓
safe
   ↓
more exposure
```

An A/B test is primarily:

```text
Eligible population
      |
   randomize
    /     \
   A       B
    \     /
     outcomes
        ↓
causal comparison
```

You can combine them.

For example:

```text
Stage 1: 1% canary
         safety only

Stage 2: 50/50 A/B experiment
         product impact

Stage 3: 100% rollout
         if experiment wins
```

Each stage answers a different question. It helps to establish precise terms. Suppose we're testing recommendation Model B.

### Control

The existing baseline:

```text
Model A
```

### Treatment

The change being tested:

```text
Model B
```

### Experimental unit

The thing randomly assigned.

For example:

```text
user
```

### Assignment

Which group the unit is allocated to:

```text
User 42 → treatment
```

### Exposure

Whether the unit actually encountered the treatment.

For example:

```text
User 42 was assigned B
but never opened the recommendation page
```

means:

```text
assigned = B
exposed = no
```

### Outcome

What happened afterward:

```text
purchase
click
watch time
retention
revenue
```

### Primary metric

The main quantity used to judge the experiment.

For example:

```text
purchase conversion
```

### Guardrail metric

A measure that must not deteriorate excessively.

For example:

```text
latency
complaints
cancellations
safety violations
```

These concepts should be distinct in your data model.

## How Do Randomization Unit, Eligibility, Assignment, Exposure, and Intention-to-Treat Fit Together?
<!-- section-summary: The assignment unit matches interference, stable randomization follows predeclared eligibility, and intention-to-treat keeps assignment distinct from exposure and outcome. -->

Randomization supports that causal comparison only when the unit, eligibility, assignment, exposure, and analysis preserve the design.

Suppose you randomly assign **requests**:

```text
Request 1 from Alice → A
Request 2 from Alice → B
Request 3 from Alice → A
```

This might be fine for an independent image-classification API. It can be terrible for a recommendation system. Alice's experience becomes inconsistent:

```text
homepage → A
product page → B
homepage → B
```

The versions can influence one another through the user's behavior. Instead, assign by user:

```text
hash(user_id) → group

Alice → B
Bob   → A
Carol → B
```

Now Alice consistently receives B. Possible randomization units include:

```text
request
session
conversation
user
device
account
household
organization
school
store
city
country
```

Ask:

At what level can one treatment exposure influence later outcomes

For a chatbot:

```text
conversation
```

may be better than individual turns. For enterprise SaaS:

```text
organization
```

may be better than users because employees interact. For a marketplace:

```text
geographic market
```

may sometimes be necessary because buyers and sellers affect each other. A badly chosen unit can invalidate the causal interpretation. A common mechanism is deterministic hashing.

Conceptually:

```text
bucket = hash(experiment_id, user_id) mod 10000
```

Then:

```text
0–4999    → control
5000–9999 → treatment
```

Alice always hashes into the same group for that experiment. This gives:

```text
random-like distribution
+
stable assignment
```

Stable assignment is important because you generally do not want:

```text
Monday: Alice → A
Tuesday: Alice → B
Wednesday: Alice → A
```

unless the experiment was explicitly designed as a crossover study. Suppose your new model affects only search. Your population might be:

```text
logged-in users
AND
country in supported countries
AND
search feature enabled
AND
not internal employee account
```

First determine:

```text
eligible
```

Then randomize.

Conceptually:

```text
All traffic
    ↓
Eligibility filter
    ↓
Eligible units
    ↓
Random assignment
   / \
  A   B
```

Otherwise differences in eligibility logic can contaminate the experiment. This distinction is essential for reliable experiments. Suppose:

```text
User 42
```

gets assigned to B at 10:00. But she does not open the product until 14:00. Then purchases at 16:00. You have three separate facts:

```text
10:00 assignment:
User 42 → B

14:00 exposure:
User 42 actually received B recommendations

16:00 outcome:
User 42 purchased
```

Do not collapse all three into one event. Suppose 10,000 users are assigned:

```text
5,000 → A
5,000 → B
```

But only:

```text
1,000 A users open the feature
1,300 B users open the feature
```

Perhaps B itself influences whether users return to the feature. If you analyze only people who were exposed:

```text
1,000 A vs 1,300 B
```

you have selected people based on behavior that may be affected by treatment. That can destroy randomization. This is one reason the main analysis often uses the population that was **assigned**, not merely the population eventually observed using the feature. Suppose assignment is:

```text
A group → intended to receive A
B group → intended to receive B
```

Some members may not actually experience the model. The **intention-to-treat**, or ITT, analysis compares:

```text
everyone assigned B
vs
everyone assigned A
```

regardless of actual treatment exposure. Why? Because assignment was randomized. Exposure often was not. Therefore ITT preserves the causal guarantee created by randomization. Imagine:

```text
B makes recommendations much more attractive
```

Therefore treatment users visit the recommendation screen more frequently. If you compare:

```text
people who saw A
vs
people who saw B
```

you have selected different populations. The B population contains people whose exposure may itself have been caused by B. That introduces selection bias. The original assignment is cleaner:

```text
assigned A
vs
assigned B
```

ITT does not mean exposure can be ignored. You should separately measure:

```text
assignment rate
actual exposure rate
treatment delivery failures
crossovers
```

Suppose:

```text
Assigned B: 50,000 users
Actually served B: 31,000
```

That may reveal a deployment bug. Or perhaps the feature is naturally encountered by only 62% of users. Either way, exposure helps you understand the mechanism. Just do not casually replace randomized assignment with post-treatment selection.

![A comparison of a rollout and a controlled experiment showing that weighted delivery traffic answers operational safety questions while random stable assignment and mature outcomes answer causal product questions.](/content-assets/articles/article-mlops-deployment-and-release-management-ab-testing-for-ml-products/rollout-versus-controlled-experiment.png)

*Rollout controls limit operational risk; experiment controls create comparable product populations and measure whether the candidate caused a meaningful outcome.*

## How Should Primary, Guardrail, Proxy, Delayed, and Windowed Metrics Be Defined?
<!-- section-summary: One primary product metric sits beside safety guardrails and mechanism proxies, with exact definitions and observation windows that respect delayed and late-arriving outcomes. -->

A valid design still needs metrics tied to product value and safety and time windows long enough for outcomes to mature.

A weak experiment asks:

What metrics should we look at afterward

A stronger experiment decides beforehand:

What result would make us launch or reject B

Suppose B is a ranking model. Possible metrics:

```text
click-through rate
items purchased
revenue per user
latency
return rate
complaint rate
session length
```

If you inspect 50 metrics and choose whichever looks nicest after the experiment, you are giving randomness many opportunities to produce a "win." So metric roles should be defined before launch. You can divide metrics into several categories.

### Primary decision metric

The main success criterion.

For example:

```text
purchase conversion
```

### Guardrails

Must remain within acceptable limits:

```text
p95 latency
refund rate
safety violation rate
customer complaints
```

### Secondary metrics

Useful evidence:

```text
click-through rate
items per session
average order value
```

### Diagnostic metrics

Help explain what happened:

```text
model score distribution
number of recommendations rendered
feature-load success rate
```

This prevents every metric from being treated as equally decisive. Suppose Model B improves:

```text
CTR:
10% → 12%
```

but reduces:

```text
purchases:
3.1% → 2.7%
```

If the business ultimately cares about purchases, declaring victory based on CTR would be a mistake. CTR is an intermediate outcome:

```text
recommendation
      ↓
click
      ↓
evaluation
      ↓
purchase
```

A model can optimize an early stage while harming the final objective. This is particularly common in ML because models are often trained on proxy objectives. Suppose customer retention takes 90 days to observe. Waiting 90 days for every model iteration may be impractical. You might use:

```text
7-day activity
```

as an early proxy. But it should be treated as:

Evidence correlated with what we ultimately care about.

not:

The final objective by definition.

Good experimentation often uses:

```text
fast proxy metric
+
slower true outcome
```

and continually validates that the proxy predicts the real objective. Consider:

```text
conversion rate
```

What exactly does that mean? Possibilities include:

```text
purchases / sessions

users purchasing / eligible users

purchases / recommendation impressions

purchases within 24 hours / assigned users

purchases within 7 days / exposed users
```

These can produce very different answers. An experiment specification should define:

```text
numerator
denominator
population
time window
attribution rules
aggregation unit
```

For example:

```text
Primary metric:
Percentage of randomly assigned users
who complete at least one purchase
within 7 days after assignment.
```

Now the metric is reproducible. Suppose the primary outcome is:

```text
purchase within 7 days
```

User A entered the experiment eight days ago. You know their full outcome window. User B entered yesterday. You don't. If you compare them immediately, recent participants have had less opportunity to convert. This is called an **immature outcome** problem. If your outcome is:

```text
7-day retention
```

then a user assigned today cannot contribute a finalized retention outcome tomorrow. You generally need:

```text
assignment date
        +
7 days
        ↓
outcome mature
```

So an experiment may stop accepting new participants on Friday but continue waiting for outcomes:

```text
Enrollment:
Mon ───────── Fri

Outcome maturation:
               ───────── Fri+7
```

This difference between **experiment enrollment** and **analysis readiness** is important. Even if the outcome happened, your data pipeline may not know yet. Example:

```text
10:00 purchase occurs
10:15 event sent
11:00 warehouse ingest
14:00 attribution pipeline completes
```

If you read metrics at 10:30:

```text
purchase appears missing
```

A reliable experiment system understands data latency. Possible rules include:

```text
only analyze data at least 24h old
```

or:

```text
wait until outcome completeness > 99.9%
```

Suppose Model B changes user behavior for weeks. A one-hour experiment may detect immediate clicks but miss:

```text
novelty effects
user adaptation
repeat usage
long-term dissatisfaction
retention effects
```

Your experimental duration needs to be long enough to capture the phenomena you care about. Experiment duration is therefore not merely about obtaining enough traffic. It is also about observing the relevant temporal dynamics. Traffic differs with time.

For example:

```text
Monday ≠ Saturday

morning ≠ evening

holiday ≠ normal day
```

Randomization protects A and B from many contemporaneous differences because both groups run at the same time. But running an experiment for too short a period can still give you a population unrepresentative of normal product usage. For many products, tests should span full business cycles such as:

```text
at least one complete week
```

depending on the metric and traffic pattern.

## How Do Sample Size, Power, Intervals, Integrity Checks, and the Analysis Unit Support Valid Results?
<!-- section-summary: Minimum detectable effect, power, errors, confidence intervals, analysis unit, sample-ratio checks, delivery checks, balance, and A/A tests establish precision and integrity. -->

Those outcomes have noise, so sample planning, interval estimates, and integrity checks must precede interpretation.

Suppose the true conversion rates are:

```text
A = 10.0%
B = 10.1%
```

That difference is tiny. To distinguish it reliably from random fluctuation, you may need a very large experiment. If instead:

```text
A = 10%
B = 20%
```

the signal is enormous and much less data is needed. Fundamentally:

```text
required sample size increases
when the effect you want to detect gets smaller
```

and:

```text
required sample size increases
when outcome variability gets larger
```

Before launching, ask:

What is the smallest improvement that would actually matter

This is often called the **minimum detectable effect**, or MDE. Suppose increasing conversion from:

```text
10.00% → 10.01%
```

has negligible business value. Perhaps you only care about an improvement of:

```text
at least +0.5 percentage points
```

Designing the experiment around a meaningful MDE helps prevent absurd sample-size requirements for economically irrelevant differences. Suppose B genuinely improves the product by the MDE. A powerful experiment should have a high probability of detecting that effect. Typical planning parameters include:

```text
baseline metric
minimum detectable effect
significance level α
desired statistical power
metric variance
allocation ratio
```

Common conventions are:

```text
α = 0.05
power = 80% or 90%
```

but these are conventions, not natural laws. The appropriate values depend on the consequences of wrong decisions. Imagine the truth can be:

```text
B has no useful improvement

or

B really improves the product
```

The experiment can conclude:

```text
launch B

or

do not launch B
```

This creates two important error types.

### False positive

Conclude B is better when it isn't.

```text
false win
```

### False negative

Fail to detect a genuinely useful B.

```text
missed win
```

Experiment design chooses how much risk to accept from each. Suppose we test 20 users:

```text
A: 10 users
B: 10 users
```

One purchase changes conversion by:

```text
10 percentage points
```

The metric is extremely noisy. Now test:

```text
1,000,000 users
```

One additional purchase barely moves the estimate. As sample size grows, random imbalance tends to shrink relative to the population. Roughly:

```text
uncertainty ∝ 1 / √n
```

So cutting uncertainty in half generally requires about:

```text
4× the sample
```

not 2×. That square-root relationship is an important intuition. Suppose the estimated effect is:

```text
+0.8%
```

An interval might be:

```text
95% CI: [+0.2%, +1.4%]
```

That says the data are reasonably consistent with a meaningful positive effect and less consistent with zero or negative effects, under the model used. Compare that with:

```text
+0.8%
95% CI: [-2.5%, +4.1%]
```

Same point estimate. Very different evidence. The second experiment is too uncertain to say much. So focus on:

```text
estimated effect
+
uncertainty
```

rather than only a p-value. Suppose:

```text
+0.01% conversion
```

with 500 million users becomes statistically significant. That does not automatically mean it matters. Conversely:

```text
+5% revenue
```

from a small pilot may fail conventional significance thresholds because the sample is too small. The product decision should consider:

```text
effect size
uncertainty
business value
risk
cost
```

Statistical significance is only one piece. This is worth repeating because it is one of the most important principles. If randomization occurred at:

```text
user level
```

analysis should usually respect user-level assignment. Do not accidentally analyze:

```text
requests
```

as though they were independent observations. One user may generate:

```text
1 request
```

while another generates:

```text
500 requests
```

Treating requests as independent can make the experiment appear to have much more information than it actually does. Suppose:

```text
10,000 users
```

generate:

```text
2,000,000 requests
```

You do not necessarily have two million independent experimental units. Treatment was randomized over:

```text
10,000 users
```

Requests from the same user are correlated. Ignoring that correlation can make confidence intervals too narrow. Possible approaches include:

```text
aggregate outcomes per user

or

use statistical methods that account for clustering
```

The randomization structure and statistical analysis should agree. Suppose you intend:

```text
50% control
50% treatment
```

but observe:

```text
Control:   512,381 users
Treatment: 463,099 users
```

That imbalance is far larger than random chance would normally produce at this scale. Something may be wrong. Possible causes:

```text
assignment bug
logging failure
treatment crashes before logging
eligibility mismatch
bot filtering difference
ID hashing problem
```

Do not immediately interpret business metrics. First investigate the experiment. If assignment is designed as:

```text
50/50
```

then approximately half the eligible units should enter each group. Small differences happen randomly. Large unexplained differences are called **sample ratio mismatch**, or SRM.

Conceptually:

```text
expected:
50% / 50%

observed:
54% / 46%
```

could indicate that your experiment infrastructure itself is broken. An SRM check should happen before deciding that B won or lost. Suppose assignment looks perfect:

```text
50,000 A
50,000 B
```

but telemetry shows:

```text
A users receiving A: 99.9%

B users receiving B: 71%
```

Then your treatment implementation has a major problem. Perhaps:

```text
B times out and falls back to A
```

or:

```text
some server versions don't support B
```

Assignment and actual delivery need separate instrumentation. Randomization should make groups similar on variables measured before treatment.

For example:

```text
historical purchase rate
device type
region
account age
past activity
```

Large unexplained differences may indicate broken randomization. But an important nuance:

Perfect balance is not required.

Random assignment naturally produces some differences by chance. The purpose is mainly diagnostic, especially for extreme discrepancies. Suppose one group happens to contain slightly more mobile users. That does not automatically invalidate randomization. Randomization guarantees similarity **in expectation**, not exact equality for every variable in every realized experiment. Overreacting to ordinary imbalance can create unnecessary analysis flexibility. Predefined adjustment methods are better than improvising after seeing the results. Before testing A versus B, sometimes run:

```text
A versus A
```

Both groups receive the same model. Expected causal effect:

```text
0
```

If you consistently detect large differences, something may be wrong with:

```text
assignment
logging
metric computation
statistics
```

A/A tests are especially useful when building a new experimentation platform. They are essentially testing the tester.

## How Do Peeking, Multiple Tests, Interference, Feedback, Novelty, and Learning Threaten the Experiment?
<!-- section-summary: Repeated peeking and many metrics create false wins; interference, feedback loops, cluster or switchback designs, novelty, and learning alter simple independence assumptions. -->

Repeated looks, multiple choices, interference, feedback, novelty, and carryover can invalidate ordinary formulas even when traffic splitting works.

Imagine a two-week experiment. Every hour someone checks:

```text
Is p < 0.05 yet
```

At hour 20:

```text
p = 0.12
```

Continue. Hour 50:

```text
p = 0.08
```

Continue. Hour 70:

```text
p = 0.048
```

Stop immediately and declare victory. This procedure is not equivalent to a single test at `α = 0.05`. You repeatedly gave random noise opportunities to cross the threshold. That inflates the false-positive rate. Imagine a perfectly fair coin. If you flip it:

```text
10 times
```

you might briefly see:

```text
8 heads
2 tails
```

If you stop precisely when the coin looks unusually favorable, you create a biased stopping rule. The same principle applies to experiments. Random metrics fluctuate. If you continuously inspect them and stop whenever they look good, some tests will "win" through chance alone. This does not mean you must blindly ignore experiments until one predetermined date. You can use methods designed for sequential analysis, such as:

```text
group-sequential tests
alpha spending
sequential probability methods
always-valid inference
Bayesian decision procedures
```

The important principle is:

The statistical analysis must account for the stopping policy.

Do not use a fixed-horizon test while behaving like a sequential experiment. Suppose a treatment produces:

```text
10× crash rate
```

You should not say:

We promised not to look until Friday.

Safety guardrails can and should be monitored continuously. You can separate:

```text
Safety stopping rules
```

from:

```text
Product success decision rules
```

For example:

```text
Immediate rollback if:
critical error rate > 2%

Product decision after:
minimum sample and planned analysis window
```

That preserves both user safety and statistical discipline. Suppose B has absolutely no effect. You test 100 unrelated metrics. Purely by chance, some will appear unusually positive. If you then report:

```text
Metric 73 improved significantly!
```

you may simply be selecting noise. This is one reason to choose the primary metric before launch. When many hypotheses genuinely matter, use appropriate multiple-testing methods or hierarchical decision rules. Suppose you test:

```text
A = baseline
B = model 1
C = model 2
D = model 3
E = model 4
F = model 5
```

Then pick whichever looks best. More alternatives create more opportunities for random variation to produce an apparent winner. Your statistical plan should account for how many comparisons are being made. Standard A/B reasoning assumes roughly:

Alice's outcome depends on Alice's treatment, not on Bob's treatment.

This is sometimes called a no-interference assumption. But many ML products violate it. Consider a marketplace. Model B is given to some sellers. It changes prices. Those prices affect buyers in both groups. Now:

```text
Seller treatment
      ↓
market conditions
      ↓
other users' outcomes
```

Control and treatment are no longer isolated. Suppose recommendations determine which videos gain attention. Treatment users receive B. B promotes video X more heavily. Video X becomes more popular. Popularity becomes a feature used by both A and B. Now treatment behavior changes the environment seen by control users:

```text
B users
   ↓
change popularity
   ↓
shared features
   ↓
A users affected
```

The treatment has leaked into the control condition. ML systems often consume data generated by previous model decisions.

For example:

```text
model recommends content
       ↓
users click
       ↓
clicks become training data
       ↓
future model learns from clicks
```

Now experiment effects can persist beyond immediate treatment. A model may alter:

```text
the population
the labels
the training set
the inventory
the marketplace
```

that future models observe. A/B testing in ML therefore sometimes requires thinking beyond simple one-shot causal effects. If users strongly interact within groups, randomize whole groups. Instead of:

```text
individual users
```

randomize:

```text
schools
companies
geographic markets
social communities
```

For example:

```text
London → A
Manchester → B
```

if users mostly interact within cities. The tradeoff is that you now have fewer independent units. Millions of users inside 20 cities do not give you millions of independent clusters. Statistical power can fall dramatically. Suppose you operate a ride-sharing marketplace. You cannot easily show different dispatch algorithms simultaneously to drivers sharing the same city. Instead you might alternate over time:

```text
09:00–10:00 → A
10:00–11:00 → B
11:00–12:00 → A
12:00–13:00 → B
```

This is a **switchback experiment**. The randomization unit becomes something like:

```text
market × time block
```

rather than individual users. This can reduce cross-treatment interference, though time effects must be handled carefully. Consider search ranking. Model B surfaces different documents. Therefore users click different documents. Then you collect different relevance labels. Now:

```text
Treatment B
    ↓
changes observations
    ↓
changes future training data
```

This is sometimes called a **performative** or feedback effect. The model is not simply predicting an independent world. It partly changes the world it later learns from. This makes long-term evaluation more complex. Suppose B radically changes the interface or recommendations. Users may initially engage more because:

```text
it is new
```

Then after two weeks:

```text
engagement returns to baseline
```

An experiment stopped after one day may declare a false long-term win. The reverse can also happen:

```text
users initially dislike unfamiliar behavior
but adapt over time
```

This is another reason experiment duration should reflect product dynamics, not just required sample size. Suppose Model B teaches users a new workflow. Even after switching them back to A, their behavior remains different. Now a crossover design:

```text
A → B → A
```

does not necessarily restore the original baseline. The first treatment changed the user. This is called a carryover effect. For products with strong learning or habit formation, parallel persistent assignment is often safer than frequently switching users between treatments.

![A search-ranking experiment connecting stable user assignment to control or treatment, actual rendered exposure, mature outcomes, governed joins, integrity gates, and decision evidence.](/content-assets/articles/article-mlops-deployment-and-release-management-ab-testing-for-ml-products/assignment-exposure-outcome.png)

*Assignment records preserve the randomized population, exposure records prove delivery, and outcome records become decision evidence only after join and integrity checks pass.*

## How Do Durable Assignment, Exposure, Outcome Data, Precommitment, and Staged Release Operate the Test?
<!-- section-summary: Assignment is a versioned production service with durable events; precommitted hypotheses, metrics, guardrails, allocation, and staged release keep safety separate from efficacy. -->

The experiment platform therefore needs durable versioned assignment and event records plus a decision committed before results are visible.

A real experiment needs reliable infrastructure.

Conceptually:

```text
Request
   ↓
Eligibility
   ↓
Experiment assignment
   ↓
Treatment configuration
   ↓
Model serving
   ↓
Exposure logging
   ↓
User outcome
   ↓
Outcome pipeline
   ↓
Experiment analysis
```

Every arrow can introduce bias if implemented incorrectly. For each unit, store something like:

```text
experiment_id
unit_id
variant
assignment_timestamp
assignment_version
eligibility context
```

Then later you can reconstruct:

```text
Why was this user in treatment
When did they enter
Which experiment configuration applied
```

Do not rely on reconstructing historical assignment from mutable current configuration. Suppose experiment B changes midway from:

```text
Model B version 42
```

to:

```text
Model B version 43
```

Now "B" actually means two things. Your interpretation becomes:

```text
some users received B42
some received B43
```

If intentional, log it explicitly. Otherwise freeze treatment artifacts while the experiment runs. A good experiment usually wants:

```text
variant B → one clearly defined treatment
```

A weak design logs:

```text
user assigned to B
```

and assumes B was served. But perhaps:

```text
routing failed
B timed out
fallback returned A
cache served old result
feature wasn't rendered
```

A stronger exposure log records what actually happened:

```text
experiment = ranking_test_27
assigned_variant = B
served_model = ranker_v43
request_id = ...
timestamp = ...
```

For user-facing treatments, you may also distinguish:

```text
model executed
```

from:

```text
result actually rendered to user
```

Suppose a purchase event is duplicated by the pipeline.

Then:

```text
one purchase
```

becomes:

```text
two purchases
```

Experiment metrics become wrong. Outcome pipelines therefore need properties such as:

```text
deduplication
stable event IDs
consistent timestamps
clear attribution rules
late-event handling
```

Experimentation is only as trustworthy as the measurement system beneath it. Suppose purchases are logged using:

```text
account_id
```

while experiment assignment uses:

```text
device_id
```

Some users use multiple devices. Now outcome attribution may fail differently across populations. Or perhaps treatment changes login behavior, which changes whether events can be joined. Measurement can become treatment-dependent. This is particularly dangerous because the experiment can look statistically rigorous while the underlying data linkage is biased. Suppose outcome data is missing for:

```text
2% of A
10% of B
```

If you simply remove missing cases, you may select very different populations. The missingness itself could be caused by treatment. For instance:

```text
B causes app crashes
        ↓
events never upload
```

Dropping those users would hide one of the treatment's main harms. A good experiment specification might state:

```text
Population:
Eligible logged-in users in supported markets.

Unit:
User ID.

Control:
Recommendation model A v17.

Treatment:
Recommendation model B v23.

Allocation:
50/50 stable user assignment.

Primary metric:
7-day purchase conversion.

Primary decision threshold:
Launch if estimated lift is positive
and confidence criterion is met.

Guardrails:
p95 latency must increase < 50 ms.
Refund rate must not increase > 0.2 pp.

Minimum sample:
400,000 eligible users.

Minimum duration:
14 days.

Outcome maturation:
7 additional days.

Stopping:
Immediate rollback for critical safety regression.
No ordinary efficacy stopping before planned analysis.
```

This dramatically reduces the freedom to reinterpret the experiment afterward. Imagine the experiment finishes with:

```text
purchase rate:         no improvement
click rate:            +0.4%
session duration:      -2%
wishlist additions:    +6%
revenue:               no improvement
```

If the team chooses afterward:

Wishlist additions were really our true objective.

the experiment becomes difficult to trust. Pre-specifying the decision rule distinguishes:

```text
confirmatory evidence
```

from:

```text
interesting exploratory observations
```

Both are useful, but they should not be confused. Suppose Model B produces:

```text
conversion:
+3%

latency:
+900 ms
```

If your predeclared guardrail says:

```text
p95 latency increase <= 200 ms
```

the experiment may be:

```text
primary metric: PASS
guardrail: FAIL
decision: DO NOT LAUNCH
```

This is not contradictory. Products optimize multiple objectives under constraints. A release decision is often:

```text
maximize value
subject to safety/reliability constraints
```

You may not require every metric to improve.

For example:

```text
Primary:
Revenue should improve.

Guardrail:
Retention must not decline by more than 0.2 percentage points.
```

The guardrail asks:

Is B sufficiently close to A on this dimension that the difference is acceptable

This is a non-inferiority style question. That often matches product decision-making better than demanding every metric have `p < 0.05`. Nothing requires only A and B. You might test:

```text
A = existing model
B = smaller faster model
C = larger higher-quality model
D = hybrid routing strategy
```

Randomize:

```text
25% A
25% B
25% C
25% D
```

But every additional arm spreads traffic thinner and creates more statistical comparisons. So multi-arm tests should exist for a reason, not merely because many variants are available. You don't always need:

```text
50/50
```

Suppose B carries some risk. You might use:

```text
90% A
10% B
```

You can still estimate causal effects if assignment is randomized. But statistical efficiency usually decreases because the smaller treatment group provides less information. There is a tradeoff:

```text
less exposure risk
vs
more time/sample needed
```

A sophisticated launch might be:

```text
Stage 0
Offline evaluation

Stage 1
Shadow:
A controls decisions
B evaluated silently

Stage 2
Canary:
99% A
1% B
Check severe regressions

Stage 3
Experiment:
50% A
50% B
Stable randomized assignment

Stage 4
Decision

Stage 5
If B wins:
10% → 25% → 50% → 100%
or directly complete rollout depending on risk
```

Notice that the 50/50 experiment is not necessarily the final rollout itself. It exists to estimate causal product impact. There are two questions:

```text
1. Is B dangerous or operationally broken

2. Is B actually better
```

Safety might be evaluated through:

```text
canary
shadow testing
guardrails
continuous monitoring
```

Efficacy might be evaluated through:

```text
randomized comparison
primary outcome
confidence interval
```

A treatment can be:

```text
safe but not better
```

or:

```text
better on average but operationally unsafe
```

Both dimensions matter.

## How Do Worked Results, Heterogeneity, Variance Reduction, Constraints, and Inappropriate Cases Shape Decisions?
<!-- section-summary: Worked outcomes require practical interpretation; no significance is not equality, heterogeneous effects and Simpson's paradox need care, and some harmful or tiny-population changes should not be randomized. -->

Worked cases show how uncertainty, practical size, segments, and constraints lead to launch, continue, stop, or no-experiment decisions.

Suppose you operate an ecommerce recommendation model. Current model:

```text
A
```

Candidate:

```text
B
```

Your business hypothesis is:

B improves the relevance of recommendations, increasing completed purchases without materially harming latency or returns.

Design:

```text
Unit:
user

Population:
logged-in users eligible for recommendations

Assignment:
50% A
50% B
stable by user ID
```

Primary outcome:

```text
purchase within 7 days of assignment
```

Guardrails:

```text
p95 recommendation latency
refund rate
customer complaint rate
```

You recruit:

```text
A: 500,000 users
B: 500,000 users
```

After all outcomes mature:

```text
Purchase conversion:

A = 7.80%
B = 8.15%
```

Absolute lift:

```text
8.15 - 7.80
= +0.35 percentage points
```

Relative lift:

```text
0.35 / 7.80
≈ +4.5%
```

Suppose the uncertainty interval is:

```text
+0.21 pp to +0.49 pp
```

and guardrails show:

```text
Latency:
+12 ms
allowed <= +100 ms

Refund rate:
unchanged

Complaint rate:
unchanged
```

This is strong evidence for launching B according to the pre-specified decision rule. Suppose instead:

```text
Purchase conversion:

A = 7.80%
B = 7.95%
```

Estimate:

```text
+0.15 percentage points
```

but interval:

```text
-0.10 pp to +0.40 pp
```

This does **not** mean:

```text
A and B are identical
```

It means:

```text
the experiment did not estimate the effect precisely enough
to rule out both modest harm and modest benefit
```

Possible conclusion:

```text
inconclusive
```

This is an important third state. Experiments are not always:

```text
WIN
or
LOSE
```

They can produce:

```text
insufficient evidence
```

Suppose your sample is only:

```text
100 users
```

and you find no statistical difference. That could simply mean:

```text
experiment too noisy
```

To claim two systems are meaningfully similar, you need a design capable of ruling out effects large enough to matter. This is one reason MDE and power planning come before launch. Suppose overall:

```text
B improves conversion by +1%
```

But:

```text
New users:      +4%
Existing users: -2%
```

The average hides meaningful variation. Segment analysis can reveal such effects. Useful predefined segments may include:

```text
country
platform
new vs returning
subscription tier
traffic source
```

However, slicing hundreds of segments after the fact recreates the multiple-testing problem. Pre-specify especially important heterogeneity questions. Imagine B appears better in every region individually but worse overall because traffic composition differs. Or vice versa.

For example:

```text
             A       B
UK          10%     11%
US          20%     21%
```

Yet if B gets far more UK traffic and A more US traffic, aggregate numbers could reverse. Well-functioning randomization reduces such composition differences. When imbalance exists due to design, proper stratification or weighting may be required. Suppose country strongly affects conversion. Instead of randomizing globally:

```text
all users → randomize
```

you can randomize separately within important strata:

```text
UK users:
50% A / 50% B

US users:
50% A / 50% B

Germany:
50% A / 50% B
```

This helps guarantee similar country composition and can improve statistical precision. The principle is:

Randomize within important pre-treatment groups when those groups strongly influence outcomes.

Suppose historical purchase behavior predicts future purchasing strongly. Instead of comparing only raw outcomes, predefined statistical adjustment can account for historical behavior.

Conceptually:

```text
Observed treatment difference
-
noise predictable from pre-treatment characteristics
```

Techniques such as:

```text
covariate adjustment
regression adjustment
CUPED-style methods
```

can reduce variance. That means detecting the same effect with fewer users. Crucially, adjustment variables should generally be measured **before treatment** so treatment cannot have caused them. Suppose:

```text
B → more clicks → more purchases
```

If you "control for clicks" when estimating B's total effect on purchases, you may remove one of the pathways through which B works. Clicks are a post-treatment variable:

```text
Treatment → Clicks → Purchase
```

Conditioning on them changes the causal question. Pre-treatment covariates and post-treatment variables play very different roles. Suppose B has better:

```text
NDCG
precision
calibration
```

in live traffic. Those are valuable diagnostics. But if the experiment's purpose is product impact, they usually describe **how** the treatment works rather than the ultimate causal objective. Think:

```text
Model B
   ↓
better ranking metric
   ↓
different items shown
   ↓
different user behavior
   ↓
business outcome
```

Offline and online model metrics help explain the mechanism. The randomized product outcome tells you whether the mechanism created value.

For example:

```text
Offline:
B has +8% ranking quality
```

But online:

```text
B recommends more computationally expensive candidates
       ↓
latency +400 ms
       ↓
users abandon page
       ↓
purchases -2%
```

There is no contradiction. The product contains a larger causal system than the model benchmark. Maybe B produces slightly lower click prediction accuracy but generates more diverse recommendations. Users discover more products. Long-term purchase rate rises. Again:

```text
model metric
≠
product objective
```

This is precisely why controlled online experiments are so valuable. Randomization is powerful, but it is not universally appropriate. Suppose treatment could plausibly cause:

```text
serious physical harm
illegal discrimination
major financial loss
irreversible medical decisions
severe safety violations
```

You cannot justify knowingly exposing users to unacceptable risks merely because randomization would produce a scientifically clean estimate. Safety and ethical constraints come first.

For example:

```text
schema compatibility
data privacy
security
model signature
basic correctness
policy compliance
catastrophic safety behavior
```

should usually be tested before exposing real users. An A/B test is not a substitute for ordinary validation. Do not use production users as a debugging system for preventable failures. Suppose a product has:

```text
40 eligible customers
```

and the minimum important effect is small. A conventional randomized test may take an unreasonable amount of time or never achieve useful precision. Alternatives might include:

```text
careful observational analysis
paired designs
switchback designs
domain-specific evaluations
qualitative studies
simulation
expert review
```

The appropriate method depends on the causal question. Suppose you're changing:

```text
auction mechanism
market-clearing algorithm
fraud network detector
shared recommendation inventory
```

Treatment effects may spill across everyone. Individual randomization may be invalid. You may need:

```text
cluster experiments
geographic experiments
switchbacks
system-level simulations
```

or other causal designs. Some users may have:

```text
contractually fixed behavior
regulated treatment requirements
consent restrictions
data-locality requirements
```

Those constraints can determine:

```text
who may enter the experiment
what may be randomized
which outcomes may be collected
```

Experiment eligibility must respect those boundaries. Think about the full release lifecycle:

```text
Train
  ↓
Offline evaluate
  ↓
Validate API + safety
  ↓
Deploy candidate
  ↓
Shadow / canary
  ↓
Randomized A/B experiment
  ↓
Causal product evidence
  ↓
Launch decision
  ↓
Progressive rollout
  ↓
Long-term monitoring
```

Different stages answer different questions.

For example:

```text
Offline evaluation:
Does the model look promising

Shadow:
Does it run correctly on real traffic

Canary:
Is limited real exposure safe

A/B test:
Does B cause a better product outcome

Full rollout:
Can B operate successfully at complete scale

Post-launch monitoring:
Does the benefit persist
```

A reliable A/B platform needs at least:

```text
eligibility service
        ↓
stable randomization
        ↓
treatment configuration
        ↓
model routing
        ↓
assignment logging
        ↓
exposure logging
        ↓
outcome collection
        ↓
metric computation
        ↓
integrity checks
        ↓
statistical analysis
        ↓
decision
```

A bug anywhere upstream can invalidate a perfectly sophisticated statistical calculation downstream. This is why experimentation belongs partly to statistics and partly to production engineering.

## What Checklist and Mental Model Define a Trustworthy ML A/B Test?
<!-- section-summary: A trustworthy experiment estimates a predeclared causal effect under a verified assignment and data system, then makes a product decision with uncertainty and guardrails. -->

The checklist treats the experiment itself as a production causal-measurement system.

Before an ML A/B experiment, you should be able to answer:

1. **What causal question are we trying to answer?**

```text
Does serving Model B instead of Model A improve 7-day purchase conversion
```

2. **Who is eligible?**
3. **What is randomly assigned?**

User, request, account, market, session

4. **Is assignment stable?**
5. **What exactly are A and B?**
6. **What event counts as exposure?**
7. **What is the primary outcome?**
8. **What are the guardrails?**
9. **What observation window defines the outcome?**
10. **How many units are needed?**
11. **How long must the experiment cover?**
12. **When are outcomes mature?**
13. **What integrity checks happen first?**
14. **What stopping rule is used?**
15. **What effect is large enough to justify launch?**
16. **What conditions force rollback regardless of the primary metric?**
17. **Could users interfere with one another?**
18. **Could B alter the environment or future training data?**
19. **What exact analysis will be performed?**
20. **What decision follows each possible result?**

A/B testing can be understood as building two parallel worlds that differ in one controlled dimension. You cannot create:

```text
Alice in universe A
and
the exact same Alice in universe B
```

So instead you create:

```text
many randomly selected Alice-like users → A
many randomly selected Alice-like users → B
```

Randomization tries to make all the uncontrolled differences cancel out. What remains is the controlled difference:

```text
Model A
vs
Model B
```

Then you compare outcomes. That is the core causal logic. ML A/B testing begins with one fundamental limitation:

**For a given user, we can observe what happened under Model A or what happened under Model B, but we cannot observe both alternate realities simultaneously.**

Randomization solves this at the population level:

```text
Eligible population
       ↓
Random assignment
   ┌───────────┐
   ↓           ↓
Model A     Model B
   ↓           ↓
Outcomes    Outcomes
   └─────┬─────┘
         ↓
Compare
```

Because the groups were created randomly, their outcome difference can be interpreted causally much more credibly than a simple before/after or observational comparison. But that causal guarantee survives only if the rest of the experiment is designed correctly:

```text
choose the right randomization unit
        ↓
keep assignment stable
        ↓
record assignment separately from exposure
        ↓
measure well-defined outcomes
        ↓
preserve the randomized population in analysis
        ↓
wait for delayed outcomes to mature
        ↓
plan sample size and duration
        ↓
check experiment integrity
        ↓
handle repeated testing correctly
        ↓
account for interference and feedback
        ↓
apply predeclared decision rules
```

And the most important deployment distinction is:

```text
Canary / rollout:
"Is it safe to expose more production?"

A/B experiment:
"Did the new model actually cause a better product outcome?"
```

A model can therefore pass:

```text
offline evaluation
+
integration tests
+
canary deployment
```

and still lose an A/B experiment. That is not a failure of experimentation. It is exactly what experimentation is designed to discover. The essence of **ML A/B testing in deployment and release management** is therefore:

> **Do not infer product value merely because a model looks better offline or survives production traffic. Randomly create comparable groups, measure what actually changes downstream, and make the release decision from the causal effect on outcomes that matter.**

![The ML A/B test decision path from a prewritten plan through stable comparison, evidence validation, effect estimation, and distinct win loss inconclusive or invalid actions.](/content-assets/articles/article-mlops-deployment-and-release-management-ab-testing-for-ml-products/ml-ab-test-summary.png)

*A trustworthy decision follows the plan written before results: validate the evidence, estimate practical value and uncertainty, then take the action assigned to that outcome.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[How Does Random Assignment Estimate the Causal Effect of an ML Product Change?]{kind="recap"}
An A/B test uses randomized potential alternatives to estimate a causal product effect that cannot be observed for the same unit in both realities.
:::

:::expand[How Do Randomization Unit, Eligibility, Assignment, Exposure, and Intention-to-Treat Fit Together?]{kind="recap"}
The assignment unit matches interference, stable randomization follows predeclared eligibility, and intention-to-treat keeps assignment distinct from exposure and outcome.
:::

:::expand[How Should Primary, Guardrail, Proxy, Delayed, and Windowed Metrics Be Defined?]{kind="recap"}
One primary product metric sits beside safety guardrails and mechanism proxies, with exact definitions and observation windows that respect delayed and late-arriving outcomes.
:::

:::expand[How Do Sample Size, Power, Intervals, Integrity Checks, and the Analysis Unit Support Valid Results?]{kind="recap"}
Minimum detectable effect, power, errors, confidence intervals, analysis unit, sample-ratio checks, delivery checks, balance, and A/A tests establish precision and integrity.
:::

:::expand[How Do Peeking, Multiple Tests, Interference, Feedback, Novelty, and Learning Threaten the Experiment?]{kind="recap"}
Repeated peeking and many metrics create false wins; interference, feedback loops, cluster or switchback designs, novelty, and learning alter simple independence assumptions.
:::

:::expand[How Do Durable Assignment, Exposure, Outcome Data, Precommitment, and Staged Release Operate the Test?]{kind="recap"}
Assignment is a versioned production service with durable events; precommitted hypotheses, metrics, guardrails, allocation, and staged release keep safety separate from efficacy.
:::

:::expand[How Do Worked Results, Heterogeneity, Variance Reduction, Constraints, and Inappropriate Cases Shape Decisions?]{kind="recap"}
Worked outcomes require practical interpretation; no significance is not equality, heterogeneous effects and Simpson's paradox need care, and some harmful or tiny-population changes should not be randomized.
:::

:::expand[What Checklist and Mental Model Define a Trustworthy ML A/B Test?]{kind="recap"}
A trustworthy experiment estimates a predeclared causal effect under a verified assignment and data system, then makes a product decision with uncertainty and guardrails.
:::
