### `canary.js`

```javascript
export function validateCheckoutResponse(response, startedAt, now = Date.now()) {
  if (response.statusCode !== 200) throw new Error(`unexpected status: ${response.statusCode}`);
  const contentType = String(response.headers?.["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) throw new Error("expected JSON response");
  const body = JSON.parse(response.body);
  if (typeof body.checkoutId !== "string" || body.checkoutId.length === 0) throw new Error("checkoutId is required");
  if (body.status !== "ready") throw new Error(`checkout is not ready: ${body.status}`);
  return { checkoutId: body.checkoutId, elapsedMs: now - startedAt };
}
```
