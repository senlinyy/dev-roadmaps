RFC 1918 reserves three blocks: `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`. Anything starting with a different first octet is public.

---

Chain three `grep -v` filters together: strip lines starting with `10.`, then `172.`, then `192.168`. Whatever survives is the public block.
