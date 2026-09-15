function __emval_get_method_caller(argCount, argTypes) {
  var types = __emval_lookupTypes(argCount, argTypes);
  var retType = types[0];
  var signatureName = retType.name + '_$' + types.slice(1).map(function(t) { return t.name; }).join('_') + '$';
  var caller = function(handle, name, destructors, args) {
    var values = [];
    var offset = 0;
    for (var i = 1; i < argCount; ++i) {
      values.push(types[i].readValueFromPointer(args + offset));
      offset += types[i].argPackAdvance;
    }
    var result = handle[name].apply(handle, values);
    for (var i = 1; i < argCount; ++i) {
      if (types[i].deleteObject) types[i].deleteObject(values[i - 1]);
    }
    if (!retType.isVoid) return retType.toWireType(destructors, result);
  };
  Object.defineProperty(caller, 'name', { value: makeLegalFunctionName('methodCaller_' + signatureName), configurable: true });
  return __emval_addMethodCaller(caller);
}
