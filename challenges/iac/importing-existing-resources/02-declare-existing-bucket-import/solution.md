### audit.tf

```hcl
import {
  to = aws_s3_bucket.audit
  id = "dp-security-audit-prod"
}

resource "aws_s3_bucket" "audit" {
  bucket = "dp-security-audit-prod"
}
```

Configuration and import intent arrive in the same review, making the first reconciliation plan explainable.
