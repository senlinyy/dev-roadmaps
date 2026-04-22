`10.0.0.0/16` covers every address from `10.0.0.0` through `10.0.255.255`. Any peer block whose first two octets are `10.0` lives inside that range, no matter what its prefix length is.

---

Use `grep "10.0" /home/dev/vpc/peering-request.txt` to surface only the rows that touch the `10.0.x.x` space. Exactly one row matches, and that is the overlap.
