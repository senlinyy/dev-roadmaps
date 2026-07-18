---
title: "Ranking and Retrieval Evaluation"
description: "Evaluate search and recommendation rankings with query groups, precision@k, recall@k, MRR, MAP, NDCG, segment reports, and release gates."
overview: "Ranking evaluation asks whether the most useful items appear early enough for a user to find them. A supporting example follows a marketplace search team through relevance labels, query groups, ranking metrics, counterfactual limits, segment checks, and a reproducible offline release report."
tags: ["MLOps", "evaluation", "ranking"]
order: 4
id: "article-mlops-model-evaluation-ranking-retrieval-evaluation"
aliases:
  - roadmaps/mlops/modules/model-evaluation/offline-evaluation/05-ranking-and-retrieval-evaluation.md
---


## Ranking Evaluation Measures Ordered Results
<!-- section-summary: Ranking metrics judge which relevant items appear and how early they appear in an ordered list for each query or user context. -->

**Ranking evaluation** measures how well a system orders candidate items for a user, query, or context. A classifier predicts a label for each row. A ranker produces a list where position matters. Showing the right hiking boots at rank 2 can help a shopper; showing them at rank 80 may have almost no product value.

Search, recommendation, advertising, retrieval-augmented generation, and matching systems all use rankings. Their evaluation shares a common shape:

| Object | Marketplace example | Why it matters |
|---|---|---|
| Query group | One search for `waterproof hiking boots` | Metrics are calculated within this group |
| Candidate | One product eligible for ranking | Candidate generation sets the possible recall ceiling |
| Score | Ranker output for the product | Sorting the score creates the result order |
| Relevance label | Purchase, long click, or graded judgment | Defines which order counts as useful |
| Cutoff `k` | First 10 products | Represents the visible product surface |

The metric must follow the user task. A navigational search with one correct answer may use reciprocal rank. A product browse page with several useful results may use NDCG and recall. A retrieval stage that feeds another model may emphasize recall at a larger cutoff because a later ranker can reorder the candidates.

## A Supporting Example: Marketplace Search Review
<!-- section-summary: A supporting example compares a candidate search ranker with production while protecting exact-item queries, new sellers, latency, and candidate coverage. -->

CraftSquare lets independent sellers list handmade products. Production ranker `search-ranker:v37` combines lexical match, learned embeddings, seller quality, delivery promise, and personalization. Candidate `v38` uses a fresher embedding model and new image-text features. Offline review suggests better semantic matching, but the team worries about exact-title searches and products from new sellers with little engagement history.

The visible surface shows 20 results. Candidate generation retrieves 500 products from keyword and vector indexes, then the ranker orders them. This separation matters: if the correct product never enters the 500 candidates, the ranker cannot recover it. CraftSquare therefore reports retrieval metrics for candidate generation and ranking metrics for the final 20.

The evaluation packet contains:

- 60,000 sampled queries from a future time window;
- product catalog snapshot and candidate-index version;
- mature interaction labels with bot and accidental-click filtering;
- 4,000 human-judged query-product pairs for rare and zero-result queries;
- production and candidate scores for the same candidate sets;
- query segments such as exact title, broad category, attribute-rich, locale, and tail frequency.

The product owner defines the primary metric as NDCG@10, with recall@100 for retrieval, exact-title MRR@10, zero-result rate, new-seller exposure, and 95th-percentile (**p95**) latency as guardrails. P95 is the response time that 95 percent of queries meet or beat.

## Build Query Groups And Relevance Labels
<!-- section-summary: A valid ranking dataset keeps candidates grouped by query and defines label meaning, time boundaries, and judgments before calculating metrics. -->

Each evaluation row belongs to a query group. The group key can include `query_id`, user context, locale, and timestamp. The team must avoid joining one query's labels to another query that happens to use the same text. Normalized query text alone is rarely a safe unique key.

CraftSquare uses graded relevance:

