---
title: "Regression Metrics"
description: "Evaluate numeric predictions through residuals, unit-based errors, squared errors, relative errors, quantile loss, segments, and product-aligned release gates."
overview: "Regression metrics describe how far numeric predictions miss, which direction they miss, how much large errors matter, and where the error concentrates across target ranges and production segments."
tags: ["MLOps", "core", "metrics"]
order: 3
id: "article-mlops-model-evaluation-regression-metrics"
---

## Table of Contents

1. [What Does a Regression Error Measure?](#what-does-a-regression-error-measure)
2. [How Do MAE, Median Absolute Error, MSE, and RMSE Value Large Mistakes?](#how-do-mae-median-absolute-error-mse-and-rmse-value-large-mistakes)
3. [What Do R-Squared and Explained Variance Compare Against?](#what-do-r-squared-and-explained-variance-compare-against)
4. [When Do Relative and Asymmetric Error Metrics Match the Real Cost?](#when-do-relative-and-asymmetric-error-metrics-match-the-real-cost)
5. [How Do Intervals, Residuals, Tails, and Segments Reveal Hidden Failure?](#how-do-intervals-residuals-tails-and-segments-reveal-hidden-failure)
6. [How Do Baselines, Deployment Data, and Paired Uncertainty Support Release Decisions?](#how-do-baselines-deployment-data-and-paired-uncertainty-support-release-decisions)
7. [What Should a Repeatable Regression Report and Evaluation Specification Contain?](#what-should-a-repeatable-regression-report-and-evaluation-specification-contain)
8. [How Do You Choose the Metric Closest to the Real Cost Function?](#how-do-you-choose-the-metric-closest-to-the-real-cost-function)
9. [Check Your Answers](#check-your-answers)

A delivery-time model is wrong by ten minutes on average. That statement does not reveal whether most predictions miss by ten minutes, whether a few deliveries miss by hours, or whether the model consistently promises arrivals too early. Each pattern creates a different operational problem.

A **regression metric** summarizes errors between predicted and observed numbers. MAE, RMSE, relative error, quantile loss, and R-squared answer different questions because they weight size, direction, scale, and baseline performance differently. The right evidence also includes residual distributions, tails, segments, and uncertainty.

The questions below build that evaluation from one residual to a production release rule:

1. **What Does a Regression Error Measure?**
2. **How Do MAE, Median Absolute Error, MSE, and RMSE Value Large Mistakes?**
3. **What Do R-Squared and Explained Variance Compare Against?**
4. **When Do Relative and Asymmetric Error Metrics Match the Real Cost?**
5. **How Do Intervals, Residuals, Tails, and Segments Reveal Hidden Failure?**
6. **How Do Baselines, Deployment Data, and Paired Uncertainty Support Release Decisions?**
7. **What Should a Repeatable Regression Report and Evaluation Specification Contain?**
8. **How Do You Choose the Metric Closest to the Real Cost Function?**

## What Does a Regression Error Measure?
<!-- section-summary: Regression begins with the signed residual between a numeric prediction and its target, while evaluation usually summarizes the magnitude or cost of those residuals. -->

A numeric prediction is rarely exact, so regression evaluation starts by defining the error for each example.

Regression is the problem of predicting a **number**. Examples:

$$
\text{house price}=£425{,}000
$$

$$
\text{delivery time}=37\text{ minutes}
$$

$$
\text{tomorrow's demand}=12{,}400\text{ units}
$$

$$
\text{customer lifetime value}=£780
$$

Unlike classification, where a prediction may be right or wrong, regression predictions are usually wrong by **some amount**. If the true value is:

$$
y=100
$$

then predictions of:

$$
99,\quad 90,\quad 40
$$

are all technically incorrect. But clearly they are not equally bad. Regression metrics exist to answer:

$$
\boxed{\text{How bad are the model's numerical mistakes?}}
$$

The difficulty is that "bad" can mean different things. A £10 mistake may matter differently from a £1,000 mistake. Underprediction may be more costly than overprediction. A few catastrophic errors may matter more than typical errors. So there is no universally best regression metric. Suppose we observe an input:

$$
x_i
$$

with true target:

$$
y_i
$$

and the model predicts:

$$
\hat y_i
$$

The basic quantity from which regression metrics are built is the **residual**:

$$
e_i=y_i-\hat y_i
$$

Suppose:

$$
y_i=120
$$

and:

$$
\hat y_i=100
$$

Then:

$$
e_i=120-100=20
$$

The model underpredicted by 20. If instead:

$$
\hat y_i=135
$$

then:

$$
e_i=120-135=-15
$$

The model overpredicted by 15. So the sign contains useful information:

$$
e>0
\Rightarrow
\text{underprediction}
$$

$$
e<0
\Rightarrow
\text{overprediction}
$$

and the magnitude:

$$
|e|
$$

tells us how far away the prediction was. That gives us the foundation of regression evaluation. Suppose a model makes these errors:

$$
+10,\quad -10,\quad +20,\quad -20
$$

The average residual is:

$$
\frac{10-10+20-20}{4}=0
$$

It appears perfect. But the model did not predict anything perfectly. Positive and negative errors cancelled each other. So:

$$
\frac{1}{n}\sum_i e_i
$$

is useful for detecting **systematic directional bias**, but not for measuring total error. A mean residual near zero tells us:

The model does not systematically overpredict or underpredict on average.

It does **not** tell us:

The model is accurate.

We therefore need transformations that prevent positive and negative errors from cancelling. Two natural choices are:

$$
|e|
$$

and:

$$
e^2
$$

Those lead to the two most important families of regression metrics. Mean Absolute Error is:

$$
MAE
=
\frac{1}{n}\sum_{i=1}^n|y_i-\hat y_i|
$$

Consider errors:

$$
-3,\quad 7,\quad -4,\quad 2
$$

Their absolute errors are:

$$
3,\quad7,\quad4,\quad2
$$

Therefore:

$$
MAE
=
\frac{3+7+4+2}{4}
=
4
$$

The interpretation is straightforward:

Predictions miss the true value by about 4 units on average.

If the target is measured in minutes:

$$
MAE=4\text{ minutes}
$$

If it is measured in pounds:

$$
MAE=£4
$$

If it is measured in degrees Celsius:

$$
MAE=4^\circ C
$$

This interpretability is one of MAE's greatest advantages. Suppose one prediction is wrong by:

$$
10
$$

and another by:

$$
20
$$

Under absolute error:

$$
|10|=10
$$

$$
|20|=20
$$

So doubling the error doubles the penalty. Likewise:

$$
|100|=100
$$

There is no extra punishment simply because the error became large. The cost grows linearly:

$$
L(e)=|e|
$$

Conceptually:

$$
1\text{ extra unit of error}
$$

always adds:

$$
1\text{ extra unit of loss}
$$

regardless of whether we were already wrong by 5 or by 500. So MAE implicitly says:

$$
\boxed{\text{Error cost grows approximately linearly with error magnitude.}}
$$

That assumption may or may not match the real problem.

## How Do MAE, Median Absolute Error, MSE, and RMSE Value Large Mistakes?
<!-- section-summary: Absolute, median, squared, and root-squared errors differ mainly in how strongly they weight unusually large mistakes and which central estimate they reward. -->

Averaging those residuals can cancel opposite mistakes; magnitude-based metrics avoid that cancellation in different ways.

Instead of taking the mean of absolute errors, we can take their median. Suppose absolute errors are:

$$
1,\quad2,\quad2,\quad3,\quad100
$$

The MAE is:

$$
\frac{1+2+2+3+100}{5}
=
21.6
$$

But the median absolute error is:

$$
2
$$

Those numbers tell very different stories. The MAE tells us that the large error contributes substantially to overall average loss. The median tells us:

Half of predictions have absolute error at or below 2.

This makes median absolute error robust to extreme outliers. But that robustness is a tradeoff. If the error of 100 is catastrophic, a metric that largely ignores its magnitude may be inappropriate. So:

$$
\boxed{\text{Robustness to outliers is good only when outliers should have limited influence.}}
$$

Mean Squared Error is:

$$
MSE
=
\frac{1}{n}
\sum_{i=1}^n
(y_i-\hat y_i)^2
$$

Suppose errors are:

$$
1,\quad2,\quad5,\quad10
$$

Their squared errors are:

$$
1,\quad4,\quad25,\quad100
$$

Notice what happened. The 10-unit error is only twice the size of the 5-unit error:

$$
10=2(5)
$$

but its squared penalty is four times larger:

$$
100=4(25)
$$

In general:

$$
(ke)^2=k^2e^2
$$

So doubling an error quadruples its contribution. Tripling it multiplies the contribution by nine. This is the defining property of MSE. Imagine two models.

### Model A errors

$$
5,\quad5,\quad5,\quad5
$$

### Model B errors

$$
0,\quad0,\quad0,\quad20
$$

Their MAEs are equal:

$$
MAE_A=5
$$

$$
MAE_B=5
$$

From the perspective of total absolute error, they are tied. But their MSEs differ dramatically. For A:

$$
MSE_A
=
\frac{25+25+25+25}{4}
=
25
$$

For B:

$$
MSE_B
=
\frac{0+0+0+400}{4}
=
100
$$

MSE strongly prefers Model A. Why? Because Model B occasionally makes a very large mistake. Thus MSE effectively says:

$$
\boxed{\text{Large errors deserve disproportionately large penalties.}}
$$

MSE has an interpretation problem. If the target is measured in minutes, MSE is measured in:

$$
\text{minutes}^2
$$

That is awkward. So we often take its square root:

$$
RMSE
=
\sqrt{
\frac{1}{n}
\sum_i
(y_i-\hat y_i)^2
}
$$

Now RMSE is measured in the original units. If:

$$
RMSE=12\text{ minutes}
$$

we can interpret it much more naturally. Importantly, taking the square root does **not** undo MSE's extra sensitivity to large errors. The squaring still happened before aggregation. People sometimes ask:

"Should I use MAE or RMSE?"

A better question is:

**How should the cost of a prediction error grow as the error becomes larger?**

If approximate cost is:

$$
C(e)\propto|e|
$$

then MAE naturally matches that structure. If large deviations become disproportionately harmful, something like:

$$
C(e)\propto e^2
$$

may make RMSE/MSE more appropriate. For example, suppose a delivery estimate is wrong by 5 minutes. That may be mildly inconvenient. A 30-minute error may be considerably worse. A 5-hour error might cause cascading operational failure. If harm increases faster than linearly, squared-error evaluation may better reflect what matters. There is a deeper mathematical connection. Suppose you knew nothing about a case except the distribution of possible target values. What single prediction should you make? If you minimize expected squared error:

$$
E[(Y-\hat y)^2]
$$

the optimal prediction is the conditional mean:

$$
\hat y^*=E[Y\mid X]
$$

If you minimize expected absolute error:

$$
E[|Y-\hat y|]
$$

the optimal prediction is the conditional median:

$$
\hat y^*=\operatorname{Median}(Y\mid X)
$$

This is profound. Choosing a loss function does more than determine how you **score** predictions. It determines what kind of quantity the model is encouraged to predict. Roughly:

$$
\boxed{
\text{Squared error}
\rightarrow
\text{conditional mean}
}
$$

$$
\boxed{
\text{Absolute error}
\rightarrow
\text{conditional median}
}
$$

And, as we will see:

$$
\boxed{
\text{Quantile loss}
\rightarrow
\text{conditional quantile}
}
$$

A model might be trained using MSE because it gives convenient optimization properties, while being evaluated primarily with MAE because MAE better represents business costs. That is allowed. But you should understand the mismatch. If training optimizes:

$$
\text{MSE}
$$

while deployment cares about:

$$
\text{MAE}
$$

then the optimizer is being directly rewarded for something slightly different from the final objective. Sometimes that works well. Sometimes designing training more directly around the deployment objective improves results. So always distinguish:

$$
\boxed{\text{training objective}}
$$

from:

$$
\boxed{\text{evaluation metric}}
$$

from:

$$
\boxed{\text{real-world objective}}
$$

Ideally, they are strongly aligned.

![Five absolute errors produce very different median absolute error, MAE, and RMSE summaries](/content-assets/articles/article-mlops-model-evaluation-regression-metrics/error-metric-tail-comparison.png)

*The middle error stays at three minutes, while one 38-minute miss pulls MAE to ten and RMSE to about 17.2 minutes.*

## What Do R-Squared and Explained Variance Compare Against?
<!-- section-summary: R-squared and explained variance compare errors with population variation or a baseline, but neither represents percentage accuracy. -->

Error in target units is useful, but teams also ask whether the model improves on a simple population baseline.

Another common regression metric is:

$$
R^2
$$

Rather than directly measuring errors in target units, $$R^2$$ asks something like:

How much better are our predictions than simply predicting the mean target every time

Its common definition is:

$$
R^2
=
1-
\frac{
\sum_i(y_i-\hat y_i)^2
}{
\sum_i(y_i-\bar y)^2
}
$$

where:

$$
\bar y
$$

is the mean true target. The numerator is the model's squared error. The denominator is the squared error from using the mean as a baseline. Suppose:

$$
R^2=0
$$

Then the model's squared error is roughly as large as the mean-prediction baseline. If:

$$
R^2=1
$$

then:

$$
y_i=\hat y_i
$$

for every observation, meaning perfect prediction. If:

$$
R^2=0.7
$$

we commonly say the model explains about 70% of the variance in the target relative to this baseline. And importantly:

$$
R^2<0
$$

is possible.

For example:

$$
R^2=-0.4
$$

means the model has greater squared error than simply predicting the mean on that evaluation dataset. Negative $$R^2$$ is not a mathematical bug. It can be a warning that the model is performing worse than a very simple baseline. This is a frequent misunderstanding. Suppose:

$$
R^2=0.85
$$

That does **not** mean:

"The model is 85% accurate."

Regression generally has no direct equivalent of classification accuracy. $$R^2$$ is fundamentally a **relative variance/error measure**. A model could have high $$R^2$$ and still make errors that are operationally unacceptable. For example, if house prices vary enormously, a model could explain most of that variation while still having:

$$
MAE=£50{,}000
$$

Whether £50,000 is acceptable depends on the application. So a regression report should rarely rely on $$R^2$$ alone. Consider the same model evaluated on two datasets. Dataset A contains houses priced between:

$$
£200{,}000
$$

and:

$$
£220{,}000
$$

Dataset B contains houses priced between:

$$
£100{,}000
$$

and:

$$
£5{,}000{,}000
$$

The variance of $$y$$ is vastly different. Because $$R^2$$ compares model error with target variation, its value can change substantially even if the model's absolute errors are similar. This means:

$$
R^2
$$

cannot be interpreted independently of the target distribution. Explained variance asks how much of the variability in outcomes remains unexplained by the residuals. One common form is:

$$
\text{Explained Variance}
=
1-
\frac{\operatorname{Var}(Y-\hat Y)}
{\operatorname{Var}(Y)}
$$

It resembles $$R^2$$, but there is a subtle difference. Suppose every prediction is exactly 20 units too high:

$$
\hat y=y+20
$$

The residual is always:

$$
-20
$$

so residual variance is:

$$
0
$$

The model preserves the variation perfectly—it is just systematically shifted. Explained variance can therefore look excellent even though the predictions have strong bias. $$R^2$$, because it uses squared errors directly, penalizes that offset. This illustrates why diagnostics such as mean residual are still useful.

## When Do Relative and Asymmetric Error Metrics Match the Real Cost?
<!-- section-summary: Scale-relative and asymmetric losses can better match business costs, provided zeros, asymmetry, and the intended interpretation are handled explicitly. -->

Comparing datasets or uneven costs may require relative or asymmetric errors rather than the same penalty for every unit.

Suppose:

$$
MAE=10
$$

Is that good? If you predict daily temperature in Celsius:

$$
10^\circ C
$$

is enormous. If you predict annual company revenue in millions:

$$
£10
$$

may be negligible depending on the units. MAE and RMSE inherit the scale of the target. That gives them interpretability within one problem, but it makes comparisons across differently scaled problems difficult. You should therefore interpret:

$$
MAE,\ RMSE
$$

relative to:

* the target's typical magnitude,
* a baseline,
* business tolerance,
* target variability.

A number without context tells very little. Suppose the true value is:

$$
100
$$

and prediction is:

$$
90
$$

The absolute error is:

$$
10
$$

The relative error is:

$$
\frac{10}{100}=10\%
$$

This motivates percentage-based metrics. A famous one is Mean Absolute Percentage Error:

$$
MAPE
=
\frac{100\%}{n}
\sum_i
\left|
\frac{y_i-\hat y_i}{y_i}
\right|
$$

Its attraction is obvious:

Predictions are wrong by about 8% on average.

That is often easier to communicate than an error in obscure target units. But MAPE has serious problems. Suppose the true value is:

$$
y=100
$$

and error is:

$$
10
$$

Percentage error:

$$
10\%
$$

Now suppose:

$$
y=1
$$

with the same 10-unit error. Percentage error:

$$
1000\%
$$

If:

$$
y=0.01
$$

then:

$$
\frac{10}{0.01}\times100\%
=
100{,}000\%
$$

And if:

$$
y=0
$$

then the denominator is zero and ordinary MAPE is undefined. So MAPE can behave disastrously whenever targets can be zero or close to zero. Suppose the true value is:

$$
100
$$

Predict:

$$
50
$$

The percentage error is:

$$
50\%
$$

Now imagine the true value is:

$$
50
$$

and we predict:

$$
100
$$

The absolute numerical error is still:

$$
50
$$

but percentage error is:

$$
100\%
$$

The denominator being the actual value creates asymmetrical behavior. Thus percentage metrics encode more assumptions than their intuitive appearance suggests. They should not be chosen merely because stakeholders like seeing "%". Sometimes we genuinely want to know performance relative to the scale of the problem. Instead of blindly using MAPE, alternatives include comparing against a baseline or normalizing by an appropriate scale.

For example:

$$
\frac{MAE_{\text{model}}}{MAE_{\text{baseline}}}
$$

If this equals:

$$
0.70
$$

then the model has about 70% of the baseline's absolute error. That comparison is often easier to interpret than arbitrary scale normalization. The general principle is:

$$
\boxed{\text{Normalize by something with meaningful semantics.}}
$$

MAE and MSE are symmetric. An error of:

$$
+20
$$

and:

$$
-20
$$

receive the same penalty. For MAE:

$$
|20|=|-20|=20
$$

For MSE:

$$
20^2=(-20)^2=400
$$

But many real systems are asymmetric. Consider inventory forecasting. Underpredict demand by 100 units:

$$
\rightarrow
\text{stockout}
$$

$$
\rightarrow
\text{lost sales}
$$

Overpredict demand by 100 units:

$$
\rightarrow
\text{excess inventory}
$$

$$
\rightarrow
\text{storage cost}
$$

Those two consequences may not cost the same amount. A symmetric metric cannot represent that asymmetry. Quantile regression predicts a chosen conditional quantile rather than necessarily the mean. Suppose we choose quantile:

$$
\tau=0.9
$$

The model tries to estimate the 90th percentile:

$$
Q_{0.9}(Y\mid X)
$$

Instead of asking:

What is the average likely value

we are asking roughly:

What value should about 90% of outcomes fall below

The corresponding quantile or pinball loss assigns different penalties depending on whether the prediction is above or below the actual value. For residual:

$$
u=y-\hat y
$$

one formulation is:

$$
L_\tau(u)
=
\begin{cases}
\tau u  u\ge0\\
(\tau-1)u  u<0
\end{cases}
$$

At:

$$
\tau=0.9
$$

underprediction receives much more weight than overprediction. Suppose a hospital predicts how long patients will stay. A point estimate of:

$$
4\text{ days}
$$

may describe the centre of the distribution. But administrators planning bed capacity may care more about:

$$
Q_{0.9}=8\text{ days}
$$

because they want enough capacity for most plausible outcomes. Likewise:

* logistics may need a 95th-percentile delivery time,
* cloud systems may need high-percentile demand forecasts,
* inventory planning may need an upper demand quantile,
* financial systems may care about downside quantiles.

Regression need not answer only:

$$
\boxed{\text{"What number is most typical?"}}
$$

It can answer:

$$
\boxed{\text{"What does the distribution of plausible outcomes look like?"}}
$$

## How Do Intervals, Residuals, Tails, and Segments Reveal Hidden Failure?
<!-- section-summary: Prediction intervals, residual plots, tail distributions, bias, and segments reveal structure that a single average error cannot show. -->

Even a well-chosen scalar can hide bias, tail risk, or poorly covered uncertainty, so diagnostics must examine the error distribution.

Suppose two customers both receive:

$$
\hat y=£1{,}000
$$

for future spending. For Customer A, plausible outcomes might be tightly concentrated:

$$
£950-£1{,}050
$$

For Customer B, they might range from:

$$
£100-£3{,}000
$$

The point prediction is identical. The uncertainty is not. A point-error metric such as MAE does not reveal this distinction. For systems where uncertainty matters, you may need **probabilistic regression** and evaluate prediction intervals or full predictive distributions. Suppose a model produces a nominal:

$$
90\%
$$

prediction interval:

$$
[L(x),U(x)]
$$

A basic requirement is **coverage**. Across many cases, roughly:

$$
90\%
$$

of true outcomes should fall inside the intervals. But perfect coverage alone is not enough. A model could return:

$$
[-10^{100},10^{100}]
$$

for every case and achieve almost perfect coverage. The intervals would be useless. So we need both:

$$
\boxed{\text{coverage}}
$$

and:

$$
\boxed{\text{sharpness / interval width}}
$$

A useful uncertainty model produces intervals that are **as narrow as reasonably possible while maintaining appropriate coverage**. Suppose two models both have:

$$
MAE=10
$$

Model A might make errors consistently around:

$$
8-12
$$

Model B might make:

* almost zero error 90% of the time,
* enormous errors 10% of the time.

Same MAE. Very different behavior. So regression evaluation should examine the **distribution of residuals**, not just its average. Useful questions include:

* What is the median error
* What is the 90th percentile absolute error
* What is the 99th percentile
* Are there extreme outliers
* Is the residual distribution skewed
* Are errors centred near zero

For example:

$$
P_{50}(|e|)=3
$$

$$
P_{95}(|e|)=28
$$

$$
P_{99}(|e|)=150
$$

tells us much more than:

$$
MAE=8
$$

alone. Suppose an estimated delivery time has:

$$
MAE=6\text{ minutes}
$$

This sounds excellent. But perhaps:

$$
P_{99}(|e|)=180\text{ minutes}
$$

If those rare three-hour misses destroy customer trust or break downstream logistics, the model may still be unacceptable. A release requirement might therefore be:

$$
MAE<8\text{ minutes}
$$

**and**

$$
P_{99}(|e|)<60\text{ minutes}
$$

This illustrates a general pattern:

$$
\boxed{
\text{optimize typical performance}
+
\text{constrain dangerous tail behavior}
}
$$

Recall that:

$$
e_i=y_i-\hat y_i
$$

If:

$$
E[e]\approx0
$$

the model may be approximately unbiased overall. But suppose:

$$
E[e]=+15
$$

Then, under this sign convention, the model tends to underpredict by about 15 units. This may be hidden inside MAE or RMSE. For example, two models may both have:

$$
MAE=20
$$

while one has approximately balanced positive and negative residuals and another systematically underpredicts. If one direction of error creates operational problems, the distinction matters. A good model does not merely have a low average residual. We also want to ask whether residuals have structure. Suppose errors look like this:

$$
\text{small values} \rightarrow \text{overprediction}
$$

$$
\text{large values} \rightarrow \text{underprediction}
$$

Then the model may be regressing excessively toward the centre. Or perhaps:

$$
|e|
$$

grows dramatically as:

$$
\hat y
$$

increases. This indicates **heteroscedasticity**: error variance changes across the prediction range. A single global MAE can hide such behavior. Residual plots are therefore not decorative—they can reveal assumptions that scalar metrics cannot. Suppose overall:

$$
MAE=£900
$$

But segment-level evaluation shows:

| Customer segment |    MAE |
| ---------------- | -----: |
| Small business   |   £350 |
| Medium business  |   £800 |
| Large business   | £8,200 |

The global number hides where the errors are concentrated. Similarly, you might inspect performance by:

* geography,
* product category,
* time period,
* target range,
* customer type,
* device,
* forecasting horizon,
* data quality level.

The key question is:

$$
\boxed{\text{Where does the model fail?}}
$$

not merely:

$$
\boxed{\text{What is its average error?}}
$$

Suppose:

| Segment | Typical target |  MAE |
| ------- | -------------: | ---: |
| A       |           £100 |  £10 |
| B       |       £100,000 | £100 |

Raw MAE is ten times worse for B:

$$
100>10
$$

Yet relative to target magnitude:

$$
\frac{10}{100}=10\%
$$

while:

$$
\frac{100}{100000}=0.1\%
$$

Depending on the application, B may actually have much better practical performance. So segment comparisons should consider both:

$$
\boxed{\text{absolute error}}
$$

and, when meaningful:

$$
\boxed{\text{error relative to segment scale}}
$$

![A smaller high-impact segment gets worse even though overall regression MAE improves](/content-assets/articles/article-mlops-model-evaluation-regression-metrics/residual-segment-gates.png)

*The 90,000 common cases improve enough to lower overall MAE, but the 10,000 high-impact cases fail their required segment check.*

## How Do Baselines, Deployment Data, and Paired Uncertainty Support Release Decisions?
<!-- section-summary: Release evidence should use representative deployment data, simple baselines, paired candidate comparisons, uncertainty, and cost-relevant guardrails. -->

Those diagnostics support a release only when the data represents deployment and the candidate is compared on the same cases with uncertainty.

Suppose a forecasting model achieves:

$$
MAE=14.2
$$

Is that good? We cannot know yet. Perhaps predicting yesterday's value gives:

$$
MAE=30.0
$$

Then the model adds substantial value. But perhaps simply predicting the same weekday from last week gives:

$$
MAE=11.7
$$

Then the sophisticated model is worse than a trivial heuristic. Typical regression baselines include:

* global mean,
* global median,
* previous observation,
* seasonal historical value,
* simple linear regression,
* current production model.

Every evaluation should answer:

$$
\boxed{\text{"Better than what?"}}
$$

Suppose:

$$
MAE_{\text{baseline}}=20
$$

and:

$$
MAE_{\text{model}}=15
$$

Then error reduction is:

$$
\frac{20-15}{20}
=
25\%
$$

So you can say:

The model reduces MAE by 25% relative to the baseline.

That is often more informative than reporting 15 in isolation. But even relative improvement needs a business interpretation. A 25% reduction may be enormously valuable—or irrelevant—depending on what one unit of error costs. Suppose a demand model is evaluated on ordinary weeks. It performs extremely well. Then it is deployed during:

* Christmas,
* promotions,
* supply disruptions,
* extreme weather.

Performance collapses. The problem is not necessarily the metric. The evaluation distribution did not represent production. Formally, evaluation assumes something like:

$$
P_{\text{test}}(X,Y)
\approx
P_{\text{production}}(X,Y)
$$

If that is false, a beautifully measured test metric may tell us little about deployment. For time-dependent regression, this is especially important. Training on future information and testing on the past can produce unrealistically optimistic results. Chronological splitting is often essential. For time-series regression, prediction difficulty often increases with horizon. Perhaps:

$$
MAE_{1\text{ day}}=4
$$

$$
MAE_{7\text{ days}}=11
$$

$$
MAE_{30\text{ days}}=35
$$

Reporting only an average MAE across all horizons can hide this pattern. If different horizons drive different decisions, evaluate them separately. The same principle applies whenever prediction difficulty changes systematically across operating conditions. Suppose predictions and actual values have very high correlation:

$$
\rho(Y,\hat Y)=0.99
$$

That does not guarantee low prediction error. Imagine:

$$
\hat y=2y
$$

Predictions track the true values perfectly in ordering and linear association. But every nonzero prediction is systematically scaled incorrectly. Correlation can remain extremely high. Thus correlation answers approximately:

Do the variables move together

It does not answer:

Are predictions numerically close to reality

For ordinary regression evaluation, MAE, RMSE, calibration/bias diagnostics, and related metrics are usually more directly relevant. Imagine predicting warehouse demand. Perhaps the organization determines that:

* average errors above 200 units create expensive inefficiency,
* underprediction above 500 units creates serious stockouts,
* errors for the largest warehouses are particularly costly.

A release specification could say:

$$
MAE<200
$$

$$
P_{95}(\text{underprediction})<500
$$

and:

$$
MAE_{\text{largest warehouses}}<300
$$

This is much more meaningful than:

"Deploy if $$R^2>0.9$$."

The release gate now reflects what operational failure actually means. Regression systems frequently have multiple concerns.

For example:

Minimize typical delivery-time error.

A primary metric could therefore be:

$$
MAE
$$

But you might impose guardrails:

$$
P_{99}(|e|)<90\text{ min}
$$

$$
|\text{mean residual}|<2\text{ min}
$$

$$
MAE_{\text{critical region}}<15\text{ min}
$$

This produces a clean optimization structure:

$$
\boxed{\text{minimize primary error}}
$$

subject to:

$$
\boxed{\text{limits on unacceptable failure modes}}
$$

That is often more interpretable than averaging every concern into one arbitrary composite score. Suppose:

$$
MAE_A=10.4
$$

and:

$$
MAE_B=10.2
$$

Is Model B definitely better? Not necessarily. The test dataset is itself a sample. A different sample might reverse the result.

Conceptually:

$$
\text{observed metric}
=
\text{true expected performance}
+
\text{sampling variation}
$$

You may therefore use:

* bootstrap confidence intervals,
* repeated evaluation,
* paired comparison of per-example losses,
* confidence intervals on metric differences.

For example:

$$
\Delta MAE=-0.2
$$

with a 95% confidence interval:

$$
[-0.8,+0.4]
$$

does not provide strong evidence that the models differ in expected MAE. Suppose Model A and Model B are tested on the same cases. For each case $$i$$, calculate:

$$
d_i=
L(y_i,\hat y_{B,i})
-
L(y_i,\hat y_{A,i})
$$

Then inspect the distribution of:

$$
d_i
$$

This is often more informative than separately looking at two aggregate scores. You can discover that:

* B improves almost every case slightly,
* B dramatically improves one segment,
* B wins on average only because of three extreme observations,
* B improves common cases but worsens critical rare cases.

A single difference in MAE cannot tell you this.

## What Should a Repeatable Regression Report and Evaluation Specification Contain?
<!-- section-summary: A worked example and versioned report record metric definitions, distributions, segments, baselines, uncertainty, and the production operating condition. -->

The concrete example shows how to collect those measurements into a stable report and release specification.

Suppose we predict delivery times for five packages. Actual times:

$$
y=[20,30,40,50,100]
$$

Predictions:

$$
\hat y=[22,25,38,60,70]
$$

Residuals:

$$
e=y-\hat y
$$

are:

$$
[-2,5,2,-10,30]
$$

Absolute errors:

$$
[2,5,2,10,30]
$$

Squared errors:

$$
[4,25,4,100,900]
$$

### MAE

$$
MAE
=
\frac{2+5+2+10+30}{5}
=
9.8
$$

Interpretation:

Predictions miss delivery time by 9.8 minutes on average.

### Median absolute error

Sort:

$$
[2,2,5,10,30]
$$

Median:

$$
5
$$

Interpretation:

The typical middle absolute error is only 5 minutes.

Notice how the 30-minute miss increases MAE considerably.

### MSE

$$
MSE
=
\frac{4+25+4+100+900}{5}
=
206.6
$$

### RMSE

$$
RMSE
=
\sqrt{206.6}
\approx14.37
$$

So:

$$
RMSE>MAE
$$

because the large 30-minute error receives substantial influence under squared loss. The metrics are not disagreeing. They are describing different properties of the same error distribution. Because RMSE gives more influence to large residuals, a large gap such as:

$$
MAE=5
$$

$$
RMSE=25
$$

can suggest that the model has some very large errors. If instead:

$$
MAE=5
$$

$$
RMSE=5.5
$$

errors may be more consistently sized. This is only a diagnostic hint—not a complete characterization—but comparing several metrics can reveal error structure that one number misses. Rather than asking for "the regression metric," separate the questions.

### Typical magnitude of error

Use metrics such as:

$$
MAE
$$

or median absolute error.

### Sensitivity to large errors

Use:

$$
RMSE
$$

or examine high error percentiles directly.

### Performance relative to a simple baseline

Use:

$$
R^2
$$

or explicit baseline error reduction.

### Relative-to-scale error

Use a carefully chosen relative or normalized metric when meaningful.

### Directional bias

Inspect:

$$
E[y-\hat y]
$$

and residual distributions.

### Asymmetric error costs

Use:

$$
\text{quantile loss}
$$

or, better still, a domain-specific cost function.

### Uncertainty quality

Evaluate:

* interval coverage,
* interval width,
* probabilistic scoring rules.

### Reliability across the population

Evaluate the above by important segments, target ranges, and time periods. A serious regression evaluation might look something like this:

| Evaluation question           | Measurement                |
| ----------------------------- | -------------------------- |
| Typical error                 | MAE                        |
| Typical robust error          | Median absolute error      |
| Large-error sensitivity       | RMSE                       |
| Tail risk                     | p95 / p99 absolute error   |
| Systematic bias               | Mean residual              |
| Relative baseline performance | Improvement over baseline  |
| Variance explained            | $$R^2$$                    |
| Asymmetric risk               | Quantile loss              |
| Segment reliability           | Metrics by important slice |
| Uncertainty                   | Confidence intervals       |
| Production relevance          | Domain-specific cost       |

You do not need every metric for every model. The purpose is to cover the failure modes that actually matter. Before comparing candidate models, you might write:

**Target:** delivery time in minutes
**Primary metric:** MAE
**Baseline:** current production model
**Tail guardrail:** 99th-percentile absolute error below 60 minutes
**Bias guardrail:** absolute mean residual below 2 minutes
**Segments:** region, carrier, service level, weekday/weekend
**Forecast horizons:** evaluated separately
**Test data:** latest untouched chronological period
**Uncertainty:** bootstrap confidence interval for change in MAE
**Release rule:** new model must improve MAE without violating any guardrail

This is much stronger than trying several models and deciding afterward which metric makes the preferred model look best.

## How Do You Choose the Metric Closest to the Real Cost Function?
<!-- section-summary: The strongest metric approximates the real consequence of over- and underprediction while remaining measurable, reproducible, and interpretable. -->

The final choice returns to the real cost of an error and selects the simplest metric that represents it faithfully.

Most regression metrics can be understood through a **loss function**:

$$
L(y,\hat y)
$$

For each prediction, the loss specifies how costly its error is. Then the evaluation metric aggregates loss over the population:

$$
\frac{1}{n}\sum_iL(y_i,\hat y_i)
$$

Different losses encode different beliefs. For absolute loss:

$$
L(e)=|e|
$$

we are saying:

Cost grows linearly with distance from truth.

For squared loss:

$$
L(e)=e^2
$$

we are saying:

Larger deviations should become disproportionately more expensive.

For asymmetric quantile loss:

$$
L_\tau(e)
$$

we are saying:

Errors in one direction matter more than errors in the other.

So choosing a regression metric is ultimately choosing a **mathematical representation of the consequences of being wrong**. Suppose a prediction error of $$e$$ creates actual business cost:

$$
C(e)
$$

If you can estimate that cost reliably, then the most principled evaluation is:

$$
\text{Expected Cost}
=
\frac{1}{n}
\sum_i C(y_i-\hat y_i)
$$

Maybe the cost looks approximately linear. Then MAE is a reasonable proxy. Maybe it grows sharply for large misses. Then RMSE may be closer. Maybe underprediction costs three times as much as overprediction. Then neither ordinary MAE nor MSE exactly represents the problem. This produces the first-principles chain:

$$
\boxed{
\text{Prediction error}
\rightarrow
\text{real consequence}
\rightarrow
\text{cost function}
\rightarrow
\text{evaluation metric}
}
$$

Ask yourself these questions. **Do I want the average magnitude of an error in understandable units?** Use:

$$
\boxed{MAE}
$$

**Do I care particularly strongly about occasional large errors?** Consider:

$$
\boxed{RMSE}
$$

and explicitly report tail errors. **Are extreme observations noisy and not especially important?** Consider:

$$
\boxed{\text{Median Absolute Error}}
$$

**Do I want a comparison with predicting the target mean?** Use:

$$
\boxed{R^2}
$$

alongside an absolute-error metric. **Do errors need to be expressed relative to target magnitude?** Consider a scale-relative metric—but be very careful with MAPE when targets can be small or zero. **Is underprediction more costly than overprediction, or vice versa?** Use:

$$
\boxed{\text{Quantile loss or a domain-specific asymmetric loss}}
$$

**Do decisions depend on uncertainty rather than just one estimate?** Evaluate:

$$
\boxed{\text{prediction intervals or predictive distributions}}
$$

Regression evaluation begins with one primitive quantity:

$$
\boxed{e=y-\hat y}
$$

But there is no universally correct way to turn those residuals into one score. MAE says:

$$
\boxed{\text{Every additional unit of error costs roughly the same.}}
$$

RMSE says:

$$
\boxed{\text{Large mistakes deserve disproportionately more attention.}}
$$

Median absolute error says:

$$
\boxed{\text{I care strongly about typical error and less about extreme observations.}}
$$

$$R^2$$ says:

$$
\boxed{\text{How much better are we than a simple mean-based reference?}}
$$

Percentage metrics say:

$$
\boxed{\text{Error should be interpreted relative to target magnitude.}}
$$

Quantile loss says:

$$
\boxed{\text{The direction of the error matters.}}
$$

And tail or segment metrics say:

$$
\boxed{\text{A good average is not enough if important cases fail badly.}}
$$

The most important lesson is therefore:

$$
\boxed{
\text{A regression metric is a statement about which numerical mistakes you consider costly.}
}
$$

So don't start by asking:

**"Should I use MAE, RMSE, or $$R^2$$?"**

Start with:

**"If the model is wrong by 1, 10, or 100 units—and if it is wrong above versus below the truth—what actually happens?"**

Once you understand that cost structure, metric selection becomes much less arbitrary:

$$
\boxed{
\text{real-world consequence}
\rightarrow
\text{cost of error}
\rightarrow
\text{appropriate metric}
}
$$

![Regression release evidence flows from pinned rows through error views, segment checks, uncertainty, and a scoped decision](/content-assets/articles/article-mlops-model-evaluation-regression-metrics/regression-release-packet.png)

*A regression release packet preserves the inputs, residual meaning, metric family, location of error, paired comparison, and exact population the decision supports.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Does a Regression Error Measure?]{kind="recap"}
Regression begins with the signed residual between a numeric prediction and its target, while evaluation usually summarizes the magnitude or cost of those residuals.
:::

:::expand[How Do MAE, Median Absolute Error, MSE, and RMSE Value Large Mistakes?]{kind="recap"}
Absolute, median, squared, and root-squared errors differ mainly in how strongly they weight unusually large mistakes and which central estimate they reward.
:::

:::expand[What Do R-Squared and Explained Variance Compare Against?]{kind="recap"}
R-squared and explained variance compare errors with population variation or a baseline, but neither represents percentage accuracy.
:::

:::expand[When Do Relative and Asymmetric Error Metrics Match the Real Cost?]{kind="recap"}
Scale-relative and asymmetric losses can better match business costs, provided zeros, asymmetry, and the intended interpretation are handled explicitly.
:::

:::expand[How Do Intervals, Residuals, Tails, and Segments Reveal Hidden Failure?]{kind="recap"}
Prediction intervals, residual plots, tail distributions, bias, and segments reveal structure that a single average error cannot show.
:::

:::expand[How Do Baselines, Deployment Data, and Paired Uncertainty Support Release Decisions?]{kind="recap"}
Release evidence should use representative deployment data, simple baselines, paired candidate comparisons, uncertainty, and cost-relevant guardrails.
:::

:::expand[What Should a Repeatable Regression Report and Evaluation Specification Contain?]{kind="recap"}
A worked example and versioned report record metric definitions, distributions, segments, baselines, uncertainty, and the production operating condition.
:::

:::expand[How Do You Choose the Metric Closest to the Real Cost Function?]{kind="recap"}
The strongest metric approximates the real consequence of over- and underprediction while remaining measurable, reproducible, and interpretable.
:::
