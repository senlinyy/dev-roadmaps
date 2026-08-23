---
title: "Moving Data Into and Around AWS"
description: "Choose and operate AWS data-movement services by reasoning about state, change rate, network limits, validation, cutover, and rollback."
overview: "Moving data is not just copying bytes. This article develops a first-principles model for objects, files, databases, partner feeds, hybrid access, long-distance transfers, physical transfer, validation, and ownership at cutover."
tags: ["aws", "data-migration", "datasync", "dms", "s3", "transfer-family"]
order: 6
id: article-cloud-providers-aws-storage-databases-moving-data-into-around-aws
aliases:
  - moving-data-into-and-around-aws
  - moving-data-around-aws
  - aws-data-movement
  - cloud-providers/aws/storage-databases/moving-data-into-and-around-aws.md
---

## Table of Contents

1. [What Does Moving Data Actually Mean?](#what-does-moving-data-actually-mean)
2. [How Do Size, Bandwidth, and Dataset Shape Affect a Move?](#how-do-size-bandwidth-and-dataset-shape-affect-a-move)
3. [Why Do Objects, Files, and Databases Need Different Tools?](#why-do-objects-files-and-databases-need-different-tools)
4. [How Do You Move File Shares or Keep Their Existing Interface?](#how-do-you-move-file-shares-or-keep-their-existing-interface)
5. [How Do You Move a Live Database with Little Downtime?](#how-do-you-move-a-live-database-with-little-downtime)
6. [What Changes When Data Is Far Away or the Network Is Too Slow?](#what-changes-when-data-is-far-away-or-the-network-is-too-slow)
7. [How Do You Prove That a Migration Is Correct?](#how-do-you-prove-that-a-migration-is-correct)
8. [How Do You Choose the Right AWS Data Movement Service?](#how-do-you-choose-the-right-aws-data-movement-service)
9. [References](#references)

Moving data sounds simple until the source changes during the copy. If a source contains 100 GB when copying begins but users add another 4 GB before it ends, a destination containing the original 100 GB is already behind. Files may also carry permissions and timestamps, while database rows belong to transactions. A successful transfer therefore has to preserve more than an amount of data.

The sections below answer these questions in order:

1. **What Does Moving Data Actually Mean?**
2. **How Do Size, Bandwidth, and Dataset Shape Affect a Move?**
3. **Why Do Objects, Files, and Databases Need Different Tools?**
4. **How Do You Move File Shares or Keep Their Existing Interface?**
5. **How Do You Move a Live Database with Little Downtime?**
6. **What Changes When Data Is Far Away or the Network Is Too Slow?**
7. **How Do You Prove That a Migration Is Correct?**
8. **How Do You Choose the Right AWS Data Movement Service?**

## What Does Moving Data Actually Mean?
<!-- section-summary: A migration must reproduce meaningful state, catch changes, validate the destination, and transfer authority for future writes. -->

At the lowest level, data movement begins with state at one location and the need for equivalent state somewhere else:

```text
Source A                         Destination B

[state]  --------------------->  [equivalent state]
```

If the source is static, copying may be enough. Real production sources are often active throughout the move:

```text
Source                           Destination
t0: 100 GB                       t0:   0 GB
t1: 101 GB    copy in progress   t1:  30 GB
t2: 103 GB  ----------------->   t2:  70 GB
t3: 104 GB                       t3: 100 GB
```

The destination reached the source's old size, but it did not reach the source's current state. A production migration therefore usually means all of the following:

1. Copy the state that existed when the process began.
2. Observe or discover changes made during that initial copy.
3. Apply those changes until the destination catches up.
4. Prove that the destination is sufficiently equivalent for its intended use.
5. Decide which side may accept future writes.

This is why migration is better understood as **state transfer** than as byte transfer. The bytes matter, but so do the rules that make those bytes meaningful: object metadata, file ownership, transaction boundaries, database schemas, permissions, and application behavior.

A source and target can also be equivalent for one purpose but not another. Two S3 prefixes might contain the same payload bytes, yet different encryption keys or tags could make the target unusable. Two databases might have equal row counts while a missing stored procedure breaks the application. The acceptable definition of equivalence must therefore be written before the move begins.

Almost every AWS data-movement service addresses a particular subset of this larger job. Some copy historical state. Some continuously reproduce future changes. Some retain an old access protocol while changing the storage behind it. Others improve or replace the network path. No single product removes the need to define validation, cutover, and authority.

### What Are the Main Data Movement Patterns?
<!-- section-summary: Most AWS data-movement services implement copy, synchronization, replication, interface exposure, or physical transport. -->

Service names are easier to remember after the underlying patterns are clear. Most data movement in and around AWS can be classified as one of five patterns.

#### Copy

A copy takes state that exists at A and creates another instance at B:

```text
A ───────────── copy ─────────────> B
```

Examples include `aws s3 cp`, S3 `CopyObject`, and restoring a database backup into another database. Copying works well when the selected data is stable enough and the team can tolerate whatever downtime is needed to create a consistent source state.

Copy says, "transfer this selected thing." It does not automatically mean, "make every difference between these locations disappear," and it says nothing about future changes after the operation ends.

#### Synchronize

Synchronization compares two locations and reconciles differences:

```text
        compare source and destination
A <------------------------------------> B
        copy missing or changed items ---->
```

`aws s3 sync` and AWS DataSync are examples. The important idea is **reconciliation**. Rather than blindly transferring every item, a synchronization process determines which items are absent or considered outdated at the destination and transfers what is required.

Synchronization can be run repeatedly. Each pass may reduce the difference between a changing source and its destination, which is useful before a planned cutover.

#### Replicate

Replication begins with an initial relationship and then keeps reproducing changes:

```text
Initial state:  A ======================> B

Later:          A -- new change --------> B
                A -- new change --------> B
                A -- new change --------> B
```

S3 Replication and AWS Database Migration Service change data capture are examples. Replication is useful when the source must remain available and the acceptable cutover interruption is small.

Replication is not automatically a backup. A harmful source action can also be reproduced. Recoverability needs its own retention and restoration design rather than an assumption that any second copy is a safe backup.

#### Expose an existing interface

Sometimes the immediate goal is not to relocate every byte and retire the old application. The goal is to let an existing application keep using an interface it understands while AWS storage sits behind that interface:

```text
Existing application
        |
        | SMB or NFS
        v
  +--------------+
  | File Gateway |
  | local cache  |
  +--------------+
        |
        | HTTPS
        v
       S3
```

S3 File Gateway is an example. It is a protocol and interface bridge with a cache, not merely a one-time copying tool. This distinction matters when deciding whether the old access pattern must continue after data begins living in AWS.

#### Physically transport data

When an available network cannot move a large dataset by the deadline, the architecture must change the path. One possibility is to carry storage media to a location with very high-speed AWS connectivity:

```text
Remote data
    |
    v
storage media -- physical transport --> high-speed AWS connection
```

AWS Snowball was historically the familiar example. The current service boundary matters: Snowball Edge is no longer available to new customers, although existing Snowball Edge customers can continue to use it. AWS directs new customers toward choices that include DataSync and AWS Data Transfer Terminal.

The five patterns can be summarized in three short contrasts:

```text
copy       = perform a selected transfer
sync       = reconcile the state now
replicate  = keep reproducing future state
expose     = preserve an interface while storage changes
transport  = change the physical or network path
```

## How Do Size, Bandwidth, and Dataset Shape Affect a Move?
<!-- section-summary: Transfer time depends on effective end-to-end throughput, per-item overhead, and how quickly the source keeps changing. -->

Data migration begins as a physics problem before it becomes an AWS product-selection problem. A theoretical lower bound for transfer time is:

```text
transfer time = amount of data / effective throughput
```

Moving 1 PB over a 100-Mbps connection is not made practical by choosing a more fashionable service name. The estimate also has to use **effective** throughput rather than the circuit's advertised maximum. Real throughput is limited by the slowest relevant part of the path:

```text
effective throughput = minimum of (
    source read speed,
    source CPU capacity,
    source filesystem performance,
    network throughput,
    protocol throughput,
    destination write throughput,
    destination request limits
)
```

A 10-Gbps WAN link cannot deliver 10 Gbps from a NAS that reads at only 400 Mbps. Protocol overhead, contention, packet loss, retry behavior, encryption, and verification can further reduce the usable rate. A credible schedule therefore records the measured or conservatively estimated throughput and reserves time for retries and validation.

### The number and size of items change the calculation

Two datasets can both contain 1 TB while presenting radically different work:

```text
Dataset A: 10 files × 100 GB
Dataset B: 1 billion tiny files
```

Each file or object may require an open, metadata lookup, permission check, API request, checksum, log entry, and close. Transfer duration is therefore closer to:

```text
time = bytes / byte throughput
     + number of items × per-item overhead
```

With a huge item count, metadata and request overhead may dominate the byte transfer. AWS Snowball guidance, for example, warns that very large numbers of small files reduce performance and recommends batching small files where appropriate. The same general limitation appears in many transfer mechanisms.

Do not describe a dataset only as "200 TB." Record its shape:

- Total bytes
- Number of files or objects
- Average and distribution of item sizes
- Directory or prefix distribution
- Metadata and permission complexity
- Source read performance
- Destination request and write capacity
- Rate at which the source changes

### The live change rate determines whether the target can catch up

For a changing source, bulk-copy throughput is only part of the problem. Define:

```text
Rsource = rate at which the source creates changes
Rapply  = rate at which the destination can apply them
```

To reduce a replication backlog and reach cutover, the necessary relationship is:

```text
Rapply > Rsource
```

If the source produces 50 MB/s of changes but the migration system applies only 30 MB/s, the backlog grows forever. A low-downtime cutover never becomes reachable. If the source generates 30 MB/s while the destination applies 80 MB/s, the destination can eventually catch up.

This gives a migration three separate clocks:

| Clock | Question | Main drivers |
| --- | --- | --- |
| Bulk-copy duration | How long does the initial seed take? | Dataset size and effective throughput |
| Replication lag | How far behind is the target? | Change rate compared with apply rate |
| Cutover duration | How long are users restricted or offline? | Final delta, validation, and application switching |

A migration might run for three weeks while causing only three minutes of application downtime. Keeping these clocks separate prevents teams from equating total project duration with user-visible interruption.

## Why Do Objects, Files, and Databases Need Different Tools?
<!-- section-summary: Equal byte counts do not imply equal migrations because objects, files, and databases carry different semantics. -->

Consider three sources that each contain exactly 1 TB:

```text
1 TB of S3 objects
1 TB of SMB files
1 TB PostgreSQL database
```

The byte counts are equal, but the required semantics are not.

### Objects carry key-based metadata

An S3 object can be modeled as a key that identifies bytes plus metadata:

```text
photos/2026/cat.jpg
    ├── 4 MB of bytes
    ├── content type
    ├── tags
    └── encryption information
```

Objects are comparatively independent. That makes copying them simpler than preserving a live relational system, but the operation still has to account for keys, metadata, tags, encryption, storage class, ownership, retention, and any other behavior the consumer depends on.

### Files participate in a filesystem

A file has more context than its byte contents:

```text
directories       owners and groups
permissions       timestamps
links             names
locking           partial updates
```

`/home/alice/report.csv` is meaningful partly because of where it appears and who can access it. A file migration may therefore need to preserve directory structure, permissions, ownership, timestamps, links, and the behavior expected by applications mounting the filesystem.

### Databases preserve transactional state

Databases add tables, rows, indexes, constraints, foreign keys, schemas, views, procedures, sequences, and change logs. Most importantly, multiple changes can belong to one transaction:

```text
BEGIN
  subtract £100 from Alice
  add £100 to Bob
COMMIT
```

If a naive file copier captures Alice's row before this transaction and Bob's row after it, the copied state may be one that never existed. Copying live database files is therefore generally not equivalent to migrating a running database. A database-aware mechanism must respect transactionally meaningful state.

The destination must match the semantics that consumers require. S3 is appropriate when consumers naturally use object keys and `GET` or `PUT` operations. EFS or an FSx service may be needed for shared filesystem operations. RDS, Aurora, DynamoDB, Redshift, or another data service is appropriate only when its data model and behavior match the workload. Arrival of the bytes does not complete the migration if the application cannot use them correctly.

### How Do You Move Data Between S3 Locations?
<!-- section-summary: S3 copy, sync, Batch Operations, and replication correspond to selected transfer, reconciliation, managed bulk execution, and future change capture. -->

"Move these S3 objects" can express several different intentions. The right mechanism follows from whether the job is a selected copy, state reconciliation, a massive known operation, or continuous replication.

#### Use copy for selected objects

For one or several controlled transfers, think in terms of `cp`:

```bash
aws s3 cp source destination
```

The instruction means, "create a destination object from this source." It is an ordinary copy operation, suitable when the team can name the selected objects and manage the execution directly.

Object storage should not be treated too literally as a traditional filesystem. A filesystem might support an internal rename from `/foo/a.txt` to `/bar/a.txt`. An apparent S3 "move" is conceptually often:

```text
1. Create a copy under the new object key.
2. Delete the object under the old key.
```

For a large object, that rename-like action can involve real copying work rather than a cheap directory-entry change.

#### Use sync to reconcile two locations

Suppose the source contains four keys:

```text
A/
├── a.txt
├── b.txt
├── c.txt
└── d.txt
```

The destination contains only `a.txt` and `c.txt`. A recursive copy says to copy the selected source objects. A synchronization says to make the destination sufficiently resemble the source. It can discover that `b.txt` and `d.txt` are missing and that `c.txt` must be copied if the destination version is considered outdated.

The AWS CLI `s3 sync` command generally copies missing or outdated files or objects between its source and target. It is a reconciliation tool, not a permanent replication relationship.

#### Use S3 Batch Operations for a massive known population

A shell loop over 500 million objects creates an orchestration system that the operator must own:

```text
enumeration         parallelism
retries             failed-object handling
progress tracking   auditing
resume behavior
```

S3 Batch Operations is designed for large-scale work over a supplied inventory or manifest. The team identifies the objects and the desired operation, such as copy, and AWS manages execution across the population. Batch Operations can operate across billions of objects and provides job progress and completion information, so a laptop script does not have to coordinate every request.

The progression is:

```text
a few selected objects                 -> S3 API or aws s3 cp
locations that need reconciliation     -> aws s3 sync
huge known object population           -> S3 Batch Operations
```

#### Use replication for new and updated objects

When new objects keep arriving, the requirement is no longer a one-time migration:

```text
Bucket A                         Bucket B
old1 ==========================> old1
old2 ==========================> old2

new3 --------------------------> new3
new4 --------------------------> new4
```

S3 supports asynchronous Same-Region Replication and Cross-Region Replication. Live replication applies to new or updated objects after the rule is configured. Existing objects require a historical-state mechanism such as S3 Batch Replication.

That separation is fundamental:

```text
historical state  -> bulk copy or batch replication
future state      -> live replication
```

Many migration designs, including database designs, reduce to this combination: **bulk historical copy plus continuing replication of new changes**.

## How Do You Move File Shares or Keep Their Existing Interface?
<!-- section-summary: DataSync moves or reconciles file and object datasets, while S3 File Gateway preserves NFS or SMB access with an S3-backed cache. -->

An on-premises NAS might hold hundreds of terabytes under engineering, finance, video, and archive directories, with users reaching it through NFS or SMB. This is not just an S3 object-copy job. The mover must enumerate filesystem content, transfer it efficiently, preserve relevant metadata, retry failures, verify results, and often repeat the process while users continue working.

### Use DataSync to move or synchronize the dataset

AWS DataSync is a managed, high-performance synchronization engine for file and object datasets. Conceptually, it sits between a source such as an NFS, SMB, HDFS, or object-storage system and AWS storage such as S3, EFS, or supported FSx services:

```text
             enumerate
                 |
NAS ========> DataSync =================> AWS storage
                 ├── parallelize
                 ├── transfer
                 ├── retry
                 ├── preserve relevant metadata
                 └── verify
```

An ordinary tool such as `rsync` can be part of a custom migration system, but then the team owns the parallel workers, network tuning, credentials, schedules, monitoring, retries, verification, and failure recovery. DataSync packages much of that operational machinery.

### Use seed, smaller deltas, and cutover for a changing share

Copying a 100-TB share on Monday and switching users on Friday ignores every Tuesday-through-Friday change. Instead, use repeated passes:

1. **Seed:** transfer the large historical dataset while the source stays in use.
2. **Resynchronize:** transfer files changed during the seed.
3. **Repeat if useful:** each successful pass can make the remaining difference smaller.
4. **Freeze writes:** briefly prevent users or applications from changing the source.
5. **Run the final synchronization:** copy the last delta.
6. **Switch clients:** make the destination authoritative.

This seed–delta–cutover pattern is more important than any specific product name. It appears whenever a large source changes while an online transfer runs.

### Use S3 File Gateway when the old interface must remain

DataSync and S3 File Gateway may both appear in designs involving on-premises files and AWS storage, but their first-principles questions are different:

```text
DataSync:
How do I move or synchronize this dataset?

S3 File Gateway:
How can an existing application continue to use NFS or SMB
while durable data is represented as objects in S3?
```

S3 File Gateway presents NFS or SMB shares backed by S3. It keeps recently accessed data in a local cache and transfers writes into S3 as objects. A gateway may support a transition, but its architectural role is an interface bridge plus cache rather than a pure migration engine.

The cache exists because distance has a cost. An application repeatedly reading the same hot data should not fetch it across a wide-area network every time:

```text
Application ---> Gateway --------------------> S3 cold data
                   |
                   v
               local hot data
```

This illustrates a broader principle: move computation toward data, move data toward computation, or cache enough that distance stops affecting the common path.

## How Do You Move a Live Database with Little Downtime?
<!-- section-summary: A low-downtime database migration combines historical full load, continuous change capture, schema work, validation, and a controlled transfer of writes. -->

A database can be migrated with a simple stop–backup–copy–restore–start sequence when a long outage is acceptable. If backup, transfer, and restore take eight hours, however, the application may be unavailable for all eight hours. A low-downtime design separates the database into two streams.

### Separate historical state from future changes

At migration start, the database contains its historical rows. While those rows are loading, users keep producing inserts, updates, and deletes:

```text
                  existing rows
Source =====================================> Target
   |
   +---- INSERT ----------------------------> Target
   +---- UPDATE ----------------------------> Target
   +---- DELETE ----------------------------> Target
```

AWS Database Migration Service describes these as **full load** and **change data capture**, or CDC. DMS supports full load, full load plus CDC, and CDC-only tasks. With full load plus CDC, DMS migrates existing data while capturing changes at the source and then applies those changes to the target.

Suppose a 5-TB full load takes six hours while the source produces only 30 GB of changes. Without change capture, the team might require roughly six hours of downtime to hold the source still. With full load plus CDC, the 5 TB can move while the application remains active. The migration system then reduces the change backlog, the team briefly freezes writes, the final seconds or minutes of changes drain, and the application switches.

Downtime now depends mainly on the remaining backlog, validation, and switching—not on the entire database size. This works only when the apply rate exceeds the ongoing source change rate. Growing CDC lag near cutover is evidence that the destination is not ready.

### Use CDC-only when another tool seeds faster

Sometimes a database engine's native dump, restore, snapshot, or bulk-load method is the better way to seed historical state. DMS can then use CDC-only mode to reproduce ongoing changes:

```text
Native bulk mechanism:  Source =============> Target
DMS CDC:                Source -- changes --> Target
```

The products differ, but the architecture is still historical state plus delta changes.

### Treat engine changes as two migrations

Moving PostgreSQL to PostgreSQL is not the same as moving Oracle to PostgreSQL. A database contains both data and a programming model:

```text
data: rows and values

programming model:
schemas, types, procedures, functions,
views, sequences, and engine-specific syntax
```

A numeric value may map cleanly, while an Oracle procedure is not automatically a PostgreSQL procedure. A heterogeneous migration therefore contains two distinct jobs:

1. Convert or recreate the schema and database code.
2. Move and continuously synchronize the data.

DMS Schema Conversion assesses and converts schemas and code objects. It does not migrate the data itself. DMS data migration handles the rows. Keeping those responsibilities separate makes the plan clearer:

```text
DMS Schema Conversion -> What structure and code should the target use?
DMS migration          -> How do the rows and changes reach that target?
```

Schema conversion may still require testing and manual work where source-engine behavior has no direct target equivalent. Equal row counts cannot prove that procedures, types, or application queries behave correctly.

### How Do Partner Feeds and Hybrid Applications Reach AWS Storage?
<!-- section-summary: Transfer Family adapts external file-transfer protocols, while Storage Gateway preserves local access protocols during hybrid operation or modernization. -->

Not every flow into AWS is a migration. If a bank or supplier sends `transactions.csv` every night through SFTP, the external organization controls its own system and protocol. Your architecture may want S3, but the partner contract says SFTP. The missing component is a protocol adapter:

```text
Partner -- SFTP --> AWS Transfer Family --> S3
```

AWS Transfer Family provides managed file transfer using protocols that include SFTP, FTPS, FTP, and AS2, with S3 or EFS as storage options. Its first-principles role is to speak the external party's transfer protocol while landing data in AWS-native storage.

This differs from DataSync. With DataSync, your organization typically controls a NAS or object store and needs to migrate or synchronize that storage. With Transfer Family, another organization speaks a contracted protocol and you expose a compatible endpoint. It is compatibility at an organizational boundary.

Once S3 becomes the landing zone, transport and processing can stay separate:

```text
Supplier
   |
  SFTP
   v
Transfer Family
   v
S3 landing location
   ├── validation
   ├── transformation
   ├── analytics
   └── archive
```

The managed transfer endpoint does not need to become the analytics or validation system. Its responsibility is to receive or distribute files using the expected protocol. Other components can validate, transform, analyze, and retain the data after arrival.

Storage Gateway solves another compatibility problem. A company may not be ready to replace an existing application, but it may want that application's data represented in AWS. A gateway can change **where the data lives** without immediately changing **how the application accesses it**. This transitional or continuing hybrid architecture is different from a weekend replacement migration.

Network paths and movement engines also belong to different layers:

```text
+------------------------------------------+
| Migration protocol or engine             |
| DataSync, DMS, S3 replication, and so on |
+------------------------------------------+
| Network path                             |
| Internet, VPN, Direct Connect            |
+------------------------------------------+
| Physical medium                          |
| Fiber, copper, or transported media      |
+------------------------------------------+
```

A VPN or Direct Connect connection does not discover which files changed, verify a file, preserve permissions, or retry an incomplete dataset. DataSync does not create unlimited bandwidth. A sound design chooses and monitors each layer separately.

## What Changes When Data Is Far Away or the Network Is Too Slow?
<!-- section-summary: Distance may call for an optimized S3 path, while an impossible WAN deadline may require a high-speed physical transfer location. -->

Long geographic distance affects latency, congestion, packet loss, and protocol performance. A client in Sydney uploading to an S3 bucket in Europe may have a less efficient public-internet path than a client close to the Region.

### Use S3 Transfer Acceleration to optimize the path to S3

S3 Transfer Acceleration lets a geographically distant client enter AWS's network through a nearby edge location and use optimized AWS network paths toward the bucket:

```text
Client
  |
  | shorter public-internet path
  v
nearby AWS edge location
  |
  | optimized AWS network path
  v
S3 bucket
```

Transfer Acceleration and DataSync address different layers. DataSync is a managed dataset mover. Transfer Acceleration improves the long-distance client-to-S3 network path. Improving the path does not replace reconciliation, metadata handling, or cutover logic.

### Change the physical path when arithmetic rules out the WAN

If the dataset is enormous, available bandwidth is poor, and the deadline is short, no synchronization algorithm can overturn this condition:

```text
network transfer time > acceptable deadline
```

Historically, Snowball Edge embodied the idea of copying data to a device locally and physically transporting it toward AWS. Existing Snowball Edge customers may continue to use it, but AWS stopped making Snowball Edge available to new customers on November 7, 2025. A current plan must not assume that an old Snowball runbook is still available to a new customer.

AWS Data Transfer Terminal uses a different physical-location model. Rather than receiving a Snowball device, eligible customers bring storage devices to a secure AWS Data Transfer Terminal location and connect them to high-speed AWS network capacity. Current AWS documentation describes the service as available to Enterprise Support customers, with high-speed fiber connectivity at its facilities.

The underlying principle remains stable even when product availability changes: if the ordinary WAN is too slow, move the storage to a place with a far better path. Always verify current eligibility and locations before committing a schedule.

## How Do You Prove That a Migration Is Correct?
<!-- section-summary: Validation moves from byte integrity through completeness and metadata to database semantics and real application behavior. -->

A dashboard status of `COMPLETED` may mean only that no transfer operation reported an error. It does not necessarily prove that every expected item exists, all bytes match, permissions are equivalent, transactionally correct rows arrived, or applications work. Validation should be designed as layers.

### Layer 1: Check transport integrity

Checksums, hashes, and transfer integrity checks answer whether bytes changed accidentally in transit:

```text
hash(source bytes)      = ABC123
hash(destination bytes) = ABC123
```

A match proves integrity for the compared bytes. It does not prove that every required item was included.

### Layer 2: Check inventory completeness

Compare source and destination object or file counts, total bytes, expected names, prefixes, and manifests. If the source contains 1,004,912 files and the target contains 1,004,911, every transferred file could have a perfect checksum while one expected file is entirely absent.

Completeness checks must define the comparison window for a changing source. Counts taken at different moments can disagree for legitimate reasons, so the runbook should state when writes are frozen or how deltas are accounted for.

### Layer 3: Check metadata and access behavior

For files, validate owners, groups, permissions, timestamps, ACLs, links, and directory structure as required. For S3 objects, validate metadata, tags, encryption, storage classes, ownership, and retention behavior. Equal payload bytes can coexist with materially different operational behavior.

### Layer 4: Check database correctness

Database checks include row counts, primary and foreign keys, constraints, critical aggregates, selected record contents, and CDC lag. AWS DMS offers data validation that compares source and target records and reports mismatches. That validation consumes source, target, and network resources, so its capacity impact belongs in the migration plan.

Database validation also needs to look above rows. Missing indexes, procedures, sequences, or converted code can leave a target technically populated but functionally incomplete.

### Layer 5: Check application and business behavior

The highest-value tests ask whether customers and business processes still work:

```text
Can a customer sign in?
Does an order total correctly?
Does the month-end report match?
Do payments reconcile?
```

Equal database row counts are useful evidence, not the final definition of success. The complete validation stack rises from transport mechanics to business meaning:

```text
             business behavior
                    ▲
             query semantics
                    ▲
              rows and data
                    ▲
                 metadata
                    ▲
            inventory completeness
                    ▲
                checksums
```

Security is part of the transfer's correctness as well. Every data move crosses trust boundaries, so answer four separate questions:

| Concern | Question |
| --- | --- |
| Identity | Which principal is performing the move? |
| Authorization | Which source may it read and which destination may it write? |
| Encryption | How are bytes protected in transit and at rest, and who can decrypt them? |
| Network | Which paths can the transfer traffic use? |

Saying "the transfer is encrypted" does not answer who can start a job, where its credentials live, or which data the mover can access.

### How Do You Cut Over and Roll Back Safely?
<!-- section-summary: Cutover changes the authoritative writer, and rollback becomes a reconciliation problem once the target accepts new production writes. -->

Before a migration, the source defines truth. After a successful cutover, the target defines truth. Cutover is therefore not simply the end of copying. It is the controlled transfer of authority for future writes.

#### Keep exactly one authoritative writer

Suppose half of the users continue writing Database A while the other half begin writing Database B. Both systems now contain legitimate new information, but neither contains all of it. Returning to one side requires merging data rather than merely reversing a connection string.

Unless the architecture was intentionally designed and tested for multi-writer replication, preserve this invariant:

> At cutover, exactly one location is authoritative for writes.

```text
Before:
Applications --> Source --> replicated Target

After:
Applications ----------------> Target
Source becomes read-only or is retained temporarily
```

#### Use a controlled database cutover sequence

A low-downtime database move commonly follows these phases:

1. **Prepare the target.** Build its network access, security, schema, and capacity.
2. **Run the bulk load.** The application continues to use the source while historical state moves.
3. **Let CDC catch up.** Monitor the remaining replication lag rather than assuming that task status implies readiness.
4. **Quiesce the source.** Briefly prevent new application writes.
5. **Drain the final changes.** Wait until the replication lag is approximately zero under the agreed threshold.
6. **Run final validation.** Compare the source and target using the prewritten technical and business checks.
7. **Redirect applications.** Make the target the only authoritative writer.
8. **Observe before decommissioning.** Retain the source under controlled conditions while the team monitors the target.

File and object migrations use the same underlying idea when the source is changing: seed, resynchronize deltas, freeze changes, perform a final synchronization, validate, and redirect clients.

#### Plan for target-side writes before calling rollback easy

Imagine switching to a target database at 09:00 and finding a problem at 09:05. During those five minutes, the target accepts two new orders and a payment. Switching the application back to the old source would lose those valid changes unless the design planned how to preserve them.

A real rollback plan answers: **What happens to writes created on the target after cutover?** Possible designs include a short validation period in which writes remain disabled, reverse replication, a predesigned dual-write system, a replayable event log, or an explicit reconciliation procedure. None is a universal undo button.

Rollback is easiest before the target accepts new writes. Afterward, it becomes a data-reconciliation problem. That is why a runbook needs a point after which the team will use forward fixes or a defined repair process rather than a simple switch back.

The dangerous part of many migrations is not copying the first 99.9 percent. It is transferring the final changing fraction while changing which system owns truth.

## How Do You Choose the Right AWS Data Movement Service?
<!-- section-summary: Choose a mechanism by identifying the state, whether it changes, the downtime limit, network feasibility, required protocol, validation, and write authority. -->

Do not begin a vague "move data to AWS" request by selecting from a catalog of service names. Ask the questions that expose the actual constraint.

### First ask what kind of state is moving

Is it a set of independent objects, a filesystem with metadata and shared access, or a transactional database? The semantics determine which mover can preserve meaningful state.

### Then ask whether the source changes

A stable source may allow a simple bulk copy. A changing source needs repeated synchronization, continuous replication, or change capture. Historical state and future changes may require separate mechanisms.

### Define acceptable downtime

If hours are acceptable, stopping the source and performing a stable backup or copy may be simplest. If only minutes or seconds are acceptable, seed the target while the source stays live, capture changes, and reserve a short final cutover.

### Check whether the network can meet the deadline

Use the dataset size, shape, measured throughput, change rate, retry allowance, and validation time. If the current network cannot finish, consider a better circuit, an optimized long-distance S3 path, or an eligible physical-transfer approach.

### Identify any protocol that must remain

If an old application must keep speaking NFS or SMB while data is represented in S3, consider a gateway-style bridge. If an external partner must use SFTP, FTPS, FTP, or AS2, consider Transfer Family. These are compatibility requirements, not merely copying requirements.

### Define proof and authority before execution

Write the checksum, inventory, metadata, database, and application checks before starting. State which system accepts writes before, during, and after cutover, and define what rollback means after target-side writes exist.

The following map connects common situations to their first-principles needs:

| Situation | Requirement | Typical AWS mechanism |
| --- | --- | --- |
| Copy a handful of S3 objects | Selected copy | S3 API or `aws s3 cp` |
| Make one S3 location resemble another | Reconciliation | `aws s3 sync` |
| Run an operation across a huge S3 inventory | Managed bulk execution | S3 Batch Operations |
| Reproduce new S3 objects continuously | Replication | S3 Replication |
| Move NFS, SMB, HDFS, or object datasets | Managed bulk synchronization | AWS DataSync |
| Keep an NFS or SMB interface with S3 behind it | Protocol bridge and local cache | S3 File Gateway |
| Move a database when downtime is acceptable | Stable backup or snapshot-style seed | Native database mechanism |
| Move a live database with little downtime | Full seed plus change capture | AWS DMS full load plus CDC |
| Change database engine | Convert schema/code and move data | DMS Schema Conversion plus DMS migration |
| Accept partner file-transfer feeds | Protocol adapter | AWS Transfer Family |
| Improve a distant client's path into S3 | Optimized long-distance path | S3 Transfer Acceleration |
| Ordinary WAN cannot meet the deadline | Better or physical network path | Data Transfer Terminal or another eligible current option |
| Existing Snowball Edge customer needs device transfer | Physical device movement | Snowball Edge |

### How do these choices look in concrete examples?

**Twenty gigabytes of mostly static website assets between S3 buckets** are independent objects, small enough for an ordinary one-time copy. A sophisticated migration system would add little value.

**A 400-TB Windows file server** uses SMB, contains millions of files, remains active, and permits little outage. Use a managed file mover such as DataSync to seed the target, run repeated incremental synchronizations, freeze writes briefly, perform a final synchronization, validate the filesystem and application behavior, and redirect clients.

**An 8-TB Oracle database moving to Aurora PostgreSQL** changes engine and cannot remain offline for an eight-hour bulk operation. Treat schema and code conversion separately from the data. Convert or recreate the target schema, run a full historical load, capture continuing transactions with CDC, let the target catch up, stop writes briefly, validate, and switch the application.

**A vendor that sends a daily invoice file through SFTP** is not primarily a migration. The vendor controls its protocol, and your system wants S3. Transfer Family can provide the SFTP endpoint and land files in S3 without your team operating an EC2-based SFTP server, unless requirements exist that the managed option cannot satisfy.

### Which common mistakes should you avoid?

- **Estimating from byte count alone.** A statement such as "500 TB will take this long" is incomplete without item count, source read rate, network and destination throughput, metadata work, and source change rate.
- **Treating DataSync and Storage Gateway as interchangeable.** DataSync moves or synchronizes datasets; a gateway preserves a file interface while cloud storage sits behind it.
- **Switching because the initial database copy completed.** If the source kept receiving writes, the plan must also capture and apply everything that changed.
- **Calling replication a backup.** Replication can reproduce unwanted changes, so recoverability still needs a separate design.
- **Calling equal byte counts success.** Permissions, schemas, owners, indexes, procedures, and application behavior can still be wrong.
- **Defining rollback as changing DNS back.** Once the target has unique production writes, rollback requires replication, replay, or reconciliation.

The full reasoning path can be remembered without memorizing the AWS catalog:

```text
What state is moving?
        |
        +--> objects / files / database
                     |
             Is it changing?
                     |
        +------------+------------+
        |                         |
       no                        yes
        |                         |
   bulk copy             capture the delta
        |                         |
        +------------+------------+
                     |
          Can the network finish?
                     |
        +------------+------------+
        |                         |
       yes                        no
        |                         |
   online movement       better or physical path
        |                         |
        +------------+------------+
                     |
                  validate
                     |
                  cut over
                     |
             transfer authority
                     |
                  observe
                     |
                decommission
```

Three ideas hold this entire topic together. First, migration transfers meaningful state rather than undifferentiated bytes. Second, low-downtime movement usually combines a bulk seed, continuing deltas, and a brief final cutover. Third, cutover transfers truth: the source is authoritative before it, the target is authoritative after it, and the final changing fraction requires the most careful control.

![The runbook summary shows the checks around validation, cutover, rollback, monitoring, and ownership for a safe data move](/content-assets/articles/article-cloud-providers-aws-storage-databases-moving-data-into-around-aws/migration-runbook-summary.png)

*A safe migration connects the movement mechanism to validation, cutover, rollback, observation, and a single owner for future writes.*

:::expand[What Does Moving Data Actually Mean?]{kind="recap"}
A migration must reproduce meaningful state, catch changes, validate the destination, and transfer authority for future writes.

It means reproducing the state that matters at the destination, catching changes made during the move, proving the destination is equivalent enough for its consumers, and deciding which system owns future writes. Copying a historical byte count alone is not sufficient when the source changes or carries additional semantics.

Most AWS data-movement services implement copy, synchronization, replication, interface exposure, or physical transport.

Copy performs a selected transfer. Synchronization reconciles present differences. Replication keeps applying future changes. Interface exposure preserves an old protocol while different storage sits behind it. Physical transport changes the path when the ordinary network cannot meet the deadline.
:::

:::expand[How Do Size, Bandwidth, and Dataset Shape Affect a Move?]{kind="recap"}
Transfer time depends on effective end-to-end throughput, per-item overhead, and how quickly the source keeps changing.

The lower bound is data size divided by effective end-to-end throughput, but every file or object also adds per-item work. A billion tiny files can take much longer than a few large files with the same byte total. For a live source, the target's apply rate must exceed the source's change rate so lag can shrink.
:::

:::expand[Why Do Objects, Files, and Databases Need Different Tools?]{kind="recap"}
Equal byte counts do not imply equal migrations because objects, files, and databases carry different semantics.

Objects have keys, payloads, and metadata. Files add directories, ownership, permissions, timestamps, links, and locking. Databases add schemas, constraints, code, and transactional consistency. A valid mover must preserve the semantics that the destination's consumers require.

S3 copy, sync, Batch Operations, and replication correspond to selected transfer, reconciliation, managed bulk execution, and future change capture.

Use S3 APIs or `aws s3 cp` for selected objects, `aws s3 sync` to reconcile locations, S3 Batch Operations for managed execution over a huge known population, and S3 Replication for continuing new or updated objects. Existing and future objects may require separate bulk and live mechanisms.
:::

:::expand[How Do You Move File Shares or Keep Their Existing Interface?]{kind="recap"}
DataSync moves or reconciles file and object datasets, while S3 File Gateway preserves NFS or SMB access with an S3-backed cache.

DataSync is a managed engine for moving and reconciling file or object datasets. S3 File Gateway instead presents NFS or SMB access backed by S3 and keeps frequently used data in a local cache. One is primarily a mover; the other is an interface bridge with locality.
:::

:::expand[How Do You Move a Live Database with Little Downtime?]{kind="recap"}
A low-downtime database migration combines historical full load, continuous change capture, schema work, validation, and a controlled transfer of writes.

Load historical rows while the source remains active, capture ongoing inserts, updates, and deletes, let the target catch up, stop writes briefly, drain the final delta, validate, and switch. If the engine changes, schema and code conversion is a separate job from data movement.

Transfer Family adapts external file-transfer protocols, while Storage Gateway preserves local access protocols during hybrid operation or modernization.

Transfer Family provides protocols such as SFTP, FTPS, FTP, and AS2 for organizational boundaries while using S3 or EFS as storage. Storage Gateway preserves familiar local access protocols during hybrid operation. Network connectivity and movement logic remain separate architectural layers.
:::

:::expand[What Changes When Data Is Far Away or the Network Is Too Slow?]{kind="recap"}
Distance may call for an optimized S3 path, while an impossible WAN deadline may require a high-speed physical transfer location.

S3 Transfer Acceleration can improve a distant client's route into S3 through nearby AWS edge locations. When ordinary WAN arithmetic cannot meet the deadline, eligible physical-transfer choices may be needed. Snowball Edge is unavailable to new customers; Data Transfer Terminal uses customer-carried media at high-speed AWS facilities.
:::

:::expand[How Do You Prove That a Migration Is Correct?]{kind="recap"}
Validation moves from byte integrity through completeness and metadata to database semantics and real application behavior.

Validate transport integrity, inventory completeness, metadata and permissions, database correctness, and real application or business behavior. Also verify the identity, authorization, encryption, and network controls used by the mover. A completed task status is only one piece of evidence.

Cutover changes the authoritative writer, and rollback becomes a reconciliation problem once the target accepts new production writes.

Cutover transfers write authority from source to target, so keep one authoritative writer unless multi-writer behavior was deliberately designed. Once the target accepts unique production writes, switching back can lose data; rollback then requires a previously planned replication, replay, or reconciliation method.
:::

:::expand[How Do You Choose the Right AWS Data Movement Service?]{kind="recap"}
Choose a mechanism by identifying the state, whether it changes, the downtime limit, network feasibility, required protocol, validation, and write authority.

Identify the state type, whether it changes, acceptable downtime, network feasibility, any protocol that must remain, validation evidence, and the authoritative writer. Those constraints lead to the service; beginning with a service name hides the actual migration problem.
:::

## References

- [AWS CLI documentation: Using high-level S3 commands](https://docs.aws.amazon.com/cli/latest/userguide/cli-services-s3-commands.html)
- [Amazon S3 documentation: Batch Operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html)
- [Amazon S3 documentation: Replicating objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)
- [AWS DataSync documentation](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)
- [Amazon S3 File Gateway documentation](https://docs.aws.amazon.com/filegateway/latest/files3/file-gateway-concepts.html)
- [AWS DMS documentation: Components and migration types](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Introduction.Components.html)
- [AWS DMS documentation: Schema Conversion](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_SchemaConversion.html)
- [AWS DMS documentation: Data validation](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Validating.html)
- [AWS Transfer Family documentation](https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html)
- [Amazon S3 documentation: Transfer Acceleration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/transfer-acceleration.html)
- [AWS Snowball Edge documentation: Availability change](https://docs.aws.amazon.com/snowball/latest/developer-guide/snowball-edge-availability-change.html)
- [AWS Snowball Edge documentation: Best practices](https://docs.aws.amazon.com/snowball/latest/developer-guide/BestPractices.html)
- [AWS Data Transfer Terminal documentation](https://docs.aws.amazon.com/datatransferterminal/latest/userguide/what-is-dtt.html)
