The provider and locals already exist. Add only the bucket resource in `s3.tf`, and reuse `local.invoice_bucket_name` and `local.common_tags` if you want a shorter resource block.
