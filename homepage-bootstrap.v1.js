(function(){
  try{
    var hash=window.location.hash||'';
    var params=new URLSearchParams(hash.slice(1));
    if(params.get('type')==='recovery'){
      window.location.replace('/account.html?recovery=1'+hash);
    }
  }catch(error){}
})();
