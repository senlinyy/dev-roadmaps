---
title: "Securing ML Assets"
description: "Explain how teams protect restricted training data, model artifacts, containers, registries, and review evidence with least privilege and audit logs."
overview: "Securing ML assets means protecting the data, artifacts, containers, metadata, and release evidence that make a model work. A supporting example follows a retail personalization model through restricted training data, object-store boundaries, least privilege roles, artifact integrity checks, signed containers, and audit-ready release evidence."
tags: ["MLOps", "production", "security"]
order: 2
id: "article-mlops-governance-and-responsible-ai-securing-training-data-model-artifacts"
aliases:
  - roadmaps/mlops/modules/governance-and-responsible-ai/security/01-securing-training-data-model-artifacts.md
  - child-security-01-securing-training-data-model-artifacts
---


## What Securing ML Assets Means
<!-- section-summary: Securing ML assets means controlling who can read, write, promote, and serve the data and artifacts behind a model. -->

ML assets are more than the final model file. They include training data, feature tables, labels, preprocessing code, experiment metadata, evaluation reports, model artifacts, container images, registry records, approval packets, and deployment manifests. Securing ML assets means **only the right identities can touch the right assets for the right reason, and every important change leaves evidence**.

This matters because ML systems often gather sensitive data into convenient places. A training job may read years of customer history. An artifact may encode patterns from restricted data. A model card may reveal sensitive feature names. A container image may include private dependencies. A registry alias may decide which model serves real traffic. Each asset needs an access boundary that matches its risk.

For beginners, the simple rule is: protect the path from data to model to release. Training data should stay in governed storage. Jobs should use scoped service accounts. Artifacts should land in a controlled bucket or registry. Containers should have immutable digests and signatures when they enter production. Release evidence should prove which identity created, reviewed, promoted, and served the model.

## A Supporting Example: Retail Personalization
<!-- section-summary: A retail personalization model is a useful security example because training data, artifacts, and serving records carry different risk levels. -->

A supporting example follows LumaMart, a fictional retailer that recommends products on its home page and email campaigns. The personalization model `next_best_offer` predicts which offer a loyalty member might click. It trains from product views, purchases, returns, loyalty tier, region, email engagement, promotion history, and restricted customer attributes that only approved analytics roles can use.

The model team wants to train version `53` and hand it to the serving team. The assets live in several places:

| Asset | Example | Security concern |
| --- | --- | --- |
| Raw event data | Clickstream and purchase events | May include customer identifiers and behavioral history. |
| Feature table | `retail_secure.features.next_best_offer_v12` | Joins customer behavior, promotions, and loyalty attributes. |
| Label table | `retail_secure.labels.offer_click_14d` | Reveals customer response behavior. |
| Training job | Kubernetes Job or managed training pipeline | Needs scoped read access and write access to one artifact prefix. |
| Model artifact | `s3://lumamart-ml-artifacts/personalization/next-best-offer/53/` | Can be copied, replaced, or served by the wrong identity. |
| Container image | `ghcr.io/lumamart/personalization-train@sha256:...` | Needs provenance and vulnerability checks. |
| Registry record | `retail_prod.models.next_best_offer`, version `53` | Controls which model can move toward serving. |
| Review evidence | Model card, segment report, data manifest | Can expose sensitive columns and business strategy. |

![LumaMart asset path from restricted data to approved serving](/content-assets/articles/article-mlops-governance-and-responsible-ai-securing-training-data-model-artifacts/lumamart-asset-path.png)
*LumaMart protects the path from restricted data, through the training role and candidate artifact, into approved serving.*

LumaMart has two goals. First, data scientists should move fast enough to train and evaluate the model. Second, the platform should prevent accidental broad access, silent artifact changes, and unreviewed promotion. Good security does both by giving teams clear roles and clear paths.

## Classify the Assets
<!-- section-summary: Classification gives every ML asset a risk label before the team writes bucket policies or identity and access management roles. -->

Before writing policies, classify the assets. Classification means assigning a risk label that tells the team how carefully to store, share, log, and retain the asset. A raw customer event table has a different access rule from a public README. A model artifact trained on customer behavior may need stronger controls than a demo notebook.

LumaMart uses four labels:

| Label | Meaning | Examples |
| --- | --- | --- |
| Public | Safe to share outside the company. | Published model architecture diagram without customer data. |
| Internal | Company-only, low sensitivity. | Generic training run summary, team docs. |
| Restricted | Sensitive business or customer data. | Feature tables, label tables, segment reports, review packets. |
| Production controlled | Asset can affect live service behavior. | Approved model artifacts, registry aliases, deployment manifests. |

