---
title: "Statistical Uncertainty and Paired Model Comparisons"
description: "Measure uncertainty in offline model metrics with paired bootstrap intervals, permutation tests, cluster-aware resampling, and practical release gates."
overview: "Offline scores estimate production behaviour from limited evidence. Learn how to define a candidate effect, preserve paired comparisons, interpret confidence intervals, run bootstrap and permutation procedures, handle dependent data and multiple comparisons, and turn uncertainty into a release decision."
tags: ["MLOps", "evaluation", "statistics"]
order: 5
id: "article-mlops-model-evaluation-statistical-uncertainty-paired-comparisons"
aliases:
  - roadmaps/mlops/modules/model-evaluation/offline-evaluation/04-statistical-uncertainty-and-paired-comparisons.md
---

## Table of Contents

1. [Why Is Every Offline Score an Estimate?](#why-is-every-offline-score-an-estimate)
2. [Why Should Candidate and Baseline Models Be Compared on the Same Examples?](#why-should-candidate-and-baseline-models-be-compared-on-the-same-examples)
3. [How Do Paired Bootstrap and Permutation Tests Measure a Difference?](#how-do-paired-bootstrap-and-permutation-tests-measure-a-difference)
4. [How Do Effect Size, Non-Inferiority, and the Correct Sampling Unit Guide Decisions?](#how-do-effect-size-non-inferiority-and-the-correct-sampling-unit-guide-decisions)
5. [How Do Rare Groups, Repeated Comparisons, and Test Reuse Distort Certainty?](#how-do-rare-groups-repeated-comparisons-and-test-reuse-distort-certainty)
6. [How Should Release Rules Use Intervals, Guardrails, Power, and Segment Uncertainty?](#how-should-release-rules-use-intervals-guardrails-power-and-segment-uncertainty)
7. [What Other Uncertainty Sources Must a Reproducible Comparison Record?](#what-other-uncertainty-sources-must-a-reproducible-comparison-record)
8. [How Do You Report a Paired Model Comparison Without Overclaiming?](#how-do-you-report-a-paired-model-comparison-without-overclaiming)
9. [Check Your Answers](#check-your-answers)

Two classifiers score 91.2% and 91.6% on the same test set. The four-tenths difference looks precise, but a different sample of users might reverse it. The release decision needs to know not only which number is larger, but how stable the difference is and whether it is large enough to matter.

**Statistical uncertainty** describes what the available sample can and cannot establish about a target population. Because both models can score the same examples, paired comparisons preserve case-level information that independent averages throw away. Bootstrap intervals, permutation tests, practical margins, and the correct sampling unit then support a more honest decision.

Use these questions to move from two point estimates to a reproducible comparison with explicit uncertainty:

1. **Why Is Every Offline Score an Estimate?**
2. **Why Should Candidate and Baseline Models Be Compared on the Same Examples?**
3. **How Do Paired Bootstrap and Permutation Tests Measure a Difference?**
4. **How Do Effect Size, Non-Inferiority, and the Correct Sampling Unit Guide Decisions?**
5. **How Do Rare Groups, Repeated Comparisons, and Test Reuse Distort Certainty?**
6. **How Should Release Rules Use Intervals, Guardrails, Power, and Segment Uncertainty?**
7. **What Other Uncertainty Sources Must a Reproducible Comparison Record?**
8. **How Do You Report a Paired Model Comparison Without Overclaiming?**

## Why Is Every Offline Score an Estimate?
<!-- section-summary: An offline score estimates performance for a target population and varies with the sampled cases even when the model stays fixed. -->

A small observed improvement may reflect the sampled cases rather than a reliable population difference, so evaluation begins by treating scores as estimates.

Suppose two models are evaluated on the same test set:

$$
\text{Model A accuracy}=91.2\%
$$

$$
\text{Model B accuracy}=91.6\%
$$

It is tempting to conclude:

$$
\boxed{\text{B is better}}
$$

But the observed difference is only:

$$
0.4\text{ percentage points}
$$

Would B still win if we happened to receive a slightly different sample of users, transactions, queries, or patients? That is the problem of **statistical uncertainty**. An offline evaluation score is not usually the model's exact performance in the world. It is an estimate based on a finite sample. The first-principles picture is:

$$
\boxed{
\text{Observed model difference}
=
\text{real difference}
+
\text{sampling variation}
}
$$

Statistical comparison tries to determine how much of the observed difference could plausibly come from sampling variation. Suppose the real deployment population contains millions of possible examples. Ideally, we would like to know:

$$
\mu = E[L(Y,f(X))]
$$

where $$L$$ measures prediction loss. This is the model's expected performance over the population we care about. But we cannot evaluate every possible future example. Instead we have a test sample:

$$
D=\{(x_1,y_1),\ldots,(x_n,y_n)\}
$$

and calculate:

$$
\hat\mu
=
\frac1n\sum_{i=1}^{n}L(y_i,f(x_i))
$$

The important distinction is:

$$
\boxed{\mu=\text{population quantity we want}}
$$

while:

$$
\boxed{\hat\mu=\text{quantity we observed on our sample}}
$$

Usually:

$$
\hat\mu\neq\mu
$$

exactly. The question is how uncertain $$\hat\mu$$ is as an estimate of $$\mu$$. Imagine evaluating a fraud classifier on 10,000 transactions. You obtain:

$$
Recall=84.1\%
$$

Now imagine history had unfolded slightly differently and your test set contained another 10,000 representative transactions. Perhaps you would get:

$$
83.5\%
$$

Or:

$$
84.8\%
$$

Or:

$$
82.9\%
$$

The model has not changed. The population has not necessarily changed. Only the particular finite sample changed. This is **sampling variation**.

Conceptually:

$$
D_1\rightarrow\hat\mu_1
$$

$$
D_2\rightarrow\hat\mu_2
$$

$$
D_3\rightarrow\hat\mu_3
$$

Different representative datasets produce slightly different measured scores. Statistical uncertainty describes this instability. Suppose true classification accuracy is somewhere near 90%. If you evaluate only:

$$
n=20
$$

examples, the measured accuracy can jump substantially depending on which examples you happen to sample. With:

$$
n=1{,}000{,}000
$$

the estimate will usually be much more stable. Very roughly, many standard errors shrink proportional to:

$$
\frac{1}{\sqrt n}
$$

This has an important consequence. To cut sampling uncertainty approximately in half, you often need around:

$$
4\times
$$

as many independent observations. So collecting twice as much data does not generally halve uncertainty. This distinction is fundamental. Suppose your confidence interval is extremely narrow:

$$
[91.47\%,91.53\%]
$$

That tells you the metric was measured very precisely **under the assumptions of the evaluation design**. It does not prove that the number represents production. For example, the test data might:

* come from the wrong population,
* contain data leakage,
* contain systematically incorrect labels,
* omit important users,
* use future information,
* be months out of date.

Then you can obtain:

$$
\boxed{\text{a very precise estimate of the wrong thing}}
$$

More data fixes sampling noise. It does not automatically fix bias. A useful mental decomposition is:

$$
\text{Evaluation error}
\approx
\text{sampling variation}
+
\text{systematic bias}
$$

### Sampling variation

Arises because we observed only a finite sample. Methods such as confidence intervals, bootstrap procedures, and hypothesis tests can help quantify it.

### Systematic bias

Arises because the evaluation process itself does not represent the target problem. Examples:

* selection bias,
* label bias,
* temporal leakage,
* missing populations,
* inappropriate metrics,
* deployment distribution shift.

A confidence interval usually does **not** protect you from these problems. This is why statistical sophistication cannot rescue a badly constructed evaluation set. Before calculating uncertainty, ask:

What exactly is the population quantity we care about

This is sometimes called the **estimand**. Suppose you are measuring error. Possible estimands include:

$$
E[\text{absolute error}]
$$

$$
E[\text{absolute error}\mid\text{new customers}]
$$

$$
P(\text{correct classification})
$$

$$
Recall
$$

$$
NDCG@10
$$

$$
P_{99}(\text{latency})
$$

These are different population quantities. Likewise, "Model B improves over Model A" needs a precise definition. For a loss metric, perhaps:

$$
\Delta
=
E[L_B-L_A]
$$

For an accuracy-like metric where larger is better:

$$
\Delta
=
E[M_B-M_A]
$$

Until $$\Delta$$ is clearly defined, there is nothing precise for a statistical test or confidence interval to estimate.

## Why Should Candidate and Baseline Models Be Compared on the Same Examples?
<!-- section-summary: The release quantity is usually the candidate-minus-baseline difference, and paired evaluation removes variation shared by both models on the same cases. -->

Because release decisions compare systems, the relevant estimate is their difference on the same examples rather than two isolated scores.

Suppose:

$$
MAE_A=10.4
$$

and:

$$
MAE_B=10.1
$$

You could separately calculate uncertainty around each score. But the actual release question is usually:

$$
\boxed{\text{How much better or worse is B than A?}}
$$

Define:

$$
\Delta=MAE_B-MAE_A
$$

Then:

$$
\Delta=-0.3
$$

Since lower MAE is better, negative values favor B. The quantity you should estimate uncertainty around is often:

$$
\boxed{\Delta}
$$

rather than the two scores independently. Suppose Model A and Model B are evaluated on exactly the same $$n$$ examples. For example $$i$$, calculate:

$$
L_{A,i}
$$

and:

$$
L_{B,i}
$$

Then define a per-example difference:

$$
d_i=L_{B,i}-L_{A,i}
$$

Now the overall difference is:

$$
\bar d
=
\frac1n\sum_i d_i
$$

This is a **paired comparison**. Why is pairing powerful? Because each model faced the same example. If example 17 was extremely difficult, it probably hurt both models. The comparison directly asks:

$$
\boxed{\text{On this same case, which model did better?}}
$$

rather than letting variation in example difficulty contaminate the comparison. Imagine two models are evaluated on different datasets. Model A receives mostly easy cases. Model B receives mostly difficult cases. Their score difference reflects both:

$$
\text{model quality}
$$

and:

$$
\text{dataset difficulty}
$$

With paired evaluation:

$$
(x_i,y_i)
$$

is identical for both models. So much of the variation caused by example difficulty cancels when we compute:

$$
d_i=L_{B,i}-L_{A,i}
$$

This often makes paired comparisons considerably more statistically efficient. Hence the general rule:

$$
\boxed{
\text{When possible, compare candidate and baseline on exactly the same evaluation units.}
}
$$

Suppose absolute errors are:

| Example | Model A | Model B | $$B-A$$ |
| ------: | ------: | ------: | ------: |
|       1 |      10 |       8 |      -2 |
|       2 |      30 |      29 |      -1 |
|       3 |       5 |       6 |      +1 |
|       4 |      20 |      15 |      -5 |
|       5 |       8 |       7 |      -1 |

The differences are:

$$
[-2,-1,+1,-5,-1]
$$

Average:

$$
\bar d
=
\frac{-8}{5}
=
-1.6
$$

So B reduces absolute error by:

$$
1.6
$$

units on average. But the paired differences show more than the aggregate MAE values. We see that B improves four examples and worsens one. This per-unit comparison is the raw material for many statistical procedures. Suppose we estimate:

$$
\Delta=-1.6
$$

with a 95% confidence interval:

$$
[-2.4,-0.8]
$$

The interval represents uncertainty in our estimate of the population effect. The precise frequentist interpretation is:

If we repeatedly sampled new datasets from the same population and constructed intervals using this procedure, approximately 95% of those intervals would contain the true population difference.

It is common informally to say:

"The plausible range is roughly -2.4 to -0.8."

That can be useful intuition. But a classical 95% confidence interval does not literally mean that the already-fixed unknown parameter has a 95% probability of lying inside this particular realized interval. Confidence intervals become easier to understand through an imaginary experiment. Suppose the true difference is:

$$
\Delta^*
$$

Repeatedly:

1. sample a new evaluation dataset,
2. evaluate A and B,
3. calculate $$\hat\Delta$$,
4. construct a 95% confidence interval.

You obtain:

$$
CI_1,\ CI_2,\ CI_3,\ldots
$$

About:

$$
95\%
$$

of those intervals should contain:

$$
\Delta^*
$$

if the statistical assumptions and interval procedure are appropriate. You usually only have one real test set. Resampling methods try to approximate aspects of this repeated-sampling behavior using the data you have. Consider:

$$
\Delta=+0.8
$$

with interval:

$$
[+0.7,+0.9]
$$

The effect is estimated fairly precisely. Compare:

$$
\Delta=+0.8
$$

with:

$$
[-1.2,+2.8]
$$

The point estimate is identical. But the second experiment contains much less information about the true difference. A confidence interval communicates two things at once:

$$
\boxed{\text{estimated effect size}}
$$

and:

$$
\boxed{\text{precision of that estimate}}
$$

That is usually much more informative than reporting a point estimate alone.

![Paired bootstrap resamples the same request indices for baseline and candidate and lifts related rows into whole clusters](/content-assets/articles/article-mlops-model-evaluation-statistical-uncertainty-paired-comparisons/paired-resampling.png)

*Pairing preserves the replacement comparison, while the resampling unit preserves the users, sessions, sites, or time blocks that share variation.*

## How Do Paired Bootstrap and Permutation Tests Measure a Difference?
<!-- section-summary: A paired bootstrap estimates the distribution of metric differences, while a paired permutation test examines whether labels A and B are exchangeable under no effect. -->

That paired structure supports resampling and randomization methods that quantify or test the observed difference.

Many model metrics have complicated sampling distributions. Examples include:

* F1,
* NDCG,
* MAP,
* median error,
* differences between nonlinear metrics.

The bootstrap provides a flexible way to estimate uncertainty without deriving a custom analytic formula for each metric. Suppose the evaluation set has:

$$
N
$$

independent units. The paired bootstrap works roughly like this.

### Step 1

Evaluate both models on every unit.

### Step 2

Sample:

$$
N
$$

units **with replacement** from the original evaluation set. For example, one bootstrap sample might contain:

$$
[3,7,7,1,9,3,\ldots]
$$

Some original units appear multiple times. Others do not appear at all.

### Step 3

For that bootstrap sample, compute both model metrics:

$$
M_A^{(b)}
$$

and:

$$
M_B^{(b)}
$$

and their difference:

$$
\Delta^{(b)}
=
M_B^{(b)}-M_A^{(b)}
$$

### Step 4

Repeat many times:

$$
b=1,\ldots,B
$$

producing:

$$
\Delta^{(1)},\Delta^{(2)},\ldots,\Delta^{(B)}
$$

This approximates the sampling distribution of the difference. Suppose you bootstrap Model A's examples independently from Model B's examples. You destroy the relationship:

$$
\text{A and B evaluated the same case}
$$

Instead, each bootstrap draw should select a unit and bring along **both models' outcomes for that unit**. If unit 17 is drawn three times, then:

$$
(A_{17},B_{17})
$$

appears three times. That preserves the paired experiment. Formally:

$$
\boxed{
\text{resample evaluation units, not model results independently}
}
$$

Suppose 10,000 bootstrap repetitions produce:

$$
\Delta^{(1)},\ldots,\Delta^{(10000)}
$$

A simple percentile interval uses the:

$$
2.5\text{th percentile}
$$

and:

$$
97.5\text{th percentile}
$$

For example:

$$
95\%\,CI=[0.3,0.9]
$$

for an accuracy improvement measured in percentage points. That means the resampling procedure suggests uncertainty roughly within that range. More sophisticated bootstrap intervals exist, but the core idea remains:

$$
\boxed{
\text{simulate plausible resamples}
\rightarrow
\text{observe how the model difference varies}
}
$$

This limitation is critical. Suppose your test set contains only desktop users but production is 80% mobile. Bootstrapping the desktop users 100,000 times does not create mobile users. Likewise, bootstrapping cannot fix:

* systematic label errors,
* temporal leakage,
* missing rare cases,
* dataset shift,
* incorrect metric definitions.

The bootstrap estimates uncertainty around the empirical population represented by your data. It does not magically make the underlying evidence valid. A confidence interval estimates an effect and its uncertainty. A hypothesis test typically asks whether the observed effect would be surprising under some null hypothesis. For a paired comparison, imagine the null hypothesis says that A and B are exchangeable for each evaluation unit. For each unit, we have:

$$
(A_i,B_i)
$$

Under the null, we may randomly swap:

$$
A_i\leftrightarrow B_i
$$

Then recalculate the difference. Repeat this many times. This generates a **null distribution**:

$$
\Delta_{\text{null}}^{(1)},
\ldots,
\Delta_{\text{null}}^{(B)}
$$

The question becomes:

If A and B really had no relevant systematic difference under this null, how often would random swapping produce a difference at least as extreme as the one we observed

Suppose B wins on almost every example. Observed differences might be:

$$
[-2,-4,-1,-3,-5,-2,\ldots]
$$

where negative means B has lower loss. If A and B were genuinely exchangeable, randomly swapping their labels within each pair would cause positive and negative differences to appear much more symmetrically. Obtaining an overwhelmingly one-sided result would then be unusual. Permutation testing formalizes that intuition. The important advantage is that the pairing structure is preserved. Suppose a paired permutation test gives:

$$
p=0.003
$$

Roughly speaking, under the specified null hypothesis and randomization assumptions, results this extreme would be unusual. It does **not** mean:

$$
P(\text{null is true})=0.003
$$

And it does not tell you whether the difference is useful.

For example:

$$
\Delta=0.001\%
$$

could become statistically detectable with an enormous dataset. That may have no practical importance. So:

$$
\boxed{
\text{statistical evidence}
\neq
\text{practical importance}
}
$$

## How Do Effect Size, Non-Inferiority, and the Correct Sampling Unit Guide Decisions?
<!-- section-summary: Practical effect size and non-inferiority margins belong before significance, and resampling must preserve the genuinely independent user, query, patient, or time unit. -->

Statistical machinery becomes useful only after the team states how large a change matters and identifies the unit that can be sampled independently.

Suppose B improves accuracy by:

$$
0.02\text{ percentage points}
$$

with:

$$
p<10^{-8}
$$

The evidence that the difference is nonzero may be extremely strong. But perhaps deployment costs:

$$
£3\,\text{million}
$$

and the improvement has negligible value. Contrast that with:

$$
+4\text{ percentage points}
$$

with a wide interval because the test sample is small. The second effect may be practically important even though the evidence is still uncertain. A good evaluation therefore reports:

$$
\boxed{\text{effect size}}
$$

$$
\boxed{\text{confidence interval}}
$$

and, where useful:

$$
\boxed{\text{hypothesis-test result}}
$$

rather than treating a p-value as the central answer. Suppose the organization decides that switching models is worthwhile only if recall improves by at least:

$$
2\text{ percentage points}
$$

Define:

$$
\delta_{\min}=2
$$

Now the question is no longer merely:

$$
H_0:\Delta=0
$$

Instead, the decision concerns:

$$
\boxed{\Delta\ge\delta_{\min}}
$$

This distinction is powerful. A model can be statistically better than baseline while still failing to be sufficiently better to justify deployment. Suppose larger values are better and the minimum useful improvement is:

$$
\delta_{\min}=1
$$

percentage point.

### Case A

$$
\hat\Delta=2.0
$$

$$
95\%\,CI=[1.4,2.6]
$$

The entire interval lies above the required improvement:

$$
1.4>1
$$

Evidence strongly supports an improvement large enough to matter.

### Case B

$$
\hat\Delta=2.0
$$

$$
95\%\,CI=[-0.5,4.5]
$$

The point estimate looks promising, but the evidence is highly uncertain.

### Case C

$$
\hat\Delta=0.4
$$

$$
95\%\,CI=[0.2,0.6]
$$

There is strong evidence that B improves the metric, but also strong evidence that the gain is smaller than the required:

$$
1
$$

percentage point. These are three very different situations. Sometimes a new model is desirable for another reason:

* much lower latency,
* lower cost,
* smaller memory footprint,
* easier operation.

You may not need it to improve predictive quality. Instead you might require that it not worsen quality by more than an acceptable margin. Suppose:

$$
\delta=0.5\%
$$

is the maximum acceptable accuracy reduction. Then you might ask whether the evidence supports:

$$
\Delta>-0.5\%
$$

rather than:

$$
\Delta>0
$$

This is a **non-inferiority** style question. Again, the statistical hypothesis should match the actual decision. Many simple statistical procedures implicitly imagine observations like:

$$
Z_1,Z_2,\ldots,Z_n
$$

are approximately independent. But production datasets often violate this. Suppose one user generates:

$$
100
$$

rows. Those 100 observations may be highly correlated. Treating them as 100 independent users exaggerates how much information you have. Similarly:

* several page views belong to one session,
* multiple scans belong to one patient,
* many transactions belong to one merchant,
* multiple measurements belong to one site,
* several queries belong to one user.

This is called **clustered** or hierarchical data. Suppose evaluation data looks like:

$$
\text{user}
\rightarrow
\text{sessions}
\rightarrow
\text{requests}
$$

If the deployment question concerns performance across users and requests from the same user are correlated, a sensible bootstrap may resample:

$$
\boxed{\text{whole users}}
$$

not individual requests. When a user is selected, include that user's relevant rows together. Similarly:

$$
\text{hospital}
\rightarrow
\text{patients}
$$

might require resampling hospitals if hospital-level dependence is important. The core rule is:

$$
\boxed{
\text{Resample at the level corresponding to the independent sampling process you want to generalize over.}
}
$$

Imagine:

$$
100
$$

users each generate:

$$
1000
$$

events. There are:

$$
100{,}000
$$

rows. A naïve analysis might behave as if:

$$
n=100{,}000
$$

independent observations exist. But if events from each user are extremely similar, the effective information may be much closer to:

$$
100
$$

independent units than 100,000. Using individual rows can therefore produce confidence intervals that are far too narrow. The result looks highly precise only because dependence was ignored. Suppose a forecasting model predicts hourly electricity demand. Errors at:

$$
10{:}00,\ 11{:}00,\ 12{:}00
$$

are likely correlated. Randomly resampling individual hours may destroy the temporal dependence structure. Possible approaches include resampling larger temporal blocks:

$$
\boxed{\text{days, weeks, or contiguous blocks}}
$$

depending on the process. The principle remains the same:

Preserve the important dependence structure during uncertainty estimation.

## How Do Rare Groups, Repeated Comparisons, and Test Reuse Distort Certainty?
<!-- section-summary: Rare groups need targeted data, repeated comparisons need multiplicity control, and reused test sets can become adaptively overfit. -->

Real evaluation sets add rare groups, repeated experiments, and test reuse, all of which can make apparently precise evidence misleading.

Suppose:

$$
99.8\%
$$

of traffic belongs to common cases and only:

$$
0.2\%
$$

belongs to an important rare category. A purely random evaluation sample of:

$$
10{,}000
$$

examples might contain only about:

$$
20
$$

rare examples on average. That is usually far too little for precise segment-level evaluation. The overall sample can be large while uncertainty for the rare group remains enormous. If a rare segment is operationally important, deliberately collect more cases from it. Instead of accepting:

$$
20
$$

examples, perhaps construct an evaluation set containing:

$$
1{,}000
$$

rare examples. Now segment metrics can be estimated much more precisely. But there is an important distinction. If your goal is the **segment-specific metric**:

$$
M_{\text{rare}}
$$

oversampling is fine. If you want an **overall production metric**, the artificial sampling proportions must usually be accounted for with appropriate weighting. Otherwise the test-set metric describes the oversampled test population rather than real traffic. Suppose production traffic is:

$$
95\%\text{ group A}
$$

and:

$$
5\%\text{ group B}
$$

But the evaluation set intentionally uses:

$$
50\%-50\%
$$

sampling. An unweighted test-set average gives both groups equal importance. That answers:

How does performance look in an equally weighted two-group population

It does not answer:

What is expected performance under production traffic

For production-weighted performance, you might need:

$$
M
=
0.95M_A+0.05M_B
$$

Both evaluations can be useful. They simply estimate different things. Suppose certain segments are known to differ strongly. Rather than drawing a simple random sample, you can deliberately sample within strata:

$$
S_1,S_2,\ldots,S_K
$$

For example:

* geography,
* rare event type,
* customer category,
* target range.

Then calculate segment-specific estimates and appropriately combine them. This can give much more useful information than allowing common easy cases to consume nearly the entire evaluation budget. Evaluation-set design is therefore part of statistical efficiency. Suppose the baseline and one candidate are equally good. You perform one statistical test at:

$$
\alpha=0.05
$$

There is some controlled chance of a false positive under the test's assumptions. Now imagine evaluating:

$$
100
$$

candidate models and selecting whichever appears best. Even if none is truly better, some candidates may look impressive purely because of random variation. This is the **multiple comparisons** problem. More generally:

$$
\boxed{
\text{The more opportunities you give noise to look interesting, the more often it will.}
}
$$

Suppose you evaluate one model using:

* accuracy,
* precision,
* recall,
* F1,
* ROC-AUC,
* PR-AUC,

across:

* 12 segments,

at:

* 5 thresholds.

That creates many possible comparisons. If you look through all results and announce whichever one happened to improve, your evidence is much weaker than the final number suggests. This is why defining:

* primary metric,
* key segments,
* thresholds,
* release rule,

**before** examining results is valuable. Pre-specification reduces accidental cherry-picking. Suppose your team evaluates Model 1 on the test set. Then uses its failures to build Model 2. Then examines Model 2 on the same test set. Then builds Model 3 based on those results. Eventually, the "test set" is influencing model development. Even if nobody directly trains on its labels, repeated adaptive decisions leak information from the test set into the modeling process.

Conceptually:

$$
\text{test results}
\rightarrow
\text{development choices}
\rightarrow
\text{new model}
$$

The test set is no longer completely independent of model selection. This can make final performance estimates overly optimistic. A genuinely untouched final evaluation set remains valuable. Different methods address different settings. A simple conservative method is **Bonferroni correction**. If you want an overall error rate around:

$$
\alpha=0.05
$$

across:

$$
m
$$

tests, test each one against roughly:

$$
\frac{\alpha}{m}
$$

For:

$$
m=10
$$

that gives:

$$
0.005
$$

Other procedures, such as Holm's method or false-discovery-rate approaches, can be less conservative depending on the goal. But the deeper principle matters more than memorizing procedures:

$$
\boxed{
\text{Your uncertainty calculation should account for how many chances you gave yourself to discover an apparent win.}
}
$$

Suppose the true improvement is tiny:

$$
\Delta=0.0001
$$

With an enormous dataset, you may detect it with extremely strong statistical evidence. Conversely, a substantial real improvement may fail to reach a conventional significance threshold with a very small dataset. So:

$$
\boxed{
\text{“statistically significant” does not mean “large”}
}
$$

and:

$$
\boxed{
\text{“not statistically significant” does not prove “no difference”}
}
$$

A nonsignificant result may simply mean the experiment lacked enough information to distinguish plausible effects. Confidence intervals make this much easier to see. Suppose larger metric values are better. You can often classify evidence into three conceptual zones.

### Clear useful improvement

For example:

$$
95\%\,CI=[+2.0,+3.5]
$$

and the minimum meaningful improvement is:

$$
+1
$$

The plausible effects all comfortably exceed the practical threshold.

### Clearly insufficient improvement

For example:

$$
95\%\,CI=[+0.1,+0.5]
$$

The effect may be positive, but it is smaller than what matters.

### Uncertain

For example:

$$
95\%\,CI=[-1,+4]
$$

The data are compatible with meaningful harm and meaningful benefit. These distinctions are often much more useful for engineering decisions than simply dividing results into:

$$
p<0.05
$$

versus:

$$
p\ge0.05
$$

![Four confidence intervals lead to fail, inconclusive, safe-but-too-small, and pass decisions against declared product boundaries](/content-assets/articles/article-mlops-model-evaluation-statistical-uncertainty-paired-comparisons/interval-product-boundaries.png)

*The interval supports a decision only after the safety boundary and minimum useful benefit are declared on the effect scale.*

## How Should Release Rules Use Intervals, Guardrails, Power, and Segment Uncertainty?
<!-- section-summary: Release rules should combine effect intervals with practical margins, guardrails, sample power, and segment-specific uncertainty. -->

Release gates therefore need intervals and practical zones for both the main objective and the important guardrails and segments.

Suppose the main metric improves. But a safety-related error rate changes from:

$$
0.10\%
$$

to:

$$
0.13\%
$$

Is that a real regression? Rare-event guardrails often have substantial statistical uncertainty. So you might calculate an interval for:

$$
\Delta_{\text{guardrail}}
$$

as well. This leads to a release framework such as:

$$
\text{primary metric improvement sufficiently supported}
$$

and:

$$
\text{no evidence compatible with unacceptable guardrail harm}
$$

The precise decision rule should be defined before seeing candidate results whenever practical. Suppose larger is better. Let:

$$
\Delta=M_{\text{candidate}}-M_{\text{baseline}}
$$

Suppose the minimum worthwhile improvement is:

$$
\delta=0.5
$$

A conservative promotion criterion could require:

$$
CI_{\text{lower}}(\Delta)>\delta
$$

For a guardrail where regression greater than $$r$$ is unacceptable:

$$
CI_{\text{lower}}(\Delta_{\text{guardrail}})>-r
$$

The point is not that every organization must use exactly these rules. The important principle is:

$$
\boxed{
\text{Translate uncertainty into an explicit decision rule before looking at results.}
}
$$

Suppose an example is extremely easy. Both models get it right. Another example is extremely difficult. Both get it wrong. Their performances move together because they face the same examples. Thus:

$$
M_A
$$

and:

$$
M_B
$$

are correlated. If you separately calculate uncertainty for A and B and then treat them as independent, you can misestimate uncertainty in:

$$
M_B-M_A
$$

Paired methods directly estimate the difference and naturally exploit this correlation. This is why paired evaluation is generally preferable when the models can be run on the same cases. Some metrics are calculated per request rather than per row. For ranking evaluation, for example:

$$
NDCG_i(A)
$$

and:

$$
NDCG_i(B)
$$

can be computed for query $$i$$. Then define:

$$
d_i
=
NDCG_i(B)-NDCG_i(A)
$$

and bootstrap queries. For users:

$$
M_u(A),\quad M_u(B)
$$

can be paired by user. The central concept is not "pair individual rows." It is:

$$
\boxed{\text{pair the models on the same meaningful evaluation unit}}
$$

Suppose you're comparing F1 scores. F1 is:

$$
F_1
=
2\frac{PR}{P+R}
$$

It is nonlinear. You generally should not compute a per-example "F1 difference" because F1 is defined from aggregate counts. Instead, for each bootstrap sample:

1. select the paired evaluation units,
2. reconstruct A's predictions on that sample,
3. calculate $$F1_A^{(b)}$$,
4. calculate $$F1_B^{(b)}$$,
5. calculate:

$$
\Delta^{(b)}
=
F1_B^{(b)}-F1_A^{(b)}
$$

This is one reason the bootstrap is useful: the metric itself can be arbitrarily complicated. Suppose you evaluate false-negative rate for an event occurring:

$$
0.01\%
$$

of the time. A dataset containing:

$$
100{,}000
$$

rows sounds large. But expected positive cases are only:

$$
10
$$

Your uncertainty about false-negative behavior will be enormous. For metrics conditional on a rare event, the relevant effective sample size is often closer to:

$$
\text{number of relevant events}
$$

than:

$$
\text{total number of rows}
$$

This is why "our test set has a million rows" can be a misleading claim of statistical power. Suppose your release decision requires detecting a:

$$
1\%
$$

improvement. An evaluation set should ideally contain enough independent evidence to distinguish an effect of that size from noise with reasonable reliability. This is the motivation behind **power analysis** and sample-size planning. The important first-principles question is:

How much evidence do we need to reliably distinguish practically important effects from sampling variation

This should ideally be considered when constructing the evaluation, not only after observing the results. Suppose:

$$
\Delta_{\text{overall}}=+2.1
$$

But for an important segment:

$$
\Delta_{\text{segment}}=-3
$$

If the segment has only 25 examples, perhaps the interval is:

$$
[-12,+6]
$$

The point estimate looks concerning, but the evidence is extremely uncertain. You should not pretend either:

"The model definitely harms this segment."

or:

"The segment is fine because the result isn't significant."

The scientifically accurate conclusion is:

$$
\boxed{\text{The current evidence is compatible with a wide range of effects.}}
$$

That uncertainty itself is useful information. Suppose:

$$
p=0.4
$$

for a test of:

$$
H_0:\Delta=0
$$

That does not prove:

$$
\Delta=0
$$

Perhaps the confidence interval is:

$$
[-10,+12]
$$

The models could differ enormously; the evaluation just cannot tell. To establish approximate equivalence, you need an acceptable equivalence margin.

For example:

$$
-0.5<\Delta<0.5
$$

and an appropriate equivalence procedure or sufficiently tight interval supporting that claim. This distinction prevents a very common mistake:

$$
\boxed{\text{failure to detect a difference}\neq\text{evidence of equality}}
$$

Suppose production operates six months in the future. You have ten million examples from two years ago. The sampling confidence interval might be microscopic. But if user behavior has shifted considerably, the relevant uncertainty may be dominated by:

$$
\text{distribution shift}
$$

rather than:

$$
\text{finite-sample noise}
$$

The statistical interval answers:

How precisely did we measure performance on the population represented by this sample

It does not necessarily answer:

How certain are we about future deployment performance

Those are different questions.

## What Other Uncertainty Sources Must a Reproducible Comparison Record?
<!-- section-summary: Dataset bias, retraining variability, metric implementation, model identities, and evaluation versions remain distinct uncertainty and reproducibility concerns. -->

Sampling uncertainty is only one source of variation; reproducibility also requires tracking data, training, metrics, and model identities.

It helps to distinguish them.

### Sampling uncertainty

Which finite examples happened to be observed?

### Label uncertainty

How reliable is the ground truth?

### Model stochasticity

Does retraining with another seed or sample change the model?

### Population uncertainty

Will future traffic resemble the evaluation distribution

### Measurement uncertainty

Are features, outcomes, or logs measured reliably?

### Policy uncertainty

Will deployment change user behavior and therefore the data distribution A bootstrap over test examples usually addresses primarily the first category. A mature evaluation should not let one narrow statistical interval create false confidence about all the others. Suppose a neural model trained with different random seeds produces:

$$
84.0,\ 84.7,\ 83.8,\ 85.1,\ 84.3
$$

accuracy. If you compare only one trained checkpoint against baseline, your conclusion may partly reflect training randomness. Depending on the application, evaluation may need to consider variation across:

* random initialization,
* training-data samples,
* optimization randomness.

This is a distinct source of uncertainty from finite-test-set uncertainty.

Conceptually:

$$
\text{total observed variability}
$$

may include:

$$
\text{training variability}
+
\text{evaluation-sample variability}
$$

A result such as:

$$
\Delta NDCG@10=+0.012
$$

$$
95\%\,CI=[+0.004,+0.020]
$$

is not fully reproducible without context. Record things such as:

* baseline model version,
* candidate model version,
* evaluation dataset version,
* evaluation-unit definition,
* sampling procedure,
* clustering level,
* metric definition,
* segment definitions,
* weighting scheme,
* bootstrap method,
* number of bootstrap replications,
* confidence level,
* permutation procedure if used,
* random seed where relevant,
* multiple-comparison correction,
* exclusion rules,
* practical-effect threshold.

Statistical evaluation is part of the experiment and should be versioned like other parts of the modeling pipeline. Suppose a search team compares two rerankers on:

$$
5{,}000
$$

queries. For each query, it computes:

$$
NDCG@10
$$

Results:

$$
M_A=0.742
$$

$$
M_B=0.751
$$

Observed improvement:

$$
\hat\Delta=0.009
$$

or:

$$
+0.9\text{ percentage points}
$$

A paired bootstrap over queries produces:

$$
95\%\,CI=[0.003,0.015]
$$

What can we say? First:

$$
0\notin[0.003,0.015]
$$

so the evidence suggests the average NDCG difference is positive under the evaluation design. But now suppose the team has previously decided that deployment complexity is justified only by an improvement of at least:

$$
0.005
$$

The interval includes values below:

$$
0.005
$$

So while the evidence favors B over A, the evidence is not as strong that B exceeds the team's predeclared practical threshold. That distinction disappears if we report only:

"B is statistically significant."

Suppose:

$$
\Delta=+0.0002
$$

and because the dataset contains 50 million independent requests:

$$
95\%\,CI=[0.00018,0.00022]
$$

The estimate is extraordinarily precise. There is almost no sampling uncertainty about the tiny positive difference. But suppose deployment requires twice the compute cost. Then statistical uncertainty is not the remaining question. The question is whether:

$$
0.0002
$$

is worth the operational cost. Statistics can tell us:

$$
\text{the tiny effect is probably real}
$$

It cannot tell us:

$$
\text{the tiny effect is worth paying for}
$$

without a utility or cost model. Suppose:

$$
\Delta=+5\%
$$

with:

$$
95\%\,CI=[-2\%,+12\%]
$$

The observed improvement is potentially very valuable. But the dataset contains too little information to distinguish:

* meaningful harm,
* no change,
* large improvement.

The correct interpretation is not:

"The model doesn't work because the result isn't statistically significant."

It is:

$$
\boxed{\text{The estimate is promising but too imprecise to establish the direction or size reliably.}}
$$

The width of the interval is the key information. A disciplined comparison can be organized as:

### Define the population

What future users, requests, transactions, patients, or time periods do we want to generalize to?

### Define the metric

For example:

$$
MAE,\quad Recall,\quad NDCG@10
$$

### Define the effect

For example:

$$
\Delta=M_B-M_A
$$

and establish which direction means improvement.

### Define practical importance

For example:

$$
\delta_{\min}=1\%
$$

### Define the independent evaluation unit

Examples:

* user,
* query,
* session,
* site,
* day.

### Evaluate both models on the same units

Preserve pairing.

### Calculate the observed difference

$$
\hat\Delta
$$

### Quantify uncertainty

For example with a paired bootstrap.

### Examine relevant segments and guardrails

Including uncertainty where appropriate.

### Apply the predeclared decision rule

Do not move the goalposts after seeing results.

## How Do You Report a Paired Model Comparison Without Overclaiming?
<!-- section-summary: A sound report states the estimate, interval, practical threshold, sampling unit, assumptions, segment results, and unresolved uncertainty without treating no detection as equivalence. -->

The final workflow reports what the comparison supports, what it rules out, and which uncertainties remain unresolved.

For each evaluation unit $$i$$, imagine two potential losses:

$$
L_i(A)
$$

and:

$$
L_i(B)
$$

The quantity we ultimately care about might be:

$$
\Delta
=
E[L(B)-L(A)]
$$

But we observe only a finite sample:

$$
d_1,d_2,\ldots,d_n
$$

where:

$$
d_i=L_i(B)-L_i(A)
$$

Our estimate is:

$$
\hat\Delta
=
\frac1n\sum_i d_i
$$

The statistical problem is:

$$
\boxed{
\text{Use finite } \{d_i\}
\text{ to learn about population }E[d]
}
$$

Everything else—confidence intervals, bootstrap procedures, permutation tests—is machinery for reasoning about that gap between:

$$
\boxed{\text{sample}}
$$

and:

$$
\boxed{\text{population}}
$$

It is helpful not to blur them together.

### Paired bootstrap

Primarily asks:

How much might our estimated effect vary if we observed another comparable sample

It is especially useful for:

* confidence intervals,
* standard errors,
* sampling distributions.

### Paired permutation test

Primarily asks:

Under a particular no-difference/exchangeability null, how surprising is an effect this extreme

It is especially useful for:

* hypothesis testing,
* obtaining a null distribution.

They are related resampling techniques, but their logical purposes differ. Several mistakes occur repeatedly.

### Reporting only point estimates

$$
A=91.2,\quad B=91.6
$$

does not tell us whether the difference is stable.

### Treating models as independent when evaluated on the same data

This throws away the paired structure.

### Bootstrapping rows when users are the independent unit

This can make intervals falsely narrow.

### Treating $$p>0.05$$ as proof of equality

Failure to detect a difference is not evidence that there is no meaningful difference.

### Treating $$p<0.05$$ as proof of usefulness

Statistical detectability and practical value are separate.

### Ignoring multiple comparisons

Trying enough models, metrics, segments, and thresholds makes accidental wins increasingly likely.

### Using confidence intervals to excuse biased evidence

Narrow sampling uncertainty does not fix bad labels, leakage, or distribution mismatch. A comparison report might contain:

| Question             | Report                                 |
| -------------------- | -------------------------------------- |
| What population     | Defined target population/time period  |
| What metric         | Primary metric and guardrails          |
| What baseline       | Exact baseline version                 |
| What candidate      | Exact candidate version                |
| What is the effect  | $$M_B-M_A$$                            |
| How large is it     | Point estimate                         |
| How uncertain       | Confidence interval                    |
| How tested          | Paired bootstrap/permutation           |
| What is independent | User/query/session/site                |
| Rare segments       | Oversampled and appropriately weighted |
| Practical threshold | Minimum useful improvement             |
| Multiple testing    | Correction/pre-specification           |
| Segment behavior    | Effect + uncertainty by key segment    |
| Reproducibility     | Dataset/code/model versions            |

This turns "Model B scored higher" into an actual statistical comparison. A model evaluation score is not the truth. It is an estimate:

$$
\boxed{
\text{finite sample}
\rightarrow
\text{observed score}
\rightarrow
\text{uncertain estimate of population performance}
}
$$

When comparing two models, the most useful quantity is usually their paired difference:

$$
\boxed{
\Delta
=
\text{candidate performance}
-
\text{baseline performance}
}
$$

Evaluate both models on the **same meaningful units**, because this removes much irrelevant variation. Then distinguish three separate questions:

$$
\boxed{\text{How large is the observed effect?}}
$$

$$
\boxed{\text{How uncertain is that estimate?}}
$$

$$
\boxed{\text{Is an effect of that size practically important?}}
$$

A paired bootstrap helps answer:

$$
\text{"What range of effects is compatible with finite-sample variation?"}
$$

A paired permutation test helps answer:

$$
\text{"Would a difference this extreme be unusual under a suitable no-difference null?"}
$$

Neither protects against:

$$
\text{bad data}
$$

$$
\text{wrong populations}
$$

$$
\text{leakage}
$$

$$
\text{poor labels}
$$

$$
\text{metric mismatch}
$$

Neither can decide whether an effect is worth deploying without knowing its real-world value. The final evidence chain is:

$$
\boxed{
\text{Population we care about}
\rightarrow
\text{representative evaluation units}
\rightarrow
\text{paired model difference}
\rightarrow
\text{sampling uncertainty}
\rightarrow
\text{practical threshold}
\rightarrow
\text{release decision}
}
$$

The goal of statistical uncertainty is therefore **not to produce a ritual p-value**. It is to prevent us from confusing:

$$
\boxed{\text{a difference we happened to observe}}
$$

with:

$$
\boxed{\text{a difference we have good evidence will persist in the population that matters.}}
$$

![Uncertainty-aware comparison connects valid evidence, a precise estimand, pairing, resampling, product boundaries, and three release outcomes](/content-assets/articles/article-mlops-model-evaluation-statistical-uncertainty-paired-comparisons/uncertainty-release-evidence.png)

*An uncertainty-aware gate can pass, fail, or remain inconclusive, and every outcome keeps the evidence and rollback identity reproducible.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[Why Is Every Offline Score an Estimate?]{kind="recap"}
An offline score estimates performance for a target population and varies with the sampled cases even when the model stays fixed.
:::

:::expand[Why Should Candidate and Baseline Models Be Compared on the Same Examples?]{kind="recap"}
The release quantity is usually the candidate-minus-baseline difference, and paired evaluation removes variation shared by both models on the same cases.
:::

:::expand[How Do Paired Bootstrap and Permutation Tests Measure a Difference?]{kind="recap"}
A paired bootstrap estimates the distribution of metric differences, while a paired permutation test examines whether labels A and B are exchangeable under no effect.
:::

:::expand[How Do Effect Size, Non-Inferiority, and the Correct Sampling Unit Guide Decisions?]{kind="recap"}
Practical effect size and non-inferiority margins belong before significance, and resampling must preserve the genuinely independent user, query, patient, or time unit.
:::

:::expand[How Do Rare Groups, Repeated Comparisons, and Test Reuse Distort Certainty?]{kind="recap"}
Rare groups need targeted data, repeated comparisons need multiplicity control, and reused test sets can become adaptively overfit.
:::

:::expand[How Should Release Rules Use Intervals, Guardrails, Power, and Segment Uncertainty?]{kind="recap"}
Release rules should combine effect intervals with practical margins, guardrails, sample power, and segment-specific uncertainty.
:::

:::expand[What Other Uncertainty Sources Must a Reproducible Comparison Record?]{kind="recap"}
Dataset bias, retraining variability, metric implementation, model identities, and evaluation versions remain distinct uncertainty and reproducibility concerns.
:::

:::expand[How Do You Report a Paired Model Comparison Without Overclaiming?]{kind="recap"}
A sound report states the estimate, interval, practical threshold, sampling unit, assumptions, segment results, and unresolved uncertainty without treating no detection as equivalence.
:::
