---
title: "Build the Publish Workflow"
sectionSlug: retries-catch-and-failure-paths
order: 1
---

Complete the state machine for lesson publishing. `ValidateLesson` invokes the supplied Lambda resource, retries service failures with exponential backoff, and catches all remaining failures into `RecordFailure`. Success continues to `PublishEvent`, which sends an EventBridge event and then ends. `RecordFailure` sends the supplied SQS message and then moves to `PublishFailed`, a Fail state. Keep every state reachable from `StartAt`.
