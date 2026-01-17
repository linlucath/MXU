import type { MxuConfig } from '@/types/config';
import { defaultConfig } from '@/types/config';

const CONFIG_FILE_NAME = 'mxu.json';

// 检测是否在 Tauri 环境中
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

/**
 * 将 HTTP URL 路径转换为文件系统路径
 * 例如: "/test" -> "{resourceDir}/test" (开发模式)
 */
async function resolveFileSystemPath(httpPath: string): Promise<string> {
  if (!isTauri()) {
    return httpPath;
  }

  try {
    const { appDataDir } = await import('@tauri-apps/api/path');
    const baseDir = await appDataDir();
    console.log('[configService] appDataDir:', baseDir);

    // 空路径或当前目录
    if (httpPath === '' || httpPath === '.') {
      return baseDir;
    }

    // HTTP 路径以 "/" 开头，去掉开头的 "/"
    if (httpPath.startsWith('/')) {
      const relativePath = httpPath.slice(1);
      return `${baseDir}${relativePath}`;
    }

    return `${baseDir}${httpPath}`;
  } catch (err) {
    console.error('[configService] 获取应用数据目录失败:', err);
    return httpPath;
  }
}

/**
 * 获取配置文件路径
 */
function getConfigPath(basePath: string): string {
  if (basePath === '' || basePath === '.') {
    return `./${CONFIG_FILE_NAME}`;
  }
  return `${basePath}/${CONFIG_FILE_NAME}`;
}

/**
 * 从文件加载配置
 */
export async function loadConfig(basePath: string): Promise<MxuConfig> {
  if (isTauri()) {
    // 将 HTTP 路径转换为文件系统路径
    const fsBasePath = await resolveFileSystemPath(basePath);
    const configPath = getConfigPath(fsBasePath);
    
    console.log('[configService] loadConfig - basePath:', basePath);
    console.log('[configService] loadConfig - fsBasePath:', fsBasePath);
    console.log('[configService] loadConfig - configPath:', configPath);
    
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
    
    if (await exists(configPath)) {
      try {
        const content = await readTextFile(configPath);
        const config = JSON.parse(content) as MxuConfig;
        console.log('[configService] loadConfig - 配置加载成功');
        return config;
      } catch (err) {
        console.warn('[configService] loadConfig - 读取配置文件失败，使用默认配置:', err);
        return defaultConfig;
      }
    } else {
      console.log('[configService] loadConfig - 配置文件不存在，使用默认配置');
    }
  } else {
    // 浏览器环境：尝试从 public 目录加载
    try {
      const fetchPath = basePath === '' ? `/${CONFIG_FILE_NAME}` : `${basePath}/${CONFIG_FILE_NAME}`;
      const response = await fetch(fetchPath);
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const config = await response.json() as MxuConfig;
          return config;
        }
      }
    } catch {
      // 浏览器环境加载失败是正常的，使用默认配置
    }
  }

  return defaultConfig;
}

/**
 * 保存配置到文件
 */
export async function saveConfig(basePath: string, config: MxuConfig): Promise<boolean> {
  if (!isTauri()) {
    // 浏览器环境不支持保存文件，使用 localStorage 作为后备
    try {
      localStorage.setItem('mxu-config', JSON.stringify(config));
      return true;
    } catch {
      return false;
    }
  }

  // 将 HTTP 路径转换为文件系统路径
  const fsBasePath = await resolveFileSystemPath(basePath);
  const configPath = getConfigPath(fsBasePath);
  
  console.log('[configService] basePath:', basePath);
  console.log('[configService] fsBasePath:', fsBasePath);
  console.log('[configService] configPath:', configPath);

  try {
    const { writeTextFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
    
    // 确保目录存在
    if (!await exists(fsBasePath)) {
      console.log('[configService] 创建目录:', fsBasePath);
      await mkdir(fsBasePath, { recursive: true });
    }
    
    const content = JSON.stringify(config, null, 2);
    await writeTextFile(configPath, content);
    console.log('[configService] 配置保存成功');
    return true;
  } catch (err) {
    console.error('[configService] 保存配置文件失败:', err);
    return false;
  }
}

/**
 * 浏览器环境下从 localStorage 加载配置
 */
export function loadConfigFromStorage(): MxuConfig | null {
  if (isTauri()) return null;
  
  try {
    const stored = localStorage.getItem('mxu-config');
    if (stored) {
      return JSON.parse(stored) as MxuConfig;
    }
  } catch {
    // ignore
  }
  return null;
}
