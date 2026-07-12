import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { SelectElement } from './Player';
import { Messages } from './Messages';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import { Player } from '../../convex/aiTown/player';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';
import JoinDialog, { savedPlayerName, useJoinWorld } from './JoinDialog';
import { characters } from '../../data/characters';

export default function PlayerDetails({
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
  // Always select the other player if we're in a conversation with them.
  if (humanPlayer && humanConversation) {
    const otherPlayerIds = [...humanConversation.participants.keys()].filter(
      (p) => p !== humanPlayer.id,
    );
    playerId = otherPlayerIds[0];
  }

  const player = playerId && game.world.players.get(playerId);
  const playerConversation = player && game.world.playerConversation(player);

  const previousConversation = useQuery(
    api.world.previousConversation,
    playerId ? { worldId, playerId } : 'skip',
  );

  const playerDescription = playerId && game.playerDescriptions.get(playerId);
  const isAgent = playerId && !![...game.world.agents.values()].find((a) => a.playerId === playerId);
  const memories = useQuery(
    api.memoryViewer.getMemoriesByPlayerId,
    playerId && isAgent ? { playerId, limit: 15 } : 'skip',
  );

  const startConversation = useSendInput(engineId, 'startConversation');
  const acceptInvite = useSendInput(engineId, 'acceptInvite');
  const rejectInvite = useSendInput(engineId, 'rejectInvite');
  const leaveConversation = useSendInput(engineId, 'leaveConversation');

  // "开始对话" for visitors who haven't joined yet: join with the saved name
  // (asking only on first use), then automatically send the invite once our
  // player exists in the world.
  const joinWorld = useJoinWorld();
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<GameId<'players'>>();
  const humanPlayerId = humanPlayer?.id;
  useEffect(() => {
    if (!pendingInvite || !humanPlayerId) {
      return;
    }
    setPendingInvite(undefined);
    void toastOnError(
      startConversation({ playerId: humanPlayerId, invitee: pendingInvite, remote: true }),
    );
  }, [pendingInvite, humanPlayerId]);
  const leaveWorld = useMutation(api.world.leaveWorld);
  const onLeaveWorld = () => {
    console.log(`Leaving game for player ${humanPlayerId}`);
    void leaveWorld({ worldId });
    setSelectedElement(undefined);
  };
  const joinAndInvite = (invitee: GameId<'players'>) => {
    const name = savedPlayerName();
    if (name) {
      void joinWorld(worldId, name).then((ok) => {
        if (ok) {
          setPendingInvite(invitee);
        } else {
          setJoinDialogOpen(true);
        }
      });
    } else {
      setJoinDialogOpen(true);
    }
  };

  if (!playerId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        点击地图上的宠物伙伴或人物列表查看详情
      </div>
    );
  }
  if (!player) {
    return null;
  }
  const isMe = humanPlayer && player.id === humanPlayer.id;
  const canInvite = !isMe && !playerConversation && humanPlayer && !humanConversation;
  const sameConversation =
    !isMe &&
    humanPlayer &&
    humanConversation &&
    playerConversation &&
    humanConversation.id === playerConversation.id;

  const humanStatus =
    humanPlayer && humanConversation && humanConversation.participants.get(humanPlayer.id)?.status;
  const playerStatus = playerConversation && playerConversation.participants.get(playerId)?.status;

  const haveInvite = sameConversation && humanStatus?.kind === 'invited';
  const waitingForAccept =
    sameConversation && playerConversation.participants.get(playerId)?.status.kind === 'invited';
  const waitingForNearby =
    sameConversation && playerStatus?.kind === 'walkingOver' && humanStatus?.kind === 'walkingOver';

  const inConversationWithMe =
    sameConversation &&
    playerStatus?.kind === 'participating' &&
    humanStatus?.kind === 'participating';

  const onStartConversation = async () => {
    if (!humanPlayer || !playerId) {
      return;
    }
    console.log(`Starting conversation`);
    await toastOnError(
      startConversation({ playerId: humanPlayer.id, invitee: playerId, remote: true }),
    );
  };
  const onAcceptInvite = async () => {
    if (!humanPlayer || !humanConversation || !playerId) {
      return;
    }
    await toastOnError(
      acceptInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onRejectInvite = async () => {
    if (!humanPlayer || !humanConversation) {
      return;
    }
    await toastOnError(
      rejectInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onLeaveConversation = async () => {
    if (!humanPlayer || !inConversationWithMe || !humanConversation) {
      return;
    }
    await toastOnError(
      leaveConversation({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  // const pendingSuffix = (inputName: string) =>
  //   [...inflightInputs.values()].find((i) => i.name === inputName) ? ' opacity-50' : '';

  const pendingSuffix = (s: string) => '';
  const portraitUrl =
    playerDescription &&
    characters.find((c) => c.name === playerDescription.character)?.portraitUrl;
  return (
    <>
      <div className="flex gap-4">
        <div className="box w-3/4 sm:w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-2xl sm:text-4xl tracking-wider shadow-solid text-center">
            {playerDescription?.name}
          </h2>
        </div>
        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => setSelectedElement(undefined)}
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-4 h-4 sm:w-5 sm:h-5" src={closeImg} />
          </h2>
        </a>
      </div>
      {portraitUrl && (
        <div className="box mt-4">
          <div className="bg-brown-900 flex justify-center p-3">
            <img
              className="w-32 h-32 sm:w-40 sm:h-40"
              style={{ imageRendering: 'pixelated' }}
              src={portraitUrl}
              alt={playerDescription?.name}
            />
          </div>
        </div>
      )}
      {isMe && (
        <a
          className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
          onClick={onLeaveWorld}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>离开小镇</span>
          </div>
        </a>
      )}
      {!humanPlayer && !isMe && !playerConversation && (
        <>
          <JoinDialog
            open={joinDialogOpen}
            onClose={() => setJoinDialogOpen(false)}
            worldId={worldId}
            onJoined={() => setPendingInvite(playerId)}
          />
          <a
            className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={() => joinAndInvite(playerId!)}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>开始对话</span>
            </div>
          </a>
        </>
      )}
      {!isMe && playerConversation && !sameConversation && (
        <a className="mt-6 button text-white shadow-solid text-xl pointer-events-auto opacity-50 cursor-not-allowed">
          <div className="h-full bg-clay-700 text-center">
            <span>正在与他人对话中...</span>
          </div>
        </a>
      )}
      {canInvite && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('startConversation')
          }
          onClick={onStartConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>发起对话</span>
          </div>
        </a>
      )}
      {waitingForAccept && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>等待对方同意...</span>
          </div>
        </a>
      )}
      {waitingForNearby && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>正在建立对话...</span>
          </div>
        </a>
      )}
      {inConversationWithMe && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('leaveConversation')
          }
          onClick={onLeaveConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>结束对话</span>
          </div>
        </a>
      )}
      {haveInvite && (
        <>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('acceptInvite')
            }
            onClick={onAcceptInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>接受</span>
            </div>
          </a>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('rejectInvite')
            }
            onClick={onRejectInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>拒绝</span>
            </div>
          </a>
        </>
      )}
      {!playerConversation && player.activity && player.activity.until > Date.now() && (
        <div className="box flex-grow mt-6">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center">
            {player.activity.description}
          </h2>
        </div>
      )}
      <div className="desc my-6">
        <p className="leading-tight -m-4 bg-brown-700 text-base sm:text-sm">
          {!isMe && playerDescription?.description}
          {isMe && <i>这就是你！</i>}
          {!isMe && inConversationWithMe && (
            <>
              <br />
              <br />(<i>正在与你对话！</i>)
            </>
          )}
        </p>
      </div>
      {!isMe && playerConversation && playerStatus?.kind === 'participating' && (
        <Messages
          worldId={worldId}
          engineId={engineId}
          inConversationWithMe={inConversationWithMe ?? false}
          conversation={{ kind: 'active', doc: playerConversation }}
          humanPlayer={humanPlayer}
          scrollViewRef={scrollViewRef}
        />
      )}
      {!playerConversation && previousConversation && (
        <>
          <div className="box flex-grow">
            <h2 className="bg-brown-700 text-lg text-center">往昔对话</h2>
          </div>
          <Messages
            worldId={worldId}
            engineId={engineId}
            inConversationWithMe={false}
            conversation={{ kind: 'archived', doc: previousConversation }}
            humanPlayer={humanPlayer}
            scrollViewRef={scrollViewRef}
          />
        </>
      )}
      {isAgent && memories && memories.length > 0 && (
        <>
          <div className="box flex-grow mt-6">
            <h2 className="bg-brown-700 text-lg text-center">记忆</h2>
          </div>
          <div className="chats text-base sm:text-sm">
            <div className="bg-brown-200 text-black p-2">
              {memories.map((memory) => (
                <div key={memory._id} className="leading-tight mb-4">
                  <div className="flex gap-2 text-xs text-brown-700">
                    <span className="flex-grow">{MEMORY_TYPE_LABELS[memory.type] ?? memory.type}</span>
                    <span>重要度 {memory.importance.toFixed(0)}</span>
                    <time dateTime={memory.createdAt.toString()}>
                      {new Date(memory.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="bg-white p-1">{memory.description}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  conversation: '对话',
  reflection: '反思',
  relationship: '关系',
};
