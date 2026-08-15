Cloud Run scaling values are revision annotations. Secret Manager environment variables use `valueFrom.secretKeyRef`, while the runtime identity belongs on the revision spec.
