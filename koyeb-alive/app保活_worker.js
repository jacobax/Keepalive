export default {
  // 1. 手动触发测试
  async fetch(request, env, ctx) {
    const result = await checkSites(env);
    return new Response(result, { status: 200 });
  },

  // 2. Cron 定时触发
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkSites(env));
  }
};

// 目标 URL 列表
const URLS = [
  "https://1.koyeb.app",
  "https://2.koyeb.app",
  "https://3.koyeb.app"
];

// 模拟 User-Agent
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 配置重试参数
const MAX_RETRIES = 3;       // 最大重试次数
const RETRY_DELAY = 5000;    // 重试间隔 (毫秒)，这里设为5秒

async function checkSites(env) {
  // 使用 Promise.allSettled 并发检测所有站点
  const results = await Promise.allSettled(URLS.map(url => checkSingleSiteWithRetry(url)));
  
  // 筛选出最终失败的项目
  const failedParams = results
    .filter(r => r.status === 'fulfilled' && !r.value.success)
    .map(r => r.value);

  // 如果有失败的项目，发送 Telegram 通知
  if (failedParams.length > 0) {
    await sendTelegramAlert(env, failedParams);
    return `检测完成，发现 ${failedParams.length} 个异常，已发送通知。`;
  }

  return "所有服务运行正常 (状态码 200).";
}

// 带有重试机制的单站检测函数
async function checkSingleSiteWithRetry(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Connection': 'keep-alive'
        }
      });

      // 只要状态码是 200 就视为成功，不再检查具体内容
      if (response.status === 200) {
        return { success: true, url, status: 200 };
      } else {
        // 如果状态码不是200，记录错误，准备下一次重试（或抛出异常）
        throw new Error(`Status ${response.status}`);
      }
    } catch (err) {
      lastError = err.message;
      console.log(`[Attempt ${attempt}/${MAX_RETRIES}] ${url} failed: ${err.message}`);
      
      // 如果不是最后一次尝试，则等待一段时间后重试
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  // 如果循环结束还没成功，返回失败结果
  return { 
    success: false, 
    url, 
    error: `尝试 ${MAX_RETRIES} 次后失败。最后一次错误: ${lastError}` 
  };
}

async function sendTelegramAlert(env, failures) {
  const token = env.TG_BOT_TOKEN;
  const chatId = env.TG_CHAT_ID;

  if (!token || !chatId) return;

  let message = "⚠️ **Koyeb 保活失败报警**\n\n";
  failures.forEach(f => {
    message += `❌ **URL**: ${f.url}\n`;
    message += `**Error**: ${f.error}\n\n`;
  });
  message += `Time: ${new Date().toISOString()}`;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    })
  });
}
