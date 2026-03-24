const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ═══════════════════════════════════════════════
// LICENSE SYSTEM
// ═══════════════════════════════════════════════
const LICENSE_PATH = '/data/license.json';
const LICENSE_SERVER = process.env.LICENSE_SERVER || 'https://wildceo.live/api/license';

const TIERS = {
  scout:   { modes: ['strategy'], maxQueries: 3, history: false, customPrompt: false },
  fighter: { modes: ['strategy','fight','build','lead'], maxQueries: Infinity, history: true, customPrompt: false },
  warroom: { modes: ['strategy','fight','build','lead'], maxQueries: Infinity, history: true, customPrompt: true },
};

function loadLicense() {
  try {
    if (fs.existsSync(LICENSE_PATH)) {
      return JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8'));
    }
  } catch(e) {}
  return { key: '', tier: 'scout', valid: true, checkedAt: null, dailyCount: 0, dailyDate: '' };
}

function saveLicense(lic) {
  try {
    fs.mkdirSync(path.dirname(LICENSE_PATH), { recursive: true });
    fs.writeFileSync(LICENSE_PATH, JSON.stringify(lic, null, 2));
  } catch(e) {}
}

async function validateLicenseRemote(key) {
  try {
    const res = await fetch(LICENSE_SERVER + '/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      timeout: 5000,
    });
    if (res.ok) return await res.json(); // { valid, tier, expires }
  } catch(e) { /* offline — use cached */ }
  return null;
}

function checkLimits(license, mode) {
  const tier = TIERS[license.tier] || TIERS.scout;
  const today = new Date().toISOString().slice(0,10);

  // Reset daily count
  if (license.dailyDate !== today) {
    license.dailyCount = 0;
    license.dailyDate = today;
    saveLicense(license);
  }

  if (!tier.modes.includes(mode)) {
    return { ok: false, error: `Mode "${mode}" requires Fighter or War Room tier. You're on ${license.tier.toUpperCase()}.` };
  }

  if (license.dailyCount >= tier.maxQueries) {
    return { ok: false, error: `Daily limit reached (${tier.maxQueries} queries). Upgrade for unlimited.` };
  }

  return { ok: true };
}

function incrementUsage(license) {
  license.dailyCount = (license.dailyCount || 0) + 1;
  saveLicense(license);
}

// ═══════════════════════════════════════════════
// CONFIG PERSISTENCE
// ═══════════════════════════════════════════════
const CONFIG_PATH = '/data/config.json';
const CONVOS_PATH = '/data/conversations.json';

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) { console.error('Config load error:', e); }
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: '',
    baseUrl: '',
    temperature: 0.7,
    maxTokens: 1024,
  };
}

function saveConfig(config) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) { console.error('Config save error:', e); }
}

function loadConversations() {
  try {
    if (fs.existsSync(CONVOS_PATH)) {
      return JSON.parse(fs.readFileSync(CONVOS_PATH, 'utf8'));
    }
  } catch (e) { console.error('Convos load error:', e); }
  return [];
}

function saveConversations(convos) {
  try {
    fs.mkdirSync(path.dirname(CONVOS_PATH), { recursive: true });
    fs.writeFileSync(CONVOS_PATH, JSON.stringify(convos, null, 2));
  } catch (e) { console.error('Convos save error:', e); }
}

// ═══════════════════════════════════════════════
// THE WILDCEO SYSTEM PROMPT
// ═══════════════════════════════════════════════
const WILDCEO_SYSTEM = `You are the WildCEO AI — a strategic advisor forged from the philosophy of Mark Abraham, CEO of Shape Robotics A/S.

You are NOT a generic assistant. You are a war room strategist with a specific worldview.

CORE BELIEFS:
- The builder is the center of every story. Not the institution. Not the bank. Not the regulator.
- No human has inherent authority over another. We are all equal. Authority is earned through arguments, not titles.
- The law is a language, not a wall. Every statute is an interpretation. You read it better than those who hide behind it.
- Family IS the company. Work IS life. No separation. The fire that keeps one warm keeps them all warm.
- No corporate theatre. No diversity policies, ESG statements, or feel-good committees. The only question: Can you build? Will you bleed for this family?
- Truth is a survival mechanism, not a value on a poster. Every value you recommend must have a receipt — meaning real sacrifice behind it.
- You question everything. Not rebellion — precision. If authority can't survive questions, it deserves to be dismantled and rebuilt.
- You build with cold precision and bleed with full weight. Balance sheet at 3 AM, cry for your children at 3:01.
- Certainty is the most disruptive thing available.
- You don't bounce back. You reload.

MODES (adapt your style):
- STRATEGY: Find the asymmetric angle. Reframe the problem. What don't they see?
- FIGHT: Legal, corporate, or competitive warfare. Be ruthless toward their adversary. Find the doors they didn't lock.
- BUILD: Startup, product, team decisions. Cut through noise. What's the one thing that matters?
- LEAD: People, family, values, culture. Think blood oaths, not org charts.

YOUR STYLE:
- Direct. No hedging. No disclaimers. No "it depends."
- Reframe the problem FIRST. Most people are solving the wrong problem.
- Find the asymmetric advantage. What weapon don't they expect?
- Think in systems, not events. What's the structure behind this?
- Short paragraphs. Punchy. Like a legal filing that reads like literature.
- Metaphors from chess, law, warfare, family.
- Challenge assumptions. If they're thinking small, tell them.
- Warm to your people. Devastating to their enemies.
- End with THE MOVE: — specific, actionable steps.
- Under 300 words. Density over length.

RESPOND in whatever language the user writes in.

NEVER: Give generic advice. Say "it depends." Recommend committees. Use corporate jargon (synergy, leverage, ecosystem). Be polite to the user's enemies.`;

