// extraido de replica/original/index.html linha 134

      window.onload = function () {
        let favicon = document.getElementById('favicon');
        let domain = window.location.host.split('.')[1];

        favicon.href = 'favicon' + (domain ? '-' + domain : '') + '.ico';
      };
    