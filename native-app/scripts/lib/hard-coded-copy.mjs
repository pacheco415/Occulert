import ts from 'typescript';

// Finds user-facing copy that a screen hard-codes instead of reading from
// lib/strings.ts. It is a conservative source check, not a renderer.

// JSX props that carry identifiers, routes, roles or styling rather than copy.
const NON_COPY_PROPS = new Set([
  'name', 'icon', 'href', 'accessibilityRole', 'accessibilityLiveRegion', 'size', 'color',
  'tintColor', 'style', 'testID', 'nativeID', 'activeOpacity', 'keyboardType', 'autoCapitalize',
  'autoComplete', 'textContentType', 'returnKeyType', 'pointerEvents', 'resizeMode',
  'importantForAccessibility', 'ellipsizeMode', 'mode', 'animationType', 'presentationStyle',
  'behavior', 'contentInsetAdjustmentBehavior', 'glassEffectStyle', 'attentionKey', 'key', 'pixelFormat',
  'keyboardShouldPersistTaps', 'keyboardDismissMode', 'submitBehavior', 'trackColor', 'thumbColor',
  'placeholderTextColor',
]);
const COPY_PROPERTIES = new Set(['title', 'subtitle', 'label', 'message', 'detail', 'description',
  'text', 'hint', 'accessibilityLabel', 'accessibilityHint', 'headerBackTitle', 'placeholder']);
const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const hasWords = text => /\p{L}{2,}/u.test(text);

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ');
  return null;
}

// Literal copy inside a JSX expression. State comparisons and function or call
// bodies (handlers, routes) are not rendered text, so they are not walked.
// The main visitor checks nested JSX, named copy properties and Alert calls separately.
function expressionCopy(expression, record) {
  const visit = node => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isCallExpression(node)) return;
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind)) return;
    if (ts.isPropertyAssignment(node)) return visit(node.initializer);
    const text = literalText(node);
    if (text !== null) {
      record(node, text);
      if (!ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
}

export function hardCodedCopy(fileName, code) {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  // Embedded configuration and JSX can both reach the same literal. Report it once.
  const found = new Map();
  const record = (node, text) => {
    if (hasWords(text)) found.set(node, { text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  };
  const visit = node => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      record(node, text);
    } else if (ts.isJsxAttribute(node)) {
      const prop = node.name.getText(source);
      if (!NON_COPY_PROPS.has(prop) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          record(node.initializer, node.initializer.text);
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          expressionCopy(node.initializer.expression, record);
        }
      }
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      expressionCopy(node.expression, record);
    } else if (ts.isCallExpression(node) && /^Alert\.(alert|prompt)$/.test(node.expression.getText(source))) {
      for (const argument of node.arguments.slice(0, 2)) expressionCopy(argument, record);
    } else if (ts.isPropertyAssignment(node) && COPY_PROPERTIES.has(
      ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : '')) {
      // Configuration objects and Alert button arrays contain rendered copy too.
      // Inspect only the value, never protocol keys or nested style objects.
      if (ts.isConditionalExpression(node.initializer)) {
        expressionCopy(node.initializer, record);
      } else {
        const text = literalText(node.initializer);
        if (text !== null) record(node.initializer, text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found.values()];
}
