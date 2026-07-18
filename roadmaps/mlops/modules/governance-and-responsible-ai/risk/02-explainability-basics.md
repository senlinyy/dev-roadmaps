---
title: "Explainability"
description: "Choose explanations from the audience, decision, scope, method family, and validity requirements of the model use."
overview: "Explainability provides evidence about model behaviour. This article develops a framework based on audience and question, then covers global and local scope, intrinsic and post-hoc methods, validity tests, reason codes, and operations."
tags: ["MLOps", "advanced", "risk"]
order: 2
id: "article-mlops-governance-and-responsible-ai-explainability-basics"
---

## Explainability Starts With A Question
<!-- section-summary: An explanation is useful only when it answers a defined question for a person who can act on it. -->

**Explainability** is the work of producing understandable evidence about how a model behaves or why it produced a result. The word covers many different questions, so selecting a technique before naming the question often produces an attractive chart that nobody can use.

Four audiences commonly need different explanations:

- A **developer** asks which patterns the model learned and where it may be wrong.
- A **validator or risk reviewer** asks whether the model relies on acceptable, stable, and documented factors.
- An **operator** asks why production behaviour changed and which layer to investigate.
- An **affected person or case reviewer** asks for the principal reasons behind one decision and what correction or appeal path exists.

These questions lead to different scopes, methods, evidence, and language. A global feature-importance plot may help a model developer and still fail to provide a specific reason for one person's outcome. A local attribution may describe one prediction and still fail to prove that changing the feature would change the real-world outcome.

The explainability framework therefore follows this order: audience and decision, explanation scope, method family, method selection, validity testing, communication, and operational use.

## Scope Separates Global Behaviour From One Prediction
<!-- section-summary: Global explanations summarize behaviour across data, while local explanations describe a particular prediction or case. -->

A **global explanation** describes patterns across many examples. It can identify influential features, important interactions, common decision regions, and segments where behaviour differs. Teams use it during model development, release review, and drift investigation.

A **local explanation** describes one prediction. It may show feature contributions, a similar training example, a counterfactual change, a decision path, or a policy reason. Teams use it for case review, user communication, and incident analysis.

The scopes support each other without being interchangeable. A feature can rank highly globally but matter little for one case. A local factor can dominate one prediction while having small average importance. Review should therefore connect population-level behaviour with representative and high-risk local examples.

Scope also includes the data slice. An explanation for the complete validation set may hide different drivers for regions, channels, language groups, or product types. The report should name the model version, preprocessing version, dataset, time window, segments, and explanation configuration.

## Method Families Answer Different Kinds Of Why
<!-- section-summary: Intrinsic, attribution, example-based, and counterfactual explanations expose different aspects of model behaviour. -->

An **intrinsically interpretable model** exposes its structure directly. A short decision tree, sparse linear model, monotonic scorecard, or generalized additive model can allow reviewers to inspect the relationship between inputs and output. This can be preferable when stakes are high and a simpler model meets the quality requirement.

**Feature-attribution methods** estimate how inputs contributed to model behaviour. Permutation importance measures how performance changes when a feature is shuffled across a dataset. SHAP methods estimate contributions relative to a baseline under stated assumptions. These methods are useful, while explainability is broader than feature attribution.

**Example-based explanations** show similar or influential examples, prototypes, or criticisms. They can help a reviewer see which historical patterns support a prediction. Privacy, representativeness, and training-data errors require careful handling.

**Counterfactual explanations** describe a nearby input that would produce a different model result. They can support recourse discussions when the suggested change is actionable, lawful, and causally sensible. A mathematical counterfactual may recommend an impossible or inappropriate change, so feasibility and domain review matter.

**Rule and path explanations** show decision-tree paths, extracted rules, policy evaluations, or workflow transitions. They are especially useful when the final product decision combines a model score with deterministic policy.

No family provides a complete account of “why.” A production explanation often combines several: global attribution for release review, local attribution for case inspection, policy reasons for communication, and counterfactual analysis for recourse research.

## Choose A Method From The Model, Data, And Decision
<!-- section-summary: Method selection follows the explanation question, model family, feature relationships, audience, and consequence of being wrong. -->

