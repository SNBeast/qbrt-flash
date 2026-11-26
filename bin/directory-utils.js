import path from 'path';
export function getPlatformDirectories(platform, arch) {
  const qbrtFlashRoot = path.join(import.meta.dirname, '..');
  const buildSupportDir = path.join(qbrtFlashRoot, 'build_support');
  const qbrtDir = path.join(qbrtFlashRoot, 'qbrt');
  const shellDir = path.join(qbrtFlashRoot, 'shell');
  const buildID = `${platform}_${arch}`;
  const distDir = path.join(qbrtFlashRoot, 'dist', buildID);
  const installDir = path.join(distDir, platform === 'macos' ? 'Runtime.app' : 'runtime');
  const resourcesDir = platform === 'macos' ? path.join(installDir, 'Contents', 'Resources') : installDir;
  const executableDir = platform === 'macos' ? path.join(installDir, 'Contents', 'MacOS') : installDir;
  return { buildSupportDir, qbrtDir, shellDir, buildID, distDir, installDir, resourcesDir, executableDir };
}
