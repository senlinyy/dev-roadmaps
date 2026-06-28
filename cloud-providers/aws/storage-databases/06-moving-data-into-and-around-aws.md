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

1. [Start With the Migration Pain](#start-with-the-migration-pain)
2. [Everyday S3 Copies and Bulk Object Work](#everyday-s3-copies-and-bulk-object-work)
3. [Moving File Shares](#moving-file-shares)
4. [Moving Databases](#moving-databases)
5. [Partner Feeds and Hybrid Access](#partner-feeds-and-hybrid-access)
6. [Large or Distant Data](#large-or-distant-data)
7. [Validation, Cutover, and Rollback](#validation-cutover-and-rollback)
8. [References](#references)

## Start With the Migration Pain
<!-- section-summary: Moving data needs ownership, validation, security, retries, and cutover planning around the copy work. -->

Maple Market has old product photos on a file server, a PostgreSQL database in a datacenter, nightly partner files arriving over SFTP, and new analytics jobs waiting for S3 exports. Copying bytes is only one part of the work. The team also has to prove the right bytes arrived, secure the path, handle retries, cut over safely, and clean up temporary access.

Data movement starts with a runbook. Name the source, destination, owner, data classification, copy method, validation method, cutover plan, rollback plan, and cleanup date. Then choose the AWS tool that matches the data shape.

Different shapes need different tools. S3 objects, file shares, relational databases, partner feeds, streaming changes, and physical transfer all have different failure modes.

A good migration note says more than "copy old data to AWS." It names the source system, destination account and Region, encryption, IAM role, network path, expected byte count, expected record count, validation queries, outage window, rollback owner, and cleanup date. That gives every team the same definition of done.

A small planning table keeps the work concrete:

| Data movement | Source | Destination | Main risk | Validation |
| --- | --- | --- | --- | --- |
| Product photos | On-premises SMB share | S3 `maple-product-photos-prod` | Missing files or changed metadata | File count, sample checksums, app read test |
| Orders database | Datacenter PostgreSQL | RDS PostgreSQL | Replication lag or incompatible schema | Row counts, checksums, checkout smoke test |
| Supplier feed | Partner SFTP | S3 inbound prefix | Wrong partner access or bad file format | Parser job and rejection report |
| Analytics exports | RDS and app events | S3 curated prefixes | Partition or schema mismatch | Downstream query comparison |

This table helps a beginner see that "move data" is several different jobs. Each job has its own tool, risk, and proof.

Before the copy starts, teams usually check these things:

| Pre-move check | What the team wants to know |
| --- | --- |
| Ownership | Which team can approve source reads, destination writes, downtime, and rollback |
| Size and change rate | How many bytes or rows exist today, and how quickly the source changes during the move |
| Access path | Which IAM role, database user, firewall rule, VPN, Direct Connect, or partner account is used |
| Data protection | Which encryption keys, retention rules, object lock needs, or compliance labels apply |
| Compatibility | Which schema, file metadata, character sets, protocols, or application assumptions may break |
| Validation | Which counts, checksums, queries, and smoke tests prove the destination works |
| Cleanup | Which temporary users, roles, agents, staging buckets, and network paths will be removed |

![The tool chooser maps common data movement jobs to S3 commands, DataSync, DMS, Transfer Family, Storage Gateway, Glue, and physical transfer options](/content-assets/articles/article-cloud-providers-aws-storage-databases-moving-data-into-around-aws/data-movement-tool-chooser.png)

*The tool chooser maps common data movement jobs to S3 commands, DataSync, DMS, Transfer Family, Storage Gateway, Glue, and physical transfer options.*


## Everyday S3 Copies and Bulk Object Work
<!-- section-summary: S3 has small-copy commands for everyday work and managed bulk tools for large object sets. -->

For small or routine object movement, the AWS CLI is often enough. Maple Market can copy local export files into S3 or sync one prefix to another.

```bash
aws s3 cp ./daily-orders.parquet s3://maple-analytics-prod/raw/orders/date=2026-06-24/
aws s3 sync s3://maple-old-exports/orders/ s3://maple-analytics-prod/raw/orders/
```

`cp` copies one local file to one S3 destination. `sync` compares the source and destination prefixes and copies changed or missing objects. The trailing slash matters because it treats the destination as a prefix. Successful output usually includes lines like these:

```bash
upload: ./daily-orders.parquet to s3://maple-analytics-prod/raw/orders/date=2026-06-24/daily-orders.parquet
copy: s3://maple-old-exports/orders/part-0001.parquet to s3://maple-analytics-prod/raw/orders/part-0001.parquet
```

The output proves the CLI submitted copy work for those keys. It does not prove the dataset is complete, encrypted with the intended key, readable by analytics, or partitioned correctly.

For millions of objects, use managed S3 features instead of a laptop loop. S3 Inventory can list objects on a schedule. S3 Batch Operations can copy, tag, restore, invoke Lambda, or apply other supported operations across a manifest.

Bulk work needs validation. Count objects, compare expected prefixes, sample checksums where available, and confirm downstream jobs can read the destination. Treat a successful copy command as the start of validation. The team still needs proof that the dataset is usable.

For S3-to-S3 operations, also check ownership, encryption, storage class, tags, object lock needs, and lifecycle effects. A copy that moves bytes but drops tags or changes KMS keys can break analytics, retention, or access controls later.

## Moving File Shares
<!-- section-summary: AWS has different file movement tools for online migration, partner transfer protocols, and hybrid file access. -->

Old product photos may live on an NFS or SMB file share. **AWS DataSync** can copy data between on-premises storage and AWS storage services such as S3, EFS, and FSx. It handles scheduling, transfer tasks, metadata options, and verification features better than a hand-written script.

A DataSync task has a source location, destination location, schedule or manual run, include and exclude filters, and verification settings. Use a dry run or limited prefix first. Then run a larger copy and review task reports.

For hybrid file access where on-premises apps still need a local protocol while data lands in AWS, **AWS Storage Gateway** can fit some patterns. Choose it for a continuing hybrid access need, not for a one-time copy that DataSync can finish cleanly.

DataSync checks should include task status, bytes transferred, files transferred, verification result, skipped files, and errors. If permissions matter, validate ownership and mode bits or Windows ACLs from a test client after the move. A file share migration is not complete until the application can open the files through the target path.

During a DataSync run, operators should capture task execution evidence:

```bash
aws datasync describe-task-execution \
  --task-execution-arn "$TASK_EXECUTION_ARN" \
  --query '{Status:Status,BytesTransferred:BytesTransferred,FilesTransferred:FilesTransferred,FilesSkipped:FilesSkipped,Result:Result}'
```

`--task-execution-arn` identifies one specific run, not the reusable task definition. The query keeps the first inspection focused on transfer status, byte count, file count, skipped files, and the step-level result. A completed run might return:

```json
{
  "Status": "SUCCESS",
  "BytesTransferred": 8429312141,
  "FilesTransferred": 184203,
  "FilesSkipped": 12,
  "Result": {
    "PrepareStatus": "SUCCESS",
    "TransferStatus": "SUCCESS",
    "VerifyStatus": "SUCCESS",
    "ErrorCode": null,
    "ErrorDetail": null
  }
}
```

`FilesSkipped` deserves review even when the overall status is `SUCCESS`. Skipped files may be expected excludes, permission problems, path length issues, or files that changed during transfer.

Then verify from the destination side. If photos moved into S3, list the expected prefix and sample a few objects. If files moved into EFS or FSx, mount the target from a test client that uses the same identity path as the application.

## Moving Databases
<!-- section-summary: Database migration needs schema planning, full load, change capture, validation, and a controlled cutover. -->

Database movement is a workflow, not a single copy. Maple Market may move PostgreSQL from a datacenter to Amazon RDS or Aurora. The team needs schema compatibility checks, full load, ongoing change capture, validation, application cutover, and rollback.

**AWS Database Migration Service**, or DMS, can perform full loads and change data capture for supported sources and targets. Teams still test schema, extensions, stored procedures, application behavior, and performance.

A simple migration runbook shape is:

1. Freeze incompatible schema changes during the migration window.
2. Create target database, users, parameters, and security groups.
3. Run schema conversion or manual schema setup.
4. Start DMS full load and change data capture.
5. Validate row counts, checksums, key queries, and application read tests.
6. Pause writes or enter maintenance mode.
7. Let replication catch up and record final lag.
8. Point the application at the target database.
9. Keep rollback connection details until the agreed confidence window ends.

The exact method changes by engine and downtime tolerance. The steady rule is that validation and rollback are planned before cutover night.

DMS has useful health signals during the run. Track task status, full-load progress, CDC latency, table statistics, validation state, and target errors. If replication lag is growing near cutover, the application switch is too early. If validation fails on critical tables, the team should fix the data mismatch before pointing customer traffic at the target.

For DMS, table statistics make the migration visible:

```bash
aws dms describe-table-statistics \
  --replication-task-arn "$DMS_TASK_ARN" \
  --query 'TableStatistics[].{Table:TableName,FullLoadRows:FullLoadRows,Inserts:Inserts,Updates:Updates,Deletes:Deletes,Validation:ValidationState}'
```

`--replication-task-arn` points to the DMS task that performed the load or change capture. The query shows each table's full-load row count, captured changes, and validation state:

```json
[
  {
    "Table": "orders",
    "FullLoadRows": 1829384,
    "Inserts": 521,
    "Updates": 88,
    "Deletes": 3,
    "Validation": "Validated"
  },
  {
    "Table": "payments",
    "FullLoadRows": 1821021,
    "Inserts": 518,
    "Updates": 91,
    "Deletes": 0,
    "Validation": "Validated"
  }
]
```

`FullLoadRows` should line up with source-side expectations. `Inserts`, `Updates`, and `Deletes` show change data capture after the full load. `Validation` should be reviewed before cutover because `Mismatched records`, `Pending records`, or `Table error` need investigation.

Pair those numbers with database-side checks. A row count can match while important aggregates differ, so include business queries such as total orders by day, payment status counts, and the latest created timestamp. Validation should use data the application cares about, not just migration service status.

![The migration path view separates file, object, database, partner-feed, hybrid, and large-transfer movement patterns](/content-assets/articles/article-cloud-providers-aws-storage-databases-moving-data-into-around-aws/data-migration-paths.png)

*The migration path view separates file, object, database, partner-feed, hybrid, and large-transfer movement patterns.*


## Partner Feeds and Hybrid Access
<!-- section-summary: Managed transfer services help receive partner files and expose controlled protocols without running long-lived transfer servers yourself. -->

Partner feeds often arrive over SFTP, FTPS, or FTP. **AWS Transfer Family** provides managed protocol endpoints that can write to S3 or EFS. This lets Maple Market receive nightly supplier files without operating its own transfer server fleet.

Design the landing zone carefully. Put inbound files in a prefix such as `partner-inbound/{partner}/{date}/`. Use IAM roles and logical directories to keep partners separated. Trigger validation after upload. Move accepted files to a curated prefix and rejected files to a quarantine prefix with an error report.

For internal hybrid access, Storage Gateway can help bridge on-premises file or volume workflows with AWS-backed storage. Use it when existing systems need local protocol access during a transition or ongoing hybrid operation.

Transfer Family also needs identity design. Partners should authenticate through an approved identity provider or service-managed users, land in restricted logical directories, and use IAM roles scoped to their prefixes. Each partner feed should have a validation job, rejection path, and contact procedure for bad files.

Before accepting a partner feed, teams usually test one upload with a harmless sample file, confirm it lands under the partner's prefix, confirm the partner cannot list another partner's prefix, and run the parser against the sample. After the first real feed, check file count, file names, size range, schema version, duplicate detection, and rejection report. A managed endpoint removes server maintenance, while the feed contract still needs operational proof.

## Large or Distant Data
<!-- section-summary: Very large or distant data movement needs network planning, acceleration choices, and current AWS guidance for physical transfer. -->

Large datasets need bandwidth math. A 200 TB file share over a slow link may take too long for the business window. Before choosing a tool, estimate total bytes, available bandwidth, daily change rate, compression, transfer hours, and verification time.

Options include DataSync over Direct Connect or VPN, S3 Transfer Acceleration for certain internet upload patterns, multipart uploads for large objects, and current AWS physical transfer services when network transfer is impractical. Always check current AWS documentation because physical transfer offerings and regional availability can change.

Current AWS Snowball Edge documentation says Snowball Edge is no longer available to new customers and points new customers toward DataSync for online transfers, AWS Data Transfer Terminal for secure physical transfers, or partner options. That matters because older runbooks may still list Snowball as the default physical-transfer answer. Verify eligibility and Region support before promising a physical path.

Security still matters during bulk movement. Encrypt data in transit, encrypt data at rest, restrict temporary IAM roles, log access, and remove migration permissions after the cutover.

For huge transfers, write down the math before promising a date. A rough estimate can include:

```bash
total_tb=200
usable_mbps=800
hours=$(python3 - <<'PY'
total_tb = 200
usable_mbps = 800
seconds = total_tb * 1024 * 1024 * 8 / usable_mbps
print(round(seconds / 3600, 1))
PY
)
echo "$hours hours before retries and validation"
```

This example prints about `582.5 hours before retries and validation`, which is a little over 24 days. The exact calculation can live in a spreadsheet or runbook. The important part is naming bandwidth, daily change rate, retries, and validation time. A copy that takes weeks while the source changes heavily may need incremental sync, change capture, or a different cutover design.

## Validation, Cutover, and Rollback
<!-- section-summary: A migration is complete only after the team validates the data, catalogs it for users, and cleans up temporary paths safely. -->

Validation should be written before the copy starts. For files, compare counts, sizes, manifests, and sample checksums. For databases, compare row counts, important aggregates, constraints, and application queries. For analytics data, run downstream jobs against the destination and compare reports.

After the move, the evidence should answer these questions:

| Post-move check | Example proof |
| --- | --- |
| Completeness | Source and destination counts match within the expected window |
| Integrity | Sample checksums, DMS validation, or manifest comparison passes |
| Permissions | Application role can read and write only the intended destination paths |
| Metadata | Object tags, storage class, file ownership, ACLs, or database constraints survived the move |
| Application behavior | Smoke tests run against the destination with real business queries |
| Observability | Alarms, logs, task IDs, and dashboard links are attached to the change record |
| Cleanup | Temporary roles, users, firewall rules, agents, and staging prefixes are removed or scheduled |

Cutover needs a short checklist:

- Stop or pause writes at the source when required.
- Run final sync or wait for change capture lag to reach the target threshold.
- Switch application configuration or DNS.
- Run smoke tests and business validation queries.
- Watch errors, latency, replication status, and user reports.
- Keep rollback open until the agreed confidence window ends.
- Remove temporary credentials, routes, firewall rules, and staging buckets after signoff.

Rollback is a real plan, not a wish. Decide what data can be written after cutover, how it would be copied back if needed, and when rollback stops being safe because the new system has accepted too much production change.

Cleanup closes the migration. Delete temporary IAM roles, revoke partner test users, remove firewall openings, stop DMS tasks, decommission DataSync agents, expire staging prefixes, and archive the runbook results. The migration is finished when the destination works for real workflows and temporary access has been removed.

Rollback has a deadline. Right after cutover, the old system may still have fresh enough data to take traffic again. After users create new orders in the AWS target, rollback might require copying those new writes back, replaying events, or accepting data loss. Write the point of no return into the runbook, such as "rollback to datacenter PostgreSQL is available until 30 minutes after cutover, then recovery uses forward fixes and targeted data repair."

After signoff, keep the evidence. Store the final counts, validation queries, migration task IDs, incident notes, and cleanup confirmation in the change record. The next migration team should inherit proof, not a vague memory that the copy worked.

![The runbook summary shows the checks around validation, cutover, rollback, monitoring, and ownership for a safe data move](/content-assets/articles/article-cloud-providers-aws-storage-databases-moving-data-into-around-aws/migration-runbook-summary.png)

*The runbook summary shows the checks around validation, cutover, rollback, monitoring, and ownership for a safe data move.*


## References

- [AWS DataSync documentation](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)
- [AWS Database Migration Service documentation](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
- [AWS DMS documentation: Change data capture tasks](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Task.CDC.html)
- [AWS Transfer Family documentation](https://docs.aws.amazon.com/transfer/latest/userguide/what-is-aws-transfer-family.html)
- [Amazon S3 documentation: Batch Operations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/batch-ops.html)
- [Amazon S3 documentation: Transfer Acceleration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/transfer-acceleration.html)
- [AWS Snowball Edge documentation: Availability change](https://docs.aws.amazon.com/snowball/latest/developer-guide/snowball-edge-availability-change.html)
- [AWS Data Transfer Terminal documentation](https://docs.aws.amazon.com/datatransferterminal/latest/userguide/what-is-dtt.html)
