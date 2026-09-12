# Map motion and optional road estimates

This describes the client implementation in `services/positionSmoothing.ts`,
`hooks/useMapLocation.ts`, `services/routing.ts`, `services/travelCalibration.ts`,
`hooks/useTravelEstimates.ts`, and `components/DirectionsSheet.tsx`.

## Online routing configuration and consent

Opening Directions computes distance-based estimates locally. No routing provider
is enabled by default. When a provider is configured, the sheet names its hostname
and explains that **both the current location and destination** will be shared.
Only tapping **Check road routes** enables those requests. Consent resets when the
sheet closes or the destination changes; it is not a saved account-wide setting.
Opening Apple Maps or Google Maps is a separate explicit action. These boundaries
describe directions requests, not unrelated map tiles or existing location sharing.

| Build-time environment variable | Enabled mode | Appended OSRM profile |
| --- | --- | --- |
| `EXPO_PUBLIC_ROUTING_DRIVE_URL` | Driving | `driving` |
| `EXPO_PUBLIC_ROUTING_WALK_URL` | Walking | `foot` |
| `EXPO_PUBLIC_ROUTING_BICYCLE_URL` | Cycling | `bike` |
| `EXPO_PUBLIC_ROUTING_URL` | Legacy fallback for driving only | `driving` |