Begin with the action the explanation should support. A developer debugging leakage may need global importance and feature-time analysis. A risk reviewer may need monotonic relationships, segment comparisons, and stability. A case reviewer may need principal factors, data-quality flags, and policy results. A customer-facing reason may need legally reviewed language grounded in the actual decision process.

Then consider the model and data. Tree-specific methods can be efficient for tree ensembles. Model-agnostic methods can compare many model families but may require more computation or stronger approximations. Correlated features complicate attribution because importance can be shared or reassigned among related inputs. High-dimensional embeddings may not map naturally to human concepts.

The consequence of a misleading explanation sets the assurance bar. A low-risk recommendation-debugging view can tolerate exploration. An explanation used in lending, employment, healthcare, or access decisions needs stronger validation, governance, and domain or legal review.

Method selection should also ask whether the model itself is too complex for the use. If a simpler interpretable model performs adequately and the explanation requirement is central, changing the model family may provide more reliable understanding than layering post-hoc methods on an opaque model.

## Global Attribution Reveals Model Dependence
<!-- section-summary: Global attribution methods can expose influential features and suspicious reliance when applied to reviewed data. -->

Permutation importance measures a fitted model on a validation set, shuffles one feature, and measures the performance drop. A larger drop suggests that the model depends more on that feature for that metric and data distribution.

```python
from sklearn.inspection import permutation_importance

result = permutation_importance(
    model,
    X_valid,
    y_valid,
    scoring="roc_auc",
    n_repeats=20,
    random_state=42,
    n_jobs=-1,
)
```

This is useful for discovering an unexpected browser field, post-decision variable, unstable source, or feature whose importance conflicts with product policy. It should run on reviewed holdout data rather than only on training rows.

Permutation importance has important limits. Correlated features can share or mask importance. Shuffling may create unrealistic combinations. A feature with low global importance may matter strongly for one segment. The chosen metric determines what “important” means. Reports should include uncertainty across repeats and relevant segments rather than one ranked list.

Partial dependence or accumulated local effects can add information about the direction and shape of a feature relationship. They still describe model behaviour under assumptions and should not be presented as causal effects.

## Local Attribution Describes One Prediction
<!-- section-summary: Local attribution estimates which feature values moved a prediction relative to a defined baseline. -->

SHAP is a widely used family of feature-attribution methods based on Shapley values. A local SHAP explanation compares a prediction with a baseline and allocates the difference among features according to the explainer's assumptions.

```python
import shap

background = shap.sample(X_train_processed, 500, random_state=42)
explainer = shap.Explainer(
    model.predict_proba,
    background,
    feature_names=feature_names,
)
values = explainer(X_valid_processed.iloc[[17]])
# For a binary classifier, values.values[0, :, 1] explains class 1.
```

The result can show that debt-to-income ratio moved a pre-approval score down while longer credit history moved it up. This supports internal case review when the feature values, preprocessing, baseline, and model version are recorded.

The contribution is an explanation of model output, not proof of real-world causation. Changing one feature may be impossible, may change correlated features, or may not cause the outcome to change outside the model. Background-data choice can alter SHAP values. Different explainers have different assumptions and computational properties.

Local explanations should therefore include the method, baseline or background data, transformed and human-readable feature names, model and preprocessing versions, and any data-quality flags. Raw values and sensitive attributes require access controls.

## Counterfactual And Example-Based Explanations Need Feasibility
<!-- section-summary: Counterfactuals and examples can make explanations concrete, while domain constraints determine whether they are meaningful. -->

A counterfactual might say that a lower requested amount would move an application into manual review. This can be useful if the feature is actionable and the product genuinely supports the alternative. It is misleading if it recommends changing age, hiding debt, or modifying one field while dependent fields remain impossible.

Counterfactual generation needs immutable-feature constraints, ranges, causal or business relationships, action cost, and policy rules. Several diverse feasible counterfactuals are often more honest than one apparently precise instruction.

Example-based methods need similar caution. A “similar approved application” may expose personal data or rely on a distance measure that ignores important meaning. Use governed prototypes or anonymized examples, document the similarity function, and test whether examples remain representative across segments.

