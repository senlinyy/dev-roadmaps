### logs.tf

```hcl
variable "enable_log_archive" {
  type    = bool
  default = false
}

resource "aws_s3_bucket" "log_archive" {
  count  = var.enable_log_archive ? 1 : 0
  bucket = "dp-orders-log-archive"
}

resource "aws_s3_bucket_public_access_block" "log_archive" {
  count  = var.enable_log_archive ? 1 : 0
  bucket = aws_s3_bucket.log_archive[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

The configuration creates either the complete protected archive or no archive, never a half-configured dependent resource.
