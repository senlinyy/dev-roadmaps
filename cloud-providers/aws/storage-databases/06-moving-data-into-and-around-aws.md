---
title: "Moving Data Into and Around AWS"
description: "Move files, objects, databases, partner feeds, and large datasets into and around AWS with S3 tools, DataSync, DMS, Transfer Family, Storage Gateway, Glue, and current physical transfer options."
overview: "Data movement is part of production design. This article follows Maple Market as it imports old files, migrates a database, receives partner feeds, copies S3 objects, catalogs exports, validates results, and plans cutover safely."
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

1. [Data Movement Is a Production Workflow](#data-movement-is-a-production-workflow)
2. [Simple Copies and S3 Bulk Work](#simple-copies-and-s3-bulk-work)
3. [File Transfers with DataSync, Transfer Family, and Storage Gateway](#file-transfers-with-datasync-transfer-family-and-storage-gateway)
4. [Database Moves with DMS and Native Tools](#database-moves-with-dms-and-native-tools)
5. [Long-Distance and Physical Transfer Choices](#long-distance-and-physical-transfer-choices)
6. [Cleaning, Cataloging, and Proving the Move](#cleaning-cataloging-and-proving-the-move)
7. [A Production Migration Runbook](#a-production-migration-runbook)
8. [Putting It All Together](#putting-it-all-together)

## Data Movement Is a Production Workflow
<!-- section-summary: Moving data needs ownership, validation, security, retries, and cutover planning around the copy work. -->

Maple Market has the storage services picked now. Photos and exports go to S3. Orders go to RDS or Aurora. Carts and sessions go to DynamoDB. Shared warehouse files go to EFS. The next problem is movement. The old business data already exists somewhere else, partners still send files, analytics needs copies, and production systems need controlled data paths between services.

Data movement sounds simple until it carries real customer records. A copy can fail halfway through. A database migration can miss late changes. A partner can upload a file twice. A large S3 job can copy the wrong prefix. A report can arrive in the analytics bucket before the data catalog knows its schema. Moving data safely means planning the source, destination, identity, network path, encryption, retry behavior, validation, and rollback.

AWS has several data movement tools because movement comes in several shapes. The table below names the movement shape before naming the tool.

| Movement shape | Common AWS tools |
|---|---|
| Copy objects inside S3 | S3 Copy, S3 Replication, S3 Batch Operations |
| Move file shares or object stores online | AWS DataSync |
| Receive or send SFTP, FTPS, FTP, AS2, or browser file transfers | AWS Transfer Family |
| Keep on-premises apps using file-style access to AWS storage | AWS Storage Gateway |
| Move databases with ongoing change capture | AWS Database Migration Service |
| Transform and catalog data for analytics | AWS Glue Data Catalog and Glue jobs |
| Speed up long-distance S3 uploads | S3 Transfer Acceleration where it fits |
| Handle large physical transfer workflows | AWS Data Transfer Terminal for eligible customers, partner options, and current AWS guidance |

![AWS data movement tool chooser mapping S3 bulk work to Batch Operations, file copy to DataSync, partner files to Transfer Family, hybrid access to Storage Gateway, database moves to DMS, and analytics prep to Glue](/content-assets/articles/article-cloud-providers-aws-storage-databases-moving-data-into-around-aws/data-movement-tool-chooser.png)

*The movement shape decides the tool, and every tool still needs validation and cleanup.*

The service choice starts with the movement shape. Maple Market should choose a file transfer tool for files, a database migration tool for databases, an object operation tool for S3 objects, and a catalog or ETL tool when the data needs transformation.

## Simple Copies and S3 Bulk Work
<!-- section-summary: S3 has small-copy commands for everyday work and managed bulk tools for large object sets. -->

The simplest movement path is object-to-object. Maple Market may copy invoice PDFs from a processing bucket to a finance bucket, move logs into an archive prefix, or replicate media to another account. Small jobs often start with the AWS CLI:

```bash
aws s3 sync s3://maple-prod-exports/sales/ s3://maple-prod-analytics/raw/sales/ --sse AES256
```

That kind of command is fine for development, one-time small copies, or controlled operations. For production-scale object sets, teams should move toward managed and auditable paths. S3 **Replication** can copy new objects asynchronously from one bucket to another bucket in the same Region or another Region. It can help with account separation, compliance copies, regional locality, and downstream processing. Replication needs IAM permissions, versioning, metrics, KMS planning, and monitoring for failed operations.

S3 **Batch Operations** handles large object jobs from a manifest. A Batch Operations job can copy objects, replace tags, invoke Lambda, restore archived objects, or run other supported actions across a large list of objects. This is useful when Maple Market needs to retag a million invoice objects, copy an existing archive to a new bucket, or trigger a checksum workflow on an inventory list.

S3 **Inventory** often pairs with Batch Operations. Inventory creates scheduled reports about bucket objects. The report can become the manifest for a batch job. This is more reliable than asking one laptop script to list and mutate a huge bucket while the network connection and credentials stay alive.

When the job moves important data, validation should be part of the copy plan. Maple Market can compare object counts, total bytes, selected checksums, encryption status, and expected prefixes before the destination is considered ready. Copy completion alone is not the same as data confidence.

## File Transfers with DataSync, Transfer Family, and Storage Gateway
<!-- section-summary: AWS has different file movement tools for online migration, partner transfer protocols, and hybrid file access. -->

Maple Market has an old warehouse file share in a data center. The files need to move into EFS and S3 while the team keeps permissions and timestamps as much as possible. This is the kind of job AWS DataSync is built for.

**AWS DataSync** is an online data movement service for file and object data. A DataSync task has a source location, a destination location, and settings for how files should copy. DataSync can transfer between supported on-premises storage, AWS storage services, and other supported locations. For on-premises sources, teams often deploy a DataSync agent near the source storage so data can move through a managed task instead of a custom script.

A DataSync workflow might look like this. The command starts the task, while the task definition carries the source, destination, and transfer behavior.

```bash
aws datasync start-task-execution \
  --task-arn arn:aws:datasync:us-east-1:123456789012:task/task-abc123
```

The useful production pieces are outside that command. The team defines the source and destination, schedules dry runs, checks transfer reports, validates file counts, watches task errors, and decides how to handle deletes and permission metadata. A migration task should be repeatable so the team can run an initial large copy, then run smaller delta copies before cutover.

**AWS Transfer Family** solves a different problem: managed file transfer protocols. Partners may still send files over SFTP, FTPS, FTP, AS2, or browser-based transfer. Transfer Family can place files directly into AWS storage such as S3, and managed workflows can start follow-up processing after upload. Maple Market can give a shipping partner an SFTP endpoint while the files land in `s3://maple-prod-partner-feeds/inbound/`.

**AWS Storage Gateway** fits hybrid access patterns where on-premises applications need file, volume, or tape-style access while AWS storage sits behind the gateway. For example, an on-premises application can use S3 File Gateway to store and retrieve objects in S3 through a file interface. This helps when an application cannot be changed quickly but the data should land in AWS-backed storage.

These tools solve different file problems. DataSync is a transfer engine. Transfer Family is a managed protocol endpoint for external senders and receivers. Storage Gateway is a hybrid access bridge for applications that still expect local-style storage.

## Database Moves with DMS and Native Tools
<!-- section-summary: Database migration needs schema planning, full load, change capture, validation, and a controlled cutover. -->

Maple Market also has an old PostgreSQL database in its data center. The target is Aurora PostgreSQL. A database migration has more moving parts than file copying because the source keeps changing while customers use the old application.

**AWS Database Migration Service**, usually called **DMS**, can move data from supported sources to supported targets. A common migration pattern has two phases. First, DMS performs a full load of existing tables. Then it uses change data capture, often shortened to CDC, to replicate ongoing changes from the source while the old application is still writing.

The high-level DMS pieces are easy to name. These pieces are what database, network, and application teams review together.

| DMS piece | Plain meaning |
|---|---|
| Replication instance or serverless replication | The DMS compute that runs migration work |
| Source endpoint | Connection information for the old database |
| Target endpoint | Connection information for the AWS target database |
| Replication task | The table mapping, load mode, CDC settings, and task behavior |
| Table mappings | Which schemas and tables move, plus transformations |
| Validation | Checks that source and target rows match expected results |

DMS helps with movement, but schema work still matters. If Maple Market moves from old PostgreSQL to Aurora PostgreSQL, most schema objects may transfer cleanly. If it changes engines, such as Oracle to PostgreSQL, the team needs schema conversion, application query review, data type review, stored procedure decisions, and testing. AWS DMS can be part of the migration, and AWS Schema Conversion Tool or DMS Schema Conversion may also enter the plan depending on the source and target.

Native tools still have a place. PostgreSQL `pg_dump` and `pg_restore`, MySQL `mysqldump`, engine-native replication, snapshots, and export/import features can be the right answer for smaller databases, offline migrations, or engine-specific workflows. The practical choice depends on downtime tolerance, data size, engine compatibility, and how much change happens during the move.

A controlled cutover usually looks like this. The list reads like a checklist because each step needs an owner during the migration window.

```markdown
1. Full load into the target.
2. CDC running until replication lag is low.
3. Write freeze on the source during the cutover window.
4. Remaining DMS changes applied.
5. Validation checks on critical tables.
6. Application configuration pointed to the target endpoint.
7. Source kept read-only for an agreed rollback window.
```

That sequence gives the team a clear handoff point. It also gives support, database, application, and security teams the same timeline.

![Three migration paths showing file share to DataSync to EFS or S3, old database to DMS full load plus CDC to Aurora, and partner upload to Transfer Family to S3 inbound](/content-assets/articles/article-cloud-providers-aws-storage-databases-moving-data-into-around-aws/data-migration-paths.png)

*File movement, database movement, and partner intake each need their own repeatable path.*

## Long-Distance and Physical Transfer Choices
<!-- section-summary: Very large or distant data movement needs network planning, acceleration choices, and current AWS guidance for physical transfer. -->

Large data movement can be limited by physics and network contracts. A 200 TB video archive over a slow internet link can take longer than the business can accept. A remote office may have packet loss. A data center may have strict egress windows. This is where teams plan bandwidth, transfer windows, encryption, and physical options before promising dates.

For S3 uploads from distant clients, **S3 Transfer Acceleration** can speed long-distance transfers by routing traffic through Amazon CloudFront edge locations and the AWS network. The value depends on object size, source location, client network, and cost, so teams should test with real transfer samples before making it the default.

For very large online file and object movement, DataSync can be a better managed option than custom scripts because it handles transfer tasks, progress, retries, and reports. For database movement, DMS with CDC can reduce downtime by copying the bulk of data before cutover.

Physical transfer guidance has changed. Current AWS Snowball Edge documentation states that Snowball Edge is no longer available to new customers and points new customers toward AWS DataSync for online transfers, AWS Data Transfer Terminal for secure physical transfers, or partner solutions. AWS Data Transfer Terminal is a network-ready physical location where eligible customers bring their own storage devices and upload data over high-speed AWS network connectivity. Current AWS docs describe Data Transfer Terminal as available to AWS Enterprise customers.

That current fact matters for article readers. Older AWS migration guides and blog posts may mention Snowball as the obvious large data answer. A modern plan should check current availability, eligibility, Region coverage, compliance needs, and account team guidance before building around a physical transfer option.

## Cleaning, Cataloging, and Proving the Move
<!-- section-summary: A migration is complete only after the team validates the data, catalogs it for users, and cleans up temporary paths safely. -->

After data lands in AWS, the team still has work to do. Maple Market needs to prove the data arrived correctly, make it discoverable for the right consumers, and clean up temporary migration paths.

Validation depends on the data shape. For objects, compare object counts, total bytes, sample checksums, storage class, encryption, tags, and expected prefix coverage. For files, compare counts, sizes, timestamps, permissions, and a sample of business-critical contents. For databases, compare row counts, checksums where practical, referential integrity, migration task validation, and application-level queries.

Cataloging matters for analytics data. If finance exports land in S3, AWS Glue Data Catalog can store table metadata so query tools such as Athena know where the files are and what schema they have. Glue crawlers can infer schemas for some datasets, and teams can also define tables directly for stable production datasets. The goal is to make the data understandable without giving every analyst direct access to the application database.

Cleaning up also needs control. Temporary buckets, migration credentials, open firewall rules, DMS tasks, DataSync agents, and staging prefixes should not linger forever. A cleanup checklist prevents migration scaffolding from turning into permanent security and cost drift. For example, Maple Market can set lifecycle rules on staging prefixes and delete old migration IAM roles after the rollback window closes.

The final proof should include an application check. The team can open the customer order history against the new database, download a migrated invoice, run a finance report from the analytics prefix, and have the warehouse worker open a migrated supplier file through the new EFS mount. Technical counts matter, and user workflows matter too.

## A Production Migration Runbook
<!-- section-summary: A short runbook gives the team one shared plan for moving, validating, cutting over, and rolling back data. -->

Here is a runbook shape Maple Market can use before any serious data move. The runbook gives every team one shared timeline and one shared definition of done.

| Runbook area | What to write down |
|---|---|
| Owner | Team, on-call contact, approver, business stakeholder |
| Source | System name, location, data size, schemas or prefixes, current writers |
| Destination | AWS service, account, Region, bucket/table/database/filesystem, encryption |
| Tool | DataSync, DMS, S3 replication, Batch Operations, Transfer Family, native dump, or another approved path |
| Identity | IAM role, database user, partner account, secret, KMS permissions |
| Network | VPC path, agent placement, endpoints, firewall rules, bandwidth window |
| Dry run | Small test transfer, validation method, expected duration |
| Main run | Start time, monitoring links, expected volume, retry plan |
| Cutover | Write freeze, final sync, DNS or config change, application deployment |
| Validation | Counts, checksums, queries, sample user workflows |
| Rollback | Conditions for rollback, source state, old endpoint, rollback owner |
| Cleanup | Temporary roles, agents, staging buckets, lifecycle rules, old data retention |

The runbook can stay short, but it should exist. Data movement crosses teams. Application developers, database engineers, security reviewers, network engineers, finance users, and support teams may all need one shared source of truth during cutover.

The healthiest migration teams rehearse the boring parts. They run a dry copy, validate a sample, check IAM, check KMS, watch logs, and practice switching a test application. Then the production move feels like a known sequence instead of a live experiment.

## Putting It All Together
<!-- section-summary: Safe AWS data movement matches the tool to the data shape and proves the result before users depend on it. -->

Maple Market uses different movement paths for different data shapes. Small S3 copies use ordinary S3 tools. Large object operations use S3 Inventory and Batch Operations. New object copies can use S3 Replication when policy-driven asynchronous copy is the right fit. File share migration uses DataSync. Partner uploads use Transfer Family. Hybrid file access can use Storage Gateway. Database migration uses DMS, native tools, or a combination, with validation and cutover planning. Analytics exports land in S3 and become understandable through Glue Data Catalog.

The final lesson is simple: moving data is an engineering workflow with owners and evidence. The team chooses the right tool, gives it scoped access, watches it run, validates the destination, cuts over deliberately, and removes temporary paths after the rollback window. That is how data enters AWS without turning into mystery state.

![Migration runbook checklist with owner, source, destination, tool, dry run, cutover, validation, and cleanup](/content-assets/articles/article-cloud-providers-aws-storage-databases-moving-data-into-around-aws/migration-runbook-summary.png)

*A migration is complete only after the destination works for real user workflows and temporary access is cleaned up.*

---

**References**

- [S3 Batch Operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html) - Describes managed bulk operations across large lists of S3 objects.
- [Replicating objects within and across Regions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html) - Documents asynchronous S3 object replication.
- [S3 Transfer Acceleration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/transfer-acceleration.html) - Explains accelerated transfers through CloudFront edge locations and the AWS network.
- [What is AWS DataSync?](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html) - Defines DataSync as an online data movement service for file and object data.
- [Where can I transfer my data with AWS DataSync?](https://docs.aws.amazon.com/datasync/latest/userguide/working-with-locations.html) - Lists supported DataSync source and destination location types.
- [AWS Transfer Family](https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html) - Describes managed SFTP, FTPS, FTP, AS2, and browser-based transfers into and out of AWS storage.
- [Amazon S3 File Gateway](https://docs.aws.amazon.com/filegateway/latest/files3/what-is-file-s3.html) - Explains file-based access to objects stored in S3 through Storage Gateway.
- [AWS Database Migration Service](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html) - Covers database migration and replication from relational, warehouse, NoSQL, and other data stores.
- [AWS DMS CDC tasks](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Task.CDC.html) - Explains ongoing change capture during database migration tasks.
- [AWS Glue Data Catalog](https://docs.aws.amazon.com/glue/latest/dg/catalog-and-crawler.html) - Describes the metadata catalog used by AWS Glue and analytics services.
- [AWS Data Transfer Terminal](https://docs.aws.amazon.com/datatransferterminal/latest/userguide/what-is-dtt.html) - Documents the physical secure transfer location service and current eligibility note.
- [Snowball Edge availability change](https://docs.aws.amazon.com/snowball/latest/developer-guide/snowball-edge-availability-change.html) - Documents that Snowball Edge is no longer available to new customers and lists AWS-recommended alternatives.
