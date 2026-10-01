# مشاوير — Architecture & Delivery Plan

## 1. Repo audit (before code)
The GitHub repo was **empty** (no commits). Per brief §2, the platform is built from scratch.

## 2. Stack decisions (and why)
| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript end-to-end | One language for API, mobile, dashboards; shared domain types |
| Monorepo | npm workspaces: `packages/domain`, `apps/api`, later `apps/mobile-customer`, `apps/mobile-driver`, `apps/dashboard` | Shared business rules, single CI |
| API | Express + Zod | Stable, minimal, easy to hire for |
| DB | PostgreSQL + Prisma | Transactions + row locks for atomic accept & ledger; strong typing |
| Jobs | BullMQ on Redis | Dispatch waves, push, SMS, webhooks, bulk, scheduled orders |
| Realtime | Socket.IO + Redis adapter | Horizontal scaling; rooms per order/driver/ops/public-track |
| Mobile (Phase 2) | Expo (React Native) | Android first, `react-native-safe-area-context`, RTL via `I18nManager.forceRTL`, Expo push, offline SQLite queue |
| Dashboards (Phase 3) | Next.js (RTL, Tailwind) | Admin, Dispatcher Live Ops map, Business portal |
| Maps | Provider interface (`haversine` → `osrm` → `google`) via env | Swap without rebuilding apps (§67) |

## 3. Key design rules
- **Money is integer piasters.** No floats anywhere in finance.
- **Price is computed only on the server** (`buildQuote`). Client totals are ignored (§12).
- **Pricing is data, not code.** `PricingRule` rows scoped by governorate/city/area/vehicle; most-specific wins. No `if city == ...` (§13).
- **Geography is a tree** (`GeoUnit`: governorate → city → district → village → area) fully admin-managed. All 27 governorates seeded; launch area active (§14, §75).
- **Status changes go through one function** (`transition`) that validates against the state machine, uses optimistic locking (`version`), and writes `OrderStatusHistory` with actor + GPS (§15–16).
- **Atomic accept** = two guarded `updateMany` inside one transaction (order still `SEARCHING_DRIVER` & unassigned; driver under capacity). Loser → 409 (§21).
- **DELIVERED is only reachable via proof-of-delivery** endpoint enforcing configured requirements (OTP/photo/signature/name/GPS radius) (§24).
- **Ledger**: every money movement is a `WalletTransaction` with `balanceAfter` + `idempotencyKey`. COD: driver wallet −cash collected +earning ⇒ negative balance = owed to platform. Settlements post positive entries (§34–37).
- **Offline-safe driver actions**: idempotent status updates, `clientId` on proofs, batched location uploads (§56).
- **Privacy**: public tracking returns no phones, rounded stop coordinates, driver position only while en route (§28, §68).
- **Errors**: stable codes + Arabic messages; internals logged (pino, redaction), never returned (§61).

## 4. Order state machine
```
NEW → SEARCHING_DRIVER → DRIVER_ASSIGNED → DRIVER_GOING_TO_PICKUP → DRIVER_ARRIVED_PICKUP
    → PACKAGE_PICKED_UP → IN_DELIVERY → DRIVER_ARRIVED_DESTINATION → DELIVERED
IN_DELIVERY / ARRIVED_DESTINATION → FAILED_DELIVERY → (retry) IN_DELIVERY | RETURNING → RETURNED
pre-pickup → CANCELLED (actor-dependent);  assigned states → SEARCHING_DRIVER (release/reassign)
```
Each edge declares which actors may take it (`packages/domain/src/orderStateMachine.ts`).

## 5. Dispatch
Wave `n` offers the order to the best `waveSize` eligible drivers within `radiiKm[n]` (approved, online, fresh GPS, under capacity, right vehicle/weight, serves area), scored by distance, rating, acceptance rate, load. Offers expire after `offerTimeoutSec`; next wave expands. After `giveUpAfterWaves`, ops gets an alert and the order shows 🔴 on Live Ops for manual assignment. All knobs live in `Setting.dispatch`.

## 6. Roles
SUPER_ADMIN, ADMIN, OPERATIONS (dispatcher), FINANCE, SUPPORT, DRIVER, CUSTOMER, BUSINESS — permission codes in `prisma/seed.ts`, enforced by `requirePerm`. Sensitive actions write `AuditLog` (§59).

## 7. Roadmap
- **Phase 1 (done)**: domain engine, schema, full API, jobs, realtime, tests.
- **Phase 2**: Customer app + Driver app (Expo): Splash/OTP/Home/New Delivery (map + GPS + saved + manual + landmark)/Current Order live map/My Orders tabs/Addresses/Wallet/Notifications/Coupons/Support/Account; driver onboarding docs, online toggle, offer sheet w/ countdown, navigation handoff, proof capture (camera/signature/OTP), offline queue. Safe-area + RTL tested on small/large/notch Android.
- **Phase 3**: Next.js Admin (orders, drivers, customers, geo tree editor, pricing rules, coupons, finance/settlements, tickets, reports, audit) + **Live Ops map** (🟢🔵🟠🔴) + Business portal (bulk CSV/XLSX upload w/ row errors, COD statement, staff, branches, API keys).
- **Phase 4**: Paymob/Fawry/mobile-wallet `PaymentProvider` adapters, number masking (proxy calls), loyalty points, Sentry + Grafana dashboards, PITR backups, staging/prod pipelines.

## 8. Ops & security checklist
Helmet, CORS allow-list, global + OTP + per-API-key rate limits, JWT access (15m) + rotating refresh sessions, hashed OTPs/API keys/refresh tokens (HMAC + pepper), env-validated config that refuses dev SMS in prod, GPS-jump fraud signals, coupon per-user limits, idempotent ledger. Backups: managed Postgres with PITR + daily logical dumps to object storage; restore drill monthly.
