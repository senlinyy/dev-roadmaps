---
title: "Candidate vs Production Models"
description: "Compare a candidate with the current production decision through fair evidence, paired effects, operational proof, and a release scope."
overview: "A candidate earns production authority by improving the decision users receive today under a fair comparison supported by a release question, comparison protocol, uncertainty, segment risk, operating evidence, staged rollout, and verification."
tags: ["MLOps", "production", "approval"]
order: 1
id: "article-mlops-model-evaluation-candidate-vs-production-model"
---

## Table of Contents

1. [What Production System Is the Candidate Actually Trying to Replace?](#what-production-system-is-the-candidate-actually-trying-to-replace)
2. [How Do Paired Cases and Segments Reveal Who Benefits and Who Pays?](#how-do-paired-cases-and-segments-reveal-who-benefits-and-who-pays)
3. [What Do Offline Replay, Shadow Traffic, and Randomized Live Traffic Each Prove?](#what-do-offline-replay-shadow-traffic-and-randomized-live-traffic-each-prove)
4. [How Do Product Outcomes, Latency, Cost, Compatibility, and Fallbacks Affect the Comparison?](#how-do-product-outcomes-latency-cost-compatibility-and-fallbacks-affect-the-comparison)
5. [How Do Uncertainty, Release Scope, Canary Exposure, and Rollback Control Risk?](#how-do-uncertainty-release-scope-canary-exposure-and-rollback-control-risk)
6. [How Do Versioning, Routing, Scale, and an Imperfect Production Baseline Change the Decision?](#how-do-versioning-routing-scale-and-an-imperfect-production-baseline-change-the-decision)
7. [What Evidence Should Continue After Launch and Strengthen Future Evaluations?](#what-evidence-should-continue-after-launch-and-strengthen-future-evaluations)
8. [How Do Deltas, Constraints, and the Release Ladder Produce a Final Decision?](#how-do-deltas-constraints-and-the-release-ladder-produce-a-final-decision)
9. [Check Your Answers](#check-your-answers)

A candidate model scores 94% on a benchmark while production scores 91%. The candidate is also slower, costs more per request, and fails on one high-value customer segment that production handles well. Replacing production is therefore a system decision, not a leaderboard decision.

A **candidate-versus-production comparison** measures the change users and operators would actually experience. Both systems need identical cases and definitions, followed by evidence from offline replay, shadow traffic, limited randomized exposure, and post-release monitoring. The important quantity is usually the delta, including which decisions improve and which new errors appear.

Use these questions to follow that comparison from the real baseline to a controlled release decision:

1. **What Production System Is the Candidate Actually Trying to Replace?**
2. **How Do Paired Cases and Segments Reveal Who Benefits and Who Pays?**
3. **What Do Offline Replay, Shadow Traffic, and Randomized Live Traffic Each Prove?**
4. **How Do Product Outcomes, Latency, Cost, Compatibility, and Fallbacks Affect the Comparison?**
5. **How Do Uncertainty, Release Scope, Canary Exposure, and Rollback Control Risk?**
6. **How Do Versioning, Routing, Scale, and an Imperfect Production Baseline Change the Decision?**
7. **What Evidence Should Continue After Launch and Strengthen Future Evaluations?**
8. **How Do Deltas, Constraints, and the Release Ladder Produce a Final Decision?**

## What Production System Is the Candidate Actually Trying to Replace?
<!-- section-summary: A candidate replaces the current production system, including preprocessing, policies, fallbacks, latency, and costs, so success must be defined against that real alternative. -->

A higher standalone benchmark does not identify the system users will experience, so the comparison starts from today's full production alternative.

Suppose you have built a new model. It scores:

$$
94\%
$$

on your benchmark. Your current production model scores:

$$
91\%
$$

Should you replace the production model? Not necessarily. The new model might be:

* slower,
* more expensive,
* worse on an important customer segment,
* more likely to violate a product policy,
* incompatible with existing prompts or tools,
* less reliable under production load,
* better on the benchmark but worse on today's actual traffic.

So the real release question is not:

**“Is the candidate model good?”**

It is:

**“What would happen to the product if the candidate replaced some or all of the system currently serving users?”**

That difference is the foundation of candidate-versus-production evaluation. Let the production system be:

$$
S_P
$$

and the candidate system be:

$$
S_C
$$

Notice that I wrote **system**, not model. A real production application may look like:

```text
user request
    ↓
input validation
    ↓
routing
    ↓
prompt construction
    ↓
retrieval/tools
    ↓
model
    ↓
policy checks
    ↓
postprocessing
    ↓
fallback/retry logic
    ↓
user response
```

Changing the underlying model can interact with every one of these components. Therefore, the useful comparison is usually:

$$
S_P(x)
\quad\text{vs}\quad
S_C(x)
$$

not merely:

$$
M_P(x)
\quad\text{vs}\quad
M_C(x)
$$

where $$M$$ denotes only the raw models. Imagine the candidate model is intrinsically better. But your production prompt was heavily optimized for the old model. Suppose:

| Configuration                   | Quality |
| ------------------------------- | ------: |
| Old model + production prompt   |     92% |
| New model + generic test prompt |     90% |

You could incorrectly conclude that the candidate is worse. Or the opposite could happen. Perhaps the candidate looks excellent in a clean benchmark but behaves poorly with:

* your actual retrieval pipeline,
* real tool responses,
* production system instructions,
* long conversations,
* malformed user inputs.

The object of release evaluation must therefore match the thing you intend to deploy. If deployment would change only the model:

$$
S_C =
\text{same system with candidate model}
$$

If you are also changing prompts, retrieval, thresholds, or routing, then the candidate is really a **candidate system configuration**. That entire configuration must be evaluated. This is a surprisingly important principle. Teams often ask:

“Does the candidate reach 90% accuracy?”

But suppose production already achieves:

$$
96\%
$$

Then 90% is irrelevant. The actual decision is:

$$
\text{keep }S_P
$$

versus:

$$
\text{replace with }S_C
$$

So evaluation should center on:

$$
\Delta = M(S_C)-M(S_P)
$$

where $$M$$ is some metric. For quality:

$$
\Delta_{\text{quality}}
=
Q_C-Q_P
$$

For latency:

$$
\Delta_{\text{latency}}
=
L_C-L_P
$$

For cost:

$$
\Delta_{\text{cost}}
=
C_C-C_P
$$

The release question is fundamentally about these **changes**. Suppose production already has:

* 94% task success,
* 1.8-second latency,
* $0.012 cost/request,
* 0.2% unsafe-response rate.

The candidate has:

* 96% task success,
* 3.7-second latency,
* $0.031 cost/request,
* 0.1% unsafe-response rate.

Which is better? There is no universal answer. The candidate improves some dimensions and regresses others. So before evaluation, define what the release needs to accomplish.

For example:

Increase task success by at least 1 percentage point without increasing severe safety failures, with p95 latency below 3 seconds and cost increase below 50%.

Now the experiment has a purpose. Without a release question, teams can look at dozens of metrics and rationalize whatever answer they prefer afterward. A release policy might say:

$$
Q_C-Q_P \ge +1\%
$$

while requiring:

$$
\text{CriticalFailure}_C
\le
\text{CriticalFailure}_P
$$

and:

$$
L_{C,p95}<3\text{ seconds}
$$

and perhaps:

$$
C_C \le 1.5C_P
$$

These are different kinds of requirements. Some may be **improvement requirements**:

The candidate should actually be better.

Others may be **non-regression requirements**:

The candidate cannot become meaningfully worse.

Others may be absolute constraints:

Critical policy violations must remain below a fixed maximum.

That distinction is useful. Suppose the candidate is dramatically cheaper. You may not need it to improve quality. Instead your hypothesis might be:

The candidate is substantially cheaper while preserving essentially the same quality.

Then you need something like a **non-inferiority** requirement. Instead of:

$$
Q_C>Q_P
$$

you allow a small acceptable degradation:

$$
Q_C-Q_P > -\delta
$$

where $$\delta$$ is your maximum tolerable quality loss.

For example:

$$
\delta=0.5\text{ percentage points}
$$

If the candidate is no more than 0.5 points worse while reducing inference costs by 60%, that might satisfy the release objective. So candidate evaluation depends on **why the candidate exists**.

## How Do Paired Cases and Segments Reveal Who Benefits and Who Pays?
<!-- section-summary: Paired outcomes on identical cases reveal new wins and losses, while segment deltas show which populations benefit or absorb the regression. -->

Once success and the baseline are fixed, evaluating both systems on the same cases exposes which decisions change rather than only two averages.

Suppose production is evaluated on 1,000 easy requests. Candidate is evaluated on 1,000 different, harder requests. Even if production scores 95% and candidate scores 93%, you don't know which system is actually better. The samples differ. A much stronger design uses the same inputs:

$$
x_1,x_2,\ldots,x_n
$$

Run:

$$
S_P(x_i)
$$

and:

$$
S_C(x_i)
$$

for every $$i$$. Now differences are much easier to attribute to the system change. This is a **paired comparison**. Suppose both systems process 1,000 examples. Production accuracy:

$$
90\%
$$

Candidate accuracy:

$$
94\%
$$

The four-point improvement is useful. But the paired table is more informative:

| Outcome                             | Cases |
| ----------------------------------- | ----: |
| Both correct                        |   860 |
| Production correct, candidate wrong |    40 |
| Production wrong, candidate correct |    80 |
| Both wrong                          |    20 |

Now we know the candidate:

* fixed 80 production failures,
* introduced 40 new failures,
* produced a net gain of 40.

That immediately creates two valuable investigation sets.

### Wins

$$
S_P(x_i)\text{ wrong},\quad S_C(x_i)\text{ correct}
$$

### Regressions

$$
S_P(x_i)\text{ correct},\quad S_C(x_i)\text{ wrong}
$$

The regressions are often more important than the aggregate number. Suppose:

$$
Q_P=90\%
$$

and:

$$
Q_C=95\%
$$

It is tempting to imagine that the candidate simply fixed half the old model's errors. But perhaps it did this:

```text
Production errors fixed:       120
New errors introduced:          70
Net improvement:                50
```

The candidate isn't the production system plus improvements. It represents a **different error distribution**. Every model replacement is partly an exchange:

some old failures disappear and some new failures appear.

The job of comparative evaluation is to determine whether that exchange is acceptable. Imagine the candidate produces 100 fewer errors overall. But its ten newly introduced errors include:

* incorrect high-value transactions,
* disclosure of private information,
* dangerous tool calls.

A count saying:

$$
-100\text{ total errors}
$$

doesn't capture the decision. Errors have different severity. A better conceptual measure is:

$$
\text{Expected Harm}
=
\sum_j
P(E_j)\times H(E_j)
$$

where $$E_j$$ is an error type and $$H(E_j)$$ is its consequence. You do not have to literally collapse this into one numerical score. Often separate severity categories are safer and more interpretable. Suppose:

| Segment      | Production | Candidate |
| ------------ | ---------: | --------: |
| Overall      |        91% |   **95%** |
| English      |        92% |   **97%** |
| French       |        90% |   **94%** |
| Spanish      |    **91%** |       84% |
| Long context |    **88%** |       80% |

The candidate wins overall. But some users would receive a meaningfully worse product. This is why candidate comparisons should calculate:

$$
\Delta_g
=
M_{C,g}-M_{P,g}
$$

for each important segment $$g$$. Now the question becomes:

Where does the candidate improve, where does it regress, and how important are those changes

Suppose traffic is divided into groups $$g$$. Overall candidate impact is approximately:

$$
\Delta
=
\sum_g P(g)\Delta_g
$$

This equation explains how a large regression can disappear in the overall metric. If Spanish requests are 3% of traffic:

$$
P(\text{Spanish})=0.03
$$

then a large Spanish regression receives relatively little weight in the global score. That does not mean the regression is acceptable. It means the aggregate metric is performing exactly as a weighted average should. Therefore important groups need explicit constraints. A model release isn't experienced by an “average request.” Different users and tasks experience different changes. One useful release report might look like:

| Group              | Traffic share | Quality change | Main effect          |
| ------------------ | ------------: | -------------: | -------------------- |
| Standard support   |           65% |          +5 pp | strong improvement   |
| Technical support  |           15% |          +2 pp | moderate improvement |
| Spanish            |            8% |          -4 pp | regression           |
| Long conversations |            7% |          -7 pp | serious regression   |
| High-risk requests |            5% |           0 pp | unchanged            |

Now the candidate's tradeoff becomes visible. This is fundamentally an allocation question:

**Who receives the benefits of the new model and who receives its newly introduced errors?**

Using identical examples isn't enough if the scorer changes. Suppose:

```text
Production model
→ evaluated with scorer v3

Candidate model
→ evaluated with scorer v4
```

Now you have two changes:

$$
\text{model}
+
\text{evaluation method}
$$

Any difference may come from either. For clean comparative evidence, hold constant as much as possible:

* examples,
* labels,
* prompts,
* tool environment,
* scoring rules,
* segment definitions,
* preprocessing,
* evaluation configuration.

The candidate itself should be the main thing that changes. Suppose we observe:

$$
Y_C-Y_P
$$

We want that difference to approximate the causal effect:

What changes because we switch systems

The more unrelated things change simultaneously, the harder that question becomes. If you replace:

* model,
* system prompt,
* retrieval system,
* tool APIs,
* postprocessor,

all at once and performance improves, you have tested the **bundle**. That's perfectly legitimate if you intend to deploy the bundle. But you cannot confidently say:

“The model caused the improvement.”

Comparative evaluation requires clarity about the treatment being tested. Production evolves. Maybe the original benchmark says the incumbent got:

$$
87\%
$$

six months ago. Since then:

* prompts improved,
* routing changed,
* retrieval improved,
* bugs were fixed.

Current production might now score:

$$
93\%
$$

Comparing the candidate against an old benchmark would exaggerate its benefit. So ideally rerun:

$$
S_P
$$

and:

$$
S_C
$$

on the same current evaluation suite. The comparator should represent **what users would continue receiving if you didn't release the candidate**.

![Production and candidate paths are compared on the same eligible cases, prediction time, policy, and labels before their paired effect is measured](/content-assets/articles/article-mlops-model-evaluation-candidate-vs-production-model/candidate-paired-comparison.png)

*A fair replacement test holds the question constant, then measures which decisions would actually change and how certain that effect is.*

## What Do Offline Replay, Shadow Traffic, and Randomized Live Traffic Each Prove?
<!-- section-summary: Offline replay provides controlled repeatability, shadow traffic exposes production inputs without affecting users, and randomized live traffic estimates causal product effects. -->

Paired offline evidence is necessary but cannot reproduce every production condition or causal user response, which creates a staged evidence ladder.

You generally don't begin by exposing users to an untested candidate. Start offline. Use:

* curated benchmarks,
* representative production replays where appropriate,
* regression suites,
* important segments,
* robustness tests,
* safety tests,
* fairness checks,
* latency and cost measurements.

Offline evaluation is inexpensive and controlled. It is especially good at answering:

Does the candidate contain an obvious reason not to deploy it

Suppose you have a sample of historical production requests:

$$
x_1,\ldots,x_n
$$

Replay them through both systems:

$$
S_P(x_i),S_C(x_i)
$$

Then compare outputs. This gives you realistic traffic without affecting users. You can analyze:

* quality,
* regressions,
* latency,
* tool behavior,
* segments,
* error clusters.

But production replay has limits. The historical user only saw the old system. If the candidate produced a different response, the user might have behaved differently afterward. Therefore replay cannot fully reproduce interactive feedback loops. Imagine a chatbot. Production generated:

“Please upload your invoice.”

The user then uploaded an invoice. But candidate might have generated:

“I already have enough information.”

Then the rest of the real conversation would never have happened. So replaying later conversation turns against the candidate creates an artificial sequence. This is an important limitation. For interactive systems:

$$
\text{system output}_t
\rightarrow
\text{user behavior}_{t+1}
$$

The model changes the future input distribution. Offline replay can test individual responses, but eventually you may need controlled live experimentation to understand user-system interaction. A **shadow deployment** sends real production requests to the candidate without letting its responses affect users.

Conceptually:

```text
                    ┌→ Production → user
user request ───────┤
                    └→ Candidate → logged only
```

This is valuable because the candidate sees:

* real traffic,
* real load patterns,
* real dependency behavior,
* current input distribution.

Yet users still receive the incumbent response. This is a safer bridge between offline and live testing.

For example:

Does the candidate time out more often on actual production traffic
Does it trigger tools differently
Does its larger context window increase latency unpredictably
Does production contain input types absent from our evaluation set
Does it overload downstream services
Does actual cost match our estimates

These are precisely the kinds of system properties that may not appear in static benchmarks. Because users never see candidate outputs, shadow testing cannot directly tell you:

* whether users prefer them,
* whether task completion improves,
* whether users abandon less,
* whether candidate responses change later behavior,
* whether conversion or retention changes.

Those require live exposure. So the stages answer different questions.

```text
offline
  ↓
Can it work

shadow
  ↓
Can it operate on production traffic

limited live
  ↓
Does it improve real user outcomes

broader rollout
  ↓
Does that result remain stable at scale
```

Now suppose some production requests go to:

$$
S_P
$$

and some to:

$$
S_C
$$

Ideally assignment is randomized where appropriate.

For example:

$$
50\%\rightarrow S_P
$$

$$
50\%\rightarrow S_C
$$

Then you can measure real outcomes. For a support assistant:

* issue-resolution rate,
* follow-up rate,
* escalation rate,
* user satisfaction,
* latency,
* abandonment.

Random assignment helps make the groups comparable. This is essentially an A/B experiment. Suppose you instead route:

experienced customers → candidate

and:

new customers → production.

Candidate gets 80% satisfaction. Production gets 70%. Did the model cause the difference? Maybe not. Experienced customers might have been easier to satisfy anyway. Formally, assignment became correlated with other variables:

$$
P(X\mid C)\neq P(X\mid P)
$$

Randomization tries to make:

$$
P(X\mid C)\approx P(X\mid P)
$$

so observed outcome differences are easier to attribute to the candidate.

## How Do Product Outcomes, Latency, Cost, Compatibility, and Fallbacks Affect the Comparison?
<!-- section-summary: The comparison needs model metrics, product outcomes, latency distributions, workload cost, interface compatibility, downstream effects, and fallback behaviour. -->

Live viability depends on more than predictive scores, so operational and product outcomes belong in the same comparison.

Suppose you randomly route every **request** independently. A single user might get:

```text
Turn 1 → production
Turn 2 → candidate
Turn 3 → production
```

For a conversational product, this may create nonsense. You may instead randomize at:

* user level,
* conversation level,
* account level,
* organization level.

The experimental unit should match the way treatment can affect later behavior. Otherwise the systems contaminate each other's observations. Suppose a candidate changes recommendations shown to sellers. Sellers alter their inventory. That inventory also affects production-model users. Now the candidate treatment changes the environment experienced by the control group. This violates a simple experimental assumption:

one unit's treatment does not affect another unit's outcome.

This is called **interference**. It appears in:

* marketplaces,
* social networks,
* recommendation systems,
* auctions,
* shared resource systems.

Candidate-versus-production experiments in such environments need extra care. Suppose candidate answer quality improves from:

$$
90\%\rightarrow94\%
$$

But response latency increases from:

$$
1.5\text{s}\rightarrow8\text{s}
$$

Users abandon more often. Real task completion falls. Then the model improvement did not translate into a product improvement. The end-to-end metric might be:

$$
P(\text{user task completed successfully})
$$

rather than:

$$
P(\text{model output judged correct})
$$

Both are useful. But product release ultimately concerns user/system outcomes. A useful release view often includes at least:

### Capability

* accuracy,
* task success,
* factuality,
* preference rate.

### Safety

* harmful outcomes,
* policy violations,
* severe failure categories.

### Robustness

* corrupted inputs,
* dependency failures,
* long contexts,
* adversarial conditions.

### Fairness and segments

* important group outcomes,
* regression gaps.

### Reliability

* request failures,
* malformed outputs,
* timeout rates.

### Performance

* latency,
* throughput.

### Economics

* inference cost,
* tool usage,
* infrastructure consumption.

A model replacement is a systems tradeoff, not a leaderboard contest. Suppose:

$$
\text{mean latency}=2\text{s}
$$

for both systems. They can still have very different user experiences. Maybe:

| Metric | Production | Candidate |
| ------ | ---------: | --------: |
| p50    |      1.5 s |     1.2 s |
| p95    |        3 s |       5 s |
| p99    |        5 s |      18 s |

The candidate is faster for typical requests but has a terrible latency tail. If long-tail latency causes timeouts, average latency hides a major regression. Therefore production comparisons often need:

$$
p50,\quad p95,\quad p99
$$

rather than only the mean. Suppose candidate inference is advertised as:

30% cheaper per token.

But perhaps it:

* writes longer answers,
* calls tools more frequently,
* retries more often,
* uses more context.

Actual request cost may rise. So evaluate:

$$
E[\text{total system cost per production request}]
$$

not merely:

$$
\text{model token price}
$$

Again, compare the system that will actually run. Suppose an LLM produces structured tool calls. Production might call a search tool in:

$$
20\%
$$

of requests. Candidate might call it in:

$$
45\%
$$

Even if both have equal quality, candidate deployment could:

* double search infrastructure demand,
* increase latency,
* hit API quotas,
* increase external-service costs.

This is why model behavior must be evaluated in context. A seemingly small behavioral change can create large system effects. A candidate may generate semantically correct output that breaks downstream code. Suppose production reliably emits:

```json
{"amount": 100, "currency": "GBP"}
```

Candidate occasionally emits:

```json
{"amount": "£100"}
```

A human sees the same information. The parser may not. So system evaluation should test contracts such as:

* JSON schema compliance,
* tool-call validity,
* required fields,
* output lengths,
* enum values,
* expected refusal formats.

A candidate can be smarter and still be less deployable. Imagine the candidate's primary answer quality is better. But when retrieval fails:

| System     | Safe fallback rate |
| ---------- | -----------------: |
| Production |                99% |
| Candidate  |                78% |

Candidate often fabricates an answer instead. If retrieval failures occur regularly, this could dominate the release risk. Candidate evaluation therefore needs scenarios beyond the happy path. You are replacing production behavior under:

$$
\text{normal conditions}
$$

and:

$$
\text{abnormal conditions}
$$

both.

## How Do Uncertainty, Release Scope, Canary Exposure, and Rollback Control Risk?
<!-- section-summary: Intervals and practical margins guide the smallest justified canary scope, with fixed goals and a tested rollback path controlling unknown risk. -->

Those dimensions remain estimates with unknown risks, making uncertainty, limited exposure, stable goals, and rollback part of the experiment.

Suppose:

$$
Q_P=91.0\%
$$

and:

$$
Q_C=91.4\%
$$

Is the candidate really better? Maybe. Or the 0.4-point difference could result from sampling noise. The important estimate is:

$$
\Delta=Q_C-Q_P
$$

along with uncertainty around $$\Delta$$.

Conceptually:

$$
\Delta
=
0.4\%\pm\text{uncertainty}
$$

If plausible values range from:

$$
-0.5\%
$$

to:

$$
+1.3\%
$$

the evidence is very different from a result tightly concentrated around +0.4%. Suppose with 50 million test observations you determine with enormous statistical confidence:

$$
Q_C-Q_P=+0.01\%
$$

The improvement is real. But perhaps economically or operationally irrelevant. Conversely:

$$
Q_C-Q_P=+3\%
$$

might be highly valuable even if a small sample leaves substantial statistical uncertainty. So you need both:

**How confident are we that the effect exists?**

and:

**Is the effect large enough to matter?**

These are different questions. Online experiments can collect huge numbers of events. That makes tiny differences statistically detectable. Then dashboards become full of:

```text
p < 0.001
```

while the product impact is negligible. It is often useful to predefine a **minimum practically important effect**.

For example:

We need at least +1 percentage point task completion to justify the additional cost.

Now the decision isn't merely:

$$
\Delta>0
$$

but:

$$
\Delta>\delta_{\text{useful}}
$$

Suppose your live test sees:

$$
1,000,000
$$

requests. Overall estimates may be extremely precise. But a critical segment could contain only:

$$
400
$$

requests. So you may know:

Overall performance definitely improved.

while remaining uncertain about:

Whether the candidate is safe for this specific group.

This is another reason release scope doesn't need to be all-or-nothing. Suppose the evidence says:

| Traffic type            | Candidate result      |
| ----------------------- | --------------------- |
| General English support | clearly better        |
| French                  | clearly better        |
| Spanish                 | uncertain             |
| Long-context requests   | worse                 |
| High-risk workflow      | insufficient evidence |

One possible release architecture is:

```text
English normal → candidate
French normal  → candidate
Spanish        → production
Long context   → production
High risk      → production/human
```

This isn't necessarily a compromise. It is using evidence precisely. The release boundary should match the boundary of what you have actually demonstrated. Suppose evaluation tells you:

$$
S_C
$$

is excellent for short coding questions but weaker on long legal documents. Then production routing can implement:

$$
r(x)=
\begin{cases}
S_C  \text{short coding}\\
S_P  \text{long legal}\\
\text{specialized system}  \text{other}
\end{cases}
$$

Evaluation doesn't merely decide which single model wins. It can determine **which model should handle which cases**. This is often more powerful than globally replacing one model with another. Even after offline, shadow, and experimental evaluation, production may reveal things you did not anticipate. A canary rollout might expose the candidate to:

$$
1\%
$$

of eligible traffic first. Then perhaps:

$$
5\%
\rightarrow
20\%
\rightarrow
50\%
\rightarrow
100\%
$$

if important metrics remain acceptable. The exact percentages are product-specific. The principle is:

**Increase exposure as evidence increases.**

You are limiting the blast radius of unknown failures. Suppose the candidate causes a severe regression. How quickly can production return to the incumbent? If rollback requires a week-long deployment process, your release carries much greater operational risk. Strong release design therefore defines:

* which metrics trigger rollback,
* who or what can initiate it,
* whether routing can immediately return traffic to production,
* whether data or schema changes are backwards-compatible.

Release evaluation and operational control are linked. Suppose your predefined condition says:

Do not release if Spanish task success falls by more than 2 percentage points.

Candidate result:

$$
-4\%
$$

Then someone says:

“Spanish traffic is small, so maybe four points isn't actually that bad.”

Perhaps there is genuinely new information. But repeatedly redefining acceptance rules after observing results creates biased decision-making. This is why major release criteria should be specified before evaluation. Exploratory findings can still modify the plan, but changes should be explicit rather than silently rationalized. Suppose every failed candidate example becomes a prompt tweak. Then you rerun on exactly the same examples. Eventually the candidate achieves:

$$
100\%
$$

But you may have simply overfit your engineering process to the evaluation set. This is conceptually the same as training-set overfitting. So candidate evaluation often benefits from:

* development evals for iteration,
* held-out release evals,
* fresh production samples,
* live validation.

The release suite should contain evidence the model-development process has not repeatedly optimized against.

![Offline evaluation, shadow traffic, and a limited canary answer different release questions and grant progressively narrower forms of production authority](/content-assets/articles/article-mlops-model-evaluation-candidate-vs-production-model/candidate-evidence-stages.png)

*Offline evidence tests historical quality, shadow traffic tests the current runtime without changing decisions, and a canary tests a small amount of real product impact.*

## How Do Versioning, Routing, Scale, and an Imperfect Production Baseline Change the Decision?
<!-- section-summary: Versioned prompts, data, metrics, routing rules, and scale tests support local value even when the candidate is not globally superior and production itself has flaws. -->

A candidate may serve only some traffic or fail only at scale, and a flawed production baseline should remain a comparator rather than unquestioned truth.

To reproduce a comparison, you need to know what actually ran. Record things like:

```text
candidate_model_version
production_model_version
system_prompt_version
retrieval_version
tool_versions
routing_config
postprocessor_version
evaluation_dataset_version
scorer_version
segment_definition_version
timestamp
```

Otherwise, six weeks later:

“Candidate beat production by 3%”

may be impossible to reconstruct. Evaluation lineage turns a result into auditable engineering evidence. Suppose production has a long instruction:

“Never do X. Always do Y. If Z, follow procedure Q…”

Maybe that prompt exists because the incumbent model had a particular weakness. The candidate may:

* interpret it better,
* interpret it differently,
* or suffer because the workaround is now counterproductive.

So a model upgrade can require revalidating the surrounding prompts. But be careful about comparison. It can be useful to perform two experiments:

### Drop-in comparison

Same system, model swapped. This answers:

What happens if we replace only the model

### Optimized-system comparison

Production system versus a candidate-specific configuration. This answers:

What is the best candidate system we could realistically deploy

Both questions are legitimate, but they should not be confused. Suppose:

$$
P =
\text{old model + old prompt}
$$

First test:

$$
C_1 =
\text{new model + old prompt}
$$

This isolates compatibility of the model replacement. Then perhaps:

$$
C_2 =
\text{new model + optimized prompt}
$$

Now:

$$
C_2\text{ vs }P
$$

answers the actual release question if $$C_2$$ is what you intend to deploy. And:

$$
C_2\text{ vs }C_1
$$

shows the effect of candidate-specific system tuning. This structure can make debugging much easier. Imagine:

| Workload      | Production | Candidate |
| ------------- | ---------: | --------: |
| General tasks |    **94%** |       91% |
| Coding        |        90% |   **98%** |

The candidate is worse globally. But it could be a significant improvement as a specialized coding model. So asking:

Which model wins

may be the wrong question. Better:

**For which inputs does each system provide the best acceptable behavior?**

This naturally leads to routing and specialized deployment. Sometimes a candidate wins offline and loses online. Why? Potential reasons include:

* production prompts differ,
* real inputs are longer,
* users react differently,
* load affects latency,
* dependencies behave differently,
* hidden traffic segments were missing,
* evaluation labels poorly represent real success.

This is not necessarily evidence that offline evaluation is useless. It is evidence that offline metrics were imperfect proxies for the final product outcome. The mismatch itself should improve the next evaluation suite. Suppose the candidate gets fewer thumbs-up ratings. That doesn't automatically mean it's worse. Maybe:

* users see it on harder requests,
* rating UI changed,
* response latency affects ratings,
* exposure wasn't randomized,
* only dissatisfied users tend to rate,
* the candidate correctly refuses requests that the old model incorrectly answered.

Online metrics also require interpretation. Production data is more realistic, not magically unbiased.

## What Evidence Should Continue After Launch and Strengthen Future Evaluations?
<!-- section-summary: Delayed outcomes and traffic composition continue the comparison after launch, while each incident adds cases and guardrails to future evaluation. -->

The comparison continues after launch because delayed effects and changing traffic can invalidate the early result.

Suppose the candidate reaches 100% traffic on Monday. You should still verify:

Did the expected improvement appear

You might compare:

$$
\text{predicted offline improvement}
$$

against:

$$
\text{observed production improvement}
$$

and monitor:

* important segment metrics,
* safety outcomes,
* error clusters,
* latency,
* cost,
* tool usage,
* user behavior,
* failure rates.

A release isn't complete when traffic switches. It is complete when the expected production behavior is verified. Some model changes have consequences that emerge slowly.

For example:

* users adapt to response style,
* support escalations accumulate,
* cost patterns change over long conversations,
* new model outputs enter future training data,
* downstream operators alter their workflows.

A one-hour canary may not detect these. Evaluation windows should match the timescale of the consequence you care about. Suppose candidate quality appears to decline one month later. Maybe the model has not changed.

Instead:

$$
P(\text{long-context traffic})
$$

increased from:

$$
10\%\rightarrow40\%
$$

If long-context requests are harder, aggregate performance falls. So compare:

$$
P(\text{traffic segment})
$$

and:

$$
P(\text{failure}\mid\text{segment})
$$

Separating population change from conditional performance change prevents false diagnoses. Suppose the candidate passed all evaluations. After release, you discover it fails whenever tool output contains an empty array. A weak process:

```text
incident
  ↓
patch
  ↓
forget
```

A stronger process:

```text
incident
  ↓
reproduce
  ↓
identify mechanism
  ↓
add candidate-vs-production regression test
  ↓
fix
  ↓
run on every future candidate
```

The comparison suite becomes organizational memory. You can think about candidate evaluation as progressively reducing uncertainty.

```text
       DEVELOPMENT EVALS
             │
             ▼
       HELD-OUT OFFLINE
             │
             ▼
       PRODUCTION REPLAY
             │
             ▼
        SHADOW TRAFFIC
             │
             ▼
     LIMITED LIVE TRAFFIC
             │
             ▼
       STAGED ROLLOUT
             │
             ▼
    POST-RELEASE MONITORING
```

Each stage answers a different question.

### Development evaluation

Does this idea look promising

### Held-out evaluation

Does the improvement generalize

### Replay

How does it behave on realistic historical traffic

### Shadow

Can it survive today's live environment

### Limited live traffic

Does it improve real user outcomes

### Staged rollout

Does it remain safe as exposure grows

### Monitoring

Does the improvement persist

Imagine you operate an AI support assistant. Production system:

$$
S_P
$$

Candidate system:

$$
S_C
$$

Your release objective is:

Improve issue resolution without worsening severe factual errors or increasing p95 latency beyond 3 seconds.

### Offline evaluation

| Metric                | Production | Candidate |
| --------------------- | ---------: | --------: |
| Task success          |        89% |   **94%** |
| Severe factual errors |       0.7% |  **0.4%** |
| p95 latency           |  **1.9 s** |     2.5 s |

Promising.

### Segment analysis

| Segment            | Production | Candidate |
| ------------------ | ---------: | --------: |
| Simple requests    |        93% |   **97%** |
| Billing            |        90% |   **94%** |
| Technical          |        85% |   **93%** |
| Long conversations |    **88%** |       79% |

Now there is a serious regression. Error analysis shows the candidate loses early conversation constraints.

### Robustness test

Long-context degradation becomes severe beyond 25,000 tokens. So the team defines an initial routing boundary:

```text
context ≤ 25k → candidate
context > 25k → production
```

### Shadow traffic

Candidate sees real production traffic. You discover it calls the knowledge-search service 30% more frequently. Cost increases, but remains acceptable. No unexpected safety problem appears.

### Limited live test

Eligible conversations are randomized between production and candidate. Results:

| Metric                | Production | Candidate |
| --------------------- | ---------: | --------: |
| User issue resolution |        72% |   **77%** |
| Escalation            |        18% |   **14%** |
| p95 latency           |  **2.0 s** |     2.6 s |
| Severe factual error  |       0.6% |  **0.4%** |

The offline improvement translates into user outcomes.

### Initial release

Candidate receives all eligible conversations with:

$$
\text{context}\le25k
$$

Longer conversations continue using production. This is not:

Candidate won.

The actual conclusion is:

> **Evidence supports candidate deployment inside this operating region.**

That is a much more precise statement.

## How Do Deltas, Constraints, and the Release Ladder Produce a Final Decision?
<!-- section-summary: A release decision evaluates candidate-minus-production deltas under quality, safety, latency, cost, compatibility, and reversibility constraints. -->

The final dashboard and constrained-optimization view turn all of those deltas into an explicit release decision.

**Model selection** asks:

Which candidate performs best on my development objective

Suppose:

$$
M_1,\ M_2,\ M_3
$$

and you pick:

$$
M_2
$$

because it has the best benchmark score. **Release evaluation** asks:

Is replacing some part of the production system with $$M_2$$ actually justified

Those are different problems. A candidate can win model selection and still fail release evaluation.

For example:

* benchmark improves,
* but latency violates requirements;
* quality improves,
* but one critical segment regresses;
* accuracy improves,
* but system reliability falls.

Production is the real alternative. A particularly useful mental shift is replacing:

```text
Candidate accuracy: 94%
```

with:

```text
Change vs production:
Overall quality        +3.0 pp
High-risk errors       -0.2 pp
Spanish quality        -4.5 pp
p95 latency            +0.7 sec
Cost/request           +18%
Timeout rate           +0.03 pp
```

This immediately aligns evaluation with the actual decision. You aren't trying to understand whether 94% is “good.” You are asking:

What do we gain, what do we lose, and where

Conceptually, you may want:

$$
\max \text{user benefit}
$$

subject to constraints such as:

$$
\text{safety risk}\le T_s
$$

$$
\text{latency}\le T_l
$$

$$
\text{cost}\le T_c
$$

$$
\text{critical segment regression}\le T_g
$$

The candidate does not need to dominate production on every metric. It needs to produce a better acceptable operating point given your product requirements. This explains why a single composite leaderboard score is often insufficient for release decisions.

| Question                           | What you need                      |
| ---------------------------------- | ---------------------------------- |
| **Did overall behavior improve?**  | candidate-production delta         |
| **Where did it improve?**          | wins and segment deltas            |
| **Where did it regress?**          | paired regressions                 |
| **How certain are we?**            | counts and uncertainty             |
| **What else changed?**             | latency, cost, reliability, safety |
| **Where can we safely deploy it?** | release boundaries                 |

A dashboard containing forty standalone candidate metrics but no production comparison misses the main decision. The deepest mistake is to think:

**“We have a new model. Let's determine whether it is good enough.”**

That is usually not the actual production decision. The actual question is:

$$
\boxed{
\text{What would change if we replace the system users receive today?}
}
$$

That leads naturally to the full process:

$$
\boxed{
\text{Current production}
\rightarrow
\text{release hypothesis}
\rightarrow
\text{same-case comparison}
\rightarrow
\text{wins and regressions}
\rightarrow
\text{segments}
\rightarrow
\text{system stress tests}
\rightarrow
\text{shadow traffic}
\rightarrow
\text{limited live traffic}
\rightarrow
\text{smallest justified release scope}
\rightarrow
\text{production verification}
}
$$

The candidate should therefore never be evaluated merely as an isolated model. Evaluate it against the **real alternative**: the complete system already serving users. And do not ask only:

“Is the candidate better on average?”

Ask:

**What does it fix? What does it break? Who experiences each change? Under what conditions does the improvement hold? And what is the smallest production boundary for which the evidence actually supports replacement?**

That is the first-principles meaning of **candidate vs production evaluation**.

![Five-step release decision starts with a pinned candidate and evidence, then grants defer, shadow, canary, or release authority while only live scopes enter production verification](/content-assets/articles/article-mlops-model-evaluation-candidate-vs-production-model/candidate-release-authority-summary.png)

*A deferred candidate returns for new evidence. Shadow, canary, and released scopes are verified only against the traffic and outcomes each decision actually authorizes.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Production System Is the Candidate Actually Trying to Replace?]{kind="recap"}
A candidate replaces the current production system, including preprocessing, policies, fallbacks, latency, and costs, so success must be defined against that real alternative.
:::

:::expand[How Do Paired Cases and Segments Reveal Who Benefits and Who Pays?]{kind="recap"}
Paired outcomes on identical cases reveal new wins and losses, while segment deltas show which populations benefit or absorb the regression.
:::

:::expand[What Do Offline Replay, Shadow Traffic, and Randomized Live Traffic Each Prove?]{kind="recap"}
Offline replay provides controlled repeatability, shadow traffic exposes production inputs without affecting users, and randomized live traffic estimates causal product effects.
:::

:::expand[How Do Product Outcomes, Latency, Cost, Compatibility, and Fallbacks Affect the Comparison?]{kind="recap"}
The comparison needs model metrics, product outcomes, latency distributions, workload cost, interface compatibility, downstream effects, and fallback behaviour.
:::

:::expand[How Do Uncertainty, Release Scope, Canary Exposure, and Rollback Control Risk?]{kind="recap"}
Intervals and practical margins guide the smallest justified canary scope, with fixed goals and a tested rollback path controlling unknown risk.
:::

:::expand[How Do Versioning, Routing, Scale, and an Imperfect Production Baseline Change the Decision?]{kind="recap"}
Versioned prompts, data, metrics, routing rules, and scale tests support local value even when the candidate is not globally superior and production itself has flaws.
:::

:::expand[What Evidence Should Continue After Launch and Strengthen Future Evaluations?]{kind="recap"}
Delayed outcomes and traffic composition continue the comparison after launch, while each incident adds cases and guardrails to future evaluation.
:::

:::expand[How Do Deltas, Constraints, and the Release Ladder Produce a Final Decision?]{kind="recap"}
A release decision evaluates candidate-minus-production deltas under quality, safety, latency, cost, compatibility, and reversibility constraints.
:::
