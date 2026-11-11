// Testes do núcleo puro de web/boot/shell.js.  Rodar: node --test replica/clone/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shell = require('../web/boot/shell.js');

// Regra do original, reproduzida aqui só como oráculo de comparação.
const originalTenant = (host) => host.split('.')[1];

describe('resolveTenant (estratégia compat)', () => {
  test('mantém o mesmo rótulo do original quando ele é um nome de cliente', () => {
    for (const host of ['gestao.bds.com.br', 'app.sistemasbds.com.br', 'www.prefeitura.ms.gov.br', 'x.cliente.example.org:8443']) {
      assert.equal(shell.resolveTenant(host, 'compat'), originalTenant(host.replace(/:\d+$/, '')), host);
    }
  });

  test('devolve null onde o original gerava um favicon inexistente', () => {
    const cases = {
      'localhost:5501': null, // original: favicon.ico (igual)
      '127.0.0.1:5501': null, // original: favicon-0.ico
      '192.168.0.10': null, // original: favicon-168.ico
      'bds.com.br': null, // original: favicon-com.ico
      'example.com': null, // original: favicon-com.ico
      'app.localhost': null,
      '[::1]:8080': null,
    };
    for (const [host, expected] of Object.entries(cases)) {
      assert.equal(shell.resolveTenant(host, 'compat'), expected, host);
    }
  });

  test('normaliza caixa, ponto final e rejeita rótulos inválidos', () => {
    assert.equal(shell.resolveTenant('GESTAO.BDS.COM.BR.', 'compat'), 'bds');
    assert.equal(shell.resolveTenant('a.-ruim.com.br', 'compat'), null);
  });

  test('estratégia off nunca resolve', () => {
    assert.equal(shell.resolveTenant('gestao.bds.com.br', 'off'), null);
  });

  test('monta o href do favicon a partir do padrão', () => {
    assert.equal(shell.tenantFaviconHref('favicon-{tenant}.ico', 'bds'), 'favicon-bds.ico');
    assert.equal(shell.tenantFaviconHref('icons/{tenant}/{tenant}.png', 'x'), 'icons/x/x.png');
    assert.equal(shell.tenantFaviconHref('favicon-{tenant}.ico', null), null);
  });
});

describe('readConfig', () => {
  test('usa os padrões quando não há atributos', () => {
    const cfg = shell.readConfig({}, '');
    assert.equal(cfg.tabPolicy, 'app');
    assert.equal(cfg.caretPolicy, 'flutter');
    assert.equal(cfg.timeoutMs, 45000);
    assert.equal(cfg.slowMs, 8000);
    assert.equal(cfg.lexicalLegacyFallback, true);
  });

  test('ignora valores inválidos e limita números', () => {
    const cfg = shell.readConfig({ tabPolicy: 'talvez', bootTimeoutMs: '1', bootSlowMs: 'abc', tenantFavicon: 'sem-token.ico' }, '');
    assert.equal(cfg.tabPolicy, 'app');
    assert.equal(cfg.timeoutMs, 3000);
    assert.equal(cfg.tenantFavicon, 'favicon-{tenant}.ico');
    assert.ok(cfg.slowMs < cfg.timeoutMs);
  });

  test('aceita overrides de tempo só com gpDebug=1', () => {
    assert.equal(shell.readConfig({}, '?gpTimeout=2000').timeoutMs, 45000);
    const dbg = shell.readConfig({}, '?gpDebug=1&gpTimeout=2000&gpSlow=800');
    assert.equal(dbg.timeoutMs, 2000);
    assert.equal(dbg.slowMs, 800);
    assert.equal(dbg.debug, true);
  });

  test('preserva o comportamento original quando configurado', () => {
    const cfg = shell.readConfig({ tabPolicy: 'always', caretPolicy: 'all', lexicalLegacyFallback: 'false' }, '');
    assert.deepEqual([cfg.tabPolicy, cfg.caretPolicy, cfg.lexicalLegacyFallback], ['always', 'all', false]);
  });
});

