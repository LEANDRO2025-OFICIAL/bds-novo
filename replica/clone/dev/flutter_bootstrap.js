// SIMULADOR LOCAL do Flutter — só existe no overlay de desenvolvimento (replica/clone/dev).
// Imita as fases do loader oficial e dispara 'flutter-first-frame'.
// Cenários (?sim=…): ok (padrão) | slow | fail | hang | 404
(function () {
  var params = new URLSearchParams(location.search);
  var sim = params.get('sim') || 'ok';
  var k = sim === 'slow' ? 6 : 1;
  var boot = window.GestaoBoot;

  function after(ms, fn) { setTimeout(fn, ms * k); }

  boot.phase('bootstrap');
  if (sim === 'hang') return;

  if (sim === '404') {
    var s = document.createElement('script');
    s.src = 'main.dart.js'; // não existe → o shell captura o erro de carregamento
    document.body.appendChild(s);
    return;
  }

  after(500, function () {
    boot.phase('engine');
    if (sim === 'fail') {
      after(400, function () { boot.fail(new Error('Simulado: falha ao inicializar o motor (WebGL indisponível)')); });
      return;
    }
    after(500, function () {
      boot.phase('app');
      // Mensagem enviada ANTES de o iframe existir: deve ficar na fila e ser entregue após o handshake.
      window.__queuedResult = window.sendToLexical('setText', 'Mensagem enviada antes de o editor existir');
      after(500, mountFakeApp);
    });
  });

  function mountFakeApp() {
    var view = document.createElement('flutter-view');
    view.setAttribute('tabindex', '0');
    view.style.cssText = 'position:fixed;inset:0;display:block;padding:24px;box-sizing:border-box;' +
      'font:16px/1.5 system-ui,sans-serif;background:var(--gp-bg);color:var(--gp-text);overflow:auto';
    view.innerHTML =
      '<h2 style="margin:0 0 8px">App simulado (overlay de desenvolvimento)</h2>' +
      '<p style="margin:0 0 16px;color:var(--gp-text-muted)">Este conteúdo substitui o canvas do Flutter para testar o shell.</p>' +
      '<label for="sim-text">Texto para o editor</label><br>' +
      '<input id="sim-text" value="Olá, Lexical" style="font:inherit;padding:6px;margin:4px 0 8px;width:260px"> ' +
      '<button id="sim-send" type="button" style="font:inherit;padding:6px 12px">sendToLexical</button>' +
      '<p id="sim-log" style="font-family:monospace;font-size:13px;white-space:pre-wrap"></p>' +
      '<iframe data-lexical src="__dev/lexical.html" title="Editor (simulado)" ' +
      'style="width:100%;max-width:560px;height:140px;border:1px solid var(--gp-border);border-radius:8px"></iframe>';
    document.body.appendChild(view);

    var logEl = view.querySelector('#sim-log');
    window.GestaoBoot.lexical.on('*', function (msg) {
      logEl.textContent += '← ' + JSON.stringify(msg) + '\n';
    });
    view.querySelector('#sim-send').addEventListener('click', function () {
      var r = window.sendToLexical('setText', view.querySelector('#sim-text').value);
      logEl.textContent += '→ setText (' + r + ')\n';
    });

    // setTimeout em vez de requestAnimationFrame: abas que não estão pintando
    // (painéis ocultos, automação) não executam rAF e travariam o simulador.
    setTimeout(function () {
      window.dispatchEvent(new Event('flutter-first-frame'));
    }, 0);
  }
})();
