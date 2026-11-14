const assert = require('node:assert/strict');
const { lstatSync } = require('node:fs');
const { basename, dirname, relative, resolve } = require('node:path');
const { withMod } = require('expo/config-plugins');
const { PBXNativeTarget, PBXFileReference, PBXFileSystemSynchronizedRootGroup } = require('@bacons/xcode');

const manifestName = 'PrivacyInfo.xcprivacy';

// Register BEFORE @bacons/apple-targets: its custom base provider executes the
// target generator before this action. Ordinary Expo xcodeproj mods run first,
// so ios.privacyManifests creates the phone aggregate's own explicit resource.
module.exports = function withWatchPrivacy(config) {
  return withMod(config, { platform: 'ios', mod: 'xcodeProjectBeta2', action: async config => {
    const project = config.modResults;
    const targets = project.rootObject.props.targets.filter(target => PBXNativeTarget.is(target));
    const watches = targets.filter(target => target.isWatchOSTarget());
    assert.equal(watches.length, 1, 'Expected one generated Watch application.');
    const watch = watches[0];
    assert.equal(watch.props.name, 'OcculertWatch', 'Unexpected Watch target.');
    const manifestPath = resolve(config.modRequest.projectRoot, 'targets/occulert-watch', manifestName);
    assert.ok(lstatSync(manifestPath).isFile() && !lstatSync(manifestPath).isSymbolicLink(), 'Watch privacy source must be a regular file.');

    // RN's aggregation chooses the first explicit app manifest. Ensure the
    // phone has its own generated file before registering the Watch resource;
    // otherwise RN could aggregate into the tracked Watch source instead.
    const phones = targets.filter(target => target.props.productType === 'com.apple.product-type.application' && !target.isWatchOSTarget());
    assert.equal(phones.length, 1, 'Expected one phone application.');
    const phoneManifests = phones[0].getResourcesBuildPhase().getFileReferences()
      .filter(file => file && basename(file.props.path || '') === manifestName);
    assert.equal(phoneManifests.length, 1, 'Generate the phone privacy manifest before Watch registration.');
    assert.notEqual(resolve(phoneManifests[0].getRealPath()), manifestPath, 'Phone and Watch need separate privacy manifests.');
    assert.ok(targets.indexOf(phones[0]) < targets.indexOf(watch), 'Phone privacy aggregation must precede Watch resources.');

    const groups = watch.props.fileSystemSynchronizedGroups || [];
    assert.equal(groups.length, 1, 'Expected one synchronized Watch source group.');
    const group = groups[0];
    assert.ok(PBXFileSystemSynchronizedRootGroup.is(group), 'Watch source group changed.');
    const parent = project.rootObject.props.mainGroup.getChildGroups()
      .find(candidate => candidate.props.children.includes(group));
    assert.ok(parent, 'Watch source group parent is missing.');
    assert.equal(resolve(project.getProjectRoot(), parent.props.path, group.props.path), dirname(manifestPath), 'Watch source path changed.');
    const exceptions = (group.props.exceptions || []).filter(exception => exception.props.target === watch);
    assert.equal(exceptions.length, 1, 'Expected one Watch membership exception set.');

    const resources = watch.getResourcesBuildPhase();
    // Repair existing membership after RN previously added the phone resource.
    // Remove only that Watch build-file membership, never the shared phone file
    // reference or the phone target's own resource membership.
    for (const file of resources.getFileReferences()) {
      if (file && basename(file.props.path || '') === manifestName && resolve(file.getRealPath()) !== manifestPath) {
        resources.removeFileReference(file);
      }
    }
    const references = [...project.values()].filter(file => PBXFileReference.is(file)
      && basename(file.props.path || '') === manifestName && resolve(file.getRealPath()) === manifestPath);
    assert.ok(references.length <= 1, 'Duplicate Watch privacy file references require review.');
    const reference = references[0] || project.rootObject.props.mainGroup.createFile({
      path: relative(project.getProjectRoot(), manifestPath), sourceTree: 'SOURCE_ROOT',
      name: 'Watch Privacy Manifest', lastKnownFileType: 'text.xml',
    });
    resources.ensureFile({ fileRef: reference });
    const membership = exceptions[0].props.membershipExceptions || [];
    exceptions[0].props.membershipExceptions = [...new Set([...membership, manifestName])].sort();
    assert.equal(resources.getFileReferences().filter(file => file && basename(file.props.path || '') === manifestName).length, 1,
      'Watch must have exactly one explicit privacy resource.');
    return config;
  } });
};
