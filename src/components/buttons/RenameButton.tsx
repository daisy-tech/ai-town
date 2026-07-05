import Button from './Button';
import interactImg from '../../../assets/interact.svg';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';
import { KeyboardEvent, useState } from 'react';
import ReactModal from 'react-modal';
import { toast } from 'react-toastify';
import { useSendInput } from '../../hooks/sendInput';
import { useServerGame } from '../../hooks/serverGame';
import { toastOnError } from '../../toasts';
import { MAX_PLAYER_NAME_LENGTH } from '../../../convex/constants';
import { NAME_STORAGE_KEY, modalStyles } from '../JoinDialog';

// Lets a joined human player change their display name.
export default function RenameButton() {
  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;
  const game = useServerGame(worldId);
  const humanTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');
  const humanPlayerId =
    game && [...game.world.players.values()].find((p) => p.human === humanTokenIdentifier)?.id;
  const currentName = humanPlayerId ? game?.playerDescriptions.get(humanPlayerId)?.name : undefined;

  const changeName = useSendInput(engineId as Id<'engines'>, 'changeName');
  const [modalOpen, setModalOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const openModal = () => {
    setNameInput(currentName ?? localStorage.getItem(NAME_STORAGE_KEY) ?? '');
    setModalOpen(true);
  };

  const confirmRename = async () => {
    const name = nameInput.trim();
    if (!name) {
      toast.error('名字不能为空');
      return;
    }
    if (name.length > MAX_PLAYER_NAME_LENGTH) {
      toast.error(`名字最长${MAX_PLAYER_NAME_LENGTH}个字符`);
      return;
    }
    setModalOpen(false);
    localStorage.setItem(NAME_STORAGE_KEY, name);
    if (!humanPlayerId) {
      // Not in the game yet: just remember the name for the next join.
      toast.success(`已保存，下次加入时将使用"${name}"`);
      return;
    }
    if (name === currentName) {
      return;
    }
    await toastOnError(changeName({ playerId: humanPlayerId, name }));
  };

  const onNameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void confirmRename();
    }
  };

  return (
    <>
      <ReactModal
        isOpen={modalOpen}
        onRequestClose={() => setModalOpen(false)}
        style={modalStyles}
        contentLabel="Rename modal"
        ariaHideApp={false}
      >
        <div className="font-body flex flex-col gap-4">
          <h1 className="text-center text-4xl font-bold font-display game-title">修改名字</h1>
          <p className="text-center">改名后，奥特战士们会用新名字称呼你。</p>
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
              onClick={() => void confirmRename()}
            >
              <div className="bg-clay-700 px-4 text-center">
                <span>确定</span>
              </div>
            </a>
            <a
              className="button text-white shadow-solid text-xl cursor-pointer pointer-events-auto"
              onClick={() => setModalOpen(false)}
            >
              <div className="bg-clay-700 px-4 text-center">
                <span>取消</span>
              </div>
            </a>
          </div>
        </div>
      </ReactModal>
      <Button
        imgUrl={interactImg}
        onClick={openModal}
        title={currentName ? `当前名字：${currentName}` : '设置下次加入时使用的名字'}
      >
        修改名字
      </Button>
    </>
  );
}
