Create matching selector and template-label blocks for controller ownership. Build the placement rules inside the Pod template spec.

---

The node selector chooses the app pool. A separate toleration entry lets the trusted agent pass the matching `NoSchedule` taint.
