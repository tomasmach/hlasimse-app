# UX Quick Wins Design

> Date: 2026-01-15
> Status: Approved

## Overview

Quick UX improvements across three areas before app store launch:
1. **Seniors UX** - Make check-in foolproof
2. **Guardian Experience** - Make monitoring reassuring
3. **Settings** - Essential settings + Premium integration

---

## 1. Seniors UX (Check-in Screen)

### 1.1 Full-Screen Success State

**Current:** Small checkmark on button for 1.5s + toast notification.

**New:** Full-screen overlay after successful check-in:

```
┌─────────────────────────┐
│                         │
│                         │
│          ✓              │  ← Large animated checkmark (success green)
│                         │
│    Vše v pořádku!       │  ← Large text
│                         │
│   Další hlášení za      │
│       24 hodin          │  ← Shows next interval
│                         │
│                         │
└─────────────────────────┘
```

- Duration: 3 seconds, then fade out
- Tap anywhere to dismiss early
- Color: success green (#4ADE80)
- Animation: spring on checkmark

### 1.2 Simplified Offline Messages

**Toast (when saving offline):**
```
✓ Máme to! Pošleme hned, až bude signál.
```

**Banner (pending sync):**
```
📶 Čekáme na připojení...
   Vaše hlášení je v bezpečí.
```
- Remove manual "Odeslat" button - auto-sync is enough
- Banner disappears automatically when synced

**Error toast (sync failure):**
```
⚠️ Nepodařilo se odeslat. Zkuste to znovu.
```

---

## 2. Guardian Experience

### 2.1 Watched Profile Cards

Add last check-in time + color-coded borders for instant scanning.

**Colors (from styles.md):**
- **Success green** (#4ADE80): More than 1 hour remaining
- **Brand-500 orange** (#f97316): Less than 1 hour remaining
- **Accent rose** (#f43f5e): Deadline missed

**Card layout:**
```
┌─ [COLOR] BORDER ────────────────┐
│  👤 [Name]                      │
│  [icon] [Status text]           │
│                                 │
│  Naposledy: [date/time]         │  ← NEW
│  [Countdown or overdue time]    │
│                                 │
│  📍 Zobrazit polohu             │  ← Only when missed
└─────────────────────────────────┘
```

**Status texts:**
- Green: "V pořádku"
- Orange: "Blíží se termín"
- Rose: "Neohlásil/a se!"

### 2.2 Empty States

**"Moji strážci" (My Guardians) - empty:**
```
👀

Zatím nemáte žádné strážce

Strážce dostane upozornění,
když se neohlásíte včas.

[ + Přidat strážce ]
```

**"Hlídám" (Watching) - empty:**
```
🛡️

Nikoho nehlídáte

Až vás někdo pozve jako
strážce, uvidíte ho zde.
```

**"Čekající pozvánky" (Pending Invites):**
- Don't show section when empty (cleaner UI)
- Only appears when there are pending invites

---

## 3. Settings Screen

### 3.1 Settings Layout

```
┌─────────────────────────────────┐
│  ⚙️ Nastavení                   │
├─────────────────────────────────┤
│                                 │
│  PROFIL                         │
│  ┌───────────────────────────┐  │
│  │ 👤 Jméno                  │  │
│  │    [Name]  ›              │  │  ← Tap to edit
│  ├───────────────────────────┤  │
│  │ ⏱️ Interval hlášení       │  │
│  │    24 hodin  ›            │  │  ← Tap → paywall (Free) or picker (Premium)
│  └───────────────────────────┘  │
│                                 │
│  PŘEDPLATNÉ                     │
│  ┌───────────────────────────┐  │
│  │ ⭐ Hlásím se [Free/Premium]│  │
│  │    [Upgradovat / Spravovat]│  │
│  └───────────────────────────┘  │
│                                 │
│  ÚČET                           │
│  ┌───────────────────────────┐  │
│  │ 📧 [email]                │  │
│  ├───────────────────────────┤  │
│  │ 🚪 Odhlásit se            │  │
│  ├───────────────────────────┤  │
│  │ 🗑️ Smazat účet            │  │  ← Red text
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

### 3.2 Edit Name Screen

```
┌─────────────────────────────────┐
│  ← Zpět         Uložit          │
├─────────────────────────────────┤
│                                 │
│  Vaše jméno                     │
│  ┌───────────────────────────┐  │
│  │ [Name input]              │  │
│  └───────────────────────────┘  │
│                                 │
│  Toto jméno uvidí vaši strážci. │
│                                 │
└─────────────────────────────────┘
```

### 3.3 Interval Picker (Premium only)

```
┌─────────────────────────────────┐
│  ← Zpět                         │
├─────────────────────────────────┤
│                                 │
│  Jak často se chcete hlásit?    │
│                                 │
│  ○  12 hodin                    │
│  ●  24 hodin  ✓                 │
│  ○  48 hodin                    │
│  ○  7 dní                       │
│                                 │
└─────────────────────────────────┘
```

Free users: Tap interval → opens paywall directly.

### 3.4 Delete Account Flow

1. Tap "Smazat účet"
2. Confirmation dialog: "Opravdu chcete smazat účet? Všechna data budou nenávratně odstraněna."
3. Require password re-entry
4. Delete all user data (check_ins, check_in_profiles, guardians, guardian_invites, alerts, push_tokens)
5. Delete auth user
6. Sign out and redirect to login

---

## 4. Paywall UI

Shown when Free user taps interval or "Upgradovat":

```
┌─────────────────────────────────┐
│                         ✕       │
│                                 │
│            ⭐                   │
│                                 │
│     Hlásím se Premium           │
│                                 │
│  ┌───────────────────────────┐  │
│  │ ✓ Nastavitelný interval   │  │
│  │   (1h až 7 dní)           │  │
│  │                           │  │
│  │ ✓ Až 5 strážců            │  │
│  │                           │  │
│  │ ✓ Bez reklam              │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  500 Kč / rok             │  │  ← Highlighted (recommended)
│  │  (2 měsíce zdarma)        │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  50 Kč / měsíc            │  │
│  └───────────────────────────┘  │
│                                 │
│  [ Vyzkoušet 14 dní zdarma ]    │  ← Primary CTA (brand-500)
│                                 │
│  Obnovit nákup                  │  ← Small link
│                                 │
└─────────────────────────────────┘
```

- Annual plan visually emphasized
- 14-day trial as main CTA
- RevenueCat handles purchase flow

---

## Implementation Notes

### Dependencies
- RevenueCat SDK for Premium/payments
- Supabase: add `is_premium` field to users table (or sync from RevenueCat)

### Files to modify
- `app/(tabs)/index.tsx` - Success overlay, offline messages
- `app/(tabs)/guardians.tsx` - Empty states
- `app/(tabs)/settings.tsx` - Full redesign
- `components/WatchedProfileCard.tsx` - Color borders, last check-in
- `components/OfflineBanner.tsx` - Simplified message
- New: `components/SuccessOverlay.tsx`
- New: `components/Paywall.tsx`
- New: `app/(tabs)/edit-name.tsx`
- New: `app/(tabs)/interval-picker.tsx`
- New: `stores/premium.ts` or extend `auth.ts`

### Database changes
- `users` table: add `is_premium: boolean`, `premium_expires_at: timestamp`
- Or: query RevenueCat directly for subscription status
