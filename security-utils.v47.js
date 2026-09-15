(function exposeSecurityUtils(root) {
  function csvCell(value) {
    const raw = String(value == null ? '' : value);
    return raw.replace(/^(\s*)([=+\-@])/, "$1'$2");
  }

  const api = Object.freeze({ csvCell });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OcculertSecurity = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
