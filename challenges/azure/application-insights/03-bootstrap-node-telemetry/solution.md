### `telemetry.js`

```javascript
const { useAzureMonitor } = require('@azure/monitor-opentelemetry');

useAzureMonitor({
  azureMonitorExporterOptions: {
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  },
  resource: {
    serviceName: 'devpolaris-orders-api'
  }
});
```

### `server.js`

```javascript
require('./telemetry');
require('./app');
```
