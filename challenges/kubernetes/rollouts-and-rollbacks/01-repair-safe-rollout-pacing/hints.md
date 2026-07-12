Construct the update strategy, readiness window, and progress deadline directly under the Deployment spec. The strategy needs a type and a nested pacing block, while the image change stays inside the Pod template.

---

The safe pacing contract adds one temporary Pod without allowing the available count to fall below the desired three.