This classification keeps the rest of the security design grounded. The training job can read restricted feature and label tables, yet only during the approved pipeline run. The job can write candidate artifacts, yet only under the candidate prefix for version `53`. The serving role can read approved production artifacts, yet it has no reason to read raw training data. Human reviewers can read the review packet, yet many engineers never need raw customer rows.

The classification should appear in metadata, because humans will miss labels hidden in a wiki. LumaMart stores it in the dataset manifest and artifact manifest.

```yaml
dataset_manifest:
  dataset_id: next_best_offer_train_2026_06_30
  classification: restricted
  owner: personalization-data
  retention_days: 730
  allowed_training_roles:
    - arn:aws:iam::111122223333:role/ml-train-next-best-offer
  source_tables:
    - retail_secure.events.product_views
    - retail_secure.events.purchases
    - retail_secure.crm.loyalty_profile
  restricted_columns:
    - loyalty_tier
    - region_code
    - email_engagement_30d
  approved_use: train and evaluate next_best_offer models
```

The manifest helps reviewers and automation. A policy check can fail a run if a model tries to use a dataset without an approved use, owner, retention rule, or allowed training role.

## Design Storage Boundaries
<!-- section-summary: Storage boundaries separate raw data, feature data, candidate artifacts, approved artifacts, and release evidence. -->

Storage boundaries decide where each asset lives and which identity can touch it. LumaMart separates assets into different buckets and prefixes so one broad permission cannot accidentally cover the whole ML system.

```yaml
storage_boundaries:
  raw_data:
    uri: s3://lumamart-restricted-raw/retail-events/
    readers:
      - data-platform-ingest
      - approved-analytics-breakglass
  training_features:
    uri: s3://lumamart-ml-features/next-best-offer/
    readers:
      - ml-train-next-best-offer
      - personalization-feature-owners
  candidate_artifacts:
    uri: s3://lumamart-ml-artifacts/personalization/next-best-offer/candidates/
    writers:
      - ml-train-next-best-offer
    readers:
      - ml-platform-review
  approved_artifacts:
    uri: s3://lumamart-ml-artifacts/personalization/next-best-offer/approved/
    writers:
      - ml-release-next-best-offer
    readers:
      - offer-serving-prod
  review_evidence:
    uri: s3://lumamart-ml-reviews/personalization/next-best-offer/
    readers:
      - personalization-reviewers
      - security-audit
```

Separating candidate and approved prefixes is important. A training job can write candidate artifacts. A release job moves or copies only approved artifacts into the approved prefix after review. The serving role reads from the approved prefix. This design keeps the training job away from the path that production serving trusts.

![LumaMart storage boundaries for raw events, features, artifacts, and review evidence](/content-assets/articles/article-mlops-governance-and-responsible-ai-securing-training-data-model-artifacts/storage-boundaries.png)
*Separate storage boundaries make read, write, and promotion paths visible before the team writes identity and access management (IAM) policies.*

An S3 bucket policy can enforce basic storage controls such as TLS and server-side encryption with AWS KMS. The exact policy should match your account and key setup, but the shape below shows the idea.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::lumamart-ml-artifacts",
        "arn:aws:s3:::lumamart-ml-artifacts/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    },
    {
      "Sid": "DenyObjectsWithoutKmsEncryption",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::lumamart-ml-artifacts/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    }
  ]
}
```

This bucket policy does two practical things. It rejects plain HTTP access, and it rejects object writes that skip KMS encryption. You still need identity policies for who can read and write specific prefixes. Bucket policy and identity policy work together: one sets storage-wide guardrails, and the other grants scoped access to named roles.

## Least Privilege for Training Jobs
<!-- section-summary: Least privilege gives each training, review, release, and serving identity only the actions and prefixes it needs. -->

Least privilege means the training job receives only the permissions it needs for the current task. For LumaMart, the training role reads feature data, reads secrets needed by the pipeline platform, writes candidate artifacts, and writes logs. It cannot read raw customer dumps, update approved artifacts, change registry aliases, or deploy serving manifests.

Here is a simplified AWS IAM policy for the training role.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOnlyTheApprovedFeatureSnapshot",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::lumamart-ml-features",
      "Condition": {
        "StringLike": {
          "s3:prefix": "next-best-offer/snapshots/2026-06-30/*"
        }
      }
    },
    {
      "Sid": "ReadOnlyTheApprovedFeatureSnapshotObjects",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::lumamart-ml-features/next-best-offer/snapshots/2026-06-30/*"
    },
    {
      "Sid": "WriteCandidateArtifactsForThisRun",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::lumamart-ml-artifacts/personalization/next-best-offer/candidates/run-20260705-53/*"
    },
    {
      "Sid": "WriteTrainingLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:eu-west-2:111122223333:log-group:/ml/training/next-best-offer:*"
    }
  ]
}
```

