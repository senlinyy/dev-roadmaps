Build the destination boundary first: the policy-level selector chooses protected Pods, and the policy type declares ingress isolation.

---

Then build one ingress rule. A namespace selector and Pod selector in one peer item require the same source to satisfy both conditions.

---

The rule's port list evaluates the destination Pod port, which is `8080` for this API.
