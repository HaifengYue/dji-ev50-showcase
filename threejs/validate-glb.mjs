import fs from 'node:fs';
import validator from 'gltf-validator';
const modelPath = 'public/ev50.glb';
const result = await validator.validateBytes(new Uint8Array(fs.readFileSync(modelPath)), {
  uri: 'ev50.glb',
  maxIssues: 10000,
});
if (process.env.WRITE_VALIDATION_REPORTS) {
  fs.writeFileSync('../docs/gltf_validator.json', JSON.stringify(result, null, 2) + '\n');
}
console.log(
  JSON.stringify({
    errors: result.issues.numErrors,
    warnings: result.issues.numWarnings,
    infos: result.issues.numInfos,
  }),
);
if (result.issues.numErrors) process.exitCode = 1;
