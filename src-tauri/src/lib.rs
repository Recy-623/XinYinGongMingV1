use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;
use tokio::sync::oneshot;
use zeroize::Zeroize;

const MAX_API_KEY_BYTES: usize = 4096;
const MAX_BASE_URL_BYTES: usize = 500;
const MAX_MODEL_BYTES: usize = 200;
const MAX_MESSAGE_BYTES: usize = 512_000;
const MAX_TOTAL_MESSAGE_BYTES: usize = 2_000_000;
const REQUEST_TIMEOUT_SECS: u64 = 120;
const VAULT_AAD: &[u8] = b"xinyingongming-api-vault-v1";

#[derive(Default)]
struct RequestRegistry(Mutex<HashMap<String, oneshot::Sender<()>>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiConfig {
    mode: String,
    base_url: String,
    api_key: String,
    model: String,
}

impl Drop for ApiConfig {
    fn drop(&mut self) {
        self.api_key.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ApiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiReply {
    text: String,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize)]
struct VaultFile {
    version: u8,
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn clean_error(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || *character == '\n')
        .take(500)
        .collect::<String>()
        .trim()
        .to_string()
}

fn validate_config(config: &ApiConfig) -> Result<(Url, String), String> {
    if !matches!(config.mode.as_str(), "openai-responses" | "compatible-chat") {
        return Err("不支持的 API 模式。".to_string());
    }
    if config.api_key.is_empty() || config.api_key.len() > MAX_API_KEY_BYTES {
        return Err("API Key 为空或长度异常。".to_string());
    }
    if config.model.is_empty()
        || config.model.len() > MAX_MODEL_BYTES
        || config.model.chars().any(char::is_control)
    {
        return Err("模型 ID 为空或格式异常。".to_string());
    }
    if config.base_url.is_empty() || config.base_url.len() > MAX_BASE_URL_BYTES {
        return Err("API 地址为空或过长。".to_string());
    }
    let mut base =
        Url::parse(config.base_url.trim()).map_err(|_| "API 地址格式无效。".to_string())?;
    if base.scheme() != "https" || base.host_str().is_none() {
        return Err("移动版只允许 HTTPS API 地址。".to_string());
    }
    if !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("API 地址不能包含账号、密码、查询参数或片段。".to_string());
    }
    let normalized_path = base.path().trim_end_matches('/').to_string();
    base.set_path(if normalized_path.is_empty() {
        "/"
    } else {
        &normalized_path
    });
    Ok((base, config.model.trim().to_string()))
}

fn endpoint(base: &Url, suffix: &str) -> Result<Url, String> {
    let path = format!(
        "{}/{}",
        base.path().trim_end_matches('/'),
        suffix.trim_start_matches('/')
    );
    let mut url = base.clone();
    url.set_path(&path);
    Ok(url)
}

fn validate_messages(messages: Vec<ApiMessage>) -> Result<Vec<ApiMessage>, String> {
    if messages.is_empty() || messages.len() > 64 {
        return Err("消息数量为空或超过 64 条安全上限。".to_string());
    }
    let mut total = 0usize;
    for message in &messages {
        if !matches!(
            message.role.as_str(),
            "system" | "developer" | "user" | "assistant"
        ) {
            return Err("消息角色无效。".to_string());
        }
        if message.content.is_empty() || message.content.len() > MAX_MESSAGE_BYTES {
            return Err("单条消息为空或过长。".to_string());
        }
        total = total.saturating_add(message.content.len());
    }
    if total > MAX_TOTAL_MESSAGE_BYTES {
        return Err("本次发送内容超过 2MB 安全上限，请缩短聊天上下文。".to_string());
    }
    Ok(messages)
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(Policy::none())
        .user_agent("XinYinGongMing-Android/4.9.2")
        .build()
        .map_err(|_| "无法初始化安全网络客户端。".to_string())
}

async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "无法读取 API 响应。".to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("API 响应超过 8MB 安全上限。".to_string());
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("API 返回了非 JSON 内容（HTTP {status}）。"))?;
    if !status.is_success() {
        let remote = value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .or_else(|| value.get("message").and_then(Value::as_str))
            .map(clean_error)
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| "服务未提供错误详情。".to_string());
        return Err(format!("API 请求失败（HTTP {status}）：{remote}"));
    }
    Ok(value)
}

