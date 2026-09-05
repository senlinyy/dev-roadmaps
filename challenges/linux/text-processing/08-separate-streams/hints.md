Standard output is descriptor 1 and standard error is descriptor 2. Redirect each to its own destination.

---

Appending preserves the previous attempt. For the combined capture, duplicate stderr onto stdout before sending stdout through the pipe.
