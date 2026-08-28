---
title: "Firestore"
description: "Use Firestore for app-shaped documents by designing documents, collections, paths, queries, indexes, transactions, batches, security rules, IAM, backups, and operating checks."
overview: "Firestore stores application documents in collections and supports planned queries, indexes, transactions, Security Rules, and IAM. The guide follows project and task documents from data shape through queries, authorization, recovery, and expiration."
tags: ["gcp", "firestore", "documents", "nosql"]
order: 4
id: article-cloud-providers-gcp-storage-databases-firestore-document-data-models
aliases:
  - firestore-and-document-data-models
  - firestore-document-data-models
  - cloud-providers/gcp/storage-databases/firestore-and-document-data-models.md
---

## Table of Contents

1. [Why Does Application State Fit Documents and Collections?](#why-does-application-state-fit-documents-and-collections)
2. [How Should Nested Fields and Subcollections Divide Data?](#how-should-nested-fields-and-subcollections-divide-data)
3. [Why Do Queries, Duplication, and Indexes Need One Design?](#why-do-queries-duplication-and-indexes-need-one-design)
4. [When Should You Use Transactions or Batched Writes?](#when-should-you-use-transactions-or-batched-writes)
5. [How Do Security Rules and IAM Protect Different Callers?](#how-do-security-rules-and-iam-protect-different-callers)
6. [What Does Serverless and Real-Time Mean for the Application?](#what-does-serverless-and-real-time-mean-for-the-application)
7. [How Do Backups, PITR, and TTL Treat Time Differently?](#how-do-backups-pitr-and-ttl-treat-time-differently)
8. [How Does a Practical Firestore Model Fit Together?](#how-does-a-practical-firestore-model-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Imagine a task-management application. A project screen needs a name, owner, status, priority, budget, creation time, and settings. The application probably already represents this state as one object and performs operations such as load project, display project, edit project, and save project.

A **document database** follows that intuition. Firestore is Google Cloud's fully managed serverless document database. Its basic units are collections and documents rather than tables and rows. Google manages the underlying serving infrastructure, replication, and scale while Firestore supplies strongly consistent queries and ACID transactions.

A **document** is a self-contained record made of named fields and values:

```text
project: launch-website

name       = "Launch website"
ownerId    = "alice"
status     = "active"
priority   = "high"
budget     = 10000
archived   = false
createdAt  = timestamp
```

Values can include primitives, arrays, maps, timestamps, geographic points, references, and other supported types. Nested maps let the record hold a small settings object; arrays can hold a bounded list of tags. The key design idea is that the document should normally match something the application reads or updates as a unit.

Keep these questions in view as you work through the lesson:

1. **Why Does Application State Fit Documents and Collections?**
2. **How Should Nested Fields and Subcollections Divide Data?**
3. **Why Do Queries, Duplication, and Indexes Need One Design?**
4. **When Should You Use Transactions or Batched Writes?**
5. **How Do Security Rules and IAM Protect Different Callers?**
6. **What Does Serverless and Real-Time Mean for the Application?**
7. **How Do Backups, PITR, and TTL Treat Time Differently?**
8. **How Does a Practical Firestore Model Fit Together?**

## Why Does Application State Fit Documents and Collections?
<!-- section-summary: Firestore stores self-contained application records as documents addressed through alternating collection and document paths. -->

Firestore documents live inside **collections**, which give them addresses:

```text
users
├── alice
├── bob
└── charlie
```

The full path `/users/alice` alternates collection then document. Paths can continue through subcollections:

```text
/projects/launch-website/tasks/task-123

projects         collection
launch-website   document
tasks            subcollection
task-123         document
```

![Collection document path](/content-assets/articles/article-cloud-providers-gcp-storage-databases-firestore-document-data-models/collection-document-path.png)
*Firestore paths alternate collections and documents, so each document has an explicit application context.*

SQL could represent a simple user row with the same fields. The difference becomes clearer with nested application state. A user's preferences can sit inside `/users/alice` if the application normally needs them whenever it loads the user. Firestore pulls the design toward access patterns: structure data around what the application reads together, rather than decomposing every object immediately into normalized tables.

### Use the document as a retrieval boundary

A useful document contains state that changes and travels together. A project name, owner, status, and small settings map can form one boundary because the project screen normally needs all of them. That does not mean every fact related to the project belongs in the same document. A million comments are related conceptually but have an independent lifecycle and query pattern.

Document references and ID fields can express relationships for application code, but they do not create database-enforced foreign keys. The team decides what happens when a referenced user is deleted, whether historical documents keep a copied display name, and how missing references are repaired.

The path also carries meaning. `/projects/p1/tasks/t1` makes task `t1` a child in project `p1`'s namespace. The task document can still repeat `projectId = p1` when a required query benefits from that field. Path hierarchy and document fields are tools for access, not competing claims about a single mathematically pure model.

## How Should Nested Fields and Subcollections Divide Data?
<!-- section-summary: Small bounded state can live inside one document, while independently growing or queried records should become separate documents. -->

A project can contain thousands of tasks. Placing every task inside one project document creates a container that grows without bound and must be repeatedly read and updated. A subcollection lets each task remain independently addressable:

```text
/projects/launch-website
    name: "Launch website"
    ownerId: "alice"

/projects/launch-website/tasks/configure-dns
    title: "Configure DNS"
    completed: false
    assigneeId: "bob"
```

Firestore is designed around large collections of relatively small documents. The choice between a nested field and a subcollection follows two questions: can this data grow independently, and does the application need to query it independently?

Small bounded configuration such as an address, preferences, or settings can fit as nested data when it is usually read with the parent. Unbounded sets such as messages, comments, transactions, tasks, or notifications usually deserve their own documents. Otherwise every new child changes and enlarges the parent.

Firestore reads are deliberately shallow. Reading `/projects/launch-website` returns that document; it does not recursively fetch tasks, comments, attachments, and activity. Recursive loading could turn one project read into tens of thousands of task reads and hundreds of thousands of comments. The application instead explicitly asks for the project and then queries the subset of child data it needs, such as incomplete tasks ordered by priority with a limit.

This predictability is part of the data model. A path expresses context but does not imply eager recursive retrieval. Teams should avoid assuming that a parent document contains or automatically returns its subcollections.

Firestore also does not treat an `ownerId` field as a SQL foreign key. If `/projects/project1` contains `ownerId = "alice"`, the database does not automatically join it with `/users/alice` or reject it when the referenced user is absent. The application can read the project and then the user, or duplicate selected owner fields in the project when the UI needs them together.

That leads to the next design concern: reads, duplication, and indexes must be decided together rather than after the collection already contains millions of documents.

### Avoid turning the parent into an unbounded payload

An array of three fixed notification preferences may be reasonable inside a user document. An array of every notification the user has ever received grows without a clear bound, makes the parent expensive to rewrite, and cannot be independently paged in the same way as a collection. The data deserves separate documents even though the UI calls both things “user data.”

Shallow reads then become an advantage. Opening the user does not accidentally download years of notifications. The application requests a limited ordered page from `/notifications`, and each document can carry the user ID and expiry needed by that query and TTL policy.

## Why Do Queries, Duplication, and Indexes Need One Design?
<!-- section-summary: Firestore data models are designed from concrete reads backward because denormalization and indexes determine both read simplicity and write cost. -->

Without SQL JOINs, duplicating a small piece of display data can make a common read much simpler. A recent-post page may need one hundred posts plus each author's display name and avatar. A normalized model reads posts and then resolves authors. A denormalized post can embed the author's ID, name, and avatar URL so one document read contains the display state.

Duplication moves cost rather than eliminating it. If Alice changes her display name, the team must decide whether existing posts retain the historical name, update lazily, or receive a fan-out change. There is no universal answer. The useful Firestore question is which fields the application needs to read together and which synchronization consequence it is prepared to own.

Queries then select documents through fields. A task query might ask:

```text
assigneeId = "alice"
status     = "open"
order by dueAt
```

Searching one hundred million tasks by checking each document would be a full scan. An **index** keeps an auxiliary structure that maps field values to matching documents. Firestore Standard edition is index-driven: queries require suitable indexes rather than silently falling back to arbitrary collection scans.

Firestore creates many single-field indexes automatically. A query combining assignee, status, and due date may need a **composite index** whose ordered fields resemble the query:

```text
assignee | status | dueAt
---------+--------+-----------
alice    | open   | 2026-08-24
alice    | open   | 2026-08-25
alice    | open   | 2026-09-01
```

The matching records form a contiguous region of that index. When a required Standard-edition index is missing, Firestore commonly reports the needed composite index so the team can create it.

![Firestore index query pipeline](/content-assets/articles/article-cloud-providers-gcp-storage-databases-firestore-document-data-models/index-query-pipeline.png)
*A query uses its supporting index to find matching document keys before fetching the result documents.*

Indexes make reads fast by adding work to writes. Changing a task can require updates to document storage, several single-field indexes, and multiple composite indexes. They also consume storage. Indexing every possible field combination therefore has a cost.

This is why Firestore design starts with concrete screens and operations:

- The home page needs twenty newest public posts.
- A profile needs fifty newest posts by one user.
- Moderation needs unreviewed posts ordered by report count.
- “My tasks” needs open tasks for one assignee ordered by due date.

Those reads influence collection layout, duplicated fields, separate documents, single-field exemptions, composite indexes, and Security Rules. Data model, query model, index model, and authorization model are one design problem.

### Account for the write side of denormalization

If a post embeds Alice's display name, an update policy must say whether old posts are historical snapshots or current-profile projections. Historical snapshots intentionally do not change. Current projections may require an application job to update many posts. A mixed or undocumented policy produces confusing UI and unpredictable write volume.

Every copied field should therefore have an owner and synchronization rule. The read benefit may be substantial, but it is purchased with more writes, more index updates, and the possibility that copies temporarily disagree. Firestore makes this trade-off available; it does not choose it for the application.

Composite indexes also encode a query contract. Removing a field or changing sort order can make an existing index unnecessary, while adding another filter can require a new index. Index review belongs with feature review because the feature's actual reads determine the database work.

## When Should You Use Transactions or Batched Writes?
<!-- section-summary: Transactions protect read-decide-write logic, while batched writes atomically apply a predetermined set of changes. -->

A write to one document is atomic: readers do not observe a half-written document whose name changed while its priority did not. Applications often need one logical operation to affect several documents.

Suppose `/events/conference` says five seats remain. Alice and Bob can both read five, each create a booking, and each write four. Two bookings exist while the counter fell once. This is a lost update.

A **transaction** groups reads and writes that depend on current state:

```text
read event
if remainingSeats > 0:
    update event counter
    create booking
```

If another client changes a document read by the transaction before it completes, Firestore can retry against newer state. The transaction is atomic: all operations succeed or none is applied.

A **batched write** solves a different problem. Sometimes the application already knows it must create notification A, create notification B, update a project, and delete an invitation. No calculation depends on first reading current values; the requirement is only that all predetermined writes succeed together or none does.

The distinction is:

| Mechanism | Contents | Typical reason |
|---|---|---|
| Transaction | Reads plus dependent writes | Current state determines the changes; conflicts may require retry |
| Batched write | Writes only | A known set of creates, updates, or deletes must be atomic |

Transactions give Firestore atomicity and concurrency control, but they do not turn it into a relational database. Firestore does not automatically add foreign keys, JOINs, normalized schemas, or parent-child constraints. A project can still contain `ownerId = "does-not-exist"` unless the application architecture validates that invariant.

Transaction boundaries should follow application meaning. If completing a task also increments a project's completed-task count, one transaction can read both records, verify the task is not already completed, update its status, and update the counter. If conflicting data changes, the operation retries. The team still owns the rule that those documents must change together.

## How Do Security Rules and IAM Protect Different Callers?
<!-- section-summary: Untrusted mobile and web clients use Firebase Authentication plus Security Rules, while trusted server SDKs use cloud identity and IAM. -->

Firestore supports an architecture in which a mobile or web client talks directly to the database. That removes a custom API server from some application paths, but it makes database-side authorization essential. JavaScript or mobile code running on a user's device is untrusted: a user can inspect it, modify requests, call APIs manually, or build another client.

For those callers, Firebase Authentication establishes identity and **Firestore Security Rules** decide whether an operation is allowed. Authentication answers “who are you?” Rules answer “what may that identity read or write?”

A rule can conceptually allow access to `/users/{userId}` only when the authenticated user's ID equals `userId`. It can also validate proposed data, for example requiring priority to stay between one and five or preventing a caller from changing `ownerId`.

Security Rules are not query filters. If Alice may read only projects where `ownerId = "alice"`, she cannot request every project and expect Firestore to remove Bob's results afterward. Firestore checks whether the query itself can return only authorized documents. Queries are allowed or denied as a whole, so the client query may need an explicit owner condition that matches the rule.

This all-or-nothing behavior reinforces the combined design:

```text
document fields
    ↓
query constraints
    ↓
supporting indexes
    ↓
Security Rules that can prove the result is allowed
```

Suppose a rule permits Alice to read project documents whose `ownerId` equals her authenticated UID. A query for every project has a possible result containing Bob's document, so Firestore rejects it rather than fetching everything and removing Bob's rows. A query constrained to Alice's owner ID can match the rule's guarantee. The same owner field may therefore participate in data modeling, a query, an index, and authorization.

Rules can also compare existing and proposed data. An owner may edit a project's title while a rule refuses any update that changes `ownerId`. This protects the boundary at the database even when a modified client sends a request the official UI never creates.

Trusted server applications use a different boundary. A Cloud Run API using a Firestore server SDK bypasses Firestore Security Rules. The server authenticates with Google Cloud credentials and receives access through IAM. Therefore:

```text
mobile or browser
→ Firebase Authentication + Security Rules

trusted backend
→ Google Cloud workload identity + IAM
```

The backend must enforce end-user business permissions itself before acting with its broader service identity. Server trust is not a reason to give every workload unrestricted database access; use least-privilege IAM and separate service identities.

Rules should be tested rather than treated as one-time configuration. Firebase's emulator can exercise allowed and denied reads, queries, and writes before deployment.

## What Does Serverless and Real-Time Mean for the Application?
<!-- section-summary: Firestore removes database-server capacity management and can stream changing query results, while the team still owns data and query design. -->

Cloud SQL exposes a recognizable server instance with CPU, RAM, storage, and connections. Firestore is **serverless**: applications use a managed database without pre-provisioning ordinary database compute capacity or manually configuring normal-operation sharding.

The application thinks in documents, queries, reads, writes, and indexes rather than sizing a single database machine and its connection pool. Documents and indexes are served through Google-managed distributed infrastructure. This eliminates a category of database-server operations, but it does not eliminate architecture.

The team still decides document boundaries, collection paths, embedded versus referenced data, duplication, composite indexes, transaction scope, Security Rules, IAM, recovery, and expiration semantics. Serverless shifts effort from infrastructure-capacity decisions toward access-pattern decisions.

Firestore also supports **real-time listeners**. A client can subscribe to a document or query result and receive changes, which fits chat, collaborative state, dashboards, and notifications. The flow is:

```text
document or query changes
        ↓
Firestore listener
        ↓
UI state updates
```

The client ecosystem also supports offline-oriented application patterns. These capabilities can replace custom polling and some synchronization code, but they do not change the underlying authorization and query requirements. A listener still needs an allowed query and supporting indexes.

Firestore's scaling centre differs from a traditional SQL server, but scaling does not make every data model efficient. Large documents repeatedly rewritten, unnecessary indexes, overly broad listeners, and poor query boundaries can still create cost or performance problems. Managed infrastructure makes the model easier to operate; it does not repair a model that ignores how the application reads and writes data.

### Real-time delivery follows the query boundary

A listener on one project document receives that document's changes, not an automatic recursive stream of every task and comment below it. A query listener receives changes to the result set described by its filters and ordering. The client may therefore maintain separate listeners for the project and its current open tasks.

This explicit shape keeps synchronization bounded. It also means an authorization or index mistake can prevent the listener from starting just as it would prevent a one-time query. Real-time behavior is another consumer of the same data, query, index, and Rule contract.

Offline support does not remove conflict reasoning either. Clients can reconnect after local activity, and the application still needs appropriate update operations or transactions for state that must not lose concurrent changes. The managed client experience sits above the same document consistency model.

## How Do Backups, PITR, and TTL Treat Time Differently?
<!-- section-summary: Backups and PITR preserve unwanted history for recovery, while TTL intentionally removes disposable documents after an expiry. -->

A highly available, replicated database can preserve a developer's accidental deletion perfectly. Historical recovery is still necessary when current state becomes wrong.

Firestore scheduled backups capture a consistent database copy at a point in time, including data and index configuration. Current schedules can run daily or weekly, and retention can extend to fourteen weeks. A backup answers: can the team restore an older database copy?

**Point-in-time recovery**, or PITR, handles recent mistakes with finer granularity. When enabled, Firestore can retain document versions for up to seven days and provide historical reads at minute-level granularity within the window. If corruption starts at 10:42 and is found at 10:47, PITR can target state shortly before the bad deployment rather than using yesterday's backup.

Backups and PITR complement each other:

```text
scheduled backups
→ coarser restore points retained longer

PITR
→ fine-grained recent historical state
```

**Time to live**, or TTL, points in the opposite temporal direction. A session document can include `expiresAt`; after that time, Firestore eventually removes it automatically. TTL fits temporary sessions, old telemetry, ephemeral events, cache-like records, and verification data that should disappear.

TTL is lifecycle cleanup, not precise scheduling. Expired documents become eligible for asynchronous deletion; documents with the same timestamp are not guaranteed to disappear at exactly the same instant or in one transaction. An application must not treat noon expiry as proof that every document is gone at 12:00:00.

| Mechanism | Question |
|---|---|
| Backup | “Can I restore an older database copy?” |
| PITR | “What did the database look like shortly before the mistake?” |
| TTL | “When may this disposable document be cleaned up?” |

TTL intentionally removes data. Backups and PITR protect against unwanted change and deletion. The same dataset can need both: temporary notifications may expire by TTL while the broader database remains covered by recovery controls.

## How Does a Practical Firestore Model Fit Together?
<!-- section-summary: A useful model starts from application reads, separates growing records, aligns indexes and authorization, and deliberately owns duplication and recovery. -->

Consider a project-management application:

```text
/users/{userId}
/projects/{projectId}
/projects/{projectId}/tasks/{taskId}
/projects/{projectId}/comments/{commentId}
/notifications/{notificationId}
```

The project document can contain name, owner ID, member IDs, status, and creation time. Each task can contain title, assignee ID, status, priority, and due date. A notification can contain user ID, event type, project and task IDs, creation time, and expiration time.

Fields such as user ID, project ID, and task ID may appear in several documents intentionally. They let queries retrieve the application state without joins.

When Bob opens “My open tasks,” the authenticated client asks for tasks where `assigneeId = bob` and `status = open`, ordered by `dueAt`. A suitable index locates the documents. Security Rules determine whether the query can return only allowed data. The UI renders the result and may keep a real-time listener open so a task completed elsewhere disappears from the list.

When Bob completes a task, the application may need to mark the task complete and increment the project's completed-task counter. One transaction reads both documents, verifies the task is not already complete, updates it, and adjusts the project. A concurrent change causes a retry rather than an unchecked overwrite.

The team and service responsibilities remain distinct:

| Firestore largely handles | Team still designs |
|---|---|
| Database servers and serving scale | Documents, collections, and paths |
| Replication and storage infrastructure | Embedded versus referenced state |
| Index serving machinery | Composite indexes and exemptions |
| Atomic transaction mechanism | Business transaction boundaries |
| Real-time synchronization plumbing | Listener and application behavior |
| Backup, PITR, and TTL machinery | Recovery and expiration policies |
| Rule enforcement mechanism | Security Rules and IAM policy |

A practical baseline keeps documents reasonably self-contained, moves growing queryable sets into separate documents, designs important queries before schema growth, duplicates small fields only when the read benefit justifies synchronization work, and creates only useful indexes. Transactions protect read-decide-write operations; batches protect predetermined atomic writes. Mobile and web callers use Authentication and Rules; trusted servers use IAM. Recovery matches the value of data, while TTL is reserved for data that is genuinely disposable.

### Review one feature from screen to recovery

For “My open tasks,” write down the screen's filters and sort first. Confirm that each task document carries assignee, status, and due time; that the composite index matches the query; and that the Security Rule can prove the authenticated user is allowed to see every possible result. Decide whether the listener is needed or a one-time read is enough.

For completion, state the transaction boundary between the task and project counter. Test two clients completing the same task so the retry path does not double-increment. For server-side maintenance, give the backend a workload identity and IAM role appropriate to its job rather than relying on client Rules.

Finally, decide how an accidental bulk change is recovered. PITR can cover a recent minute-level target, while scheduled backups can retain coarser history longer. If task notifications expire through TTL, verify that they are genuinely disposable and that asynchronous cleanup is acceptable. The feature is complete only when its normal reads, concurrent writes, authorization, and history all have explicit answers.

Cloud SQL and Firestore pull design in different directions. Cloud SQL centres normalized rows, keys, joins, database-enforced relationships, explicit server instances, and pooled connections. Firestore centres documents, collection paths, planned indexed reads, deliberate denormalization, serverless serving, and first-class direct client access. Both support indexes and transactions, but those shared features do not erase their different data models.

The complete chain begins with application objects, stores them as documents, gives them collection paths, separates large child sets, designs queries, supplies indexes, coordinates multi-document changes, protects untrusted clients with Rules, protects trusted services with IAM, lets Google scale the infrastructure, and finally preserves or expires history with backups, PITR, and TTL.

### Use one decision record for each collection

For a new collection, record the document's application unit, expected size and growth, parent path, and whether child data belongs in nested fields or separate documents. List the exact queries, their filters and ordering, and the single-field or composite indexes they require.

Then record duplication. Each copied owner name, project ID, or display field needs a reason and an update policy. State whether it is a historical snapshot or a current projection so future developers do not invent conflicting synchronization behavior.

Next record write correctness. Single-document updates are atomic by default. Multi-document read-decide-write behavior needs a transaction; a known all-or-nothing write set can use a batch. References that would be foreign keys in SQL need an explicit application invariant because Firestore does not enforce them automatically.

Finally, record both trust paths. Mobile and web access needs Authentication, query-compatible Security Rules, and emulator tests for allowed and denied operations. Server access needs workload identity, least-privilege IAM, and application-level user authorization. Scheduled backups and PITR need restore procedures; TTL fields need truly disposable data and tolerance for asynchronous deletion.

This record keeps “serverless” from becoming “designless.” Google supplies and scales the serving machinery, while the team retains a reviewable contract for document boundaries, queries, indexes, concurrency, authorization, and history.

Revisit the record when a screen or query changes. Adding a sort field can require a new composite index; broadening a query can make a Security Rule unable to prove access; embedding more children can turn a bounded document into an unbounded one. These are connected effects, not independent configuration chores.

The final comparison with Cloud SQL should stay operational. Choose Firestore because the application works naturally with documents, planned indexed reads, real-time listeners, and its trust model. Choose a relational system when database-enforced relationships, joins, and normalized transactional records dominate. The presence of transactions in both systems does not make their native units of thought the same.

The time controls deserve the same boundary. Backups retain consistent database copies and index configuration on daily or weekly schedules, PITR retains recent document history at minute granularity, and TTL asynchronously removes documents after an expiry field. A notification can be intentionally disposable while the project and task database still requires historical recovery. Enabling TTL without that classification can turn lifecycle automation into data loss; enabling backups without a restore procedure can turn successful jobs into false confidence.

## Check Your Answers

:::expand[Why Does Application State Fit Documents and Collections?]{kind="recap"}
Firestore stores self-contained application records as documents, and alternating collection/document paths give those records an address and context.
:::

:::expand[How Should Nested Fields and Subcollections Divide Data?]{kind="recap"}
Keep small bounded state inside a document when it is read together. Move independently growing or queried sets into separate documents and subcollections.
:::

:::expand[Why Do Queries, Duplication, and Indexes Need One Design?]{kind="recap"}
Without joins, duplicated fields can simplify reads but create synchronization work. Concrete queries determine document fields, collection layout, and supporting indexes.
:::

:::expand[When Should You Use Transactions or Batched Writes?]{kind="recap"}
Use a transaction when writes depend on current reads and may retry after conflicts. Use a batch when a predetermined set of writes must succeed atomically.
:::

:::expand[How Do Security Rules and IAM Protect Different Callers?]{kind="recap"}
Untrusted mobile and web clients use Firebase Authentication and Security Rules. Trusted server SDKs bypass Rules and use Google Cloud identity plus IAM.
:::

:::expand[What Does Serverless and Real-Time Mean for the Application?]{kind="recap"}
Google manages database serving capacity and can stream changing results. The team still owns document, query, index, authorization, and listener design.
:::

:::expand[How Do Backups, PITR, and TTL Treat Time Differently?]{kind="recap"}
Backups keep coarser historical copies, PITR exposes fine-grained recent state, and TTL asynchronously deletes intentionally disposable documents after expiry.
:::

:::expand[How Does a Practical Firestore Model Fit Together?]{kind="recap"}
Start from screens and reads, separate growing records, align queries with indexes and Rules, use atomic writes deliberately, and choose recovery and expiration policies explicitly.
:::

## References

- [Firestore overview](https://docs.cloud.google.com/firestore/native/docs/overview)
- [Firestore data model](https://docs.cloud.google.com/firestore/native/docs/data-model)
- [Firestore queries](https://firebase.google.com/docs/firestore/query-data/queries)
- [Firestore indexes](https://docs.cloud.google.com/firestore/native/docs/standard-index-overview)
- [Transactions and batched writes](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions)
- [Firestore Security](https://firebase.google.com/docs/firestore/security/overview)
- [Security Rules fields](https://firebase.google.com/docs/firestore/security/rules-fields)
- [Security Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Firestore backups](https://cloud.google.com/firestore/docs/backups)
- [Firestore PITR](https://docs.cloud.google.com/firestore/native/docs/pitr)
- [Firestore disaster recovery](https://docs.cloud.google.com/firestore/native/docs/disaster-recovery)
- [Firestore TTL](https://docs.cloud.google.com/firestore/native/docs/ttl)
- [Test Security Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
