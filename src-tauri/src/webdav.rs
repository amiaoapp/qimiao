//! WebDAV transport. Credentials never enter JSON backups or localStorage.
use reqwest::{
    blocking::{Client, Response},
    header, Method, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Read, sync::Mutex, time::Duration};

const JSON_LIMIT: u64 = 24 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DavConfig {
    pub url: String,
    pub username: String,
    #[serde(default)]
    pub allow_insecure: bool,
}
#[derive(Clone)]
struct Auth {
    key: String,
    password: String,
}
#[derive(Default)]
pub struct DavRuntime(Mutex<Option<Auth>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFile {
    pub data: String,
    pub etag: Option<String>,
    pub modified: Option<String>,
}

fn endpoint(config: &DavConfig) -> Result<Url, String> {
    let mut url = Url::parse(config.url.trim()).map_err(|_| "WebDAV 地址格式不正确".to_string())?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("请填写 http(s) 文件夹地址，不要在地址内填写密码、参数或片段".into());
    }
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !local && !config.allow_insecure {
        return Err("请使用 HTTPS；如确需 HTTP，请明确开启不安全 HTTP 选项".into());
    }
    if !url.path().ends_with('/') {
        url.set_path(&format!("{}/", url.path()));
    }
    Ok(url)
}
fn credential_key(config: &DavConfig) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(format!("{}\n{}", endpoint(config)?, config.username).as_bytes())
    ))
}
fn credential(config: &DavConfig) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.appmiao.miaoqi.webdav", &credential_key(config)?)
        .map_err(|_| "系统密钥库不可用".into())
}
fn password_for(config: &DavConfig, state: &DavRuntime) -> Result<String, String> {
    let key = credential_key(config)?;
    if let Some(auth) = state
        .0
        .lock()
        .map_err(|_| "同步状态不可用")?
        .as_ref()
        .filter(|auth| auth.key == key)
    {
        return Ok(auth.password.clone());
    }
    credential(config)?
        .get_password()
        .map_err(|_| "请先连接 WebDAV；未在系统密钥库中找到该服务的密码".into())
}
fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(35))
        .user_agent("qimiao-webdav/1")
        .build()
        .map_err(|_| "无法初始化安全网络连接".into())
}
fn status_error(status: StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => "WebDAV 拒绝访问，请检查账号、密码和文件夹权限".into(),
        409 => "WebDAV 上级文件夹不存在，请填写已存在的文件夹地址".into(),
        412 => "远端已被另一台设备修改。本次没有覆盖，请重新同步".into(),
        300..=399 => "WebDAV 返回重定向。为保护密码未跟随跳转，请填写最终地址".into(),
        _ => format!("WebDAV 请求失败（HTTP {}）", status.as_u16()),
    }
}
fn send(request: reqwest::blocking::RequestBuilder) -> Result<Response, String> {
    request.send().map_err(|error| {
        if error.is_timeout() {
            "WebDAV 连接超时".into()
        } else {
            "无法连接 WebDAV，请检查网络、地址和 TLS 证书".into()
        }
    })
}
fn object_url(config: &DavConfig, name: &str) -> Result<Url, String> {
    if name != "configuration.json"
        && name != "clipboard.json"
        && !(name.starts_with("images/")
            && name.ends_with(".png")
            && name.len() == 75
            && name[7..71].bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("不允许的同步对象".into());
    }
    endpoint(config)?
        .join("qimiao/")
        .and_then(|url| url.join(name))
        .map_err(|_| "同步地址无效".into())
}
fn ensure_folder(
    client: &Client,
    config: &DavConfig,
    password: &str,
    images: bool,
) -> Result<(), String> {
    for path in if images {
        vec!["qimiao/", "qimiao/images/"]
    } else {
        vec!["qimiao/"]
    } {
        let response = send(
            client
                .request(
                    Method::from_bytes(b"MKCOL").unwrap(),
                    endpoint(config)?.join(path).map_err(|_| "地址无效")?,
                )
                .basic_auth(&config.username, Some(password)),
        )?;
        if !response.status().is_success() && response.status() != StatusCode::METHOD_NOT_ALLOWED {
            return Err(status_error(response.status()));
        }
    }
    Ok(())
}
pub fn read_bytes(
    config: &DavConfig,
    password: &str,
    name: &str,
    limit: u64,
) -> Result<Option<(Vec<u8>, Option<String>, Option<String>)>, String> {
    let response = send(
        client()?
            .get(object_url(config, name)?)
            .basic_auth(&config.username, Some(password)),
    )?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(status_error(response.status()));
    }
    if response.content_length().is_some_and(|size| size > limit) {
        return Err("同步对象超过大小限制".into());
    }
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取同步对象失败")?;
    if bytes.len() as u64 > limit {
        return Err("同步对象超过大小限制".into());
    }
    Ok(Some((bytes, etag, modified)))
}
pub fn image_exists(config: &DavConfig, password: &str, name: &str) -> Result<bool, String> {
    let response = send(
        client()?
            .head(object_url(config, name)?)
            .basic_auth(&config.username, Some(password)),
    )?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(false);
    }
    if response.status().is_success() {
        return Ok(true);
    }
    if response.status() == StatusCode::METHOD_NOT_ALLOWED {
        return read_bytes(config, password, name, 10 * 1024 * 1024).map(|v| v.is_some());
    }
    Err(status_error(response.status()))
}
pub fn write_bytes(
    config: &DavConfig,
    password: &str,
    name: &str,
    bytes: Vec<u8>,
    etag: Option<String>,
    modified: Option<String>,
    exists: bool,
) -> Result<(), String> {
    if bytes.len() as u64 > JSON_LIMIT {
        return Err("同步内容超过 24 MB 限制".into());
    }
    let client = client()?;
    ensure_folder(&client, config, password, name.starts_with("images/"))?;
    let mut request = client
        .put(object_url(config, name)?)
        .basic_auth(&config.username, Some(password))
        .header(
            header::CONTENT_TYPE,
            if name.ends_with(".png") {
                "image/png"
            } else {
                "application/json; charset=utf-8"
            },
        );
    request = if let Some(etag) = etag {
        request.header(header::IF_MATCH, etag)
    } else if let Some(modified) = modified {
        request.header(header::IF_UNMODIFIED_SINCE, modified)
    } else if !exists {
        request.header(header::IF_NONE_MATCH, "*")
    } else {
        return Err("服务器未提供 ETag 或修改时间，无法安全覆盖已有文件".into());
    };
    let response = send(request.body(bytes))?;
    if !response.status().is_success() {
        return Err(status_error(response.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn webdav_connect(
    config: DavConfig,
    password: String,
    remember: bool,
    state: tauri::State<'_, DavRuntime>,
) -> Result<(), String> {
    let key = credential_key(&config)?;
    let password = if password.is_empty() {
        password_for(&config, &state)?
    } else {
        password
    };
    let secret = password.clone();
    let cloned = config.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let response = send(
            client()?
                .request(Method::from_bytes(b"PROPFIND").unwrap(), endpoint(&cloned)?)
                .basic_auth(&cloned.username, Some(&secret))
                .header("Depth", "0"),
        )?;
        if !response.status().is_success() {
            return Err(status_error(response.status()));
        }
        if remember {
            credential(&cloned)?.set_password(&secret).map_err(|_| {
                "连接成功，但系统密钥库未能保存密码；请允许访问或关闭记住密码后重试".to_string()
            })?;
        } else if let Ok(entry) = credential(&cloned) {
            let _ = entry.delete_credential();
        }
        Ok(())
    })
    .await
    .map_err(|_| "连接任务失败")??;
    *state.0.lock().map_err(|_| "同步状态不可用")? = Some(Auth { key, password });
    Ok(())
}
#[tauri::command]
pub async fn webdav_read(
    config: DavConfig,
    kind: String,
    state: tauri::State<'_, DavRuntime>,
) -> Result<Option<RemoteFile>, String> {
    let name = match kind.as_str() {
        "configuration" => "configuration.json",
        "clipboard" => "clipboard.json",
        _ => return Err("未知同步类型".into()),
    };
    let password = password_for(&config, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_bytes(&config, &password, name, JSON_LIMIT)?
            .map(|(bytes, etag, modified)| {
                String::from_utf8(bytes)
                    .map(|data| RemoteFile {
                        data,
                        etag,
                        modified,
                    })
                    .map_err(|_| "远端内容不是 UTF-8".to_string())
            })
            .transpose()
    })
    .await
    .map_err(|_| "同步任务失败")?
}
#[tauri::command]
pub async fn webdav_write(
    config: DavConfig,
    kind: String,
    data: String,
    etag: Option<String>,
    modified: Option<String>,
    exists: bool,
    state: tauri::State<'_, DavRuntime>,
) -> Result<(), String> {
    let name = match kind.as_str() {
        "configuration" => "configuration.json",
        "clipboard" => "clipboard.json",
        _ => return Err("未知同步类型".into()),
    };
    serde_json::from_str::<serde_json::Value>(&data).map_err(|_| "同步内容不是有效 JSON")?;
    let password = password_for(&config, &state)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_bytes(
            &config,
            &password,
            name,
            data.into_bytes(),
            etag,
            modified,
            exists,
        )
    })
    .await
    .map_err(|_| "同步任务失败")?
}
#[tauri::command]
pub async fn webdav_forget(
    config: DavConfig,
    state: tauri::State<'_, DavRuntime>,
) -> Result<(), String> {
    *state.0.lock().map_err(|_| "同步状态不可用")? = None;
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(entry) = credential(&config) {
            let _ = entry.delete_credential();
        }
    })
    .await
    .map_err(|_| "清理密钥库失败")?;
    Ok(())
}
pub fn session_password(config: &DavConfig, state: &DavRuntime) -> Result<String, String> {
    password_for(config, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(url: &str) -> DavConfig {
        DavConfig {
            url: url.into(),
            username: "test".into(),
            allow_insecure: false,
        }
    }
    #[test]
    fn validates_destination_and_objects() {
        assert!(endpoint(&config("https://dav.example.test/root"))
            .unwrap()
            .as_str()
            .ends_with("/root/"));
        assert!(endpoint(&config("http://example.test/")).is_err());
        assert!(endpoint(&config("https://user:secret@example.test/")).is_err());
        assert!(endpoint(&config("https://example.test/?token=value")).is_err());
        assert!(object_url(&config("https://dav.example.test/root/"), "../secret").is_err());
        assert_eq!(
            object_url(&config("https://dav.example.test/root/"), "clipboard.json")
                .unwrap()
                .path(),
            "/root/qimiao/clipboard.json"
        );
    }
    fn server(responses: Vec<String>) -> (DavConfig, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let thread = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let deadline = std::time::Instant::now() + Duration::from_secs(8);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && std::time::Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(10))
                        }
                        Err(error) => panic!("mock request missing: {error}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let size = stream.read(&mut buffer).unwrap();
                    if size == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..size]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8_lossy(&bytes).into_owned());
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        });
        (config(&format!("http://{address}/root/")), thread)
    }
    fn response(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",
            body.len()
        )
    }
    #[test]
    fn webdav_reads_and_conditionally_writes_without_lost_updates() {
        let (config, server) = server(vec![
            response("200 OK", "ETag: \"rev1\"\r\n", "{}"),
            response("405 Method Not Allowed", "", ""),
            response("204 No Content", "", ""),
        ]);
        let remote = read_bytes(&config, "test-password", "clipboard.json", 100)
            .unwrap()
            .unwrap();
        assert_eq!(remote.1.as_deref(), Some("\"rev1\""));
        write_bytes(
            &config,
            "test-password",
            "clipboard.json",
            b"{\"entries\":[]}".to_vec(),
            remote.1,
            None,
            true,
        )
        .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /root/qimiao/clipboard.json"));
        assert!(requests[1].starts_with("MKCOL /root/qimiao/"));
        assert!(requests[2].to_lowercase().contains("if-match: \"rev1\""));
        assert!(requests[2].ends_with("{\"entries\":[]}"));
    }
    #[test]
    fn webdav_rejects_conflicts_and_never_follows_redirects() {
        let (config, fixture) = server(vec![
            response("201 Created", "", ""),
            response("412 Precondition Failed", "", ""),
        ]);
        let error = write_bytes(
            &config,
            "test-password",
            "configuration.json",
            b"{}".to_vec(),
            None,
            None,
            false,
        )
        .unwrap_err();
        assert!(error.contains("另一台设备"));
        assert!(fixture.join().unwrap()[1]
            .to_lowercase()
            .contains("if-none-match: *"));
        let (config, fixture) = server(vec![response(
            "302 Found",
            "Location: https://never-contact.example/\r\n",
            "",
        )]);
        assert!(read_bytes(&config, "test-password", "clipboard.json", 100)
            .unwrap_err()
            .contains("重定向"));
        assert_eq!(fixture.join().unwrap().len(), 1);
    }
    #[test]
    fn webdav_enforces_response_size_and_handles_not_found() {
        let (config, fixture) = server(vec![
            response("200 OK", "", "01234567890"),
            response("404 Not Found", "", ""),
        ]);
        assert!(read_bytes(&config, "test-password", "clipboard.json", 5)
            .unwrap_err()
            .contains("大小"));
        assert!(
            read_bytes(&config, "test-password", "configuration.json", 100)
                .unwrap()
                .is_none()
        );
        fixture.join().unwrap();
    }
}
