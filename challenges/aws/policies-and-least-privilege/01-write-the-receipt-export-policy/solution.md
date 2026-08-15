### `permissions-policy.json`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListReceiptPrefix",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::devpolaris-receipts-prod",
      "Condition": {
        "StringLike": {
          "s3:prefix": "receipts/*"
        }
      }
    },
    {
      "Sid": "WriteEncryptedReceipts",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::devpolaris-receipts-prod/receipts/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "EncryptReceipts",
      "Effect": "Allow",
      "Action": ["kms:Encrypt", "kms:GenerateDataKey"],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555"
    }
  ]
}
```
