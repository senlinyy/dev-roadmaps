Start with one label contract. The Deployment selector, Pod template label, and PodDisruptionBudget selector all need to identify the same orders API Pods.

---

The readiness probe belongs on container `api`. Use the named container port so the health contract does not repeat a numeric target in two places.

---

With three replicas, `minAvailable: 2` permits one voluntary eviction while requiring two matching Pods to remain available.
