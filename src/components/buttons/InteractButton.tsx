import Button from './Button';
import interactImg from '../../../assets/interact.svg';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useState } from 'react';
import { useServerGame } from '../../hooks/serverGame';
import JoinDialog, { savedPlayerName, useJoinWorld } from '../JoinDialog';

export default function InteractButton() {
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const game = useServerGame(worldId);
  const humanTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');
  const userPlayerId =
    game && [...game.world.players.values()].find((p) => p.human === humanTokenIdentifier)?.id;
  const leave = useMutation(api.world.leaveWorld);
  const joinWorld = useJoinWorld();
  const isPlaying = !!userPlayerId;

  const [joinDialogOpen, setJoinDialogOpen] = useState(false);

  const joinOrLeaveGame = () => {
    if (!worldId || game === undefined) {
      return;
    }
    if (isPlaying) {
      console.log(`Leaving game for player ${userPlayerId}`);
      void leave({ worldId });
      return;
    }
    // Join silently with the saved name; only ask on first use (or if the
    // join fails, e.g. the name is taken).
    const name = savedPlayerName();
    if (name) {
      void joinWorld(worldId, name).then((ok) => {
        if (!ok) {
          setJoinDialogOpen(true);
        }
      });
    } else {
      setJoinDialogOpen(true);
    }
  };

  return (
    <>
      {worldId && (
        <JoinDialog
          open={joinDialogOpen}
          onClose={() => setJoinDialogOpen(false)}
          worldId={worldId}
        />
      )}
      <Button imgUrl={interactImg} onClick={joinOrLeaveGame}>
        {isPlaying ? '离开' : '加入互动'}
      </Button>
    </>
  );
}