These methods work best when they answer a concrete reviewer or user question. They should not be added merely to make an explanation dashboard look comprehensive.

## Validity Tests Determine Whether An Explanation Deserves Trust
<!-- section-summary: Fidelity, stability, sensitivity, plausibility, and uncertainty tests reveal whether an explanation supports its intended use. -->

**Fidelity** asks whether the explanation accurately reflects the model behaviour it claims to summarize. A surrogate explanation should reproduce the model sufficiently well in the region being explained. Low fidelity means the explanation describes the surrogate more than the original model.

**Stability** asks whether small reasonable changes in data, background sample, seed, or model version cause large explanation changes. Instability may reflect a fragile model, correlated inputs, or a sensitive method. Reviewers need to know when principal reasons are not robust.

**Sensitivity** asks whether changing an important input changes the explanation appropriately and whether irrelevant changes leave it mostly stable. **Plausibility** asks whether the explanation follows domain constraints. **Uncertainty** reports variation across samples, repeats, or plausible methods rather than presenting one ranking as exact truth.

Explanation tests should include segments and nearby cases. Two nearly identical applications receiving different principal reasons deserve investigation. A global driver that reverses direction across important groups may need a more specific model, additional constraints, or clearer limitation.

A stability test can repeat the explanation with several reviewed background samples and measure whether the principal factors keep changing:

```python
import numpy as np
import shap

backgrounds = [
    X_train_processed.sample(500, random_state=seed)
    for seed in [11, 29, 47, 83, 101]
]
case = X_valid_processed.loc[["application-18422"]]

rankings = []
for background in backgrounds:
    explanation = shap.Explainer(
        model.predict_proba,
        background,
        feature_names=feature_names,
    )(case)
    class_one_contributions = explanation.values[0, :, 1]
    order = np.argsort(np.abs(class_one_contributions))[::-1]
    rankings.append([feature_names[index] for index in order[:3]])

principal_reason_agreement = sum(
    ranking[0] == rankings[0][0] for ranking in rankings
) / len(rankings)
assert principal_reason_agreement >= 0.8, rankings
```

The backgrounds represent plausible choices of reference data rather than five arbitrary production populations. The test asks a narrow question: whether the top internal reason for one case remains stable under those choices. It should also run across a reviewed sample of cases and important segments.

If the rankings alternate between `debt_to_income` and `requested_amount` because those inputs are strongly related, the interface should avoid claiming one uniquely determined reason. The team can group the related factors, use an intrinsically interpretable decision component, route the case to a reviewer, or prevent this method from supporting customer communication. Re-running the test after a model, preprocessing, or background-data change verifies whether the approved explanation behaviour still holds.

Explanations also need leakage and proxy review. A highly influential post-outcome field signals leakage. A seemingly harmless feature may proxy a sensitive attribute. Attribution cannot settle the fairness question. It can direct deeper evaluation.

## Reason Codes Translate Evidence Into Governed Language
<!-- section-summary: Reason codes connect internal model and policy evidence to reviewed explanations without exposing raw feature names. -->

A **reason code** is a governed explanation category used by reviewers or customer-facing systems. It maps internal evidence to language approved for the product and jurisdiction. Raw feature names or SHAP rankings should not automatically appear in notices.

The mapping should identify the internal factor, eligible decision paths, customer wording, limitations, owner, and version. The final reasons should come from the actual model-plus-policy decision. If a deterministic eligibility rule produced the outcome, a model attribution alone would explain the wrong component.

For US credit decisions, current Regulation B and its official interpretation require specific principal reasons for adverse action and explain that listed reasons must describe factors actually used. CFPB Circular 2022-03 previously discussed this issue for complex algorithms, and the Bureau withdrew that circular on May 12, 2025. Teams should use the current regulation and qualified legal review rather than teaching the withdrawn circular as current guidance or treating a generic explainability library as compliance.

A reason-code mapping must therefore connect the final decision path to approved language:

