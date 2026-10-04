/** Current GLB scene identity, without decoding geometry or changing motion fingerprints. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {PropertyBinding} from 'three';

export function glbNodeInventory(bytes, expectedSha256) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 20, 'Missing current GLB bytes');
  const modelSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(modelSha256, expectedSha256, 'Current node inventory model hash differs');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Invalid GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'Unsupported GLB version');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'Truncated GLB inventory input');
  const jsonLength = bytes.readUInt32LE(12);
  assert(jsonLength > 0 && jsonLength % 4 === 0 && 20 + jsonLength <= bytes.length, 'Invalid GLB JSON chunk');
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'First GLB chunk must be JSON');
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  assert(Array.isArray(json.nodes) && Array.isArray(json.scenes), 'Missing GLB scene graph');
  // This verifier deliberately supports the current rigid, single-scene export only.
  // Fail closed if a new format would create synthetic loader nodes or ambiguous names.
  assert.equal(json.scenes.length, 1, 'Additional scenes need an explicit inventory implementation');
  assert.equal(json.scene ?? 0, 0, 'Unexpected active scene');
  assert(!json.skins?.length, 'Skinned nodes need an explicit inventory implementation');
  const scene = json.scenes[0], seenNames = new Set(), visited = new Set(), nodes = [];
  const name = value => {
    assert(typeof value === 'string' && value.length > 0, 'All actual nodes must be named');
    const result = PropertyBinding.sanitizeNodeName(value);
    assert(result && !seenNames.has(result), 'Ambiguous sanitized current node name: ' + result);
    seenNames.add(result);
    return result;
  };
  assert(!Object.keys(scene.extensions ?? {}).length, 'Scene extensions need an explicit inventory implementation');
  const rootName = name(scene.name);
  nodes.push({name: rootName, parent: null, type: 'Group', isMesh: false});
  const visit = (index, parent) => {
    assert(Number.isInteger(index) && index >= 0 && index < json.nodes.length, 'Invalid current node index');
    assert(!visited.has(index), 'Current scene has a cycle or a multiply-parented node');
    visited.add(index);
    const node = json.nodes[index], nodeName = name(node.name), isMesh = node.mesh !== undefined;
    assert(node.camera === undefined && node.skin === undefined && !Object.keys(node.extensions ?? {}).length,
      'Node kind/extensions need an explicit inventory implementation: ' + nodeName);
    if (isMesh) {
      assert(Number.isInteger(node.mesh) && node.mesh >= 0, 'Invalid current mesh index');
      const mesh = json.meshes?.[node.mesh];
      assert(mesh && mesh.primitives?.length === 1, 'Multi-primitive mesh needs explicit synthetic-node inventory: ' + nodeName);
      assert((mesh.primitives[0].mode ?? 4) === 4, 'Non-triangle mesh needs explicit inventory: ' + nodeName);
    }
    nodes.push({name: nodeName, parent, type: isMesh ? 'Mesh' : 'Object3D', isMesh});
    assert(node.children === undefined || Array.isArray(node.children), 'Invalid current children list');
    for (const child of node.children ?? []) visit(child, nodeName);
  };
  assert(Array.isArray(scene.nodes), 'Missing current scene roots');
  for (const index of scene.nodes) visit(index, rootName);
  assert.equal(visited.size, json.nodes.length, 'Unreachable GLB nodes cannot certify current scene identity');
  nodes.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return {modelSha256, nodeCount: nodes.length, meshCount: nodes.filter(n => n.isMesh).length, nodes,
    method: 'Current hash-bound GLB JSON scene graph; exact Three.js name sanitization; no geometry decoding'};
}

export function readCurrentNodeInventory(file, expectedSha256) {
  return {...glbNodeInventory(fs.readFileSync(file), expectedSha256), source: file};
}