| Label | Meaning | Example evidence |
|---:|---|---|
| 3 | Highly relevant | Purchase after query or unanimous expert judgment |
| 2 | Relevant | Add to cart, strong long click, or majority judgment |
| 1 | Partly relevant | Product fits some intent attributes |
| 0 | Irrelevant | Product conflicts with the query intent |

Graded labels support NDCG because a highly relevant item should contribute more than a partly relevant one. Precision, recall, and reciprocal rank usually need a binary threshold, so CraftSquare records `relevant = relevance_grade >= 2` in the evaluation configuration.

Interaction labels carry bias. Products shown near the top receive more clicks because users see them first. A click can also reflect price, image quality, delivery, or brand familiarity rather than semantic relevance. Human judgments reduce some exposure bias, yet judges need clear instructions, disagreement tracking, and representative queries. Mature teams combine interaction outcomes, randomized exploration data where safe, and judged sets instead of treating every click as truth.

The dataset manifest records label windows. A purchase can happen days after a search. Evaluation excludes recent queries whose conversion window has not matured. It also creates a time-based split so candidate features and catalog state come from information available at query time.

## Measure Precision And Recall At K
<!-- section-summary: Precision@k measures how much of the visible list is relevant, while recall@k measures how much known relevant material the list recovered. -->

**Precision@k** is the number of relevant items in the top `k` divided by `k`. If six of the first ten products are relevant, precision@10 is `0.6`. It fits surfaces where irrelevant visible results waste scarce positions.

**Recall@k** is the number of known relevant items in the top `k` divided by the total known relevant items for the query. If eight products are labeled relevant and five appear in the first ten, recall@10 is `0.625`. Recall fits retrieval stages and tasks where missing useful material matters.

```python
import numpy as np

def precision_at_k(relevance: np.ndarray, k: int) -> float:
    top = relevance[:k] >= 2
    return float(top.sum() / k)

def recall_at_k(relevance: np.ndarray, k: int) -> float:
    relevant = relevance >= 2
    denominator = int(relevant.sum())
    if denominator == 0:
        return float("nan")
    return float(relevant[:k].sum() / denominator)
```

Queries with no known relevant item need an explicit policy. Returning recall `0` would punish a ranker for missing labels that may not exist. CraftSquare reports them separately as `no_known_relevant` and uses judged zero-result metrics. The aggregation job excludes `NaN` recall values from mean recall while publishing the excluded-query count.

The cutoff follows the system boundary. Candidate retrieval reports recall@100 and recall@500. The visible ranker reports precision@5, precision@10, and recall@20. Reporting only recall@500 could hide a poor user experience because useful products may sit far below the first page.

## Use MRR MAP And NDCG For Different Products
<!-- section-summary: MRR rewards the first relevant result, MAP summarizes binary relevance across relevant positions, and NDCG supports graded relevance with position discounting. -->

**Mean reciprocal rank (MRR)** focuses on the first relevant result. For one query, reciprocal rank is `1 / position_of_first_relevant_item`. A relevant result at rank 1 scores `1.0`, rank 2 scores `0.5`, and rank 10 scores `0.1`. MRR averages that value across queries. It fits exact-item lookup, known-answer retrieval, and support search where the first useful result dominates the task.

**Average precision (AP)** for a query averages precision values at positions containing relevant items, usually dividing by the number of known relevant items. **Mean average precision (MAP)** averages query AP values. MAP uses binary relevance and rewards lists that place all relevant items early. It differs from classification average precision because the grouping and denominator follow query-level ranked lists.

**Discounted cumulative gain (DCG)** sums relevance gains with a logarithmic position discount. **Normalized discounted cumulative gain (NDCG)** divides DCG by the best possible DCG for the same relevance labels, usually producing a value between zero and one when relevance is nonnegative. NDCG supports graded judgments and reflects the idea that a grade-3 item at rank 1 contributes more than a grade-1 item at rank 8.

Metric choice follows the product:

