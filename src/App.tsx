import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';
import a16zImg from '../assets/a16z.png';
import convexImg from '../assets/convex.svg';
import starImg from '../assets/star.svg';
import helpImg from '../assets/help.svg';
// import { UserButton } from '@clerk/clerk-react';
// import { Authenticated, Unauthenticated } from 'convex/react';
// import LoginButton from './components/buttons/LoginButton.tsx';
import { useState } from 'react';
import ReactModal from 'react-modal';
import MusicButton from './components/buttons/MusicButton.tsx';
import Button from './components/buttons/Button.tsx';
import InteractButton from './components/buttons/InteractButton.tsx';
import FreezeButton from './components/FreezeButton.tsx';
import { MAX_HUMAN_PLAYERS } from '../convex/constants.ts';
import PoweredByConvex from './components/PoweredByConvex.tsx';

export default function Home() {
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-between font-body game-background">
      <PoweredByConvex />

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
            欢迎来到奥特曼光之国！这里是奥特战士们生活和训练的地方。你可以选择作为<i>观察者</i>旁观，也可以<i>登录加入</i>与奥特战士们互动。
          </p>
          <h2 className="text-4xl mt-4">观察模式</h2>
          <p>
            点击并拖动可以在光之国中移动视角，滚动鼠标可以缩放。点击任意奥特战士可以查看他们的对话历史。
          </p>
          <h2 className="text-4xl mt-4">互动模式</h2>
          <p>
            登录后，你可以加入光之国，直接与奥特战士们对话！点击"加入互动"按钮，你的角色会出现在地图上，脚下有一个高亮圆圈。
          </p>
          <p className="text-2xl mt-2">操作说明：</p>
          <p className="mt-4">点击地图上的位置可以移动。</p>
          <p className="mt-4">
            要与奥特战士对话，点击他们，然后点击"开始对话"按钮，他们会向你走来。当他们靠近时，对话就会开始，你们可以互相交流。你可以随时关闭对话面板或走开来结束对话。他们也可能主动邀请你对话，你会在消息面板中看到接受按钮。
          </p>
          <p className="mt-4">
            光之国最多支持{MAX_HUMAN_PLAYERS}位人类访客同时在线。如果你闲置超过5分钟，会自动离开光之国。
          </p>
        </div>
      </ReactModal>
      {/*<div className="p-3 absolute top-0 right-0 z-10 text-2xl">
        <Authenticated>
          <UserButton afterSignOutUrl="/ai-town" />
        </Authenticated>

        <Unauthenticated>
          <LoginButton />
        </Unauthenticated>
      </div> */}

      <div className="w-full lg:h-screen min-h-screen relative isolate overflow-hidden lg:p-8 shadow-2xl flex flex-col justify-start">
        <h1 className="mx-auto text-4xl p-3 sm:text-8xl lg:text-9xl font-bold font-display leading-none tracking-wide game-title w-full text-left sm:text-center sm:w-auto">
          光之国
        </h1>

        <div className="max-w-xs md:max-w-xl lg:max-w-none mx-auto my-4 text-center text-base sm:text-xl md:text-2xl text-white leading-tight shadow-solid">
          奥特战士们生活的虚拟世界，在这里他们交流、训练，守护宇宙和平。
          {/* <Unauthenticated>
            <div className="my-1.5 sm:my-0" />
            Log in to join the town
            <br className="block sm:hidden" /> and the conversation!
          </Unauthenticated> */}
        </div>

        <Game />

        <footer className="justify-end bottom-0 left-0 w-full flex items-center mt-4 gap-3 p-6 flex-wrap pointer-events-none">
          <div className="flex gap-4 flex-grow pointer-events-none">
            <FreezeButton />
            <MusicButton />
            <Button href="https://github.com/a16z-infra/ai-town" imgUrl={starImg}>
              源码
            </Button>
            <InteractButton />
            <Button imgUrl={helpImg} onClick={() => setHelpModalOpen(true)}>
              帮助
            </Button>
          </div>
          <a href="https://a16z.com">
            <img className="w-8 h-8 pointer-events-auto" src={a16zImg} alt="a16z" />
          </a>
          <a href="https://convex.dev/c/ai-town">
            <img className="w-20 h-8 pointer-events-auto" src={convexImg} alt="Convex" />
          </a>
        </footer>
        <ToastContainer position="bottom-right" autoClose={2000} closeOnClick theme="dark" />
      </div>
    </main>
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