Several details matter. `s3:ListBucket` applies to the bucket ARN, so its `s3:prefix` condition limits which keys the job can discover. `s3:GetObject` applies to the object ARN for the approved snapshot. Combining both actions in one statement without the prefix condition would let the role list every key in the bucket even though it could read only one snapshot. The write permission targets one candidate run prefix, and a separate release role handles approved artifacts.

The same idea applies in Azure and Google Cloud. Azure Storage supports access through Microsoft Entra ID and Azure role assignments. Google Cloud Storage supports IAM roles at bucket or object scope. The provider names change, yet the security question stays the same: which workload identity can read which data, write which artifact, and promote which version?

Human access should follow the same discipline. Data scientists need enough access to debug features and candidate artifacts, while production artifacts and restricted reports belong behind narrower groups. Break-glass access should require approval and leave audit logs.

## Protect Model Artifacts and Containers
<!-- section-summary: Artifact protection covers hashes, manifests, registry state, immutable images, signatures, and controlled promotion. -->

A model artifact is production software. It may include a serialized model, preprocessing pipeline, feature order file, tokenizer, calibration table, schema, runtime requirements, and evaluation files. LumaMart records artifact identity in a manifest before any release job can promote it.

Serialized models also create a code-execution boundary. Formats based on Python pickle, including many `.pkl` and `joblib` files, can execute code while loading. LumaMart accepts serialized artifacts only from its controlled training pipeline, verifies the manifest and digest before loading, and performs the first load inside an isolated validation job. When the model family supports a data-only format such as ONNX or `safetensors`, the team prefers that format and still validates operators, tensor shapes, and resource limits. A digest proves which bytes arrived; trust in the producer and safe loading controls decide whether those bytes may execute.

```yaml
artifact_manifest:
  model_id: next_best_offer
  version: 53
  classification: production controlled
  source_run_id: mlflow-run-3b48c9
  git_commit: 448bb2a
  training_image: ghcr.io/lumamart/personalization-train@sha256:8b70c4c8d3
  artifact_uri: s3://lumamart-ml-artifacts/personalization/next-best-offer/candidates/run-20260705-53/
  files:
    - path: model/model.onnx
      sha256: 88efda7c7b62a5e0f1d7
    - path: preprocessing/pipeline.pkl
      sha256: 4de00e2f0eaedb7ad3aa
    - path: schema/input_schema.json
      sha256: d5df4ce14271db1f0e12
    - path: evaluation/segment_metrics.csv
      sha256: 30cb6bfc77aaf21798b9
  approved_serving_identity: offer-serving-prod
```

Hashes help detect accidental or malicious changes. If the release job reads `model.onnx` and the hash no longer matches, the job should stop. Versioned object storage and write restrictions make that stronger because they reduce the chance that someone can replace the artifact after review.

Containers need the same discipline. Training and serving images should use immutable digests in deployment manifests. Tags such as `latest` are convenient during local development, yet production release evidence should record the digest. When the organization uses Sigstore Cosign, the build pipeline can sign the container image and the release gate can verify the signature before deployment.

```bash
cosign sign --keyless ghcr.io/lumamart/offer-serving@sha256:ac2f9c84e5

cosign verify \
  --certificate-identity-regexp "https://github.com/lumamart/ml-platform/.github/workflows/release.yml@.*" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/lumamart/offer-serving@sha256:ac2f9c84e5
```

Keyless signing uses an identity from the CI provider instead of a long-lived signing key stored in the repository. Verification ties the image back to an expected workflow identity. The exact command should match your signing policy, registry, and CI provider, yet the release evidence should always include which image digest was built, which workflow built it, and whether signature verification passed.

The model registry should point to approved artifacts and record metadata such as run id, artifact digest, approval packet, and owner. Serving should use the registry or an approved manifest, not a copied path from a notebook. That keeps the production path tied to approval.

## Release Evidence and Audit Logs
<!-- section-summary: Release evidence proves which data, artifact, image, policy, role, and reviewer decision supported production handoff. -->

Security controls need evidence. LumaMart writes a release evidence file for version `53` after approval and before production serving. It gives reviewers and auditors the shortest path through the security story.

