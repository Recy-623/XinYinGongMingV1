use rusqlite::{params, Connection};
use serde_json::Value;
use std::{
    env, fs,
    io::Read,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const MAX_SESSION_NAME_LEN: usize = 200;
const MAX_OUTPUT_BYTES: usize = 12 * 1024 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let connection = Connection::open(directory.join("xinyingongming-companion.sqlite3"))
        .map_err(|error| error.to_string())?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS app_state (
           id INTEGER PRIMARY KEY CHECK(id=1),
           state_json TEXT NOT NULL,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE TABLE IF NOT EXISTS memory_items (
           id TEXT PRIMARY KEY,
           character_id TEXT NOT NULL,
           payload_json TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'active',
           mention_policy TEXT NOT NULL DEFAULT 'relevant',
           importance REAL NOT NULL DEFAULT 0.5,
           last_used_at TEXT NOT NULL DEFAULT '',
           use_count INTEGER NOT NULL DEFAULT 0,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_companion_memory_character
           ON memory_items(character_id, status, importance DESC);"
    ).map_err(|error| error.to_string())?;
    Ok(connection)
}

#[tauri::command]
fn db_load_state(app: AppHandle) -> Result<Option<String>, String> {
    match database(&app)?.query_row("SELECT state_json FROM app_state WHERE id=1", [], |row| row.get(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn db_save_state(app: AppHandle, state_json: String) -> Result<(), String> {
    serde_json::from_str::<Value>(&state_json).map_err(|error| error.to_string())?;
    database(&app)?.execute(
        "INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?1,CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, updated_at=CURRENT_TIMESTAMP",
        params![state_json],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_upsert_memories(app: AppHandle, items: Vec<Value>) -> Result<(), String> {
    let mut connection = database(&app)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    for item in items {
        let id = item.get("id").and_then(Value::as_str).unwrap_or("").trim();
        let character_id = item.get("characterId").and_then(Value::as_str).unwrap_or("").trim();
        if id.is_empty() || character_id.is_empty() { continue; }
        let status = item.get("status").and_then(Value::as_str).unwrap_or("active");
        let mention_policy = item.get("mentionPolicy").and_then(Value::as_str).unwrap_or("relevant");
        let importance = item.get("importance").and_then(Value::as_f64).unwrap_or(0.5);
        let payload = serde_json::to_string(&item).map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT INTO memory_items(id,character_id,payload_json,status,mention_policy,importance)
             VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,
               status=excluded.status, mention_policy=excluded.mention_policy,
               importance=excluded.importance, updated_at=CURRENT_TIMESTAMP",
            params![id, character_id, payload, status, mention_policy, importance],
        ).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
fn db_list_memories(app: AppHandle, character_id: String, limit: u16) -> Result<Vec<Value>, String> {
    let connection = database(&app)?;
    let mut statement = connection.prepare(
        "SELECT payload_json,last_used_at,use_count FROM memory_items
         WHERE character_id=?1 ORDER BY importance DESC, updated_at DESC LIMIT ?2"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![character_id, limit.min(1000)], |row| {
        let payload: String = row.get(0)?;
        let last_used_at: String = row.get(1)?;
        let use_count: i64 = row.get(2)?;
        let mut value: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
        if let Some(object) = value.as_object_mut() {
            object.insert("lastUsedAt".into(), Value::String(last_used_at));
            object.insert("useCount".into(), Value::Number(use_count.into()));
        }
        Ok(value)
    }).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn db_mark_memories_used(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let mut connection = database(&app)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    for id in ids {
        transaction.execute(
            "UPDATE memory_items SET last_used_at=CURRENT_TIMESTAMP,use_count=use_count+1 WHERE id=?1",
            params![id],
        ).map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
fn db_update_memory_lifecycle(app: AppHandle, id: String, status: String, mention_policy: String) -> Result<(), String> {
    database(&app)?.execute(
        "UPDATE memory_items SET status=?2,mention_policy=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1",
        params![id, status, mention_policy],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_delete_memory(app: AppHandle, id: String) -> Result<(), String> {
    database(&app)?.execute("DELETE FROM memory_items WHERE id=?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_clear_memories(app: AppHandle, character_id: String) -> Result<(), String> {
    database(&app)?.execute("DELETE FROM memory_items WHERE character_id=?1", params![character_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_delete_character_data(app: AppHandle, character_id: String) -> Result<(), String> {
    db_clear_memories(app, character_id)
}

fn safe_executable(path: &Path) -> Option<PathBuf> {
    let canonical = fs::canonicalize(path).ok()?;
    let display = canonical.to_string_lossy();
    let is_unc = display.starts_with(r"\\?\UNC\")
        || (display.starts_with(r"\\") && !display.starts_with(r"\\?\"));
    if is_unc
        || canonical
            .extension()?
            .to_string_lossy()
            .to_ascii_lowercase()
            != "exe"
    {
        return None;
    }
    let metadata = fs::metadata(&canonical).ok()?;
    if !metadata.is_file() || metadata.len() < 32 * 1024 || metadata.len() > 100 * 1024 * 1024 {
        return None;
    }
    Some(canonical)
}

fn find_wx_cli() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current) = env::current_exe() {
        if let Some(directory) = current.parent() {
            candidates.push(directory.join("connectors").join("wx.exe"));
            candidates.push(directory.join("connectors").join("wx-windows-x86_64.exe"));
        }
    }
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            candidates.push(directory.join("wx.exe"));
            candidates.push(directory.join("wx-windows-x86_64.exe"));
        }
    }
    candidates
        .into_iter()
        .find_map(|candidate| safe_executable(&candidate))
}

fn wx_data_directory() -> Result<PathBuf, String> {
    let profile =
        env::var_os("USERPROFILE").ok_or_else(|| "无法定位当前 Windows 用户目录。".to_string())?;
    let directory = PathBuf::from(profile).join(".wx-cli");
    if !directory.is_dir() {
        return Err("未找到 wx-cli 数据目录。请由用户先在自己的终端完成 wx init。".to_string());
    }
    Ok(directory)
}

fn read_capped<R: Read>(mut reader: R) -> (Vec<u8>, bool) {
    let mut stored = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut exceeded = false;
    while let Ok(count) = reader.read(&mut buffer) {
        if count == 0 {
            break;
        }
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(stored.len());
        if remaining > 0 {
            stored.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        if count > remaining {
            exceeded = true;
        }
    }
    (stored, exceeded)
}

fn run_wx(arguments: &[String], timeout: Duration) -> Result<Value, String> {
    let executable = find_wx_cli().ok_or_else(|| "未检测到受支持的 wx-cli Windows 可执行文件。请把官方 Release 的 wx.exe 放入程序旁的 connectors 文件夹，或加入 PATH；不会执行 .cmd/.bat 脚本。".to_string())?;
    let data_directory = wx_data_directory()?;
    let mut command = Command::new(executable);
    command
        .current_dir(data_directory)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动 wx-cli。心印共鸣不会尝试提权或绕过系统权限。".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 wx-cli 输出。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 wx-cli 错误信息。".to_string())?;
    let stdout_reader = thread::spawn(move || read_capped(stdout));
    let stderr_reader = thread::spawn(move || read_capped(stderr));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "无法获取 wx-cli 运行状态。".to_string())?
        {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("wx-cli 查询超时，进程已终止。请缩小消息范围后重试。".to_string());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let (stdout, stdout_exceeded) = stdout_reader
        .join()
        .map_err(|_| "读取 wx-cli 输出失败。".to_string())?;
    let (stderr, _) = stderr_reader
        .join()
        .map_err(|_| "读取 wx-cli 错误信息失败。".to_string())?;
    if stdout_exceeded {
        return Err("wx-cli 返回的数据超过 12MB 安全上限，请缩小日期范围或消息数量。".to_string());
    }
    if !status.success() {
        let message = String::from_utf8_lossy(&stderr)
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
        return Err(if message.is_empty() {
            "wx-cli 查询失败。请确认微信已登录且 wx-cli 已由用户完成初始化。".to_string()
        } else {
            format!("wx-cli 查询失败：{message}")
        });
    }
    serde_json::from_slice(&stdout)
        .map_err(|_| "wx-cli 没有返回合法 JSON；为避免处理不可信输出，本次结果已拒绝。".to_string())
}

#[tauri::command]
fn detect_wx_cli() -> Result<String, String> {
    find_wx_cli()
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| {
            "未检测到 wx-cli。请使用官方 Release 的 Windows EXE，并自行完成 wx init。".to_string()
        })
}

#[tauri::command]
fn detect_qq_exporter() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 40653));
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

#[tauri::command]
fn wx_sessions() -> Result<Value, String> {
    run_wx(
        &["sessions".to_string(), "--json".to_string()],
        Duration::from_secs(20),
    )
}

#[tauri::command]
fn wx_history(
    session: String,
    since: Option<String>,
    until: Option<String>,
    limit: u16,
) -> Result<Value, String> {
    let session = session.trim().to_string();
    if session.is_empty()
        || session.len() > MAX_SESSION_NAME_LEN
        || session.chars().any(|character| character.is_control())
    {
        return Err("会话名称无效。".to_string());
    }
    if !(1..=1600).contains(&limit) {
        return Err("消息数量必须在 1 到 1600 之间。".to_string());
    }
    let valid_date = |value: &str| {
        value.len() == 10
            && value
                .chars()
                .enumerate()
                .all(|(index, character)| match index {
                    4 | 7 => character == '-',
                    _ => character.is_ascii_digit(),
                })
    };
    if since.as_deref().is_some_and(|value| !valid_date(value))
        || until.as_deref().is_some_and(|value| !valid_date(value))
    {
        return Err("日期必须为 YYYY-MM-DD。".to_string());
    }
    if since
        .as_deref()
        .zip(until.as_deref())
        .is_some_and(|(start, end)| start > end)
    {
        return Err("开始日期不能晚于结束日期。".to_string());
    }
    let mut arguments = vec![
        "history".to_string(),
        session,
        "--json".to_string(),
        "-n".to_string(),
        limit.to_string(),
    ];
    if let Some(value) = since {
        arguments.push("--since".to_string());
        arguments.push(value);
    }
    if let Some(value) = until {
        arguments.push("--until".to_string());
        arguments.push(value);
    }
    run_wx(&arguments, Duration::from_secs(60))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_wx_cli,
            detect_qq_exporter,
            wx_sessions,
            wx_history,
            db_load_state,
            db_save_state,
            db_upsert_memories,
            db_list_memories,
            db_mark_memories_used,
            db_update_memory_lifecycle,
            db_delete_memory,
            db_clear_memories,
            db_delete_character_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
