### variables.tf

```hcl
variable "environment" {
  default = "staging"
}

locals {
  bucket_name = "dp-preview-${var.environment}-artifacts"
  common_tags = {
    service     = "plan-preview"
    environment = var.environment
    managed_by  = "devpolaris"
  }
}
```

### s3.tf

```hcl
resource "aws_s3_bucket" "preview" {
  bucket = local.bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "preview" {
  bucket                  = aws_s3_bucket.preview.bucket
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

### outputs.tf

```hcl
output "bucket_name" {
  value = aws_s3_bucket.preview.bucket
}
```

The input drives one local name, both resources share that identity through references, and the output follows the managed bucket attribute. The four public access settings make the intended private boundary explicit in the preview.
