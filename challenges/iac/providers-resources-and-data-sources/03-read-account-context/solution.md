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

### s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-orders-invoices-prod"

  tags = {
    service     = "devpolaris-orders"
    environment = "prod"
    owner       = "platform"
  }
}
```

### data.tf

```hcl
data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
```

### locals.tf

```hcl
locals {
  service_name = "devpolaris-orders"
  account_id   = data.aws_caller_identity.current.account_id
  region       = data.aws_region.current.name
}
```

### outputs.tf

```hcl
output "deployment_context" {
  value = "${local.service_name}:${local.account_id}:${local.region}"
}
```

The data sources read existing AWS context without making the account or region managed resources.
