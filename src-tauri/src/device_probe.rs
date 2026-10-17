//! Read-only BLE discovery. Deliberately contains no write/subscribe/control API.
use serde_json::{json, Value};

#[cfg(windows)]
mod windows {
    use super::*;
    use btleplug::{api::{Central, Manager as _, Peripheral as _, ScanFilter}, platform::{Manager, Peripheral}};
    use std::{collections::HashMap, time::Duration};
    use tokio::{sync::Mutex, time::{sleep, timeout}};

    #[derive(Default)]
    pub struct ProbeState { devices: Mutex<HashMap<String, Peripheral>> }

    pub async fn scan(state: &ProbeState) -> Result<Value, String> {
        let mut devices = state.devices.try_lock().map_err(|_| "检测正在进行，请稍候")?;
        devices.clear();
        let manager = timeout(Duration::from_secs(10), Manager::new()).await
            .map_err(|_| "蓝牙初始化超时")?.map_err(|e| e.to_string())?;
        let adapters = timeout(Duration::from_secs(10), manager.adapters()).await
            .map_err(|_| "读取蓝牙适配器超时")?.map_err(|e| e.to_string())?;
        if adapters.is_empty() { return Err("未发现蓝牙适配器，请检查 Windows 蓝牙设置。".into()); }
        let mut rows = Vec::new();
        for (index, adapter) in adapters.into_iter().enumerate() {
            let result = timeout(Duration::from_secs(15), async {
                adapter.start_scan(ScanFilter::default()).await.map_err(|e| e.to_string())?;
                sleep(Duration::from_secs(8)).await;
                for device in adapter.peripherals().await.map_err(|e| e.to_string())? {
                    if let Some(props) = device.properties().await.map_err(|e| e.to_string())? {
                        let id = format!("{index}:{}", device.id());
                        let name = props.local_name.unwrap_or_else(|| "未命名设备".into());
                        let candidate = name.to_ascii_uppercase().contains("SOSEXY") || name.to_ascii_uppercase().contains("FUN001");
                        rows.push(json!({"id":id,"name":name,"candidate":candidate,"rssi":props.rssi}));
                        devices.insert(id, device);
                    }
                }
                Ok::<(), String>(())
            }).await;
            // Always attempt cleanup, including scan startup or enumeration failure.
            let stopped = timeout(Duration::from_secs(5), adapter.stop_scan()).await;
            result.map_err(|_| "扫描超时，请检查蓝牙是否开启")??;
            stopped.map_err(|_| "停止扫描超时，请检查 Windows 蓝牙状态")?.map_err(|e| e.to_string())?;
        }
        rows.sort_by_key(|v| !v["candidate"].as_bool().unwrap_or(false));
        Ok(json!({"devices":rows}))
    }

    pub async fn inspect(state: &ProbeState, id: String) -> Result<Value, String> {
        let devices = state.devices.try_lock().map_err(|_| "检测正在进行，请稍候")?;
        let device = devices.get(&id).ok_or("设备不在本次扫描中，请重新扫描")?;
        let connected = timeout(Duration::from_secs(5), device.is_connected()).await
            .map_err(|_| "读取连接状态超时")?.map_err(|e| e.to_string())?;
        if connected { return Err("设备已有连接，请先断开其他连接后重新检测。".into()); }
        let result = timeout(Duration::from_secs(20), async {
            device.connect().await.map_err(|e| format!("连接失败：{e}。请先断开手机官方 App。"))?;
            device.discover_services().await.map_err(|e| e.to_string())?;
            let services: Vec<Value> = device.services().iter().map(|s| json!({
                "uuid":s.uuid.to_string(),
                "characteristics":s.characteristics.iter().map(|c| json!({
                    "uuid":c.uuid.to_string(), "properties":format!("{:?}",c.properties)
                })).collect::<Vec<_>>()
            })).collect();
            Ok::<Value, String>(json!({"services":services,"readOnly":true}))
        }).await;
        // Disconnect even after failed/expired discovery. Never send a motor command.
        let disconnected = timeout(Duration::from_secs(5), device.disconnect()).await;
        let report = result.map_err(|_| "服务读取超时；已尝试断开连接")??;
        disconnected.map_err(|_| "断开连接超时，请在 Windows 蓝牙设置中检查连接")?
            .map_err(|e| format!("服务已读取，但断开失败：{e}"))?;
        Ok(report)
    }
}

#[cfg(windows)]
pub use windows::ProbeState;
#[cfg(not(windows))]
#[derive(Default)]
pub struct ProbeState;

#[tauri::command]
pub async fn device_scan(state: tauri::State<'_, ProbeState>) -> Result<Value, String> {
    #[cfg(windows)] { windows::scan(&state).await }
    #[cfg(not(windows))] { let _ = state; Err("当前检测入口仅支持 Windows 电脑。".into()) }
}

#[tauri::command]
pub async fn device_inspect(state: tauri::State<'_, ProbeState>, id: String) -> Result<Value, String> {
    #[cfg(windows)] { windows::inspect(&state, id).await }
    #[cfg(not(windows))] { let _ = (state, id); Err("当前检测入口仅支持 Windows 电脑。".into()) }
}
