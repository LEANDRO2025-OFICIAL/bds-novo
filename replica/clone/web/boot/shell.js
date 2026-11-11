/*!
 * Gestão Pública — shell de inicialização do Flutter Web (boot/shell.js)
 *
 * Carregado de forma SÍNCRONA antes do flutter_bootstrap.js, para que os
 * listeners de boot existam antes de o Flutter começar.
 *
 * Escrito em ES5 de propósito: em navegadores antigos o arquivo ainda é
 * interpretado e consegue mostrar "navegador incompatível" em vez de quebrar.
 *
 * Organização:
 *   1. núcleo puro (sem DOM) — exportado para testes em Node
 *   2. mount(window, document) — liga o núcleo ao navegador
 */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') api.mount(window, document);
})(function () {
  'use strict';

  var VERSION = '2.0.0';

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------

  var DEFAULTS = {
    appName: 'Gestão Pública',
    slowMs: 8000,
    timeoutMs: 45000,
    tabPolicy: 'app',
    caretPolicy: 'flutter',
    tenantStrategy: 'compat',
    tenantFavicon: 'favicon-{tenant}.ico',
    lexicalSelector: 'iframe[data-lexical], iframe[name="lexical"]',
    lexicalLegacyFallback: true,
    debug: false
  };

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function boundedInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function parseQuery(search) {
    var out = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var key = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      out[key] = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
    });
    return out;
  }

  /**
   * Lê a configuração dos atributos data-* do <html>.
   * Com ?gpDebug=1 na URL, aceita gpSlow/gpTimeout para diagnóstico sem rebuild.
   */
  function readConfig(dataset, search) {
    var d = dataset || {};
    var q = parseQuery(search);
    var debug = q.gpDebug === '1';
    var cfg = {
      appName: d.appName || DEFAULTS.appName,
      slowMs: boundedInt(d.bootSlowMs, 1000, 120000, DEFAULTS.slowMs),
      timeoutMs: boundedInt(d.bootTimeoutMs, 3000, 600000, DEFAULTS.timeoutMs),
      tabPolicy: oneOf(d.tabPolicy, ['app', 'always', 'never'], DEFAULTS.tabPolicy),
      caretPolicy: oneOf(d.caretPolicy, ['flutter', 'all', 'none'], DEFAULTS.caretPolicy),
      tenantStrategy: oneOf(d.tenantStrategy, ['compat', 'off'], DEFAULTS.tenantStrategy),
      tenantFavicon: d.tenantFavicon && d.tenantFavicon.indexOf('{tenant}') >= 0 ? d.tenantFavicon : DEFAULTS.tenantFavicon,
      lexicalSelector: d.lexicalSelector || DEFAULTS.lexicalSelector,
      lexicalLegacyFallback: d.lexicalLegacyFallback !== 'false',
      debug: debug
    };
    if (debug) {
      cfg.slowMs = boundedInt(q.gpSlow, 500, 120000, cfg.slowMs);
      cfg.timeoutMs = boundedInt(q.gpTimeout, 1000, 600000, cfg.timeoutMs);
    }
    if (cfg.timeoutMs <= cfg.slowMs) cfg.slowMs = Math.floor(cfg.timeoutMs / 2);
    return cfg;
  }

  // ---------------------------------------------------------------------------
  // Tenant (identidade por subdomínio)
  // ---------------------------------------------------------------------------

  // Rótulos que nunca identificam um cliente: aparecem na 2ª posição quando o
  // host é curto demais (ex.: "bds.com.br" → "com" na regra original).
  var GENERIC_LABELS = ['com', 'net', 'org', 'gov', 'edu', 'mil', 'int', 'leg', 'jus', 'mp', 'def', 'tc', 'br'];
  var LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  /**
   * Estratégia "compat": escolhe o MESMO rótulo que o original
   * (host.split('.')[1]) sempre que ele for um nome de cliente plausível, e
   * devolve null nos casos em que o original gerava lixo (IP, localhost,
   * sufixo genérico, porta) — aí o favicon padrão é mantido.
   */
  function resolveTenant(host, strategy) {
    if (strategy === 'off' || !host) return null;
    var hostname = String(host).toLowerCase();
    if (hostname.charAt(0) === '[') return null; // IPv6 literal
    hostname = hostname.replace(/:\d+$/, '').replace(/\.$/, '');
    if (hostname === 'localhost' || /\.localhost$/.test(hostname)) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null; // IPv4
    var labels = hostname.split('.');
    if (labels.length < 3) return null;
    var candidate = labels[1];
    if (GENERIC_LABELS.indexOf(candidate) >= 0) return null;
    return LABEL_RE.test(candidate) ? candidate : null;
  }

  function tenantFaviconHref(pattern, tenant) {
    return tenant ? pattern.split('{tenant}').join(encodeURIComponent(tenant)) : null;
  }

  // ---------------------------------------------------------------------------
  // Política de Tab
  // ---------------------------------------------------------------------------

  /**
   * ctx: { code, targetInApp, targetInShell, semanticsEnabled }
   *  - always: comportamento do original (bloqueia sempre), exceto nos botões do próprio shell
   *  - app:    bloqueia só quando o foco está no canvas do Flutter e o leitor de tela
   *            (semântica do Flutter) está desligado — o Flutter faz a própria travessia
   *  - never:  nunca bloqueia
   */
  function shouldTrapTab(policy, ctx) {
    if (!ctx || ctx.code !== 'Tab') return false;
    if (ctx.targetInShell) return false;
    if (policy === 'never') return false;
    if (policy === 'always') return true;
    return !!ctx.targetInApp && !ctx.semanticsEnabled;
  }

  // ---------------------------------------------------------------------------
  // Máquina de estados do boot
  // ---------------------------------------------------------------------------

  var PHASES = ['loading', 'bootstrap', 'engine', 'app'];

  function describeError(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err.slice(0, 2000);
    var text = (err && (err.stack || err.message)) || String(err);
    return String(text).slice(0, 2000);
  }

  /**
   * opts: { slowMs, timeoutMs, now(), setTimer(fn, ms) → id, clearTimer(id), onChange(snapshot) }
   * Estados: loading → slow → error | ready (ready é terminal; error → ready se o
   * primeiro quadro chegar atrasado).
   */
  function createBootMachine(opts) {
    var state = 'idle';
    var phase = 'loading';
    var error = null;
    var timers = [];
    var marks = {};

    function snapshot() {
      return { state: state, phase: phase, error: error, marks: marks };
    }
    function emit() {
      if (opts.onChange) opts.onChange(snapshot());
    }
    function clearAll() {
      timers.forEach(function (t) { opts.clearTimer(t); });
      timers = [];
    }
    function mark(name) {
      marks[name] = opts.now();
    }

    return {
      start: function () {
        if (state !== 'idle') return;
        state = 'loading';
        mark('start');
        timers.push(opts.setTimer(function () {
          if (state === 'loading') { state = 'slow'; mark('slow'); emit(); }
        }, opts.slowMs));
        timers.push(opts.setTimer(function () {
          if (state === 'loading' || state === 'slow') {
            state = 'error';
            error = { kind: 'timeout', detail: 'Sem primeiro quadro após ' + opts.timeoutMs + ' ms (fase: ' + phase + ').' };
            mark('error');
            emit();
          }
        }, opts.timeoutMs));
        emit();
      },
      phase: function (name) {
        if (PHASES.indexOf(name) < 0 || state === 'ready' || state === 'error') return;
        if (PHASES.indexOf(name) <= PHASES.indexOf(phase)) return; // fases só avançam
        phase = name;
        mark(name);
        emit();
      },
      firstFrame: function () {
        if (state === 'ready') return;
        clearAll();
        state = 'ready';
        error = null;
        mark('firstFrame');
        emit();
      },
      fail: function (kind, detail) {
        if (state === 'ready' || state === 'error') return;
        clearAll();
        state = 'error';
        error = { kind: kind || 'engine', detail: describeError(detail) };
        mark('error');
        emit();
      },
      get state() { return state; },
      snapshot: snapshot
    };
  }

  /** Durações em ms desde o início do shell, arredondadas. */
  function computeTimings(marks) {
    var out = {};
    if (marks.start == null) return out;
    Object.keys(marks).forEach(function (k) {
      if (k !== 'start') out[k] = Math.round(marks[k] - marks.start);
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Ponte com o editor Lexical (substitui window.top.frames[0].postMessage(…, '*'))
  // ---------------------------------------------------------------------------

  /**
   * Origem exata para postMessage, derivada do src do iframe. Nunca '*'.
   * srcdoc / sem src / about:blank herdam a origem do documento pai.
   * data: tem origem opaca → null (mensagem não é enviada).
   */
  function deriveTargetOrigin(src, baseHref, hasSrcdoc) {
    var base;
    try { base = new URL(baseHref); } catch (e) { return null; }
    if (hasSrcdoc || !src || src === 'about:blank') return base.origin;
    var url;
    try { url = new URL(src, base.href); } catch (e) { return null; }
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
    if (url.protocol === 'blob:') return url.origin !== 'null' ? url.origin : null;
    return null;
  }

  /**
   * opts: { win, doc, selector, legacyFallback, maxQueue, log(level, msg, data) }
   * send(type, payload) → 'sent' | 'queued' | 'dropped' — nunca lança exceção.
   */
  function createLexicalBridge(opts) {
    var win = opts.win;
    var doc = opts.doc;
    var maxQueue = opts.maxQueue || 100;
    var queue = [];
    var listeners = {};
    var observer = null;
    var log = opts.log || function () {};

    function findTarget() {
      var iframe = null;
      try { iframe = doc.querySelector(opts.selector); } catch (e) { log('warn', 'seletor Lexical inválido', opts.selector); }
      if (iframe && iframe.contentWindow) {
        return {
          frame: iframe,
          window: iframe.contentWindow,
          origin: deriveTargetOrigin(iframe.getAttribute('src'), win.location.href, iframe.hasAttribute('srcdoc'))
        };
      }
      if (opts.legacyFallback && win.frames && win.frames.length > 0) {
        // Compatível com o original, mas no PRÓPRIO documento (não em window.top)
        // e restrito à mesma origem.
        return { frame: null, window: win.frames[0], origin: win.location.origin };
      }
      return null;
    }

    function post(target, type, payload) {
      if (!target.origin) {
        log('warn', 'iframe do editor com origem opaca; mensagem descartada', type);
        return 'dropped';
      }
      try {
        target.window.postMessage({ type: type, payload: payload }, target.origin);
        return 'sent';
      } catch (e) {
        log('error', 'falha ao enviar mensagem ao editor', describeError(e));
        return 'dropped';
      }
    }

    function flush() {
      var target = findTarget();
      if (!target || !queue.length) return;
      var pending = queue;
      queue = [];
      pending.forEach(function (m) { post(target, m.type, m.payload); });
      stopWatching();
    }

    function stopWatching() {
      if (observer) { observer.disconnect(); observer = null; }
    }

    function watchForFrame() {
      if (observer || typeof win.MutationObserver !== 'function') return;
      observer = new win.MutationObserver(function () {
        var target = findTarget();
        if (!target) return;
        stopWatching();
        if (target.frame) {
          // Espera o documento do iframe carregar; o handshake 'lexical:ready' também libera a fila.
          target.frame.addEventListener('load', flush, { once: true });
        } else {
          flush();
        }
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    }

    function emit(type, data) {
      (listeners[type] || []).concat(listeners['*'] || []).forEach(function (fn) {
        try { fn(data); } catch (e) { log('error', 'listener Lexical falhou', describeError(e)); }
      });
    }

    function onMessage(event) {
      var target = findTarget();
      if (!target || event.source !== target.window) return;
      if (target.origin && event.origin !== target.origin) return;
      var data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (data.type === 'lexical:ready') flush();
      emit(data.type, data);
      if (typeof win.CustomEvent === 'function') {
        win.dispatchEvent(new win.CustomEvent('lexical-message', { detail: data }));
      }
    }

    if (win.addEventListener) win.addEventListener('message', onMessage);

    return {
      send: function (type, payload) {
        if (typeof type !== 'string' || !type) {
          log('warn', 'sendToLexical sem "type" válido; ignorado');
          return 'dropped';
        }
        var target = findTarget();
        if (target && !queue.length) return post(target, type, payload);
        if (queue.length >= maxQueue) {
          log('warn', 'fila do editor cheia; mensagem descartada', type);
          return 'dropped';
        }
        queue.push({ type: type, payload: payload });
        if (target) flush(); else watchForFrame();
        return target ? 'sent' : 'queued';
      },
      on: function (type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
        return function off() {
          listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; });
        };
      },
      pending: function () { return queue.length; },
      flush: flush,
      destroy: function () {
        stopWatching();
        if (win.removeEventListener) win.removeEventListener('message', onMessage);
        queue = [];
        listeners = {};
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Textos (escritos para este shell)
  // ---------------------------------------------------------------------------

  var COPY = {
    loading: 'Carregando…',
    bootstrap: 'Baixando o sistema…',
    engine: 'Iniciando o motor gráfico…',
    app: 'Abrindo o sistema…',
    slow: 'Está demorando mais que o normal. Verifique sua conexão.',
    errors: {
      timeout: ['O sistema não respondeu a tempo', 'A inicialização passou do limite. Pode ser lentidão na rede ou uma versão antiga guardada em cache.'],
      script: ['Não foi possível baixar o sistema', 'Um arquivo essencial não carregou. Verifique a conexão e tente de novo.'],
      engine: ['Falha ao iniciar o sistema', 'O aplicativo encontrou um erro durante a inicialização.'],
      unsupported: ['Navegador incompatível', 'Atualize para uma versão recente do Chrome, Edge, Firefox ou Safari para usar o sistema.']
    }
  };

  // Recursos cuja falha impede o boot (os demais só geram diagnóstico).
  var CRITICAL_SCRIPT_RE = /(?:^|\/)(?:flutter_bootstrap|flutter|main\.dart)\.(?:m?js|wasm)(?:[?#]|$)|canvaskit|skwasm/;

  // ---------------------------------------------------------------------------
  // Adaptador de navegador
  // ---------------------------------------------------------------------------

  function mount(win, doc) {
    var root = doc.documentElement;
    var cfg = readConfig(root.dataset, win.location.search);
    var perf = win.performance;
    var now = function () { return perf && perf.now ? perf.now() : Date.now(); };
    var log = function (level, msg, data) {
      if (!cfg.debug && level === 'debug') return;
      var c = win.console;
      if (c && c[level]) c[level]('[GestaoBoot] ' + msg, data === undefined ? '' : data);
    };
    var perfMark = function (name) {
      try { if (perf && perf.mark) perf.mark('gp:' + name); } catch (e) { /* ignora */ }
    };

    root.classList.remove('no-js');
    root.setAttribute('data-caret-policy', cfg.caretPolicy);
    perfMark('shell-start');

    // --- tenant + favicon ----------------------------------------------------
    var tenant = resolveTenant(win.location.host, cfg.tenantStrategy);
    if (tenant) {
      root.setAttribute('data-tenant', tenant);
      var href = tenantFaviconHref(cfg.tenantFavicon, tenant);
      var probe = new win.Image();
      probe.onload = function () {
        var link = doc.getElementById('favicon');
        if (link) link.href = href;
      };
      probe.onerror = function () { log('debug', 'favicon do tenant não encontrado; mantendo o padrão', href); };
      probe.src = href;
    }

    // --- elementos do loader ------------------------------------------------
    var el = {
      boot: doc.getElementById('gp-boot'),
      status: doc.getElementById('gp-boot-status'),
      hint: doc.getElementById('gp-boot-hint'),
      error: doc.getElementById('gp-boot-error'),
      errorTitle: doc.getElementById('gp-boot-error-title'),
      errorText: doc.getElementById('gp-boot-error-text'),
      detail: doc.getElementById('gp-boot-detail')
    };
    Array.prototype.forEach.call(doc.querySelectorAll('[data-gp-app-name]'), function (n) {
      n.textContent = cfg.appName;
    });

    var reducedMotion = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var removed = false;

    function removeLoader() {
      if (removed || !el.boot) return;
      removed = true;
      if (el.boot.parentNode) el.boot.parentNode.removeChild(el.boot);
    }

    function render(snap) {
      log('debug', 'estado', snap.state + ' / ' + snap.phase);
      if (!el.boot) return;
      el.boot.setAttribute('data-state', snap.state);
      if (snap.state === 'loading' || snap.state === 'slow') {
        if (el.status) el.status.textContent = COPY[snap.phase] || COPY.loading;
        if (el.hint) {
          el.hint.hidden = snap.state !== 'slow';
          el.hint.textContent = snap.state === 'slow' ? COPY.slow : '';
        }
        return;
      }
      if (doc.body) doc.body.setAttribute('aria-busy', 'false');
      if (snap.state === 'error') {
        var copy = COPY.errors[snap.error.kind] || COPY.errors.engine;
        if (el.status) el.status.textContent = '';
        if (el.hint) el.hint.hidden = true;
        if (el.errorTitle) el.errorTitle.textContent = copy[0];
        if (el.errorText) el.errorText.textContent = copy[1];
        if (el.detail) el.detail.textContent = '[' + snap.error.kind + '] ' + snap.error.detail;
        if (el.error) el.error.hidden = false;
        if (el.errorTitle && el.errorTitle.focus) el.errorTitle.focus();
        log('error', 'falha no boot (' + snap.error.kind + ')', snap.error.detail);
        return;
      }
      if (snap.state === 'ready') {
        perfMark('first-frame');
        log('debug', 'tempos (ms)', computeTimings(snap.marks));
        if (reducedMotion) return removeLoader();
        el.boot.addEventListener('transitionend', removeLoader, { once: true });
        win.setTimeout(removeLoader, 600); // garantia caso transitionend não dispare
      }
    }

    var machine = createBootMachine({
      slowMs: cfg.slowMs,
      timeoutMs: cfg.timeoutMs,
      now: now,
      setTimer: function (fn, ms) { return win.setTimeout(fn, ms); },
      clearTimer: function (id) { win.clearTimeout(id); },
      onChange: render
    });

    // --- botões da tela de erro ---------------------------------------------
    doc.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest ? event.target.closest('[data-gp-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-gp-action');
      if (action === 'retry') return win.location.reload();
      if (action === 'clear-cache') {
        btn.disabled = true;
        var jobs = [];
        if (win.navigator.serviceWorker && win.navigator.serviceWorker.getRegistrations) {
          jobs.push(win.navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          }));
        }
        if (win.caches && win.caches.keys) {
          jobs.push(win.caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return win.caches.delete(k); }));
          }));
        }
        Promise.all(jobs).catch(function (e) { log('warn', 'limpeza de cache parcial', describeError(e)); })
          .then(function () { win.location.reload(); });
      }
    });

    // --- política de Tab ----------------------------------------------------
    doc.addEventListener('keydown', function (event) {
      var t = event.target;
      var inShell = !!(t && t.closest && t.closest('#gp-boot'));
      var inApp = t === doc.body || t === root || !t ||
        !!(t.closest && t.closest('flutter-view, flt-glass-pane'));
      var semantics = !!doc.querySelector('flt-semantics-host flt-semantics, flt-semantics-host [role]');
      if (shouldTrapTab(cfg.tabPolicy, { code: event.code, targetInShell: inShell, targetInApp: inApp, semanticsEnabled: semantics })) {
        event.preventDefault();
      }
    });

    // --- sinais de boot -----------------------------------------------------
    win.addEventListener('flutter-first-frame', function () { machine.firstFrame(); }, { once: true });

    // Erros de carregamento de <script> não borbulham, mas são capturáveis.
    win.addEventListener('error', function (event) {
      var t = event.target;
      if (!t || t === win || t.tagName !== 'SCRIPT') return;
      var src = t.getAttribute('src') || '';
      if (CRITICAL_SCRIPT_RE.test(src)) machine.fail('script', 'Falha ao carregar ' + src);
      else log('warn', 'script não essencial falhou', src);
    }, true);

    var bridge = createLexicalBridge({
      win: win,
      doc: doc,
      selector: cfg.lexicalSelector,
      legacyFallback: cfg.lexicalLegacyFallback,
      log: log
    });

    var api = {
      version: VERSION,
      config: cfg,
      tenant: tenant,
      lexical: bridge,
      phase: function (name) { perfMark(name); machine.phase(name); },
      fail: function (kindOrError, detail) {
        if (typeof kindOrError === 'string' && COPY.errors[kindOrError]) machine.fail(kindOrError, detail);
        else machine.fail('engine', kindOrError);
      },
      timings: function () { return computeTimings(machine.snapshot().marks); },
      get state() { return machine.state; }
    };
    win.GestaoBoot = api;

    // Compatível com a assinatura original chamada pelo Dart (js interop).
    win.sendToLexical = function (type, message) { return bridge.send(type, message); };

    machine.start();

    var supported = typeof win.Promise === 'function' && typeof win.fetch === 'function' &&
      typeof win.WebAssembly === 'object';
    if (!supported) machine.fail('unsupported', 'Promise/fetch/WebAssembly ausentes');

    return api;
  }

  return {
    VERSION: VERSION,
    DEFAULTS: DEFAULTS,
    readConfig: readConfig,
    resolveTenant: resolveTenant,
    tenantFaviconHref: tenantFaviconHref,
    shouldTrapTab: shouldTrapTab,
    createBootMachine: createBootMachine,
    computeTimings: computeTimings,
    deriveTargetOrigin: deriveTargetOrigin,
    createLexicalBridge: createLexicalBridge,
    CRITICAL_SCRIPT_RE: CRITICAL_SCRIPT_RE,
    mount: mount
  };
});
