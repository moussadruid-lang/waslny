# مشاوير — Mobile apps (Phase 2)

Two Expo (React Native) apps sharing `packages/mobile-core`:

| App | Folder | Package id | Scheme |
|---|---|---|---|
| مشاوير (العميل) | `apps/mobile-customer` | `eg.mashawir.app` | `mashawir://` |
| مشاوير مندوب | `apps/mobile-driver` | `eg.mashawir.driver` | `mashawir-driver://` |

Everything is wired to the real API — no mock data. Prices, statuses, dispatch, proofs and money are all decided by the server.

## Run locally
```bash
# 1) backend (see README): postgres + redis + API + worker
npm run dev & npm run worker &

# 2) apps (from repo root)
npm install
npx expo install --fix --cwd apps/mobile-customer   # aligns native module versions with the installed Expo SDK
npx expo install --fix --cwd apps/mobile-driver
cp apps/mobile-customer/.env.example apps/mobile-customer/.env   # set EXPO_PUBLIC_API_URL to your LAN IP on a real phone
cp apps/mobile-driver/.env.example apps/mobile-driver/.env
npx expo run:android --cwd apps/mobile-customer      # dev build (maps + background GPS need a dev build, not Expo Go)
npx expo run:android --cwd apps/mobile-driver
```
Set `PUBLIC_FILES_BASE_URL` in `apps/api/.env` to an address the phone can reach (e.g. `http://192.168.1.10:4000/files`).
In development `SMS_PROVIDER=console` returns the OTP to the app (`devCode`) — blocked in production.

APKs for testers: `eas build -p android --profile preview` in each app folder.

## What's inside
**Customer**: Splash → OTP login/register (+ referral) → Home (أرسل شحنتك الآن / من؟ / إلى أين؟, saved-address shortcuts, active orders, shortcuts) →
New delivery in 4 steps (map pin / GPS / search / saved / manual address + description + landmark + recipient + instructions + place photo →
category, size, weight, vehicle filtered by capacity, package photo → now/urgent/scheduled → **server quote** with line items, coupon, cash/wallet) →
Live order (map, driver marker over WebSocket, ETA, progress, timeline, call (phone only revealed during the order), chat, share public tracking link, cancel with reason, rate with reasons, proof of delivery) ·
My Orders (current/completed/cancelled/failed/returned/all, search, infinite scroll) · Addresses CRUD · Wallet ledger · Notifications history + deep links ·
Coupons & referral · Support tickets with attachments · Profile, notification preferences, logout-all, delete account.

**Driver**: OTP login → onboarding (national ID, vehicle, document photos) → pending/rejected/suspended states →
Online toggle (background GPS foreground-service, buffered upload) → live offers (push + socket + polling, countdown, **atomic accept** — loser sees "تم قبول الطلب من مندوب آخر") →
Order execution step-by-step (going → arrived → picked up (+photo) → in delivery → arrived) with navigation hand-off and calls →
Proof of delivery (OTP / name / photo / signature / GPS, per admin settings) → rate customer · Failed delivery with configured reasons · Returns · Release ·
Multi-stop "next stop" from the server route optimizer · Earnings (cash collected, owed to platform, commission, settlements) · History · Support.

## Engineering rules
- **Safe area everywhere**: every screen is a `Screen` (SafeAreaView). Tab screens use top edges (tab bar owns the bottom); stack screens include bottom; modals have their own SafeAreaView. Toasts and the offline banner are offset by insets.
- **RTL**: forced at native level (`extra.supportsRTL/forcesRTL`) and at runtime (`ensureRTL`). We never hardcode `textAlign: 'right'`; start/end are used so layouts flip correctly.
- **States**: every data screen renders Loading / Empty / Error / Offline / Timeout with Retry via `StateView`. Server 5xx → "تعذر تنفيذ العملية، حاول مرة أخرى" — raw errors never reach users.
- **Auth**: tokens in SecureStore, single-flight refresh rotation, automatic logout on revoked sessions.
- **Offline driver**: `src/offlineQueue.ts` persists actions + proof files and replays in order; server idempotency (same-status no-op, proof `clientId`) prevents duplicates; rejected stale actions are surfaced to the driver.
- **No secrets in apps**: only public URLs and a package-restricted Maps SDK key.

## Device QA checklist (run before release)
- [ ] Small Android (5", 720p), large (6.7"), notch/punch-hole, gesture nav and 3-button nav: nothing under status bar/notch/nav bar; keyboard never hides the primary button.
- [ ] RTL: icons/arrows, chips, lists, inputs, chat bubbles.
- [ ] Airplane mode on every list screen → offline state + retry works.
- [ ] Driver: go online, lock phone 10 min → location keeps updating on Live Ops; kill app → foreground service notification remains.
- [ ] Driver: complete pickup + delivery in airplane mode → reconnect → order becomes DELIVERED once, wallet updated once.
- [ ] Two drivers accept the same offer simultaneously → exactly one wins.
- [ ] Full scenario دمرو → سيدي سالم from both phones, then verify in Admin + reports.
