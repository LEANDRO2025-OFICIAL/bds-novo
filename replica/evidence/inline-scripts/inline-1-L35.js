// extraido de replica/original/index.html linha 35

      function sendToLexical(type, message) {
        window.top.frames[0].postMessage({ type: type, payload: message }, '*');
      }
    