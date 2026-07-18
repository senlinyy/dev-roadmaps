### main.tf

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "eu-west-2"
}
```

The resource consumes the shared name and tags, keeping environment decisions in locals instead of duplicating them inside the bucket block.

### locals.tf

```hcl
locals {
  invoice_bucket_name = "dp-orders-invoices-prod"
  common_tags = {
    service     = "devpolaris-orders"
    environment = "prod"
    owner       = "platform"
  }
}
```

### s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = local.invoice_bucket_name
  tags   = local.common_tags
}
```
