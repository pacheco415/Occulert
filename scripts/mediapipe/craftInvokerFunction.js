function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
  var argCount = argTypes.length;
  if (argCount < 2) {
    throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
  }
  var isClassMethodFunc = argTypes[1] !== null && classType !== null;
  var needsDestructorStack = false;
  for (var i = 1; i < argCount; ++i) {
    if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) {
      needsDestructorStack = true;
      break;
    }
  }
  var invoker = function() {
    if (arguments.length !== argCount - 2) {
      throwBindingError('function ' + humanName + ' called with ' + arguments.length + ' arguments, expected ' + (argCount - 2) + ' args!');
    }
    var destructors = needsDestructorStack ? [] : null;
    var wired = [];
    if (isClassMethodFunc) wired.push(argTypes[1].toWireType(destructors, this));
    for (var i = 0; i < arguments.length; ++i) {
      wired.push(argTypes[i + 2].toWireType(destructors, arguments[i]));
    }
    var result = cppInvokerFunc.apply(undefined, [cppTargetFunc].concat(wired));
    // Match the pinned runtime: cleanup happens after a successful native call,
    // before converting its return value. Do not introduce new exception semantics.
    if (needsDestructorStack) {
      runDestructors(destructors);
    } else {
      for (var i = isClassMethodFunc ? 1 : 2, j = 0; i < argCount; ++i, ++j) {
        if (argTypes[i].destructorFunction !== null) argTypes[i].destructorFunction.call(undefined, wired[j]);
      }
    }
    if (argTypes[0].name !== 'void') return argTypes[0].fromWireType(result);
  };
  Object.defineProperty(invoker, 'name', { value: makeLegalFunctionName(humanName), configurable: true });
  Object.defineProperty(invoker, 'length', { value: argCount - 2, configurable: true });
  return invoker;
}
