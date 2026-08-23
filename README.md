# DecentraCraft

A Decentraland SDK7 real-time strategy game. Three factions, campaign, skirmish, and ranked multiplayer on Genesis City LAND.

## Getting Started

```bash
npm install
npm start
```

Build and deploy:

```bash
npm run build
npm run deploy
```

## Project Structure

- `src/index.ts`: scene entry (client vs authoritative server)
- `src/rtsGame.ts`: match loop, combat, construction, and AI
- `src/ui.tsx`: React-ECS HUD, menus, and commander profile
- `src/rts/`: races, campaign, maps, multiplayer session
- `src/server/main.ts`: authoritative lobby, saves, and leaderboards
- `website/`: public site and live board APIs

Play: https://play.decentraland.org/?NETWORK=mainnet&position=-17,123
