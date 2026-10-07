# Evade Hammond

A multiplayer chase game made with Three.js. One big shared server, no game codes.

```
client/        the game (HTML + JS + pictures). Hosted on Netlify.
server/        the multiplayer server. Hosted on Cloudflare Workers (free).
netlify.toml   tells Netlify to serve the client folder
```

## Updating your GitHub repo

Keep using the same repo (`sky-evade`). Cloudflare is connected to it, so don't rename it.

1. Unzip `evadehammond.zip` and open the `evadehammond` folder.
2. On your GitHub repo page click **Add file** then **Upload files**.
3. Select **everything inside** the folder (`client`, `server`, `netlify.toml`, `README.md`, `.gitignore`, `LICENSE`) and drag it in. Files with the same name get replaced.
4. Click **Commit changes**.

Cloudflare rebuilds the server by itself from that commit. After a minute, open
https://sky-evade.maximilianmoffat.workers.dev and it should say **Evade Hammond server is running**.
If it still says Sky Evade, go to Cloudflare, Workers & Pages, `sky-evade`, Deployments, and check the latest build.

## Netlify setup (once)

1. Go to app.netlify.com and sign up with GitHub.
2. Click **Add new project** (or **Add new site**), then **Import an existing project**, then **GitHub**.
3. Pick the `sky-evade` repo.
4. Set the **project name** to `evadehammond`. That gives you `evadehammond.netlify.app`.
5. Leave the build settings alone: `netlify.toml` already says to publish the `client` folder with no build command.
6. Click **Deploy**.

If `evadehammond` is taken, pick something close like `evadehammond1`. You can rename it later in
Project configuration, General, Change project name.

Every commit to GitHub updates both the game (Netlify) and the server (Cloudflare).

## Controls
| Key | Action |
| --- | --- |
| WASD | move |
| Mouse | look |
| Space | jump (hold to keep hopping) |
| Shift | slide (jump out of a slide to keep the speed) |
| R (hold) | revive a bonked player, 5 seconds |
| E | carry a bonked player on your shoulders (10s, then 30s wait) / drop |
| 1 / 3 | first person / third person |
| Scroll | zoom in third person |

## How the game works
* Rounds last 2 minutes. Everyone drops from the sky onto the middle, where the K-pop entity stands still for 5 seconds (red and white countdown). Nobody can be bonked during that.
* With 3 or more players a second K-pop joins ("SECOND KPOP").
* Touch an entity and you get BONKED: you crawl and have 10 seconds. A friend can hold R for 5 seconds to revive you (the timer pauses while they do).
* You can only be revived once a round. Get bonked again, or run out of time, or fall off, and you are out:
  the first 3 players out become entities (fork bomb, doodle, you are an idiot) and chase everyone else themselves.
  After that, players out become ghosts. Everyone is back to normal next round.
* New players get 3 seconds of spawn protection after landing. New player entities wait 3 seconds before they can bonk.

### The K-pop entity AI
Based on how Evade nextbots work, translated to this game:
* It goes after the closest survivor and only switches when someone else is clearly closer.
* It re-plans its route every 0.15 seconds instead of following an old path. Far away it aims at where you are heading; up close it aims straight at you.
* It can't turn instantly, so cutting sideways at the right moment makes it overshoot.
* It bonks by distance (4 units, Evade's 3.4 studs scaled to our size), not physics.
* If it makes no progress for 4 seconds it re-plans from scratch. The map is one open block, so there are no walls to path around yet.

## Tuning
Numbers are at the top of `server/src/room.js` (entity speed and turning, timers, round length) and in
`client/shared.js` (player speed, slide, jump, entity sizes). If you change speeds, the map size or the
timers, change them in both files. The entity pictures are in `client/entities/`.

## Free tier
* Nothing connects until you press START.
* Standing still sends one update a second instead of ten.
* Tabs left in the background are dropped after 30 seconds and only reconnect when you come back.
* The server stops completely when nobody is playing.

## Running it on your own computer
```
cd server && npm install && npx wrangler dev        # server on localhost:8787
cd client && npx serve .                            # open the link it prints
```
When the page is opened from localhost it connects to the local server automatically.
