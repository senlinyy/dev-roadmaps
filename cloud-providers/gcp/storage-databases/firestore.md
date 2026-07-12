---
title: "Firestore"
description: "Use Firestore for app-shaped documents by designing documents, collections, paths, queries, indexes, transactions, batches, security rules, IAM, backups, and operating checks."
overview: "Firestore stores application documents in collections and supports planned queries, indexes, transactions, security rules, and IAM. The guide follows collaborative drafts and support cases from data shape to production checks."
tags: ["gcp", "firestore", "documents", "nosql"]
order: 4
id: article-cloud-providers-gcp-storage-databases-firestore-document-data-models
aliases:
  - firestore-and-document-data-models
  - firestore-document-data-models
  - cloud-providers/gcp/storage-databases/firestore-and-document-data-models.md
---

## Table of Contents

1. [Why App-Shaped Documents Fit Firestore](#why-app-shaped-documents-fit-firestore)
2. [Documents](#documents)
3. [Collections and Paths](#collections-and-paths)
4. [Queries](#queries)
5. [Indexes](#indexes)
6. [Transactions and Batches](#transactions-and-batches)
7. [Security Rules and IAM](#security-rules-and-iam)
8. [Backups, PITR, and TTL](#backups-pitr-and-ttl)
9. [A Practical Baseline](#a-practical-baseline)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

## Why App-Shaped Documents Fit Firestore
<!-- section-summary: Firestore fits data that the app naturally reads as documents by path or by planned indexed query. -->

Some application data feels close to a JSON object. A user edits a collaborative profile draft. A support agent opens a case note. A shopper saves a cart draft before checkout. The app wants one record that contains fields, nested values, timestamps, and workflow state.

**Firestore** is Google Cloud's document database. It stores documents in collections, lets apps read documents by path, and supports indexed queries over known fields. It works well for clear access patterns: open this draft, list the current user's drafts, find open support cases by priority, or update a small set of related documents.

Think of a Firestore document as one application-shaped record with a path. A profile draft can hold a display name, headline, sections, status, avatar object name, and last editor. The app can open that draft directly by path and render one screen without assembling many relational rows.

That convenience needs a plan. Firestore works best after you know the paths and queries the product needs. If the team only says "we may query anything later," the design will drift into expensive indexes, awkward migrations, and security rules that are hard to reason about. A good Firestore model starts from the screens, workflows, owners, and query shapes.

Firestore should be designed from the app's reads and writes. A document can look friendly on day one, yet large collections still need planned paths, queries, indexes, transactions, security rules, and recovery settings.

![Firestore collection document path](/content-assets/articles/article-cloud-providers-gcp-storage-databases-firestore-document-data-models/collection-document-path.png)
*Firestore design defines documents, collections, and paths before it moves into queries and indexes.*

## Documents
<!-- section-summary: A document is one named record with fields that the app can read, update, and protect. -->

A **document** is one named record with fields. If your app already passes around a JSON-like object, a Firestore document often feels familiar: it has keys, values, nested maps, arrays, timestamps, and a stable path. The path is important because Firestore can read a document directly by that path without searching a whole collection.

Picture a draft profile editor. The user changes the headline, uploads an avatar, marks some sections complete, and returns later. The app does not need a row for every optional profile section on day one. It needs one document that can hold the draft state in a shape close to the screen.

Documents can hold strings, numbers, booleans, timestamps, arrays, maps, references, and other supported Firestore value types. A document has an ID, and the full path identifies where it lives. The path is part of the design, not just a storage address. Security rules, queries, ownership checks, and support tooling all depend on that path.

A collaborative profile draft could look like this:

```json
{
  "ownerUserId": "user_391",
  "displayName": "Maya Chen",
  "headline": "Field operations lead",
  "avatarObjectName": "profile-photos/user_391/avatar/current.jpg",
  "sections": {
    "bio": "draft",
    "certifications": "complete",
    "availability": "draft"
  },
  "lastEditorUserId": "user_882",
  "updatedAt": "2026-07-04T10:25:00Z"
}
```

This shape is convenient because the profile editor can load one document and render the draft. The same convenience needs limits. Very large documents, frequently changing arrays, and hidden relationship rules can make the design hard to operate. If the data needs joins, strict multi-table relationships, or a financial transaction boundary, a relational database is usually a better fit.

Use this beginner checklist for a document:

- The app usually reads the whole document for one screen or workflow.
- The document has a clear owner, such as one user, one case, or one draft.
- The fields can change over time without breaking every query.
- The document will not grow without a practical limit.
- The access rule can be expressed from the path and fields.

That checklist keeps Firestore from turning into a random JSON dumping ground. A good document has a job, an owner, and a path the team can explain.

## Collections and Paths
<!-- section-summary: Collections group documents, and paths tell the app exactly where a document lives. -->

A **collection** is a group of documents. A **path** alternates collection IDs and document IDs. The path is part of the data model because it controls how the app addresses records.

The path is the first design decision users and rules will feel. A top-level collection such as `profileDrafts` makes it easy to query all drafts across users. A nested path such as `users/user_391/profileDrafts/current` makes ownership obvious and can make user-based security rules easier to read. Both are valid, but they optimize for different access patterns.

Two possible profile draft paths are:

- `profileDrafts/draft_user_391_current`
- `users/user_391/profileDrafts/current`

The first path puts all drafts in one top-level collection. The second path nests drafts under each user. Both can work. The right choice depends on the queries your app needs, the security rules you want to write, and the ownership boundary your team wants to make obvious.

A support case example might use:

- `supportCases/case_20260704_009`
- `supportCases/case_20260704_009/messages/msg_001`

That path says a support case is the parent record, and messages are child documents under that case. The app can load the case, then page through messages in the subcollection.

A practical path review should ask:

- Does the path make ownership obvious?
- Does the app usually read one document directly by path or query many documents by collection?
- Can security rules express the intended owner or team boundary?
- Will support tooling understand the path during an incident?

Answer those questions before the collection grows. Moving millions of documents to a new path later is much harder than choosing a clear path early.

## Queries
<!-- section-summary: A Firestore query should match a real screen, workflow, or backend job before the collection grows. -->

A **query** asks Firestore for documents that match filters and ordering. Queries should come from real product screens and backend jobs. If the support dashboard needs open high-priority cases assigned to one team, design that query deliberately.

Firestore is not a place to ask every possible question later by scanning everything. It is strongest after the team knows the access pattern. That means a query should sound like a product sentence: "show the billing team's open cases, newest first" or "load the current user's draft profile." Those sentences drive fields, indexes, limits, and security rules.

Example query shape in application terms:

- Collection: `supportCases`
- Filter: `status == "OPEN"`
- Filter: `assignedTeamId == "team_billing"`
- Order: `updatedAt desc`
- Limit: `50`

This query is useful because it maps to a screen. The support team opens a queue, sees the most recently updated open billing cases, and handles the first page. Firestore works best for indexed slices like this rather than broad scans.

The limit matters too. A screen that shows 50 cases should ask for 50 cases, not every open case in the company. Pagination, ordering, and stable filters keep the query predictable as the collection grows.

For AWS readers, Firestore may feel close to DynamoDB because both push you to model access patterns early. The modeling details differ. DynamoDB centers tables, partition keys, sort keys, and secondary indexes. Firestore centers document paths, collections, query filters, ordering, and composite indexes.

## Indexes
<!-- section-summary: An index is production configuration that makes a planned query possible and predictable. -->

An **index** is a data structure Firestore uses to answer queries efficiently. The everyday version is the index at the back of a book. Without an index, you might scan page after page to find every mention of one topic. With an index, you jump to the relevant pages quickly. Firestore indexes play that role for documents.

Simple single-field queries often have automatic index support. More complex queries, especially those combining filters and ordering, may need a **composite index**. A composite index is an index over more than one field, arranged to match a specific query pattern.

For the support queue, the app does not ask a vague question like "find interesting cases." It asks a precise product question: show open billing cases assigned to this team, newest first. That query combines `assignedTeamId`, `status`, and `updatedAt`. Firestore needs an index that matches that shape so the query has a predictable path.

Treat indexes as configuration. Review them like code, deploy them before the release that needs them, and watch query errors during rollout. A missing composite index often shows up as a clear error with a link or command to create the required index.

An index definition for the support queue could look like:

```json
{
  "indexes": [
    {
      "collectionGroup": "supportCases",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "assignedTeamId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "status",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "updatedAt",
          "order": "DESCENDING"
        }
      ]
    }
  ]
}
```

Important details in this config:

- `collectionGroup` names the collection the query uses.
- Equality filters such as team and status appear before the ordered timestamp.
- The index belongs in deployment review because the app screen depends on it.

Indexes also have a cost side. Every extra index has to be maintained as writes happen. A support case update may need to update the document and the indexes connected to that collection. That is fine for indexes that support real screens and jobs. It is wasteful for indexes created from guesses that no one uses.

The useful review path is simple:

1. Name the screen or job.
2. Write the query shape in plain language.
3. Add the index required for that query.
4. Deploy the index before the code path depends on it.
5. Remove unused indexes after query history proves they are dead.

![Firestore index query pipeline](/content-assets/articles/article-cloud-providers-gcp-storage-databases-firestore-document-data-models/index-query-pipeline.png)
*The app query, index definition, and screen behavior should describe the same access pattern.*

## Transactions and Batches
<!-- section-summary: Transactions coordinate reads and writes with conflict checks, while batches group writes that do not need read-based decisions. -->

A **transaction** lets the app read documents and write updates with conflict checks. It fits work such as claiming a support case only if it is still open, or moving a shopping cart draft into a submitted state only if the draft version matches what the user reviewed.

A **batched write** groups multiple writes that should commit together but do not need transaction reads. It fits work such as writing an audit document and updating a draft status after the app has already made the decision.

The difference is the decision step. A transaction is useful if the app must read current state before deciding what to write. A batch is useful if the decision is already made and the app only needs several writes to commit together. Mixing those up can create race conditions that look fine in local testing and fail under real users.

For support case claiming, two agents might click "claim" seconds apart. The backend needs to load the current case, confirm it is still open, and write the claim only if that loaded state is still valid. That is transaction work. For writing an audit record after the claim succeeds, a batch can group the status update and audit document because the claim decision has already been made.

For a support case claim, the backend might use transaction logic like:

1. Read `supportCases/case_20260704_009`.
2. Confirm `status` is `OPEN` and `assignedAgentId` is empty.
3. Set `assignedAgentId` to `agent_771`.
4. Set `status` to `IN_PROGRESS`.
5. Add `claimedAt`.

Important details in this flow:

- The read happens inside the transaction so Firestore can detect conflicting updates.
- The backend should make the claim idempotent for retries.
- The UI should handle a clean "already claimed" response because another agent may act first.

## Security Rules and IAM
<!-- section-summary: Security rules protect direct client access, while IAM controls server and operator access to Firestore resources. -->

**Security Rules** are Firestore's policy layer for direct client access from web and mobile apps. They answer questions such as: can this signed-in user read this draft, update this field, or list this collection? Rules should match the path design and the app's ownership model.

For backend services, **IAM** controls access at Google Cloud resource boundaries. A Cloud Run service account may need Firestore access to manage support cases. A human analyst may need read-only access to a dataset exported from Firestore rather than direct production write access.

A small rules sketch for user-owned profile drafts might look like:

```firestore
match /users/{userId}/profileDrafts/{draftId} {
  allow read: if request.auth != null
    && request.auth.uid == userId;

  allow create, update: if request.auth != null
    && request.auth.uid == userId
    && request.resource.data.keys().hasOnly([
      "ownerUserId",
      "displayName",
      "headline",
      "avatarObjectName",
      "sections",
      "status",
      "updatedAt",
      "expiresAt"
    ])
    && request.resource.data.ownerUserId == userId
    && request.resource.data.status in ["DRAFT", "SUBMITTED"];
}
```

Important details in this rule:

- The path includes `{userId}`, so the rule can compare it to the signed-in user.
- `hasOnly` prevents a client from adding surprise fields such as `role`, `billingApproved`, or `adminNote`.
- The `ownerUserId` check keeps the document owner aligned with the path owner.
- The status check shows the idea of validating state, although real workflows may need stricter transition rules.
- The rule protects direct client access; server code also needs IAM review.

Rules should be tested with both allowed and denied examples. A valid write by `user_391` to `/users/user_391/profileDrafts/current` should pass. A write by the same user that adds `role: "admin"` should fail. A write by `user_882` to `user_391`'s path should fail. Those denied tests are just as important as the successful test because they prove the rule protects the boundary you meant to create.

## Backups, PITR, and TTL
<!-- section-summary: Firestore recovery and cleanup need explicit choices for backups, point-in-time recovery, exports, and TTL policies. -->

Firestore data still needs recovery planning. A bug can overwrite profile drafts, a support automation can update the wrong cases, and a cleanup job can delete records too aggressively. **Backups** give the team a consistent database copy at a point in time. **Point-in-time recovery**, often called **PITR**, lets the team inspect or clone data from a specific timestamp inside the retained window.

Match the incident to the control before enabling anything:

| Incident | Control | Practical evidence |
|---|---|---|
| A profile editor release overwrites `headline` on active drafts | PITR clone or PITR export at the timestamp before the release | Restored sample drafts show the old `headline`, `updatedAt`, and owner fields |
| A support automation deletes case messages for the wrong team | Scheduled backup restored to a separate database | Case count and message samples match the pre-incident report |
| Temporary profile drafts pile up after users abandon onboarding | TTL policy on an `expiresAt` timestamp field | TTL policy status exists, and old drafts disappear from the cleanup collection over time |
| A developer changes rules or indexes incorrectly | Backup plus redeployed rules and indexes | Data restore is validated separately from rules and index deployment |

Use TTL for cleanup. Use backups and PITR for recovery. TTL removes stale documents after their timestamp says they are expired. Backups and PITR preserve earlier data states so the team can inspect or restore after a bad write or delete.

A temporary profile draft can carry an expiration timestamp:

```json
{
  "ownerUserId": "user_391",
  "displayName": "Maya Chen",
  "status": "DRAFT",
  "updatedAt": "2026-07-04T10:25:00Z",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

Important details in this document:

- `expiresAt` should be stored as a Firestore timestamp value.
- The app owns the business rule that chooses the timestamp, such as 180 days after the last draft edit.
- TTL deletion can lag after the timestamp passes, so product behavior should tolerate expired drafts during the cleanup delay.

Enable TTL for every `profileDrafts` collection group that uses that field:

```bash
gcloud firestore fields ttls update expiresAt \
  --project=profile-prod \
  --collection-group=profileDrafts \
  --enable-ttl
```

Example output:

```yaml
name: projects/profile-prod/databases/(default)/collectionGroups/profileDrafts/fields/expiresAt
ttlConfig:
  state: CREATING
```

This output proves the TTL policy operation started for the collection group and field. A follow-up list command should show the policy after the operation finishes:

```bash
gcloud firestore fields ttls list \
  --project=profile-prod \
  --collection-group=profileDrafts
```

Recovery needs a different check. A PITR drill should clone the database to a separate target at a known timestamp, then validate real documents from the incident story:

```bash
gcloud firestore databases clone \
  --source-database='projects/profile-prod/databases/(default)' \
  --snapshot-time='2026-07-04T14:10:00Z' \
  --destination-database='profile-restore-20260704'
```

Important details in this command:

- `--snapshot-time` should come from deploy records, audit logs, or incident notes.
- `profile-restore-20260704` is a separate database for validation.
- The validation should compare document counts, a few known document paths, and the fields that were damaged.

For scheduled backups, list the available backups and restore one to a separate database during a drill:

```bash
gcloud firestore backups list \
  --project=profile-prod \
  --location=nam5
```

The useful evidence is the backup resource name, the backup timestamp, the restore operation status, and application-level checks against restored documents. A backup or PITR drill only counts after the team can show which documents were recovered and how the app would use them.

## A Practical Baseline
<!-- section-summary: A practical Firestore baseline verifies database identity, index configuration, rules, recovery settings, and one real access path. -->

After the data model and access pattern are clear, create or verify the Firestore database:

The baseline is not only a checklist for launch. It proves that the document design, query design, access design, and recovery design all point at the same app behavior. A Firestore app can feel easy during a demo because one document read works. Production needs the surrounding controls before many users and many documents arrive.

Use the support-case example. The baseline should prove that the support queue query has its index, the rules or backend IAM prevent cross-team access, TTL does not delete active cases, backups or PITR cover bad automation, and logs can show a failed read or denied write without exposing case text.

```bash
gcloud firestore databases describe \
  --database="(default)" \
  --project=profile-prod \
  --format="yaml(name,locationId,type,deleteProtectionState,pointInTimeRecoveryEnablement)"
```

Important details in this command:

- `--database="(default)"` should match the database ID your app config uses.
- `locationId` confirms the database location.
- `deleteProtectionState` and PITR settings show whether recovery guardrails are enabled.

Deploy indexes and rules through your normal release path. A simplified Firebase CLI flow might use:

```bash
firebase deploy --only firestore:indexes,firestore:rules --project profile-prod
```

Important details in this command:

- Indexes and rules should be reviewed with the app change that needs them.
- Staging should run the same deployment shape before production.
- After deployment, test one real read, one allowed write, and one denied write.

## Putting It Together
<!-- section-summary: Firestore is strongest with document shape, path design, query planning, indexes, rules, and recovery designed together. -->

Firestore fits app-shaped records such as profile drafts, support cases, shopping cart drafts, and workflow state. The order matters: define documents, collections, and paths first; design real queries next; create indexes for those queries; use transactions or batches for coordinated writes; then protect access with rules and IAM.

The safest Firestore designs feel simple because the app's screens, paths, queries, indexes, and permissions all describe the same workflow.

![Firestore summary](/content-assets/articles/article-cloud-providers-gcp-storage-databases-firestore-document-data-models/firestore-summary.png)
*A production Firestore design connects paths, queries, indexes, writes, rules, and recovery settings.*

## References

- [Firestore data model](https://cloud.google.com/firestore/docs/data-model) - Documents collections, documents, paths, and supported field values.
- [Firestore queries](https://cloud.google.com/firestore/docs/query-data/queries) - Documents query filters, ordering, limits, and access patterns.
- [Firestore indexes](https://cloud.google.com/firestore/docs/query-data/indexing) - Documents single-field and composite index behavior.
- [Firestore transactions and batched writes](https://cloud.google.com/firestore/docs/manage-data/transactions) - Documents transactional reads and writes plus batched writes.
- [Firestore Security Rules](https://cloud.google.com/firestore/docs/security/get-started) - Documents direct client access rules for Firestore.
- [Firestore IAM](https://cloud.google.com/firestore/docs/security/iam) - Documents IAM roles and permissions for Firestore resources.
- [Firestore backup and restore](https://cloud.google.com/firestore/native/docs/backups) - Documents scheduled backups and restore behavior.
- [Firestore point-in-time recovery](https://cloud.google.com/firestore/native/docs/pitr) - Documents PITR behavior and recovery windows.
- [Work with Firestore point-in-time recovery](https://docs.cloud.google.com/firestore/native/docs/use-pitr) - Documents PITR clone and restore operations.
- [Firestore TTL policies](https://cloud.google.com/firestore/native/docs/ttl) - Documents TTL cleanup using timestamp fields.
