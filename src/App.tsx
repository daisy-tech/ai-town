import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';

export default function Home() {
  return (
    <main className="relative flex h-screen flex-col font-body game-background overflow-hidden">
      <div className="w-full h-full flex flex-col p-2 sm:p-4 gap-2">
        <h1 className="shrink-0 mx-auto py-1 text-3xl sm:text-5xl font-bold font-display leading-tight tracking-wide game-title text-center">
          疯狂动物城
        </h1>
        <Game />
      </div>
      <ToastContainer position="bottom-right" autoClose={2000} closeOnClick theme="dark" />
    </main>
  );
}
