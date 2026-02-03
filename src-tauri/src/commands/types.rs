//! 类型定义
//!
//! 包含 Tauri 命令使用的数据结构和枚举

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::maa_ffi::{MaaAgentClient, MaaController, MaaResource, MaaTasker, MAA_LIBRARY};

// ============================================================================
// 数据类型定义
// ============================================================================

/// ADB 设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdbDevice {
    pub name: String,
    pub adb_path: String,
    pub address: String,
    #[serde(with = "u64_as_string")]
    pub screencap_methods: u64,
    #[serde(with = "u64_as_string")]
    pub input_methods: u64,
    pub config: String,
}

/// 将 u64 序列化/反序列化为字符串，避免 JavaScript 精度丢失
mod u64_as_string {
    use serde::{self, Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        s.parse::<u64>().map_err(serde::de::Error::custom)
    }
}

/// Win32 窗口信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Win32Window {
    pub handle: u64,
    pub class_name: String,
    pub window_name: String,
}

/// 控制器类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ControllerConfig {
    Adb {
        adb_path: String,
        address: String,
        screencap_methods: String, // u64 作为字符串传递，避免 JS 精度丢失
        input_methods: String,     // u64 作为字符串传递
        config: String,
    },
    Win32 {
        handle: u64,
        screencap_method: u64,
        mouse_method: u64,
        keyboard_method: u64,
    },
    Gamepad {
        handle: u64,
        #[serde(default)]
        gamepad_type: Option<String>,
        #[serde(default)]
        screencap_method: Option<u64>,
    },
    PlayCover {
        address: String,
    },
}

impl ControllerConfig {
    /// 生成用于控制器池索引的唯一键
    /// 相同参数的配置会生成相同的键
    pub fn pool_key(&self) -> String {
        match self {
            ControllerConfig::Adb {
                adb_path,
                address,
                screencap_methods,
                input_methods,
                config,
            } => {
                format!(
                    "adb:{}:{}:{}:{}:{}",
                    adb_path, address, screencap_methods, input_methods, config
                )
            }
            ControllerConfig::Win32 {
                handle,
                screencap_method,
                mouse_method,
                keyboard_method,
            } => {
                format!(
                    "win32:{}:{}:{}:{}",
                    handle, screencap_method, mouse_method, keyboard_method
                )
            }
            ControllerConfig::Gamepad {
                handle,
                gamepad_type,
                screencap_method,
            } => {
                format!(
                    "gamepad:{}:{}:{}",
                    handle,
                    gamepad_type.as_deref().unwrap_or("Xbox360"),
                    screencap_method.unwrap_or(0)
                )
            }
            ControllerConfig::PlayCover { address } => {
                format!("playcover:{}", address)
            }
        }
    }
}

/// 连接状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Failed(String),
}

// ============================================================================
// 控制器池
// ============================================================================

/// 池化的控制器（带引用计数）
pub struct PooledController {
    /// 控制器 C 句柄
    pub controller: *mut MaaController,
    /// 引用计数（使用原子操作保证线程安全）
    pub ref_count: AtomicUsize,
    /// 使用该控制器的实例 ID 列表
    pub instance_ids: Mutex<Vec<String>>,
}

// MaaController 指针是线程安全的
unsafe impl Send for PooledController {}
unsafe impl Sync for PooledController {}

impl PooledController {
    pub fn new(controller: *mut MaaController) -> Self {
        Self {
            controller,
            ref_count: AtomicUsize::new(1),
            instance_ids: Mutex::new(Vec::new()),
        }
    }

    /// 增加引用计数
    pub fn acquire(&self, instance_id: &str) {
        self.ref_count.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut ids) = self.instance_ids.lock() {
            if !ids.contains(&instance_id.to_string()) {
                ids.push(instance_id.to_string());
            }
        }
    }

    /// 减少引用计数，返回是否应该销毁
    pub fn release(&self, instance_id: &str) -> bool {
        if let Ok(mut ids) = self.instance_ids.lock() {
            ids.retain(|id| id != instance_id);
        }
        self.ref_count.fetch_sub(1, Ordering::SeqCst) == 1
    }

    /// 获取当前引用计数
    pub fn count(&self) -> usize {
        self.ref_count.load(Ordering::SeqCst)
    }
}

/// 控制器池
/// 用于复用相同参数的控制器，避免重复创建 C 句柄
pub struct ControllerPool {
    /// 控制器映射：pool_key -> PooledController
    controllers: Mutex<HashMap<String, PooledController>>,
    /// 反向映射：controller 指针地址 -> pool_key（用于回调时查找实例列表）
    ptr_to_key: Mutex<HashMap<usize, String>>,
}

impl Default for ControllerPool {
    fn default() -> Self {
        Self {
            controllers: Mutex::new(HashMap::new()),
            ptr_to_key: Mutex::new(HashMap::new()),
        }
    }
}

