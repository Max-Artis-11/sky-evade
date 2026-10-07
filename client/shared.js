// Numbers the client needs. Keep RUN_SPEED and the map numbers in sync with
// server/src/room.js
export const MAP_HALF = 100;
export const LOBBY = { x: 0, y: 20, z: -180, half: 22 };

export const RUN_SPEED = 18;
export const CRAWL_SPEED = 3.2;
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
export const CARRY_RANGE = 5;
export const REVIVE_TIME = 5;

export const CHASER_W = 8;
export const CHASER_H = 9;

export const SEND_HZ = 10;           // position updates per second
export const INTERP_MS = 110;        // how far behind we draw other players

// Animation flag bits sent over the network
export const A_MOVING = 1, A_AIR = 2, A_SLIDE = 4;

export const ALIVE = 0, DOWNED = 1, IN_LOBBY = 2;

export const PLATFORMS = [
  { x: 0, z: 0, half: MAP_HALF, top: 0, bottom: -6 },
  { x: LOBBY.x, z: LOBBY.z, half: LOBBY.half, top: LOBBY.y, bottom: LOBBY.y - 3 },
];
