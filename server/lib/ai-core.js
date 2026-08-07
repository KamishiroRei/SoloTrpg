// ── AI 调用核心（从 server.js 拆分） ──
// 三个调用原语：callAI（非流式+重试+原生工具调用）/ callAIOnce（单次非流式）/ callAIStream（SSE 流式）
const fetch = require('node-fetch');
const { TextDecoder } = require('util');
const { resolveApiUrls, authHeaders, readErrorResponse } = require('./utils');

async function callAIStream(req, res, endpoint, apiKey, model, messages, options = {}) {
  const { chatUrl } = resolveApiUrls(endpoint);
  const isDeepSeek = /deepseek/i.test(`${chatUrl} ${model}`);
  const timeoutMs = Math.max(5000, Math.min(options.timeoutMs || 120000, 120000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const requestMessages = (messages || []).map(message => {
    const next = { ...message };
    if (isDeepSeek && next.role === 'assistant') {
      next.reasoning_content = typeof next.reasoning_content === 'string' ? next.reasoning_content : '';
    } else if (!isDeepSeek) {
      delete next.reasoning_content;
    }
    return next;
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullContent = '';
  let fullReasoning = '';
  try {
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: requestMessages,
        stream: true,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {})
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      const error = await readErrorResponse(resp);
      console.log(`[AI流] 模型错误 HTTP ${resp.status}: ${String(error).substring(0, 300)}`);
      res.write(`data: ${JSON.stringify({ type: 'error', error: String(error).substring(0, 300) })}\n\n`);
      res.end();
      return;
    }

    if (!resp.body) {
      console.log(`[AI流] 模型返回空响应体 status=${resp.status}`);
      res.write(`data: ${JSON.stringify({ type: 'error', error: '模型返回了空响应（HTTP ' + resp.status + '）' })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    // 兼容两种响应体：node-fetch v2 的 PassThrough（Node 流，无 getReader）与标准 ReadableStream
    for await (const chunk of resp.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const evt of events) {
        const dataLine = evt.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        const data = dataLine.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch (e) { continue; }
        // 流式错误（DeepSeek 等可能以 status 200 + SSE {"error":...} 返回）
        if (json && json.error) {
          const errText = (json.error.message || json.error.code || JSON.stringify(json.error)).substring(0, 300);
          console.log(`[AI流] SSE 流内错误: ${errText}`);
          res.write(`data: ${JSON.stringify({ type: 'error', error: errText })}\n\n`);
          res.end();
          return;
        }
        const delta = json.choices && json.choices[0] ? json.choices[0].delta : {};
        if (delta && typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          fullReasoning += delta.reasoning_content;
          res.write(`data: ${JSON.stringify({ type: 'reasoning', delta: delta.reasoning_content })}\n\n`);
        }
        if (delta && typeof delta.content === 'string' && delta.content) {
          fullContent += delta.content;
          res.write(`data: ${JSON.stringify({ type: 'content', delta: delta.content })}\n\n`);
        }
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done', content: fullContent, reasoningContent: fullReasoning })}\n\n`);
    res.end();
    // D+会话持久化钩子：完整内容在流结束后可用
    if (options.onComplete) options.onComplete(fullContent, fullReasoning);
  } catch (err) {
    const aborted = controller.signal.aborted;
    const payload = aborted
      ? { type: 'aborted' }
      : { type: 'error', error: String(err.message || '流式调用失败').substring(0, 300) };
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); res.end(); } catch (e) { /* 连接已断 */ }
  } finally {
    clearTimeout(timer);
  }
}

async function callAI(endpoint, apiKey, model, messages, options = {}) {
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS = [3000, 6000];
  const isDeterministicError = (err) => {
    const msg = String((err && err.message) || '');
    // 429(限流)/5xx/网络/超时 = 瞬态，可重试；400(上下文超限等)/401/403/404 = 确定性，重试必败且浪费
    return /HTTP 400|HTTP 401|HTTP 403|HTTP 404|maximum context length|上下文超|API错误|invalid.*model/i.test(msg);
  };
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callAIOnce(endpoint, apiKey, model, messages, options);
    } catch (err) {
      const userAborted = (options.signal && options.signal.aborted) || (err && err.name === 'AbortError' && options.signal && options.signal.aborted);
      if (userAborted) throw err; // 用户中止：不重试
      lastErr = err;
      // 自动中断：确定性错误立即中止（重试必然失败且浪费 token）
      if (isDeterministicError(err)) {
        console.log(`[AI] ✗ 确定性错误（自动中断，不重试）: ${String(err.message || '').substring(0, 200)}`);
        throw err;
      }
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS[attempt - 1] || 6000;
        console.log(`[AI] ⚠ 第${attempt}次调用失败（${String(err.message || '').substring(0, 120)}），${delay / 1000}s 后重试（${attempt + 1}/${MAX_ATTEMPTS}）`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function callAIOnce(endpoint, apiKey, model, messages, options = {}) {
  const startTime = Date.now();
  const { chatUrl } = resolveApiUrls(endpoint);
  const lastMsg = messages[messages.length - 1]?.content?.substring?.(0, 50) || '';
  const isDeepSeek = /deepseek/i.test(`${chatUrl} ${model}`);
  const timeoutMs = Math.max(5000, Math.min(options.timeoutMs || 120000, 120000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  // DeepSeek思考模型要求历史中的assistant消息始终带回reasoning_content。
  // OpenCode也在发送前执行同类补全，避免第二轮开始被API拒绝。
  const requestMessages = (messages || []).map(message => {
    const next = { ...message };
    if (isDeepSeek && next.role === 'assistant') {
      next.reasoning_content = typeof next.reasoning_content === 'string' ? next.reasoning_content : '';
    } else if (!isDeepSeek) {
      delete next.reasoning_content;
    }
    return next;
  });

  console.log(`[AI] → ${chatUrl.substring(0, 80)} model=${model} msg="${lastMsg}"`);

  try {
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: requestMessages,
        stream: false,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.tools && options.tools.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {})
      }),
      signal: controller.signal,
      timeout: timeoutMs
    });

    const elapsed = Date.now() - startTime;

    if (!resp.ok) {
      const error = await readErrorResponse(resp);
      console.log(`[AI] ✗ ${resp.status} (${elapsed}ms): ${String(error).substring(0, 300)}`);
      throw new Error(`HTTP ${resp.status}: ${String(error).substring(0, 300)}`);
    }

    const json = await resp.json();
    if (json.error) {
      const message = json.error.message || json.error;
      console.log(`[AI] ✗ API错误 (${elapsed}ms): ${message}`);
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }

    if (json.choices && json.choices[0]) {
      const message = json.choices[0].message || {};
      let content = message.content || '';
      if (Array.isArray(content)) {
        content = content
          .map(part => typeof part === 'string' ? part : (part?.text || part?.content || ''))
          .join('');
      }
      const reasoningContent = message.reasoning_content || '';
      // 原生工具调用（opencode模式）：模型直接返回tool_calls，无需从文本抠JSON
      const toolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length
        ? message.tool_calls.map(tc => ({
            id: tc.id || ('call_' + Math.random().toString(36).slice(2, 10)),
            name: tc.function && tc.function.name,
            arguments: tc.function && tc.function.arguments
          }))
        : [];
      console.log(`[AI] ✓ (${elapsed}ms) → ${content.length}字符${toolCalls.length ? `, ${toolCalls.length}个工具调用` : ''}${json.usage && json.usage.prompt_cache_hit_tokens ? `, 缓存命中${json.usage.prompt_cache_hit_tokens}` : ''}`);
      return {
        content,
        reasoningContent,
        model: json.model || model,
        usage: json.usage,
        toolCalls
      };
    }

    console.log(`[AI] ✗ 未知响应格式 (${elapsed}ms)`);
    throw new Error('AI返回了未知格式的响应');
  } catch (err) {
    if (controller.signal.aborted) err = new Error('AI调用已中止或超时');
    if (!err.message.startsWith('HTTP') && !err.message.includes('AI返回') && !err.message.includes('API错误')) {
      console.log(`[AI] ✗ 网络: ${err.message}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callAI, callAIOnce, callAIStream };
