# Hlásím se

React Native (Expo) app for regular check-ins that alerts guardians when a user misses their deadline. Czech version of the “I am not dead yet” concept.

## Tech stack

- **Expo / React Native** with **Expo Router**
- **TypeScript**
- **Supabase** (Postgres, Auth, Realtime, Edge Functions)
- **Zustand** for state management
- **NativeWind** (Tailwind CSS for React Native)
- **Jest** for tests

## Repository structure (high level)

```
app/                   # Expo Router pages
components/            # Reusable UI components
stores/                # Zustand stores
hooks/                 # Custom hooks
lib/                   # Supabase client, offline queue, helpers
supabase/functions/    # Supabase Edge Functions (Deno)
docs/                  # Documentation (incl. migrations)
types/                 # Shared TypeScript types
```

More detailed internal notes for development are in [`CLAUDE.md`](./CLAUDE.md).

## Getting started

### Prerequisites

- Node.js + npm
- Expo tooling (the project uses `expo` via npm scripts)
- iOS Simulator (Xcode) and/or Android emulator (Android Studio), depending on your target

### Install

```bash
npm install
```

### Environment variables

Create a `.env.local` file in the project root:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

> Note: Supabase Edge Functions require a service role key configured in the Supabase dashboard (do not commit service role keys).

## Development

Start the Expo dev server:

```bash
npm start
```

Run on specific platforms:

```bash
npm run ios
npm run android
npm run web
```

## Testing

```bash
npm test
```

## Supabase Edge Functions

The repo contains Supabase Edge Functions under `supabase/functions/`.

Common commands:

```bash
supabase functions serve check-deadlines
supabase functions deploy check-deadlines
```

## Product overview

**Target users**

- Seniors living alone
- Families monitoring elderly relatives
- Solo travelers / hikers

**Core flow**

1. User sets a check-in deadline.
2. User checks in before the deadline.
3. If the user misses the deadline, guardians are alerted (push notifications).

## Conventions

- User-facing strings are typically **Czech**
- Code/comments are typically **English**
- Styling uses **NativeWind** utility classes; design tokens are documented in [`styles.md`](./styles.md)

## License

No license file is currently included. If you intend this repository to be open source, add a `LICENSE` file.

