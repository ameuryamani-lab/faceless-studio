// node --no-warnings --test core/claude-usage.test.mjs
// 2026-10-25: the night of 24-25/10 the PC lost its DNS; every failed run was taken for a plan limit (the stream always holds a
// "rate_limit_event" line, and the regex ran on the whole stream) and the studio paused itself twice for nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStream, rateLimited } from './claude-usage.mjs';

const line = (o) => JSON.stringify(o);
const planEvent = (status) => line({ type: 'rate_limit_event', rate_limit_info: { status, unifiedWindows: { five_hour: { utilization: 0.01 } } } });
const resultEvent = (text, isError = true) => line({ type: 'result', is_error: isError, result: text, session_id: '4c1a429e-0000-4000-8000-000000000429' });

test('a network failure is not a plan limit, even with the plan event and "429" inside an id', () => {
  const raw = [planEvent('allowed'), resultEvent("API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)")].join('\n');
  const { result, plan } = parseStream(raw);
  assert.equal(rateLimited({ code: 1, result, plan, errOut: '' }), false);
});

test('a rejected plan window is a limit', () => {
  const { result, plan } = parseStream([planEvent('rejected'), resultEvent('')].join('\n'));
  assert.equal(rateLimited({ code: 1, result, plan, errOut: '' }), true);
});

test('the limit messages of the reply or of stderr are a limit', () => {
  for (const text of ['Claude AI usage limit reached|1761400000', "You've hit your limit · resets 3pm", 'API Error: 429 Too Many Requests', 'API Error: Overloaded']) {
    const { result, plan } = parseStream([planEvent('allowed'), resultEvent(text)].join('\n'));
    assert.equal(rateLimited({ code: 1, result, plan, errOut: '' }), true, text);
  }
  assert.equal(rateLimited({ code: 1, result: null, plan: null, errOut: 'Error: rate limited by the server' }), true);
});

test('a run that succeeded is never a limit', () => {
  const { result, plan } = parseStream([planEvent('rejected'), resultEvent('usage limit reached', false)].join('\n'));
  assert.equal(rateLimited({ code: 0, result, plan, errOut: '' }), false);
});
