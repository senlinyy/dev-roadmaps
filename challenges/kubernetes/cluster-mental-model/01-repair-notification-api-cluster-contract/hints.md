Start with the ownership relationship. Every key and value in the Deployment selector must also appear in the Pod template labels.

---

Readiness and resources belong inside container `api`. The HTTP check uses the existing named port instead of repeating its number.

---

Requests describe the capacity needed for scheduling. Limits describe the runtime ceiling.
