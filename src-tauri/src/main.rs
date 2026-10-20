#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod process_guard;
mod legacy_key;

use base64::{Engine, engine::general_purpose::STANDARD};
use rand::RngCore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, LogicalPosition, LogicalSize,
  menu::{Menu, MenuItem, PredefinedMenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
  webview::{WebviewBuilder, NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse}};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, Command}, sync::{Mutex as AsyncMutex, oneshot}};

type Reply = oneshot::Sender<Result<Value, String>>;
struct Backend {
  input: AsyncMutex<Option<ChildStdin>>,
  child: AsyncMutex<Option<Child>>,
  requests: Mutex<HashMap<u64, Reply>>,
  evaluations: Mutex<HashMap<String, (String, Reply)>>,
  serial: AtomicU64,
  running: AtomicBool,
  available: tokio::sync::Notify,
  quitting: AtomicBool,
  relaunch: Mutex<Option<(String, Vec<String>)>>,
  process_guard: Mutex<Option<process_guard::Guard>>,
}
impl Backend {
  fn new() -> Self { Self { input: AsyncMutex::new(None), child: AsyncMutex::new(None), requests: Mutex::new(HashMap::new()), evaluations: Mutex::new(HashMap::new()), serial: AtomicU64::new(0), running: AtomicBool::new(false), available: tokio::sync::Notify::new(), quitting: AtomicBool::new(false), relaunch: Mutex::new(None), process_guard: Mutex::new(None) } }
  async fn send(&self, value: Value) -> Result<(), String> {
    let mut input = self.input.lock().await;
    let input = input.as_mut().ok_or("Orion's local backend is not running.")?;
    let mut bytes = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    bytes.push(b'\n'); input.write_all(&bytes).await.map_err(|error| error.to_string())
  }
}
fn host_event(app: &AppHandle, value: Value) {
  let backend = app.state::<Arc<Backend>>().inner().clone();
  tauri::async_runtime::spawn(async move { let _ = backend.send(value).await; });
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> { value.get(key).and_then(Value::as_str).ok_or_else(|| format!("Missing native parameter: {key}")) }
fn owned_ui(label: &str) -> bool { label == "main" }
fn browser_navigation_state(app: &AppHandle, view: &tauri::Webview) {
  let app = app.clone(); let label = view.label().to_string();
  let _ = view.with_webview(move |platform| {
    #[cfg(windows)]
    unsafe {
      if let Ok(core) = platform.controller().CoreWebView2() {
        let mut back = Default::default(); let mut forward = Default::default();
        if core.CanGoBack(&mut back).is_ok() && core.CanGoForward(&mut forward).is_ok() {
          host_event(&app, json!({"type":"host-event","event":"browser-event","label":label,"back":back.as_bool(),"forward":forward.as_bool()}));
        }
      }
    }
    #[cfg(target_os = "linux")]
    {
      use webkit2gtk::WebViewExt;
      let view = platform.inner();
      host_event(&app, json!({"type":"host-event","event":"browser-event","label":label,"back":view.can_go_back(),"forward":view.can_go_forward()}));
    }
  });
}

#[tauri::command]
async fn orion_invoke(webview: tauri::Webview, app: AppHandle, channel: String, args: Value) -> Result<Value, String> {
  if !owned_ui(webview.label()) { return Err("Remote pages cannot call Orion's application API.".into()); }
  if channel.len() > 100 || !args.is_array() { return Err("Invalid Orion request.".into()); }
  let backend = app.state::<Arc<Backend>>().inner().clone();
  if !backend.running.load(Ordering::Acquire) {
    let available = backend.available.notified();
    if !backend.running.load(Ordering::Acquire) {
      tokio::time::timeout(std::time::Duration::from_secs(45), available).await.map_err(|_| "Orion's backend could not initialize.".to_string())?;
    }
  }
  let id = backend.serial.fetch_add(1, Ordering::Relaxed) + 1;
  let (reply, result) = oneshot::channel(); backend.requests.lock().unwrap().insert(id, reply);
  if let Err(error) = backend.send(json!({"type":"request","id":id,"window":webview.label(),"channel":channel,"args":args})).await {
    backend.requests.lock().unwrap().remove(&id); return Err(error);
  }
  result.await.map_err(|_| "The local Orion backend disconnected.".to_string())?
}

#[tauri::command]
fn browser_result(webview: tauri::Webview, app: AppHandle, id: String, value: Value, error: Option<String>) -> Result<(), String> {
  let backend = app.state::<Arc<Backend>>();
  let mut waiting = backend.evaluations.lock().unwrap();
  if waiting.get(&id).is_none_or(|(label, _)| label != webview.label()) { return Err("Unknown browser evaluation.".into()); }
  let (_, reply) = waiting.remove(&id).unwrap();
  let _ = reply.send(if let Some(error) = error { Err(error) } else { Ok(value) }); Ok(())
}

#[tauri::command]
fn browser_shortcut(webview:tauri::Webview,app:AppHandle,action:String)->Result<(),String>{
 if !webview.label().starts_with("browser-tab-") || !matches!(action.as_str(),"address"|"new"|"close"|"next"|"previous"){return Err("Invalid browser shortcut".into());}
 host_event(&app,json!({"type":"host-event","event":"browser-shortcut","action":action}));Ok(())
}

fn storage_key(root: String) -> Result<String, String> {
  if let Some(key)=legacy_key::read(std::path::Path::new(&root))? { return Ok(key); }
  let account = format!("profile-{:x}", Sha256::digest(root.as_bytes()));
  let entry = keyring::Entry::new("Orion Tauri local encryption", &account).map_err(|error| error.to_string())?;
  match entry.get_password() {
    Ok(value) => { if STANDARD.decode(&value).map_err(|error| error.to_string())?.len() != 32 { return Err("The OS-protected Orion key is invalid.".into()); } Ok(value) }
    Err(keyring::Error::NoEntry) => {
      let mut bytes = [0u8; 32]; rand::rng().fill_bytes(&mut bytes); let value = STANDARD.encode(bytes);
      entry.set_password(&value).map_err(|error| format!("Could not protect Orion's key in the operating system credential store: {error}"))?; Ok(value)
    }
    Err(error) => Err(format!("Could not unlock Orion's operating system credential store: {error}")),
  }
}

async fn native_operation(app: AppHandle, method: String, args: Value) -> Result<Value, String> {
  match method.as_str() {
    "storage-key" => { let root = text(&args, "root")?.to_string(); tokio::task::spawn_blocking(move || storage_key(root)).await.map_err(|error| error.to_string())?.map(Value::String) }
    "window-load" => {
      let label = text(&args, "label")?;
      if text(&args, "file")? != "index.html" || !owned_ui(label) { return Err("Invalid local Orion page.".into()); }
      if label == "main" { app.get_webview_window(label).ok_or("Main window unavailable")?.show().map_err(|error| error.to_string())?; }
      Ok(Value::Null)
    }
    "window-action" => {
      let label = text(&args, "label")?;
      let Some(window) = app.get_webview_window(label) else { return Ok(Value::Null); };
      match text(&args, "action")? {
        "show" => window.show(), "hide" => window.hide(), "focus" => window.set_focus(),
        "minimize" => window.minimize(), "maximize" => window.maximize(), "unmaximize" => window.unmaximize(), "restore" => window.unminimize(), "destroy" => window.destroy(),
        _ => return Err("Unknown window operation".into()),
      }.map_err(|error| error.to_string())?; Ok(Value::Null)
    }
    "webview-create" => {
      let label = text(&args, "label")?.to_string();
      if !label.starts_with("browser-tab-") || label.len() > 80 { return Err("Invalid browser tab label".into()); }
      let parent = app.get_window("main").ok_or("Orion window unavailable")?;
      let navigation_app = app.clone(); let popup_app = app.clone(); let popup_label = label.clone();
      let load_app = app.clone(); let title_app = app.clone();
      let builder = WebviewBuilder::new(&label, WebviewUrl::External("about:blank".parse().unwrap()))
        .initialization_script("document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const k=e.key.toLowerCase(),action=k==='l'?'address':k==='t'?'new':k==='w'?'close':e.key==='Tab'?(e.shiftKey?'previous':'next'):null;if(action){e.preventDefault();window.__TAURI_INTERNALS__.invoke('browser_shortcut',{action}).catch(()=>{});}},true);")
        .on_navigation(move |url| {
          let allowed = url.scheme() == "https" || url.as_str() == "about:blank";
          if !allowed { let _ = navigation_app.emit_to("main", "orion:browser-navigation-blocked", url.as_str()); } allowed
        })
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_new_window(move |url, _| { if url.scheme() == "https" { host_event(&popup_app, json!({"type":"host-event","event":"browser-popup","label":popup_label,"url":url.as_str()})); } NewWindowResponse::Deny })
        .on_page_load(move |view, payload| {
          let phase = if payload.event() == PageLoadEvent::Finished { "finished" } else { "started" };
          host_event(&load_app, json!({"type":"host-event","event":"browser-event","label":view.label(),"url":payload.url().as_str(),"phase":phase}));
          if payload.event() == PageLoadEvent::Finished { browser_navigation_state(&load_app, &view); }
        })
        .on_document_title_changed(move |view, title| { host_event(&title_app, json!({"type":"host-event","event":"browser-event","label":view.label(),"title":title})); });
      let child=parent.add_child(builder, LogicalPosition::new(0., 0.), LogicalSize::new(1., 1.)).map_err(|error| error.to_string())?;
      child.hide().map_err(|error|error.to_string())?;
      Ok(Value::Null)
    }
    "webview-eval" => {
      let label = text(&args, "label")?;
      if !label.starts_with("browser-tab-") { return Err("Script evaluation is restricted to browser tabs.".into()); }
      let view = app.get_webview(label).ok_or("Browser tab unavailable")?;
      let id = uuid::Uuid::new_v4().to_string(); let (reply, result) = oneshot::channel();
      app.state::<Arc<Backend>>().evaluations.lock().unwrap().insert(id.clone(), (label.to_string(), reply));
      let script = text(&args, "script")?;
      let wrapped = format!("(async()=>{{try{{const value=await (0,eval)({});await window.__TAURI_INTERNALS__.invoke('browser_result',{{id:{},value:value??null,error:null}})}}catch(error){{await window.__TAURI_INTERNALS__.invoke('browser_result',{{id:{},value:null,error:String(error)}})}}}})()", serde_json::to_string(script).unwrap(), serde_json::to_string(&id).unwrap(), serde_json::to_string(&id).unwrap());
      view.eval(wrapped).map_err(|error| error.to_string())?;
      let response = tokio::time::timeout(std::time::Duration::from_secs(20), result).await;
      app.state::<Arc<Backend>>().evaluations.lock().unwrap().remove(&id);
      response.map_err(|_| "The browser page did not return its content in time.".to_string())?.map_err(|_| "Browser evaluation cancelled".to_string())?
    }
    "webview-navigate" => {
      let label = text(&args, "label")?;
      if !label.starts_with("browser-tab-") { return Err("Local Orion pages cannot be navigated externally.".into()); }
      let url: url::Url = text(&args, "url")?.parse().map_err(|_| "Invalid URL")?;
      if url.scheme() != "https" { return Err("Only HTTPS browser navigation is allowed.".into()); }
      app.get_webview(label).ok_or("Browser tab unavailable")?.navigate(url).map_err(|error| error.to_string())?; Ok(Value::Null)
    }
    "webview-action" | "webview-bounds" | "webview-visible" | "webview-close" | "webview-background" => {
      let label = text(&args, "label")?;
      if !label.starts_with("browser-tab-") { return Err("Invalid browser tab".into()); }
      let Some(view) = app.get_webview(label) else { return Ok(Value::Null); };
      match method.as_str() {
        "webview-action" => { let script = match text(&args, "action")? { "back" => "history.back()", "forward" => "history.forward()", "reload" => "location.reload()", "stop" => "window.stop()", _ => return Err("Invalid browser action".into()) }; view.eval(script) }
        "webview-bounds" => {
          let number = |key| args.get(key).and_then(Value::as_f64).unwrap_or(0.);
          view.set_position(LogicalPosition::new(number("x"), number("y"))).map_err(|error| error.to_string())?;
          view.set_size(LogicalSize::new(number("width").max(1.), number("height").max(1.)))
        }
        "webview-visible" => if args["visible"].as_bool().unwrap_or(false) { view.show() } else { view.hide() },
        "webview-close" => view.close(),
        "webview-background" => view.set_background_color(Some(tauri::webview::Color(17, 19, 24, 255))),
        _ => unreachable!(),
      }.map_err(|error| error.to_string())?; Ok(Value::Null)
    }
    "dialog-open" => {
      let properties = args.get("properties").and_then(Value::as_array).cloned().unwrap_or_default();
      let directory = properties.iter().any(|value| value.as_str() == Some("openDirectory"));
      let multiple = properties.iter().any(|value| value.as_str() == Some("multiSelections"));
      let mut dialog = rfd::AsyncFileDialog::new().set_title(args.get("title").and_then(Value::as_str).unwrap_or("Orion"));
      if let Some(filters) = args.get("filters").and_then(Value::as_array) { for filter in filters {
        let extensions: Vec<&str> = filter["extensions"].as_array().map(|values| values.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
        dialog = dialog.add_filter(filter["name"].as_str().unwrap_or("Files"), &extensions);
      }}
      let paths: Vec<PathBuf> = if directory { dialog.pick_folder().await.into_iter().map(|value| value.path().to_owned()).collect() }
        else if multiple { dialog.pick_files().await.unwrap_or_default().into_iter().map(|value| value.path().to_owned()).collect() }
        else { dialog.pick_file().await.into_iter().map(|value| value.path().to_owned()).collect() };
      Ok(json!({"canceled":paths.is_empty(),"filePaths":paths}))
    }
    "dialog-message" => {
      let buttons: Vec<&str> = args["buttons"].as_array().map(|values| values.iter().filter_map(Value::as_str).collect()).unwrap_or_else(|| vec!["OK"]);
      let mut dialog = rfd::AsyncMessageDialog::new().set_title(args["title"].as_str().unwrap_or("Orion")).set_description(format!("{}\n\n{}", args["message"].as_str().unwrap_or(""), args["detail"].as_str().unwrap_or("")));
      dialog = if buttons.len() > 1 { dialog.set_buttons(rfd::MessageButtons::OkCancelCustom(buttons[0].into(), buttons[1].into())) } else { dialog.set_buttons(rfd::MessageButtons::OkCustom(buttons[0].into())) };
      if args["type"].as_str() == Some("error") { dialog = dialog.set_level(rfd::MessageLevel::Error); }
      let response = dialog.show().await;
      Ok(json!({"response":if matches!(response, rfd::MessageDialogResult::Ok) || response == rfd::MessageDialogResult::Custom(buttons[0].into()) {0} else {1}}))
    }
    "open-external" => {
      let url = url::Url::parse(text(&args, "url")?).map_err(|_| "Invalid external URL")?;
      if url.scheme() != "https" { return Err("Only HTTPS links may open externally.".into()); }
      open::that(url.as_str()).map_err(|error| error.to_string())?; Ok(Value::Null)
    }
    "open-path" => { let file = text(&args, "file")?; match open::that(file) { Ok(_) => Ok(json!("")), Err(error) => Ok(json!(error.to_string())) } }
    "reveal-file" => {
      let file = PathBuf::from(text(&args, "file")?);
      #[cfg(windows)] { std::process::Command::new("explorer.exe").arg(format!("/select,{}", file.display())).spawn().map_err(|error| error.to_string())?; }
      #[cfg(not(windows))] { open::that(file.parent().ok_or("Invalid file path")?).map_err(|error| error.to_string())?; }
      Ok(Value::Null)
    }
    "tray-enable" => {
      if app.tray_by_id("orion").is_none() {
        let show = MenuItem::with_id(&app, "show", "Show Orion", true, None::<&str>).map_err(|error| error.to_string())?;
        let quit = MenuItem::with_id(&app, "quit", "Quit Orion", true, None::<&str>).map_err(|error| error.to_string())?;
        let separator = PredefinedMenuItem::separator(&app).map_err(|error| error.to_string())?;
        let menu = Menu::with_items(&app, &[&show, &separator, &quit]).map_err(|error| error.to_string())?;
        let icon = app.default_window_icon().ok_or("Orion tray icon unavailable")?.clone();
        TrayIconBuilder::with_id("orion").icon(icon).tooltip("Orion · local AI").menu(&menu).show_menu_on_left_click(false)
          .on_menu_event(|app, event| host_event(app, json!({"type":"host-event","event":if event.id.as_ref()=="quit" {"tray-quit"} else {"tray-show"}})))
          .on_tray_icon_event(|tray, event| { if matches!(event, TrayIconEvent::Click {button:MouseButton::Left,button_state:MouseButtonState::Up,..}) {host_event(tray.app_handle(),json!({"type":"host-event","event":"tray-show"}));} })
          .build(&app).map_err(|error| error.to_string())?;
      } Ok(json!(true))
    }
    "tray-disable" => { app.remove_tray_by_id("orion"); Ok(Value::Null) }
    "relaunch" => {
      let executable = text(&args, "execPath")?.to_string();
      let arguments = args["args"].as_array().map(|values| values.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
      *app.state::<Arc<Backend>>().relaunch.lock().unwrap() = Some((executable, arguments)); Ok(Value::Null)
    }
    "quit" => {
      let backend = app.state::<Arc<Backend>>(); backend.quitting.store(true, Ordering::SeqCst);
      if let Some((executable, arguments)) = backend.relaunch.lock().unwrap().take() { std::process::Command::new(executable).args(arguments).spawn().map_err(|error| error.to_string())?; }
      app.exit(0); Ok(Value::Null)
    }
    _ => Err(format!("Unknown native operation: {method}")),
  }
}

async fn start_backend(app: AppHandle) -> Result<(), String> {
  let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
  let resource = if cfg!(debug_assertions) { project.clone() } else { app.path().resource_dir().map_err(|error| error.to_string())? };
  let executable = if cfg!(debug_assertions) { project.join("src-tauri/binaries").join(format!("orion-service-{}{}", env!("ORION_TARGET"), std::env::consts::EXE_SUFFIX)) }
    else { std::env::current_exe().map_err(|error| error.to_string())?.parent().unwrap().join(format!("orion-service{}", std::env::consts::EXE_SUFFIX)) };
  let profile = std::env::var_os("ORION_TAURI_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().config_dir().map_err(|error| error.to_string())?.join("orion-local-ai"));
  std::fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
  let paths = json!({"userData":profile,"downloads":app.path().download_dir().map_err(|error|error.to_string())?,"documents":app.path().document_dir().map_err(|error|error.to_string())?,"home":app.path().home_dir().map_err(|error|error.to_string())?,"temp":std::env::temp_dir(),"exe":std::env::current_exe().map_err(|error|error.to_string())?});
  let mut command = Command::new(&executable);
  command.env("ORION_PATHS", paths.to_string()).env("ORION_RESOURCE_ROOT", &resource).env("ORION_PACKAGED", if cfg!(debug_assertions) {"0"}else{"1"}).env("ORION_VERSION", env!("CARGO_PKG_VERSION"))
    .current_dir(&resource).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).kill_on_drop(true);
  #[cfg(windows)] command.creation_flags(0x08000000);
  #[cfg(unix)] { command.process_group(0); }
  let mut child = command.spawn().map_err(|error| format!("Could not start bundled Orion backend {}: {error}", executable.display()))?;
  let guard = process_guard::Guard::attach(child.id().ok_or("Backend process ID unavailable")?)?;
  let output = child.stdout.take().ok_or("Backend output unavailable")?;
  let input = child.stdin.take().ok_or("Backend input unavailable")?;
  let backend = app.state::<Arc<Backend>>().inner().clone();
  *backend.input.lock().await = Some(input); *backend.child.lock().await = Some(child); *backend.process_guard.lock().unwrap() = Some(guard);
  backend.running.store(true, Ordering::Release); backend.available.notify_waiters();
  let mut lines = BufReader::new(output).lines();
  while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
    let Ok(message) = serde_json::from_str::<Value>(&line) else { continue; };
    match message["type"].as_str() {
      Some("response") => { if let Some(id) = message["id"].as_u64() { if let Some(reply) = backend.requests.lock().unwrap().remove(&id) {
        let response = if let Some(error) = message["error"].as_str() {Err(error.to_string())}else{Ok(message["value"].clone())}; let _ = reply.send(response);
      }}}
      Some("event") => { if let Some(label) = message["window"].as_str() { let _ = app.emit_to(label, "orion:event", json!({"channel":message["channel"],"args":message["args"]})); } }
      Some("native") => {
        let app = app.clone(); let backend = backend.clone();
        tauri::async_runtime::spawn(async move {
          let response = native_operation(app, message["method"].as_str().unwrap_or("").to_string(), message["args"].clone()).await;
          let reply = match response { Ok(value) => json!({"type":"native-result","id":message["id"],"value":value}), Err(error) => json!({"type":"native-result","id":message["id"],"error":error}) };
          let _ = backend.send(reply).await;
        });
      }
      _ => {},
    }
  }
  for (_, reply) in backend.requests.lock().unwrap().drain() { let _ = reply.send(Err("Orion's local backend stopped.".into())); }
  if !backend.quitting.load(Ordering::SeqCst) { return Err("Orion's local backend exited unexpectedly.".into()); } Ok(())
}

fn main() {
  let backend = Arc::new(Backend::new());
  tauri::Builder::default()
    .manage(backend)
    .plugin(tauri_plugin_single_instance::init(|app, args, _| host_event(app, json!({"type":"host-event","event":if args.iter().any(|arg|arg=="--quit") {"tray-quit"}else{"second-instance"}}))))
    .on_permission_request(|view, kind| if view.label() == "main" && matches!(kind, PermissionKind::Microphone | PermissionKind::ClipboardRead) { PermissionResponse::Allow } else { PermissionResponse::Deny })
    .invoke_handler(tauri::generate_handler![orion_invoke, browser_result, browser_shortcut])
    .on_window_event(|window, event| match event {
      tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); host_event(window.app_handle(), json!({"type":"host-event","event":"window-close","window":window.label()})); },
      tauri::WindowEvent::Resized(size) => { let scale = window.scale_factor().unwrap_or(1.); host_event(window.app_handle(), json!({"type":"host-event","event":"window-size","window":window.label(),"width":size.width as f64/scale,"height":size.height as f64/scale,"maximized":window.is_maximized().unwrap_or(false)})); },
      _ => {},
    })
    .setup(|app| {
      let configuration = app.config().app.windows.iter().find(|window| window.label == "main").ok_or("Missing main window configuration")?.clone();
      WebviewWindowBuilder::from_config(app, &configuration)?
        .on_navigation(|url| {
          let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost")) || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
          let dev = cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(4173);
          if !local && !dev && url.scheme() == "https" { let _ = open::that(url.as_str()); } local || dev
        })
        .on_new_window(|url, _| { if url.scheme() == "https" { let _ = open::that(url.as_str()); } NewWindowResponse::Deny })
        .build()?;
      let app = app.handle().clone(); tauri::async_runtime::spawn(async move {
      if let Err(error) = start_backend(app.clone()).await { eprintln!("{error}"); let _ = rfd::AsyncMessageDialog::new().set_title("Orion could not start").set_description(&error).set_level(rfd::MessageLevel::Error).show().await; app.state::<Arc<Backend>>().quitting.store(true, Ordering::SeqCst); app.exit(1); }
    }); Ok(()) })
    .build(tauri::generate_context!()).expect("Could not initialize Orion's native desktop host")
    .run(|app, event| {
      if let tauri::RunEvent::ExitRequested { api, .. } = event { if !app.state::<Arc<Backend>>().quitting.load(Ordering::SeqCst) { api.prevent_exit(); host_event(app, json!({"type":"host-event","event":"shutdown"})); } }
    });
}
