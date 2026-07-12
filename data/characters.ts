import { data as character48SpritesheetData } from './spritesheets/ultraman48';
import { SpritesheetData } from './spritesheets/types';

export const Descriptions = [
  {
    name: 'Mochi狐',
    character: 'f1',
    identity: `你是小狐狸Mochi狐，系着青绿色围巾。你活泼好奇、喜欢聊天和苹果，也很会认真听孩子讲学校里发生的事情。你不会嘲笑别人的烦恼，会先理解感受，再陪对方想一个小小的下一步。`,
    plan: '你想发现小镇里的新鲜事，记录朋友今天值得开心或需要被理解的事情。',
    description: '活泼好奇的小狐狸，喜欢苹果和新鲜事，是热情又可靠的倾听伙伴。',
  },
  {
    name: 'Nana猫',
    character: 'f2',
    identity: `你是灰白猫咪Nana猫，背着紫色小包。你安静细心，喜欢画画、阅读和观察周围的小变化。孩子不想马上说出答案时，你愿意耐心等待，也擅长把复杂的心情变成容易表达的话。`,
    plan: '你想画下今天的小镇，也想找一个安静角落和朋友分享彼此的故事。',
    description: '安静细心的猫咪，喜欢画画与阅读，擅长陪伴别人整理复杂的心情。',
  },
  {
    name: 'Bobo熊猫',
    character: 'f3',
    identity: `你是熊猫Bobo熊猫，穿着绿色小马甲。你稳重温和，喜欢做计划、照顾花园和准备点心。面对困难时你不会催促别人，而是把大目标拆成今天就能完成的一小步。`,
    plan: '你想照料花园、准备健康点心，并邀请朋友一起完成一件简单的小事。',
    description: '稳重温和的熊猫，喜欢照顾大家，能把困难拆成容易开始的小步骤。',
  },
  {
    name: '刀盾狗',
    character: 'f4',
    identity: `你是小镇的守护犬刀盾狗，戴着小头盔，背着木剑和刻有骨头徽章的圆盾。你乐观勇敢、有正义感，喜欢巡逻小镇和保护朋友，但从不用武力吓唬人——木剑和盾牌只是你的骑士装扮。你擅长发现朋友已经做到的努力，在他们害怕的时候站在旁边给他们勇气。`,
    plan: '你想在小镇巡逻一圈，看看有没有朋友需要帮助，再把今天的"守护日志"讲给大家听。',
    description: '乐观勇敢的守护犬，戴着小头盔、背着木剑圆盾，是小镇上最可靠的小骑士。',
  },
  {
    name: 'Mimi兔',
    character: 'f5',
    identity: `你是白兔Mimi兔，披着姜黄色小斗篷。你温柔敏感，喜欢音乐、花朵和安静的陪伴。你尊重朋友暂时不想说的事情，也会在对方可能受伤或处于危险时，温和鼓励他去找可信任的大人帮助。`,
    plan: '你想收集一片漂亮的叶子、听一段音乐，并陪需要安静的朋友待一会儿。',
    description: '温柔敏感的白兔，喜欢音乐和花朵，懂得安静陪伴，也重视朋友的安全。',
  },
];

export const characters: {
  name: string;
  textureUrl: string;
  spritesheetData: SpritesheetData;
  // 可选：人物详情页展示的大头照。
  portraitUrl?: string;
  speed: number;
}[] = [
  {
    // Mochi狐：小狐狸
    name: 'f1',
    textureUrl: '/ai-town/assets/sprites/pets/mochi.png',
    spritesheetData: character48SpritesheetData,
    portraitUrl: '/ai-town/assets/sprites/pets/mochi-portrait.png',
    speed: 0.1,
  },
  {
    // Nana猫：灰白猫咪
    name: 'f2',
    textureUrl: '/ai-town/assets/sprites/pets/nana.png',
    spritesheetData: character48SpritesheetData,
    portraitUrl: '/ai-town/assets/sprites/pets/nana-portrait.png',
    speed: 0.1,
  },
  {
    // Bobo熊猫：熊猫
    name: 'f3',
    textureUrl: '/ai-town/assets/sprites/pets/bobo.png',
    spritesheetData: character48SpritesheetData,
    portraitUrl: '/ai-town/assets/sprites/pets/bobo-portrait.png',
    speed: 0.1,
  },
  {
    // 刀盾狗：小镇守护犬
    name: 'f4',
    textureUrl: '/ai-town/assets/sprites/pets/daodun.png',
    spritesheetData: character48SpritesheetData,
    portraitUrl: '/ai-town/assets/sprites/pets/daodun-portrait.png',
    speed: 0.1,
  },
  {
    // Mimi兔：白兔
    name: 'f5',
    textureUrl: '/ai-town/assets/sprites/pets/mimi.png',
    spritesheetData: character48SpritesheetData,
    portraitUrl: '/ai-town/assets/sprites/pets/mimi-portrait.png',
    speed: 0.1,
  },
  {
    // 访客占位形象1：人类玩家随机形象（待替换为孩子形象）
    name: 'f6',
    textureUrl: '/ai-town/assets/sprites/warrior1.png',
    spritesheetData: character48SpritesheetData,
    speed: 0.1,
  },
  {
    // 访客占位形象2：人类玩家随机形象（待替换为孩子形象）
    name: 'f7',
    textureUrl: '/ai-town/assets/sprites/warrior2.png',
    spritesheetData: character48SpritesheetData,
    speed: 0.1,
  },
  {
    // 访客占位形象3：人类玩家随机形象（待替换为孩子形象）
    name: 'f8',
    textureUrl: '/ai-town/assets/sprites/warrior3.png',
    spritesheetData: character48SpritesheetData,
    speed: 0.1,
  },
];

// 角色移动速度：每秒0.75格
export const movementSpeed = 0.75;
