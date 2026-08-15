### `trust-policy.json`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GitHubRelease",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:devpolaris/orders-api:ref:refs/heads/main"
        }
      }
    }
  ]
}
```
