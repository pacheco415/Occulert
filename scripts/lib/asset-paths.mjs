import { lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Runtime output has two owned locations. Keep logical names independent of
// their directory so aliases and version allocation can use the same identity.
export function parseRuntimeAssetPath(name) {
  const match = typeof name === 'string'
    ? /^(?:assets\/runtime\/)?([\w-]+)\.v([0-9]+)\.(js|css)$/.exec(name)
    : null;
  if (!match || match[0] !== name) throw new Error('Invalid runtime asset path');
  const [, stem, version, extension] = match;
  const basename = `${stem}.v${version}.${extension}`;
  return { relativePath: name, publicPath: `/${name}`, basename,
    logicalName: `${stem}.${extension}`, version, extension };
}

// Check each component with lstat rather than following links. This also
// rejects dangling symlinks, which an existence check would overlook.
export function resolveRuntimeAssetPath(root, name) {
  const { relativePath } = parseRuntimeAssetPath(name);
  const components = relativePath.split('/');
  let filename = resolve(root);
  for (let index = 0; index < components.length; index++) {
    filename = join(filename, components[index]);
    const entry = lstatSync(filename, { throwIfNoEntry: false });
    if (!entry) throw new Error(`Runtime asset path does not exist: ${name}`);
    if (entry.isSymbolicLink()) throw new Error(`Runtime asset paths must not be symlinks: ${name}`);
    if (index < components.length - 1) {
      if (!entry.isDirectory()) throw new Error(`Runtime asset parent is not a directory: ${name}`);
    } else if (!entry.isFile()) throw new Error(`Runtime asset is not a regular file: ${name}`);
  }
  return filename;
}
