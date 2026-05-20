---
title: "Firestore"
description: "Use Firestore when application data fits documents and predictable access paths instead of relational joins or analytical warehouse queries."
overview: "Firestore can feel natural to JavaScript developers because documents look like objects, but the service has its own access-pattern rules. This article teaches Firestore through checkout drafts, preferences, indexes, transactions, and server-side access."
tags: ["gcp", "firestore", "documents", "nosql"]
order: 4
id: article-cloud-providers-gcp-storage-databases-firestore-document-data-models
aliases:
  - firestore-and-document-data-models
  - firestore-document-data-models
  - cloud-providers/gcp/storage-databases/firestore-and-document-data-models.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Firestore](#what-is-firestore)
3. [Documents](#documents)
4. [Collections](#collections)
5. [Paths](#paths)
6. [Access Patterns](#access-patterns)
7. [Indexes](#indexes)
8. [Transactions](#transactions)
9. [Security](#security)
10. [Wrong Shape](#wrong-shape)
11. [Sample Document Shape](#sample-document-shape)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Problem

Cloud SQL is a strong home for checkout records because orders, payments, and line items need relational rules. Some application state is smaller and more document-shaped.

The Orders system has examples:

- A user starts checkout on mobile and saves a draft cart.
- A customer preference record is read and written by user ID.
- A lightweight support note is attached to a ticket-like document.
- The app needs predictable lookups, not flexible joins across many tables.

Firestore can fit this kind of data. The mistake is treating it as "JSON storage" without designing paths, indexes, transactions, and security.

## What Is Firestore

Firestore is a document database. It stores documents inside collections and lets applications read, write, and query those documents through Firestore's model.

Document storage feels friendly because many developers already work with JSON-like objects. That familiarity is useful, but it can hide the real design question. Firestore works best when the app knows how it will find the documents before the data model grows.

| Need | Firestore fit |
| --- | --- |
| Read one document by path | Strong fit |
| Query a collection by indexed fields | Strong fit when query shape is known |
| Join many unrelated tables flexibly | Usually Cloud SQL or BigQuery shape |
| Run broad analytical scans | Usually BigQuery shape |

Start with the access path, then shape the documents.

## Documents

A document is a set of fields. A field can hold values such as strings, numbers, booleans, timestamps, arrays, maps, and references depending on the model and SDK.

For a checkout draft, a document might hold user ID, selected items, shipping choice, last-updated time, and a draft status. The document is small enough for the app to read and write as one unit.

```text
collection: checkoutDrafts
document: user_9138
fields:
  status: active
  itemCount: 3
  updatedAt: 2026-05-17T12:20:00Z
```

Documents are convenient. They should still have a clear owner, path, update pattern, and deletion policy.

## Collections

A collection groups documents. A collection can contain many documents with similar purpose, such as `checkoutDrafts`, `userPreferences`, or `supportNotes`.

Collections are part of the model because queries usually target collections or collection groups. If the team chooses collection boundaries carelessly, simple reads can become awkward later.

For example, if the app almost always reads a draft by user ID, `checkoutDrafts/{userId}` is easy to explain. If support notes are queried by ticket ID, the model should make that path visible.

## Paths

Paths tell the app where a document lives. A path such as `checkoutDrafts/user_9138` is more than a name. It is part of the access pattern.

The path should answer a real lookup question:

| Question | Possible path |
| --- | --- |
| What is this user's active checkout draft? | `checkoutDrafts/{userId}` |
| What preferences does this user have? | `userPreferences/{userId}` |
| What notes belong to this support ticket? | `tickets/{ticketId}/notes/{noteId}` |

Good paths make common reads obvious. Poor paths force the app to query around its own data model.

## Access Patterns

An access pattern is the way the app finds and changes data. Firestore design should start there.

If the app needs to read one document by exact path, Firestore can be very direct. If the app needs to query drafts updated after a timestamp by status, the model and indexes should support that. If the product team wants arbitrary reporting across all draft changes, BigQuery may be a better analytical sink.

The non-obvious truth is that Firestore flexibility still has shape. You do not get relational joins just because the fields look like objects. You design for known reads and writes.

## Indexes

Firestore uses indexes to support queries. Some indexes are automatic. Composite query shapes may require composite indexes.

This means indexes are part of the application design. If a query needs `status = active` and `updatedAt < cutoff`, the team should expect an index decision. If an index is missing, the app may fail when that query path is used.

Treat an index as evidence of an access pattern. It tells future engineers that some query mattered enough to support.

## Transactions

Firestore supports transactions and batched writes, but the boundaries are different from relational databases. A transaction can help when multiple document reads and writes need a consistent update. It does not turn Firestore into a relational database with arbitrary joins and constraints.

For checkout drafts, a transaction might prevent two devices from overwriting the same draft version. For final checkout records, Cloud SQL may still be the better place because order, payment, and line-item relationships need relational guarantees.

Use Firestore transactions for document-shaped consistency. Use Cloud SQL when the business model is relational.

## Security

Firestore can be accessed from server-side code and, in some app designs, directly from clients with Security Rules. The security model must match the access path.

For a backend API, server-side access through a service account may be enough. The Cloud Run runtime identity reads and writes the documents, and the app enforces user authorization. For client-direct access, Security Rules become part of the application boundary and need careful testing.

Do not assume document paths are secret. Authorization should be explicit.

## Wrong Shape

Firestore is the wrong shape when the data needs relational joins, strong constraints across many tables, or ad hoc analytical reporting. It can also be awkward when a document grows without bound or when one hot document receives too much write pressure.

These are design signals:

| Signal | Better first thought |
| --- | --- |
| Many joins and constraints | Cloud SQL |
| Large analytical scans | BigQuery |
| Whole files or images | Cloud Storage |
| Shared mounted path | Filestore |
| Fast document lookup by known path | Firestore |

Choosing Firestore should make the access pattern simpler beyond the first write.

## Sample Document Shape

For the Orders system, a Firestore use case might be:

| Part | Example |
| --- | --- |
| Collection | `checkoutDrafts` |
| Document ID | User ID |
| Fields | Selected items, shipping choice, status, update time |
| Access pattern | Read and update by user ID |
| Index | Status plus update time for cleanup |
| Security | Server-side Cloud Run access through runtime identity |
| Recovery | Export or backup strategy for important state |

This shape is intentionally narrow. Firestore works best when the document job is clear.

## Putting It All Together

Return to the opening problems.

Checkout drafts and preferences can fit Firestore when the app reads them by predictable path.

Collections and paths are part of the model, not decoration. They should match how the app finds data.

Indexes reveal query patterns. A missing index is often a missing design decision.

Transactions help with document-shaped consistency, but relational checkout facts still belong in Cloud SQL.

Security must match the access path. Server-side access and client-direct access are different models.

## What's Next

Firestore handles document-shaped app state. Analytics questions have a different shape again: they scan and group many facts. Next, we look at BigQuery.

---

**References**

- [Google Cloud: Firestore overview](https://cloud.google.com/firestore/docs/overview)
- [Google Cloud: Firestore data model](https://cloud.google.com/firestore/docs/data-model)
- [Google Cloud: Firestore indexes](https://cloud.google.com/firestore/docs/query-data/indexing)
- [Google Cloud: Firestore transactions](https://cloud.google.com/firestore/docs/manage-data/transactions)
