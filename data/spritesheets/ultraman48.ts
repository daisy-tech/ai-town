import { SpritesheetData } from './types';

// 奥特曼（致敬风格）角色共用的帧定义：每人一张独立贴图，48x48 帧，3帧×4方向。
const CELL = 48;

function frame(col: number, row: number) {
  return {
    frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
    sourceSize: { w: CELL, h: CELL },
    spriteSourceSize: { x: 0, y: 0 },
  };
}

export const data: SpritesheetData = {
  frames: {
    down: frame(0, 0),
    down2: frame(1, 0),
    down3: frame(2, 0),
    left: frame(0, 1),
    left2: frame(1, 1),
    left3: frame(2, 1),
    right: frame(0, 2),
    right2: frame(1, 2),
    right3: frame(2, 2),
    up: frame(0, 3),
    up2: frame(1, 3),
    up3: frame(2, 3),
  },
  meta: {
    scale: '1',
  },
  animations: {
    left: ['left', 'left2', 'left3'],
    right: ['right', 'right2', 'right3'],
    up: ['up', 'up2', 'up3'],
    down: ['down', 'down2', 'down3'],
  },
};
