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

With the rest of the seeded files unchanged, Preview Plan should show two creates and resolve the bucket name from the variable-backed local.