fn extract_responses_text(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    for item in value.get("output")?.as_array()? {
        for content in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if matches!(
                content.get("type").and_then(Value::as_str),
                Some("output_text") | Some("text")
            ) {
                if let Some(text) = content.get("text").and_then(Value::as_str) {
                    if !text.trim().is_empty() {
                        parts.push(text.trim());
                    }
                }
            }
        }
    }
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn extract_chat_text(value: &Value) -> Option<String> {
    let content = value.pointer("/choices/0/message/content")?;
    if let Some(text) = content.as_str() {
        return (!text.trim().is_empty()).then(|| text.trim().to_string());
    }
    let parts = content
        .as_array()?
        .iter()
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
        })
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn usage(value: &Value, responses: bool) -> (Option<u64>, Option<u64>) {
    if responses {
        (
            value.pointer("/usage/input_tokens").and_then(Value::as_u64),
            value
                .pointer("/usage/output_tokens")
                .and_then(Value::as_u64),
        )
    } else {
        (
            value
                .pointer("/usage/prompt_tokens")
                .and_then(Value::as_u64),
            value
                .pointer("/usage/completion_tokens")
                .and_then(Value::as_u64),
        )
    }
}

fn validate_vault_password(password: &str) -> Result<(), String> {
    if !(8..=128).contains(&password.chars().count()) {
        return Err("保险箱口令必须为 8 到 128 个字符。".to_string());
    }
    Ok(())
}

fn derive_vault_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "无法派生保险箱密钥。".to_string())?;
    Ok(key)
}

fn write_vault(path: &Path, mut password: String, mut api_key: String) -> Result<(), String> {
    validate_vault_password(&password)?;
    if api_key.is_empty() || api_key.len() > MAX_API_KEY_BYTES {
        return Err("API Key 为空或长度异常。".to_string());
    }
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);
    let mut key = derive_vault_key(&password, &salt)?;
    password.zeroize();
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "无法初始化保险箱加密器。".to_string())?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: api_key.as_bytes(),
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| "API Key 加密失败。".to_string())?;
    key.zeroize();
    api_key.zeroize();
    let payload = VaultFile {
        version: 1,
        salt: STANDARD_NO_PAD.encode(salt),
        nonce: STANDARD_NO_PAD.encode(nonce_bytes),
        ciphertext: STANDARD_NO_PAD.encode(ciphertext),
    };
    let encoded = serde_json::to_vec(&payload).map_err(|_| "无法编码保险箱。".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "保险箱路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "无法创建应用私有数据目录。".to_string())?;
    let temp = path.with_extension("tmp");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp)
        .map_err(|_| "无法创建保险箱临时文件。".to_string())?;
    file.write_all(&encoded)
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法写入保险箱。".to_string())?;
    drop(file);
    // Android/Linux rename replaces an existing file atomically. Windows is
    // retained for desktop development and requires removing the old target.
    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::remove_file(path).map_err(|_| "无法替换旧保险箱。".to_string())?;
    }
    fs::rename(&temp, path).map_err(|_| "无法提交保险箱文件。".to_string())?;
    Ok(())
}

