# AGEROUS

> **Describe what happens. Watch the world live through it.**

Agerous is an AI-native 3D community simulation built for the **Victoria VR AI Builder Hackathon 2026**.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Architecture

```
User text
  ↓
AI Event Interpreter  (src/simulation/eventInterpreter.js)
  ↓
Structured Event JSON
  ↓
Simulation Engine     (src/simulation/simulationEngine.js)
  ↓
World State           (src/simulation/worldState.js)
  ↓
NPC Behavior          (src/simulation/npcSystem.js)
  ↓
3D Renderer           (src/renderer/worldRenderer.js)
  ↓
Canvas
```

## Demo Events

| Input | What happens |
|---|---|
| `A severe flood is coming` | Rain → water rises → roads flood → school closes → church becomes shelter → NPCs evacuate |
| `The local election is tomorrow` | Campaigns begin → NPCs canvass → election day → voting → winner stored in history |
| `School is closed tomorrow` | Students stay home, teachers idle, school greys out |
| `A large food shipment arrived` | Market activity up, more customers, lower prices |
| `Sunday service this morning` | Congregation walks to church |

## API Key

Enter an OpenAI API key on first load for richer event interpretation.
Without one, the built-in rule-based matcher handles all the demo events above.

## Stack

- **Three.js** — 3D rendering
- **Vite** — build tool
- **Vanilla JS modules** — no framework overhead
- **OpenAI GPT-4o-mini** (optional) — natural language → structured event
