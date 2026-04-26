// Set browser favicon from a URL (used to apply uploaded company logo as favicon)
(function(){
  window.setFaviconFromLogo = function(url){
    if(!url || typeof url !== 'string') return;
    var u = url.trim();
    if(!u) return;
    // accept absolute http(s), data URIs, or relative paths
    var heads = document.head || document.getElementsByTagName('head')[0];
    if(!heads) return;
    var links = document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]');
    if(links.length === 0){
      var l = document.createElement('link');
      l.rel = 'icon';
      l.href = u;
      heads.appendChild(l);
      return;
    }
    links.forEach(function(l){
      l.href = u;
      // drop type if URL not svg
      if(!/\.svg(\?|$)/i.test(u)) l.removeAttribute('type');
    });
  };
})();
