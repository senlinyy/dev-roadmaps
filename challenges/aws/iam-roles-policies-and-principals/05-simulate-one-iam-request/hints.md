Use role ARN `arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-task-role`, action `s3:PutObject`, approved object ARN `arn:aws:s3:::devpolaris-orders-exports-prod/orders-api/daily.csv`, and unapproved object ARN `arn:aws:s3:::devpolaris-orders-exports-prod/manual-backups/daily.csv`.

---

You can pass both resource ARNs to one IAM simulation request so the output compares them together.

---

Use IAM policy simulation for the role, action, and both S3 object ARNs. The result should make the approved object differ from the unapproved object.
