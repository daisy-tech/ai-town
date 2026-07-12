import { useState } from 'react';
import ReactModal from 'react-modal';
import starImg from '../../../assets/star.svg';
import helpImg from '../../../assets/help.svg';
import Button from '../buttons/Button';
import InteractButton from '../buttons/InteractButton';
import RenameButton from '../buttons/RenameButton';
import MusicButton from '../buttons/MusicButton';
import FreezeButton from '../FreezeButton';
import { MAX_HUMAN_PLAYERS } from '../../../convex/constants';

export default function SettingsTab() {
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <ReactModal
        isOpen={helpModalOpen}
        onRequestClose={() => setHelpModalOpen(false)}
        style={modalStyles}
        contentLabel="Help modal"
        ariaHideApp={false}
      >
        <div className="font-body">
          <h1 className="text-center text-6xl font-bold font-display game-title">帮助</h1>
          <p>
            欢迎来到疯狂动物城！这里是宠物伙伴们学习、生活和交朋友的地方。你可以作为
            <i>观察者</i>旁观，也可以点击「加入互动」与宠物伙伴们对话。
          </p>
          <h2 className="text-4xl mt-4">观察模式</h2>
          <p>
            点击并拖动可以在小镇中移动视角，滚动鼠标可以缩放。点击任意宠物伙伴（或右侧「人物」列表）可以查看他们的资料、记忆和对话历史。
          </p>
          <h2 className="text-4xl mt-4">互动模式</h2>
          <p>
            点击「加入互动」后，你的角色会出现在地图上，脚下有一个高亮圆圈。点击地图上的位置可以移动。
          </p>
          <p className="mt-4">
            要与宠物伙伴对话，在「人物」面板中选中对方并点击「发起对话」。只要对方空闲并同意，就可以直接在面板中聊天，不需要先走到对方身边。宠物伙伴也可能主动邀请你对话，你会在面板中看到接受按钮。
          </p>
          <p className="mt-4">
            小镇最多支持{MAX_HUMAN_PLAYERS}位访客同时在线。如果你闲置超过5分钟，会自动离开小镇。
          </p>
        </div>
      </ReactModal>
      <div className="box">
        <h2 className="bg-brown-700 p-2 font-display text-2xl tracking-wider shadow-solid text-center">
          设置
        </h2>
      </div>
      <div className="flex flex-col items-start gap-4">
        <InteractButton />
        <RenameButton />
        <MusicButton />
        <FreezeButton />
        <Button imgUrl={helpImg} onClick={() => setHelpModalOpen(true)}>
          帮助
        </Button>
        <Button href="https://github.com/daisy-tech/ai-town" imgUrl={starImg}>
          源码
        </Button>
      </div>
      <p className="text-base text-brown-100 leading-tight">
        提示：加入互动后，在「人物」面板选中宠物伙伴即可发起对话。
      </p>
    </div>
  );
}

const modalStyles = {
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
    maxWidth: '50%',

    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};
