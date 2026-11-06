use tauri::{AppHandle, Manager};
#[cfg(windows)]
fn crypt(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    #[repr(C)] struct Blob { len: u32, data: *mut u8 }
    #[link(name="crypt32")]
    extern "system" {
        fn CryptProtectData(a:*const Blob,b:*const u16,c:*const Blob,d:*mut std::ffi::c_void,e:*mut std::ffi::c_void,f:u32,g:*mut Blob)->i32;
        fn CryptUnprotectData(a:*const Blob,b:*mut *mut u16,c:*const Blob,d:*mut std::ffi::c_void,e:*mut std::ffi::c_void,f:u32,g:*mut Blob)->i32;
    }
    #[link(name="kernel32")]
    extern "system" { fn LocalFree(p:*mut std::ffi::c_void)->*mut std::ffi::c_void; }
    let input=Blob {len:bytes.len() as u32,data:bytes.as_ptr() as *mut u8};
    let mut output=Blob {len:0,data:std::ptr::null_mut()};
    unsafe {
        let ok=if decrypt {CryptUnprotectData(&input,std::ptr::null_mut(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null_mut(),1,&mut output)} else {CryptProtectData(&input,std::ptr::null(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null_mut(),1,&mut output)};
        if ok==0 { return Err("Windows 本机密钥保护失败".into()); }
        let result=std::slice::from_raw_parts(output.data,output.len as usize).to_vec();
        LocalFree(output.data.cast()); Ok(result)
    }
}
#[cfg(not(windows))]
fn crypt(_: &[u8], _: bool)->Result<Vec<u8>,String>{Err("本机密钥保存目前仅支持 Windows".into())}
fn path(app:&AppHandle)->Result<std::path::PathBuf,String>{
    let dir=app.path().app_data_dir().map_err(|_|"无法访问应用数据目录")?;
    std::fs::create_dir_all(&dir).map_err(|_|"无法创建密钥目录")?;
    Ok(dir.join("api-key.dpapi"))
}
#[tauri::command]
pub fn vault_save(app:AppHandle, base_url:String, api_key:String)->Result<(),String>{
    if api_key.trim().is_empty() || api_key.len()>16384 || base_url.len()>2000 {return Err("密钥或地址无效".into());}
    let data=serde_json::to_vec(&serde_json::json!({"baseUrl":base_url,"apiKey":api_key})).map_err(|_|"无法保存密钥")?;
    std::fs::write(path(&app)?,crypt(&data,false)?).map_err(|_|"无法写入加密密钥".into())
}
#[tauri::command]
pub fn vault_load(app:AppHandle, base_url:String)->Result<Option<String>,String>{
    let p=path(&app)?; if !p.exists(){return Ok(None);}
    let data=std::fs::read(p).map_err(|_|"无法读取本机密钥")?;
    let value:serde_json::Value=serde_json::from_slice(&crypt(&data,true)?).map_err(|_|"本机密钥文件损坏")?;
    if value["baseUrl"].as_str()!=Some(base_url.as_str()){return Ok(None);}
    Ok(value["apiKey"].as_str().map(String::from))
}
#[tauri::command]
pub fn vault_delete(app:AppHandle)->Result<(),String>{
    let p=path(&app)?; if p.exists(){std::fs::remove_file(p).map_err(|_|"无法删除本机密钥")?;} Ok(())
}
#[cfg(all(test,windows))]
mod tests {
    #[test] fn dpapi_roundtrip(){let raw=b"synthetic-key-test";let encrypted=super::crypt(raw,false).unwrap();assert_ne!(encrypted,raw);assert_eq!(super::crypt(&encrypted,true).unwrap(),raw);assert!(super::crypt(b"invalid",true).is_err());}
}
