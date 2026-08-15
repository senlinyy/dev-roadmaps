### `orders-runtime-reader.json`

```json
{
  "Name": "Orders Runtime Reader",
  "IsCustom": true,
  "Description": "Inspect the orders runtime without changing it",
  "Actions": [
    "Microsoft.Web/sites/read",
    "Microsoft.Web/sites/config/list/action",
    "Microsoft.OperationalInsights/workspaces/query/read"
  ],
  "NotActions": [],
  "DataActions": [],
  "NotDataActions": [],
  "AssignableScopes": [
    "/subscriptions/sub-prod/resourceGroups/rg-orders-prod"
  ]
}
```
