### `endpoint-policy.json`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListExportBucket",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::devpolaris-exports-prod"
    },
    {
      "Sid": "ReadWriteExportPrefix",
      "Effect": "Allow",
      "Principal": "*",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::devpolaris-exports-prod/exports/*"
    }
  ]
}
```