Set a base URL, without `/route/v1/...`. An explicit driving variable takes
precedence over the legacy one; an invalid explicit value disables driving.
Walking and cycling require deployments prepared for those modes: changing a URL
profile label does not change the underlying road graph. OSRM determines the
transport profile when extracting its data. [OSRM API documentation](https://project-osrm.org/docs/v5.24.0/api/#general-options)

Only HTTPS bases with an ASCII DNS name or IPv4 address, optional port, and path
are accepted. User information, query strings, fragments and malformed hosts are
rejected. Public Expo variables are shipped in the app: **never put secrets in
these URLs or variables**. Keep provider credentials on a controlled server proxy.
That proxy needs an appropriate routing deployment, capacity, retention policy
and coordinate-safe logging. No provider is provisioned by this client change.

Requests use the routing client directly, without the app API's authorization
interceptor. Native fetch is asked to omit credentials, caching and redirects;
redirected responses are rejected. Serve the endpoint directly: a native transport
that follows a redirect may already have disclosed coordinates before rejection.

## Request lifecycle and estimates

Origin acquisition checks the existing location permission and accepts fixes no
older than two minutes with reported accuracy at most 100 metres. It tries the
last known fix, then a Balanced-accuracy current fix. Each asynchronous permission
or location operation has a 15-second waiting limit; this is not a 15-second cap
on the entire sequence. The directions hook does not install a GPS watcher.

Configured road modes refine concurrently after consent. Unsupported modes,
including transit, keep local estimates. Closing, backgrounding or changing the
request cancels subscribers and ignores late results. Provider failure preserves
the local estimate. The provider's distance and duration are predictions, not
measurements of a completed personal trip. Displayed times retain the app's
estimated preparation/parking overhead and rounding. This integration has no live
traffic, closure feed or transit timetable routing; a configured OSRM road route
must not be described as a live transit prediction.

The routing service applies these bounds:

- Six-second network/response deadline, including a transport that ignores abort.
- At most eight distinct requests in flight; identical requests share one job.
- An LRU memory cache of at most 64 entries: successful routes expire after five
  minutes; failures have a 15-second retry backoff. There is no retry loop.
- Exact endpoint/mode cache keys stay in memory, never in this client's disk
  cache or logs. One expiry timer replaces polling. Expired entries and entries
  created after a backward clock correction are rejected on access.
- Each subscriber cancels independently. The last cancellation aborts the shared
  request; cancellation is not cached as a failure.
- `clearRouteCache()` aborts pending work and clears retained routes at sign-out.

Responses need HTTP success, OSRM `code: "Ok"`, and finite positive numeric metres
and seconds. Display logic additionally rejects gross speed/profile inconsistencies
and routes substantially shorter than the straight-line distance. These checks do
not establish provider data quality or guarantee arrival-time accuracy.

## Local calibration

`travelCalibration.ts` stores version 2 aggregates in AsyncStorage under
`aura:travel:calibration`. They adjust the distance model using prior **provider
route predictions**, not observed personal journeys or driving behaviour.

- Scope is transport mode, a coarse 0.5-degree origin region, and straight-line
  distance band: 200 m–<2 km, 2 km–<10 km, or 10 km–50 km. Outside those distances,
  the local adjustment is not used.
- At most 24 region/band buckets are retained. Rows expire after 14 days; future
  timestamps and invalid values are rejected. Expired rows are ignored and pruned
  during hydration or later updates, rather than by a disk-cleanup timer.
- Two accepted samples are needed before applying an adjustment. New observations
  have a 25% moving-average weight. Bounds reject implausible detours and speeds.
- Cached route objects and a bounded in-memory endpoint key set suppress repeat
  learning. This is not permanent deduplication across app restarts.
- Disk records contain aggregate ratios, counts, timestamps and coarse region
  keys; they do not contain precise endpoints, route geometry or destination
  history. The region keys still convey broad location context.
- `resetTravelCalibration()` clears memory and disk on sign-out. Serialized writes
  and generation checks prevent earlier pending writes restoring the old state.

## Position drawing and follow camera

The map uses one foreground location watcher with Balanced accuracy and a 10-metre
distance interval. It stops on map blur, app backgrounding or permission loss.
The separately consented background-sharing task keeps its own lifecycle.

The drawing store emits at a 66 ms interval (about 15 Hz) only while a glide is
active, the map is active, Reduce Motion is off, and a consumer is subscribed.
It stops at the target and when suspended or unsubscribed. Glide duration follows
the measured fix cadence, smoothed and clamped to 120–2,500 ms; a long gap resets
the cadence estimate. A jump over **400 metres** snaps immediately. Interpolation
crosses the date line by the short path, rejects invalid/out-of-order fixes, and
uses monotonic elapsed time for animation. It does not predict an unseen journey;
the displayed position can trail the latest fix during a glide.

Acquisition ordering restarts with each foreground tracking session and after a
detected wall-clock correction. This preserves the displayed marker, rejects late
one-shot reads from the previous clock generation, and prevents a clock rollback
from freezing new positions. Newly delivered fixes more than 30 seconds away from
the current wall time are rejected; an already accepted stationary fix stays drawn.

The self marker subscribes to that store. Follow mode streams `setCamera` centres
without changing zoom, pitch or heading, rather than re-rendering the complete
map for each drawing tick. An explicit locate/recenter uses 450 ms, then streamed
centres resume; Reduce Motion requests an immediate move. Panning releases follow
mode and cancels a pending locate's claim on the camera. Smoothing changes drawing
only; it does not add location uploads or alter sharing precision.

## Review verification — 12 September 2026

The final local source was checked against the declared and installed Expo 54.0.37
runtime (the declared range is `~54.0.37`):

- Full Jest run: **48 suites / 757 tests passed**. This includes 232 tests across
  the seven directions, calibration, routing, smoothing and map-lifecycle suites.
- ESLint passed on the reviewed implementation, its tests and the map screen.
  A repository-wide check of 254 files found zero `react-hooks/exhaustive-deps`
  violations.
- `tsc --noEmit --pretty false` still reports the 25 documented, pre-existing
  errors in `swiftLocationPrivacy.test.tsx` and `swiftsFeedPlayback.test.tsx`.
  It reports no additional errors in this review's changes; the repository is
  therefore not described as having a clean TypeScript check.
- Offline Expo export for both `ios` and `android` completed successfully with
  production Hermes bundles. This verifies bundling, not a native EAS build or
  a physical-device test. No deployment or live routing request was performed.

One correction to the original explanation: a 450 ms camera animation completes
before the next fix at a steady 600 ms cadence. Bursty fixes can overlap animations;
streaming smoothed centres also removes pauses between separated animations.
Neither the assumed GPS cadence nor reduced battery use has been measured here.

## Manual checks before release

Run these on both iOS and Android development/release builds; mocked tests cannot
establish native camera behaviour, GPS quality, energy use or frame rate.

1. With all provider variables absent, open/reopen Directions and change modes.
   Confirm useful local estimates and no routing requests. With providers set,
   confirm the hostname disclosure and zero routing requests until the button is
   tapped. Close/reopen or switch destinations and confirm consent resets.
2. Test each configured mode against its intended deployment. Simulate failure,
   slow responses, invalid responses and cancellation. Confirm fallback estimates,
   no stale result from a previous destination, and no automatic retry flood.
3. Leave the sheet open before requesting a route; verify an expired origin is
   refreshed rather than sent. Test denied/revoked permission, stale or inaccurate
   fixes, backgrounding and returning from Settings.
4. Sign out during a route request and during a calibration save; sign into another
   account and confirm no previous routes or local calibration are restored.
5. Observe walking, driving, stationary GPS drift, irregular/burst fixes and a
   long GPS gap. Confirm the marker settles, large relocks snap, and the locate
   zoom completes before follow updates. Pan/zoom during a pending locate.
6. Switch tabs, lock/background the device and resume. Confirm the foreground
   watcher and drawing stop, late callbacks cannot seize the camera, and resuming
   does not replay a long glide from an old position.
7. Change the device clock forward/backward during recentering and while moving.
   Check both animation deadlines and acceptance of newly timestamped fixes;
   monotonic drawing alone does not validate platform location timestamp changes.
8. Enable Reduce Motion before opening the map and toggle it mid-glide. Check
   immediate marker/camera updates, focus transitions and VoiceOver/TalkBack
   labels for the locate and online-routing controls.

No device performance, battery, routing-accuracy or production-capacity improvement
has been measured by this implementation review. Record those measurements and
provider operational checks separately before making release claims.