describe('shouldTrapTab', () => {
  const tab = (over) => Object.assign({ code: 'Tab', targetInApp: true, targetInShell: false, semanticsEnabled: false }, over);

  test('app: bloqueia no canvas, libera com leitor de tela e fora do app', () => {
    assert.equal(shell.shouldTrapTab('app', tab()), true);
    assert.equal(shell.shouldTrapTab('app', tab({ semanticsEnabled: true })), false);
    assert.equal(shell.shouldTrapTab('app', tab({ targetInApp: false })), false);
  });

  test('always reproduz o original, menos nos botões do shell', () => {
    assert.equal(shell.shouldTrapTab('always', tab({ targetInApp: false, semanticsEnabled: true })), true);
    assert.equal(shell.shouldTrapTab('always', tab({ targetInShell: true })), false);
  });

  test('never e outras teclas nunca bloqueiam', () => {
    assert.equal(shell.shouldTrapTab('never', tab()), false);
    assert.equal(shell.shouldTrapTab('always', tab({ code: 'Enter' })), false);
  });
});

describe('createBootMachine', () => {
  function harness(over = {}) {
    let t = 0;
    const timers = new Map();
    let seq = 0;
    const changes = [];
    const m = shell.createBootMachine(Object.assign({
      slowMs: 100,
      timeoutMs: 300,
      now: () => t,
      setTimer: (fn, ms) => { timers.set(++seq, { fn, at: t + ms }); return seq; },
      clearTimer: (id) => timers.delete(id),
      onChange: (s) => changes.push(s.state + ':' + s.phase),
    }, over));
    const advance = (ms) => {
      t += ms;
      for (const [id, tm] of [...timers]) if (tm.at <= t) { timers.delete(id); tm.fn(); }
    };
    return { m, advance, changes, timers };
  }

  test('loading → slow → error por timeout', () => {
    const h = harness();
    h.m.start();
    h.advance(100);
    assert.equal(h.m.state, 'slow');
    h.advance(200);
    assert.equal(h.m.state, 'error');
    assert.equal(h.m.snapshot().error.kind, 'timeout');
  });

  test('primeiro quadro encerra timers e vence até um erro anterior', () => {
    const h = harness();
    h.m.start();
    h.m.firstFrame();
    assert.equal(h.m.state, 'ready');
    assert.equal(h.timers.size, 0);

    const h2 = harness();
    h2.m.start();
    h2.m.fail('engine', new Error('x'));
    h2.m.firstFrame();
    assert.equal(h2.m.state, 'ready');
  });

  test('fases só avançam e são ignoradas depois de ready', () => {
    const h = harness();
    h.m.start();
    h.m.phase('engine');
    h.m.phase('bootstrap'); // regressão ignorada
    h.m.phase('inventada');
    assert.equal(h.m.snapshot().phase, 'engine');
    h.m.firstFrame();
    h.m.phase('app');
    assert.equal(h.m.snapshot().phase, 'engine');
  });

  test('fail guarda o tipo e um detalhe legível', () => {
    const h = harness();
    h.m.start();
    h.m.fail('script', 'Falha ao carregar flutter_bootstrap.js');
    assert.deepEqual(h.m.snapshot().error, { kind: 'script', detail: 'Falha ao carregar flutter_bootstrap.js' });
    h.m.fail('engine', 'segundo erro ignorado');
    assert.equal(h.m.snapshot().error.kind, 'script');
  });

  test('timings relativos ao início', () => {
    assert.deepEqual(shell.computeTimings({ start: 10, engine: 60.4, firstFrame: 210 }), { engine: 50, firstFrame: 200 });
  });
});

describe('deriveTargetOrigin', () => {
  const base = 'https://gestao.bds.com.br/app/';
  test('nunca devolve "*"', () => {
    assert.equal(shell.deriveTargetOrigin('editor/index.html', base, false), 'https://gestao.bds.com.br');
    assert.equal(shell.deriveTargetOrigin('https://editor.exemplo.com/e', base, false), 'https://editor.exemplo.com');
    assert.equal(shell.deriveTargetOrigin(null, base, true), 'https://gestao.bds.com.br');
    assert.equal(shell.deriveTargetOrigin('about:blank', base, false), 'https://gestao.bds.com.br');
    assert.equal(shell.deriveTargetOrigin('data:text/html,oi', base, false), null);
    assert.equal(shell.deriveTargetOrigin('javascript:alert(1)', base, false), null);
  });
});

