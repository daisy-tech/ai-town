// 本地后端测试脚本
import { localStorage, type Memory, type Player } from './storage';
import * as llm from './llm';
import { config } from './config';

console.log('\n🧪 本地后端系统测试\n');

async function runTests() {
  // 显示配置
  config.print();

  // 测试1: 存储系统
  console.log('📦 测试1: 本地存储系统');
  console.log('-'.repeat(50));

  // 清空旧数据
  localStorage.clearAll();

  // 添加角色
  const players: Player[] = [
    {
      id: 'p1',
      name: '迪迦奥特曼',
      description: '温柔坚定的光之勇士',
      character: 'f1',
    },
    {
      id: 'p2',
      name: '赛罗奥特曼',
      description: '热血正义的战士',
      character: 'f2',
    },
  ];

  players.forEach(p => localStorage.addPlayer(p));
  console.log(`✅ 添加了 ${players.length} 个角色\n`);

  // 添加对话记忆
  const memory1 = localStorage.addMemory({
    playerId: 'p1',
    playerName: '迪迦奥特曼',
    description: '与赛罗奥特曼讨论了守护地球的使命，他分享了在宇宙巡逻的经验。',
    importance: 8,
    type: 'conversation',
    metadata: {
      otherPlayerId: 'p2',
      otherPlayerName: '赛罗奥特曼',
      conversationId: 'c1',
    },
  });

  const memory2 = localStorage.addMemory({
    playerId: 'p1',
    playerName: '迪迦奥特曼',
    description: '在训练场上修炼光线技能，感觉自己的能力提升了。',
    importance: 6,
    type: 'conversation',
  });

  const memory3 = localStorage.addMemory({
    playerId: 'p1',
    playerName: '迪迦奥特曼',
    description: '与梦比优斯讨论了团队合作的重要性。',
    importance: 7,
    type: 'conversation',
    metadata: {
      otherPlayerId: 'p3',
      otherPlayerName: '梦比优斯奥特曼',
    },
  });

  console.log(`✅ 添加了 ${3} 条记忆\n`);

  // 测试搜索
  console.log('🔍 测试记忆搜索:');
  const searchResults = localStorage.searchMemories('p1', ['赛罗', '守护', '地球'], 3);
  console.log(`   找到 ${searchResults.length} 条相关记忆:`);
  searchResults.forEach((m, idx) => {
    console.log(`   ${idx + 1}. [重要性:${m.importance}] ${m.description.substring(0, 50)}...`);
  });
  console.log();

  // 测试反思触发
  console.log('💭 测试反思触发:');
  const shouldReflect = localStorage.shouldReflect('p1', 15); // 降低阈值测试
  console.log(`   是否应该反思: ${shouldReflect ? '是' : '否'}`);

  if (shouldReflect) {
    const reflection = localStorage.addReflection(
      'p1',
      '迪迦奥特曼',
      '通过最近的交流，我深刻理解了团队合作和守护地球使命的重要性。',
      [memory1.id, memory3.id]
    );
    console.log(`   ✅ 生成反思记忆: ${reflection.description.substring(0, 50)}...`);
  }
  console.log();

  // 测试统计
  console.log('📊 测试统计功能:');
  const stats = localStorage.getStats();
  console.log(`   总记忆数: ${stats.total}`);
  console.log(`   对话记忆: ${stats.typeStats.conversation}`);
  console.log(`   反思记忆: ${stats.typeStats.reflection}`);
  console.log(`   平均重要性: ${stats.avgImportance}`);
  console.log();

  // 测试2: LLM接口
  console.log('🤖 测试2: LLM接口');
  console.log('-'.repeat(50));

  const llmConfig = llm.getLLMConfig();
  console.log(`   LLM提供商: ${llmConfig.provider}`);
  console.log(`   模型: ${llmConfig.model || 'mock'}`);
  console.log();

  // 测试LLM连接
  console.log('   测试LLM连接...');
  const llmOk = await llm.testLLMConnection();
  if (!llmOk) {
    console.log('   ⚠️  LLM测试失败，但继续测试其他功能\n');
  }
  console.log();

  // 测试关键词提取
  console.log('🔑 测试关键词提取:');
  const keywords = llm.extractKeywords('今天我和赛罗奥特曼一起训练，讨论了如何守护地球。');
  console.log(`   提取的关键词: ${keywords.join(', ')}`);
  console.log();

  // 测试3: 数据持久化
  console.log('💾 测试3: 数据持久化');
  console.log('-'.repeat(50));

  console.log('   检查数据文件...');
  const fs = await import('fs');
  const path = await import('path');

  const memoriesFile = path.join('./data', 'memories.json');
  const playersFile = path.join('./data', 'players.json');

  const memoriesExists = fs.existsSync(memoriesFile);
  const playersExists = fs.existsSync(playersFile);

  console.log(`   memories.json: ${memoriesExists ? '✅ 存在' : '❌ 不存在'}`);
  console.log(`   players.json: ${playersExists ? '✅ 存在' : '❌ 不存在'}`);

  if (memoriesExists) {
    const data = fs.readFileSync(memoriesFile, 'utf-8');
    const memoriesCount = JSON.parse(data).length;
    console.log(`   记忆文件包含 ${memoriesCount} 条记录`);
  }
  console.log();

  // 测试4: 数据导出和导入
  console.log('📥 测试4: 数据导出/导入');
  console.log('-'.repeat(50));

  const exportedData = localStorage.exportData();
  console.log(`   导出了 ${exportedData.memories.length} 条记忆`);
  console.log(`   导出了 ${exportedData.players.length} 个角色`);
  console.log();

  // 总结
  console.log('='.repeat(50));
  console.log('✅ 所有测试完成！');
  console.log('='.repeat(50));
  console.log();

  console.log('📌 下一步:');
  console.log('   1. 查看 data/ 目录下的JSON文件');
  console.log('   2. 修改 .env.local 配置切换后端模式');
  console.log('   3. 集成到游戏中开始使用');
  console.log();

  console.log('💡 切换到Convex模式:');
  console.log('   在 .env.local 中设置:');
  console.log('   BACKEND_TYPE=convex');
  console.log('   VITE_CONVEX_URL=your-convex-url');
  console.log();
}

// 运行测试
runTests().catch(error => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});
