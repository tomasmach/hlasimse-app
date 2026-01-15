# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Hlásím se** ("I'm checking in") is a React Native mobile app for regular check-ins that alerts guardians when users miss their deadline. Czech version of the "I am not dead yet" concept.

**Target users:** Seniors living alone, families monitoring elderly relatives, solo travelers/hikers.

## Commands

```bash
npm start              # Start Expo dev server
npm run ios            # Run on iOS simulator
npm run android        # Run on Android emulator
npm test               # Run Jest tests
```

**Supabase Edge Functions:**
```bash
supabase functions deploy check-deadlines   # Deploy deadline checker
supabase functions serve check-deadlines    # Local development
```

## Architecture

### Tech Stack
- **Expo Router** - File-based routing with layout groups
- **Supabase** - PostgreSQL with RLS, Auth, Edge Functions, Realtime
- **Zustand** - State management (stores in `stores/`)
- **NativeWind** - Tailwind CSS for React Native
- **TypeScript** - Strict mode enabled

### Directory Structure
```
app/                    # Expo Router pages
├── (auth)/            # Login, register, forgot-password
├── (onboarding)/      # First-launch intro slides
├── (tabs)/            # Main app (check-in, guardians, settings)
stores/                # Zustand stores (auth, checkin, guardians, onboarding)
hooks/                 # Custom hooks (useAuth, useCountdown, useLocation, useNotifications, useNetworkStatus)
lib/                   # Supabase client, offline queue
components/            # Reusable UI components
types/database.ts      # Database schema types
supabase/functions/    # Edge Functions (Deno)
docs/migrations/       # SQL migration files
```

### Navigation Flow
`(onboarding)` → `(auth)` → `(tabs)/profile-setup` → `(tabs)/index`

Protected routes checked in root `_layout.tsx`.

### Key Patterns

**Offline Fallback:**
- Online-first, but supports offline check-ins for edge cases (hiking, poor signal)
- `lib/offlineQueue.ts` uses AsyncStorage + AsyncMutex for pending check-ins
- Network errors queue for later sync; server errors fail immediately
- Auto-sync on network reconnect via `useNetworkStatus` hook

**Atomic Database Operations:**
- `atomic_check_in()` RPC function for transactional check-in + profile update
- Prevents race conditions between check-in insert and deadline extension

**Push Notifications Flow:**
1. App init → request permission → store Expo Push Token in `push_tokens`
2. Edge Function `check-deadlines` runs via cron (every 5 min)
3. Missed deadline → create `alerts` record → send push via Expo Push API
4. Notification tap → deep link to guardians screen

**Realtime Subscriptions:**
- Guardian invites use Supabase Realtime for instant UI updates
- Subscription setup in `stores/guardians.ts`

## Database Schema (Key Tables)

- `users` - Extended auth profiles
- `check_in_profiles` - User's check-in settings (one per user, `owner_id` unique)
- `check_ins` - Individual check-in records with GPS
- `guardians` - Many-to-many: who watches whom
- `guardian_invites` - Pending guardian invitations
- `alerts` - Missed deadline alerts
- `push_tokens` - Expo push tokens per user/platform

All tables have RLS policies enabled.

## Development Progress

**Completed (Slices 1-6):**
- ✅ Expo + Supabase + Zustand setup
- ✅ Authentication (email/password, Secure Store for JWT)
- ✅ Onboarding + Check-in profile creation
- ✅ Check-in with GPS, offline queue, countdown timer
- ✅ Guardians management with invites (Realtime)
- ✅ Push notifications to guardians on missed deadline

**Next (Slice 7):** Premium & Payments
- RevenueCat integration
- Free/Premium tier distinction
- Paywall UI

**Future:** SMS alerts, pause mode, Apple Watch app

## Code Conventions

- **Language:** Czech for user-facing strings, English for code/comments
- **Styling:** NativeWind classes, custom theme in `tailwind.config.js`
- **Design tokens:** See `styles.md` for color palette (brand-500: `#f97316`, accent: `#f43f5e`)
- **Border radius:** Extra rounded (2rem) for friendly appearance

## Environment Variables

Required in `.env.local`:
```
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Edge Functions need service role key configured in Supabase dashboard.
