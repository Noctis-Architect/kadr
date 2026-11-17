// kadr desktop: a native window around the same editor `kadr serve` runs.
//
// On start the window shows a tiny bundled splash page (instant), while the
// bundled Node runs bin/desktop.js. That prints `KADR_URL http://127.0.0.1:N`;
// we then allow that exact origin to call the window commands (title bar
// buttons, dragging, opening links) and navigate the window to it. When the
// app exits the server goes with it: we kill it, and it also exits by itself
// when its stdin (owned by us) closes, even if this process crashes.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, RunEvent, Url};
use tauri_plugin_window_state::StateFlags;

#[derive(Default)]
struct Server(Mutex<Option<Child>>);

/// Folder that holds bin/, src/, web/... In dev that is the repository itself.
fn app_dir(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("KADR_APP_DIR") {
        return PathBuf::from(dir);
    }
    if cfg!(debug_assertions) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        if repo.join("bin").join("desktop.js").exists() {
            return repo;
        }
    }
    app.path()
        .resource_dir()
        .map(|d| d.join("app"))
        .unwrap_or_else(|_| PathBuf::from("app"))
}

/// The Node bundled next to the executable (tauri `externalBin`), else the system one.
fn node_bin() -> PathBuf {
    let name = format!("kadr-node{}", std::env::consts::EXE_SUFFIX);
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        let p = dir.join(&name);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(format!("node{}", std::env::consts::EXE_SUFFIX))
}

/// Windows extended paths (\\?\C:\...) confuse Node's module loader.
fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => p,
    }
}

fn show_error(app: &AppHandle, msg: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let js = format!("window.kadrFail && window.kadrFail({})", serde_json_str(msg));
        let _ = w.eval(&js);
    }
}

/// Minimal JSON string literal (no serde dependency needed for one call).
fn serde_json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn start_server(app: &AppHandle) -> Result<(), String> {
    let dir = plain(app_dir(app));
    let script = dir.join("bin").join("desktop.js");
    let node = node_bin();

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .current_dir(&dir)
        .env("KADR_DESKTOP", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // `kadr-desktop /path/to/project` opens that project.
    if let Some(p) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
        cmd.arg("--project").arg(p);
    }
    // The AppImage runtime points these at its own bundled libraries; ffmpeg,
    // chromium and agent CLIs started by the server must use the system ones.
    if std::env::var_os("APPIMAGE").is_some() {
        for k in [
            "LD_LIBRARY_PATH", "LD_PRELOAD", "GST_PLUGIN_PATH", "GST_PLUGIN_PATH_1_0",
            "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_SCANNER",
            "GST_PLUGIN_SCANNER_1_0", "GST_REGISTRY", "GST_REGISTRY_1_0", "GIO_MODULE_DIR",
            "GIO_EXTRA_MODULES", "GDK_PIXBUF_MODULE_FILE", "GDK_PIXBUF_MODULEDIR",
            "GSETTINGS_SCHEMA_DIR", "GTK_PATH", "GTK_EXE_PREFIX", "GTK_DATA_PREFIX",
            "PYTHONHOME", "PYTHONPATH", "PERLLIB", "QT_PLUGIN_PATH",
        ] {
            cmd.env_remove(k);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start Node ({}): {e}", node.display()))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    *app.state::<Server>().0.lock().unwrap() = Some(child);

    // Keep the last part of stderr to show if the server dies before it is up.
    let errlog = Arc::new(Mutex::new(String::new()));
    {
        let errlog = errlog.clone();
        std::thread::spawn(move || {
            let mut r = BufReader::new(stderr);
            let mut buf = [0u8; 4096];
            while let Ok(n) = r.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let s = String::from_utf8_lossy(&buf[..n]);
                eprint!("{s}");
                let mut log = errlog.lock().unwrap();
                log.push_str(&s);
                if log.len() > 6000 {
                    let cut = log.len() - 4000;
                    let cut = (cut..log.len()).find(|i| log.is_char_boundary(*i)).unwrap_or(0);
                    log.drain(..cut);
                }
            }
        });
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let mut ready = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !ready {
                if let Some(url) = line.strip_prefix("KADR_URL ") {
                    ready = true;
                    if let Err(e) = open_editor(&app, url.trim()) {
                        show_error(&app, &e);
                    }
                    continue;
                }
            }
            println!("{line}");
        }
        if !ready {
            // stdout closed before the URL: the server failed to start.
            std::thread::sleep(std::time::Duration::from_millis(150));
            let log = errlog.lock().unwrap().clone();
            let msg = if log.trim().is_empty() { "The editor server stopped while starting.".to_string() } else { log };
            show_error(&app, &msg);
        }
    });
    Ok(())
}

fn open_editor(app: &AppHandle, url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|e| format!("bad server url {url}: {e}"))?;
    let origin = parsed.origin().ascii_serialization();
    app.add_capability(
        CapabilityBuilder::new("editor")
            .remote(format!("{origin}/*"))
            .window("main")
            .permission("core:default")
            .permission("core:window:allow-minimize")
            .permission("core:window:allow-toggle-maximize")
            .permission("core:window:allow-close")
            .permission("core:window:allow-start-dragging")
            .permission("core:window:allow-is-maximized")
            .permission("opener:allow-open-url"),
    )
    .map_err(|e| e.to_string())?;
    let w = app.get_webview_window("main").ok_or("main window is gone")?;
    w.navigate(parsed).map_err(|e| e.to_string())
}

fn stop_server(app: &AppHandle) {
    if let Some(state) = app.try_state::<Server>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            drop(child.stdin.take()); // lets the server shut down cleanly
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(800);
            while std::time::Instant::now() < deadline {
                if let Ok(Some(_)) = child.try_wait() {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(Server::default())
        .setup(|app| {
            if let Err(e) = start_server(app.handle()) {
                show_error(app.handle(), &e);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building kadr");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_server(app);
        }
    });
}
