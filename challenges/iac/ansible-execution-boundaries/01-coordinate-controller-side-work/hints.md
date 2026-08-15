1. The release lookup is global, so delegate it to localhost and run it once.
2. Use delegated facts while looping over the managed hosts to attach the shared value to each host.
3. The drain call is controller-side but still per host, so it must not use run_once.
