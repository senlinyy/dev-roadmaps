---
title: "Streaming Inference"
description: "Introduce streaming inference for continuous events, including consumers, offsets, lag, idempotent outputs, KEDA scaling, and recovery."
overview: "Streaming inference scores events continuously through a durable event path. This article explains contracts, time, partitioning, progress, effect semantics, scaling, replay, and recovery before mapping them to Kafka and KEDA."
tags: ["MLOps", "core", "inference"]
order: 3
id: "article-mlops-model-serving-streaming-inference-explained"
aliases:
  - roadmaps/mlops/modules/model-serving/inference-patterns/02-streaming-inference-explained.md
  - child-inference-patterns-02-streaming-inference-explained
---

## What Streaming Inference Solves
<!-- section-summary: Streaming inference scores events continuously as they arrive, which fits workflows that need near-real-time decisions without blocking a user request. -->

**Streaming inference** means a model scores events as they move through an event stream. The input is a continuous flow, such as clicks, payments, sensor readings, trip updates, or device alerts. The output is another event, table row, alert, or state update that downstream systems can use within seconds or minutes.

In the previous article, batch inference scored known records on a schedule, and online inference scored one live request during a user workflow. Streaming inference sits between those two patterns. It handles ongoing events like online serving, but the caller usually does not sit inside a web request waiting for the answer. A consumer reads messages from a stream, runs the model, and writes the prediction somewhere useful.

The architecture has seven responsibilities. The **event contract** defines identity, schema, and model inputs. **Event time** distinguishes when something happened from when the system processed it. **Partitioning and ordering** decide which events may be handled concurrently. **Consumer progress** records offsets and lag. **Effect semantics** determine how predictions are written without loss or harmful duplication. **Capacity control** scales from backlog and service time. **Replay and recovery** explain how old events are reprocessed under an explicit model and schema version. Kafka, Flink, Spark, KEDA, and serving runtimes cover different pieces of this framework.

These pieces interact in ways an HTTP endpoint can hide. Scaling consumers changes partition ownership but cannot exceed useful partition parallelism. Committing an offset before the output is durable can lose a prediction; committing it after can repeat the output after a crash. Replay with today's model produces a new derived dataset rather than reproducing the old result. Streaming inference is therefore a data-consistency system around a model call, not simply real-time batch.

Imagine a mobility company called RidePulse. Every scooter sends trip events: sudden braking, sharp turns, low battery, GPS jumps, and speed changes. The safety team wants to score each event for risk so the app can warn riders, operations can inspect risky vehicles, and analysts can review incident patterns later. Waiting for a nightly batch is too slow. Calling a model from every mobile request would tie rider experience to a backend model call. A streaming consumer gives the team a separate path: events flow into Kafka, the model scores them, and the results flow to alerts and storage.

Here is the concept map:

| Concept | Plain meaning | RidePulse example |
|---|---|---|
| **Event** | A record that says something happened | `trip_signal_received` |
| **Topic** | A named stream of related events | `trip-signals-v1` |
| **Consumer group** | One logical app reading the topic, often with many replicas | `safety-risk-scorer` |
| **Offset** | A position in the stream | "This consumer has processed through message 48219" |
| **Lag** | How far the consumer sits behind the newest events | 40,000 unprocessed trip signals |
| **Prediction event** | The model output sent to another stream or table | `trip-risk-scored` |

Streaming inference is valuable because it gives model serving its own pace. Producers keep writing events, consumers keep processing, and downstream systems receive predictions as the stream moves.

![RidePulse streaming inference path](/content-assets/articles/article-mlops-model-serving-streaming-inference-explained/ridepulse-streaming-path.png)
*RidePulse keeps prediction work off the rider's live request path: trip events flow through Kafka, the consumer writes scored events, and offsets move forward only after the output is safe.*

## Events, Topics, Consumers, and Offsets
<!-- section-summary: A streaming inference service depends on event contracts and consumer progress, not only on model accuracy. -->

An **event** is a small record describing one thing that happened. A **topic** is a named log of related events. A **consumer** reads events from the topic. A **consumer group** lets multiple consumer instances share the work. An **offset** records a consumer's position in a topic partition so the system can tell which messages have already been handled.

For a beginner, think of the topic as an ordered set of notebooks split into sections called partitions. Producers append events to the notebooks. Consumers read from their assigned sections and mark their position as they go. Kafka and related platforms use this structure so many consumers can process events in parallel while still tracking progress.

