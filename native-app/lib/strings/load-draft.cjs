// Metro and Node can load a TypeScript module synchronously here. Delay the
// seven translation dictionaries until a reviewed device language needs one.
exports.loadDraft = (locale, english) => require('./draft-catalog.ts').createDraft(locale, english);
