const test = require('node:test');
const assert = require('node:assert/strict');
const { LlamaManager } = require('../dist/main/llama.js');

const tag = 'b11192';
const names = [
  `llama-${tag}-bin-macos-arm64.tar.gz`,
  `llama-${tag}-bin-macos-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-arm64.tar.gz`,
  `llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  `cudart-llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-cuda-13.4-x64.tar.gz`,
  `cudart-llama-${tag}-bin-ubuntu-cuda-13.4-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-cuda-13.4-arm64.tar.gz`,
  `cudart-llama-${tag}-bin-ubuntu-cuda-13.4-arm64.tar.gz`,
  `llama-${tag}-bin-ubuntu-rocm-10.0-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-vulkan-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-vulkan-arm64.tar.gz`,
  `llama-${tag}-bin-win-cpu-x64.zip`,
  `llama-${tag}-bin-win-cpu-arm64.zip`,
  `llama-${tag}-bin-win-cuda-12.4-x64.zip`,
  'cudart-llama-bin-win-cuda-12.4-x64.zip',
  `llama-${tag}-bin-win-cuda-13.4-x64.zip`,
  'cudart-llama-bin-win-cuda-13.4-x64.zip',
  `llama-${tag}-bin-win-cuda-13.4-arm64.zip`,
  'cudart-llama-bin-win-cuda-13.4-arm64.zip',
  `llama-${tag}-bin-win-vulkan-x64.zip`,
];
const release = {
  tag_name: tag,
  prerelease: false,
  assets: names.map(name => ({ name, size: 1, browser_download_url: `https://example.invalid/${name}` })),
};
const manager = new LlamaManager('/tmp/orion-llama-asset-test', () => {});
const choose = (backend, driver, platform, arch) => manager.chooseAssets(release, { backend, driver, label: 'test GPU' }, platform, arch);

test('selects the matching CUDA runtime and binary for Windows x64', () => {
  const selected = choose('cuda', '580.1', 'win32', 'x64');
  assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-win-cuda-13.4-x64.zip`);
  assert.equal(selected.cudart.name, 'cudart-llama-bin-win-cuda-13.4-x64.zip');
  assert.equal(selected.accelerated, true);
});

test('selects ARM64 CUDA on Windows when the driver supports CUDA 13', () => {
  const selected = choose('cuda', '580.1', 'win32', 'arm64');
  assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-win-cuda-13.4-arm64.zip`);
  assert.equal(selected.cudart.name, 'cudart-llama-bin-win-cuda-13.4-arm64.zip');
});

test('does not select an x64 accelerator binary for unsupported Windows ARM64 CUDA', () => {
  const selected = choose('cuda', '570.1', 'win32', 'arm64');
  assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-win-cpu-arm64.zip`);
  assert.equal(selected.accelerated, false);
  assert.equal(selected.cudart, undefined);
});

test('selects CUDA 12.8 and its tagged runtime on Linux x64', () => {
  const selected = choose('cuda', '570.1', 'linux', 'x64');
  assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`);
  assert.equal(selected.cudart.name, `cudart-llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`);
});

test('selects CUDA 13 on Linux ARM64 and never substitutes x64 Vulkan', () => {
  const selected = choose('cuda', '580.1', 'linux', 'arm64');
  assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-ubuntu-cuda-13.4-arm64.tar.gz`);
  assert.equal(selected.cudart.name, `cudart-llama-${tag}-bin-ubuntu-cuda-13.4-arm64.tar.gz`);
});

test('selects Vulkan for the matching Linux architecture', () => {
  const selected = choose('vulkan', '', 'linux', 'arm64');
  assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-ubuntu-vulkan-arm64.tar.gz`);
  assert.equal(selected.accelerated, true);
});

test('selects the corresponding Metal-capable macOS archive for each architecture', () => {
  for (const arch of ['x64', 'arm64']) {
    const selected = choose('metal', '', 'darwin', arch);
    assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-macos-${arch}.tar.gz`);
  }
});

test('selects Windows CUDA 12.4 with its untagged runtime asset', () => {
  const selected = choose('cuda', '570.1', 'win32', 'x64');
  assert.equal(selected.gpuAsset.name, `llama-${tag}-bin-win-cuda-12.4-x64.zip`);
  assert.equal(selected.cudart.name, 'cudart-llama-bin-win-cuda-12.4-x64.zip');
});
