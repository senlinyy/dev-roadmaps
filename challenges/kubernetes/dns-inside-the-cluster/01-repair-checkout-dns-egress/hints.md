Build the policy from the caller outward: select the protected Pods, declare the traffic direction, then define the allowed destination and ports.

---

The namespace and Pod labels must narrow one destination together, not create two independent destinations.

---

DNS needs two separate port entries because clients may use either UDP or TCP on port `53`.
