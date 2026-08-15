### `handler.js`

```javascript
export async function handleEvent(event, dependencies) {
  if (!event?.id) {
    throw new Error('event id is required');
  }

  if (dependencies.processed.has(event.id)) {
    return { duplicate: true };
  }

  await dependencies.orders.create(event.data);
  dependencies.processed.add(event.id);
  return { duplicate: false };
}
```
