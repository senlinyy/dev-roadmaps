---
title: "Object Storage for ML"
description: "Use object storage as the durable home for ML datasets, model artifacts, evaluation files, logs, and release evidence."
overview: "Object storage gives ML teams a durable, versionable place for datasets, model artifacts, evaluation reports, manifests, and release evidence. This guide follows an insurance document model through bucket layout, object paths, metadata, permissions, lifecycle policies, integrity checks, and recovery."
tags: ["MLOps", "production", "storage"]
order: 2
id: "article-mlops-mlops-infrastructure-object-storage-for-ml-systems"
---

## Table of Contents

1. [Object Storage Holds ML Evidence](#object-storage-holds-ml-evidence)
2. [Follow One Document Model](#follow-one-document-model)
3. [Design The Bucket Layout](#design-the-bucket-layout)
4. [Write Objects With Manifests](#write-objects-with-manifests)
5. [Use Versioning And Lifecycle Rules](#use-versioning-and-lifecycle-rules)
6. [Control Access And Secrets](#control-access-and-secrets)
7. [Verify Integrity And Recovery](#verify-integrity-and-recovery)
8. [Failure Modes](#failure-modes)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Object Storage Holds ML Evidence
<!-- section-summary: Object storage is the durable place where production ML teams keep large files and the evidence around them. -->

**Object storage** is a storage system where files live as objects inside buckets or containers. Each object has a path-like key, bytes, metadata, and access controls. In cloud platforms, the common examples are Amazon S3, Google Cloud Storage, and Azure Blob Storage.

ML teams use object storage because ML systems create many large files. Training data snapshots, validation datasets, model files, embeddings, feature exports, evaluation reports, batch predictions, logs, and rollback artifacts all need a durable home. Git is useful for code. A database is useful for structured records. Object storage is usually where the large ML artifacts live.

The key idea for you as an MLOps learner is this: the model file should never be a lonely file. It should sit beside enough evidence for another engineer to understand where it came from, how it was evaluated, which code created it, and how to restore or compare it later.

Object storage helps when the team uses it with discipline:

| Need | Object storage habit |
|---|---|
| Reproduce a run | Store immutable input snapshots and manifests |
| Review a model | Store reports, plots, metrics, and model cards |
| Serve a model | Store approved artifacts under release paths |
| Roll back | Keep previous artifacts and image digests reachable |
| Audit | Store lineage, owners, retention, and access metadata |

![ClaimLens object storage evidence](/content-assets/articles/article-mlops-mlops-infrastructure-object-storage-for-ml-systems/claimlens-bucket-evidence.png)

*ClaimLens treats the bucket as an evidence trail: redacted snapshots, OCR features, model files, reports, and the release packet all point back to the same document classifier version.*

## Follow One Document Model
<!-- section-summary: The running scenario follows an insurance team that classifies claim documents and needs reliable storage around every model version. -->

Imagine **ClaimLens**, an insurance platform that classifies uploaded claim documents. The model reads PDFs and images, then predicts document types such as `medical_bill`, `repair_invoice`, `police_report`, and `identity_document`. The output routes documents to the right review queue.

The system creates several artifact groups:

- Raw uploaded documents in a protected product bucket.
- Redacted training snapshots for ML use.
- OCR text and layout features.
- Training and validation datasets.
- Model artifacts.
- Evaluation reports by document type and region.
- Batch prediction files for backtesting.
- Release packets for approved versions.

ClaimLens cannot store all of that inside Git. The files are large, sensitive, and tied to retention rules. It also cannot leave them scattered across laptop folders. The team needs a stable object-storage layout that supports training, review, serving, and audit.

A clean storage packet for one model version might look like this:

```yaml
model_release:
  model_name: document_classifier
  model_version: "2026-07-claimlens-v14"
  artifact_root: s3://claimlens-ml-prod/models/document_classifier/2026-07-v14/
  training_snapshot: s3://claimlens-ml-prod/datasets/document_classifier/train/2026-06-30-v3/
  validation_snapshot: s3://claimlens-ml-prod/datasets/document_classifier/valid/2026-06-30-v3/
  evaluation_report: s3://claimlens-ml-prod/reports/document_classifier/2026-07-v14/evaluation.html
  manifest: s3://claimlens-ml-prod/manifests/document_classifier/2026-07-v14.yaml
```

Every path has a purpose. The release packet points to model files, data snapshots, reports, and manifests. That gives reviewers and operators a way to follow the evidence trail.

## Design The Bucket Layout
<!-- section-summary: A good object-storage layout separates raw data, curated datasets, model artifacts, reports, manifests, and environment stages. -->

Start by separating data by purpose and sensitivity. A raw upload bucket has different access rules from a model artifact bucket. A development bucket has different retention rules from a production evidence bucket.

ClaimLens uses this layout:

```plaintext
s3://claimlens-ml-dev/
  scratch/
  experiments/

s3://claimlens-ml-prod/
  datasets/
    document_classifier/
      train/2026-06-30-v3/
      valid/2026-06-30-v3/
      test/2026-06-30-v3/
  features/
    ocr_layout/2026-06-30-v3/
  models/
    document_classifier/2026-07-v14/
  reports/
    document_classifier/2026-07-v14/
  manifests/
    document_classifier/2026-07-v14.yaml
  batch-predictions/
    document_classifier/2026-07-v14/
```

The layout avoids one giant `artifacts/` folder where every team invents a path. It also avoids using human labels such as `latest` as the only path. `latest` can exist as a pointer or registry alias, but the durable object path should include a stable version.

Object names should make common operations easy:

| Object path field | Why it helps |
|---|---|
| Environment | Separates dev, staging, and production access |
| Asset type | Distinguishes datasets, models, reports, and manifests |
| Model or project name | Keeps teams from colliding |
| Version or snapshot date | Supports reproduction and rollback |
| File role | Makes artifacts readable during incidents |

For model artifacts, ClaimLens writes:

```plaintext
s3://claimlens-ml-prod/models/document_classifier/2026-07-v14/
  model.onnx
  tokenizer.json
  label_map.json
  preprocessing.yaml
  conda.yaml
  model-signature.json
  artifact-manifest.json
```

The serving system can load this folder, and the reviewer can inspect what will run. The model file alone is not enough because the label map, preprocessing, dependencies, and signature shape the prediction.

## Write Objects With Manifests
<!-- section-summary: Manifests turn a folder of objects into a reproducible ML asset with hashes, owners, versions, and purpose. -->

A **manifest** is a small file that describes the objects in a dataset or artifact package. It records paths, hashes, row counts, owners, timestamps, retention class, and related code. The manifest is the bridge between object storage and reproducibility.

ClaimLens writes a manifest for each training dataset:

```yaml
dataset_manifest:
  name: document_classifier_train
  snapshot: "2026-06-30-v3"
  owner: claims-ml-platform
  source_tables:
    - warehouse.claim_documents
    - warehouse.claim_labels
  object_root: s3://claimlens-ml-prod/datasets/document_classifier/train/2026-06-30-v3/
  files:
    - path: part-0000.parquet
      rows: 48291
      sha256: "a8a5f2..."
    - path: part-0001.parquet
      rows: 47734
      sha256: "923f5b..."
  schema_version: document_training_schema_v5
  redaction_policy: pii-redacted-v2
  retention_class: seven_year_audit
  created_by_run: claim-doc-dataset-build-2026-07-01
```

The model artifact package gets a manifest too:

```json
{
  "model_name": "document_classifier",
  "model_version": "2026-07-v14",
  "created_by_run": "train-claim-docs-2026-07-04-0100",
  "git_commit": "af31e6a",
  "files": [
    {"path": "model.onnx", "sha256": "d6f15a..."},
    {"path": "label_map.json", "sha256": "042a19..."},
    {"path": "preprocessing.yaml", "sha256": "93dabc..."},
    {"path": "model-signature.json", "sha256": "88ee09..."}
  ]
}
```

Hashes help catch partial uploads and accidental overwrites. During serving startup, the model loader can verify expected files before it accepts traffic. During audit, the team can prove which bytes were approved.

![ClaimLens manifest verification](/content-assets/articles/article-mlops-mlops-infrastructure-object-storage-for-ml-systems/claimlens-manifest-verification.png)

*The manifest turns loose objects into a checked package by naming the files, recording hashes, and giving release automation a concrete verification list.*

## Use Versioning And Lifecycle Rules
<!-- section-summary: Bucket versioning and lifecycle rules protect ML evidence while controlling long-term storage cost. -->

Cloud object stores can keep object versions. Versioning helps when a file is overwritten or deleted accidentally. It also helps with recovery after a bad automation script. Production ML buckets should usually enable versioning for critical artifact and manifest paths.

Versioning is not the same as a dataset version. A dataset version is an ML identity such as `2026-06-30-v3`. Object versioning is a storage feature that keeps prior object bytes. You usually want both: semantic ML versions in your paths and bucket-level object versioning for recovery.

ClaimLens uses lifecycle rules:

| Path | Retention policy |
|---|---|
| `prod/models/` | Keep approved model versions for audit window |
| `prod/manifests/` | Keep with model and dataset retention |
| `prod/reports/` | Keep approved release reports |
| `prod/batch-predictions/` | Move older files to colder storage after 90 days |
| `dev/scratch/` | Delete after 14 days |

Lifecycle rules matter because ML teams produce a lot of files. Without cleanup, debug exports, failed training runs, and old prediction dumps can quietly grow storage cost. With aggressive cleanup, the team can lose the very evidence it needs for a replay. Use path-specific rules rather than one rule for the whole bucket.

## Control Access And Secrets
<!-- section-summary: ML object storage needs least-privilege access because datasets, models, and prediction files can contain sensitive business or user information. -->

Object storage can hold sensitive data. A training snapshot may contain redacted customer documents. A model artifact can encode business knowledge. A batch prediction file can reveal customer risk or claim category. Access needs review.

ClaimLens uses separate roles:

| Role | Access |
|---|---|
| Dataset builder | Write curated dataset snapshots and manifests |
| Training job | Read approved datasets, write model artifacts and reports |
| Model reviewer | Read reports, manifests, and approved artifacts |
| Serving runtime | Read only approved model artifact paths |
| Analyst | Read aggregate evaluation reports, no raw document access |

The serving runtime should not have broad bucket write access. It needs to read approved model artifacts. Training jobs can write new candidates. Release jobs can promote approved artifacts. These boundaries reduce blast radius during incidents.

Use workload identity or cloud IAM roles instead of long-lived static keys whenever the platform supports it. Store secret references in the platform secret manager, not in dataset manifests or code. The object path can appear in a manifest; the credential should live in the runtime identity layer.

## Verify Integrity And Recovery
<!-- section-summary: Object-storage checks should prove that required files exist, hashes match, permissions work, and rollback artifacts remain available. -->

A storage design needs checks. ClaimLens runs a small verification job after training and before release:

```bash
python tools/verify_artifact_package.py \
  --manifest s3://claimlens-ml-prod/manifests/document_classifier/2026-07-v14.yaml \
  --require model.onnx \
  --require label_map.json \
  --require preprocessing.yaml \
  --require model-signature.json
```

The verifier checks:

- Every required file exists.
- Hashes match the manifest.
- File sizes are inside expected ranges.
- The serving role can read the approved artifact path.
- The report and model card links are reachable.
- The rollback version still exists.

The rollback check is easy to skip, and it matters. A team should know before release whether the previous approved model can still be loaded. ClaimLens stores a release pointer:

```yaml
rollback_target:
  model_name: document_classifier
  current_version: "2026-07-v14"
  previous_approved_version: "2026-06-v13"
  previous_artifact_root: s3://claimlens-ml-prod/models/document_classifier/2026-06-v13/
  verified_at: "2026-07-04T18:22:00Z"
```

During an incident, the on-call engineer can move the registry alias or serving config back to the previous artifact path with confidence.

![ClaimLens release readiness checks](/content-assets/articles/article-mlops-mlops-infrastructure-object-storage-for-ml-systems/claimlens-release-readiness.png)

*A release-ready object store protects production artifacts, limits serving access, verifies bytes, and keeps the previous package reachable before traffic moves.*

## Failure Modes
<!-- section-summary: ML object storage fails through messy layouts, missing manifests, weak access boundaries, lost versions, and unmanaged cost. -->

Common object-storage failures are easy to recognize:

| Failure mode | Symptom | Better habit |
|---|---|---|
| One shared bucket for everything | Nobody knows which files are production evidence | Separate environments and asset types |
| Human-only path names | `final-model-actually-final.pkl` appears in serving | Use versioned paths and registry links |
| Missing manifest | Old run cannot be reproduced | Write manifests with hashes and source IDs |
| Broad serving permissions | Runtime can read or write too much | Give serving read-only access to approved paths |
| No lifecycle rules | Storage cost grows quietly | Add retention by path and purpose |
| Overaggressive cleanup | Audit or rollback evidence disappears | Protect approved releases and manifests |
| No integrity check | Partial upload reaches serving | Verify required files and hashes |

The fix is not a fancy platform. The fix is boring structure: clear paths, manifests, versioning, permissions, lifecycle rules, and verification.

## Putting It Together
<!-- section-summary: Object storage works well for ML when files carry stable paths, manifests, access boundaries, and retention rules. -->

Object storage is often the durable home for ML evidence. ClaimLens uses it for datasets, features, models, reports, manifests, and batch predictions. The value comes from the discipline around the bucket: stable paths, versioned folders, manifests, hashes, access boundaries, lifecycle rules, and recovery checks.

When you design object storage for ML, start with the lifecycle. Ask which files support training, which files support review, which files support serving, and which files support rollback. Then make those paths obvious. A future incident response should not depend on one engineer remembering where a model file was copied.

The best object-storage layout lets another engineer answer simple questions quickly: what trained this model, which bytes were approved, who can read them, how long do they stay, and how do we roll back?

## References

- [Amazon S3 Object Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
- [Google Cloud Storage Object Versioning](https://cloud.google.com/storage/docs/object-versioning)
- [Azure Blob Storage Versioning](https://learn.microsoft.com/azure/storage/blobs/versioning-overview)
- [Amazon S3 Lifecycle Configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Google Cloud Storage Lifecycle Management](https://cloud.google.com/storage/docs/lifecycle)
- [Azure Blob Storage Lifecycle Management](https://learn.microsoft.com/azure/storage/blobs/lifecycle-management-overview)
