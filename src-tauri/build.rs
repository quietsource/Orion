fn main() {
 println!("cargo:rustc-env=ORION_TARGET={}", std::env::var("TARGET").unwrap());
 tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
  tauri_build::AppManifest::new().commands(&["orion_invoke", "browser_result", "browser_shortcut"])
 )).expect("Could not build Orion's native permissions");
}
