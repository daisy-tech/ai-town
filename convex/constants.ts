export const ACTION_TIMEOUT = 120_000; // more time for local dev
// export const ACTION_TIMEOUT = 60_000;// normally fine

export const IDLE_WORLD_TIMEOUT = 5 * 60 * 1000;
export const WORLD_HEARTBEAT_INTERVAL = 60 * 1000;

export const MAX_STEP = 10 * 60 * 1000;
export const TICK = 16;
export const STEP_INTERVAL = 1000;

export const PATHFINDING_TIMEOUT = 60 * 1000;
export const PATHFINDING_BACKOFF = 1000;
export const CONVERSATION_DISTANCE = 1.3;
export const MIDPOINT_THRESHOLD = 4;
export const TYPING_TIMEOUT = 15 * 1000;
export const COLLISION_THRESHOLD = 0.75;

// How many human players can be in a world at once.
export const MAX_HUMAN_PLAYERS = 8;

// Don't talk to anyone for 15s after having a conversation.
export const CONVERSATION_COOLDOWN = 15000;

// Don't do another activity for 10s after doing one.
export const ACTIVITY_COOLDOWN = 10_000;

// Don't talk to a player within 60s of talking to them.
export const PLAYER_CONVERSATION_COOLDOWN = 60000;

// Invite 80% of invites that come from other agents.
export const INVITE_ACCEPT_PROBABILITY = 0.8;

// Wait for 1m for invites to be accepted.
export const INVITE_TIMEOUT = 60000;

// Wait for another player to say something before jumping in.
export const AWKWARD_CONVERSATION_TIMEOUT = 60_000; // more time locally
// export const AWKWARD_CONVERSATION_TIMEOUT = 20_000;

// Leave a conversation after participating too long.
export const MAX_CONVERSATION_DURATION = 10 * 60_000; // more time locally
// export const MAX_CONVERSATION_DURATION = 2 * 60_000;

// Leave a conversation if it has more than 8 messages;
export const MAX_CONVERSATION_MESSAGES = 8;

// Wait for 1s after sending an input to the engine. We can remove this
// once we can await on an input being processed.
export const INPUT_DELAY = 1000;

// How many memories to get from the agent's memory.
// This is over-fetched by 10x so we can prioritize memories by more than relevance.
export const NUM_MEMORIES_TO_SEARCH = 3;

// Wait for at least two seconds before sending another message.
export const MESSAGE_COOLDOWN = 2000;

// Don't run a turn of the agent more than once a second.
export const AGENT_WAKEUP_THRESHOLD = 1000;

// How old we let *transient* data (inputs, raw town transcripts, embedding
// cache) get before we vacuum it. Long-term memories are NOT on this
// schedule anymore: they are kept indefinitely and bounded by the per-player
// quota below (TownMind P0).
export const VACUUM_MAX_AGE = 3 * 24 * 60 * 60 * 1000;
export const DELETE_BATCH_SIZE = 64;

// Raw companion (child ↔ pet) chat transcripts are kept for 90 days, then
// deleted. Derived memories (summaries) are kept beyond that. This is the
// retention policy confirmed for child privacy compliance.
export const COMPANION_RAW_CHAT_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

// Hot memory quota per player. Keeps the memoryEmbeddings vector index small
// enough for a 4GB host (the index struggles past ~100k rows overall).
// When a player exceeds the quota, the lowest-value memories (importance +
// recency) are deleted together with their embeddings.
export const MAX_MEMORIES_PER_PLAYER = 500;
// Bound on quota deletions per player per daily run.
export const MEMORY_QUOTA_DELETE_CAP = 200;

// A companion session with no activity for this long is considered abandoned
// (client crashed / lost connection without calling endVisit): the sweeper
// closes it and summarizes it into memory.
export const COMPANION_SESSION_STALE_AGE = 6 * 60 * 60 * 1000;
// Wait at least this long after a session ends before the sweeper re-tries
// memorizing it, so the endVisit-scheduled summary gets a chance to finish.
export const COMPANION_MEMORIZE_GRACE = 15 * 60 * 1000;

export const HUMAN_IDLE_TOO_LONG = 5 * 60 * 1000;

export const ACTIVITIES = [
  { description: '安静地看绘本', emoji: '📖', duration: 60_000 },
  { description: '写今天的日记', emoji: '✏️', duration: 60_000 },
  { description: '给花园浇水', emoji: '🌼', duration: 60_000 },
  { description: '收集心愿叶', emoji: '🍃', duration: 60_000 },
  { description: '练习画画', emoji: '🎨', duration: 60_000 },
  { description: '在草地上打盹', emoji: '😴', duration: 60_000 },
  { description: '哼着歌散步', emoji: '🎵', duration: 60_000 },
];

export const ENGINE_ACTION_DURATION = 30000;

// Bound the number of pathfinding searches we do per game step.
export const MAX_PATHFINDS_PER_STEP = 16;

export const DEFAULT_NAME = '人类朋友';
export const MAX_PLAYER_NAME_LENGTH = 12;

// Activity shown while an adopted pet is "home" chatting with its child in
// the companion client. Other agents won't invite a pet in this state.
export const COMPANION_VISIT_ACTIVITY = '回家陪伴小主人';
// How long a single companion visit lasts before the client must renew it.
export const COMPANION_VISIT_DURATION = 5 * 60 * 1000;