| Product task | Primary metric | Supporting metrics |
|---|---|---|
| Exact product lookup | MRR@10 | Success@1, success@5 |
| Broad marketplace search | NDCG@10 | Precision@10, recall@20 |
| Candidate retrieval | Recall@100 or recall@500 | Latency, index coverage |
| Multiple-answer knowledge search | MAP or NDCG | Recall, judged coverage |
| Recommendation carousel | NDCG@k | Diversity, novelty, downstream outcomes |

No metric captures the whole product. A ranker can improve NDCG by repeatedly showing popular sellers. New-seller exposure, catalog diversity, complaints, and online conversion belong in the review.

## Calculate A Reproducible Ranking Report
<!-- section-summary: A ranking job sorts within each query, calculates registered metrics, aggregates with visible query weights, and stores query-level outputs for investigation. -->

CraftSquare calculates query-level metrics before averaging. This makes the weighting explicit and leaves an artifact for slice analysis:

```python
import pandas as pd
from sklearn.metrics import ndcg_score

def evaluate_query(group: pd.DataFrame, score_column: str) -> dict:
    ranked = group.sort_values(score_column, ascending=False, kind="stable")
    relevance = ranked["relevance_grade"].to_numpy()

    ndcg10 = ndcg_score(
        [group["relevance_grade"].to_numpy()],
        [group[score_column].to_numpy()],
        k=10,
        ignore_ties=False,
    )
    relevant_positions = np.flatnonzero(relevance >= 2)
    rr10 = (
        1.0 / (int(relevant_positions[0]) + 1)
        if len(relevant_positions) and relevant_positions[0] < 10
        else 0.0
    )
    return {
        "query_id": group.name,
        "ndcg_at_10": float(ndcg10),
        "precision_at_10": precision_at_k(relevance, 10),
        "recall_at_20": recall_at_k(relevance, 20),
        "reciprocal_rank_at_10": rr10,
        "candidate_count": len(group),
        "known_relevant_count": int((relevance >= 2).sum()),
    }

candidate_report = (
    evaluation_rows.groupby("query_id", group_keys=False)
    .apply(lambda group: pd.Series(evaluate_query(group, "candidate_score")))
    .reset_index(drop=True)
)
```

The code uses a stable sort so tied scores have deterministic behavior. Scikit-learn's `ndcg_score` averages ties by default. CraftSquare also reports tie rate because a quantized or broken scoring feature can create thousands of equal scores and let input order affect the list.

The aggregation uses one query as one unit for the primary macro average. A traffic-weighted report appears separately. Otherwise, a handful of frequent head queries can dominate the metric and hide poor tail search. The report stores mean, median, confidence interval, query count, and the distribution of candidate counts.

## Review Segments Position Bias And Coverage
<!-- section-summary: Segment reports and coverage checks reveal failures hidden by a single average and distinguish ranker quality from candidate-generation limits. -->

CraftSquare joins each query-level result to registered segments:

| Segment | Production NDCG@10 | Candidate NDCG@10 | Query count | Gate |
|---|---:|---:|---:|---|
| All queries | 0.612 | 0.629 | 60,000 | Pass |
| Exact title | 0.883 | 0.872 | 8,400 | Block |
| Attribute rich | 0.574 | 0.611 | 12,100 | Pass |
| Tail query | 0.421 | 0.458 | 9,300 | Pass |
| French locale | 0.533 | 0.536 | 4,200 | Review |
| New seller eligible | 0.487 | 0.472 | 7,900 | Block |

The candidate wins overall while losing exact-title behavior and new-seller exposure. The team inspects query-level differences, not only segment averages. Exact searches reveal that semantic scores sometimes outrank exact lexical matches. A hybrid rule or feature repair may protect those queries.

Candidate coverage receives a separate table. `relevant_in_top_500` asks whether retrieval supplied useful items. `eligible_catalog_coverage` checks how many active products the indexes can retrieve. `zero_candidates` catches tokenization or locale failures. A ranker regression and an index regression need different owners and rollback actions.

Position bias remains visible in the label documentation. The team compares judged metrics and interaction-derived metrics. Large disagreement can point to exposure bias, stale judgments, or product factors outside relevance. Offline evaluation cannot recreate user adaptation, competition between results, or the effect of changed presentation.

