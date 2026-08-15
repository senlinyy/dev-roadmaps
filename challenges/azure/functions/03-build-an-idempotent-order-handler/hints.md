Check the processed-event set before calling the side effect. Add the event ID to the set only after `orders.create` resolves so a failed attempt can be retried.
