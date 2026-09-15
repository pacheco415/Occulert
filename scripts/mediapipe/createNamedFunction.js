function createNamedFunction(name, body) {
  // Equivalent strict wrapper without constructing JavaScript from a string.
  var wrapper = function() {
    "use strict";
    return body.apply(this, arguments);
  };
  Object.defineProperty(wrapper, "name", { value: makeLegalFunctionName(name), configurable: true });
  return wrapper;
}