RidePulse might use this event as input:

```json
{
  "event_id": "evt_20260705_009821",
  "event_type": "trip_signal_received",
  "schema_version": 1,
  "trip_id": "trip_773812",
  "vehicle_id": "scooter_5142",
  "city": "austin",
  "event_time": "2026-07-05T16:04:21Z",
  "speed_kph": 24.7,
  "brake_force": 0.82,
  "turn_angle_degrees": 41.2,
  "battery_percent": 18,
  "gps_accuracy_meters": 9.4
}
```

This record carries more than model features. `event_id` lets the consumer deduplicate retries. `schema_version` tells the consumer how to parse the payload. `event_time` lets the team measure delay from event creation to prediction. `trip_id` and `vehicle_id` let downstream systems connect the prediction to product action and operations follow-up.

The output should also be an event with a contract:

```json
{
  "event_id": "risk_evt_20260705_009821",
  "source_event_id": "evt_20260705_009821",
  "trip_id": "trip_773812",
  "vehicle_id": "scooter_5142",
  "risk_score": 0.87,
  "risk_band": "high",
  "model_version": "safety-risk-xgb-2026-07-01",
  "scored_at": "2026-07-05T16:04:24Z"
}
```

The output includes `source_event_id` because replay is normal in streaming systems. If the consumer reprocesses the same source event after a crash, the sink can use that source ID to avoid duplicate alerts. This is called **idempotency**. Idempotency means repeating the same operation produces the same final state, such as upserting one prediction for one source event instead of sending five alerts for the same trip signal.

![RidePulse event contract for streaming inference](/content-assets/articles/article-mlops-model-serving-streaming-inference-explained/ridepulse-event-contract.png)
*The event contract carries the keys operations need later: schema version for parsing, event time for freshness, and source event ID for replay-safe output.*

## A Streaming Inference Workflow
<!-- section-summary: The core workflow is consume, validate, score, write output, then commit progress only after the output is safe. -->

The serving workflow has a simple shape, yet every step needs care:

1. Read a batch of events from the topic.
2. Validate the schema and required fields.
3. Convert the event into model features.
4. Score the model.
5. Write the prediction to the output topic or table.
6. Commit progress after the output write succeeds.

The order matters. If the consumer commits its offset before writing the prediction, a crash can skip events. If the consumer writes the output and crashes before committing, it may reprocess the event after restart. That second case is much safer when the output sink uses idempotent keys such as `source_event_id`.

Here is a small Python-style worker loop that shows the control flow without tying the lesson to one client library:

:::expand[Implement the streaming consumer loop]{kind="example"}

```python
from datetime import datetime, timezone


def handle_event(event: dict) -> dict:
    validate_trip_signal(event)
    features = build_features(event)
    risk_score = safety_model.predict_proba([features])[0][1]
    risk_band = "high" if risk_score >= 0.80 else "review" if risk_score >= 0.55 else "normal"

    return {
        "event_id": f"risk_{event['event_id']}",
        "source_event_id": event["event_id"],
        "trip_id": event["trip_id"],
        "vehicle_id": event["vehicle_id"],
        "risk_score": round(float(risk_score), 4),
        "risk_band": risk_band,
        "model_version": "safety-risk-xgb-2026-07-01",
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }


while True:
    records = consumer.poll(timeout_seconds=5, max_records=500)
    for record in records:
        try:
            prediction = handle_event(record.value)
            predictions_sink.upsert(
                key=prediction["source_event_id"],
                value=prediction,
            )
            consumer.mark_processed(record)
        except RecoverableModelError:
            retry_later(record)
        except BadEventError as exc:
            dead_letter_sink.write(record.value, reason=str(exc))
            consumer.mark_processed(record)

    consumer.commit_processed_offsets()
```

:::

The loop separates bad events from recoverable model failures. A bad event has missing fields or invalid values; it should move to a dead-letter stream with a reason so the data owner can fix the producer. A recoverable error might be a temporary model artifact download failure or a short database outage; the consumer should retry without marking the event as completed.

## Designing the Event Contract
<!-- section-summary: Streaming models need stable event schemas because producers and consumers change independently. -->

Streaming inference depends on teams that often ship separately. The mobile team changes event producers. The MLOps team deploys the scorer. The safety team reviews predictions. A stable event contract prevents these teams from surprising each other.

The contract should answer a few questions:

