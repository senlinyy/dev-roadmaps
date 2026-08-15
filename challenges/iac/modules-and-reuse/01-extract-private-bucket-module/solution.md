### modules/private-bucket/variables.tf

```hcl
variable "bucket_name" {
  type = string
}
```

### modules/private-bucket/main.tf

```hcl
resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

### modules/private-bucket/outputs.tf

```hcl
output "bucket_id" {
  value = aws_s3_bucket.this.id
}
```

### live/prod/main.tf

```hcl
module "logs" {
  source      = "../../modules/private-bucket"
  bucket_name = "dp-orders-logs-prod"
}
```

### live/prod/outputs.tf

```hcl
output "logs_bucket_id" {
  value = module.logs.bucket_id
}
```

The child module has one job and the root module owns environment-specific naming and composition.
