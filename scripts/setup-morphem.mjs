import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// MorphEm (CaicedoLab/MorphEm, CHAMMI-75 DINO ViT-S Bag-of-Channels) backbone
// exported to a single-file ONNX graph from the published safetensors weights
// (revision 0e8d58787421f83f975634d72420d85c5dfc9c2c) and validated against
// an independent torch forward pass of the published vision_transformer.py
// (max abs diff ~1e-5 on a synthetic input). The graph outputs the 384-dim
// normalized CLS-token embedding; the head is intentionally unused.
export const MORPHEM = Object.freeze({
  name: 'MorphEm ViT-S backbone (CLS embedding)',
  revision: '0e8d58787421f83f975634d72420d85c5dfc9c2c',
  sha256: '819132f2ef159e04e718bdf7c9e83a1e30f81cd305ca1ff299d74c5a6a9cec31',
  bytes: 86216588,
  embedDim: 384,
  inputSize: 224,
  channels: 1,
  license: 'MIT (MorphEm); Apache-2.0 (timm-derived architecture file)',
});

async function generateModel(target) {
  // A frozen, weight-free graph recipe avoids PyTorch/exporter/platform drift.
  // Python's standard library is sufficient: no uv/pip/torch install in CI.
  const python = process.env.MORPHEM_PYTHON || 'python3';
  const script = fileURLToPath(new URL('./export-morphem.py', import.meta.url));
  const args = [script, '--output', target];
  if (process.env.MORPHEM_WEIGHTS) args.push('--weights', resolve(process.env.MORPHEM_WEIGHTS));
  console.log(`Provisioning missing ${target} from pinned upstream safetensors`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(python, args, { stdio: 'inherit', timeout: 300_000 });
    child.on('error', (error) => {
      reject(
        new Error(
          `Cannot run MorphEm provisioning with ${python}; install Python >=3.10 or set MORPHEM_PYTHON. ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.on('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(new Error(`MorphEm provisioning failed (exit ${code}, signal ${signal ?? 'none'})`));
    });
  });
}

// Clean checkouts generate the pinned graph; valid existing assets need no
// Python or network. Corrupt existing files fail closed, never silently replace.
export async function setupMorphem(directory = resolve('public/models')) {
  await mkdir(directory, { recursive: true });
  const target = resolve(directory, 'morphem-vit.onnx');
  let data;
  try {
    data = await readFile(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await generateModel(target);
    data = await readFile(target);
  }
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (data.length !== MORPHEM.bytes || sha256 !== MORPHEM.sha256)
    throw new Error(
      `morphem-vit.onnx size/SHA-256 verification failed; expected ${MORPHEM.bytes} bytes / ${MORPHEM.sha256}, got ${data.length} / ${sha256}`,
    );
  await writeFile(
    resolve(directory, 'morphem-vit.provenance.json'),
    `${JSON.stringify(MORPHEM, null, 2)}\n`,
  );
  console.log(`Verified ${target} (${MORPHEM.bytes} bytes; SHA-256 ${MORPHEM.sha256})`);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await setupMorphem(process.argv[2]);
}
