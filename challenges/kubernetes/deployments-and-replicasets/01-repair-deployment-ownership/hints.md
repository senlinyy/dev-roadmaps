Treat the two tabs as one release contract. The ConfigMap needs a `data` mapping, while the Deployment needs the controller selector and Pod template under `spec`.

---

The selector labels must be a subset of the Pod template labels. Import all ConfigMap keys with an `envFrom` item containing `configMapRef.name`.