/// 全局控制器池实例
/// 用于回调时查找使用控制器的实例列表
pub static CONTROLLER_POOL: Lazy<ControllerPool> = Lazy::new(ControllerPool::default);

impl ControllerPool {
    /// 获取或创建控制器
    /// 如果池中已存在相同配置的控制器，增加引用计数并返回
    /// 否则返回 None，调用方需要创建新控制器并通过 insert 添加到池
    pub fn get(&self, key: &str, instance_id: &str) -> Option<*mut MaaController> {
        let controllers = self.controllers.lock().ok()?;
        if let Some(pooled) = controllers.get(key) {
            pooled.acquire(instance_id);
            log::info!(
                "[ControllerPool] Reusing controller for key '{}', ref_count: {}",
                key,
                pooled.count()
            );
            Some(pooled.controller)
        } else {
            None
        }
    }

    /// 向池中添加新控制器
    pub fn insert(&self, key: String, controller: *mut MaaController, instance_id: &str) {
        if let Ok(mut controllers) = self.controllers.lock() {
            let pooled = PooledController::new(controller);
            if let Ok(mut ids) = pooled.instance_ids.lock() {
                ids.push(instance_id.to_string());
            }
            log::info!(
                "[ControllerPool] Added new controller for key '{}', instance: {}",
                key,
                instance_id
            );
            controllers.insert(key.clone(), pooled);
        }
        // 添加反向映射
        if let Ok(mut ptr_to_key) = self.ptr_to_key.lock() {
            ptr_to_key.insert(controller as usize, key);
        }
    }

    /// 释放控制器引用
    /// 如果引用计数降为 0，从池中移除并返回控制器指针（调用方负责销毁）
    pub fn release(&self, key: &str, instance_id: &str) -> Option<*mut MaaController> {
        let mut controllers = self.controllers.lock().ok()?;
        let should_remove = controllers
            .get(key)
            .map(|p| p.release(instance_id))
            .unwrap_or(false);

        if should_remove {
            let pooled = controllers.remove(key)?;
            // 移除反向映射
            if let Ok(mut ptr_to_key) = self.ptr_to_key.lock() {
                ptr_to_key.remove(&(pooled.controller as usize));
            }
            log::info!(
                "[ControllerPool] Removed controller for key '{}', no more references",
                key
            );
            Some(pooled.controller)
        } else if let Some(pooled) = controllers.get(key) {
            log::info!(
                "[ControllerPool] Released controller for key '{}', remaining ref_count: {}",
                key,
                pooled.count()
            );
            None
        } else {
            None
        }
    }

    /// 根据实例 ID 查找其使用的控制器键
    pub fn find_key_by_instance(&self, instance_id: &str) -> Option<String> {
        let controllers = self.controllers.lock().ok()?;
        for (key, pooled) in controllers.iter() {
            if let Ok(ids) = pooled.instance_ids.lock() {
                if ids.contains(&instance_id.to_string()) {
                    return Some(key.clone());
                }
            }
        }
        None
    }

    /// 根据控制器指针查找使用该控制器的实例 ID 列表
    /// 用于回调时派发事件给相关实例
    pub fn find_instances_by_controller_ptr(&self, ptr: usize) -> Vec<String> {
        // 先通过指针找到 pool_key
        let key = match self.ptr_to_key.lock() {
            Ok(guard) => guard.get(&ptr).cloned(),
            Err(_) => return Vec::new(),
        };

        let key = match key {
            Some(k) => k,
            None => return Vec::new(),
        };

        // 再通过 pool_key 找到实例列表
        match self.controllers.lock() {
            Ok(controllers) => {
                if let Some(pooled) = controllers.get(&key) {
                    pooled
                        .instance_ids
                        .lock()
                        .map(|ids| ids.clone())
                        .unwrap_or_default()
                } else {
                    Vec::new()
                }
            }
            Err(_) => Vec::new(),
        }
    }
}

/// 任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
}

/// 实例运行时状态（用于前端查询）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceState {
    /// 控制器是否已连接（通过 MaaControllerConnected API 查询）
    pub connected: bool,
    /// 资源是否已加载（通过 MaaResourceLoaded API 查询）
    pub resource_loaded: bool,
    /// Tasker 是否已初始化
    pub tasker_inited: bool,
    /// 是否有任务正在运行（通过 MaaTaskerRunning API 查询）
    pub is_running: bool,
    /// 当前运行的任务 ID 列表
    pub task_ids: Vec<i64>,
}

/// 所有实例状态的快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AllInstanceStates {
    pub instances: HashMap<String, InstanceState>,
    pub cached_adb_devices: Vec<AdbDevice>,
    pub cached_win32_windows: Vec<Win32Window>,
}