fn read_vault(path: &Path, mut password: String) -> Result<String, String> {
    validate_vault_password(&password)?;
    let bytes = fs::read(path).map_err(|_| "保险箱不存在；请先保存 API Key。".to_string())?;
    if bytes.len() > 32 * 1024 {
        return Err("保险箱文件大小异常。".to_string());
    }
    let payload: VaultFile =
        serde_json::from_slice(&bytes).map_err(|_| "保险箱文件已损坏。".to_string())?;
    if payload.version != 1 {
        return Err("不支持的保险箱版本。".to_string());
    }
    let salt = STANDARD_NO_PAD
        .decode(payload.salt)
        .map_err(|_| "保险箱盐值无效。".to_string())?;
    let nonce = STANDARD_NO_PAD
        .decode(payload.nonce)
        .map_err(|_| "保险箱随机数无效。".to_string())?;
    let ciphertext = STANDARD_NO_PAD
        .decode(payload.ciphertext)
        .map_err(|_| "保险箱密文无效。".to_string())?;
    if salt.len() != 16 || nonce.len() != 12 || ciphertext.len() > MAX_API_KEY_BYTES + 32 {
        return Err("保险箱字段长度异常。".to_string());
    }
    let mut key = derive_vault_key(&password, &salt)?;
    password.zeroize();
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "无法初始化保险箱解密器。".to_string())?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| "保险箱口令错误或文件已被修改。".to_string())?;
    key.zeroize();
    let value = String::from_utf8(plaintext).map_err(|_| "保险箱内容无效。".to_string())?;
    if value.is_empty() || value.len() > MAX_API_KEY_BYTES {
        return Err("保险箱内的 API Key 无效。".to_string());
    }
    Ok(value)
}

fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("api-key.vault"))
        .map_err(|_| "无法定位应用私有数据目录。".to_string())
}

#[tauri::command]
async fn vault_save(
    app: tauri::AppHandle,
    password: String,
    api_key: String,
) -> Result<(), String> {
    let path = vault_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_vault(&path, password, api_key))
        .await
        .map_err(|_| "保险箱任务异常终止。".to_string())?
}

#[tauri::command]
async fn vault_load(app: tauri::AppHandle, password: String) -> Result<String, String> {
    let path = vault_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_vault(&path, password))
        .await
        .map_err(|_| "保险箱任务异常终止。".to_string())?
}

#[tauri::command]
async fn vault_remove(app: tauri::AppHandle, password: String) -> Result<(), String> {
    let path = vault_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Verify the password before deleting so an unlocked device cannot erase
        // the secret without knowing the vault password.
        read_vault(&path, password).map(|mut secret| secret.zeroize())?;
        fs::remove_file(path).map_err(|_| "无法删除保险箱。".to_string())
    })
    .await
    .map_err(|_| "保险箱任务异常终止。".to_string())?
}

async fn send_generation(config: ApiConfig, messages: Vec<ApiMessage>) -> Result<ApiReply, String> {
    let (base, model) = validate_config(&config)?;
    let messages = validate_messages(messages)?;
    let responses = config.mode == "openai-responses";
    let url = endpoint(
        &base,
        if responses {
            "responses"
        } else {
            "chat/completions"
        },
    )?;
    let body = if responses {
        json!({ "model": model, "input": messages, "store": false })
    } else {
        json!({ "model": model, "messages": messages, "stream": false })
    };
    let value = response_json(
        http_client()?
            .post(url)
            .bearer_auth(&config.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "API 请求超时（120 秒）。".to_string()
                } else {
                    "无法连接 API，请检查网络与地址。".to_string()
                }
            })?,
    )
    .await?;
    let text = if responses {
        extract_responses_text(&value)
    } else {
        extract_chat_text(&value)
    }
    .ok_or_else(|| "API 没有返回可用文本。".to_string())?;
    let (input_tokens, output_tokens) = usage(&value, responses);
    Ok(ApiReply {
        text,
        input_tokens,
        output_tokens,
    })
}

#[tauri::command]
async fn api_list_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let config = ApiConfig {
        mode: "compatible-chat".into(),
        base_url,
        api_key,
        model: "model-list".into(),
    };
    let (base, _) = validate_config(&config)?;
    let value = response_json(
        http_client()?
            .get(endpoint(&base, "models")?)
            .bearer_auth(&config.api_key)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "模型列表请求超时。".to_string()
                } else {
                    "无法连接模型列表接口。".to_string()
                }
            })?,
    )
    .await?;
    let mut models = value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter(|id| {
            !id.is_empty() && id.len() <= MAX_MODEL_BYTES && !id.chars().any(char::is_control)
        })
        .map(str::to_string)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    models.truncate(500);
    Ok(models)
}

