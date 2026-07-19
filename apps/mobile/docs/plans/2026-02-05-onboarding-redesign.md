# Onboarding Redesign — Design Document

## Overview

Complete replacement of the existing 3-slide onboarding with a 5-screen personalized flow following the pattern: Ask about problems → Make you feel understood → Show how they'll solve it → Create a wow moment → Then show sign up.

**Tone:** Warm & human, empathetic language, soft colors, Czech localization.

## Flow

| # | Screen | Purpose | Principle |
|---|--------|---------|-----------|
| 1 | "Co vás přivedlo?" | User selects persona via illustrated cards | Ask about problems |
| 2 | "Víme, jaké to je" | Personalized empathy message based on selection | Make you feel understood |
| 3 | "Takhle to řešíme" | 3-step timeline showing how the app solves their problem | Show how they'll solve it |
| 4 | "Vyzkoušejte si to" | Interactive demo: check-in button + simulated notification | Create a wow moment |
| 5 | "Pojďme na to" | Registration form embedded in onboarding | Then show sign up |

**Navigation:** No skip button. One clear CTA per screen. Swipe back supported. 5-dot progress indicator at top.

## Screen 1: "Co vás přivedlo?"

**Layout:**
- Top: Progress dots (1/5 active)
- Heading: "Co vás přivedlo?" (text-3xl, font-semibold, charcoal)
- Subheading: "Díky tomu vám ukážeme, jak vám pomůžeme" (text-base, muted)
- 3 vertical cards (tappable)

**Cards:**
1. **Icon:** Person (Phosphor) · **Title:** "Bydlím sám/sama" · **Desc:** "Chci, aby o mně někdo věděl"
2. **Icon:** UsersThree · **Title:** "Starám se o blízkého" · **Desc:** "Chci mít jistotu, že je v pořádku"
3. **Icon:** Compass · **Title:** "Cestuji sám/sama" · **Desc:** "Chci pojistku pro případ nouze"

**Interaction:** Tap → card highlights (coral border, scale 1.02, haptic), after 400ms auto-advance. Selected persona saved to onboarding store.

**Visual:** Cards have cream background, on select coral-light background with coral border. Icons in coral, 40px. Cards rounded-4xl (32px radius).

## Screen 2: "Víme, jaké to je"

**Personalized content based on persona:**

**"Bydlím sám/sama":**
- Heading: "Víme, jaké to je"
- Text: "Když žijete sami, občas vás napadne: co kdyby se mi něco stalo a nikdo by nevěděl? Ten pocit znáte. A právě proto existujeme."

**"Starám se o blízkého":**
- Heading: "Víme, jaké to je"
- Text: "Máte svůj život, ale v hlavě pořád myšlenku: je maminka v pořádku? Chcete mít jistotu, aniž byste museli neustále volat."

**"Cestuji sám/sama":**
- Heading: "Víme, jaké to je"
- Text: "Milujete svobodu cestování, ale vaši blízcí se bojí. Nechcete se omezovat, ale chcete, aby věděli, že jste OK."

**Visual:** Large centered text, fade-in animation. HeartHalf icon below (coral, 64px). CTA button: "Jak to funguje?"

**Animation:** Staggered word-by-word fade-in (30ms delay per word).

## Screen 3: "Takhle to řešíme"

**Personalized 3-step timeline, staggered entry animation (200ms delay between steps).**

**"Bydlím sám/sama":**
1. Clock — "Nastavíte si jak často se chcete hlásit" — "Jednou denně, dvakrát, jak potřebujete."
2. Tap — "Jedním klepnutím řeknete: jsem OK" — "Zabere to dvě sekundy."
3. Bell — "Když se neohlásíte, vaši blízcí se dozví" — "Automaticky a spolehlivě."

**"Starám se o blízkého":**
1. UserPlus — "Pozvete svého blízkého do appky" — "Stačí zadat email."
2. CheckCircle — "Dostanete pravidelné potvrzení, že je OK" — "Bez otravného volání."
3. Warning — "Pokud se neozve, okamžitě se dozvíte" — "Notifikace přímo na váš telefon."

**"Cestuji sám/sama":**
1. MapPin — "Při hlášení se uloží vaše poloha" — "Kdyby bylo potřeba, vaši blízcí uvidí kde jste byli naposledy."
2. Timer — "Nastavíte interval podle plánu cesty" — "Flexibilní podle potřeby."
3. ShieldCheck — "Když se neozvete, spustí se alarm" — "Vaši blízcí budou vědět."

**Visual:** Each step is a row with icon left (coral circle, 44px), text right. Vertical line connecting steps (timeline effect). CTA: "Chci to vidět"

## Screen 4: "Vyzkoušejte si to" (Wow Moment)

**Step A: Check-in button**
- Large HeroButton center screen (breathing animation, coral glow)
- Text above: "Zkuste to. Klepněte."
- Tap → haptic (medium), scale 0.92, loading circle, success checkmark with bounce

**Step B: Simulated notification (1.5s after success)**
- Mock notification slides down from top (iOS/Android style):
  - App icon + "Hlásím se"
  - Persona-specific text:
    - Sám: "Váš blízký se právě ohlásil. Vše je v pořádku."
    - Starám se: "Maminka se právě ohlásila. Vše je v pořádku."
    - Cestuji: "Váš cestovatel se právě ohlásil. Vše je v pořádku."
  - Realistic look (blur background, rounded corners, shadow)
  - Auto-hides after 2s

**Step C: CTA (after notification hides)**
- Text: "Tohle uvidí vaši blízcí. Pokaždé."
- GradientButton: "Chci začít"

**Minimal, clean cream background — focus on the one button.**

## Screen 5: "Pojďme na to" (Sign Up)

**Layout:**
- Heading: "Pojďme na to" (text-3xl, semibold)
- Subheading: "Vytvoření účtu zabere minutu" (muted)

**Form (3 AnimatedInput fields):**
1. Name (textContentType: name)
2. Email (textContentType: emailAddress, keyboardType: email-address)
3. Password (secureTextEntry, visibility toggle)

**CTA:** GradientButton "Vytvořit účet" (full width)

**Below form:** "Už máte účet?" + link "Přihlásit se" (coral) → navigates to login

**Behavior:**
- Same registration logic as existing (auth)/register.tsx
- On success: completeOnboarding() + redirect to main app
- Validation: email format, password min 6 chars, name required
- Loading state on button
- KeyboardAvoidingView for keyboard handling

## Technical Notes

- Persona selection stored in Zustand onboarding store (new `selectedPersona` field)
- Persona persisted to AsyncStorage so it survives app restart during onboarding
- All animations use React Native Reanimated
- HeroButton rebuilt from scratch (new component, not reusing old one)
- Existing auth store `signUp()` method reused for registration
- `completeOnboarding()` called after successful sign up
- Progress dots component shared across all 5 screens
