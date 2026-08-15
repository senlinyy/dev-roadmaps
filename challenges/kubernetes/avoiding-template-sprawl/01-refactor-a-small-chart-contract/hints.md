Start with the public contract. Remove the two environment-specific toggles from `values.yaml`; the remaining values should describe only the inputs the chart consumer actually changes.

---

Define `orders-api.selectorLabels` once in `_helpers.tpl`. It should emit the application label and a release-instance label, then each template can include it with indentation appropriate to its nesting level.

---

The Deployment needs the helper under both `spec.selector.matchLabels` and `spec.template.metadata.labels`. The Service needs it under `spec.selector`.
