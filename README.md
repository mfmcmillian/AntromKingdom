# Kingdom of Antrom

A Decentraland SDK7 scene that prototypes an RTS inside the Kingdom of Antrom. The scene includes resource gathering, worker-driven construction, base expansion, guard production, combat commands, and a defensive enemy economy AI.

## Features

- Top-down RTS-style gameplay in Decentraland.
- Worker gathering for rocks, wood, and meat.
- Buildable Temples, Homesteads, Barracks, and Fireplaces.
- Homesteads train workers and increase supply.
- Barracks train Antrom Gaurds.
- RTS building placement with model preview, footprint, grid snapping, and blocked placement feedback.
- Cancel placement and cancel in-progress construction.
- Rally/spawn points for worker and guard production.
- Guard move commands, spread-out attack positions, and attack animation loops.
- Defensive enemy AI with its own economy, workers, buildings, guards, expansions, and timed attack waves.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the Decentraland preview:

```bash
npm start
```

Build the scene:

```bash
npm run build
```

Deploy with the SDK when ready:

```bash
npm run deploy
```

## Gameplay

The player starts with a Temple and workers. Workers can gather resources from rocks, trees, and pigs, then deliver them to the nearest completed player Temple.

Workers can build:

- `Temple`: resource dropoff and expansion point.
- `Homestead`: trains workers and adds supply.
- `Barracks`: trains Antrom Gaurds.
- `Fireplace`: camp utility building.

Antrom Gaurds can be selected individually or as a group. Use `Move` to send them to a ground position, or click enemy buildings to attack. Guards spread around their target instead of clumping.

## Enemy AI

The enemy starts with its own Temple and the same starting worker count as the player. It uses the shared map resources but keeps a separate resource bank and supply count.

The AI:

- Sends workers to gather rocks, wood, and meat.
- Builds Homesteads and Barracks.
- Trains more workers and guards over time.
- Expands with additional Temples.
- Keeps defenders at home.
- Sends timed attack waves toward the player's Temples when it has surplus guards.

## Project Structure

- `src/index.ts`: scene entry point.
- `src/rtsGame.ts`: main RTS systems, gameplay loop, combat, construction, and AI.
- `src/ui.tsx`: React-ECS HUD and command card.
- `src/rts/config.ts`: static gameplay config, assets, positions, building definitions, and unit definitions.
- `src/rts/state.ts`: mutable runtime state.
- `src/rts/types.ts`: shared RTS TypeScript types.
- `models/`: GLB assets used by units, resources, buildings, and environment.
- `sounds/`: gathering sound effects.

## Notes

This is an active prototype. Some internal names still use `soldier` for compatibility, while the player-facing unit is the Antrom Gaurd.