describe('createLexicalBridge', () => {
  function fakeEnv({ src = 'editor.html', withFrame = true, frames = [] } = {}) {
    const posted = [];
    const child = { postMessage: (m, o) => posted.push({ m, o }) };
    let messageHandler = null;
    const dispatched = [];
    const win = {
      location: { href: 'https://gestao.bds.com.br/', origin: 'https://gestao.bds.com.br' },
      frames,
      addEventListener: (type, fn) => { if (type === 'message') messageHandler = fn; },
      removeEventListener: () => { messageHandler = null; },
      dispatchEvent: (e) => dispatched.push(e),
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    };
    const iframe = {
      contentWindow: child,
      getAttribute: () => src,
      hasAttribute: () => false,
      addEventListener: () => {},
    };
    const env = { frame: withFrame ? iframe : null };
    const doc = { documentElement: {}, querySelector: () => env.frame };
    const bridge = shell.createLexicalBridge({ win, doc, selector: 'iframe[data-lexical]', legacyFallback: true, maxQueue: 2 });
    const receive = (data, over = {}) => messageHandler(Object.assign({ source: child, origin: 'https://gestao.bds.com.br', data }, over));
    return { bridge, posted, child, env, iframe, receive, dispatched };
  }

  test('envia {type, payload} com a origem exata do iframe', () => {
    const { bridge, posted } = fakeEnv();
    assert.equal(bridge.send('setText', 'oi'), 'sent');
    assert.deepEqual(posted, [{ m: { type: 'setText', payload: 'oi' }, o: 'https://gestao.bds.com.br' }]);
  });

  test('sem iframe: enfileira e entrega no handshake lexical:ready', () => {
    const env = fakeEnv({ withFrame: false });
    assert.equal(env.bridge.send('a', 1), 'queued');
    assert.equal(env.bridge.send('b', 2), 'queued');
    assert.equal(env.bridge.send('c', 3), 'dropped'); // maxQueue = 2
    env.env.frame = env.iframe; // o iframe aparece
    env.receive({ type: 'lexical:ready' });
    assert.deepEqual(env.posted.map((p) => p.m.type), ['a', 'b']);
    assert.equal(env.bridge.pending(), 0);
  });

  test('ignora mensagens de outra origem ou de outra janela', () => {
    const { bridge, receive } = fakeEnv();
    const got = [];
    bridge.on('*', (m) => got.push(m.type));
    receive({ type: 'x' }, { origin: 'https://malicioso.example' });
    receive({ type: 'y' }, { source: {} });
    receive('texto solto');
    receive({ type: 'ok' });
    assert.deepEqual(got, ['ok']);
  });

  test('listeners por tipo, unsubscribe e CustomEvent lexical-message', () => {
    const { bridge, receive, dispatched } = fakeEnv();
    const got = [];
    const off = bridge.on('lexical:changed', (m) => got.push(m.payload));
    receive({ type: 'lexical:changed', payload: 'v1' });
    off();
    receive({ type: 'lexical:changed', payload: 'v2' });
    assert.deepEqual(got, ['v1']);
    assert.equal(dispatched.at(-1).type, 'lexical-message');
  });

  test('nunca lança: payload não clonável vira "dropped"', () => {
    const env = fakeEnv();
    env.child.postMessage = () => { throw new Error('DataCloneError'); };
    assert.equal(env.bridge.send('setText', () => {}), 'dropped');
    assert.equal(env.bridge.send(), 'dropped');
  });

  test('fallback legado usa window.frames[0] do próprio documento e a própria origem', () => {
    const posted = [];
    const legacy = { postMessage: (m, o) => posted.push(o) };
    const env = fakeEnv({ withFrame: false, frames: [legacy] });
    assert.equal(env.bridge.send('t', 1), 'sent');
    assert.deepEqual(posted, ['https://gestao.bds.com.br']);
  });

  test('origem opaca (data:) descarta a mensagem', () => {
    const { bridge } = fakeEnv({ src: 'data:text/html,oi' });
    assert.equal(bridge.send('t', 1), 'dropped');
  });
});

describe('CRITICAL_SCRIPT_RE', () => {
  test('marca como críticos só os scripts de boot do Flutter', () => {
    for (const s of ['flutter_bootstrap.js', 'main.dart.js', 'main.dart.mjs', 'main.dart.wasm', 'flutter.js', 'canvaskit/canvaskit.js', 'canvaskit/skwasm.js']) {
      assert.ok(shell.CRITICAL_SCRIPT_RE.test(s), s);
    }
    for (const s of ['assets/packages/flutter_inappwebview_web/assets/web/web_support.js', 'analytics.js']) {
      assert.ok(!shell.CRITICAL_SCRIPT_RE.test(s), s);
    }
  });
});
