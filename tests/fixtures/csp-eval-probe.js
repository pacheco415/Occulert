try {
  new Function('return 1')();
  window.cspEvalProbe = 'allowed';
} catch (error) {
  window.cspEvalProbe = error.name;
}
