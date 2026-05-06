### main.tf

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket = "dp-terraform-state-prod"
    key    = "devpolaris-orders/prod/terraform.tfstate"
    region = "eu-west-2"
  }
}

provider "aws" {
  region = "eu-west-2"
}
```

### s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-devpolaris-orders-prod-invoices"
}
```

The backend block lives in Terraform settings because Terraform needs state location before it can safely work with the rest of the module.
