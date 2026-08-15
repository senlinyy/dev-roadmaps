### `table-input.json`

```json
{
  "TableName": "orders",
  "BillingMode": "PAY_PER_REQUEST",
  "AttributeDefinitions": [
    { "AttributeName": "pk", "AttributeType": "S" },
    { "AttributeName": "sk", "AttributeType": "S" },
    { "AttributeName": "gsi1pk", "AttributeType": "S" },
    { "AttributeName": "gsi1sk", "AttributeType": "S" },
    { "AttributeName": "idempotencyKey", "AttributeType": "S" }
  ],
  "KeySchema": [
    { "AttributeName": "pk", "KeyType": "HASH" },
    { "AttributeName": "sk", "KeyType": "RANGE" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "customer-status-created-index",
      "KeySchema": [
        { "AttributeName": "gsi1pk", "KeyType": "HASH" },
        { "AttributeName": "gsi1sk", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    },
    {
      "IndexName": "idempotency-index",
      "KeySchema": [
        { "AttributeName": "idempotencyKey", "KeyType": "HASH" }
      ],
      "Projection": { "ProjectionType": "KEYS_ONLY" }
    }
  ],
  "SSESpecification": { "Enabled": true, "SSEType": "AES256" }
}
```
