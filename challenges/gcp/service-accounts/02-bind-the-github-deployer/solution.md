### `service-account-policy.json`

```json
{
  "version": 3,
  "bindings": [
    {
      "role": "roles/iam.workloadIdentityUser",
      "members": [
        "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/github/attribute.repository/devpolaris/orders-api"
      ]
    }
  ]
}
```
