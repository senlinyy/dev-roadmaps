---
title: "Functions"
description: "Use Azure Functions when the runtime should start from an event, with clear triggers, invocations, bindings, timeouts, retries, and hosting-plan tradeoffs."
overview: "Functions are event-started units of work with their own runtime shape. This article explains the trigger model, the function app boundary, and the operational details that still matter in a serverless runtime."
tags: ["azure", "functions", "serverless", "events", "triggers"]
order: 4
id: article-cloud-providers-azure-compute-application-hosting-azure-functions-event-driven-work
aliases:
  - azure-functions-and-event-driven-work
  - cloud-providers/azure/compute-application-hosting/azure-functions-and-event-driven-work.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Functions](#what-is-functions)
3. [Events](#events)
4. [Triggers](#triggers)
5. [Invocations](#invocations)
6. [Bindings](#bindings)
7. [Timeout And Retries](#timeout-and-retries)
8. [Function App](#function-app)
9. [When A Service Is Simpler](#when-a-service-is-simpler)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

The checkout API now has side work. After an order is accepted, the system needs to send a receipt, update a search index, and run a nightly reconciliation. None of those jobs needs to sit behind the public API all day.

The team could add everything to the web app:

- The API could send receipts before returning the customer response.
- A background loop could poll for reconciliation work every minute.
- A timer library inside the app could try to run the nightly job.

Those choices make the web app responsible for background or event work. They also blur failure boundaries. A slow email provider could slow checkout. A retry loop could run twice after scale-out. A nightly job could disappear when the web app restarts.

Azure Functions gives this work a different shape. The code starts because an event happens, and the trigger becomes part of the runtime contract.

## What Is Functions

Azure Functions is a serverless compute service for running small pieces of code in response to events. A function can run when an HTTP request arrives, a queue message appears, a timer fires, a blob changes, or another supported event source asks for work.

Serverless does not mean "no runtime." It means Azure manages more of the hosting layer and you design around event boundaries. You still choose a hosting plan, configure settings, grant identity permissions, observe logs, handle retries, and understand timeouts.

The important mental model is this:

| Function noun | Beginner meaning |
| --- | --- |
| Event | Something happened and work may need to run. |
| Trigger | The rule that starts the function from that event source. |
| Invocation | One run of the function. |
| Binding | A declarative connection to input or output data. |
| Function app | The Azure resource that groups functions, settings, identity, runtime, and observability. |
| Hosting plan | The compute and scaling model behind the function app. |

Functions are close to AWS Lambda in the broad map: code starts when work arrives. Azure's trigger and binding model is especially visible, so learn that model rather than treating Functions as just "Lambda but in Azure."

## Events

An event is the reason the function should run. It might be direct, like an HTTP request. It might be indirect, like a queue message created by the checkout API after an order is stored.

Event-shaped work has a few clues. The job has a clear unit of work. It can be retried safely or designed to be idempotent. It does not need a permanently warm HTTP server. It can tolerate the startup and scaling behavior of its hosting plan.

For the receipt sender, the event is not "the API returned success." The better event is "a message exists on the receipt queue." That lets checkout finish quickly, and it lets the receipt sender retry without asking the customer to submit the order again.

The non-obvious part is that event design is application design. If the event payload is missing the order ID, the function cannot fix that. If the function sends two receipts when a queue message is retried, the bug is not Azure's event model. It is a missing idempotency rule.

## Triggers

A trigger starts a function. Each function has one trigger. Common triggers include HTTP, timer, queue, blob, Event Grid, and Service Bus triggers.

The trigger determines how work enters the function and what the platform can do for you. An HTTP trigger behaves like a small request handler. A queue trigger pulls messages and can retry failed messages according to the queue and function settings. A timer trigger runs on a schedule.

For a beginner system, avoid choosing the trigger from habit. Choose it from the source of truth:

| Work | Better trigger shape | Why |
| --- | --- | --- |
| Receive a webhook from a payment provider | HTTP trigger | The event arrives as an HTTP request. |
| Send a receipt after checkout | Queue or Service Bus trigger | The message is the durable work item. |
| Rebuild a summary every night | Timer trigger | The schedule is the event. |
| Process uploaded files | Blob or Event Grid trigger | Storage change is the work source. |

The trigger also changes failure behavior. A failed HTTP request usually returns an error to the caller. A failed queue message can be retried or moved to a poison/dead-letter path. That difference should match the business flow.

## Invocations

An invocation is one run of a function. Logs, duration, status, exceptions, and correlation IDs usually attach to invocations. When someone says "the function failed," the first practical question is "which invocation failed and what event started it?"

Invocation thinking helps avoid two mistakes.

The first mistake is hiding state in process memory. Functions can scale out, restart, and run on different workers. A value kept in memory during one invocation may not exist for the next one. Put durable state in a real store.

The second mistake is assuming exactly-once behavior. Event systems usually aim for reliable delivery, not a guarantee that your side effect runs once and only once. If sending two receipts is unacceptable, use an idempotency key such as the order ID and store the send result.

## Bindings

Bindings are declarative input and output connections. They can make a function easier to write by handling some boilerplate around data sources. For example, a queue-triggered function can receive the message payload directly, and an output binding can write a result to another service.

Bindings are useful, but they should not hide architecture. A binding still talks to a real service. It still needs configuration, identity or credentials, error handling, and observability. If a binding cannot reach Storage or Service Bus, the function may fail before your business logic gets far.

Use bindings to reduce repetitive plumbing after you understand the data path. Do not use them to avoid naming the source of truth. The article's receipt function still starts from a durable queue message, even if the binding makes the handler signature small.

## Timeout And Retries

Functions have runtime limits and retry behavior that depend on the trigger and hosting plan. This is where "serverless" becomes concrete. A function that sometimes runs for 45 minutes, opens long connections, or needs a custom background daemon may not belong in the same shape as a quick queue message handler.

Timeouts should influence design early. If the job can be split into many small units, a queue-triggered function can work well. If one unit of work is long, stateful, and hard to retry, a container job, workflow service, or VM may be easier to reason about.

Retries need the same care. Retrying a failed receipt send is good if the send operation is idempotent. Retrying a payment capture without an idempotency key can charge a customer twice. The function runtime can help retry work, but the application must decide what repeated work means.

## Function App

A function app is the Azure resource that hosts one or more functions. It contains shared settings, runtime version, identity, deployment configuration, networking integration, and observability wiring such as Application Insights.

This grouping matters. Functions inside the same app share parts of the runtime boundary. If two functions need completely different settings, identities, scale profiles, or operational ownership, they may deserve separate function apps. If they are part of one cohesive workflow, grouping them can be simpler.

The hosting plan matters too. Current Azure guidance distinguishes options such as Flex Consumption, Premium, Dedicated, and other hosting models, each with different scale, cold start, networking, and cost behavior. Do not choose a plan only because "serverless" sounds cheap. Choose it because its scaling and latency behavior match the workload.

## When A Service Is Simpler

Functions are not a prize for making code small. Sometimes a normal service is simpler.

If the code is a steady HTTP API with shared request middleware, connection pooling, long-lived caches, and predictable traffic, App Service or Container Apps may be clearer. If the code is a containerized worker with custom libraries and event-based scaling, Container Apps can be a better host. If the code needs direct operating system control, a VM may be honest.

The warning sign is when the function design recreates a web service by scattering one product feature across many tiny handlers. That can make local development, deployment, logs, retries, and ownership harder. Use Functions when the event boundary makes the system simpler and smaller.

## Putting It All Together

The opener had receipt sending, search updates, and nightly reconciliation living too close to the web API. Functions gives each piece a clearer event boundary.

The receipt sender can start from a durable queue message. The search updater can react to an event that names the changed order. The nightly reconciliation can run from a timer. Each invocation has logs, duration, status, and retry behavior. The function app groups the runtime settings, identity, hosting plan, and observability.

The team still owns the hard parts that belong to the application: event design, idempotency, timeouts, dependency failure, and safe retries. Azure starts and scales the functions, but it does not decide what repeated business work should mean.

## What's Next

Next we will look at Virtual Machines, the compute shape where Azure gives you a cloud server and your team keeps the most operating responsibility.

---

**References**

- [What is Azure Functions?](https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview)
- [Azure Functions triggers and bindings concepts](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings)
- [Azure Functions hosting options](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)
