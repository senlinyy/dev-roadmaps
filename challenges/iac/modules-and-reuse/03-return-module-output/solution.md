### modules/private-bucket/outputs.tf

```hcl
output "bucket_name" {
  description = "Name of the created S3 bucket."
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "ARN of the created S3 bucket for IAM policies."
  value       = aws_s3_bucket.this.arn
}
```

Returning the resource ARN gives root modules a stable handoff point for IAM policies without rebuilding provider strings.
