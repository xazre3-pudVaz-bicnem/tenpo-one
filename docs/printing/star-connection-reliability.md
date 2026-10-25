# Star connection reliability (all stores)

This shared native iOS implementation has no store-specific conditions.

- If SDK discovery returns no Bluetooth printer, consult connected Star MFi accessories without opening pairing. Preserve SDK USB results.
- Reuse the Star SDK connection after successful printing.
- While the native print agent is running and the app is foregrounded, maintain the single saved SDK Star target independently of network job polling. Retry preparation on subsequent 5-second maintenance ticks after a connection failure.
- Suppress status probes for 30 seconds after successful traffic. Print jobs take priority over new probes. Bound status calls to 1 second without shortening print completion timeout.
- Do not cycle multiple configured targets through one shared connection. MFi fallback targets use the existing accessory print path; they are not sent to the SDK keepalive loop.
- Stop maintenance when the print agent stops. Do not force system Bluetooth on, prevent users turning it off, change pairing/security, or claim background availability.
- Never automatically replay a raw print whose completion is uncertain.

## Verification

Run `python3 ios/tools/test_star_session.py` and `python3 ios/tools/test_connection_maintenance.py`.
Tests use fake transports and do not establish physical printer timing or connectivity.

A signed iOS release and actual mC-Print3 acceptance are still required. Website deployment alone cannot ship this change. Test discovery, print twice, idle/resume, printer off/on, Bluetooth off/on, missing paper, and a lost response without duplicate printing. Confirm other POS apps are not holding the selected printer during acceptance.
