`nginx -t` always tells you the exact file and line — never guess. `grep -n` in the conf file confirms `proxy_passs` is on line 14. The 502s in the access log are the user-visible impact of leaving the v2 upstream broken.

Note: the runtime can't actually run `nginx -t`, so the validator output is pre-saved as a file you `cat`.
