{{flutter_js}}
{{flutter_build_config}}

// Template de bootstrap customizado (Flutter ≥ 3.22). O `flutter build web`
// substitui os dois tokens acima pelo loader oficial e pela configuração do build.
// Aqui só acrescentamos: aviso de fases ao shell e captura de falhas.
(function () {
  var boot = window.GestaoBoot;
  function phase(name) {
    if (boot) boot.phase(name);
  }
  function fail(error) {
    if (boot) boot.fail(error);
    else if (window.console) console.error(error);
  }

  phase('bootstrap');

  try {
    var loading = _flutter.loader.load({
      onEntrypointLoaded: function (engineInitializer) {
        phase('engine');
        return engineInitializer
          .initializeEngine()
          .then(function (appRunner) {
            phase('app');
            return appRunner.runApp();
          })
          .catch(fail);
      }
    });
    if (loading && typeof loading.catch === 'function') loading.catch(fail);
  } catch (error) {
    fail(error);
  }
})();
