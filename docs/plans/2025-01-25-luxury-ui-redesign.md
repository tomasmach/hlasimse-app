# Hlásím se 2.0 - Luxury UI Redesign

**Datum:** 2025-01-25
**Status:** Schváleno
**Cíl:** Přepracovat UI na luxury app úroveň (N26, Revolut, Headspace vibe)

---

## 1. Vizuální jazyk

### Barevný systém s hloubkou

```
Primary gradient:     #FF6B5B → #FF8A7A → #FFAB91 (coral to peach)
Accent gradient:      #FF6B5B → #F43F5E (pro důležité stavy)
Surface base:         #FFF8F5 (cream)
Surface elevated:     #FFFFFF
Surface floating:     #FFFFFF + backdrop blur
Shadows:              rgba(255, 107, 91, 0.15) - teplý coral undertone
```

### Typografie

| Použití | Font | Velikost | Weight |
|---------|------|----------|--------|
| Display (countdown) | Outfit | 48-72px | ExtraBold (800) |
| Headlines | Outfit | 24-32px | SemiBold (600) |
| Body | Outfit | 16px | Regular (400) |
| Caption | Outfit | 12-14px | Light (300) |

### Spacing systém

- Page padding: 24px (místo 16px)
- Section gaps: 32-48px
- Card padding: 20-24px
- Border radius: 16-24px (cards), full rounded (buttons)

---

## 2. Hlavní obrazovka - Check-in

### Layout

```
┌─────────────────────────────────┐
│  Status bar                     │
│                                 │
│  "Dobré odpoledne, Tomáši"      │
│                                 │
│         ┌───────────┐           │
│         │   HERO    │           │
│         │  BUTTON   │           │
│         │  180×180  │           │
│         └───────────┘           │
│                                 │
│      Další hlášení za           │
│         23:45:12                │
│                                 │
│  ══════ Floating Tab Bar ══════ │
└─────────────────────────────────┘
```

### Hero Button specifikace

- **Velikost:** 180×180px
- **Background:** Animated gradient (coral → peach), rotace 360°/8s
- **Glow:** Rozmazaný coral stín, pulzující opacity
- **Idle animation:** Scale breathing 1.0 → 1.02, glow pulse
- **Press:** Scale 0.92, haptic medium impact
- **Success:** Ripple effect, checkmark morph, confetti particles

### Countdown

- Mono-space font, Outfit ExtraBold 48px
- Formát: `23:45:12`
- Labels pod čísly: "hodin : minut : sekund" (caption style)

---

## 3. Floating Tab Bar

### Vizuální specifikace

- **Position:** Floating, 16px od spodní hrany
- **Shape:** Rounded 24px, horizontal padding 32px
- **Background:** Bílá 80% opacity + backdrop blur 20px
- **Border:** 1px `rgba(255, 107, 91, 0.1)`
- **Shadow:** Měkký teplý stín

### Ikony (Phosphor)

| Tab | Inactive | Active |
|-----|----------|--------|
| Domů | `house-light` | `house-fill` |
| Strážci | `users-three-light` | `users-three-fill` |
| Nastavení | `gear-six-light` | `gear-six-fill` |

### Animace

- Spring přechod mezi stavy
- Sliding pill indicator pod aktivní ikonou
- Labels fade in pod aktivní ikonou
- Hide on scroll (optional)

---

## 4. Obrazovka Strážci

### Guardian Card

- Elevated white surface + subtle shadow
- Gradient avatar (coral → peach) s bílými iniciály
- Jméno: 17px bold, Email: 14px muted
- Swipe-to-reveal nebo long press pro delete
- Entry animation: staggered fade + slide up

### Watched Profile Card

- 4px levý accent bar (green/orange/red podle stavu)
- Status badge: pill shape s ikonou
- Real-time countdown (mono-space)
- Critical state: jemné červené pulzování

### Add Guardian Modal

- Backdrop: blur 20px + overlay
- Modal: rounded 24px, floating shadow
- Input: bottom border only, animated label
- Buttons: Primary = gradient, Secondary = ghost

---

## 5. Nastavení

### Profile Header Card

- Avatar 72px s gradient background
- Jméno 20px semibold
- Email muted
- "Upravit profil" link

### Settings Groups

- Bílé karty, rounded 16px
- Dividers: 1px sand, 16px left inset
- Row: label vlevo, value + chevron vpravo
- Tap state: fade highlight

### Destructive Actions

- Oddělená sekce
- Confirmation modal s blur backdrop

---

