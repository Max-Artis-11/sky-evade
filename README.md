# Sky Evade

A small multiplayer chase game made with Three.js. One big shared server, no game codes.

```
client/   the game (HTML + JS). Hosted on Vercel.
server/   the multiplayer server. Hosted on Cloudflare Workers (free).
```

## Why Cloudflare for multiplayer

Vercel cannot keep websockets open, so the multiplayer part lives on Cloudflare Workers with a Durable Object.
The free plan needs no credit card and never pauses your project. It has daily limits that reset at 00:00 UTC.
If you ever go over, the server just refuses connections until the reset. You are never charged.

Rough numbers for the free plan with this game: about 50 player hours per day (each player sends 10 updates a second).

## Setup (about 15 minutes, all in the browser)

### 1. Put the code on GitHub
1. Go to github.com, click **New repository**, name it `sky-evade`, click **Create repository**.
2. On the new repo page click **uploading an existing file**.
3. Unzip the zip, open the `sky-evade` folder, select **everything inside it** (`client`, `server`, `README.md`, `.gitignore`) and drag it in.
4. Click **Commit changes**.

### 2. Put the server on Cloudflare (free)
1. Make a free account at dash.cloudflare.com.
2. Go to **Workers & Pages**, click **Create**, then **Import a repository** and connect GitHub.
3. Pick your `sky-evade` repo.
4. In the settings, set the **root directory / path** to `server`. Leave the deploy command as `npx wrangler deploy`.
5. Click **Deploy** and wait for it to finish.
6. Open the worker and copy its address. It looks like `https://sky-evade-server.YOURNAME.workers.dev`.
   Opening it in a tab should say "Sky Evade server is running".

If the dashboard gives you trouble, the command line way always works (needs Node.js installed):
```
cd server
npx wrangler login
npx wrangler deploy
```

### 3. Tell the game where the server is
1. On GitHub open `client/config.js`, click the pencil to edit.
2. Change the address to yours, with `wss://` at the start and `/ws` at the end:
   `export const SERVER_URL = 'wss://sky-evade-server.YOURNAME.workers.dev/ws';`
3. Commit.

### 4. Put the game on Vercel
1. Go to vercel.com, sign in with GitHub, click **Add New** then **Project**.
2. Import your `sky-evade` repo.
3. Set **Root Directory** to `client`. Framework preset: **Other**. No build command.
4. Click **Deploy**. You get a link like `sky-evade.vercel.app`. Send it to your friends.

From now on, any change you commit to GitHub updates the game on Vercel and the server on Cloudflare automatically.

## Controls
| Key | Action |
| --- | --- |
| WASD | move |
| Mouse | look (click the game first) |
| Space | jump (hold to keep hopping) |
| Shift | slide (jump out of a slide to keep the speed) |
| R (hold) | revive a downed player, 5 seconds |
| E | carry a downed player on your shoulders (30s max, then 30s cooldown) / drop |
| 1 / 3 | first person / third person |
| Scroll | zoom in third person |

## How the game works
* The red chaser is 1.25x faster than you. It aims at where you were a quarter second ago and cannot turn instantly, so cutting sideways at the last moment (juking) makes it overshoot.
* It goes after the closest player. After it downs someone it picks the next closest.
* One chaser, plus one more for every 4 players (max 3).
* Downed: you crawl slowly and have 30 seconds. Someone holding R next to you for 5 seconds revives you (the timer pauses while they do). If the timer runs out, or you fall off the map, you go to the lobby and come back in after 8 seconds.

## Tuning
All the numbers are at the top of `server/src/room.js` (chaser speed, turning, reaction delay, timers) and in `client/shared.js` (player speed, slide, jump).
If you change `RUN_SPEED` or the map size, change it in both files.

To use a picture for the chaser, put a PNG in `client/` and set `CHASER_IMAGE` in `client/config.js`.

## Running it on your own computer
```
cd server && npm install && npx wrangler dev        # server on localhost:8787
cd client && npx serve .                            # open the link it prints
```
When the page is opened from localhost it automatically connects to the local server.
