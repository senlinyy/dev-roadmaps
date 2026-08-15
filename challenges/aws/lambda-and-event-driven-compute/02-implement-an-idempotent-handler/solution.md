### `handler.js`

```javascript
export function createHandler({ store, publisher }) {
  return async function handler(event) {
    if (typeof event?.eventId !== "string" || event.eventId.length === 0) throw new Error("eventId is required");
    const claimed = await store.claim(event.eventId);
    if (!claimed) return { processed: false, duplicate: true, eventId: event.eventId };
    try {
      await publisher.publish(event);
      return { processed: true, duplicate: false, eventId: event.eventId };
    } catch (error) {
      await store.release(event.eventId);
      throw error;
    }
  };
}
```
