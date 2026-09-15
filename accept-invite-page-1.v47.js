(function(){
      var token=new URLSearchParams(location.hash.slice(1)).get('token');
      if(token)sessionStorage.setItem('occulert-invite-token',token);
      if(location.hash)history.replaceState(null,'',location.pathname+location.search);
    })();
