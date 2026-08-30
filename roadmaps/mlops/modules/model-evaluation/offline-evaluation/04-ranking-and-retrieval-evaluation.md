---
title: "Ranking and Retrieval Evaluation"
description: "Evaluate ordered results through valid query groups, relevance evidence, ranking metrics, guardrails, experiments, and release gates."
overview: "Ranking evaluation asks whether a search, recommendation, or retrieval system places useful items where people can find them. It covers the ranking pipeline, relevance evidence, precision@k, recall@k, MRR, MAP, NDCG, aggregation, bias, guardrails, online experiments, and production release decisions."
tags: ["MLOps", "evaluation", "ranking"]
order: 4
id: "article-mlops-model-evaluation-ranking-retrieval-evaluation"
aliases:
  - roadmaps/mlops/modules/model-evaluation/offline-evaluation/05-ranking-and-retrieval-evaluation.md
---

## Table of Contents

1. [What User Experience and Relevance Definition Does a Ranking Create?](#what-user-experience-and-relevance-definition-does-a-ranking-create)
2. [How Do Precision at K and Recall at K Measure the Top Results?](#how-do-precision-at-k-and-recall-at-k-measure-the-top-results)
3. [How Do MRR, MAP, DCG, and NDCG Reward Rank Position?](#how-do-mrr-map-dcg-and-ndcg-reward-rank-position)
4. [How Do Click Bias, Time, Candidate Recall, and RAG Change Retrieval Evaluation?](#how-do-click-bias-time-candidate-recall-and-rag-change-retrieval-evaluation)
5. [How Do Diversity, Coverage, Eligibility, Latency, and Segments Affect Ranking Quality?](#how-do-diversity-coverage-eligibility-latency-and-segments-affect-ranking-quality)
6. [How Do Paired Comparisons and Online Outcomes Extend Offline Ranking Tests?](#how-do-paired-comparisons-and-online-outcomes-extend-offline-ranking-tests)
7. [What Should a Reproducible Ranking Report and Release Specification Contain?](#what-should-a-reproducible-ranking-report-and-release-specification-contain)
8. [How Does Expected Utility Tie the Ranking Metrics Together?](#how-does-expected-utility-tie-the-ranking-metrics-together)
9. [Check Your Answers](#check-your-answers)

A search system returns ten technically relevant results, but the first useful result appears in position nine. Another system finds fewer relevant documents overall yet places the answer first. Whether it is better depends on the user's task, the number of visible slots, and what relevance means for that request.

Ranking and retrieval evaluation measures an ordered set rather than one independent prediction. It must account for relevance, position, candidate coverage, diversity, eligibility, latency, request frequency, and the behaviour data used as labels. Different metrics expose different parts of that experience.

These questions follow the ranking pipeline from relevance judgements to a reproducible offline and online release decision:

1. **What User Experience and Relevance Definition Does a Ranking Create?**
2. **How Do Precision at K and Recall at K Measure the Top Results?**
3. **How Do MRR, MAP, DCG, and NDCG Reward Rank Position?**
4. **How Do Click Bias, Time, Candidate Recall, and RAG Change Retrieval Evaluation?**
5. **How Do Diversity, Coverage, Eligibility, Latency, and Segments Affect Ranking Quality?**
6. **How Do Paired Comparisons and Online Outcomes Extend Offline Ranking Tests?**
7. **What Should a Reproducible Ranking Report and Release Specification Contain?**
8. **How Does Expected Utility Tie the Ranking Metrics Together?**

## What User Experience and Relevance Definition Does a Ranking Create?
<!-- section-summary: Ranking evaluation starts from the request, candidate set, ordered experience, and relevance labels that define what a useful result means. -->

Ranking determines which items receive scarce user attention, so evaluation begins with the experience and relevance judgement it is intended to create.

Ranking and retrieval systems do something different from ordinary classifiers or regressors. A classifier asks:

$$
\text{“What class is this item?”}
$$

A regressor asks:

$$
\text{“What number should I predict?”}
$$

A ranking or retrieval system asks:

$$
\boxed{\text{“Which items should I show, and in what order?”}}
$$

Examples include:

* search engines,
* recommendation systems,
* product search,
* document retrieval,
* candidate retrieval for RAG,
* job recommendations,
* feed ranking,
* ad ranking,
* question-answer retrieval.

The core difficulty is that users usually see only the **top few results**. So evaluation cannot treat every item equally. A relevant result at rank 1 is usually more useful than the same result at rank 500. That gives the first principle:

$$
\boxed{
\text{Ranking quality depends on relevance, order, and the number of results a user can actually inspect.}
}
$$

Suppose a user searches:

noise-cancelling headphones

A retrieval system has one million products. It might assign every candidate a score:

$$
s(q,d)
$$

where:

* $$q$$ = query,
* $$d$$ = candidate document or item,
* $$s$$ = relevance score.

Then it sorts candidates:

$$
d_{(1)},d_{(2)},d_{(3)},\ldots
$$

such that:

$$
s(q,d_{(1)})
\ge
s(q,d_{(2)})
\ge
s(q,d_{(3)})
\ge\cdots
$$

The user may see only:

$$
d_{(1)},\ldots,d_{(10)}
$$

So the system's real output is not merely a set of relevant items. It is an **ordered list**:

$$
\boxed{
[d_1,d_2,\ldots,d_K]
}
$$

Evaluation therefore needs to answer questions such as:

* Did relevant items appear
* Did we retrieve all important relevant items
* How early did useful items appear
* Were highly relevant items placed above weakly relevant items
* Did the system return enough variety
* Did it obey eligibility and safety rules
* Did it respond fast enough

One metric rarely answers all of these. Many production ranking systems contain several stages. A simplified pipeline is:

$$
\text{Request}
\rightarrow
\text{Candidate generation}
\rightarrow
\text{Filtering}
\rightarrow
\text{Scoring}
\rightarrow
\text{Ranking}
\rightarrow
\text{Top-}K
$$

For example, a search system might have:

### Stage 1: Retrieval

Find perhaps:

$$
1{,}000
$$

plausible documents from millions.

### Stage 2: Filtering

Remove documents that are:

* unavailable,
* forbidden,
* geographically ineligible,
* already consumed,
* out of stock.

### Stage 3: Reranking

A stronger model assigns scores and sorts the remaining candidates.

### Stage 4: Presentation

Show the top:

$$
10
$$

or:

$$
20
$$

results. These stages fail differently. If the correct item is never retrieved in Stage 1, no reranker can rescue it. If candidate retrieval is excellent but ranking is poor, relevant items may exist in the candidate set but appear too far down. So evaluation should distinguish:

$$
\boxed{\text{retrieval failure}}
$$

from:

$$
\boxed{\text{ranking failure}}
$$

Every ranking metric assumes some notion of:

$$
\text{relevance}
$$

But relevance is not given by mathematics. It comes from the task. Suppose the query is:

python list sorting

Would these documents count as relevant?

* Python's official `sorted()` documentation
* a Stack Overflow answer about sorting lists
* an article about sorting algorithms generally
* a Java sorting tutorial
* an article about Python snakes

You need rules. For binary relevance, you might define:

$$
rel(q,d)\in\{0,1\}
$$

where:

$$
1=\text{relevant}
$$

$$
0=\text{not relevant}
$$

But many systems need **graded relevance**.

For example:

$$
rel(q,d)\in\{0,1,2,3\}
$$

where:

$$
0=\text{irrelevant}
$$

$$
1=\text{somewhat relevant}
$$

$$
2=\text{relevant}
$$

$$
3=\text{highly relevant}
$$

This distinction becomes crucial for metrics such as NDCG. Before evaluating ranking quality, you therefore need a defensible answer to:

$$
\boxed{\text{What counts as a good result?}}
$$

Suppose two evaluators judge the same search result. Evaluator A says:

$$
rel=3
$$

Evaluator B says:

$$
rel=1
$$

The metric cannot resolve that disagreement. It simply operates on the labels it receives. So ranking evaluation quality depends partly on:

* annotation instructions,
* annotator expertise,
* label consistency,
* whether context is visible,
* whether relevance is subjective,
* whether judgments become outdated.

This creates an important principle:

$$
\boxed{
\text{A ranking metric can be precise even when the relevance labels are poor.}
}
$$

A score such as:

$$
NDCG=0.8734
$$

may look mathematically rigorous while being built on unreliable judgments. For ranking systems, the basic unit is usually not an individual document. It is a **request**. Examples:

* search query,
* user session,
* recommendation request,
* question being answered,
* feed refresh.

Suppose query $$q_i$$ produces ranked list:

$$
L_i=[d_{i1},d_{i2},\ldots]
$$

We usually compute a ranking metric separately for each request:

$$
M_i=M(q_i,L_i)
$$

and then aggregate:

$$
M_{\text{overall}}
=
\frac{1}{N}
\sum_{i=1}^{N}M_i
$$

This matters because one query with 500 retrieved documents should not automatically dominate another query with 10. The natural statistical unit is often:

$$
\boxed{\text{one request}}
$$

not:

$$
\boxed{\text{one result}}
$$

## How Do Precision at K and Recall at K Measure the Top Results?
<!-- section-summary: Precision at K measures useful use of limited top slots, while Recall at K measures how much available relevant material the list recovered. -->

Once relevance and the request unit are defined, the first question is whether the limited top-K slots contain enough useful material.

Suppose the top five results are:

| Rank | Relevant |
| ---: | --------- |
|    1 | Yes       |
|    2 | No        |
|    3 | Yes       |
|    4 | Yes       |
|    5 | No        |

There are:

$$
3
$$

relevant results among the top:

$$
5
$$

So:

$$
Precision@5
=
\frac{3}{5}
=
0.6
$$

or:

$$
60\%
$$

In general:

$$
Precision@K
=
\frac{
\text{relevant items in top }K
}{
K
}
$$

It answers:

Of the items we showed near the top, how many were useful

This is especially meaningful when users inspect only a fixed number of results. Suppose a recommendation panel has room for:

$$
4
$$

items. If only:

$$
2
$$

are relevant, then:

$$
Precision@4
=
\frac{2}{4}
=
50\%
$$

Half of your scarce screen space was effectively wasted. That makes Precision@K useful for:

* search result pages,
* recommendation carousels,
* analyst review queues,
* retrieval systems with fixed context budgets.

It is fundamentally a **top-of-list quality** metric. Suppose there are:

$$
10
$$

relevant documents in the entire corpus. Your top five contain:

$$
3
$$

of them.

Then:

$$
Recall@5
=
\frac{3}{10}
=
30\%
$$

In general:

$$
Recall@K
=
\frac{
\text{relevant items in top }K
}{
\text{all relevant items}
}
$$

It asks:

Of everything useful that existed, how much did we manage to retrieve near the top

This is different from Precision@K. Precision cares about:

$$
\text{purity of shown results}
$$

Recall cares about:

$$
\text{coverage of all relevant results}
$$

Imagine two systems. There are:

$$
20
$$

relevant items. At $$K=10$$:

### System A

Returns:

$$
8
$$

relevant items.

Then:

$$
Precision@10=80\%
$$

$$
Recall@10=40\%
$$

### System B

Returns:

$$
6
$$

relevant items.

Then:

$$
Precision@10=60\%
$$

$$
Recall@10=30\%
$$

System A is better on both. But sometimes tradeoffs appear. Suppose you expand $$K$$. At:

$$
K=100
$$

you may retrieve nearly every relevant item:

$$
Recall@100\approx100\%
$$

while precision becomes very low. So $$K$$ is part of the metric definition. You should not say:

"Recall is 80%."

You should say something like:

$$
\boxed{Recall@20=80\%}
$$

because operational depth matters. Why evaluate:

$$
Precision@10
$$

rather than:

$$
Precision@100
$$

Ideally because users or downstream systems actually consume around 10 results.

For example:

* search page displays 10 results,
* recommendation tray shows 6 products,
* analyst team reviews 50 alerts,
* RAG model receives 8 retrieved passages.

Then:

$$
K
$$

has an operational meaning. Choosing $$K$$ arbitrarily can make evaluation misleading. A ranking metric should resemble the experience or resource constraint:

$$
\boxed{
K\approx\text{number of positions that actually matter}
}
$$

![Ranking evaluation separates candidate retrieval, controlled ordering, and the final visible list](/content-assets/articles/article-mlops-model-evaluation-ranking-retrieval-evaluation/retrieval-ranking-boundaries.png)

*Retrieval determines which relevant items are available, ranking orders those candidates, and the final-list check adds eligibility, diversity, and latency.*

## How Do MRR, MAP, DCG, and NDCG Reward Rank Position?
<!-- section-summary: MRR emphasizes the first success, MAP rewards multiple early successes, and DCG/NDCG combine graded relevance with position discounting. -->

Top-K counts ignore order within the list, which creates the need for metrics that discount later positions and reward early success.

Suppose there is exactly one relevant result. System A puts it at:

$$
\text{rank }1
$$

System B puts it at:

$$
\text{rank }10
$$

Both have:

$$
Recall@10=1
$$

Both technically retrieved the answer. But the experiences are not equivalent. If the user wants the **first correct result as soon as possible**, we need a metric that rewards earlier success. That leads to reciprocal rank. If the first relevant result appears at position:

$$
r
$$

then reciprocal rank is:

$$
RR=\frac{1}{r}
$$

Examples:

If first relevant result is rank 1:

$$
RR=1
$$

Rank 2:

$$
RR=\frac12=0.5
$$

Rank 5:

$$
RR=\frac15=0.2
$$

Rank 20:

$$
RR=\frac1{20}=0.05
$$

So the penalty grows quickly when the first useful result appears later. Across $$N$$ queries:

$$
MRR
=
\frac1N
\sum_{i=1}^N
\frac{1}{r_i}
$$

where $$r_i$$ is the rank of the first relevant result. Suppose three queries have first relevant results at:

$$
1,\quad2,\quad5
$$

Then:

$$
MRR
=
\frac{1+\frac12+\frac15}{3}
$$

$$
=
\frac{1.7}{3}
\approx0.567
$$

MRR is useful when:

$$
\boxed{\text{the first correct result is what mainly matters}}
$$

Examples include:

* navigational search,
* FAQ retrieval,
* certain question-answer systems,
* finding a known item.

Suppose:

### System A

Ranks:

$$
[R,N,N,N,N]
$$

### System B

Ranks:

$$
[R,R,R,R,R]
$$

where $$R$$ means relevant. Both have first relevant result at rank 1. Therefore:

$$
RR_A=RR_B=1
$$

MRR cannot distinguish them. That is not a flaw if the task truly ends after the first useful result. But if users benefit from several relevant results, MRR throws away important information. This illustrates a general rule:

$$
\boxed{
\text{A metric is useful when what it ignores is genuinely unimportant.}
}
$$

Suppose there are several relevant results. Average Precision evaluates precision at the positions where relevant documents appear. One common form is:

$$
AP
=
\frac{1}{R}
\sum_{k=1}^{N}
Precision@k\cdot rel(k)
$$

where:

* $$R$$ = number of relevant documents,
* $$rel(k)=1$$ if result at rank $$k$$ is relevant, otherwise 0.

Let's see why this makes sense. Suppose the ranking is:

| Rank | Relevant |
| ---: | --------- |
|    1 | Yes       |
|    2 | No        |
|    3 | Yes       |
|    4 | Yes       |

There are three relevant items. Precision when we hit each relevant result is:

At rank 1:

$$
P@1=1
$$

At rank 3:

$$
P@3=\frac23
$$

At rank 4:

$$
P@4=\frac34
$$

Therefore:

$$
AP
=
\frac{
1+\frac23+\frac34
}{3}
$$

$$
\approx0.806
$$

Relevant documents appearing early improve AP more. Mean Average Precision is:

$$
MAP
=
\frac1N
\sum_{i=1}^{N}AP_i
$$

MAP is useful when:

* multiple relevant documents may exist,
* finding more of them matters,
* earlier relevant documents are better.

It has historically been common in information retrieval evaluation.

Conceptually:

$$
\boxed{
MRR \rightarrow \text{first useful result}
}
$$

while:

$$
\boxed{
MAP \rightarrow \text{quality of retrieving several relevant results}
}
$$

Imagine search results for:

best beginner Python tutorial

Suppose three documents are:

### A

Excellent, comprehensive beginner tutorial.

### B

Related Python article but somewhat advanced.

### C

Mentions Python but barely answers the query. Calling all three simply:

$$
rel=1
$$

loses important information. Instead assign graded relevance:

$$
A=3
$$

$$
B=2
$$

$$
C=1
$$

$$
\text{irrelevant}=0
$$

Now evaluation can reward not merely finding relevant items, but placing **more useful results above less useful results**. That motivates DCG and NDCG. Discounted Cumulative Gain assigns value to relevant results while discounting lower positions. A common formulation is:

$$
DCG@K
=
\sum_{i=1}^{K}
\frac{2^{rel_i}-1}
{\log_2(i+1)}
$$

Two ideas are built into this formula. First:

$$
2^{rel_i}-1
$$

makes higher relevance grades substantially more valuable. Second:

$$
\frac{1}{\log_2(i+1)}
$$

discounts results at lower ranks. So:

$$
\boxed{\text{high relevance + high position = high gain}}
$$

Consider the same highly relevant document. At rank 1:

$$
\log_2(2)=1
$$

so there is no discount. At rank 3:

$$
\log_2(4)=2
$$

so its contribution is halved. At rank 7:

$$
\log_2(8)=3
$$

so it receives only one-third of its undiscounted value. The exact logarithmic formula is a modeling choice. The deeper principle is:

$$
\boxed{\text{users generally care less about results appearing farther down the ranking}}
$$

A position discount mathematically represents that diminishing attention. Raw DCG depends on the number and grades of relevant results. So it is hard to compare directly across queries. Suppose one query has ten highly relevant results while another has only one. Their maximum possible DCGs are different. NDCG solves this by dividing actual DCG by the ideal DCG:

$$
NDCG@K
=
\frac{DCG@K}{IDCG@K}
$$

where $$IDCG$$ is the DCG from the perfect ranking. Thus:

$$
0\le NDCG\le1
$$

in standard settings. If:

$$
NDCG@10=1
$$

the top 10 are ideally ordered according to the relevance labels. If:

$$
NDCG@10=0.8
$$

the ranking captures about 80% of the attainable discounted gain under that relevance scheme. Consider two rankings:

### Ranking A

$$
[3,3,0,0]
$$

### Ranking B

$$
[1,1,1,1]
$$

A binary metric might call every positive grade simply "relevant." Then B could appear to have more relevant results. But if grade 3 means exceptionally useful and grade 1 means weakly useful, Ranking A may create the better user experience. NDCG can represent that distinction. It is often valuable when:

* relevance has degrees,
* top positions matter strongly,
* several results matter.

## How Do Click Bias, Time, Candidate Recall, and RAG Change Retrieval Evaluation?
<!-- section-summary: Observed clicks reflect the old ranking policy, time changes validity, candidate generation caps reranking, and RAG may require several complementary pieces of evidence. -->

Those formulas assume trustworthy labels, yet real retrieval data inherits position bias, historical policy, time, and candidate-generation limits.

Notice what happened with NDCG. We assumed:

1. high-grade relevance is more valuable,
2. lower-ranked results matter less,
3. a logarithmic discount approximates how attention decays.

These are assumptions about user behavior. Likewise:

* Precision@K assumes all positions up to $$K$$ matter similarly,
* MRR assumes mostly the first successful result matters,
* MAP assumes several binary relevant items matter,
* NDCG assumes graded relevance and position discounting.

So ranking metrics are not neutral mathematical facts. They are simplified models of:

$$
\boxed{\text{how users derive utility from a ranked list}}
$$

You might think:

Why not just use clicks as relevance labels

Because users click partly based on position. A result at rank 1 gets more attention than the identical result at rank 8. So:

$$
P(\text{click})
$$

depends on at least:

$$
P(\text{relevance})
$$

and:

$$
P(\text{examination due to position})
$$

A simplified model is:

$$
P(\text{click at rank }k)
\approx
P(\text{examined at }k)
\times
P(\text{attractive/relevant})
$$

This creates **position bias**. A result may receive few clicks not because it is poor, but because users rarely saw it. Therefore logged behavior is not automatically unbiased ground truth. Suppose yesterday's system ranked Document A at position 1 and Document B at position 100. You observe many clicks on A and almost none on B. Now you want to evaluate a new model that would rank B first. Historical logs cannot directly tell you what would have happened if B had actually been shown first. Why? Because the old ranking policy determined what users saw. Formally, observed behavior comes from:

$$
P(\text{outcome}\mid\text{old policy})
$$

but you want:

$$
P(\text{outcome}\mid\text{new policy})
$$

Those are not necessarily the same. This is one reason offline ranking evaluation is inherently limited. Suppose you build a search evaluation set today using current products and queries. If you accidentally allow future information into training, evaluation becomes optimistic.

For example:

* future clicks leak into features,
* future popularity enters candidate scores,
* future document versions become visible,
* availability information is taken from after the request date.

A time-valid evaluation should reconstruct what was knowable at the moment of the request.

Conceptually:

$$
\boxed{
\text{features available at time }t
\rightarrow
\text{ranking at time }t
}
$$

not:

$$
\boxed{
\text{future knowledge}
\rightarrow
\text{ranking in the past}
}
$$

This is especially important for feeds, recommendations, marketplaces, and news search. Suppose the ideal relevant item is not retrieved by the candidate generator. Then the reranker has no chance to place it first. If candidate generation recalls only:

$$
70\%
$$

of relevant items, final recall can never exceed that ceiling. This suggests evaluating retrieval stages separately. For candidate generation, you might emphasize:

$$
Recall@100
$$

or:

$$
Recall@1000
$$

The goal may be:

Retrieve nearly every plausible relevant item, even if the candidate set contains some noise.

Then the reranker focuses on:

$$
NDCG@10
$$

or:

$$
Precision@10
$$

The stages have different objectives. Consider a two-stage system.

### Retriever

Returns:

$$
1000
$$

documents. Its main goal may be high recall:

$$
Recall@1000\approx99\%
$$

Some irrelevant documents are acceptable.

### Reranker

Sorts those 1,000 and displays 10. Its goal may be:

$$
NDCG@10
$$

or:

$$
Precision@10
$$

Now precision matters much more. This architecture reflects a common pattern:

$$
\boxed{
\text{early stage: don't miss good candidates}
}
$$

$$
\boxed{
\text{late stage: put the best candidates first}
}
$$

Using one metric for the entire pipeline can obscure which stage needs improvement. Consider retrieval-augmented generation. A question arrives:

$$
q
$$

The retriever returns:

$$
K
$$

passages. The language model then answers using those passages. The retrieval system's real objective is not merely:

Retrieve semantically similar text.

It is closer to:

Put enough correct evidence into the context window for the downstream model to produce a correct answer.

This can create several useful metrics.

For example:

$$
Recall@K
$$

asks whether required evidence appeared. But document-level recall may still be insufficient. You might also evaluate:

* answer-support coverage,
* whether all necessary pieces of evidence were retrieved,
* redundant versus complementary passages,
* context-token efficiency.

A retriever can look good according to standard relevance metrics while still supplying poor evidence to the generator. Suppose answering a question requires both:

$$
d_A
$$

and:

$$
d_B
$$

The retriever returns only $$d_A$$. A simple metric might award partial credit because one relevant document was found. But downstream answer generation may completely fail because both documents are required. So some retrieval tasks need metrics that operate on the **set of retrieved evidence** rather than independently on each item. The system-level requirement may be:

$$
\boxed{
\text{all necessary evidence appears within top }K
}
$$

This illustrates why relevance definitions must be derived from downstream needs.

## How Do Diversity, Coverage, Eligibility, Latency, and Segments Affect Ranking Quality?
<!-- section-summary: Useful rankings also balance diversity, catalogue coverage, eligibility, latency, request frequency, segments, and distributional behaviour. -->

Relevance alone is also incomplete when the product needs diverse, eligible, fast results across many request types.

Suppose a user asks:

laptops for programming

The system returns ten nearly identical configurations of the same laptop. All ten may be individually relevant. So:

$$
Precision@10=100\%
$$

Yet the result set may be poor because it lacks useful variety. The user may prefer choices spanning:

* budget,
* operating system,
* portability,
* performance.

Thus relevance alone may not capture list quality. You may need diversity metrics or explicit category coverage constraints. This leads to:

$$
\boxed{
\text{individual relevance}
\neq
\text{quality of the result set}
}
$$

Imagine a recommendation system always recommends the same 100 popular products. Its recommendations may have high click-through rate. But thousands of useful products never appear. You may measure catalogue coverage:

$$
\text{Coverage}
=
\frac{
\text{items ever recommended}
}{
\text{eligible items}
}
$$

Or user/request coverage:

$$
\frac{
\text{requests receiving valid recommendations}
}{
\text{all requests}
}
$$

Coverage is not necessarily something to maximize without limit. But it can reveal pathological concentration. Suppose the top five highest-scoring results are all nearly duplicates. Replacing one with a somewhat less individually relevant but substantially different result may improve the overall experience. So you may face:

$$
\text{relevance}
\leftrightarrow
\text{diversity}
$$

This is not necessarily a model defect. It is a multi-objective product decision. A practical setup might be:

$$
\boxed{\text{maximize NDCG@10}}
$$

subject to:

$$
\boxed{\text{minimum diversity requirement}}
$$

rather than combining everything into an opaque single score. Suppose a hotel recommendation system returns the perfect hotel—but it is sold out. Or a product search system ranks an unavailable product first. Or a job system recommends a role the user is legally ineligible to apply for. The ranking may be semantically excellent but operationally invalid. So production evaluation should check constraints such as:

$$
\text{eligible(result)}
$$

A simple guardrail might be:

$$
\text{Ineligible@10}=0
$$

or:

$$
\text{eligibility violation rate}<0.01\%
$$

Hard constraints may matter more than another percentage point of NDCG. Suppose Model B improves:

$$
NDCG@10
$$

from:

$$
0.76
$$

to:

$$
0.78
$$

but increases p99 latency from:

$$
120\text{ ms}
$$

to:

$$
2.5\text{ s}
$$

That may be unacceptable. Ranking systems often operate under strict response-time requirements. So a production release might optimize:

$$
NDCG@10
$$

subject to:

$$
p95\text{ latency}<200\text{ ms}
$$

and:

$$
p99\text{ latency}<500\text{ ms}
$$

Model evaluation should include enough system-level constraints to reflect actual deployability. Suppose Query A has:

$$
100
$$

candidates. Query B has:

$$
10
$$

candidates. If you simply pool every ranked result together, Query A could dominate the metric because it contributes more rows. Instead, ranking metrics are commonly calculated per request:

$$
M_A,\quad M_B,\quad\ldots
$$

and then averaged:

$$
\bar M
=
\frac{1}{N}
\sum_iM_i
$$

This gives each request equal influence. But even this contains a policy decision. Should every query really count equally? Perhaps some queries are:

* more frequent,
* higher value,
* safety-critical,
* more important to users.

Then a weighted average may be appropriate:

$$
M
=
\frac{
\sum_iw_iM_i
}{
\sum_iw_i
}
$$

Again, the weighting should reflect something real. Suppose:

### Head queries

Very common. Metric:

$$
NDCG=0.90
$$

### Tail queries

Rare individually but collectively substantial. Metric:

$$
NDCG=0.45
$$

If your evaluation set samples query strings uniformly, tail queries may dominate. If it samples actual traffic, common queries may dominate. Neither is automatically wrong. They answer different questions:

$$
\text{unweighted by query}
\rightarrow
\text{performance for the typical distinct query}
$$

$$
\text{traffic weighted}
\rightarrow
\text{performance for the typical request}
$$

You need to know which population the metric represents. An aggregate:

$$
NDCG@10=0.82
$$

can conceal serious differences. Suppose:

| Query type              | NDCG@10 |
| ----------------------- | ------: |
| Navigational            |    0.95 |
| Popular products        |    0.90 |
| Long-tail informational |    0.68 |
| Newly added content     |    0.42 |

The aggregate score hides weak areas. Useful segments might include:

* head versus tail queries,
* short versus long queries,
* geography,
* language,
* new versus returning users,
* cold-start items,
* catalogue category,
* query intent,
* mobile versus desktop.

Evaluation should identify **where ranking quality breaks down**. Suppose:

$$
Mean\ NDCG@10=0.80
$$

Two systems can share this average but behave very differently.

### Model A

Most queries score near:

$$
0.80
$$

### Model B

Half score:

$$
1.00
$$

and half score:

$$
0.60
$$

Same mean. Different user experience. You may therefore examine:

* median metric,
* p10 or worst-decile performance,
* fraction of zero-result or zero-relevance queries,
* fraction of queries that regress versus baseline.

For example:

$$
P(NDCG@10=0)
$$

can be operationally very revealing.

![Ranking evidence progresses from offline evaluation through shadow traffic and a controlled experiment to release review](/content-assets/articles/article-mlops-model-evaluation-ranking-retrieval-evaluation/progressive-ranking-evidence.png)

*Each stage answers a different question: offline evidence screens quality, shadow traffic verifies operation, and a controlled experiment measures outcomes under the new policy.*

## How Do Paired Comparisons and Online Outcomes Extend Offline Ranking Tests?
<!-- section-summary: Paired offline comparisons isolate list changes, while online experiments test causal product outcomes and guard against misleading engagement targets. -->

Offline evidence can compare the same requests precisely, while live randomized evidence is needed for causal product effects.

Suppose:

$$
NDCG_A=0.812
$$

and:

$$
NDCG_B=0.818
$$

The difference is:

$$
+0.006
$$

But what happened query by query For request $$i$$:

$$
\Delta_i
=
NDCG_i(B)-NDCG_i(A)
$$

You might discover:

* B improves 60% of queries slightly,
* B badly hurts 5% of important queries,
* the entire average gain comes from one segment,
* B helps tail queries but hurts head queries.

So model comparison should often analyze:

$$
\{\Delta_1,\Delta_2,\ldots,\Delta_N\}
$$

not merely:

$$
\bar M_B-\bar M_A
$$

Suppose:

$$
MRR_A=0.621
$$

and:

$$
MRR_B=0.625
$$

That does not automatically prove B is genuinely better. Evaluation queries are a finite sample. If you drew another set, results might differ.

Conceptually:

$$
\text{observed metric}
=
\text{expected performance}
+
\text{sampling variation}
$$

Useful techniques include:

* bootstrap confidence intervals over requests,
* paired tests,
* randomization tests,
* confidence intervals on model differences.

Because models rank the **same requests**, paired analysis is usually preferable to treating the scores as unrelated samples. Suppose a search corpus contains one million documents. Human evaluators cannot judge all of them for every query. Instead, evaluation may have relevance labels for only a subset. Now imagine a new model discovers a genuinely excellent document that the old system never surfaced. If that document lacks a relevance judgment, your offline metric may accidentally treat it as irrelevant or ignore it. This is known broadly as a problem of **incomplete judgments**. It matters especially when comparing a substantially new retrieval system with systems that generated the original evaluation pool. Offline benchmarks can systematically undervalue genuinely novel retrieval behavior.

Suppose Model B reranks roughly the same candidate set as Model A. Historical relevance labels may compare them reasonably well. Now suppose Model C uses an entirely new retrieval strategy and surfaces documents nobody has previously seen or labeled. Offline evaluation becomes much less trustworthy. This creates a useful rule:

$$
\boxed{
\text{The farther a new policy moves from the data-generating policy, the less complete offline evaluation may become.}
}
$$

This is one reason online experimentation remains important. Offline ranking metrics measure things like:

$$
NDCG
$$

$$
MRR
$$

$$
Recall@K
$$

Online evaluation may measure:

* click-through rate,
* conversion,
* dwell time,
* reformulation rate,
* session success,
* abandonment,
* revenue,
* retention.

These metrics are closer to user outcomes. But online metrics also have complications:

* position bias,
* novelty effects,
* delayed outcomes,
* feedback loops,
* confounding,
* strategic user behavior.

Therefore a strong ranking evaluation stack often combines:

$$
\boxed{\text{offline relevance evaluation}}
$$

with:

$$
\boxed{\text{online outcome measurement}}
$$

Suppose your team repeatedly observes:

$$
\Delta NDCG@10>0
$$

but online user satisfaction does not improve. That is evidence that NDCG@10 may be a poor proxy for the actual product goal. A good offline metric should ideally have empirical predictive validity:

$$
\Delta M_{\text{offline}}
$$

should tend to align with:

$$
\Delta U_{\text{online}}
$$

where $$U$$ is user or business utility. If there is no relationship, optimizing the offline metric may become metric gaming rather than product improvement. Ranking systems often use engagement metrics, but engagement is not automatically equivalent to utility. For example, a search system could increase:

$$
\text{time spent}
$$

because users struggle to find what they want. In this case:

$$
\text{time spent}\uparrow
$$

could indicate:

$$
\text{quality}\downarrow
$$

Similarly, more clicks can mean:

* greater interest,
* or greater difficulty finding the right result.

Metrics must be interpreted causally and contextually. The first-principles question remains:

$$
\boxed{\text{What user outcome are we actually trying to create?}}
$$

## What Should a Reproducible Ranking Report and Release Specification Contain?
<!-- section-summary: A reproducible report fixes requests, labels, K values, segment definitions, metrics, examples, uncertainty, guardrails, and release thresholds. -->

The worked example and report format preserve these choices so candidate comparisons use identical requests and definitions.

A useful mental map is:

| Task shape                                 | Useful metric                    |
| ------------------------------------------ | -------------------------------- |
| Need a clean top $$K$$                     | Precision@K                      |
| Need to recover most relevant items        | Recall@K                         |
| Need first correct result quickly          | MRR                              |
| Need several binary-relevant results early | MAP                              |
| Relevance has multiple grades              | NDCG                             |
| Need candidate-generation coverage         | Recall at large K                |
| Need constrained review queue              | Precision@K / Recall@K           |
| Need set variety                           | Diversity / coverage metrics     |
| Need operational reliability               | Latency / eligibility guardrails |

The metric should be selected from the **shape of the user task**, not from convention. Suppose a query has four relevant documents:

$$
A,\ C,\ D,\ F
$$

The system returns:

| Rank | Document | Relevant |
| ---: | -------- | --------- |
|    1 | A        | Yes       |
|    2 | B        | No        |
|    3 | C        | Yes       |
|    4 | E        | No        |
|    5 | D        | Yes       |

### Precision@5

There are three relevant results in five:

$$
P@5=\frac35=0.6
$$

### Recall@5

Three of four total relevant documents were retrieved:

$$
R@5=\frac34=0.75
$$

### Reciprocal Rank

The first relevant result is rank 1:

$$
RR=1
$$

### Average Precision

Precision at relevant ranks:

At 1:

$$
1
$$

At 3:

$$
\frac23
$$

At 5:

$$
\frac35
$$

There are four relevant documents in total, including one not retrieved. Therefore:

$$
AP
=
\frac{
1+\frac23+\frac35
}{4}
$$

$$
\approx0.567
$$

Notice how each metric tells a different story. MRR says:

Excellent—the first result is relevant.

Recall says:

We recovered most, but not all, relevant documents.

Precision says:

40% of the top five slots were wasted.

AP combines multiple aspects of early retrieval. None is contradictory. Suppose Model A has:

$$
NDCG@10=0.86
$$

and Model B:

$$
NDCG@10=0.88
$$

It is tempting to declare B the winner. But perhaps B also has:

$$
p99\ latency=1.8s
$$

instead of:

$$
300ms
$$

Perhaps:

$$
Recall@100
$$

fell sharply. Perhaps category diversity collapsed. Perhaps certain regions became much worse. Perhaps new items are rarely surfaced. A useful release decision therefore needs:

$$
\boxed{\text{primary ranking metric}}
$$

plus:

$$
\boxed{\text{guardrails}}
$$

Suppose the main product experience is search. You might specify:

$$
\text{maximize }NDCG@10
$$

subject to:

$$
Recall@100\ge98\%
$$

$$
p95\ latency<250ms
$$

$$
\text{eligibility violations}=0
$$

$$
NDCG_{\text{worst major segment}}>0.70
$$

$$
\text{coverage does not fall by more than 2\%}
$$

This is often clearer than inventing a composite metric such as:

$$
0.5NDCG+0.2Recall+0.1Diversity+0.2Latency
$$

unless those weights correspond to real utility. A strong evaluation pipeline records enough information that another person can reproduce the result. At minimum, record:

* evaluation dataset version,
* relevance-label version,
* query sampling method,
* candidate corpus snapshot,
* model version,
* feature version,
* filtering rules,
* $$K$$ values,
* metric definitions,
* aggregation method,
* random seed where applicable,
* segment definitions,
* confidence intervals,
* baseline model.

Why? Because:

$$
NDCG@10=0.834
$$

means little if nobody knows:

* which queries,
* which corpus,
* which relevance labels,
* which filtering rules,
* which version of the model.

Evaluation is a measurement process, so provenance matters. Suppose Model A is evaluated on one sample of queries and Model B on another. A difference may simply reflect query difficulty. A stronger design evaluates both models on the same requests:

$$
q_1,q_2,\ldots,q_N
$$

Then compare:

$$
M_A(q_i)
$$

with:

$$
M_B(q_i)
$$

for every $$i$$. This produces paired comparisons and substantially reduces unnecessary variance. It also lets you answer:

Which exact queries improved, and which regressed

That diagnostic information is often more valuable than the overall score. Metrics compress information. That compression is useful, but dangerous. Two rankings can receive similar metric values while failing in qualitatively different ways. So evaluation should include direct inspection of examples such as:

* largest improvements,
* largest regressions,
* zero-relevance results,
* high-frequency queries,
* important tail queries,
* surprising high-confidence rankings.

Metrics tell you:

$$
\text{whether something changed}
$$

Examples often tell you:

$$
\text{why}
$$

A mature ranking evaluation process uses both. A useful report might contain:

| Evaluation dimension          | Example metric                     |
| ----------------------------- | ---------------------------------- |
| Candidate coverage            | Recall@1000                        |
| Top-result relevance          | Precision@10                       |
| Overall ordered relevance     | NDCG@10                            |
| First-result success          | MRR                                |
| Multi-result binary relevance | MAP                                |
| Tail-query quality            | NDCG@10 by query frequency segment |
| Catalogue coverage            | Coverage                           |
| Result variety                | Diversity                          |
| Constraint compliance         | Eligibility violation rate         |
| Speed                         | p50 / p95 / p99 latency            |
| Reliability                   | Confidence intervals               |
| Comparison                    | Per-query delta vs baseline        |

Not every system requires every row. The goal is to measure the dimensions that determine real usefulness. Suppose we are evaluating a search reranker. A disciplined specification might say:

**Primary metric:** NDCG@10
**Evaluation unit:** search query
**Relevance scale:** 0–3 human judgments
**Evaluation set:** fixed time-valid sample of production queries
**Candidate set:** frozen retriever output
**Baseline:** current production reranker
**Candidate guardrail:** Recall@100 unchanged within 0.5 percentage points
**Latency guardrail:** p95 below 200 ms
**Eligibility:** zero critical violations
**Segments:** head queries, tail queries, language, category
**Uncertainty:** paired bootstrap 95% confidence interval
**Release rule:** statistically credible NDCG gain with no guardrail regression

This makes model comparison much less arbitrary.

## How Does Expected Utility Tie the Ranking Metrics Together?
<!-- section-summary: Expected utility expresses ranking as limited attention allocated across positions, users, benefits, costs, and system constraints. -->

The final utility view explains why no one ranking score can represent every benefit, cost, and constraint.

Suppose a ranked list is:

$$
L=[d_1,d_2,\ldots,d_K]
$$

A user receives some utility:

$$
U(L,q)
$$

The ideal system would choose:

$$
L^*
=
\arg\max_L
E[U(L,q)]
$$

But real user utility is difficult to observe directly. So ranking metrics act as proxies. Precision@K approximates:

$$
\text{usefulness of limited top slots}
$$

MRR approximates:

$$
\text{utility of finding the first useful result quickly}
$$

NDCG approximates:

$$
\text{utility from graded relevance discounted by position}
$$

Recall@K approximates:

$$
\text{value of recovering available useful information}
$$

Therefore ranking metrics are best understood as simplified models of user utility. In ordinary supervised prediction, you often observe:

$$
(x_i,y_i)
$$

and compare:

$$
\hat y_i
$$

with:

$$
y_i
$$

Ranking is more complicated because:

1. outputs are lists,
2. order matters,
3. users inspect only part of the list,
4. relevance may be graded,
5. several items may be useful,
6. the available item set changes,
7. user interaction depends on the ranking itself,
8. historical observations are biased by previous ranking policies.

So there is usually no single natural notion of "correct ranking." Instead, evaluation asks:

$$
\boxed{\text{How much useful information did we put where users were likely to benefit from it?}}
$$

When designing ranking evaluation, work through this chain:

$$
\boxed{
\text{User task}
\rightarrow
\text{What counts as relevant}
\rightarrow
\text{How many results matter}
\rightarrow
\text{How position affects utility}
\rightarrow
\text{Metric}
}
$$

Then check the pipeline:

$$
\boxed{
\text{candidate recall}
\rightarrow
\text{reranking quality}
\rightarrow
\text{final list}
}
$$

Then add production constraints:

$$
\boxed{
\text{latency}
+
\text{eligibility}
+
\text{diversity}
+
\text{coverage}
}
$$

Then add statistical robustness:

$$
\boxed{
\text{segments}
+
\text{uncertainty}
+
\text{paired baseline comparison}
}
$$

Finally verify:

$$
\boxed{
\text{offline improvement}
\rightarrow
\text{better online outcomes}
}
$$

Ranking evaluation is fundamentally about **ordered utility**. A ranking system does not merely ask:

$$
\text{“Did we retrieve something relevant?”}
$$

It asks:

$$
\boxed{
\text{“Did we put the right things high enough in the list for the user to benefit?”}
}
$$

Different metrics encode different versions of that question. Precision@K asks:

$$
\boxed{\text{How many of the top }K\text{ slots are useful?}}
$$

Recall@K asks:

$$
\boxed{\text{How much of the useful material did we recover?}}
$$

MRR asks:

$$
\boxed{\text{How quickly does the first useful result appear?}}
$$

MAP asks:

$$
\boxed{\text{Do multiple relevant results appear early?}}
$$

NDCG asks:

$$
\boxed{\text{Are highly relevant items placed near the top?}}
$$

And production guardrails ask:

$$
\boxed{\text{Can the system do this quickly, safely, broadly, and reliably?}}
$$

The central rule is therefore:

$$
\boxed{
\text{Choose a ranking metric by modeling how users obtain value from positions in the ranked list.}
}
$$

Not:

$$
\boxed{
\text{Choose whichever ranking metric is most common.}
}
$$

Once the user task, relevance definition, candidate pipeline, attention depth, and production constraints are clear, metric selection becomes much more principled.

![Ranking release evidence joins the experience definition, valid labels, per-request metrics, product guardrails, and a reversible scope](/content-assets/articles/article-mlops-model-evaluation-ranking-retrieval-evaluation/ranking-release-evidence.png)

*A ranking score supports a release only when it travels with the exact request set, relevance policy, guardrails, uncertainty, and compatible rollback pair.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What User Experience and Relevance Definition Does a Ranking Create?]{kind="recap"}
Ranking evaluation starts from the request, candidate set, ordered experience, and relevance labels that define what a useful result means.
:::

:::expand[How Do Precision at K and Recall at K Measure the Top Results?]{kind="recap"}
Precision at K measures useful use of limited top slots, while Recall at K measures how much available relevant material the list recovered.
:::

:::expand[How Do MRR, MAP, DCG, and NDCG Reward Rank Position?]{kind="recap"}
MRR emphasizes the first success, MAP rewards multiple early successes, and DCG/NDCG combine graded relevance with position discounting.
:::

:::expand[How Do Click Bias, Time, Candidate Recall, and RAG Change Retrieval Evaluation?]{kind="recap"}
Observed clicks reflect the old ranking policy, time changes validity, candidate generation caps reranking, and RAG may require several complementary pieces of evidence.
:::

:::expand[How Do Diversity, Coverage, Eligibility, Latency, and Segments Affect Ranking Quality?]{kind="recap"}
Useful rankings also balance diversity, catalogue coverage, eligibility, latency, request frequency, segments, and distributional behaviour.
:::

:::expand[How Do Paired Comparisons and Online Outcomes Extend Offline Ranking Tests?]{kind="recap"}
Paired offline comparisons isolate list changes, while online experiments test causal product outcomes and guard against misleading engagement targets.
:::

:::expand[What Should a Reproducible Ranking Report and Release Specification Contain?]{kind="recap"}
A reproducible report fixes requests, labels, K values, segment definitions, metrics, examples, uncertainty, guardrails, and release thresholds.
:::

:::expand[How Does Expected Utility Tie the Ranking Metrics Together?]{kind="recap"}
Expected utility expresses ranking as limited attention allocated across positions, users, benefits, costs, and system constraints.
:::