## Connect Offline Metrics To Online Evidence
<!-- section-summary: Offline ranking metrics screen candidates, while shadow checks and controlled experiments measure runtime behavior and real user outcomes. -->

A candidate that passes offline review enters shadow traffic. The service scores copied requests without changing visible results. The team compares latency, errors, candidate count, score distributions, feature freshness, and query-level rank changes. Shadow traffic cannot measure user benefit because users still see production results.

An A/B test measures outcomes such as successful search sessions, add-to-cart rate, purchase rate, reformulation, abandonment, complaints, and seller exposure. The experiment uses stable assignment, mature outcome windows, prewritten sample size, confidence intervals, and guardrails. Offline NDCG improvement supplies a reason to test; it does not guarantee conversion improvement.

CraftSquare connects the layers with one release identity:

```yaml
ranking_release_evidence:
  model_version: search-ranker-v38
  candidate_index: hybrid-index-2026-07-08
  offline_dataset: search-eval-2026-06@sha256:81fa...
  relevance_policy: graded-relevance-v4
  offline_report: s3://craftsquare-eval/v38/report.json
  shadow_dashboard: https://metrics.example/search/v38-shadow
  experiment_key: search_ranker_v38_marketplace
```

That identity prevents an experiment from serving a different index or preprocessing version from the one reviewed offline.

## Write Ranking Release Gates And A Runbook
<!-- section-summary: Ranking gates combine overall improvement, query safety, retrieval coverage, exposure, runtime limits, and a direct rollback action. -->

The release policy names primary and guardrail metrics:

```yaml
ranking_release_gate:
  primary:
    ndcg_at_10:
      candidate_minus_production_lower_ci_min: 0.005
  retrieval:
    recall_at_500_min: 0.97
    zero_candidate_rate_max: 0.001
  query_guardrails:
    exact_title_mrr_at_10_regression_max: 0.002
    tail_query_ndcg_at_10_regression_max: 0.005
  marketplace_guardrails:
    new_seller_top_20_exposure_regression_max: 0.01
  runtime:
    p95_latency_ms_max: 120
    error_rate_max: 0.001
  failure_action:
    keep_alias: search-ranker@champion
    open_blocker_with_query_examples: true
```

When a gate fails, the runbook starts with affected query IDs and decomposes the path. If recall@500 fell, inspect candidate indexes, filters, catalog freshness, locale analysis, and embedding publication. If recall stays healthy while NDCG falls, inspect features, score distributions, ties, exact-match behavior, and model artifacts. If offline metrics pass while online outcomes fall, inspect experiment assignment, presentation changes, latency, personalization, novelty, and label mismatch.

Rollback changes the model alias and, when necessary, the candidate-index version as one reviewed pair. Keeping only the model rollback while leaving an incompatible index can preserve the incident.

## Putting It Together
<!-- section-summary: Ranking evaluation follows query groups from candidate coverage through ordered relevance, segment safety, runtime evidence, and online outcomes. -->

CraftSquare evaluates candidate generation and final ranking as separate stages. Precision@k and recall@k explain visible relevance and retrieval coverage. MRR fits exact-item tasks, MAP fits multiple binary-relevance items, and NDCG supports graded relevance with position discounting. Query-level artifacts make every aggregate traceable to real examples.

The candidate's overall win does not erase exact-title and new-seller losses. Segment gates block the release until the team repairs or scopes those failures. Shadow traffic then validates runtime behavior, and a controlled experiment measures user and marketplace outcomes. This path gives the search team a modern evaluation workflow that connects metric definitions to the system users actually experience.

## References

- [scikit-learn ndcg_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.ndcg_score.html)
- [scikit-learn label ranking average precision](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.label_ranking_average_precision_score.html)
- [TensorFlow Ranking](https://www.tensorflow.org/ranking)
- [Google Rules of ML](https://developers.google.com/machine-learning/guides/rules-of-ml)
- [TREC evaluation tools](https://trec.nist.gov/trec_eval/)
