import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import { GameId } from '../../../convex/aiTown/ids';
import { ServerGame } from '../../hooks/serverGame';
import { SelectElement } from '../Player';
import PlayerDetails from '../PlayerDetails';

export default function CharactersTab({
  worldId,
  engineId,
  game,
  playerId,
  setSelectedElement,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId });
  const players = [...game.world.players.values()];
  const humanPlayer = players.find((p) => p.human === humanTokenIdentifier);
  const humanConversation = humanPlayer ? game.world.playerConversation(humanPlayer) : undefined;

  // Show the detail view if a player is selected or if we're in a
  // conversation (PlayerDetails auto-selects the other participant).
  if (playerId || humanConversation) {
    return (
      <PlayerDetails
        worldId={worldId}
        engineId={engineId}
        game={game}
        playerId={playerId}
        setSelectedElement={setSelectedElement}
        scrollViewRef={scrollViewRef}
      />
    );
  }

  const now = Date.now();
  const sorted = [...players].sort((a, b) => {
    if (!!a.human !== !!b.human) {
      return a.human ? -1 : 1;
    }
    const nameA = game.playerDescriptions.get(a.id)?.name ?? '';
    const nameB = game.playerDescriptions.get(b.id)?.name ?? '';
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="box">
        <h2 className="bg-brown-700 p-2 font-display text-2xl tracking-wider shadow-solid text-center">
          人物列表
        </h2>
      </div>
      {sorted.map((player) => {
        const description = game.playerDescriptions.get(player.id);
        const conversation = game.world.playerConversation(player);
        let status = '空闲';
        let statusClass = 'text-green-300';
        if (conversation) {
          const otherId = [...conversation.participants.keys()].find((id) => id !== player.id);
          const otherName = otherId && game.playerDescriptions.get(otherId)?.name;
          status = otherName ? `正在与 ${otherName} 对话` : '对话中';
          statusClass = 'text-yellow-300';
        } else if (player.activity && player.activity.until > now) {
          status = player.activity.description;
          statusClass = 'text-blue-200';
        }
        return (
          <a
            key={player.id}
            className="button text-white shadow-solid cursor-pointer pointer-events-auto"
            onClick={() => setSelectedElement({ kind: 'player', id: player.id })}
          >
            <div className="bg-clay-700 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{description?.name ?? player.id}</span>
                {player.human && <span className="text-sm text-brown-100">(人类)</span>}
              </div>
              <div className={'text-base leading-tight ' + statusClass}>{status}</div>
            </div>
          </a>
        );
      })}
      <p className="text-base text-brown-100 leading-tight mt-2">
        点击人物查看资料、记忆，并发起远程对话。也可以直接点击地图上的角色。
      </p>
    </div>
  );
}
