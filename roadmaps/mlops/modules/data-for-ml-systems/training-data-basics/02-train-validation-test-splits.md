---
title: "Dataset Splits"
description: "Show how teams split data to develop, tune, and judge models."
overview: "Dataset splits separate model training, tuning, and final evaluation. This article explains train, validation, and test sets, then shows why production teams often use time-based splits for real product decisions."
tags: ["MLOps", "core", "datasets"]
order: 2
id: "article-mlops-data-for-ml-systems-train-validation-test-splits"
---

## Table of Contents

1. [Dataset Splits Separate Learning From Judgment](#dataset-splits-separate-learning-from-judgment)
2. [Follow One Loan-Risk Model](#follow-one-loan-risk-model)
3. [Train, Validation, And Test Sets](#train-validation-and-test-sets)
4. [Why Time Often Drives Production Splits](#why-time-often-drives-production-splits)
5. [Write The Split Contract](#write-the-split-contract)
6. [Check Segment Coverage](#check-segment-coverage)
7. [Runbook For Split Problems](#runbook-for-split-problems)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Dataset Splits Separate Learning From Judgment
<!-- section-summary: A dataset split gives the model one part of history for learning, one part for tuning, and one untouched part for final judgment. -->

**Dataset splits** divide historical examples into groups with different jobs. The training set teaches the model, the validation set helps the team choose settings and candidates, and the test set gives a final evaluation on data the team held back from tuning decisions.

This matters because a model can memorize patterns that only exist in the data it has already seen. If you judge the model on the same rows used for learning and tuning, the score can sound impressive while production performance disappoints the team. A split gives the review a fairer question: how does the model handle examples outside the data used to shape it?

The previous article defined examples, features, labels, targets, and prediction time. Splits use those same pieces. You split examples, preserve target meaning, respect label maturity, and keep the prediction timestamp at the center of the design.

## Follow One Loan-Risk Model
<!-- section-summary: The loan-risk scenario has delayed labels, changing market conditions, and borrower groups that need careful split review. -->

Imagine **Cedar Credit**, a lender that offers small-business working-capital loans. The model predicts whether a new loan application has a high risk of serious delinquency within 90 days after funding. The score helps underwriters decide which applications need extra review.

The dataset has one example per funded application. Features include business age, requested amount, industry code, bank-account cash-flow summaries, prior repayment history, and application channel. The label arrives later because the team needs to wait 90 days after funding to know whether serious delinquency happened.

This delayed label changes the split design. A loan funded last week cannot join supervised training yet because the 90-day outcome is immature. A random split across all rows can also hide time changes, such as a new marketing channel, a recession month, or a policy change that affects future applicants.

## Train, Validation, And Test Sets
<!-- section-summary: Train, validation, and test sets each serve one review purpose, so their boundaries should stay clear. -->

The **training set** is the data the algorithm directly learns from. Cedar Credit may train on applications funded from January through March after those labels mature. The model uses those examples to learn relationships between borrower signals and future delinquency.

The **validation set** supports model design choices. The team may compare feature groups, thresholds, regularization values, and model types on April applications. The validation score guides iteration, so the validation set participates in decision-making even though the model training call may avoid fitting on those rows.

The **test set** supports the final release review. Cedar Credit can hold back May applications and only evaluate on them after the team chooses the candidate. This gives reviewers a cleaner estimate of future behavior because the team avoided tuning decisions against that set.

| Split | Cedar Credit window | Main use | Who reviews it |
|---|---|---|---|
| Train | Funded Jan 1 to Mar 31, labels matured | Fit model parameters | ML engineer |
| Validation | Funded Apr 1 to Apr 30, labels matured | Choose features, thresholds, candidate | ML engineer and risk analyst |
| Test | Funded May 1 to May 31, labels matured | Final release evidence | Model review board |

Many tutorials start with a random `train_test_split`, and scikit-learn documents that utility clearly. Production teams still need to ask whether random splitting matches the product question. For Cedar Credit, the product question asks about future applications, so a time-based holdout gives the review a stronger signal.

![Cedar Credit split lanes showing loan applications divided into train, validation, and protected test sets](/content-assets/articles/article-mlops-data-for-ml-systems-train-validation-test-splits/train-validation-test-lanes.png)

*Train, validation, and test sets answer different review questions, so the held-back test lane stays protected from tuning decisions.*

## Why Time Often Drives Production Splits
<!-- section-summary: Time-based splits match production questions when labels mature later and future data can differ from past data. -->

A **time-based split** uses the prediction timestamp to separate older examples from later examples. Cedar Credit trains on older funded applications and evaluates on later funded applications. This mirrors the production pattern where the model trains from past loans and scores new applicants.

Time splits also help the team notice drift. If validation works well for April and test drops in May, the review can inspect May-specific changes: new marketing campaigns, different industries, updated underwriting policy, or a delayed bank-data provider feed. A random split would mix those changes across train and test, hiding the calendar story.

The label maturity window needs its own rule. If the target is 90-day delinquency, the team should only include applications at least 90 days old, plus any operational buffer needed for payment processing. The dataset builder can enforce that with SQL:

```sql
SELECT
  application_id,
  business_id_hash,
  funded_ts AS prediction_ts,
  requested_amount_usd,
  business_age_months,
  avg_daily_balance_90d,
  overdraft_count_90d,
  industry_code,
  application_channel,
  delinquent_90d
FROM ml_curated.loan_risk_examples
WHERE funded_ts < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 97 DAY);
```

The `97 DAY` cutoff gives the label 90 days to mature and adds a seven-day buffer for late payment events. That buffer should appear in the split contract so reviewers understand which rows were eligible.

![Time-based Cedar Credit split timeline with January through March train, April validation, May test, and a 90-day label maturity window plus seven-day buffer](/content-assets/articles/article-mlops-data-for-ml-systems-train-validation-test-splits/time-based-split-label-maturity.png)

*A time-based split uses the prediction timestamp for the train, validation, and test windows, then waits until delayed labels are mature enough to review.*

## Write The Split Contract
<!-- section-summary: A split contract makes the split windows, label maturity rule, stratification needs, and exclusions reviewable. -->

A **split contract** is a small config that records how the dataset was divided. It should travel with the training run because split choices influence every metric. When someone asks why a model passed review, the team should find the exact windows and exclusions rather than reconstructing them from notebook cells.

```yaml
dataset: cedar_credit_loan_risk_examples
target: delinquent_90d
prediction_timestamp: funded_ts
label_maturity:
  outcome_window_days: 90
  processing_buffer_days: 7
splits:
  train:
    funded_ts: "2026-01-01T00:00:00Z..2026-03-31T23:59:59Z"
  validation:
    funded_ts: "2026-04-01T00:00:00Z..2026-04-30T23:59:59Z"
  test:
    funded_ts: "2026-05-01T00:00:00Z..2026-05-31T23:59:59Z"
exclude:
  - applications_with_manual_fraud_hold
  - applications_missing_required_bank_feed
review_segments:
  - industry_code
  - application_channel
  - requested_amount_band
  - state
```

The contract names the target, timestamp, windows, exclusions, and review segments. It also helps later rebuild work because the dataset version can point to the same config. If the team changes the window, the model review should treat it as a new evaluation setup.

You can implement a simple split assignment in SQL:

```sql
SELECT
  *,
  CASE
    WHEN funded_ts >= TIMESTAMP '2026-01-01 00:00:00 UTC'
     AND funded_ts < TIMESTAMP '2026-04-01 00:00:00 UTC' THEN 'train'
    WHEN funded_ts >= TIMESTAMP '2026-04-01 00:00:00 UTC'
     AND funded_ts < TIMESTAMP '2026-05-01 00:00:00 UTC' THEN 'validation'
    WHEN funded_ts >= TIMESTAMP '2026-05-01 00:00:00 UTC'
     AND funded_ts < TIMESTAMP '2026-06-01 00:00:00 UTC' THEN 'test'
    ELSE 'excluded'
  END AS split_name
FROM ml_curated.loan_risk_examples
WHERE funded_ts < TIMESTAMP '2026-09-06 00:00:00 UTC';
```

The split column should be stored with the dataset or reproduced from a versioned query. A training script should read the split assignment instead of inventing a fresh split every time.

## Check Segment Coverage
<!-- section-summary: Segment checks confirm that each split has enough examples and label coverage for important groups. -->

A split can satisfy the date windows and still fail the review. Cedar Credit needs enough examples for important borrower groups, because one summary AUC can hide weak behavior for new businesses, high loan amounts, or a specific application channel.

Segment checks give the model review a practical view of coverage. They should report row count, positive label rate, and missing-feature rate by split and segment. Small groups may still appear in the data, yet reviewers should see when a metric lacks enough examples for a confident decision.

```sql
SELECT
  split_name,
  application_channel,
  COUNT(*) AS rows,
  AVG(delinquent_90d) AS delinquency_rate,
  COUNTIF(avg_daily_balance_90d IS NULL) / COUNT(*) AS missing_balance_rate
FROM ml_curated.loan_risk_split_examples
GROUP BY split_name, application_channel
ORDER BY application_channel, split_name;
```

A review packet can use simple thresholds:

| Check | Release threshold | Response |
|---|---|---|
| Test rows | At least 10,000 rows overall | Extend test window or reduce scope |
| Positive labels | At least 400 positives overall | Wait for more mature labels |
| Segment rows | At least 500 rows for required segments | Mark metric as directional and keep monitoring |
| Missing bank-feed rate | Within 2 percentage points across splits | Inspect ingestion or exclude affected rows |

These checks stop the team from over-reading weak evidence. If the May test set has almost no loans from a new partner channel, the release can still proceed for existing channels while the partner channel gets a separate monitoring gate.

## Runbook For Split Problems
<!-- section-summary: A split runbook tells the team what to do when labels are immature, segments are thin, or validation and test disagree. -->

Split failures should create a response path, not a vague debate. Cedar Credit can use a short runbook that names the owner, evidence, and next action. This keeps pressure from pushing an under-reviewed model into production.

| Problem | Evidence | Owner | Action |
|---|---|---|---|
| Labels are immature | Recent rows fail the maturity cutoff | Data engineering | Rebuild after the maturity date, then rerun validation |
| Test set is too small | Row or positive-label threshold fails | ML lead | Extend holdout window or narrow release scope |
| Segment missing | Required segment has weak coverage | Risk analyst | Add segment-specific monitoring and avoid broad claims |
| Validation passes and test fails | Metric gap exceeds review threshold | ML engineer | Inspect drift, data quality, and feature changes before release |

This runbook matters because split design touches both science and operations. The data team owns maturity and eligibility, the ML team owns modeling decisions, and the risk team owns whether the evidence supports the business action.

## Putting It Together
<!-- section-summary: Dataset splits turn one historical table into a fairer release review by separating learning, tuning, and final evidence. -->

Cedar Credit uses the prediction timestamp and label maturity rule to split funded loan applications into train, validation, and test sets. The train set teaches the model, the validation set guides iteration, and the test set supports the final release decision.

The split contract gives the team a reproducible setup. Segment checks then prove the splits have enough examples for the groups the business cares about. This prepares you for the next topic: leakage, where the biggest risk is letting information cross the boundary that the split was supposed to protect.

![Split contract review packet showing split windows, maturity rules, exclusions, segments, row counts, label rates, and missing rates](/content-assets/articles/article-mlops-data-for-ml-systems-train-validation-test-splits/split-contract-review-packet.png)

*The split contract and coverage checks turn a historical table into fairer release evidence instead of a one-number model score.*

## References

- [scikit-learn train_test_split documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.train_test_split.html)
- [scikit-learn TimeSeriesSplit documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)
- [scikit-learn common pitfalls: data leakage](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage)
- [dbt data tests documentation](https://docs.getdbt.com/docs/build/data-tests)