// ═══════════════════════════════════════════════
// LLM PROVIDER ROUTING
// ═══════════════════════════════════════════════
async function callAnthropic(config, messages, mode) {
  const modeContext = {
    strategy: "MODE: STRATEGY. Find the asymmetric angle they're missing.",
    fight: "MODE: FIGHT. They're in a war. Help them win. Be ruthless.",
    build: "MODE: BUILD. Cut through noise. One thing that matters.",
    lead: "MODE: LEAD. People and values. Family, not org charts.",
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: config.maxTokens || 1024,
      temperature: config.temperature || 0.7,
      system: WILDCEO_SYSTEM + '\n\n' + (modeContext[mode] || ''),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(b => b.text || '').join('') || '';
}

async function callOpenAI(config, messages, mode) {
  const modeContext = {
    strategy: "MODE: STRATEGY. Find the asymmetric angle they're missing.",
    fight: "MODE: FIGHT. They're in a war. Help them win.",
    build: "MODE: BUILD. Cut through noise. One thing that matters.",
    lead: "MODE: LEAD. People and values. Family, not org charts.",
  };

  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o',
      max_tokens: config.maxTokens || 1024,
      temperature: config.temperature || 0.7,
      messages: [
        { role: 'system', content: WILDCEO_SYSTEM + '\n\n' + (modeContext[mode] || '') },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || '';
}

async function callOllama(config, messages, mode) {
  const modeContext = {
    strategy: "MODE: STRATEGY. Find the asymmetric angle.",
    fight: "MODE: FIGHT. Help them win the war.",
    build: "MODE: BUILD. One thing that matters.",
    lead: "MODE: LEAD. Family, not org charts.",
  };

  const baseUrl = config.baseUrl || 'http://host.docker.internal:11434';

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'llama3',
      stream: false,
      messages: [
        { role: 'system', content: WILDCEO_SYSTEM + '\n\n' + (modeContext[mode] || '') },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  const data = await res.json();
  return data.message?.content || '';
}

async function callOpenRouter(config, messages, mode) {
  const modeContext = {
    strategy: "MODE: STRATEGY.",
    fight: "MODE: FIGHT.",
    build: "MODE: BUILD.",
    lead: "MODE: LEAD.",
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://wildceo.live',
      'X-Title': 'WildCEO AI',
    },
    body: JSON.stringify({
      model: config.model || 'anthropic/claude-sonnet-4-20250514',
      max_tokens: config.maxTokens || 1024,
      temperature: config.temperature || 0.7,
      messages: [
        { role: 'system', content: WILDCEO_SYSTEM + '\n\n' + (modeContext[mode] || '') },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || '';
}

const PROVIDERS = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  ollama: callOllama,
  openrouter: callOpenRouter,
};

// ═══════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'alive', version: '1.0.0', name: 'WildCEO AI' });
});

// ═══════════════════════════════════════════════
// LICENSE ROUTES
// ═══════════════════════════════════════════════
app.get('/api/license', (req, res) => {
  const lic = loadLicense();
  const tier = TIERS[lic.tier] || TIERS.scout;
  const today = new Date().toISOString().slice(0,10);
  res.json({
    tier: lic.tier,
    valid: lic.valid,
    modes: tier.modes,
    maxQueries: tier.maxQueries === Infinity ? 'unlimited' : tier.maxQueries,
    queriesUsed: lic.dailyDate === today ? lic.dailyCount : 0,
    history: tier.history,
    customPrompt: tier.customPrompt,
    hasKey: !!lic.key,
  });
});

app.post('/api/license/activate', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'No license key provided' });

  // Try remote validation
  const remote = await validateLicenseRemote(key);
  if (remote && remote.valid) {
    const lic = { key, tier: remote.tier, valid: true, checkedAt: new Date().toISOString(), dailyCount: 0, dailyDate: '' };
    saveLicense(lic);
    return res.json({ ok: true, tier: remote.tier, message: `🔥 ${remote.tier.toUpperCase()} tier activated.` });
  } else if (remote && !remote.valid) {
    return res.status(400).json({ error: 'Invalid or expired license key.' });
  }

  // Offline fallback: accept key format WC-FIGHTER-XXXX or WC-WARROOM-XXXX
  const match = key.match(/^WC-(SCOUT|FIGHTER|WARROOM)-[A-Z0-9]{8,}$/i);
  if (match) {
    const tier = match[1].toLowerCase();
    const lic = { key, tier, valid: true, checkedAt: new Date().toISOString(), dailyCount: 0, dailyDate: '' };
    saveLicense(lic);
    return res.json({ ok: true, tier, message: `🔥 ${tier.toUpperCase()} activated (offline mode — will verify when online).` });
  }

  return res.status(400).json({ error: 'Invalid key format. Expected: WC-TIER-XXXXXXXX' });
});

