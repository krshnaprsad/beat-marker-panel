/* Minimal bridge to the CEP host. Outside Premiere / After Effects (a normal browser) hasHost is false and the panel runs in demo mode. */
var Bridge = (function () {
  var cep = window.__adobe_cep__;
  function evalScript(script, cb) {
    if (!cep) { if (cb) cb("EvalScript error."); return; }
    cep.evalScript(script, cb || function () {});
  }
  function hostName() {
    if (!cep) return "none";
    try { return JSON.parse(cep.getHostEnvironment()).appName; } catch (e) { return "unknown"; }
  }
  return { hasHost: !!cep, evalScript: evalScript, hostName: hostName };
})();
