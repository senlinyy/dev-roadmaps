```bash
az group create --name rg-devpolaris-orders-prod-eastus --location eastus --tags service=orders-api env=prod region-plan=primary
```

The resource group now records the chosen production region and carries tags that make the placement visible in inventory.
