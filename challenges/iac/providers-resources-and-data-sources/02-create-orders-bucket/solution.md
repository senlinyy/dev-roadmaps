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

The bucket is now the resource Terraform owns, while the name and tags remain easy to review in locals.
