---
title: "What Is GCP Observability"
description: "Understand how Google Cloud collects, stores, and analyzes logs, metrics, and traces after an app is running."
overview: "When an application crashes on Cloud Run or GKE, you need evidence. This article shows you how to use the gcloud CLI to query default platform signals immediately after deployment."
tags: ["gcp", "observability", "logging", "monitoring"]
order: 1
id: article-cloud-providers-gcp-observability-what-is-gcp-observability
---

## Table of Contents

- [Centralized Telemetry](#centralized-telemetry)
- [Deploying a Crashing Container](#deploying-a-crashing-container)
- [Querying the Log Router](#querying-the-log-router)
- [Unpacking the Log Payload](#unpacking-the-log-payload)
- [Putting It All Together](#putting-it-all-together)
- [What's Next](#whats-next)

## Centralized Telemetry

When you deploy a container to Google Cloud, you lose direct access to its local terminal. To understand what the application is doing, you must rely on the telemetry it leaves behind. Google Cloud Observability is the set of managed services that stores and connects operational evidence: Cloud Logging for logs, Cloud Monitoring for metrics and alerts, Cloud Trace for request timelines, Error Reporting for grouped application errors, and audit logs for control-plane activity.

For a beginner, the useful starting point is logs. On managed platforms such as Cloud Run, text written to standard output and standard error is collected for you and stored as Cloud Logging entries. Instead of SSHing into individual virtual machines to read local text files in `/var/log`, you query an API. Each collected line is wrapped in a structured log entry with metadata such as project, region, service name, revision, timestamp, severity, and payload. This means the evidence can survive after an ephemeral container exits.

## Deploying a Crashing Container

To see how this automatic interception works, we can deploy a container designed to fail. We will use a public image that attempts to start up, encounters a fatal error, prints an error message to standard error, and then exits.

When we push this container to Cloud Run, the platform provisions the underlying compute capacity, pulls the image, and attempts to boot it.

```bash
gcloud run deploy bad-app \
  --image=gcr.io/google-containers/busybox \
  --command=sh \
  --args="-c,echo 'Starting service...'; sleep 2; echo 'Fatal database connection error' >&2; exit 1" \
  --region=us-central1 \
  --allow-unauthenticated
```

```text
Deploying container to Cloud Run service [bad-app] in project [my-project] region [us-central1]
✓ Routing traffic...
✓ Setting IAM Policy...
X Starting revision...
  Revision 'bad-app-00001-abc' is not ready and cannot serve traffic. The user-provided container failed to start and listen on the port defined provided by the PORT=8080 environment variable.
Deployment failed.
```

The deployment fails because the container exits with a non-zero status code before the Cloud Run health check can verify that it is listening for web traffic. The Cloud Run control plane immediately destroys the failed container instance. Because the compute environment is ephemeral, we cannot connect to it to inspect what went wrong. We must rely on the platform's central log router to find the output.

## Querying the Log Router

Many Google Cloud resources write platform logs to Cloud Logging, and managed runtimes such as Cloud Run collect container output. To find the exact output from our failed deployment, we use the `gcloud logging read` command. This command accepts a filtering syntax that allows us to target specific resources, severities, and time windows.

We know the resource type is a Cloud Run revision, and because the container exited with a failure, we want to look for log entries classified as errors.

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' \
  --limit 5 \
  --format json
```

```json
[
  {
    "insertId": "64a2f9c1000b2e3f",
    "labels": {
      "instanceId": "00c61b1178...90a"
    },
    "logName": "projects/my-project/logs/run.googleapis.com%2Fstderr",
    "receiveTimestamp": "2024-05-12T14:32:01.123Z",
    "resource": {
      "labels": {
        "configuration_name": "bad-app",
        "location": "us-central1",
        "project_id": "my-project",
        "revision_name": "bad-app-00001-abc",
        "service_name": "bad-app"
      },
      "type": "cloud_run_revision"
    },
    "severity": "ERROR",
    "textPayload": "Fatal database connection error",
    "timestamp": "2024-05-12T14:32:00.987Z"
  }
]
```

The API returns a structured JSON array containing the matching log entries. Even though our application only printed a simple text string, Cloud Logging wrapped that string in a rich diagnostic envelope.

## Unpacking the Log Payload

Understanding the fields in this JSON envelope is critical for diagnosing systems at scale. When you query logs across hundreds of microservices, the metadata matters more than the raw text.

The `insertId` helps identify a log entry and can help Cloud Logging de-duplicate repeated entries in query results. It is useful evidence, but it is not a complete global identity by itself. In practice, you read it together with fields such as `logName`, `timestamp`, and `resource`.

The `logName` string defines the stream the log came from. Notice the `%2Fstderr` at the end. Because our container printed the failure message to standard error (`>&2`), Cloud Run stored it under the `stderr` log stream and commonly maps that stream to `ERROR` severity. If we had printed ordinary text to standard output, the stream would be `stdout` and the default severity would usually be `INFO`.

The `resource.labels` block contains the physical and logical topology of where the log originated. It tells us the project ID, the exact region (`us-central1`), and the specific Cloud Run revision. When searching through millions of logs, filtering by these indexed labels is significantly faster and cheaper than performing full-text searches on the payload.

The `textPayload` is the exact, literal string that our container printed before it crashed. Because we printed raw text, Cloud Logging stored it as a flat string. If our application had printed a serialized JSON object, the platform would parse it and store it under a `jsonPayload` field instead, allowing us to query individual properties within the application's output.

Finally, the platform tracks two times: the `timestamp` and the `receiveTimestamp`. The `timestamp` is the event time recorded for the log entry, or a time assigned by Cloud Logging if the writer did not provide one. The `receiveTimestamp` is when Cloud Logging received the entry. A large gap between these two fields tells you there was ingestion delay, but it does not prove one specific cause by itself.

## Putting It All Together

Google Cloud Observability provides managed services for your application's operational data. Managed compute platforms such as Cloud Run collect standard output and standard error and store those lines as structured log entries.

When an application crashes, the local compute environment is destroyed, but the evidence survives in the log router. By using the `gcloud logging read` command, you can query across your entire infrastructure, filtering by resource type, severity, and region to pinpoint exact failure messages without ever SSHing into a host.

## What's Next

Now that we know the default platform signals exist and how to query them, we need to look at how we format our application's output. Printing raw text works for simple errors, but at scale, flat strings are difficult to query. Next, we will explore how to structure our logs natively and route them efficiently.

![GCP observability summary showing Logging, Monitoring, Trace, Errors, Audit logs, and Resource labels.](/content-assets/articles/article-cloud-providers-gcp-observability-what-is-gcp-observability/gcp-observability-summary.png)

*GCP observability connects logs, metrics, traces, errors, and audit evidence around shared resource metadata so incidents have a searchable trail.*

---

**References**

- [Google Cloud Logging documentation](https://cloud.google.com/logging/docs) - Overview of Cloud Logging features and concepts.
- [LogEntry API reference](https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry) - Schema definition for the LogEntry JSON object.
- [Viewing logs in Cloud Run](https://cloud.google.com/run/docs/logging) - Platform-specific logging behavior for Cloud Run services.
- [Configure Cloud Run Containers](https://cloud.google.com/run/docs/configuring/services/containers) - Documents Cloud Run command and argument configuration.
