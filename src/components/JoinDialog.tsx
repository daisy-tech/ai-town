import { toast } from 'react-toastify';
import { useConvex, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { ConvexError } from 'convex/values';
import { Id } from '../../convex/_generated/dataModel';
import { KeyboardEvent, useCallback, useEffect, useState } from 'react';
import ReactModal from 'react-modal';
import { waitForInput } from '../hooks/sendInput';
import { DEFAULT_NAME, MAX_PLAYER_NAME_LENGTH } from '../../convex/constants';

export const NAME_STORAGE_KEY = 'ai-town-player-name';

export function savedPlayerName(): string | null {
  const name = localStorage.getItem(NAME_STORAGE_KEY)?.trim();
  return name || null;
}

// Join the world with the given name. Returns true on success; errors are
// shown as toasts.
export function useJoinWorld() {
  const join = useMutation(api.world.joinWorld);
  const convex = useConvex();
  return useCallback(
    async (worldId: Id<'worlds'>, name: string): Promise<boolean> => {
      console.log(`Joining game as ${name}`);
      let inputId;
      try {
        inputId = await join({ worldId, name });
      } catch (e: any) {
        if (e instanceof ConvexError) {
          toast.error(e.data);
          return false;
        }
        throw e;
      }
      try {
        await waitForInput(convex, inputId);
      } catch (e: any) {
        toast.error(e.message);
        return false;
      }
      return true;
    },
    [convex, join],
  );
}

// Modal asking for a display name, then joining the world with it.
export default function JoinDialog({
  open,
  onClose,
  worldId,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  worldId: Id<'worlds'>;
  onJoined?: () => void;
}) {
  const joinWorld = useJoinWorld();
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    if (open) {
      setNameInput(localStorage.getItem(NAME_STORAGE_KEY) || DEFAULT_NAME);
    }
  }, [open]);

  const confirmJoin = async () => {
    const name = nameInput.trim();
    if (!name) {
      toast.error('名字不能为空');
      return;
    }
    if (name.length > MAX_PLAYER_NAME_LENGTH) {
      toast.error(`名字最长${MAX_PLAYER_NAME_LENGTH}个字符`);
      return;
    }
    localStorage.setItem(NAME_STORAGE_KEY, name);
    onClose();
    if (await joinWorld(worldId, name)) {
      onJoined?.();
    }
  };

  const onNameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void confirmJoin();
    }
  };

  return (
    <ReactModal
      isOpen={open}
      onRequestClose={onClose}
      style={modalStyles}
      contentLabel="Choose name modal"
      ariaHideApp={false}
    >
      <div className="font-body flex flex-col gap-4">
        <h1 className="text-center text-4xl font-bold font-display game-title">取个名字</h1>
        <p className="text-center">宠物伙伴们会用这个名字称呼你、记住你。</p>
        <input
          className="w-full p-2 text-xl text-black text-center outline-none"
          value={nameInput}
          maxLength={MAX_PLAYER_NAME_LENGTH}
          autoFocus
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={onNameKeyDown}
        />
        <div className="flex justify-center gap-6">
          <a
            className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={() => void confirmJoin()}
          >
            <div className="bg-clay-700 px-4 text-center">
              <span>加入</span>
            </div>
          </a>
          <a
            className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
            onClick={onClose}
          >
            <div className="bg-clay-700 px-4 text-center">
              <span>取消</span>
            </div>
          </a>
        </div>
      </div>
    </ReactModal>
  );
}

export const modalStyles = {
  overlay: {
    backgroundColor: 'rgb(0, 0, 0, 75%)',
    zIndex: 12,
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    width: '360px',
    maxWidth: '90%',

    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};
