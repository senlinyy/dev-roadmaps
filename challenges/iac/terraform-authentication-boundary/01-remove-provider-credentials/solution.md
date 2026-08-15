### providers.tf

```hcl
provider "aws" {
  region = "eu-west-2"

  default_tags {
    tags = {
      Service   = "orders"
      ManagedBy = "terraform"
    }
  }
}
```

The provider now uses the standard credential chain and contains only non-secret target configuration.
