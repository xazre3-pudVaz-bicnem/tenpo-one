# stera POS connection status — 2026-10-28

## Intended behavior

TENPO ONE sends the current checkout amount to the selected stera terminal;
the terminal completes payment; a verified result returns to TENPO ONE;
checkout is finalized once. Registration alone must not imply connection.

## Evidence reviewed

- SMBC GMO PAYMENT email dated 2026-10-15: SMCC will contact D&DREAM;
  specifications are disclosed after coordination with GMO Financial Gate.
- Follow-up dated 2026-10-19: forwarded to the relevant department; a later
  email or call is expected. No later stera reply was found in the mailbox
  search on 2026-10-28. This does not establish approval or specification access.
- Official POS integration procedure:
  https://www.smbc-card.com/steradevelopers/start/apply.jsp
- Funfo documents automatic amount transfer for supported stera integration:
  https://help.funfo.jp/ja/articles/13741837

## Existing implementation and limits

- Funfo's official 2023-11 setup guide was visually reviewed: its terminal-side
  integration app displays a payment terminal ID; Funfo searches by that ID,
  fills the IP address, then pairs and enables the payment method. This is a
  user setup guide, not a discovery/payment protocol specification:
  https://www.funfo.jp/wp-content/uploads/2023/11/stera-pack%E4%BD%BF%E7%94%A8%E3%82%AB%E3%82%99%E3%82%A4%E3%83%88%E3%82%99.pdf
- Native iPad/iPhone settings use terminal ID as the primary preparation field.
  An empty host requests the future ID-based automatic discovery mode. A manual
  local IPv4 override is optional and collapsed under advanced settings.
  These settings are stored on that device and scoped by server/store/terminal.
  Saving explicitly remains unverified; it does not set the cloud heartbeat or
  mark a LAN connection ready. No network scanning or payment is performed.
- The ID/IP validator passed 23 checks, including ID-only discovery intent,
  private address ranges, malformed addresses, public/loopback addresses, and
  terminal ID length limits. Discovery itself is not implemented or tested.
- Server-side terminal registration, heartbeat, payment request queue, result
  handling, and native checkout controls exist.
- `lib/stera.ts` describes a companion at `android/stera-link`, but that
  directory and a terminal-installable bridge were not found in this checkout.
- That cloud bridge design is not evidence of SMBC/GMO approval, supported
  external POS protocol, terminal configuration, or a tested live connection.
- A missing custom Android bridge is a limitation of the existing cloud design,
  not proof that the direct LAN approach needs a custom terminal application.
  Use the provider's supported integration app and protocol when confirmed.
- Native settings now explain registration versus connection. Automatic
  payment initiation requires an online terminal; an offline terminal cannot
  start a new native request.

## LAN session core added

`ios/Shared/SteraLANEngine.swift` defines an injectable discovery/identity handshake
and payment/status/cancel driver boundary. The default driver is deliberately
unavailable. It contains no guessed network ports, packets, discovery service
names, or production test responses. Adding this source to the app target does
not enable direct LAN payment or replace the existing cloud checkout path.

The session core reserves a stable attempt ID in persistent storage before any
payment send, verifies response terminal/attempt/amount fields, prevents
simultaneous operations within a session, and keeps uncertain outcomes for status
recovery using the original attempt. A final result remains reserved until the
caller has recorded it in the POS system and explicitly acknowledges it. The
file journal must be scoped to one register and shared by all its engine instances.
The actual vendor driver must validate provider responses and enforce transport
timeouts; these are not implemented by this adapter boundary.

The CLI harness `ios/tools/test_stera_lan_engine.swift` passes 19 safety scenarios
under Swift 5 and Swift 6 using only a fake driver: discovery/handshake mismatch,
unavailable production transport, double-send protection, durable restart
recovery, response identity/amount verification, uncertain cancellation,
authoritative results across sessions, storage failure/corruption and shared
journal reservation. Independent review found and fixed a concurrent final-result
race. These tests do not establish real-terminal or full iOS-app compatibility.

## Remaining implementation inputs

The direct LAN transport cannot be implemented from a user setup guide alone.
The missing concrete input is the applicable **簡易POS連動** specification/SDK,
or an authorized observation of a working integration on controlled devices.
The official specification contact route is one possible way to obtain that
interface; this is not a claim that every same-router connection requires new
bank approval, or that competitor source code is needed.

Required interface details for the driver:

1. Terminal-ID discovery transport, destination/service and payload, response
   format, and exact identity verification rules.
2. Supported JT-C60/JT-C61 firmware and terminal integration-app configuration;
   session/pairing handshake and authentication requirements, if any.
3. Payment amount/request fields and stable transaction identifiers; verified
   success/decline/pending response formats and status-query semantics.
4. Timeout, reconnect, cancellation and ambiguous-result behavior; how the
   terminal prevents duplicate collection and reconciles completed payments.
5. Supported test mode and integration validation requirements, if applicable.

After implementing that driver, connect the native setup and checkout flow,
show the observed terminal name/status, durably record verified results in the
POS, and test amount transfer, cancellation, disconnect/reconnect, duplicate
results, and restart after payment succeeds before checkout confirmation.

## Public implementations reviewed

- Smaregi confirms that terminal ID is required and manual IP is unnecessary
  on the same router; it does not disclose discovery messages:
  https://help.smaregi.jp/hc/ja/articles/4410883865369
- SMBC separates POS-only integration from terminal-local Android SDK work:
  https://www.smbc-card.com/steradevelopers/kiyaku/downloads.jsp
- `SeteMares/react-native-stera` and `real9gagger/CouponPosPayReactNative`
  use Android terminal-local PaymentApi/service/activity integration. Neither
  supplies the external iPad LAN protocol.
- BCPOS SteraPos.pdf describes RS-232C settings, not LAN discovery. Timespay's
  terminal network destination list concerns WAN access. Their serial settings
  or external ports must not be substituted for a LAN protocol.

No live payment or provider communication was performed during this review.
No verified direct-LAN driver is currently available in this checkout.
