---
title: "Configure the Publish Worker Queue"
sectionSlug: create-a-queue-and-dead-letter-queue
order: 1
---

Complete the queue attributes input for a worker whose worst-case processing time is 90 seconds. Give the worker 120 seconds of visibility, retain messages for four days, enable 20-second long polling, use SQS-managed encryption, and move a message to the supplied DLQ after five failed receives. `RedrivePolicy` must remain the JSON string format expected by the SQS API.
