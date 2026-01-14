# Hlásím se - Style Guide

Vizuální identita aplikace založená na warm/friendly tématu.

## Barvy

### Primární paleta (Orange)

| Token | Hex | Použití |
|-------|-----|---------|
| `brand-50` | `#fff7ed` | Pozadí karet, subtle backgrounds |
| `brand-100` | `#ffedd5` | Hover stavy, light accents |
| `brand-500` | `#f97316` | Primární tlačítka, ikony, aktivní stavy |
| `brand-600` | `#ea580c` | Hover na primárních prvcích |
| `brand-900` | `#7c2d12` | Text v badge, tmavé akcenty |

### Accent (Rose)

| Token | Hex | Použití |
|-------|-----|---------|
| `accent` | `#f43f5e` | Sekundární akcenty, upozornění, CTA alternativa |

### Neutrální

| Token | Hex | Použití |
|-------|-----|---------|
| `bg` | `#fffaf5` | Pozadí stránky/aplikace |
| `surface` | `#ffffff` | Karty, modály, panely |
| `text` | `#431407` | Hlavní text |
| `text-muted` | `#9a8c88` | Sekundární text, placeholdery |

## Typografie

### Font Family

```css
font-family: 'Outfit', sans-serif;
```

### Váhy

- **300** - Light (subtitles)
- **400** - Regular (body text)
- **600** - SemiBold (buttons, labels)
- **800** - ExtraBold (headings)

### Velikosti

| Použití | Velikost |
|---------|----------|
| H1 (Hero) | `text-5xl` / `text-7xl` (desktop) |
| H2 | `text-3xl` |
| H3 | `text-xl` |
| Body | `text-base` |
| Small | `text-sm` |
| Caption | `text-xs` |

## Border Radius

Warm téma používá **extra zaoblené** rohy pro přátelský vzhled.

| Token | Hodnota | Použití |
|-------|---------|---------|
| `radius-app` | `2rem` (32px) | Karty, panely, modály |
| `radius-btn` | `2rem` (32px) | Tlačítka, inputy |
| `rounded-full` | `9999px` | Avatary, badges, ikony |

## Stíny

### Základní stín

```css
shadow-sm  /* Karty, panely */
shadow-lg  /* Elevated elementy */
shadow-xl  /* Modály, dropdowny */
```

### Brand Shadow (pro CTA tlačítka)

```css
shadow-lg shadow-orange-500/30
```

## Komponenty

### Tlačítka

**Primární:**
```css
bg-brand-500 text-white rounded-[2rem] font-semibold
hover:brightness-110
shadow-lg shadow-brand-500/30
```

**Sekundární:**
```css
bg-surface text-text border border-gray-200 rounded-[2rem]
hover:bg-gray-50
```

### Karty

```css
bg-surface rounded-2xl shadow-sm border border-brand-100/50 p-6
```

### Glass Panel

```css
background: rgba(255, 255, 255, 0.6);
border: 1px solid rgba(255, 237, 213, 0.5);
backdrop-filter: blur(10px);
```

### Badge / Chip

```css
bg-brand-100 text-brand-900 px-3 py-1 rounded-full text-xs font-bold
```

### Status Indicator

```css
/* Aktivní/Online */
w-2 h-2 rounded-full bg-accent animate-pulse

/* S textem */
flex items-center gap-1 text-accent font-bold
```

## Ikony

Používáme **Phosphor Icons** (https://phosphoricons.com/)

```html
<script src="https://unpkg.com/@phosphor-icons/web"></script>

<!-- Použití -->
<i class="ph ph-hand-waving"></i>
<i class="ph ph-fingerprint"></i>
<i class="ph ph-timer"></i>
```

### Velikosti ikon

| Kontext | Třída |
|---------|-------|
| Inline s textem | `text-base` |
| V tlačítku | `text-xl` |
| Feature ikona | `text-2xl` |
| Hero ikona | `text-5xl` |

## Animace

### Pulse (pro CTA)

```css
@keyframes subtle-pulse {
    0% { transform: scale(1); }
    70% { transform: scale(1.02); }
    100% { transform: scale(1); }
}
animation: subtle-pulse 2s infinite;
```

### Přechody

```css
transition: all 0.3s ease;      /* Obecné */
transition: color 0.2s;         /* Barvy */
transition: transform 0.1s;     /* Scale efekty */
```

### Active state (tlačítka)

```css
active:scale-95
```

## Layout

### Max Width

```css
max-w-7xl mx-auto /* Hlavní kontejner */
```

### Spacing

- Padding stránky: `px-6` (mobile), `px-12` (desktop)
- Gap mezi sekcemi: `py-12` / `py-20`
- Gap v kartách: `gap-4` / `gap-6`

## CSS Variables

```css
:root {
    --color-brand-50: #fff7ed;
    --color-brand-100: #ffedd5;
    --color-brand-500: #f97316;
    --color-brand-600: #ea580c;
    --color-brand-900: #7c2d12;
    --color-accent: #f43f5e;
    --color-surface: #ffffff;
    --color-bg: #fffaf5;
    --color-text: #431407;
    --color-text-muted: #9a8c88;
    --radius-app: 2rem;
    --radius-btn: 2rem;
    --font-app: 'Outfit', sans-serif;
}
```
