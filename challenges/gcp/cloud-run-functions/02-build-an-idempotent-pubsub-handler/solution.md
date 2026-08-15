### `handler.js`

```javascript
export async function handleReceiptEvent(event, dependencies) {
  if (!event?.id || !event?.data?.message?.data) {
    throw new Error('event id and message data are required');
  }

  if (dependencies.processed.has(event.id)) {
    return { duplicate: true };
  }

  const payload = JSON.parse(
    Buffer.from(event.data.message.data, 'base64').toString('utf8')
  );
  await dependencies.receipts.create(payload);
  dependencies.processed.add(event.id);
  return { duplicate: false };
}
```
