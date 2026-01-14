# Hlásím se - MVP Design

## Přehled

Mobilní aplikace pro pravidelný check-in, která upozorní blízké, pokud se uživatel neohlásí včas.

## Tech Stack

| Vrstva | Technologie |
|--------|-------------|
| Frontend | Expo SDK 52+ (React Native), TypeScript |
| Navigace | Expo Router (file-based routing) |
| State | Zustand |
| Backend | Supabase (PostgreSQL, Auth, Realtime) |
| Notifikace | Expo Notifications |
| Platby | RevenueCat |
| Styling | NativeWind (Tailwind pro React Native) |

## Struktura projektu

```
hlasimse-app/
├── app/                    # Expo Router - obrazovky
│   ├── (auth)/             # Auth flow (login, register)
│   ├── (tabs)/             # Hlavní tabbed navigace
│   │   ├── index.tsx       # Check-in obrazovka
│   │   ├── guardians.tsx   # Správa strážců
│   │   └── settings.tsx    # Nastavení
│   └── _layout.tsx         # Root layout
├── components/             # Reusable komponenty
├── lib/                    # Utility, Supabase client
├── hooks/                  # Custom React hooks
├── stores/                 # Zustand stores
├── constants/              # Barvy, config
└── types/                  # TypeScript typy
```

## MVP Slices (vertikální přístup)

| # | Slice | Popis |
|---|-------|-------|
| 1 | **Project Setup** | Expo projekt, navigace, struktura, Supabase připojení |
| 2 | **Autentizace** | Registrace, přihlášení, zapomenuté heslo |
| 3 | **Check-in profil** | Vytvoření profilu, hlavní obrazovka s tlačítkem |
| 4 | **Check-in logika** | Odpočet, ukládání polohy, deadline tracking |
| 5 | **Strážci** | Přidání/odebrání strážců, propojení uživatelů |
| 6 | **Notifikace** | Push připomínky, alerty pro strážce |
| 7 | **Premium & Platby** | RevenueCat, free/premium rozlišení |
| 8 | **Polish & Launch** | Testování, bugfixy, store submission |

## Slice 1: Project Setup (detail)

### Kroky

1. **Inicializace Expo projektu**
   - `npx create-expo-app hlasimse-app --template tabs`

2. **Konfigurace TypeScript**
   - Striktní nastavení
   - Path aliases (@/)

3. **Instalace dependencies**
   - nativewind
   - @supabase/supabase-js
   - zustand
   - expo-secure-store
   - react-native-safe-area-context

4. **Supabase setup**
   - Vytvořit projekt v dashboardu
   - SQL pro tabulky
   - Row Level Security

5. **Základní struktura**
   - Expo Router navigace
   - Theme provider
   - Supabase client
   - Placeholder obrazovky

### Výstup

- App s tab navigací (Check-in, Strážci, Nastavení)
- Připojená k Supabase
- Barvy a fonty z style guide
- Běží na iOS Simulátoru

## Design System (z Obsidian dokumentace)

### Barvy

- Primary (coral): `#FF6B5B`
- Secondary (peach): `#FFAB91`
- Background (cream): `#FFF8F5`
- Text (charcoal): `#2D2926`
- Success: `#4ADE80`

### Fonty

- Display: Lora (serif)
- Body: Instrument Sans (sans-serif)

### Border Radius

- sm: 0.5rem
- md: 1rem
- lg: 1.5rem
- xl: 2rem
- full: 9999px

## Datový model

### users
- id, email, name, avatar_url
- is_premium, premium_expires_at, trial_used
- created_at, updated_at

### check_in_profiles
- id, owner_id, name, avatar_url
- interval_hours, next_deadline
- last_check_in_at, last_known_lat, last_known_lng
- is_paused, paused_until, is_active
- created_at, updated_at

### guardians
- id, check_in_profile_id, user_id
- created_at

### check_ins
- id, check_in_profile_id
- checked_in_at, lat, lng
- was_offline, synced_at

### alerts
- id, check_in_profile_id
- triggered_at, resolved_at
- alert_type, notified_guardians

### push_tokens
- id, user_id, token, platform
- created_at, updated_at

## Business Model

- Free: 1 hlásící se, 1 strážce, 24h interval, reklamy pro strážce
- Premium: 50 Kč/měsíc nebo 500 Kč/rok
  - Až 5 hlásících se
  - Až 5 strážců
  - Nastavitelný interval
  - Režim pauzy, režim aktivace
  - Bez reklam
