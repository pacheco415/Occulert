import assert from 'node:assert/strict';
import Yoga from 'yoga-layout';
import { flattenStyle } from './monitor-layout-test-harness.mjs';

const edges = {
  '': Yoga.EDGE_ALL, Horizontal: Yoga.EDGE_HORIZONTAL, Vertical: Yoga.EDGE_VERTICAL,
  Top: Yoga.EDGE_TOP, Right: Yoga.EDGE_RIGHT, Bottom: Yoga.EDGE_BOTTOM, Left: Yoga.EDGE_LEFT,
};

/**
 * Lay out the mounted TSX host tree with Yoga, using RN's non-web defaults.
 * Text uses a deliberately conservative fixed advance, not native font metrics.
 * This tests flex allocation and clipping; native text/occlusion/pose acceptance
 * still requires the actual app on a supported device.
 */
export function measureLayout(tree, { width, height, fontScale = 1, scale = 3 }) {
  const config = Yoga.Config.create();
  config.setPointScaleFactor(scale);
  const entries = [];
  const applyStyle = (node, style) => {
    const dimensions = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flex', 'flexGrow', 'flexShrink', 'flexBasis'];
    for (const key of dimensions) {
      if (style[key] !== undefined) node['set' + key[0].toUpperCase() + key.slice(1)](style[key]);
    }
    for (const [suffix, edge] of Object.entries(edges)) {
      if (style['padding' + suffix] !== undefined) node.setPadding(edge, style['padding' + suffix]);
      if (style['margin' + suffix] !== undefined) node.setMargin(edge, style['margin' + suffix]);
    }
    if (style.borderWidth !== undefined) node.setBorder(Yoga.EDGE_ALL, style.borderWidth);
    if (style.gap !== undefined) node.setGap(Yoga.GUTTER_ALL, style.gap);
    if (style.flexDirection) node.setFlexDirection({ row: Yoga.FLEX_DIRECTION_ROW, column: Yoga.FLEX_DIRECTION_COLUMN }[style.flexDirection]);
    if (style.alignItems) node.setAlignItems({ center: Yoga.ALIGN_CENTER, stretch: Yoga.ALIGN_STRETCH, 'flex-start': Yoga.ALIGN_FLEX_START, 'flex-end': Yoga.ALIGN_FLEX_END }[style.alignItems]);
    if (style.justifyContent) node.setJustifyContent({ center: Yoga.JUSTIFY_CENTER, 'space-between': Yoga.JUSTIFY_SPACE_BETWEEN, 'flex-start': Yoga.JUSTIFY_FLEX_START }[style.justifyContent]);
    if (style.position === 'absolute') node.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
      const value = style[edge.toLowerCase()];
      if (value !== undefined) node.setPosition(edges[edge], value);
    }
  };
  const build = (host, parent = null) => {
    assert.ok(host && !Array.isArray(host), 'one mounted host root');
    const node = Yoga.Node.create(config);
    const style = flattenStyle(host.props?.style);
    applyStyle(node, style);
    const entry = { node, host, parent, clips: host.type === 'ScrollView' || style.overflow === 'hidden' };
    entries.push(entry);
    if (host.type === 'Text') {
      const text = (host.children ?? []).join('');
      const fontSize = (style.fontSize ?? 14) * fontScale;
      const lineHeight = (style.lineHeight ?? (style.fontSize ?? 14) * 1.3) * fontScale;
      node.setMeasureFunc((availableWidth, widthMode) => {
        const characters = Array.from(text);
        // Emoji icons occupy a full em; counting them as a narrow Latin glyph
        // would give the warning text unrealistically generous wrapping room.
        const naturalWidth = characters.reduce((sum, character) => sum + fontSize * (character.codePointAt(0) > 0xffff ? 1 : .6), 0)
          + Math.max(0, characters.length - 1) * Math.max(0, style.letterSpacing ?? 0) * fontScale;
        const measuredWidth = widthMode === Yoga.MEASURE_MODE_UNDEFINED ? naturalWidth : Math.min(availableWidth, naturalWidth);
        return { width: measuredWidth, height: Math.max(1, Math.ceil(naturalWidth / Math.max(1, measuredWidth))) * lineHeight };
      });
    } else {
      let childParent = entry;
      if (host.type === 'ScrollView') {
        node.setOverflow(Yoga.OVERFLOW_SCROLL);
        const content = Yoga.Node.create(config);
        applyStyle(content, flattenStyle(host.props.contentContainerStyle));
        const contentEntry = { node: content, host: { type: 'ScrollContent' }, parent: entry, clips: false,
          scrollY: Math.max(0, host.props.contentOffset?.y ?? 0) };
        entries.push(contentEntry);
        node.insertChild(content, 0);
        childParent = contentEntry;
      }
      for (const child of host.children ?? []) {
        if (typeof child !== 'object' || child === null) continue;
        const childEntry = build(child, childParent);
        childParent.node.insertChild(childEntry.node, childParent.node.getChildCount());
      }
    }
    return entry;
  };
  const root = build(tree);
  root.node.setWidth(width);
  root.node.setHeight(height);
  root.node.calculateLayout(width, height, Yoga.DIRECTION_LTR);
  const frames = new Map();
  const absolute = entry => {
    const layout = entry.node.getComputedLayout();
    const origin = entry.parent ? absolute(entry.parent) : { x: 0, y: 0 };
    return { x: origin.x + layout.left, y: origin.y + layout.top - (entry.scrollY ?? 0), width: layout.width, height: layout.height };
  };
  try {
    for (const entry of entries) {
      const frame = absolute(entry);
      const clips = [{ x: 0, y: 0, width, height }];
      for (let ancestor = entry.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.clips) clips.push(absolute(ancestor));
      }
      const record = { ...frame, clips };
      const props = entry.host.props ?? {};
      if (props.testID) frames.set(props.testID, record);
      if (props.accessibilityRole === 'alert') frames.set('alert', record);
      if (entry.host.type === 'CameraFixture') frames.set('camera', record);
    }
    return frames;
  } finally {
    root.node.freeRecursive();
    config.free();
  }
}

export function assertVisible(frame, label) {
  assert.ok(frame, `${label}: mounted`);
  assert.ok(frame.width > 0 && frame.height > 0, `${label}: positive measured area`);
  // Yoga rounds at the display's backing scale; tolerate less than one pixel.
  const epsilon = 0.34;
  for (const clip of frame.clips) {
    assert.ok(frame.x >= clip.x - epsilon && frame.y >= clip.y - epsilon &&
      frame.x + frame.width <= clip.x + clip.width + epsilon &&
      frame.y + frame.height <= clip.y + clip.height + epsilon,
    `${label}: ${JSON.stringify(frame)} must fit ${JSON.stringify(clip)}`);
  }
}
