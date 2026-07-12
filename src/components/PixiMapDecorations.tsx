import { Sprite } from '@pixi/react';
import { WorldMap } from '../../convex/aiTown/worldMap';

const WORLD_CONTENT_Z_INDEX = 1000;

export function PixiMapDecorations({ map }: { map: WorldMap }) {
  return (
    <>
      {map.staticSprites
        .filter((sprite) => sprite.sortY !== undefined)
        .map((sprite, index) => (
          <Sprite
            key={`${sprite.url}-${sprite.x}-${sprite.y}-${index}`}
            image={sprite.url}
            x={sprite.x}
            y={sprite.y}
            width={sprite.w}
            height={sprite.h}
            zIndex={WORLD_CONTENT_Z_INDEX + sprite.sortY!}
          />
        ))}
    </>
  );
}
