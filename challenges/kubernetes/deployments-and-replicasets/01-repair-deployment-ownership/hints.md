Construct the selector and Pod template as sibling structures under the Deployment spec. The selector label map and template label map need the same application name and component.

---

The Pod template needs both metadata for labels and a spec for its container list. Container details belong inside the first item in that list.
