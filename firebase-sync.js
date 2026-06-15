// Occulert Firebase sync helper
// This file is intentionally safe: it falls back to localStorage until Firebase is configured.

(function () {
  function localSave(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function localRead(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch (e) { return fallback; }
  }

  window.OcculertSync = {
    isCloudEnabled: function () {
      return !!(window.OCCULERT_FIREBASE_ENABLED && window.firebase && window.OCCULERT_FIREBASE_CONFIG);
    },

    saveLiveSession: async function (payload) {
      payload.updatedAt = payload.updatedAt || new Date().toISOString();
      localSave('occulert-live-session', payload);

      var history = localRead('occulert-session-history', []);
      if (history.length && history[0].driverId === payload.driverId) history[0] = payload;
      else history.unshift(payload);
      localSave('occulert-session-history', history.slice(0, 50));

      // Firebase integration will go here after config is added.
      return payload;
    },

    savePilotLead: async function (lead) {
      lead.createdAt = lead.createdAt || new Date().toISOString();
      var leads = localRead('occulert-pilot-leads', []);
      leads.unshift(lead);
      localSave('occulert-pilot-leads', leads.slice(0, 100));
      return lead;
    },

    getLiveSession: function () {
      return localRead('occulert-live-session', null);
    },

    getSessionHistory: function () {
      return localRead('occulert-session-history', []);
    }
  };
})();
