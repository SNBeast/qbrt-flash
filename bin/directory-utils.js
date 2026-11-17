import path from 'path';
export function getPlatformDirectories(platform, legacy) {
  const buildDir = path.join(import.meta.dirname, '..', 'build_support');
  const distDir = path.join(import.meta.dirname, '..', 'dist', platform + (legacy ? 'Legacy' : ''));
  const installDir = path.join(distDir, platform === 'darwin' ? 'Runtime.app' : 'runtime');
  const resourcesDir = platform === 'darwin' ? path.join(installDir, 'Contents', 'Resources') : installDir;
  const executableDir = platform === 'darwin' ? path.join(installDir, 'Contents', 'MacOS') : installDir;
  return { buildDir, distDir, installDir, resourcesDir, executableDir };
}
