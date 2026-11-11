// extraido de replica/original/index.html linha 143

      document.addEventListener('keydown', (event) => {
        if (event.code == 'Tab') {
          event.preventDefault();
        }
      });

      window.addEventListener('flutter-first-frame', function () {
        let el = document.getElementsByClassName('loading')[0];
        if (el != undefined && el != null) el.remove();
      });
    