| Contract question | Good answer |
|---|---|
| How do we identify one event? | `event_id` is required and globally unique |
| How do we handle schema changes? | `schema_version` is required and new versions go through compatibility checks |
| How do we measure delay? | `event_time` and `scored_at` are both present |
| How do we connect product action? | `trip_id`, `vehicle_id`, and `city` are present |
| How do we deduplicate output? | `source_event_id` is the upsert key |

The model feature code should reject events it cannot understand. That may sound strict, but it protects the prediction stream. If `brake_force` suddenly arrives as `"hard"` instead of `0.82`, the consumer should send the record to a dead-letter stream and alert the producer owner. Silent conversion can create a harder incident because the model keeps returning scores from broken features.

Here is a validation report the worker can write every five minutes. The `p95_event_delay_seconds` field is the 95th-percentile delay: 95 percent of events were scored within that time.

| Metric | Example value | Why it matters |
|---|---:|---|
| `events_consumed` | 310,000 | Throughput over the window |
| `events_scored` | 309,880 | Successful model work |
| `dead_letter_events` | 120 | Bad input records |
| `p95_event_delay_seconds` | 42 | Freshness from event creation to score |
| `high_risk_predictions` | 1,842 | Product safety volume |

The report connects serving behavior to product behavior. If dead-letter events jump after a mobile release, the mobile producer likely changed the event. If event delay grows while the score distribution stays normal, the model may be fine while consumer capacity is the issue.

## Scaling Consumers with Lag
<!-- section-summary: Consumer lag shows whether the streaming scorer keeps up with incoming events, and KEDA can scale consumers from Kafka lag. -->

**Consumer lag** is the gap between where the producer has written and where the consumer group has processed. In a streaming inference system, lag is one of the main health signals because high lag means predictions arrive late. The model may still be accurate, the code may still run, and the cluster may still be green, yet the business receives stale predictions if lag keeps growing.

Kafka tooling can show consumer position and lag for a group:

```bash
bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka.prod.svc:9092 \
  --describe \
  --group safety-risk-scorer
```

Example output:

```console
GROUP               TOPIC            PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
safety-risk-scorer  trip-signals-v1  0          820400          831200          10800
safety-risk-scorer  trip-signals-v1  1          817921          828301          10380
safety-risk-scorer  trip-signals-v1  2          819008          819721          713
```

This output shows uneven partitions. Partitions 0 and 1 have much higher lag than partition 2. The team should ask whether event keys distribute traffic unevenly, whether some events take longer to score, or whether the consumer count is too low for the incoming rate.

**Kubernetes Event-driven Autoscaling (KEDA)** can scale Kubernetes consumers from Kafka lag. KEDA watches the event source and feeds metrics to the Kubernetes **Horizontal Pod Autoscaler (HPA)**, so the deployment can scale out while work is pending and scale back when the stream quiets down. The Kafka scaler also documents an important partition reality: replicas normally should not exceed partition count, because extra consumers can sit idle when there are more consumers than partitions.

Here is a KEDA `ScaledObject` for the scorer:

:::expand[Configure lag-based scaling with KEDA]{kind="example"}

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: safety-risk-scorer
spec:
  scaleTargetRef:
    name: safety-risk-scorer
  pollingInterval: 15
  cooldownPeriod: 300
  minReplicaCount: 1
  maxReplicaCount: 12
  triggers:
    - type: kafka
      metadata:
        bootstrapServers: kafka.prod.svc:9092
        consumerGroup: safety-risk-scorer
        topic: trip-signals-v1
        lagThreshold: "5000"
        activationLagThreshold: "500"
        offsetResetPolicy: latest
        allowIdleConsumers: "false"
        limitToPartitionsWithLag: "true"
