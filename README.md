# Bait Al Nokhada - 3D Tent Design System

A 3D tent configurator built with React, Babylon.js, and TypeScript.

## Features

- Interactive 3D tent visualization
- Configurable bay count (1-20 bays)
- Toggle frame and cover visibility
- Dark theme CPQ-style UI
- Mobile responsive design
- Touch-friendly controls

## Tech Stack

- **React 19** - UI framework
- **Babylon.js 8** - 3D rendering engine
- **react-babylonjs** - React bindings for Babylon.js
- **TypeScript** - Type safety
- **Vite** - Build tool

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Project Structure

```
src/
  App.tsx              # Main app with UI
  components/          # Shared components
  tents/               # Tent implementations
  lib/                 # Utilities and constants
public/
  tents/               # GLB 3D model files
docs/                  # Documentation
```

## Documentation

See [docs/](docs/) for detailed documentation:
- [Development Guide](docs/development.md)
- [Copilot Instructions](docs/copilot-instructions.md)
- [Performance](docs/performance.md)

## License

Proprietary - Bait Al Nokhada
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