#[tauri::command]
async fn api_generate(
    registry: tauri::State<'_, RequestRegistry>,
    request_id: String,
    config: ApiConfig,
    messages: Vec<ApiMessage>,
) -> Result<ApiReply, String> {
    if request_id.is_empty() || request_id.len() > 100 || request_id.chars().any(char::is_control) {
        return Err("请求 ID 无效。".to_string());
    }
    let (sender, receiver) = oneshot::channel();
    {
        let mut requests = registry
            .0
            .lock()
            .map_err(|_| "请求管理器不可用。".to_string())?;
        if requests.len() >= 8 {
            return Err("并发请求过多，请等待当前请求完成。".to_string());
        }
        requests.insert(request_id.clone(), sender);
    }
    let result = tokio::select! {
        result = send_generation(config, messages) => result,
        _ = receiver => Err("请求已取消。".to_string()),
    };
    if let Ok(mut requests) = registry.0.lock() {
        requests.remove(&request_id);
    }
    result
}

#[tauri::command]
fn api_cancel_request(registry: tauri::State<'_, RequestRegistry>, request_id: String) -> bool {
    registry
        .0
        .lock()
        .ok()
        .and_then(|mut requests| requests.remove(&request_id))
        .map(|sender| sender.send(()).is_ok())
        .unwrap_or(false)
}

#[tauri::command]
async fn api_test(config: ApiConfig) -> Result<ApiReply, String> {
    send_generation(
        config,
        vec![ApiMessage {
            role: "user".into(),
            content: "只回复 OK".into(),
        }],
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RequestRegistry::default())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            api_list_models,
            api_generate,
            api_cancel_request,
            api_test,
            vault_save,
            vault_load,
            vault_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(base_url: &str) -> ApiConfig {
        ApiConfig {
            mode: "openai-responses".into(),
            base_url: base_url.into(),
            api_key: "test-secret".into(),
            model: "test-model".into(),
        }
    }

    #[test]
    fn accepts_only_safe_https_api_roots() {
        let (base, model) = validate_config(&config("https://api.example.com/v1/")).unwrap();
        assert_eq!(base.as_str(), "https://api.example.com/v1");
        assert_eq!(model, "test-model");
        assert!(validate_config(&config("http://api.example.com/v1")).is_err());
        assert!(validate_config(&config("https://user:pass@api.example.com/v1")).is_err());
        assert!(validate_config(&config("https://api.example.com/v1?redirect=evil")).is_err());
    }

    #[test]
    fn encrypted_vault_round_trips_and_detects_tampering() {
        let directory =
            std::env::temp_dir().join(format!("xinyin-vault-test-{}", rand::random::<u64>()));
        let path = directory.join("api-key.vault");
        write_vault(
            &path,
            "correct horse battery staple".into(),
            "sk-private-test".into(),
        )
        .unwrap();
        assert_eq!(
            read_vault(&path, "correct horse battery staple".into()).unwrap(),
            "sk-private-test"
        );
        assert!(read_vault(&path, "wrong password".into()).is_err());

        let mut payload: VaultFile = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        payload.ciphertext.push('A');
        fs::write(&path, serde_json::to_vec(&payload).unwrap()).unwrap();
        assert!(read_vault(&path, "correct horse battery staple".into()).is_err());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    #[test]
    fn extracts_both_supported_response_shapes() {
        let responses =
            json!({ "output": [{ "content": [{ "type": "output_text", "text": "hello" }] }] });
        let chat = json!({ "choices": [{ "message": { "content": [{ "text": "world" }] } }] });
        assert_eq!(extract_responses_text(&responses).as_deref(), Some("hello"));
        assert_eq!(extract_chat_text(&chat).as_deref(), Some("world"));
    }

    #[test]
    fn accepts_a_fifty_thousand_character_system_prompt() {
        let content = "人".repeat(50_000);
        let messages = vec![ApiMessage {
            role: "system".into(),
            content,
        }];
        assert!(validate_messages(messages).is_ok());
    }
}
