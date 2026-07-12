Each record type appears as its own column in the zone export. Grepping for the literal type word (`MX`, `CNAME`, `TXT`) pulls every matching row. The SPF record is a `TXT` value that begins with `v=spf1`.

For the address-record inventory, filter the exact `A` field and pipe the result to `wc -l` so `AAAA` does not inflate the count. Then inspect the provider dry-run report and grep for `WARN` and `ERROR`.
