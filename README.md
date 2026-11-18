# Smart Utility Meter

ESP32 prepaid energy + water meter with an Express.js + Supabase backend.

```
Smart_Utility_Meter/
├── backend/                  Express.js API (admin + consumer + meter)
│   ├── supabase/schema.sql   Database: tables, billing functions, security
│   ├── scripts/create-admin.js
│   └── src/
└── firmware/
    └── smart_meter/smart_meter.ino
```

## How the system works

1. **Admin** creates a consumer → the backend creates a meter and returns `meter_id` + `device_key`.
2. `METER_ID` and `DEVICE_KEY` are hard-coded in `smart_meter.ino` and flashed to that consumer's ESP32.
3. **Consumer** logs in (phone or meter ID + password) and submits a recharge (bKash/Nagad/... transaction ID).
4. **Admin** approves the recharge → balance is credited.
5. **ESP32** sends running counters every minute → the backend bills the usage, deducts the balance and replies `relay: on/off`.

All rates and calculations are in the backend. The ESP32 only uses **2 APIs**:

| Method | Path | Purpose |
|---|---|---|
| GET  | `/consumer/meter/:meterId/balance?key=DEVICE_KEY` | Balance + relay decision (every 30 s) |
| POST | `/consumer/meter/:meterId/consumption?key=DEVICE_KEY` | Send readings, get billed (every 1 min) |

**Supply is OFF by default.** Relays turn ON only when the latest server reply says `"relay":"on"`
and is less than 5 minutes old. After a reboot, or with no server contact, the supply stays OFF.

The server turns the relay OFF when:

| `state` | Meaning |
|---|---|
| `no_balance` | Balance ≤ `min_balance` (0.01 Tk) |
| `meter_disabled` | Admin disabled the meter |
| `consumer_suspended` | Admin suspended the consumer |

---

## Backend setup

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste all of `backend/supabase/schema.sql` → **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **service_role** key.

### 2. Environment
```bash
cd backend
cp .env.example .env
```
Fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and a random `JWT_SECRET` (32+ characters).

### 3. Install, create the first admin, run
```bash
npm install
npm run create-admin -- "Minhaj" admin@example.com yourpassword
npm run dev        # development (auto-restart)
npm start          # production
```
Check: `http://localhost:3000/health`

### 4. Server for the ESP32
The SIM900A uses **plain HTTP** (its SSL is too old for modern HTTPS), so the meter
routes must be reachable over `http://` on a public IP or domain. In the `.ino` set:
```cpp
const char SERVER_URL[] = "http://YOUR_SERVER_IP:3000";
```
The admin and consumer panels can still use HTTPS through Nginx. The device key protects the meter routes.

### 5. Test every API with Postman
1. Postman → **Import** → `backend/postman/Smart_Utility_Meter.postman_collection.json`.
2. Open the collection → **Variables**: set `base_url`, `admin_email`, `admin_password` (the admin from step 3).
3. **Run collection** (Collection Runner). It runs the full flow: admin login → create consumer + meter →
   ESP32 balance (OFF) → consumer login → recharge → admin approve → ESP32 balance (ON) → billing → reports → cleanup.

Tokens, `meter_id`, `device_key` and recharge IDs are saved automatically between requests.
Login is limited to 10 attempts per 15 minutes per IP, so after about 2 full runs you may get `429`. Wait, or restart the server.

---

## Billing

| Setting | Default | Change with |
|---|---|---|
| Electricity | 8 Tk / kWh | `PUT /admin/tariff` |
| Water | 18 Tk / 1000 L | `PUT /admin/tariff` |
| Relay OFF at or below | 0.01 Tk | `PUT /admin/tariff` |

The ESP32 sends **running counters**, not per-minute amounts:
- `energy_kwh`: the PZEM-004T internal energy counter
- `water_l`: the ESP32's total water counter (saved in flash)

The backend bills the **difference** from the last counter it saw. A repeated or retried report
is never billed twice. The first report from a new meter only sets the baseline. A counter lower
than the last one (PZEM reset) is treated as a new start.

---

## Response format

Panel APIs:
```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 57, "total_pages": 3 } }
{ "success": false, "message": "Validation failed", "details": [{ "field": "phone", "message": "..." }] }
```

