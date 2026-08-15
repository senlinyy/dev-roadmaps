### `config.js`

```javascript
export function loadRuntimeConfig(env) {
  if (env.NODE_ENV !== "production") throw new Error("NODE_ENV must be production");
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  if (typeof env.DATABASE_URL !== "string" || env.DATABASE_URL.length === 0) throw new Error("DATABASE_URL is required");
  if (typeof env.PAYMENTS_API_TOKEN !== "string" || env.PAYMENTS_API_TOKEN.length === 0) throw new Error("PAYMENTS_API_TOKEN is required");
  return {
    config: {
      nodeEnv: env.NODE_ENV,
      port,
      databaseUrl: env.DATABASE_URL,
      paymentsApiToken: env.PAYMENTS_API_TOKEN
    },
    summary: {
      nodeEnv: env.NODE_ENV,
      port,
      databaseUrlPresent: true,
      paymentsApiTokenPresent: true
    }
  };
}
```