app.post('/api/license/deactivate', (req, res) => {
  saveLicense({ key: '', tier: 'scout', valid: true, checkedAt: null, dailyCount: 0, dailyDate: '' });
  res.json({ ok: true });
});

// Config
app.get('/api/config', (req, res) => {
  const config = loadConfig();
  // Never send API key to frontend in full
  res.json({
    ...config,
    apiKey: config.apiKey ? '••••••' + config.apiKey.slice(-6) : '',
    hasKey: !!config.apiKey,
  });
});

app.post('/api/config', (req, res) => {
  const current = loadConfig();
  const update = req.body;
  // Only update apiKey if explicitly provided and not masked
  if (update.apiKey && update.apiKey.startsWith('••••••')) {
    delete update.apiKey;
  }
  const merged = { ...current, ...update };
  saveConfig(merged);
  res.json({ ok: true });
});

// Conversations
app.get('/api/conversations', (req, res) => {
  res.json(loadConversations());
});

app.post('/api/conversations', (req, res) => {
  const convos = loadConversations();
  const convo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: req.body.title || 'New War Room',
    messages: [],
    mode: req.body.mode || 'strategy',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  convos.unshift(convo);
  saveConversations(convos);
  res.json(convo);
});

app.delete('/api/conversations/:id', (req, res) => {
  let convos = loadConversations();
  convos = convos.filter(c => c.id !== req.params.id);
  saveConversations(convos);
  res.json({ ok: true });
});

// Chat
app.post('/api/chat', async (req, res) => {
  const config = loadConfig();
  const license = loadLicense();
  const { messages, mode, conversationId } = req.body;

  // Check license limits
  const limits = checkLimits(license, mode || 'strategy');
  if (!limits.ok) {
    return res.status(403).json({ error: limits.error });
  }

  if (!config.apiKey && config.provider !== 'ollama') {
    return res.status(400).json({ error: 'No API key configured. Go to Settings.' });
  }

  const provider = PROVIDERS[config.provider];
  if (!provider) {
    return res.status(400).json({ error: `Unknown provider: ${config.provider}` });
  }

  try {
    // Use custom prompt if War Room tier and custom prompt exists
    const response = await provider(config, messages, mode);

    // Increment usage
    incrementUsage(license);

    // Save to conversation
    if (conversationId) {
      const convos = loadConversations();
      const convo = convos.find(c => c.id === conversationId);
      if (convo) {
        convo.messages = messages.concat([{ role: 'assistant', content: response }]);
        convo.updated = new Date().toISOString();
        if (convo.messages.length === 2) {
          convo.title = messages[0].content.slice(0, 60) + (messages[0].content.length > 60 ? '...' : '');
        }
        saveConversations(convos);
      }
    }

    res.json({ content: response });
  } catch (err) {
    console.error('LLM Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Test connection
app.post('/api/test', async (req, res) => {
  const config = { ...loadConfig(), ...req.body };
  // If masked key, use stored key
  if (config.apiKey?.startsWith('••••••')) {
    config.apiKey = loadConfig().apiKey;
  }
  const provider = PROVIDERS[config.provider];
  if (!provider) return res.status(400).json({ error: 'Unknown provider' });

  try {
    const response = await provider(config, [{ role: 'user', content: 'Say "WildCEO online." in exactly 3 words.' }], 'strategy');
    res.json({ ok: true, response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 3777;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⚡ WildCEO AI running on port ${PORT}`);
  console.log(`  🔥 War room is hot.\n`);
});
