# SUSTAINI-FEUD

A premium, real-time sustainability-themed Family Feud-style game built for the Sustainicity college event.

## Game rules

- One question per round.
- Exactly six answers per question.
- Points are always **50 / 40 / 30 / 20 / 10 / 5**.
- Players go one by one.
- Each player gets exactly one attempt.
- There are **no strikes** and **no stealing**.
- The player locks an answer; the host decides which board answer matches it or marks it wrong.
- A revealed answer cannot be awarded again.
- The host controls the next player.
- The round ends when all six answers are revealed or every player has attempted once.

## Project structure

```text
sustaini-feud/
├── package.json
├── server.js
├── render.yaml
├── README.md
├── data/
│   └── questions.json
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## Run locally

Requirements: Node.js 18+.

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

For a live event, open the host on the projector/laptop and let players join from their phones using the same deployed URL.

## Deploy to GitHub + Render

1. Create a new GitHub repository.
2. Upload all files from this project, preserving the folder structure.
3. Connect the GitHub repository to Render as a **Web Service**.
4. Build command: `npm install`
5. Start command: `npm start`
6. Render will use `render.yaml` for the same settings if Blueprint deployment is selected.

No database or environment variables are required for this version. Room and game state live in server memory, so restarting/redeploying the service clears active games.

## Host controls

- **START ROUND** selects a random sustainability question.
- Click a matching answer card after the player submits to award its points.
- Click **WRONG / 0** for an incorrect answer.
- Click **NEXT PLAYER →** only after resolving the current answer.
- The host can see live players, current turn, submitted answer, revealed answers and scores.

## Reliability notes

Socket.IO keeps host and player screens synchronized without page refreshes. The server validates the room, role, current player, one-attempt rule, answer availability, resolution state and next-player flow rather than trusting the browser.

If the host disconnects, players are shown **Host disconnected**. If a player disconnects, they are removed from the active player list and the turn advances to the next eligible player when possible.
