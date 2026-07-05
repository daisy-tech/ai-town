import { useEffect, useRef, useState } from 'react';
import PixiGame from './PixiGame.tsx';

import { useElementSize } from 'usehooks-ts';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useWorldHeartbeat } from '../hooks/useWorldHeartbeat.ts';
import { useHistoricalTime } from '../hooks/useHistoricalTime.ts';
import { DebugTimeManager } from './DebugTimeManager.tsx';
import { GameId } from '../../convex/aiTown/ids.ts';
import { useServerGame } from '../hooks/serverGame.ts';
import SettingsTab from './panel/SettingsTab.tsx';
import CharactersTab from './panel/CharactersTab.tsx';
import ChatsTab from './panel/ChatsTab.tsx';

export const SHOW_DEBUG_UI = !!import.meta.env.VITE_SHOW_DEBUG_UI;

type TabId = 'settings' | 'characters' | 'chats';

const TABS: { id: TabId; label: string }[] = [
  { id: 'characters', label: '人物' },
  { id: 'chats', label: '对话历史' },
  { id: 'settings', label: '设置' },
];

export default function Game() {
  const convex = useConvex();
  const [selectedElement, setSelectedElement] = useState<{
    kind: 'player';
    id: GameId<'players'>;
  }>();
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('characters');
  const [gameWrapperRef, { width, height }] = useElementSize();

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;

  const game = useServerGame(worldId);

  // Send a periodic heartbeat to our world to keep it alive.
  useWorldHeartbeat();

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  const { historicalTime, timeManager } = useHistoricalTime(worldState?.engine);

  const scrollViewRef = useRef<HTMLDivElement>(null);

  // If the human player is in a conversation, make sure the panel is open on
  // the characters tab so they can see and answer messages.
  const humanTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');
  const humanPlayer =
    game && humanTokenIdentifier
      ? [...game.world.players.values()].find((p) => p.human === humanTokenIdentifier)
      : undefined;
  const humanConversation =
    game && humanPlayer ? game.world.playerConversation(humanPlayer) : undefined;
  const inConversation = !!humanConversation;
  useEffect(() => {
    if (inConversation) {
      setPanelOpen(true);
      setActiveTab('characters');
    }
  }, [inConversation]);

  const onSelectElement = (element?: { kind: 'player'; id: GameId<'players'> }) => {
    setSelectedElement(element);
    if (element) {
      setPanelOpen(true);
      setActiveTab('characters');
    }
  };

  if (!worldId || !engineId || !game) {
    return null;
  }
  return (
    <>
      {SHOW_DEBUG_UI && <DebugTimeManager timeManager={timeManager} width={200} height={100} />}
      <div className="mx-auto w-full flex-1 min-h-0 flex flex-col lg:flex-row game-frame">
        {/* Game world */}
        <div className="relative flex-1 min-h-0 overflow-hidden bg-brown-900" ref={gameWrapperRef}>
          <div className="absolute inset-0">
            <Stage width={width} height={height} options={{ backgroundColor: 0x7ab5ff }}>
              {/* Re-propagate context because contexts are not shared between renderers.
https://github.com/michalochman/react-pixi-fiber/issues/145#issuecomment-531549215 */}
              <ConvexProvider client={convex}>
                <PixiGame
                  game={game}
                  worldId={worldId}
                  engineId={engineId}
                  width={width}
                  height={height}
                  historicalTime={historicalTime}
                  setSelectedElement={onSelectElement}
                />
              </ConvexProvider>
            </Stage>
          </div>
          {!panelOpen && (
            <button
              className="absolute top-3 right-3 z-10 pointer-events-auto button text-white shadow-solid text-xl"
              onClick={() => setPanelOpen(true)}
            >
              <div className="inline-block bg-clay-700 px-3">
                <span>« 面板</span>
              </div>
            </button>
          )}
        </div>
        {/* Side panel */}
        {panelOpen && (
          <div className="w-full lg:w-[380px] h-[45vh] lg:h-auto shrink-0 flex flex-col border-t-8 lg:border-t-0 lg:border-l-8 border-brown-900 bg-brown-800 text-brown-100">
            <div className="flex items-stretch shrink-0 bg-brown-900 text-white">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={
                    'flex-1 py-2 font-display text-2xl tracking-wider ' +
                    (activeTab === tab.id
                      ? 'bg-brown-700 text-white'
                      : 'bg-brown-900 text-brown-100 hover:bg-brown-800')
                  }
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
              <button
                className="px-3 font-display text-2xl bg-brown-900 text-brown-100 hover:bg-brown-800"
                title="收起面板"
                onClick={() => setPanelOpen(false)}
              >
                »
              </button>
            </div>
            <div className="flex-1 flex flex-col overflow-y-auto px-4 py-4 sm:px-6" ref={scrollViewRef}>
              {activeTab === 'settings' && <SettingsTab />}
              {activeTab === 'characters' && (
                <CharactersTab
                  worldId={worldId}
                  engineId={engineId}
                  game={game}
                  playerId={selectedElement?.id}
                  setSelectedElement={setSelectedElement}
                  scrollViewRef={scrollViewRef}
                />
              )}
              {activeTab === 'chats' && (
                <ChatsTab worldId={worldId} engineId={engineId} game={game} scrollViewRef={scrollViewRef} />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