/// 实例运行时状态（持有 MaaFramework 对象句柄）
pub struct InstanceRuntime {
    pub resource: Option<*mut MaaResource>,
    /// 控制器指针（仅用于快速访问，生命周期由 controller_pool 管理）
    pub controller: Option<*mut MaaController>,
    /// 控制器池键（用于从池中释放控制器引用）
    pub controller_pool_key: Option<String>,
    pub tasker: Option<*mut MaaTasker>,
    pub agent_client: Option<*mut MaaAgentClient>,
    pub agent_child: Option<Child>,
    /// 当前运行的任务 ID 列表（用于刷新后恢复状态）
    pub task_ids: Vec<i64>,
}

// 为原始指针实现 Send 和 Sync
// MaaFramework 的 API 是线程安全的
unsafe impl Send for InstanceRuntime {}
unsafe impl Sync for InstanceRuntime {}

impl Default for InstanceRuntime {
    fn default() -> Self {
        Self {
            resource: None,
            controller: None,
            controller_pool_key: None,
            tasker: None,
            agent_client: None,
            agent_child: None,
            task_ids: Vec::new(),
        }
    }
}

impl Drop for InstanceRuntime {
    fn drop(&mut self) {
        // 注意：控制器的销毁由 controller_pool 管理，不在这里处理
        // 调用方需要在销毁实例前调用 release_controller 释放控制器引用
        if let Ok(guard) = MAA_LIBRARY.lock() {
            if let Some(lib) = guard.as_ref() {
                unsafe {
                    // 断开并销毁 agent
                    if let Some(agent) = self.agent_client.take() {
                        (lib.maa_agent_client_disconnect)(agent);
                        (lib.maa_agent_client_destroy)(agent);
                    }
                    // 终止 agent 子进程
                    if let Some(mut child) = self.agent_child.take() {
                        let _ = child.kill();
                    }
                    if let Some(tasker) = self.tasker.take() {
                        (lib.maa_tasker_destroy)(tasker);
                    }
                    // controller 由池管理，这里只清空引用
                    self.controller = None;
                    self.controller_pool_key = None;
                    if let Some(resource) = self.resource.take() {
                        (lib.maa_resource_destroy)(resource);
                    }
                }
            }
        }
    }
}

/// MaaFramework 运行时状态
pub struct MaaState {
    pub lib_dir: Mutex<Option<PathBuf>>,
    pub resource_dir: Mutex<Option<PathBuf>>,
    pub instances: Mutex<HashMap<String, InstanceRuntime>>,
    /// 缓存的 ADB 设备列表（全局共享，避免重复搜索）
    pub cached_adb_devices: Mutex<Vec<AdbDevice>>,
    /// 缓存的 Win32 窗口列表（全局共享）
    pub cached_win32_windows: Mutex<Vec<Win32Window>>,
}

impl Default for MaaState {
    fn default() -> Self {
        Self {
            lib_dir: Mutex::new(None),
            resource_dir: Mutex::new(None),
            instances: Mutex::new(HashMap::new()),
            cached_adb_devices: Mutex::new(Vec::new()),
            cached_win32_windows: Mutex::new(Vec::new()),
        }
    }
}

impl MaaState {
    /// 清理所有实例的 agent 子进程
    pub fn cleanup_all_agent_children(&self) {
        if let Ok(mut instances) = self.instances.lock() {
            for (id, instance) in instances.iter_mut() {
                if let Some(mut child) = instance.agent_child.take() {
                    log::info!("Killing agent child process for instance: {}", id);
                    if let Err(e) = child.kill() {
                        log::warn!(
                            "Failed to kill agent child process for instance {}: {:?}",
                            id,
                            e
                        );
                    }
                }
            }
        }
    }
}

/// Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub child_exec: String,
    pub child_args: Option<Vec<String>>,
    pub identifier: Option<String>,
    /// 连接超时时间（毫秒），-1 表示无限等待
    pub timeout: Option<i64>,
}

/// 任务配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskConfig {
    pub entry: String,
    pub pipeline_override: String,
}

/// 版本检查结果
#[derive(Serialize)]
pub struct VersionCheckResult {
    /// 当前 MaaFramework 版本
    pub current: String,
    /// 最小支持版本
    pub minimum: String,
    /// 是否满足最小版本要求
    pub is_compatible: bool,
}

/// changes.json 结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangesJson {
    #[serde(default)]
    pub added: Vec<String>,
    #[serde(default)]
    pub deleted: Vec<String>,
    #[serde(default)]
    pub modified: Vec<String>,
}

/// 下载进度事件数据
#[derive(Clone, Serialize)]
pub struct DownloadProgressEvent {
    pub session_id: u64,
    pub downloaded_size: u64,
    pub total_size: u64,
    pub speed: u64,
    pub progress: f64,
}

/// 系统信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub tauri_version: String,
}
