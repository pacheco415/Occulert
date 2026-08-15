// Loads the pinned Supabase browser SDK from an Occulert same-origin proxy first.
// A verified direct-CDN fallback keeps local development and transient proxy
// failures recoverable without changing the authenticated session model.
(function () {
  var VERSION = "2.112.3";
  var INTEGRITY = "sha384-l8ah+VgaWtk1mvOe9VC+OirC6qHFF4yH7l7mKRidV9MSti3E9F463bMp6ZVN4kuC";
  var SOURCES = [
    "/vendor/supabase-" + VERSION + ".min.js",
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@" + VERSION + "/dist/umd/supabase.min.js",
  ];
  var loadPromise = null;
  var lastError = null;

  function codedError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function available() {
    return Boolean(window.supabase && typeof window.supabase.createClient === "function");
  }

  function removePendingScripts() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll("script[data-occulert-supabase-sdk]").forEach(function (script) {
      if (script.parentNode) script.parentNode.removeChild(script);
    });
  }

  function inject(source) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      var settled = false;
      var timer = setTimeout(function () { finish(false, codedError("sdk_load_timeout")); }, 8000);

      function finish(ok, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (ok && available()) {
          script.dataset.occulertSupabaseSdk = "ready";
          resolve(window.supabase);
          return;
        }
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(error || codedError("sdk_load_failed"));
      }

      script.src = source;
      script.async = true;
      script.integrity = INTEGRITY;
      script.crossOrigin = "anonymous";
      script.dataset.occulertSupabaseSdk = "loading";
      script.onload = function () { finish(true); };
      script.onerror = function () { finish(false, codedError("sdk_load_failed")); };
      document.head.appendChild(script);
    });
  }

  async function attempt() {
    if (available()) return window.supabase;
    for (var index = 0; index < SOURCES.length; index += 1) {
      try {
        var sdk = await inject(SOURCES[index]);
        lastError = null;
        return sdk;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || codedError("sdk_load_failed");
  }

  function load(options) {
    options = options || {};
    if (available()) return Promise.resolve(window.supabase);
    if (options.force) {
      loadPromise = null;
      lastError = null;
      removePendingScripts();
    }
    if (!loadPromise) loadPromise = attempt().catch(function (error) { lastError = error; throw error; });
    return loadPromise;
  }

  function retry() { return load({ force: true }); }
  function state() {
    return {
      ready: available(),
      loading: Boolean(loadPromise && !available() && !lastError),
      error: lastError && lastError.code ? lastError.code : null,
    };
  }

  window.OcculertSupabaseLoader = {
    version: VERSION,
    integrity: INTEGRITY,
    sources: SOURCES.slice(),
    load: load,
    retry: retry,
    state: state,
  };

  load().catch(function () {});
})();
