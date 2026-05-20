Click Preview Plan before editing the files. The panel should show `aws_s3_bucket.preview` and `aws_s3_bucket_public_access_block.preview` as creates.
---
The bucket name comes from `local.bucket_name`, which interpolates `var.environment`.
---
After changing the variable default to `staging`, the preview should show `dp-preview-staging-artifacts`.
