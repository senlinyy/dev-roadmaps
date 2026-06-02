---
title: "Cloud Logging"
description: "Make application, platform, and audit logs searchable, and route them using log sinks for long-term retention."
overview: "Logs are only valuable if you can find them and keep them. This article explains how to query structured logs and configure log routing sinks using the gcloud CLI."
tags: ["gcp", "observability", "logging", "log-router"]
order: 2
id: article-cloud-providers-gcp-observability-cloud-logging
---

## Table of Contents

1. [Querying Structured Logs](#querying-structured-logs)
2. [Resource Labels and Payloads](#resource-labels-and-payloads)
3. [The Log Router and Sinks](#the-log-router-and-sinks)
4. [Putting It All Together](#putting-it-all-together)
5. [What's Next](#whats-next)

## Querying Structured Logs

Google Cloud Logging is a centralized, fully managed service that stores, queries, and routes log data from your applications and infrastructure. Unlike traditional environments where logs are flat lines of text written to scattered local files, Google Cloud stores logs as structured entries. When an application or a Google Cloud service emits a log, the entry carries metadata such as resource type, severity, timestamp, and payload. In this walkthrough, we will use the `gcloud` CLI to query these structured logs and configure routing rules for longer retention.

Before you can route a log to a new destination, you must know how to find it. In Google Cloud, every log entry includes standardized metadata. This metadata includes a precise timestamp, a severity level such as `INFO` or `ERROR`, and a unique identifier.

To see this structure in action, we can query the most recent Cloud Audit Log. These logs record administrative actions, such as creating or modifying resources. We use the `gcloud logging read` command, passing a filter that selects only activity logs, and we format the output as JSON so we can read the raw fields:

```bash
gcloud logging read 'logName="projects/MY_PROJECT/logs/cloudaudit.googleapis.com%2Factivity"' --format=json --limit=1
```

```json
[
  {
    "insertId": "1a2b3c4d",
    "logName": "projects/my-project/logs/cloudaudit.googleapis.com%2Factivity",
    "protoPayload": {
      "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
      "authenticationInfo": {
        "principalEmail": "admin@example.com"
      },
      "methodName": "v1.compute.instances.delete"
    },
    "receiveTimestamp": "2024-05-14T10:30:02Z",
    "resource": {
      "labels": {
        "instance_id": "89234723984",
        "project_id": "my-project",
        "zone": "us-central1-a"
      },
      "type": "gce_instance"
    },
    "severity": "NOTICE",
    "timestamp": "2024-05-14T10:30:00Z"
  }
]
```

The output shows exactly how Google Cloud organizes log data. Because the log is structured, you never have to guess how to parse it or write fragile text-matching scripts.

## Resource Labels and Payloads

When you run a large system, millions of log entries pour in from databases, load balancers, and virtual machines. The `resource.labels` field identifies the component that generated the log. For a Compute Engine instance, that might include the project, zone, and instance ID. For Cloud Run, it might include the service, revision, and region.

These structured labels make filtering practical. If a developer needs to debug a failing API, they can filter by resource type and service name before searching the payload text. The beginner habit is to narrow by resource metadata first, then read the message.

The `protoPayload` field contains the domain-specific details of the event. For an audit log, it explicitly names the identity of the user (`principalEmail`) and the exact API method they called (`methodName`). In this example, the payload proves that an administrator deleted a Compute Engine instance.

## The Log Router and Sinks

Logs are only useful if they are kept. By default, Google Cloud places most operational logs in a default storage bucket that automatically deletes them after 30 days to control storage costs. If a security team needs to retain all administrative actions for a year to meet compliance rules, the platform must intercept the logs in flight and route them to a permanent destination.

Logs written to Cloud Logging pass through the Log Router before they are stored or exported. The Log Router evaluates log entries against sinks, which are routing rules that choose destinations.

Under the documented model, the Log Router manages the flow of new log entries through matching sinks. Google Cloud also temporarily stores entries to buffer disruptions for supported destinations, but that buffer does not fix configuration mistakes. If the sink destination or permissions are wrong, the routing path needs to be repaired.

As these workers process the queue, they evaluate every incoming log against a list of routing rules called sinks. A sink behaves like a strict set of shipping instructions. It pairs an IF condition (the filter) with a THEN action (the destination). To solve the security team's retention problem, we can create a custom sink that sends all audit logs to a BigQuery dataset for long-term analysis.

We use the `gcloud logging sinks create` command. We provide the name of the new sink, the BigQuery destination, and the exact log filter we tested earlier:

```bash
gcloud logging sinks create my-audit-sink \
  bigquery.googleapis.com/projects/MY_PROJECT/datasets/audit_logs \
  --log-filter='logName="projects/MY_PROJECT/logs/cloudaudit.googleapis.com%2Factivity"'
```

```text
Created [https://logging.googleapis.com/v2/projects/MY_PROJECT/sinks/my-audit-sink].
Please remember to grant `serviceAccount:p123456789-987654@gcp-sa-logging.iam.gserviceaccount.com` the BigQuery Data Editor role on the dataset.
```

When you run this command, the control plane provisions a new rule in the Log Router. The output returns a success message and points out that the Log Router operates under its own dedicated service account. For the Router to successfully write to BigQuery, you must grant that specific service account the correct permissions on the target dataset. If you skip that step, matching logs will not reach the destination, and you should diagnose the sink with routing errors, sink status, and export error metrics.

Once configured, the Log Router evaluates the filter in real-time. If a new log matches, the Router asynchronously copies the log and delivers it to BigQuery, bypassing the default 30-day storage limits.

A critical systems engineering gotcha is that log sinks route new matching entries after the sink exists. Creating a sink does not automatically replay old entries into the new destination. If the old entries are still stored in a log bucket and have not passed retention, Google Cloud provides separate copy workflows for moving stored logs to Cloud Storage.

## Putting It All Together

Application and platform logs are only valuable if you can find the data you need and retain it for as long as your compliance rules require.

- **Structured Entries**: Google Cloud wraps every message in a JSON object with a timestamp, a severity, and a unique identifier.
- **Querying Logs**: The `gcloud logging read` command allows you to search logs instantly using specific logical tags instead of raw text strings.
- **The Log Router**: A high-throughput pipeline that decouples API ingestion from physical storage.
- **Sinks**: Routing rules created with `gcloud logging sinks create` that securely forward logs to destinations like BigQuery for complex analysis, bypassing default retention limits.

## What's Next

Logs tell us what happened, but how do we get alerted when something goes wrong? We shouldn't have to search manually to find out that an API is broken.

In the next article, we will use Cloud Monitoring to define service-level thresholds and set up alerting policies, ensuring that the right engineer is notified the moment an application stops behaving normally.

![Cloud Logging summary showing log entry metadata, resource labels, payload, Log Router, sink, and destination.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/cloud-logging-summary.png)

*Cloud Logging wraps each message as a structured entry, then the Log Router copies matching entries through sinks to destinations such as BigQuery.*

---

**References**

- [Overview of Cloud Logging](https://cloud.google.com/logging/docs) - Explains log entries, the Log Router, and the difference between storage and routing.
- [Cloud Audit Logs](https://cloud.google.com/logging/docs/audit) - Details the payload structure of Admin Activity and Data Access logs.
- [Route logs to supported destinations](https://cloud.google.com/logging/docs/export) - Covers inclusion and exclusion filters, sink creation, and retrospective routing limitations.
- [Log Router Overview](https://cloud.google.com/logging/docs/routing/overview) - Describes how the Log Router evaluates entries against sinks.
- [Troubleshoot Log Routing](https://cloud.google.com/logging/docs/export/troubleshoot) - Documents sink routing errors and export error signals.
- [Copy Logs](https://cloud.google.com/logging/docs/routing/copy-logs) - Explains copying stored logs before retention expires.
