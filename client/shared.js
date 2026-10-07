// Numbers the client needs. Keep RUN_SPEED, the map size and the timers in
// sync with server/src/room.js
export const MAP_HALF = 100;
export const TILE_SIZE = 5;          // floor tiles are 5 x 5 units

export const RUN_SPEED = 18;
export const CRAWL_SPEED = 3.2;
export const ENTITY_SPEED = 19.8;    // players who became entities (1.1x, no jump or slide)
export const SLIDE_SPEED = 30;
export const SLIDE_TIME = 0.8;
export const SLIDE_COOLDOWN = 1.6;   // seconds from the start of one slide to the next
export const JUMP_SPEED = 24;
export const GRAVITY = 70;
export const GROUND_ACCEL = 110;
export const AIR_CONTROL = 3.5;
export const FALL_LIMIT = -70;

export const EYE_HEIGHT = 4.6;
export const CARRY_HEIGHT = 5.1;
export const REVIVE_RANGE = 5;       // a bit under the server's 5.5 so it never feels flaky
export const REVIVE_TIME = 5;
export const DOWN_TIME = 10;
export const ROUND_TIME = 120;
export const INTRO_TIME = 5;

export const SEND_EVERY = 0.1;       // position updates while moving (10 per second)
export const IDLE_SEND_EVERY = 1;    // when standing still, just a heartbeat
export const INTERP_MS = 110;        // how far behind we draw other players

// Animation flag bits sent over the network
export const A_MOVING = 1, A_AIR = 2, A_SLIDE = 4;

export const ALIVE = 0, DOWNED = 1, ENTITY = 2, GHOST = 3;

// Entity pictures. 0 is the K-pop (the AI ones), 1 to 3 are for players
// who die. h is the height in world units, the width follows the picture.
export const SKINS = [
  { file: 'entities/kpop.jpg', h: 11, pixel: false },
  { file: 'entities/fork.png', h: 8, pixel: true },
  { file: 'entities/doodle.png', h: 10, pixel: false },
  { file: 'entities/idiot.png', h: 10, pixel: false },
];
