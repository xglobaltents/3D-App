# Building Guide

How to build and run the 3D Tent Configurator.

---

## Prerequisites

- Node.js 18+
- npm or yarn

---

## Development

```bash
# Install dependencies
npm install

# Start dev server (port 8080)
npm run dev
```

Open http://localhost:8080

---

## Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

Output: `dist/`

---

## Project Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite --port 8080` | Start dev server |
| `build` | `tsc && vite build` | Production build |
| `preview` | `vite preview` | Preview build |
| `lint` | `eslint .` | Run linter |

---

## Environment

Create `.env` for environment variables:
```env
VITE_API_URL=https://api.example.com
```

Access in code:
```typescript
const apiUrl = import.meta.env.VITE_API_URL
```

---

## Deployment

### Vercel
```bash
npm install -g vercel
vercel
```

### Manual
Upload `dist/` folder to any static hosting.

---

## Adding Dependencies

```bash
# Runtime dependency
npm install package-name

# Dev dependency
npm install -D package-name

# Babylon.js packages
npm install @babylonjs/core @babylonjs/loaders @babylonjs/gui
```

---

## TypeScript Aliases

Configured in `vite.config.ts` and `tsconfig.json`:

| Alias | Path |
|-------|------|
| `@/` | `src/` |

Usage:
```typescript
import { loadGLB } from '@/lib/utils/GLBLoader'
import { TENT_SPECS } from '@/tents/PremiumArchTent/15m/specs'
```

---

## Troubleshooting

### GLB not loading
- Check file is in `public/` folder
- Path should NOT include `public/` (e.g., `/tents/...` not `/public/tents/...`)
- Check browser console for 404

### TypeScript errors
```bash
# Check for type errors
npx tsc --noEmit
```

### Vite cache issues
```bash
# Clear cache
rm -rf node_modules/.vite
npm run dev
```

---

## Folder Reference

```
3D-App/
├── public/
│   ├── tents/           # Tent GLB files
│   └── accessories/     # Accessory GLB files
├── src/
│   ├── App.tsx          # Main app
│   ├── components/      # Shared components
│   ├── tents/           # Tent implementations
│   ├── lib/             # Utilities & accessories
│   └── types/           # TypeScript types
├── docs/
│   ├── COPILOT.md       # AI assistant guide
│   ├── PERFORMANCE.md   # Performance tips
│   └── BUILDING.md      # This file
├── package.json
├── vite.config.ts
└── tsconfig.json
```