```

:::

The fields teach the operating policy. `lagThreshold` is the target total lag value that drives scaling. `activationLagThreshold` prevents tiny bursts from scaling the deployment. `maxReplicaCount` should respect the number of partitions and the model's resource needs. `limitToPartitionsWithLag` keeps scale-out focused on partitions that actually have work.

## Failure Handling and Replay
<!-- section-summary: Streaming inference accepts replay as a normal recovery path, so outputs need stable keys and clear dead-letter handling. -->

Streaming systems recover through replay. A consumer can start from a previous offset and process events again. That is powerful because a fixed model bug can be corrected by replaying the affected time window. It also creates duplicate risk if the output path sends side effects without stable keys.

RidePulse should separate outputs into two paths. The first path writes prediction facts to a table or compacted topic keyed by `source_event_id`. Replaying an event updates the same prediction record. The second path sends rider or operations alerts only after a rule checks whether an alert for that source event already exists. This avoids repeat push notifications during recovery.

A replay runbook might look like this:

| Step | Action | Owner |
|---|---|---|
| Freeze alert side effects | Temporarily disable push notifications for replayed events | Product operations |
| Select replay window | Use incident timestamps and affected model version | MLOps |
| Reset or start a replay consumer | Process only the target topic partitions and time window | Platform |
| Write predictions with `source_event_id` keys | Upsert output so repeated events replace old predictions | MLOps |
| Compare counts and score distribution | Confirm replay produced expected volume | Model owner |
| Re-enable alerts | Turn live alerting back on after replay evidence passes | Product operations |

Dead-letter handling needs the same care. A dead-letter stream should include the original payload, parse error, consumer version, model version if scoring started, and the time the worker rejected it. The owner can then decide whether to fix the producer, backfill the events, or mark the records as intentionally unsupported.

## Operational Checks
<!-- section-summary: A streaming inference dashboard should connect stream health, model health, and product freshness in one place. -->

A useful streaming dashboard has three layers. The stream layer asks whether the consumer is keeping up. The model layer asks whether scoring is healthy. The product layer asks whether predictions arrive in time for the business action.

| Layer | Signal | Healthy question |
|---|---|---|
| Stream | Consumer lag by partition | Is the consumer keeping up with producers? |
| Stream | Rebalances and failed commits | Is the group stable? |
| Model | Scoring latency | Can each replica process events fast enough? |
| Model | Model error rate | Are artifacts, features, and runtime healthy? |
| Product | Event-to-score delay | Do predictions arrive soon enough for rider safety? |
| Product | Dead-letter rate | Did a producer schema change break serving? |

The alert policy should avoid noisy single-metric pages. A short lag spike during a city event may clear on its own. A lag spike plus rising event-to-score delay plus maxed-out replicas deserves attention. A dead-letter jump right after a mobile release points to a producer contract issue rather than model capacity.

![RidePulse streaming operations dashboard](/content-assets/articles/article-mlops-model-serving-streaming-inference-explained/ridepulse-streaming-ops-dashboard.png)
*The useful dashboard connects stream health, model health, and product freshness so a lag spike turns into a concrete operations decision.*

The daily review should include a small quality packet:

```sql
SELECT
  city,
  COUNT(*) AS scored_events,
  AVG(risk_score) AS avg_risk_score,
  COUNTIF(risk_band = 'high') AS high_risk_events,
  APPROX_QUANTILES(TIMESTAMP_DIFF(scored_at, event_time, SECOND), 100)[OFFSET(95)] AS p95_delay_seconds
FROM warehouse.ridepulse.trip_risk_predictions
WHERE DATE(scored_at) = DATE '2026-07-05'
GROUP BY city
ORDER BY p95_delay_seconds DESC;
```

This query helps a reviewer see whether one city has high delay or an unusual high-risk volume. It links stream operations back to the model's business role, which is the whole point of serving in a stream.

## Putting It Together
<!-- section-summary: Streaming inference fits continuous events when predictions need to arrive soon, workers can process asynchronously, and replay is part of the operating plan. -->

Streaming inference scores events as they flow. It fits systems like RidePulse, where trip signals arrive continuously and the model output needs to reach alerts, operations, and analytics soon after the event. The serving unit is an event, the operational signal is consumer progress, and the recovery path usually involves replay.

Design the stream contract before tuning the model worker. Require event IDs, schema versions, timestamps, and stable output keys. Monitor consumer lag, event-to-score delay, dead-letter rate, and model errors together. Use tools such as Kafka consumer-group checks and KEDA lag-based scaling when the workload runs on Kubernetes. The result is a serving pattern that can keep moving while producers, model code, and downstream actions evolve.

## References

- [Apache Kafka documentation](https://kafka.apache.org/documentation/)
- [Confluent Kafka consumer group operations](https://docs.confluent.io/kafka/operations-tools/manage-consumer-groups.html)
- [KEDA Kafka scaler docs](https://keda.sh/docs/2.20/scalers/apache-kafka/)
- [KEDA scaling deployments docs](https://keda.sh/docs/2.20/concepts/scaling-deployments/)