Meter APIs (flat, small for the SIM900A):
```json
{ "meter_id": "MTR-0001", "relay": "on", "state": "active", "balance": 120.5 }
```

Auth header for panels: `Authorization: Bearer <token>`

---

## Admin API — `/admin/*`

| Method | Path | Body / Query |
|---|---|---|
| POST | `/admin/auth/login` | `{ email, password }` |
| GET | `/admin/auth/me` | |
| PATCH | `/admin/auth/password` | `{ current_password, new_password }` |
| GET | `/admin/dashboard` | |
| GET | `/admin/admins` | |
| POST | `/admin/admins` | `{ name, email, password }` |
| PATCH | `/admin/admins/:id` | `{ name?, is_active? }` |
| GET | `/admin/consumers` | `?search=&status=&meter_id=&page=&limit=` |
| POST | `/admin/consumers` | `{ name, phone, password, email?, address?, meter_id? }` → returns `device_key` once |
| GET | `/admin/consumers/:id` | |
| PATCH | `/admin/consumers/:id` | `{ name?, phone?, email?, address? }` |
| PATCH | `/admin/consumers/:id/status` | `{ status: "active" \| "suspended" }` |
| POST | `/admin/consumers/:id/reset-password` | `{ password }` |
| DELETE | `/admin/consumers/:id` | deletes consumer, meter and history |
| GET | `/admin/meters` | `?search=&status=&online=true\|false&page=&limit=` |
| GET | `/admin/meters/:meterId` | live values, totals, relay state |
| PATCH | `/admin/meters/:meterId/status` | `{ status: "active" \| "disabled" }` |
| POST | `/admin/meters/:meterId/regenerate-key` | returns the new `device_key` once |
| GET | `/admin/meters/:meterId/readings` | `?from=&to=&page=&limit=` |
| GET | `/admin/meters/:meterId/usage` | `?from=&to=` daily totals |
| POST | `/admin/meters/:meterId/adjust` | `{ amount (+/-), note }` |
| GET | `/admin/tariff` | |
| PUT | `/admin/tariff` | `{ electricity_rate?, water_rate?, min_balance? }` |
| GET | `/admin/recharges` | `?status=&method=&source=&meter_id=&from=&to=&page=&limit=` |
| POST | `/admin/recharges` | `{ meter_id, amount, method?, transaction_ref?, note? }` credited immediately |
| PATCH | `/admin/recharges/:id/approve` | |
| PATCH | `/admin/recharges/:id/reject` | `{ reason? }` |
| GET | `/admin/transactions` | `?type=&meter_id=&from=&to=&page=&limit=` |

## Consumer API — `/consumer/*`

| Method | Path | Body / Query |
|---|---|---|
| POST | `/consumer/auth/login` | `{ identifier: phone or meter ID, password }` |
| GET | `/consumer/profile` | profile + meter + tariff |
| PATCH | `/consumer/profile` | `{ name?, email?, address? }` |
| PATCH | `/consumer/password` | `{ current_password, new_password }` |
| GET | `/consumer/balance` | balance, relay, state, online |
| GET | `/consumer/usage/summary` | `?from=&to=` (default last 30 days) |
| GET | `/consumer/usage/readings` | `?from=&to=&page=&limit=` |
| POST | `/consumer/recharges` | `{ amount, method, transaction_ref, note? }` |
| GET | `/consumer/recharges` | `?status=&page=&limit=` |
| GET | `/consumer/transactions` | `?from=&to=&page=&limit=` |

Recharge methods: `bkash, nagad, rocket, upay, card, bank, other` (`cash` is admin only).
Consumer recharges are `pending` until an admin approves them.
For testing, set `AUTO_APPROVE_RECHARGE=true` to credit them immediately.

---

## Firmware setup

1. Arduino IDE → Library Manager: install **PZEM004Tv30**, **LiquidCrystal**, **ArduinoJson** (v7).
2. Open `firmware/smart_meter/smart_meter.ino` and set:
   ```cpp
   const char SERVER_URL[] = "http://YOUR_SERVER_IP:3000";
   const char METER_ID[]   = "MTR-0001";               // from POST /admin/consumers
   const char DEVICE_KEY[] = "PASTE_DEVICE_KEY_HERE";  // from POST /admin/consumers
   ```
3. Upload. In the Serial Monitor (115200), look for `HTTP Status: 200` and `Supply: SUPPLY ON`.
