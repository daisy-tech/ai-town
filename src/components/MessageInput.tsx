import clsx from 'clsx';
import { useMutation, useQuery } from 'convex/react';
import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { useSendInput } from '../hooks/sendInput';
import { Player } from '../../convex/aiTown/player';
import { Conversation } from '../../convex/aiTown/conversation';

export function MessageInput({
  worldId,
  engineId,
  humanPlayer,
  conversation,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  humanPlayer: Player;
  conversation: Conversation;
}) {
  const descriptions = useQuery(api.world.gameDescriptions, { worldId });
  const humanName = descriptions?.playerDescriptions.find((p) => p.playerId === humanPlayer.id)
    ?.name;
  const inputRef = useRef<HTMLParagraphElement>(null);
  const inflightUuid = useRef<string | undefined>();
  const writeMessage = useMutation(api.messages.writeMessage);
  const startTyping = useSendInput(engineId, 'startTyping');
  const currentlyTyping = conversation.isTyping;

  // Voice input via the browser's Web Speech API (zh-CN).
  const recognitionRef = useRef<any>(null);
  // Text already in the input before/committed during this speech session, so
  // interim (not yet final) recognition results can be re-rendered live.
  const speechBase = useRef('');
  const [listening, setListening] = useState(false);
  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

  const setTypingIndicator = async () => {
    if (currentlyTyping || inflightUuid.current !== undefined) {
      return;
    }
    inflightUuid.current = crypto.randomUUID();
    try {
      // Don't show a toast on error.
      await startTyping({
        playerId: humanPlayer.id,
        conversationId: conversation.id,
        messageUuid: inflightUuid.current,
      });
    } finally {
      inflightUuid.current = undefined;
    }
  };

  const sendMessage = async () => {
    // Stop listening and drop any late-arriving recognition results so they
    // don't reappear in the input after it's cleared.
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
    }
    if (!inputRef.current) {
      return;
    }
    const text = inputRef.current.innerText.trim();
    inputRef.current.innerText = '';
    speechBase.current = '';
    if (!text) {
      return;
    }
    let messageUuid = inflightUuid.current;
    if (currentlyTyping && currentlyTyping.playerId === humanPlayer.id) {
      messageUuid = currentlyTyping.messageUuid;
    }
    messageUuid = messageUuid || crypto.randomUUID();
    await writeMessage({
      worldId,
      playerId: humanPlayer.id,
      conversationId: conversation.id,
      text,
      messageUuid,
    });
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('当前浏览器不支持语音输入，请使用 Chrome 或 Edge 浏览器');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;
    speechBase.current = inputRef.current?.innerText ?? '';
    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          speechBase.current += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (inputRef.current) {
        inputRef.current.innerText = speechBase.current + interim;
      }
    };
    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast.error('请在浏览器中允许使用麦克风');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        toast.error(`语音识别出错：${event.error}`);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    void setTypingIndicator();
  };

  const onKeyDown = async (e: KeyboardEvent) => {
    e.stopPropagation();

    // Set the typing indicator if we're not submitting.
    if (e.key !== 'Enter') {
      await setTypingIndicator();
      return;
    }

    // Send the current message.
    e.preventDefault();
    await sendMessage();
  };
  return (
    <div className="leading-tight mb-6">
      <div className="flex gap-4">
        <span className="uppercase flex-grow">{humanName}</span>
      </div>
      <div className={clsx('bubble', 'bubble-mine')}>
        <p
          className="bg-white -mx-3 -my-1"
          ref={inputRef}
          contentEditable
          style={{ outline: 'none' }}
          tabIndex={0}
          placeholder="在这里输入..."
          onKeyDown={(e) => onKeyDown(e)}
        />
      </div>
      <div className="flex gap-2 mt-1">
        <a
          className="button text-white shadow-solid cursor-pointer pointer-events-auto flex-1"
          onClick={toggleVoice}
        >
          <div
            className={clsx(
              'text-center text-base',
              listening ? 'bg-red-700 animate-pulse' : 'bg-clay-700',
            )}
          >
            <span>{listening ? '🔴 正在听，说完点我' : '🎤 点我说话'}</span>
          </div>
        </a>
        <a
          className="button text-white shadow-solid cursor-pointer pointer-events-auto flex-1"
          onClick={() => void sendMessage()}
        >
          <div className="text-center text-base bg-clay-700">
            <span>发送 ➤</span>
          </div>
        </a>
      </div>
    </div>
  );
}
