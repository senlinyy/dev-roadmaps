### `checkout-failure.kql`

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated between (datetime(2026-05-07T09:35:00Z) .. datetime(2026-05-07T09:50:00Z))
| where OperationId == "checkout-5001"
| project TimeGenerated, OperationId, ResultCode, SeverityLevel, Message, _ResourceId
| order by TimeGenerated asc
```
