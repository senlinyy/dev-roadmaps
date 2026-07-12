---
title: "Explainability"
description: "Introduce practical explanations for model behavior, including global drivers, local prediction reasons, SHAP, permutation importance, reports, and review evidence."
overview: "Explainability helps a team understand and communicate why a model behaves the way it does. This article follows a loan pre-approval model through global drivers, local prediction reasons, SHAP values, permutation importance, explanation reports, reason-code review, and limits that reviewers should understand before release."
tags: ["MLOps", "advanced", "risk"]
order: 2
id: "article-mlops-governance-and-responsible-ai-explainability-basics"
---

## Table of Contents

1. [Explainability Answers Why A Model Behaves That Way](#explainability-answers-why-a-model-behaves-that-way)
2. [Follow One Loan Pre-Approval Model](#follow-one-loan-pre-approval-model)
3. [Global And Local Explanations](#global-and-local-explanations)
4. [Permutation Importance For Global Checks](#permutation-importance-for-global-checks)
5. [SHAP For Local Prediction Reasons](#shap-for-local-prediction-reasons)
6. [Turn Explanations Into A Review Report](#turn-explanations-into-a-review-report)
7. [Reason Codes And Human Review](#reason-codes-and-human-review)
8. [Practical Checks And Common Mistakes](#practical-checks-and-common-mistakes)
9. [Interview-Ready Understanding](#interview-ready-understanding)
10. [References](#references)

## Explainability Answers Why A Model Behaves That Way
<!-- section-summary: Explainability gives people evidence about which inputs drive a model overall and which inputs influenced one specific prediction. -->

**Explainability** is the work of making model behavior understandable enough for the people who build, review, operate, or are affected by the system. In practical MLOps, it usually answers two questions. Which features drive the model overall? Which features influenced this one prediction?

Those questions matter because production models rarely live alone. A model may affect an approval workflow, a care queue, a hiring screen, a fraud queue, or a support routing decision. The team needs evidence that reviewers can inspect before release and operators can use during incidents. A high validation score is useful, yet it leaves important questions open. The score says the model predicted well on a test set. Explainability helps the team see which patterns the model used to get there.

Explainability also improves debugging. If a loan model relies heavily on a field that changed last week, the team can catch the issue before approval rates move strangely. If a local explanation says a pre-approval was reduced by a stale income field, support can route the case to data correction. The explanation is evidence, and evidence helps the team act with less guessing.

## Follow One Loan Pre-Approval Model
<!-- section-summary: The running scenario follows a loan pre-approval model where explanations need to support review, debugging, and customer-facing decision reasons. -->

Imagine **Rivergate Credit Union**. Its website offers a soft pre-approval flow for personal loans. A member enters basic financial information, and the model returns one of three outcomes: likely pre-approved, needs manual review, or unlikely pre-approved. The decision still flows through the credit union's policy and review process before any final offer.

The model is called `personal_loan_preapproval`. It uses application fields, credit bureau summaries, account history, income bands, debt-to-income ratio, recent delinquencies, requested amount, employment length band, and product eligibility rules. Some inputs are highly sensitive from a business and customer-trust point of view. The team needs to know which features drive the model, whether those drivers make sense, and whether local explanations can support internal review and compliant customer communication.

The explainability work connects these artifacts:

| Artifact | Rivergate example | Main question |
|---|---|---|
| Feature list | `debt_to_income_ratio`, `recent_delinquency_count`, `income_band` | Which inputs can the model use? |
| Global explanation | Permutation importance and SHAP summary | Which inputs matter across many applications? |
| Local explanation | Top feature contributions for one application | Why did this one score move up or down? |
| Review report | HTML/PDF report attached to release packet | Can risk and product reviewers inspect behavior? |
| Reason code map | Reviewed mapping from model factors to customer reasons | Can explanations be converted into approved language? |
| Monitoring check | Explanation drift over time | Did model behavior change after release? |

The rest of the article walks through those artifacts in the order a real release review would use them.

## Global And Local Explanations
<!-- section-summary: Global explanations summarize behavior across a dataset, while local explanations describe one prediction. Both views are needed for a high-impact model. -->

A **global explanation** describes model behavior across many examples. It helps the team answer questions like, "Which features matter most across the validation set?" and "Are the strongest drivers aligned with credit policy and domain expectations?" For Rivergate, global explanations should show that debt burden, recent repayment behavior, verified income band, and requested amount are important. If a browser type or application time zone appears near the top, reviewers should pause and investigate.

A **local explanation** describes one prediction. It helps the team answer questions like, "For this application, which factors pushed the score toward manual review?" Local explanations support case review, support workflows, and internal audit. In credit workflows, legal and compliance partners may also need explanation evidence for adverse action notices or similar customer-facing communication. The CFPB has stated that creditors using complex algorithms must still provide specific principal reasons for adverse actions, so generic messages deserve extra review.

The two views work together. A global report can say `recent_delinquency_count` is one of the strongest drivers. A local explanation can say one applicant's score moved down mainly because of two recent delinquencies and high debt-to-income ratio. Global tells the team what the model tends to use. Local tells the team what happened for a specific row.

![Rivergate global and local explanations](/content-assets/articles/article-mlops-governance-and-responsible-ai-explainability-basics/rivergate-global-local-explanations.png)

*Rivergate uses global explanations to review behavior across many applications and local explanations to inspect one pre-approval case.*

Rivergate records the expected explanation set in the release packet:

```yaml
explainability_packet:
  model_id: personal_loan_preapproval
  model_version: "2026-07-03-candidate"
  validation_slice: loans_preapproval_validation_2026_q2
  required_artifacts:
    - permutation_importance_table
    - shap_summary_plot
    - local_explanation_samples
    - reason_code_mapping
    - explanation_limitations
  reviewer_groups:
    - credit-risk
    - compliance
    - ml-platform
    - product
```

This small file helps automation and reviewers. A release gate can check that all artifacts exist, and the review meeting can focus on what the explanations show.

## Permutation Importance For Global Checks
<!-- section-summary: Permutation importance estimates how much model performance drops when one feature is shuffled on a validation set. -->

**Permutation importance** is a model inspection method that checks how much a fitted model depends on each feature. The idea is direct. First, measure model performance on a validation set. Then shuffle one feature column, run predictions again, and measure how much the score drops. A larger drop means the model relied more on that feature for performance on that dataset.

This method is useful because it can work with many model types. It also forces you to look at a holdout or validation set, which is where explanations should live for release review. Feature importance from inside a model can be quick, yet it can overstate some kinds of features. The scikit-learn inspection guide explains permutation importance as a model inspection technique and documents the `permutation_importance` API.

Rivergate runs permutation importance on a validation slice:

```python
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.metrics import roc_auc_score

feature_names = [
    "debt_to_income_ratio",
    "income_band_encoded",
    "requested_amount",
    "credit_history_months",
    "recent_delinquency_count",
    "open_credit_lines",
    "employment_length_band_encoded",
    "checking_balance_band_encoded",
]

baseline_auc = roc_auc_score(y_valid, model.predict_proba(X_valid)[:, 1])

result = permutation_importance(
    model,
    X_valid,
    y_valid,
    scoring="roc_auc",
    n_repeats=20,
    random_state=42,
    n_jobs=-1,
)

importance = (
    pd.DataFrame(
        {
            "feature": feature_names,
            "mean_auc_drop": result.importances_mean,
            "std_auc_drop": result.importances_std,
        }
    )
    .sort_values("mean_auc_drop", ascending=False)
)

print("baseline_auc", round(baseline_auc, 4))
print(importance.head(8))
```

The output might look like this:

| Feature | Mean AUC drop | Review note |
|---|---:|---|
| `debt_to_income_ratio` | 0.041 | Expected policy driver |
| `recent_delinquency_count` | 0.028 | Expected repayment behavior driver |
| `requested_amount` | 0.019 | Expected affordability driver |
| `income_band_encoded` | 0.015 | Needs reason-code mapping review |
| `credit_history_months` | 0.009 | Expected credit-file maturity driver |
| `checking_balance_band_encoded` | 0.006 | Review for data freshness and customer communication |

The review note column is important. The explanation table should lead to decisions. Expected drivers can pass. Unexpected drivers need investigation. Sensitive or hard-to-explain drivers may need policy review, feature removal, monotonic constraints, documentation, or manual review routing.

Permutation importance has limits. Correlated features can share importance in confusing ways. Shuffling one encoded feature can break relationships created during preprocessing. A low importance value can still matter for a small segment. Those limits should appear in the report so reviewers avoid treating the table as absolute truth.

## SHAP For Local Prediction Reasons
<!-- section-summary: SHAP values explain a prediction by estimating how each feature contributed relative to a baseline prediction. -->

**SHAP** is a popular explanation library built around Shapley values. In everyday terms, a SHAP explanation starts with a baseline prediction and estimates how each feature value moved the prediction for one row. For a loan pre-approval case, that gives reviewers a ranked list of factors that raised or lowered the model score.

SHAP has different explainers for different model types. The current primary interface is `shap.Explainer`, which chooses an appropriate explainer when it can. Rivergate uses a tree-based model, so SHAP can produce efficient explanations after the feature preprocessing step.

```python
import pandas as pd
import shap

background = shap.sample(X_train_processed, 500, random_state=42)
explainer = shap.Explainer(model, background, feature_names=feature_names)

sample = X_valid_processed.iloc[[17]]
shap_values = explainer(sample)

local_reasons = (
    pd.DataFrame(
        {
            "feature": feature_names,
            "feature_value": sample.iloc[0].to_list(),
            "shap_value": shap_values.values[0],
        }
    )
    .assign(abs_value=lambda df: df["shap_value"].abs())
    .sort_values("abs_value", ascending=False)
    .head(6)
)

print(local_reasons[["feature", "feature_value", "shap_value"]])
```

A local explanation for one application might read like this:

| Feature | Value | Direction | Internal explanation |
|---|---:|---|---|
| `debt_to_income_ratio` | 0.47 | lowers score | Debt obligations are high for stated income band |
| `recent_delinquency_count` | 2 | lowers score | Recent repayment events increase risk |
| `requested_amount` | 18000 | lowers score | Requested amount is high relative to account profile |
| `credit_history_months` | 96 | raises score | Longer history supports stronger confidence |
| `checking_balance_band_encoded` | 3 | raises score | Account balance band supports affordability |

![Rivergate local explanation to reason code flow](/content-assets/articles/article-mlops-governance-and-responsible-ai-explainability-basics/rivergate-local-reason-code-flow.png)

*The local explanation flow keeps raw SHAP factors separate from reviewed reason codes and the manual review queue.*

This table is useful for internal review because it links the model score to concrete feature values. It still needs translation before a customer sees anything. The customer-facing language should come from an approved reason-code map instead of raw feature names or SHAP values. A feature like `checking_balance_band_encoded` might map to "available deposit account balance was below the reviewed threshold" only after compliance approves that language for the product and jurisdiction.

Local explanations need guardrails. They can help review a prediction, yet they are approximations of model behavior. They can also expose sensitive inputs if the team writes raw values into reports. Rivergate stores local samples with redacted identifiers and reviewed feature names.

## Turn Explanations Into A Review Report
<!-- section-summary: An explanation report packages global drivers, local samples, subgroup checks, limitations, and review decisions so a release can be audited later. -->

An **explanation report** is the release artifact that connects explanation methods to the model decision. It should tell reviewers what data slice was used, which model version was explained, which features were strongest, which local samples were reviewed, which limitations apply, and which actions were taken.

Rivergate's report uses this structure:

| Report section | What it contains | Release decision it supports |
|---|---|---|
| Model and data | Model version, validation slice, feature list, preprocessing version | Confirms the report explains the candidate release |
| Global drivers | Permutation table and SHAP summary | Confirms top features align with policy expectations |
| Local samples | Approved, manual review, and declined-like examples | Shows how one prediction can be interpreted |
| Segment review | Explanation patterns by income band, age band where allowed, channel, product | Checks behavior across important groups |
| Reason-code map | Internal factors mapped to approved reason language | Supports review and customer communication |
| Limitations | Correlation, approximation, missing data, feature encoding caveats | Prevents overclaiming |
| Actions | Feature removals, thresholds, manual review routing, accepted risks | Records what changed before approval |

The report can include a small evidence block inside the release packet:

```yaml
explainability_evidence:
  model_id: personal_loan_preapproval
  model_version: "2026-07-03-candidate"
  validation_dataset: rivergate_preapproval_validation_2026_q2
  generated_at: "2026-07-04T09:30:00Z"
  global_methods:
    - permutation_importance
    - shap_summary
  local_samples_reviewed: 48
  top_global_drivers:
    - debt_to_income_ratio
    - recent_delinquency_count
    - requested_amount
    - income_band_encoded
  removed_features:
    - application_submit_hour
  open_limitations:
    - correlated affordability features share attribution
    - income band explanations require approved customer language
  reviewer_decision: approved_for_staging
```

The `removed_features` line shows why explanations are operational release evidence. In Rivergate's review, `application_submit_hour` carried channel and work-schedule patterns that lacked an approved justification for pre-approval. The feature left the model before staging.

![Rivergate explanation report](/content-assets/articles/article-mlops-governance-and-responsible-ai-explainability-basics/rivergate-explanation-report.png)

*The explanation report ties validation data, global drivers, local samples, limitations, reason codes, and removed features to the release decision.*

## Reason Codes And Human Review
<!-- section-summary: Reason codes turn model factors into reviewed language, while human review handles cases where the explanation or input quality needs judgment. -->

A **reason code** is an approved explanation category that can be shown to a reviewer or customer-facing system. In credit workflows, reason codes need careful legal and compliance review. The engineering task is to provide accurate, traceable evidence that maps model factors to those reviewed categories.

Rivergate keeps the mapping separate from model code:

```yaml
reason_code_map:
  debt_to_income_ratio:
    internal_label: high debt-to-income ratio
    customer_reason: Debt obligations are high compared with verified income.
    allowed_for_customer_notice: true
  recent_delinquency_count:
    internal_label: recent repayment events
    customer_reason: Recent repayment history affected the pre-approval result.
    allowed_for_customer_notice: true
  requested_amount:
    internal_label: requested loan amount
    customer_reason: Requested loan amount is high compared with the current profile.
    allowed_for_customer_notice: true
  checking_balance_band_encoded:
    internal_label: deposit account balance band
    customer_reason: Deposit account information requires manual review.
    allowed_for_customer_notice: false
```

This mapping protects the team from dumping raw feature names into a notice. It also gives reviewers a way to reject weak language. A reason such as "model score too low" is poor evidence because it tells the person nothing about the main factors. A reviewed reason should point to the principal factors the model used, in language the organization has approved.

Human review is the safety valve for cases where explanations need judgment. Rivergate routes an application to manual review when the top local factors include stale data, conflicting income evidence, missing bureau fields, or a feature that lacks approved reason language. The review queue stores the model version, local explanation, reason-code candidates, and data-quality flags.

```json
{
  "case_id": "manual-review-20260704-0041",
  "model_id": "personal_loan_preapproval",
  "model_version": "2026-07-03-candidate",
  "prediction_bucket": "needs_manual_review",
  "top_internal_factors": [
    "debt_to_income_ratio",
    "checking_balance_band_encoded",
    "requested_amount"
  ],
  "data_quality_flags": ["income_document_pending"],
  "reason_code_candidates": ["DTI_HIGH", "REQUESTED_AMOUNT_HIGH"],
  "review_owner": "credit-operations"
}
```

This record gives the human reviewer context without asking them to reverse-engineer the model. It also gives the audit trail a durable explanation of why the case entered manual review.

## Practical Checks And Common Mistakes
<!-- section-summary: Explanation checks should verify artifact quality, feature reasonableness, local sample coverage, reason-code mapping, and monitoring before release. -->

Before Rivergate releases the model, the team runs explanation checks that can block staging or production.

| Check | Release-blocking condition |
|---|---|
| Artifact completeness | Permutation table, SHAP report, local samples, and limitations section are missing |
| Feature reasonableness | Top driver lacks a documented product or policy reason |
| Data leakage clue | Explanation highlights a field created after the decision time |
| Reason-code coverage | A top local driver lacks approved reason language or routing rule |
| Sensitive proxy review | A driver strongly tracks a protected or sensitive attribute without review |
| Sample coverage | Local examples skip manual-review and low-score cases |
| Monitoring plan | No plan exists to watch explanation drift or top-driver changes |

Common mistakes appear quickly once you know what to watch for. Teams attach a SHAP plot with no explanation of data slice or model version. They use training data for explanations instead of validation data. They report global feature importance and skip local examples. They turn raw feature names into customer language. They hide the limitations section because it feels uncomfortable. They let explanations live in a notebook instead of a release artifact.

The better habit is simple and repeatable. Build explanations on the reviewed validation slice, package them with the release packet, map local factors to approved reason codes, and monitor whether explanation patterns change after deployment.

## Interview-Ready Understanding
<!-- section-summary: A strong answer explains global versus local explanations, names practical methods, and ties explanation artifacts to release review and operations. -->

If someone asks you about explainability in MLOps, start with the two questions. Global explanations show which inputs drive behavior across a dataset. Local explanations show which inputs influenced one prediction. Both views need method names, data slices, version IDs, limitations, and review decisions.

For Rivergate, permutation importance checks global model dependence on validation data. SHAP helps explain individual pre-approval cases. The explanation report packages top drivers, local samples, reason-code mappings, limitations, and actions. Reviewers use that report to approve, reject, or change the release. Operators use the same evidence when a case is disputed or when model behavior changes after deployment.

That is the practical point. Explainability is useful when it creates reviewable evidence and operational action instead of only creating a pretty chart.

## References

- [SHAP documentation: shap.Explainer](https://shap.readthedocs.io/en/latest/generated/shap.Explainer.html)
- [scikit-learn: Permutation feature importance](https://scikit-learn.org/stable/modules/permutation_importance.html)
- [scikit-learn API: permutation_importance](https://scikit-learn.org/stable/modules/generated/sklearn.inspection.permutation_importance.html)
- [scikit-learn: ROC AUC score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.roc_auc_score.html)
- [CFPB Circular 2022-03: Adverse action notification requirements in connection with credit decisions based on complex algorithms](https://www.consumerfinance.gov/compliance/circulars/circular-2022-03-adverse-action-notification-requirements-in-connection-with-credit-decisions-based-on-complex-algorithms/)
- [TensorFlow Model Card Toolkit guide](https://www.tensorflow.org/responsible_ai/model_card_toolkit/guide)
- [Google Research: Model Cards for Model Reporting](https://research.google/pubs/model-cards-for-model-reporting/)