## 6. Onboarding & Auth

### Onboarding Slides

- Subtle gradient background (cream → white)
- Ilustrace: 120px, Lottie animations
- Headline: 28px ExtraBold, gradient text
- Pagination: pill-shaped dots, aktivní = wider + coral
- Parallax efekt při swipe

### Interactive Demo (NOVÉ)

Po slide 3, před registrací:

```
┌─────────────────────────────────┐
│      Zkuste si to               │
│   Stiskněte tlačítko...         │
│                                 │
│         ┌───────────┐           │
│         │   HERO    │           │
│         │  BUTTON   │           │
│         └───────────┘           │
│                                 │
└─────────────────────────────────┘
```

Po stisknutí → success animace → CTA "Vytvořit účet"

### Auth Screens

- Input fields: bottom border only, animated floating label
- Focus: border coral gradient, label float up
- Error: shake animation + red accent
- Logo: "Hlásím se" s gradient underline

---

## 7. Animace & Micro-interactions

### Hero Button Animation Suite

```
IDLE (loop):
├── Gradient rotation: 360° / 8s
├── Glow pulse: opacity 0.3 → 0.5 / 3s
└── Scale breathing: 1.0 → 1.02 / 4s

PRESS:
├── Scale: 1.0 → 0.92 (spring)
├── Haptic: Medium Impact
└── Gradient: 2x speed

SUCCESS:
├── Scale: bounce 0.92 → 1.1 → 1.0
├── Ripple: coral → transparent
├── Icon: morph → checkmark
├── Haptic: Success
└── Particles: 12 dots explode
```

### Screen Transitions

| Přechod | Animace |
|---------|---------|
| Tab switch | Crossfade 200ms + sliding indicator |
| Modal open | Backdrop fade + scale 0.9→1.0 + slide up |
| Modal close | Reverse, 150ms |
| Card appear | Staggered fade + slide up, 50ms delay |

### Haptic Feedback

| Akce | Haptic |
|------|--------|
| Button tap | Light |
| Check-in success | Success |
| Tab switch | Light |
| Error | Error (3x vibrace) |
| Delete | Warning |

---

## 8. Success Overlay & Toasts

### Success Overlay

- Backdrop: blur 20px + cream 60%
- Circle: gradient border, white fill
- Checkmark: animated stroke (Lottie)
- Text: "Vše v pořádku!" gradient, 24px ExtraBold
- Auto-dismiss: 3s

### Toast System

| Typ | Barva | Příklad |
|-----|-------|---------|
| Success | Green | "Strážce přidán" |
| Info | Coral | "Pozvánka odeslána" |
| Warning | Orange | "Slabé připojení" |
| Error | Red | "Něco se pokazilo" |

- Position: nad tab barem
- Duration: 3s, swipe to dismiss
- Max 2 visible

---

## 9. Ikonografie

### Phosphor Icons

| Použití | Weight |
|---------|--------|
| Tab inactive | Light |
| Tab active | Fill |
| UI akce | Regular |
| Status | Bold |

### Konkrétní ikony

```
Akce:        plus, x, trash, pencil-simple, chevron-right, arrow-left
Status:      check-circle, warning-circle, x-circle, wifi-slash, map-pin
```

### Avatar System

- Gradient background (coral → peach)
- Bílé iniciály
- Velikosti: 32px (list), 48px (card), 72px (header)
- Optional: 2px white border, inner shadow

---

## 10. Technické poznámky

### Dependencies k přidání

- `phosphor-react-native` - ikony
- `react-native-reanimated` - animace (už je)
- `lottie-react-native` - komplexní animace (checkmark, confetti)
- `expo-blur` - backdrop blur efekty
- `expo-haptics` - haptic feedback

### Tailwind rozšíření

```js
// tailwind.config.js
extend: {
  backdropBlur: {
    xs: '2px',
  },
  animation: {
    'gradient-rotate': 'gradient-rotate 8s linear infinite',
    'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
    'breathe': 'breathe 4s ease-in-out infinite',
  }
}
```

---

## Shrnutí změn

| Oblast | Před | Po |
|--------|------|-----|
| Vizuální styl | Flat | Gradienty + hloubka |
| Hero button | 48px | 180px animated |
| Typografie | Jednotná | Hierarchie |
| Prostor | 16px | 24px+ |
| Tab bar | Standard | Floating glass |
| Animace | Základní | Spring + haptics |
| Ikony | Ionicons | Phosphor |
| Onboarding | 3 slidy | + interactive demo |
