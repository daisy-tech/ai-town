// 后端配置系统：支持在本地存储和Convex之间切换

export type BackendType = 'local' | 'convex';

export interface BackendConfig {
  type: BackendType;
  convex?: {
    url: string;
  };
  local?: {
    dataDir: string;
  };
}

// 从环境变量读取配置
function loadConfigFromEnv(): BackendConfig {
  const backendType = (process.env.BACKEND_TYPE || 'local') as BackendType;

  const config: BackendConfig = {
    type: backendType,
  };

  if (backendType === 'convex') {
    config.convex = {
      url: process.env.VITE_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || '',
    };

    if (!config.convex.url) {
      console.warn('⚠️  Convex URL未配置，将回退到本地模式');
      config.type = 'local';
    }
  }

  if (backendType === 'local' || config.type === 'local') {
    config.local = {
      dataDir: process.env.LOCAL_DATA_DIR || './data',
    };
  }

  return config;
}

// 全局配置实例
let currentConfig: BackendConfig = loadConfigFromEnv();

// 获取当前配置
export function getBackendConfig(): BackendConfig {
  return { ...currentConfig };
}

// 切换后端类型
export function switchBackend(type: BackendType): void {
  console.log(`🔄 切换后端模式: ${currentConfig.type} → ${type}`);

  currentConfig.type = type;

  if (type === 'local' && !currentConfig.local) {
    currentConfig.local = {
      dataDir: './data',
    };
  }

  console.log(`✅ 当前后端模式: ${type}`);
}

// 检查Convex是否可用
export async function checkConvexAvailability(): Promise<boolean> {
  if (!currentConfig.convex?.url) {
    return false;
  }

  try {
    // 尝试ping Convex服务器
    const response = await fetch(currentConfig.convex.url, {
      method: 'HEAD',
    });
    return response.ok;
  } catch (error) {
    console.warn('Convex服务器不可用:', error);
    return false;
  }
}

// 自动选择最佳后端
export async function autoSelectBackend(): Promise<BackendType> {
  if (currentConfig.type === 'local') {
    console.log('🏠 使用本地存储模式');
    return 'local';
  }

  console.log('🔍 检查Convex可用性...');
  const convexAvailable = await checkConvexAvailability();

  if (convexAvailable) {
    console.log('☁️  Convex可用，使用云端模式');
    return 'convex';
  } else {
    console.log('🏠 Convex不可用，回退到本地模式');
    switchBackend('local');
    return 'local';
  }
}

// 显示当前配置信息
export function printConfig(): void {
  console.log('\n' + '='.repeat(50));
  console.log('🔧 后端配置信息');
  console.log('='.repeat(50));
  console.log(`模式: ${currentConfig.type}`);

  if (currentConfig.type === 'convex' && currentConfig.convex) {
    console.log(`Convex URL: ${currentConfig.convex.url}`);
  }

  if (currentConfig.local) {
    console.log(`本地数据目录: ${currentConfig.local.dataDir}`);
  }

  console.log(`LLM提供商: ${process.env.OPENAI_API_KEY ? 'OpenAI' : 'Mock (模拟)'}`);

  console.log('='.repeat(50) + '\n');
}

// 验证配置
export function validateConfig(): boolean {
  if (currentConfig.type === 'convex') {
    if (!currentConfig.convex?.url) {
      console.error('❌ Convex模式需要配置VITE_CONVEX_URL');
      return false;
    }
  }

  if (currentConfig.type === 'local') {
    if (!currentConfig.local?.dataDir) {
      console.error('❌ 本地模式需要配置数据目录');
      return false;
    }
  }

  return true;
}

// 导出配置工具
export const config = {
  get: getBackendConfig,
  switch: switchBackend,
  autoSelect: autoSelectBackend,
  print: printConfig,
  validate: validateConfig,
  checkConvex: checkConvexAvailability,
};