```yaml
reason_mapping_version: credit-reasons-v8
reasons:
  debt_service_burden:
    source: model_feature_group
    internal_features: [debt_to_income, monthly_debt, verified_income]
    eligible_decisions: [manual_review, adverse_action]
    customer_language: Existing monthly debt is high relative to verified income.
  requested_amount_policy:
    source: deterministic_policy
    policy_rule: requested_amount_above_verified_limit
    eligible_decisions: [adverse_action]
    customer_language: The requested amount exceeds the verified lending limit.
```

When the deterministic rule causes the action, `requested_amount_policy` should outrank a nearby model attribution because it describes the component that actually decided the case. A release test feeds one case through model, policy, and reason mapper, then verifies that every emitted reason refers to a factor or rule used by that decision. An unmapped factor, unstable internal reason, stale mapping version, or data-quality flag sends the case to qualified review.

Human review handles missing or stale data, unstable explanations, unsupported reason mappings, and cases whose consequence requires judgement. The reviewer should see model version, policy version, input-quality flags, internal explanation, reason candidates, and the available correction or appeal path.

## Explanation Is A Versioned Release Artifact
<!-- section-summary: Release evidence records the model, data, methods, samples, validity results, limitations, and reviewer decisions. -->

An explanation report should identify the candidate model and preprocessing, evaluation data, method configuration, global results, representative local cases, segment analysis, validity tests, known limitations, reason-code coverage, and actions taken.

The report creates value when it changes a release decision. An unexpected post-decision feature may be removed. An unstable local explanation may route cases to human review. A segment-specific driver may trigger deeper fairness analysis. A method limitation may prevent customer-facing use while allowing internal debugging.

The artifact stays linked to the released version. A new model, preprocessing pipeline, feature set, background dataset, or reason mapping can change explanations and needs renewed evidence. Keeping only a notebook screenshot loses these dependencies.

## Production Monitoring Watches Behaviour And Explanation Drift
<!-- section-summary: Explanation monitoring can reveal changing model reliance while outcome and data monitoring establish the wider incident context. -->

Teams can monitor top-driver distributions, contribution magnitudes, reason-code frequency, missing explanation rate, and stability on a recurring sample. A sudden rise in one reason may signal traffic change, feature issues, policy change, or model drift.

Explanation drift is diagnostic evidence. It does not prove concept drift or harm. Operators compare it with feature health, model version, policy changes, prediction quality, and product outcomes. This prevents a changed SHAP distribution from triggering automatic retraining without understanding the cause.

During an incident, local explanations can help locate the model path for affected cases. They should sit beside raw input quality, feature versions, policy results, and outcome evidence. Explainability supports diagnosis; it does not replace observability or evaluation.

## Useful Explanations Connect Question, Method, And Action
<!-- section-summary: Explainability succeeds when validated evidence answers a named question and leads to a responsible decision. -->

Global and local scope, intrinsic and post-hoc methods, attribution, examples, counterfactuals, validity tests, reason codes, and monitoring are parts of one framework. The audience and decision select the relevant parts.

The best explanation is not the most sophisticated plot. It is the smallest validated body of evidence that answers the real question, communicates its limits, and gives the developer, reviewer, operator, or affected person an appropriate next action.

## References

- [SHAP documentation: shap.Explainer](https://shap.readthedocs.io/en/latest/generated/shap.Explainer.html)
- [scikit-learn: Permutation feature importance](https://scikit-learn.org/stable/modules/permutation_importance.html)
- [scikit-learn: Partial dependence and ICE](https://scikit-learn.org/stable/modules/partial_dependence.html)
- [CFPB Regulation B § 1002.9 and official interpretation](https://www.consumerfinance.gov/rules-policy/regulations/1002/9/)
- [CFPB Regulation B Appendix C sample notification forms](https://www.consumerfinance.gov/rules-policy/regulations/1002/c/)
- [CFPB withdrawn guidance list](https://www.consumerfinance.gov/compliance/guidance/withdrawn-guidance/)
- [TensorFlow Model Card Toolkit](https://www.tensorflow.org/responsible_ai/model_card_toolkit/guide)
- [Google Research: Model Cards for Model Reporting](https://research.google/pubs/model-cards-for-model-reporting/)
