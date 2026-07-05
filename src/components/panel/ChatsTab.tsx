import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Doc, Id } from '../../../convex/_generated/dataModel';
import { GameId } from '../../../convex/aiTown/ids';
import { ServerGame } from '../../hooks/serverGame';
import { Messages } from '../Messages';

export default function ChatsTab({
  worldId,
  engineId,
  game,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const [selectedId, setSelectedId] = useState<GameId<'conversations'>>();
  const archived = useQuery(api.world.recentConversations, { worldId });

  const playerName = (playerId: string) =>
    game.playerDescriptions.get(playerId as GameId<'players'>)?.name ?? playerId;

  const activeConversations = [...game.world.conversations.values()].filter(
    (c) => c.numMessages > 0,
  );

  if (selectedId) {
    const activeDoc = game.world.conversations.get(selectedId);
    const archivedDoc = archived?.find((c) => c.id === selectedId);
    const back = (
      <a
        className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto self-start"
        onClick={() => setSelectedId(undefined)}
      >
        <div className="bg-clay-700 px-3">
          <span>« 返回列表</span>
        </div>
      </a>
    );
    if (!activeDoc && !archivedDoc) {
      // The conversation just ended and hasn't been archived yet (or archives
      // are still loading): fall back to the list.
      return (
        <div className="flex flex-col gap-3">
          {back}
          <p className="text-base text-brown-100">对话已结束，稍后可在历史记录中查看。</p>
        </div>
      );
    }
    const participants = activeDoc
      ? [...activeDoc.participants.keys()]
      : (archivedDoc as Doc<'archivedConversations'>).participants;
    return (
      <div className="flex flex-col gap-3">
        {back}
        <div className="box">
          <h2 className="bg-brown-700 p-2 text-lg text-center">
            {participants.map((id) => playerName(id)).join(' × ')}
          </h2>
        </div>
        <Messages
          worldId={worldId}
          engineId={engineId}
          inConversationWithMe={false}
          conversation={
            activeDoc
              ? { kind: 'active', doc: activeDoc }
              : { kind: 'archived', doc: archivedDoc as Doc<'archivedConversations'> }
          }
          scrollViewRef={scrollViewRef}
        />
      </div>
    );
  }

  const item = (opts: {
    id: GameId<'conversations'>;
    participants: string[];
    numMessages: number;
    time: number;
    ongoing: boolean;
  }) => (
    <a
      key={opts.id}
      className="button text-white shadow-solid cursor-pointer pointer-events-auto"
      onClick={() => setSelectedId(opts.id)}
    >
      <div className="bg-clay-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{opts.participants.map((id) => playerName(id)).join(' × ')}</span>
          {opts.ongoing && <span className="text-sm text-green-300">进行中</span>}
        </div>
        <div className="text-base leading-tight text-brown-100">
          {opts.numMessages} 条消息 · {new Date(opts.time).toLocaleString()}
        </div>
      </div>
    </a>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="box">
        <h2 className="bg-brown-700 p-2 font-display text-2xl tracking-wider shadow-solid text-center">
          对话历史
        </h2>
      </div>
      {activeConversations.length > 0 && (
        <>
          <h3 className="text-lg text-brown-100">正在进行</h3>
          {activeConversations.map((c) =>
            item({
              id: c.id,
              participants: [...c.participants.keys()],
              numMessages: c.numMessages,
              time: c.lastMessage?.timestamp ?? c.created,
              ongoing: true,
            }),
          )}
        </>
      )}
      <h3 className="text-lg text-brown-100">历史对话</h3>
      {archived === undefined && <p className="text-base text-brown-100">加载中...</p>}
      {archived && archived.length === 0 && (
        <p className="text-base text-brown-100">还没有历史对话。</p>
      )}
      {archived &&
        archived.map((c) =>
          item({
            id: c.id as GameId<'conversations'>,
            participants: c.participants,
            numMessages: c.numMessages,
            time: c.ended,
            ongoing: false,
          }),
        )}
    </div>
  );
}
