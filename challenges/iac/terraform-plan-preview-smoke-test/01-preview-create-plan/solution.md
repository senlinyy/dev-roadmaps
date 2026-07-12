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
