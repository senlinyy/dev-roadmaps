---
title: "Inference Cost and Scale"
description: "Understand latency, throughput, concurrency, queues, saturation, autoscaling, capacity, and cost as one production inference system."
overview: "Inference capacity determines how much prediction traffic a service can accept at the promised speed and reliability. The capacity system connects request timing, arrival patterns, safe concurrency, overload control, autoscaling delay, headroom, and cost per accepted result."
tags: ["MLOps", "serving", "performance", "autoscaling"]
order: 1
id: "article-mlops-model-serving-latency-throughput-autoscaling-cost"
---

## Table of Contents

1. [What Work and Metrics Define Inference Cost and Scale?](#what-work-and-metrics-define-inference-cost-and-scale)
2. [Why Does Latency Rise near Capacity, and How Should the Full Path Be Measured?](#why-does-latency-rise-near-capacity-and-how-should-the-full-path-be-measured)
3. [How Do Concurrency, Bounded Queues, Backpressure, Retries, Batching, and Memory Interact?](#how-do-concurrency-bounded-queues-backpressure-retries-batching-and-memory-interact)
4. [How Do Autoscaling, Headroom, Cold Starts, Resilience, and Workload Classes Shape Capacity?](#how-do-autoscaling-headroom-cold-starts-resilience-and-workload-classes-shape-capacity)
5. [How Do You Measure Cost per Accepted Result?](#how-do-you-measure-cost-per-accepted-result)
6. [How Do Open-Loop and Closed-Loop Tests Find Sustainable Throughput?](#how-do-open-loop-and-closed-loop-tests-find-sustainable-throughput)
7. [How Should Capacity Regressions and Releases Be Controlled?](#how-should-capacity-regressions-and-releases-be-controlled)
8. [Which Curves Explain Inference Capacity as a Budget?](#which-curves-explain-inference-capacity-as-a-budget)
9. [Check Your Answers](#check-your-answers)

A service handles 100 requests per second comfortably and appears to need only 20% more hardware for 120. Instead, latency rises sharply, retries add traffic, and the queue grows without bound. The system crossed its sustainable capacity knee.

Inference capacity is the rate at which finite resources complete useful work under a latency and reliability objective. Concurrency, batching, queues, memory, autoscaling, cold starts, and request size all change that rate. Cost is meaningful only when attached to an accepted result, not merely an allocated machine.

Use these questions to build a measured capacity plan from the request path to progressive release control:

1. **What Work and Metrics Define Inference Cost and Scale?**
2. **Why Does Latency Rise near Capacity, and How Should the Full Path Be Measured?**
3. **How Do Concurrency, Bounded Queues, Backpressure, Retries, Batching, and Memory Interact?**
4. **How Do Autoscaling, Headroom, Cold Starts, Resilience, and Workload Classes Shape Capacity?**
5. **How Do You Measure Cost per Accepted Result?**
6. **How Do Open-Loop and Closed-Loop Tests Find Sustainable Throughput?**
7. **How Should Capacity Regressions and Releases Be Controlled?**
8. **Which Curves Explain Inference Capacity as a Budget?**

## What Work and Metrics Define Inference Cost and Scale?
<!-- section-summary: Serving converts arriving work into accepted results with finite compute, memory, bandwidth, time, and money, measured through rates, latency, queueing, and errors. -->

Capacity planning starts with the work each request consumes and the rate at which finite resources can finish it.

The easiest way to understand model serving is to ignore GPUs, Kubernetes, autoscalers, and dashboards for a moment. At the most basic level, a serving system does this:

$$
\text{incoming requests} \rightarrow \text{finite resources} \rightarrow \text{results}
$$

Every request consumes some amount of **work**. The serving system has a finite rate at which it can perform that work. If requests arrive faster than work can be completed, unfinished work accumulates somewhere—usually in a queue—and latency rises. Almost everything about inference capacity, scaling, batching, concurrency, overload, and cost follows from that fact. Suppose requests arrive at rate

$$
\lambda = 100 \text{ requests/second}
$$

and one machine can sustainably process

$$
\mu = 25 \text{ requests/second}.
$$

Four machines theoretically provide:

$$
4 \times 25 = 100 \text{ requests/second}.
$$

That looks sufficient. But it usually isn't. At exactly 100% utilization, any randomness causes requests to accumulate:

* some requests are bigger than others;
* hardware occasionally stalls;
* batches aren't perfectly full;
* network latency fluctuates;
* garbage collection or kernel scheduling introduces pauses;
* model outputs have variable length;
* traffic arrives in bursts rather than perfectly evenly.

So a production system needs:

$$
\text{available capacity} > \text{expected demand}.
$$

This excess is **headroom**. A useful capacity model is:

$$
\boxed{
\text{Demand} = \text{arrival rate} \times \text{work per request}
}
$$

and

$$
\boxed{
\text{Supply} = \text{number of replicas} \times \text{safe work rate per replica}
}
$$

You need demand to remain comfortably below supply. That is the core of inference scaling. People often say:

"This model costs $X per request."

But a request isn't a fundamental unit of computation. Compare two LLM requests:

**Request A**

* 100 input tokens
* 20 output tokens

**Request B**

* 20,000 input tokens
* 2,000 output tokens

Counting both as "one request" hides an enormous difference in work. For other models, request complexity might depend on:

* image resolution;
* number of images;
* audio duration;
* sequence length;
* number of retrieved documents;
* model size;
* number of diffusion steps;
* beam-search width.

So fundamentally:

$$
\text{Cost per request}
=
\text{resources consumed by that request}
\times
\text{resource price}.
$$

For a self-hosted model, a simplified version is:

$$
\text{Cost}
\approx
\text{GPU seconds}
+
\text{CPU seconds}
+
\text{memory}
+
\text{network}
+
\text{storage}
+
\text{idle capacity}.
$$

Idle capacity matters enormously. If an $3/hour GPU handles 100 requests/hour, its infrastructure cost is:

$$
\$3 / 100 = \$0.03
$$

per request. If the same GPU handles 100,000 requests/hour:

$$
\$3 / 100000 = \$0.00003.
$$

Same hardware. Same hourly cost. A **1000× difference in cost/request** simply because utilization is different. So inference economics are fundamentally about converting purchased resource-seconds into useful completed work. Scale is not simply "how many requests can the system handle?" A better definition is:

**How much useful workload can the system sustainably serve while satisfying its latency, reliability, and quality requirements?**

Imagine a server reaches:

* 200 req/s with p99 latency = 30 seconds;
* 160 req/s with p99 latency = 700 ms.

If your service-level objective is:

$$
p99 < 1\text{ second},
$$

your practical capacity is closer to 160 req/s, not 200. Therefore:

$$
\boxed{\text{Capacity is constrained throughput, not maximum throughput.}}
$$

A common mistake is:

"We expect 10,000 requests per second. How many GPUs?"

You're missing the workload. You first need to know what a request looks like. For an LLM, at minimum you might measure distributions of:

$$
T_{in} = \text{input tokens}
$$

and

$$
T_{out} = \text{generated tokens}.
$$

A rough work model could be:

$$
W = aT_{in}+bT_{out}+c.
$$

The constants $$a$$, $$b$$, and $$c$$ should ultimately come from measurements rather than theory. Why distinguish input and output tokens? Because transformer inference has two rather different stages.

### Prefill

The prompt is processed. For a 4,000-token prompt, many prompt-token operations can be executed in parallel.

### Decode

Tokens are generated sequentially:

$$
y_1 \rightarrow y_2 \rightarrow y_3 \rightarrow \cdots
$$

You cannot normally generate token 100 before token 99 exists. So 1,000 input tokens and 1,000 output tokens generally don't impose identical serving costs. This is why **requests/sec alone can be a terrible capacity metric for generative models**. There are several quantities that people frequently mix together.

### Throughput

How much completed work leaves the system per unit time. Examples:

$$
120\text{ requests/sec}
$$

or

$$
18,000\text{ tokens/sec}.
$$

Throughput measures flow.

### Latency

How long an individual request takes. For ordinary inference:

$$
L =
t_{\text{response}}
-
t_{\text{request}}.
$$

For streaming LLMs you usually care about several latency metrics:

**Time to first token (TTFT)**

$$
TTFT =
t_{\text{first token}}
-
t_{\text{request}}.
$$

**Inter-token latency** or **time per output token** How quickly subsequent tokens arrive. **End-to-end latency**

$$
t_{\text{last token}}
-
t_{\text{request}}.
$$

Users can tolerate a 10-second total generation much better when the first token arrives after 300 ms than when nothing appears for 9 seconds.

### Concurrency

How many requests are currently inside some part of the system.

For example:

$$
C=80
$$

means 80 requests are simultaneously in flight. Concurrency is a quantity of outstanding work, whereas throughput is a rate of completed work.

### Utilization

The fraction of some resource's capacity currently being used.

For example:

$$
GPU\ utilization = 72\%.
$$

Be careful with this metric. A GPU is composed of multiple constrained resources:

* arithmetic units;
* HBM capacity;
* memory bandwidth;
* communication bandwidth;
* tensor cores;
* caches.

"GPU utilization = 90%" does not automatically mean you're extracting 90% of theoretical useful inference capacity.

### Saturation

Saturation is more useful conceptually:

Has some required resource become sufficiently constrained that additional demand mainly creates waiting

A server may become saturated because of:

* GPU compute;
* GPU memory;
* memory bandwidth;
* KV-cache capacity;
* CPU preprocessing;
* network bandwidth;
* batch scheduler limits;
* concurrent request limits.

At saturation, latency generally begins increasing much faster than throughput.

## Why Does Latency Rise near Capacity, and How Should the Full Path Be Measured?
<!-- section-summary: Capacity has a knee where queues grow rapidly; end-to-end histograms, percentiles, traffic distributions, and Little's Law explain the complete path. -->

As utilization approaches the limit, queueing dominates latency, which makes whole-path distributions and rate relationships essential.

Imagine increasing load against one replica.

| Offered load | Completed throughput | p99 latency |
| -----------: | -------------------: | ----------: |
|     20 req/s |                   20 |      150 ms |
|           40 |                   40 |      170 ms |
|           60 |                   60 |      220 ms |
|           80 |                   80 |      400 ms |
|           90 |                   90 |      900 ms |
|          100 |                   95 |       4 sec |
|          110 |                   95 |      15 sec |

Something interesting happens around 80–95 req/s. Before that point, increasing demand mostly produces more throughput. After that point, increasing demand mostly produces **more waiting**. Graphically:

```text
Latency
   ^
   |                         /
   |                      /
   |                   /
   |                /
   |            ___/
   |___________/
   +------------------------> Load
                  ^
                knee
```

The knee matters more than the theoretical maximum. A safe operating point might therefore be 70–80 req/s even though the machine can briefly complete 95 req/s. Consider a single worker whose mean service rate is:

$$
\mu=100\text{ requests/sec}.
$$

If traffic arrives at:

$$
\lambda=50,
$$

there is lots of spare capacity. Utilization is:

$$
\rho = \frac{\lambda}{\mu}=0.5.
$$

Now increase traffic:

$$
\lambda=99.
$$

Then:

$$
\rho=0.99.
$$

The worker technically still has enough average capacity. But suppose several unusually slow requests arrive together. There is almost no spare capacity available to catch up. A simplified queueing model illustrates the effect. For an M/M/1 queue:

$$
W=\frac{1}{\mu-\lambda}.
$$

If:

$$
\mu=100
$$

then at 50 req/s:

$$
W=\frac{1}{100-50}=0.02s.
$$

At 90:

$$
W=0.10s.
$$

At 99:

$$
W=1s.
$$

At 99.9:

$$
W=10s.
$$

The exact formula won't describe most ML systems accurately, but the lesson survives:

$$
\boxed{\text{Queueing delay becomes highly nonlinear near saturation.}}
$$

That is the fundamental reason you leave headroom. Suppose your model dashboard says:

inference latency = 240 ms.

Your user reports:

requests take 900 ms.

Both can be correct. A real request might experience:

$$
\begin{aligned}
L =
L_{\text{network}} \\
&+L_{\text{load balancer}} \\
&+L_{\text{authentication}} \\
&+L_{\text{queue}} \\
&+L_{\text{batch wait}} \\
&+L_{\text{preprocessing}} \\
&+L_{\text{model}} \\
&+L_{\text{postprocessing}} \\
&+L_{\text{return network}}.
\end{aligned}
$$

For example:

| Stage            |       Time |
| ---------------- | ---------: |
| Network          |      70 ms |
| Gateway/auth     |      25 ms |
| Queue            |     350 ms |
| Batch waiting    |     100 ms |
| Model            |     240 ms |
| Postprocessing   |      15 ms |
| Response/network |     100 ms |
| **Total**        | **900 ms** |

Optimizing model inference from 240 ms to 180 ms only saves 60 ms. Reducing queueing from 350 ms to 50 ms saves 300 ms. You therefore want timestamps around important boundaries rather than one giant "latency" metric. Suppose ten requests have latency:

```text
100 100 100 100 100
100 100 100 100 5100 ms
```

Mean latency is:

$$
\frac{6000}{10}=600\text{ ms}.
$$

But nine users received a response in 100 ms and one waited 5.1 seconds. The average describes neither experience particularly well. That motivates percentiles.

### p50

Half of requests are faster and half slower. Approximately the typical experience.

### p95

95% are faster; 5% are slower.

### p99

99% are faster; 1% are slower. Large production systems care heavily about p99 because even 1% represents many requests. At one million requests/day:

$$
1\% = 10,000
$$

requests/day. Suppose replica A reports:

$$
p99=200ms
$$

and replica B:

$$
p99=1000ms.
$$

You cannot calculate global p99 as:

$$
\frac{200+1000}{2}=600ms.
$$

Quantiles don't compose that way. You need the underlying latency distribution—usually represented by mergeable histograms. Another subtlety:

$$
p99(A+B)
\neq
p99(A)+p99(B).
$$

If request latency consists of queue + inference + network, simply adding each component's p99 usually produces the wrong total. Percentiles must come from the distribution you're actually interested in. Suppose latency has two modes:

```text
       ****
      ******                        ***
     ********                      *****
----|---------|---------|---------|-------
  100ms     500ms      1s        5s
```

Why are some requests clustered around 100 ms and others around 5 s? Possibilities include:

* one unhealthy replica;
* cache miss versus hit;
* short versus long prompts;
* cold versus warm models;
* one hardware class slower than another;
* batched versus unbatched requests.

A mean or p95 can hide this structure. Histograms help you ask the more useful question:

What populations of requests exist

Another common failure is running:

"1,000 requests/sec"

against a model. That's incomplete. Real traffic has at least three important dimensions:

$$
\text{arrival pattern}
$$

$$
\text{request work distribution}
$$

$$
\text{service objective}.
$$

For example:

```text
Average rate:          1,000 requests/s
Peak rate:             2,200 requests/s
Burst:                 4,000 requests within 2 seconds
Input tokens:
  p50                     400
  p95                   4,000
  p99                  15,000
Output tokens:
  p50                      80
  p95                     500
  p99                   1,500
TTFT target:
  p99                    <1 s
```

That is far more meaningful than "1,000 RPS." The size distribution matters enormously. Testing exclusively with average-sized prompts can dramatically overestimate capacity. One of the most valuable relationships in serving systems is:

$$
\boxed{L=\lambda W}
$$

where:

* $$L$$ = average number of requests in the system;
* $$\lambda$$ = throughput;
* $$W$$ = average time each request spends in the system.

Suppose:

$$
\lambda=50\text{ requests/sec}
$$

and average end-to-end request time is:

$$
W=0.8s.
$$

Then:

$$
L=50\times0.8=40.
$$

You should expect roughly:

$$
\boxed{40\text{ concurrent requests}}
$$

on average. This is surprisingly powerful. If monitoring reports:

```text
50 req/s
800 ms average latency
4 concurrent requests
```

something is inconsistent. Perhaps:

* concurrency is being measured at only one internal stage;
* latency includes client-side queueing;
* throughput metric is wrong;
* sampling is broken.

Little's Law gives you an independent consistency check.

![Seven stages in an inference request from the service timer and admission through queueing, input preparation, model execution, output handling, and a usable result, with latency, throughput, and percentile views.](/content-assets/articles/article-mlops-model-serving-latency-throughput-autoscaling-cost/request-path-latency.png)

*Measure the full request boundary and keep accepted latency beside throughput, request-shape percentiles, and rejection, because a fast model alone does not prove a fast or useful service.*

## How Do Concurrency, Bounded Queues, Backpressure, Retries, Batching, and Memory Interact?
<!-- section-summary: Concurrency only creates in-flight work, bounded queues and backpressure contain overload, retries amplify it, batching improves efficiency with delay, and memory sets another limit. -->

The next controls decide how much work may enter and wait: concurrency, queues, backpressure, retries, batching, and memory.

Suppose one model server can run 32 requests concurrently. That doesn't necessarily mean 32 is optimal. Increasing concurrency has competing effects. At low concurrency, hardware can be underutilized:

```text
Concurrency = 1
GPU often waits
Poor throughput
Low queueing
```

Increasing concurrency can fill idle execution slots:

```text
Concurrency = 8
Better GPU utilization
Higher throughput
```

But eventually:

```text
Concurrency = 64
GPU already saturated
Requests contend for resources
Queueing rises
KV cache pressure rises
Tail latency explodes
```

So you often see:

```text
Throughput
   ^
   |                   __________
   |               ___/
   |           ___/
   |       ___/
   |______/
   +--------------------------> concurrency


Latency
   ^
   |                       /
   |                    __/
   |                ___/
   |______________/
   +--------------------------> concurrency
```

The goal isn't maximum concurrency. It is the concurrency that gives good utilization **without violating your latency budget**. Suppose experiments give:

| Concurrency | Throughput |      p99 |
| ----------: | ---------: | -------: |
|           4 |   40 req/s |   200 ms |
|           8 |         75 |   230 ms |
|          16 |        120 |   300 ms |
|          24 |        145 |   500 ms |
|          32 |        155 |   900 ms |
|          48 |        158 | 3,000 ms |

If your target is:

$$
p99 < 1s,
$$

32 technically passes. But operating permanently at the boundary is risky. You may choose:

$$
C_{\text{safe}}=24.
$$

Notice that going from concurrency 24 to 48:

* throughput increases only $$145 \rightarrow 158$$;
* latency increases $$500 \rightarrow 3000$$ ms.

That's a terrible trade. This is another way to locate the saturation knee. Suppose your service can complete:

$$
100\text{ req/s}
$$

but suddenly receives:

$$
1,000\text{ req/s}.
$$

An unbounded queue appears attractive:

"We'll just buffer everything."

But every second:

$$
1000-100=900
$$

additional requests enter the backlog. After 10 seconds:

$$
9,000
$$

requests are waiting. Even if traffic instantly returns to normal, the backlog can take a long time to drain. Meanwhile users receive responses long after they're useful. An unlimited queue doesn't create capacity. It converts overload into latency and memory consumption. Instead, suppose you permit only:

* 100 actively executing requests;
* 200 queued requests.

Once those limits are reached, you stop accepting additional work. Possible responses include:

* HTTP 429;
* HTTP 503;
* explicit retry instructions;
* upstream rate limiting.

It feels counterintuitive to reject traffic deliberately. But compare:

**Unbounded system**

```text
100% accepted initially
latency → 30 seconds
timeouts
retries
more traffic
collapse
```

**Bounded system**

```text
95% accepted
accepted requests remain fast
5% rejected immediately
clients can retry appropriately
system remains healthy
```

A fast rejection is often much more useful than a response that arrives after the user's deadline. This leads to an important distinction:

$$
\text{offered traffic}
\neq
\text{accepted traffic}.
$$

Capacity calculations should distinguish the two. Imagine the server receives 1,000 requests/s but handles only 800. Two hundred fail. If every failed request immediately retries, you now receive:

$$
1000+200=1200.
$$

More fail, causing more retries. This positive feedback loop is called a **retry storm**. Backpressure therefore works best with:

* exponential backoff;
* jitter;
* retry limits;
* rate limits;
* circuit breakers;
* admission control.

The fundamental idea is to prevent demand from recursively creating even more demand. Suppose a GPU takes approximately:

$$
10ms + 2ms\times N
$$

to process a batch containing $$N$$ requests. The 10 ms represents fixed overhead. Batch size 1:

$$
12ms
$$

for one request. Throughput:

$$
\frac{1}{0.012}\approx83\text{ req/s}.
$$

Batch size 8:

$$
10+16=26ms.
$$

Eight requests complete in 26 ms:

$$
\frac{8}{0.026}\approx308\text{ req/s}.
$$

Batching amortized the fixed cost. It can also let GPUs exploit more parallelism. To create a batch, the scheduler may have to wait. Suppose:

$$
\text{batch wait}=20ms
$$

and batching reduces model execution:

$$
100ms\rightarrow60ms.
$$

Then:

$$
20+60=80ms.
$$

Great. But if traffic is sparse and building the batch requires 200 ms:

$$
200+60=260ms.
$$

Now batching made latency worse. Thus:

$$
\boxed{\text{Batch until marginal throughput gains stop justifying latency cost.}}
$$

The optimal batch size therefore depends on load and the latency SLO. Imagine batching these sequence lengths:

```text
100
110
120
4,000
```

If your implementation pads everything to the longest sequence, you may effectively process:

$$
4\times4000=16,000
$$

token positions despite having only:

$$
100+110+120+4000=4,330
$$

real token positions. That is enormous wasted computation. This is why sophisticated model servers may:

* bucket requests by size;
* dynamically batch;
* continuously add/remove sequences;
* schedule based on token count rather than request count.

For LLM serving, **continuous batching** is particularly useful because different requests produce different numbers of output tokens. A request that finishes can leave the batch while another request joins. Compute isn't the only constraint. For an autoregressive transformer, each active sequence generally needs a KV cache representing prior tokens. Very roughly:

$$
M_{\text{KV}}
\propto
\text{active sequences}
\times
\text{sequence length}
\times
\text{model structure}.
$$

Consequently:

```text
32 concurrent short prompts
```

might fit easily while

```text
32 concurrent 100k-token contexts
```

does not. So a fixed "maximum requests = 64" may be less useful than a resource budget such as:

$$
\text{maximum active tokens}
$$

or

$$
\text{maximum KV-cache blocks}.
$$

This is a recurring theme:

> **Scale should often be measured in work units, not request units.**

## How Do Autoscaling, Headroom, Cold Starts, Resilience, and Workload Classes Shape Capacity?
<!-- section-summary: Autoscaling reacts after demand changes, so safe operation needs headroom, useful signals, cold-start planning, redundancy, and separate classes for very different work. -->

Because demand changes over time, autoscaling and resilience need headroom and workload-aware signals rather than assuming new capacity appears instantly.

Suppose you currently have four replicas. At 12:00:00 traffic doubles. An autoscaler doesn't instantly produce eight fully operational replicas. The sequence might be:

```text
traffic increases
      ↓
queue begins growing
      ↓
metrics observe growth
      ↓
metrics exported
      ↓
autoscaler evaluates
      ↓
new replica requested
      ↓
machine provisioned
      ↓
container starts
      ↓
model weights loaded
      ↓
runtime initializes
      ↓
server warms up
      ↓
capacity finally increases
```

If that process takes two minutes, then autoscaling is responding to traffic from roughly two minutes ago. This is a control-system problem. Suppose traffic jumps instantly:

$$
1,000 \rightarrow 3,000\text{ req/s}.
$$

Current fleet capacity:

$$
1,500\text{ req/s}.
$$

New replicas take 90 seconds to become usable. During those 90 seconds, the autoscaler cannot create capacity retroactively. You need one or more of:

* spare capacity;
* bounded queues;
* traffic shaping;
* predictive scaling;
* scheduled scaling;
* faster startup;
* graceful rejection.

Autoscaling is best thought of as:

**A mechanism for moving capacity toward demand over time.**

It is not a substitute for overload protection. A weak mental model is:

"Scale when GPU utilization exceeds 80%."

GPU utilization might work, but ask what you're really trying to detect. If the bottleneck is request concurrency, you may scale from:

$$
\text{in-flight requests per replica}.
$$

If workloads are queued:

$$
\text{queue depth}.
$$

If request cost is predictable:

$$
\text{incoming work units/sec}.
$$

For LLMs, you might derive a signal from:

$$
\text{input tokens/sec}
$$

and

$$
\text{output tokens/sec}.
$$

If all requests are homogeneous, request rate can work well:

$$
\text{RPS per replica}.
$$

The principle is:

$$
\boxed{\text{Scale from the signal most closely related to the resource becoming saturated.}}
$$

Not simply the metric that's easiest to collect. Suppose there are 100 requests waiting. Is that bad? If throughput is:

$$
10,000\text{ req/s},
$$

the queue represents roughly:

$$
100/10000=10ms
$$

of work. Probably fine. If throughput is:

$$
10\text{ req/s},
$$

it represents:

$$
100/10=10s.
$$

Terrible. So queue depth is often more meaningful when converted to **estimated waiting time**.

Conceptually:

$$
\text{queue delay}
\approx
\frac{\text{queued work}}
{\text{processing capacity}}.
$$

Again, work matters more than raw request count. "Replica created" is not the same as "replica serving." A cold start can involve:

$$
T_{\text{cold}}
=
T_{\text{schedule}}
+
T_{\text{machine}}
+
T_{\text{image}}
+
T_{\text{weights}}
+
T_{\text{runtime}}
+
T_{\text{compile}}
+
T_{\text{warmup}}.
$$

Large model weights can make this substantial. Consequently, an autoscaling policy must ask:

How far ahead of demand do I need to begin adding capacity

Scale-to-zero means:

```text
no requests
→
zero serving replicas
→
very low idle cost
```

That's economically attractive. But the next request becomes:

```text
request
→
provision server
→
load model
→
initialize
→
run inference
```

The first user pays the cold-start penalty. Therefore scale-to-zero is usually most attractive when:

* requests are infrequent;
* startup is quick;
* latency requirements are loose;
* idle hardware is expensive.

It's less attractive when the service expects interactive low-latency responses. This is fundamentally a trade:

$$
\boxed{\text{idle cost} \leftrightarrow \text{cold-start latency}}
$$

Now suppose load testing tells you:

One replica can sustainably handle 18 req/s while keeping p99 below our target.

Forecast peak traffic:

$$
120\text{ req/s}.
$$

Naively:

$$
N=\left\lceil\frac{120}{18}\right\rceil=7.
$$

Seven replicas provide:

$$
7\times18=126.
$$

That's dangerously close to the expected peak. Suppose you want 20% headroom. Treat usable capacity per replica as:

$$
18\times0.8=14.4.
$$

Then:

$$
N=
\left\lceil
\frac{120}{14.4}
\right\rceil
=9.
$$

Nine replicas give substantially more breathing room. Suppose you require the service to survive the loss of one replica. Nine replicas normally provide:

$$
9\times18=162.
$$

With one failed:

$$
8\times18=144.
$$

Peak demand remains:

$$
120.
$$

Good. But failure domains can be larger than a single replica. You may need to survive:

* one host;
* one rack;
* one availability zone;
* one accelerator pool.

The appropriate reserve depends on your reliability requirement. So capacity planning is not merely:

$$
\frac{\text{traffic}}{\text{machine throughput}}.
$$

A more realistic concept is:

$$
\boxed{
\text{Required capacity}
=
\text{peak workload}
+
\text{latency headroom}
+
\text{failure reserve}
+
\text{growth reserve}
}
$$

while recognizing these aren't always simple additive percentages. Suppose your workload contains:

```text
80% small requests
15% medium requests
5% enormous requests
```

Average request size might suggest one replica handles:

$$
50\text{ requests/sec}.
$$

But bursts of enormous requests could saturate it. A better model could estimate work:

$$
W_i =
aT_{in,i}
+
bT_{out,i}.
$$

Then fleet demand becomes:

$$
W_{\text{total/sec}}
=
\lambda E[W].
$$

Better still, simulate the **actual empirical distribution**, including correlations. For example, perhaps long prompts also tend to produce long outputs. Assuming those dimensions are independent would underestimate the tail.

## How Do You Measure Cost per Accepted Result?
<!-- section-summary: Cost per accepted useful result includes failed, rejected, retried, idle, and batched work and exposes the real latency-cost trade. -->

Capacity is economically useful only when it produces accepted results, so cost accounting must include waste and the required service objective.

Suppose you operate 8 GPU replicas costing:

$$
\$3/\text{hour each}.
$$

Fleet cost:

$$
8\times3=\$24/\text{hour}.
$$

The fleet successfully delivers:

$$
40\text{ results/sec}.
$$

Per hour:

$$
40\times3600=144,000
$$

results. Infrastructure cost/result:

$$
\frac{24}{144000}
=
\$0.0001667.
$$

Approximately:

$$
\boxed{\$0.000167/\text{accepted result}}
$$

before other costs. Suppose your service receives 150,000 requests/hour, but:

* 5,000 time out;
* 1,000 fail;
* retries consume 10,000 executions;
* 4,000 results are discarded by downstream validation.

If your business actually receives only:

$$
140,000
$$

useful results, dividing cost by 150,000 makes economics look artificially good. A useful formulation is:

$$
\boxed{
\text{Cost per accepted result}
=
\frac{\text{total serving cost}}
{\text{useful accepted results}}
}
$$

Total serving cost should ideally include:

$$
C =
C_{\text{accelerators}}
+
C_{\text{CPU}}
+
C_{\text{memory}}
+
C_{\text{network}}
+
C_{\text{storage}}
+
C_{\text{supporting services}}
$$

plus the compute wasted on errors, retries, and rejected outputs when appropriate. This metric aligns infrastructure optimization with actual product value. Imagine one GPU costs:

$$
\$3/hour.
$$

Unbatched throughput:

$$
50\text{ results/sec}.
$$

Cost/result:

$$
\frac{3}{50\times3600}
=
\$0.0000167.
$$

With batching:

$$
150\text{ results/sec}.
$$

Cost/result:

$$
\frac{3}{150\times3600}
=
\$0.00000556.
$$

Roughly a 3× reduction. The latency of an individual computation didn't necessarily improve by 3×. Instead, you extracted more useful results from each GPU-second. That distinction is important:

$$
\boxed{\text{Efficiency improvement} \neq \text{individual latency improvement}.}
$$

Suppose batch size 1 gives:

```text
p99 latency: 100 ms
GPU utilization: 20%
cost/result: high
```

Batch size 32 gives:

```text
p99 latency: 900 ms
GPU utilization: 90%
cost/result: low
```

If the product allows:

$$
p99<1s,
$$

batch 32 may be excellent. If the product requires:

$$
p99<200ms,
$$

it may be unusable. Therefore optimization isn't:

$$
\min(\text{cost}).
$$

It is closer to:

$$
\min(\text{cost})
$$

subject to:

$$
p99 \le L_{\max},
$$

$$
error\ rate \le E_{\max},
$$

$$
quality \ge Q_{\min}.
$$

This is how an inference problem becomes an engineering optimization problem.

![A safe per-replica operating limit before the saturation knee, connected to bounded admission and the delayed path from an autoscaling signal to a ready replica.](/content-assets/articles/article-mlops-model-serving-latency-throughput-autoscaling-cost/safe-operating-point.png)

*The tested inflight limit and bounded queue protect current requests; a warm floor and headroom bridge the separate delay before autoscaling can add ready capacity.*

## How Do Open-Loop and Closed-Loop Tests Find Sustainable Throughput?
<!-- section-summary: Open-loop tests reveal overload under fixed arrivals, closed-loop tests reflect waiting clients, and realistic distributions find maximum sustainable rather than momentary throughput. -->

Those numbers require load tests that preserve real arrivals, work distributions, and queueing instead of hiding overload.

A useful load test answers:

What is the largest workload this system can sustainably process while meeting our service objectives

That means gradually increasing offered load and recording things such as:

* accepted throughput;
* latency distributions;
* TTFT;
* token generation rate;
* queue delay;
* GPU memory;
* compute utilization;
* batch sizes;
* errors;
* rejects;
* timeouts.

The crucial output isn't:

"It handled 10,000 RPS once."

It's something like:

"With the production request-size distribution, one replica sustainably handles 63 RPS while maintaining p99 < 800 ms and error rate < 0.1%; beyond approximately 70 RPS queueing rises sharply."

That's actionable capacity information. This distinction is extremely important. A simplistic client might do:

```text
send request
wait for response
send next request
```

Suppose the server slows down. The load generator now sends requests more slowly because it's waiting longer. Ironically, the test reduces offered load exactly when the server becomes overloaded. This is a **closed-loop** workload. It can hide capacity problems. For many online systems, you also want an **open-loop** test in which arrivals occur according to a target schedule:

```text
10:00:00.000 request
10:00:00.010 request
10:00:00.020 request
...
```

regardless of whether previous requests finished. That more realistically demonstrates what happens when users keep arriving while the service slows. A related benchmarking mistake is sometimes called **coordinated omission**. Imagine a request should have been sent every 10 ms. The server stalls for one second. If your load generator waits for the previous response, it skips the requests that would have arrived during that second. The resulting latency histogram underrepresents how bad real-world overload would have been. For capacity testing, your traffic generator should represent intended arrival times accurately. Suppose production prompts have:

$$
p50=500\text{ tokens}
$$

but

$$
p99=20,000\text{ tokens}.
$$

Benchmarking exclusively with 500-token prompts answers:

"What happens when every request resembles p50?"

It does not answer:

"What will happen in production?"

You should normally preserve the important characteristics of real traffic:

```text
request sizes
output lengths
burstiness
arrival rate
model selection
cache hit rate
request mix
streaming/nonstreaming
```

And test worst-case or adversarial-but-valid workloads separately. Suppose a machine handles:

$$
200\text{ req/s}
$$

for ten seconds. Then memory fills, queues grow, and throughput falls to 140 req/s. Its capacity is not meaningfully 200 req/s. A system is stable only when:

$$
\text{long-run accepted arrival rate}
\le
\text{long-run service rate}.
$$

Otherwise backlog keeps growing. Hence the word **sustainable** matters. Run tests long enough to expose:

* memory growth;
* cache behavior;
* thermal effects;
* queue accumulation;
* periodic maintenance;
* autoscaling behavior;
* resource fragmentation.

## How Should Capacity Regressions and Releases Be Controlled?
<!-- section-summary: Releases consume temporary capacity and can move the knee, so performance evidence, progressive exposure, and the full request path belong in correctness gates. -->

A new release can change both performance and available headroom, so capacity regressions need the same progressive control as functional changes.

Imagine you have ten replicas. You deploy a new version. During rollout:

* some old replicas terminate;
* new replicas load weights;
* caches are cold;
* JIT compilation happens;
* new containers warm up.

Even if steady-state capacity is unchanged, effective serving capacity during deployment may drop. That can cause:

```text
deployment
→ lower capacity
→ queues grow
→ autoscaler reacts
→ more replicas start
→ deployment progresses
→ demand/capacity oscillate
```

Capacity management and deployment strategy therefore interact. Suppose a runtime upgrade produces exactly the same model outputs but changes throughput:

$$
100\rightarrow75\text{ req/s}.
$$

That's a 25% serving-capacity regression. For a fleet of 100 GPUs, maintaining previous capacity might now require roughly:

$$
100\times\frac{100}{75}
\approx133
$$

GPUs. A "correct" software change just increased your required hardware by about one-third. Performance is therefore part of production correctness for inference infrastructure. For things that affect serving behavior—new model, quantization format, runtime, batch scheduler, kernel, GPU type, context limits—a safer pattern is:

```text
benchmark
    ↓
small canary
    ↓
compare latency / throughput / errors
    ↓
increase traffic gradually
    ↓
watch saturation
    ↓
continue or rollback
```

The important thing is to compare under equivalent workload distributions. Otherwise:

```text
old version gets hard requests
new version gets easy requests
```

can produce misleading performance conclusions. At this point, we can reduce most model-serving questions to four quantities.

### Demand

$$
D =
\lambda
\times
E[\text{work/request}].
$$

How much work users ask for.

### Supply

$$
S =
N
\times
\text{safe work/second/replica}.
$$

How much work your fleet can sustainably perform.

### Delay

As:

$$
D\rightarrow S,
$$

queues generally become increasingly sensitive to randomness. Hence:

$$
\boxed{\text{operating at }D=S\text{ is usually unsafe}}
$$

for an interactive service.

### Cost

$$
\text{Cost per accepted result}
=
\frac{\text{resource cost/time}}
{\text{accepted results/time}}.
$$

Which can be rewritten approximately as:

$$
\boxed{
\text{Cost/result}
\propto
\frac{\text{hardware price}}
{\text{useful hardware throughput}}
}
$$

plus supporting costs. This shows why the major serving optimizations are so economically valuable:

* batching increases useful throughput;
* quantization may increase throughput or reduce required hardware;
* efficient kernels increase work/GPU-second;
* request routing reduces wasted capacity;
* right-sizing reduces idle capacity;
* autoscaling reduces excess idle capacity;
* caching avoids recomputation;
* overload control prevents resources being wasted on doomed requests.

All of them improve some part of that ratio. Consider an LLM API. Production traffic:

$$
\lambda_{\text{peak}}=1,000\text{ req/s}.
$$

Request distribution:

```text
Input tokens:
p50 =   500
p95 = 4,000
p99 = 15,000

Output tokens:
p50 = 100
p95 = 500
p99 = 1,200
```

SLO:

$$
p99(TTFT)<1s.
$$

Load testing with the production distribution finds:

```text
30 req/s → p99 300 ms
40 req/s → p99 450 ms
50 req/s → p99 700 ms
55 req/s → p99 950 ms
60 req/s → p99 1,800 ms
65 req/s → p99 4,000 ms
```

The physical maximum might be around:

$$
65\text{ req/s}.
$$

But the SLO-compatible capacity is:

$$
55\text{ req/s}.
$$

You decide to operate at roughly 80% of that:

$$
55\times0.8=44\text{ req/s/replica}.
$$

Required replicas:

$$
\left\lceil
\frac{1000}{44}
\right\rceil
=
23.
$$

Now suppose each replica costs:

$$
\$4/hour.
$$

Fleet cost:

$$
23\times4=\$92/hour.
$$

At peak, if 1,000 results/sec are successfully delivered:

$$
1000\times3600=3.6\text{ million results/hour}.
$$

Accelerator cost per result:

$$
\frac{92}{3,600,000}
\approx\$0.0000256.
$$

Then suppose better batching increases safe capacity:

$$
55\rightarrow70\text{ req/s}.
$$

With the same 80% operating target:

$$
70\times0.8=56.
$$

Required replicas become:

$$
\left\lceil\frac{1000}{56}\right\rceil=18.
$$

Cost:

$$
18\times4=\$72/hour.
$$

The batching improvement saves:

$$
\$20/hour
$$

at that traffic level while preserving the same latency objective. That's model-serving economics in its simplest form.

## Which Curves Explain Inference Capacity as a Budget?
<!-- section-summary: Arrival, service, and cost curves show that finite capacity is a budget allocated across work, latency, resilience, and spend. -->

The final curves summarize the system as a finite budget whose allocation determines throughput, latency, resilience, and cost.

The concepts aren't independent. They form a loop:

```text
               request distribution
                        │
                        ▼
                   amount of work
                        │
                        ▼
traffic ──────────► concurrency
                        │
                        ▼
                     batching
                        │
                        ▼
             hardware efficiency
                        │
                        ▼
                 service capacity
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
        latency                    cost
           │                         │
           ▼                         │
      SLO violations                 │
           │                         │
           ▼                         │
   admission / scaling ◄─────────────┘
```

For example:

**More concurrency** → larger batches → better GPU utilization → lower cost/result but also:

→ more contention → larger queues → worse latency. So there is rarely a single "maximum" value you want. You are searching for a **safe operating region**. The behavior of many serving systems can be understood with three conceptual curves.

### Throughput versus load

```text
Throughput
 ^
 |                    ___________
 |                 __/
 |              __/
 |           __/
 |        __/
 |_____ _/
 +----------------------------> offered load
```

Throughput eventually plateaus because physical capacity is finite.

### Latency versus load

```text
Latency
 ^
 |                          /
 |                       __/
 |                    __/
 |                ___/
 |______________/
 +----------------------------> offered load
```

Latency grows sharply around saturation.

### Cost per result versus utilization

```text
Cost/result
 ^
 |\
 | \
 |  \
 |   \______
 |          \____
 +----------------------------> utilization
```

Low utilization is expensive because you're paying for idle hardware. The engineering challenge is operating far enough right to obtain good economics, but not so far right that queueing destroys latency and reliability. You can think of every serving system as having a budget of resource-time. Suppose a fleet gives you:

$$
10,000\text{ GPU-seconds per second}
$$

of some normalized effective capacity. Every request spends part of that budget. Long prompts spend more. Long generations spend more. Retries spend the budget twice. Failed requests spend budget without producing useful results. Padding spends budget doing useless computation. Underfilled batches leave budget unused. Idle replicas represent purchased budget that nobody spends. An efficient serving system tries to maximize:

$$
\boxed{
\frac{\text{useful accepted work}}
{\text{purchased resources}}
}
$$

while satisfying:

$$
\text{latency},
\quad
\text{reliability},
\quad
\text{quality}
$$

requirements. That perspective unifies almost every optimization in inference serving. If you remember only one model, make it this:

$$
\boxed{
\text{Demand}
=
\text{arrival rate}
\times
\text{work/request}
}
$$

$$
\boxed{
\text{Supply}
=
\text{replicas}
\times
\text{safe work/replica/sec}
}
$$

and production requires:

$$
\boxed{
\text{Demand}
<
\text{Supply}
}
$$

with enough margin to absorb variance, bursts, failures, and autoscaling delay. As demand approaches supply, queues grow and tail latency rises sharply. **Concurrency** helps keep hardware busy but becomes harmful after saturation. **Batching** turns concurrency into hardware efficiency but consumes latency budget. **Bounded queues and backpressure** prevent overload from turning into collapse. **Autoscaling** changes supply, but only after a delay. **Cold starts** determine how large that delay can be. **Load tests** experimentally locate the safe operating region. Finally:

$$
\boxed{
\text{Cost per accepted result}
=
\frac{\text{total serving cost}}
{\text{useful results delivered}}
}
$$

So the goal of model serving is not maximum GPU utilization, minimum latency, maximum throughput, or minimum server count in isolation. It is:

> **Deliver the required amount of useful inference work, within the latency and reliability constraints, using the smallest sustainable amount of resources.**

Once you understand that, concurrency limits, batching policies, autoscaling thresholds, queue sizes, capacity plans, and infrastructure cost all become different expressions of the same underlying problem.

![Capacity-release workflow from a representative workload contract and one-replica tests through a safe operating point, capacity plan, staged release, operating baseline, four evidence gates, and complete recovery.](/content-assets/articles/article-mlops-model-serving-latency-throughput-autoscaling-cost/capacity-release-summary.png)

*A capacity change is ready for release only after service, resource, control, and economic evidence pass together, with a tested route back to the previous complete configuration when any limit fails.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Work and Metrics Define Inference Cost and Scale?]{kind="recap"}
Serving converts arriving work into accepted results with finite compute, memory, bandwidth, time, and money, measured through rates, latency, queueing, and errors.
:::

:::expand[Why Does Latency Rise near Capacity, and How Should the Full Path Be Measured?]{kind="recap"}
Capacity has a knee where queues grow rapidly; end-to-end histograms, percentiles, traffic distributions, and Little's Law explain the complete path.
:::

:::expand[How Do Concurrency, Bounded Queues, Backpressure, Retries, Batching, and Memory Interact?]{kind="recap"}
Concurrency only creates in-flight work, bounded queues and backpressure contain overload, retries amplify it, batching improves efficiency with delay, and memory sets another limit.
:::

:::expand[How Do Autoscaling, Headroom, Cold Starts, Resilience, and Workload Classes Shape Capacity?]{kind="recap"}
Autoscaling reacts after demand changes, so safe operation needs headroom, useful signals, cold-start planning, redundancy, and separate classes for very different work.
:::

:::expand[How Do You Measure Cost per Accepted Result?]{kind="recap"}
Cost per accepted useful result includes failed, rejected, retried, idle, and batched work and exposes the real latency-cost trade.
:::

:::expand[How Do Open-Loop and Closed-Loop Tests Find Sustainable Throughput?]{kind="recap"}
Open-loop tests reveal overload under fixed arrivals, closed-loop tests reflect waiting clients, and realistic distributions find maximum sustainable rather than momentary throughput.
:::

:::expand[How Should Capacity Regressions and Releases Be Controlled?]{kind="recap"}
Releases consume temporary capacity and can move the knee, so performance evidence, progressive exposure, and the full request path belong in correctness gates.
:::

:::expand[Which Curves Explain Inference Capacity as a Budget?]{kind="recap"}
Arrival, service, and cost curves show that finite capacity is a budget allocated across work, latency, resilience, and spend.
:::