```yaml
release_evidence:
  release_id: rel-next-best-offer-2026-07-v53
  model_version: retail_prod.models.next_best_offer/53
  approval_ticket: MLREL-2280
  dataset_manifest: next_best_offer_train_2026_06_30
  artifact_manifest: s3://lumamart-ml-reviews/personalization/next-best-offer/53/artifact_manifest.yaml
  artifact_prefix: s3://lumamart-ml-artifacts/personalization/next-best-offer/approved/53/
  serving_image: ghcr.io/lumamart/offer-serving@sha256:ac2f9c84e5
  image_signature_verified: true
  training_role: arn:aws:iam::111122223333:role/ml-train-next-best-offer
  release_role: arn:aws:iam::111122223333:role/ml-release-next-best-offer
  serving_role: arn:aws:iam::111122223333:role/offer-serving-prod
  bucket_policy_checked_at: 2026-07-05T14:20:00Z
  cloudtrail_query_window: 2026-07-05T12:00:00Z to 2026-07-05T15:00:00Z
```

The release gate can check the evidence and fail if a required piece is missing.

```bash
python tools/check_ml_asset_security.py \
  --artifact-manifest reviews/next_best_offer/53/artifact_manifest.yaml \
  --expected-training-role arn:aws:iam::111122223333:role/ml-train-next-best-offer \
  --expected-serving-role arn:aws:iam::111122223333:role/offer-serving-prod \
  --require-image-signature \
  --require-kms-encryption
```

Audit logs close the loop. On AWS, CloudTrail can show API activity such as object writes, policy changes, and role assumptions. S3 server access logs or CloudTrail data events can help with object-level reads and writes when configured. In a managed ML platform, registry and serving audit records should show who changed aliases, permissions, and endpoint configuration.

The useful investigation questions are concrete:

| Question | Evidence |
| --- | --- |
| Who wrote the candidate artifact? | Training job identity, object write event, run id. |
| Who promoted it to approved storage? | Release role, approval ticket, CI run. |
| Who can read approved artifacts? | Bucket policy, identity policy, access review. |
| Which image served it? | Deployment digest, signature verification, release event. |
| Did any policy change near release? | CloudTrail, platform audit log, ticket comments. |

![Release evidence checklist for LumaMart model version 53](/content-assets/articles/article-mlops-governance-and-responsible-ai-securing-training-data-model-artifacts/release-evidence-v53.png)
*The release gate checks dataset, role, artifact, image, signature, and audit evidence before version `53` reaches approved serving.*

Those answers give the security review a visible path from restricted data to approved artifact to serving runtime.

## Validate The Design And Diagnose Failures
<!-- section-summary: Secure ML asset handling depends on classification, scoped identities, protected storage, artifact integrity, and audit-ready evidence. -->

Use these checks during design or review:

| Check | What good looks like |
| --- | --- |
| Asset inventory | Data, labels, features, artifacts, containers, registry records, and review files are named. |
| Classification | Restricted and production-controlled assets have explicit labels and owners. |
| Storage boundaries | Raw data, features, candidate artifacts, approved artifacts, and review evidence have separate prefixes or buckets. |
| Least privilege | Training, release, serving, and human reviewer identities have separate policies. |
| Artifact integrity | Manifests include file hashes, image digests, and registry version identity. |
| Promotion control | Training jobs cannot write directly to approved production artifact paths. |
| Signing | Production containers have immutable digests, and signature verification runs in the release gate when the organization uses signing. |
| Audit logs | Object writes, policy changes, role assumptions, registry updates, and deployment events are searchable. |

Common mistakes usually come from convenience. A shared `ml-admin` role can read every bucket and update every registry alias. A notebook writes a model directly into the production prefix. A serving deployment uses a mutable image tag. A model review packet contains restricted customer details and lands in a broad wiki. A team protects raw data carefully while leaving derived artifacts open to many users.

Securing ML assets covers the complete chain from training data to the deployed model. Classify assets, create storage boundaries, use least-privilege workload identities, record artifact hashes and image digests, control promotion through registry and release jobs, and keep audit events for data, artifact, and deployment changes.

## References

- [AWS IAM policy examples for Amazon S3](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_examples_s3_rw-bucket.html) - Official AWS examples for scoped S3 read and write policies.
- [Amazon S3 bucket policy examples](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html) - Official AWS examples for bucket policy guardrails.
- [AWS CloudTrail User Guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Official AWS guide for recording account activity.
- [Azure Storage: Authorize access with Microsoft Entra ID](https://learn.microsoft.com/azure/storage/blobs/authorize-access-azure-active-directory) - Official Azure guidance for identity-based access to Blob Storage.
- [Google Cloud Storage IAM](https://cloud.google.com/storage/docs/access-control/iam) - Official Google Cloud guide for Cloud Storage IAM permissions.
- [Sigstore Cosign overview](https://docs.sigstore.dev/cosign/) - Official Cosign documentation for signing and verifying software artifacts.
