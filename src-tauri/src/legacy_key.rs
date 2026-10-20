use std::path::Path;
use base64::{Engine, engine::general_purpose::STANDARD};

/// Read the original key without replacing it: Electron and Tauri can both
/// continue to unlock the same encrypted conversations and memory archives.
pub fn read(root: &Path) -> Result<Option<String>, String> {
 let file = root.join("data-key.bin");
 let stored = match std::fs::read(&file) {
  Ok(value) => value,
  Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
  Err(error) => return Err(format!("Could not read Orion's existing encryption key: {error}")),
 };
 if !stored.starts_with(b"ORIONKEY1") { return Err("Orion's existing encryption key has an unknown format. It has not been modified.".into()); }
 let key = decrypt(root, &stored[9..])?;
 if STANDARD.decode(&key).map_err(|error|error.to_string())?.len()!=32 { return Err("Orion's existing data key is invalid.".into()); }
 Ok(Some(key))
}

#[cfg(windows)]
fn decrypt(root: &Path, stored: &[u8]) -> Result<String,String> {
 use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
 use windows_sys::Win32::{Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN}, Foundation::LocalFree};
 fn unprotect(bytes:&[u8])->Result<Vec<u8>,String>{unsafe{
  let input=CRYPT_INTEGER_BLOB{cbData:bytes.len() as u32,pbData:bytes.as_ptr() as *mut u8};
  let mut output=CRYPT_INTEGER_BLOB{cbData:0,pbData:std::ptr::null_mut()};
  if CryptUnprotectData(&input,std::ptr::null_mut(),std::ptr::null(),std::ptr::null(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output)==0{return Err(format!("Windows could not unlock Orion's key for this user: {}",std::io::Error::last_os_error()));}
  let result=std::slice::from_raw_parts(output.pbData,output.cbData as usize).to_vec();LocalFree(output.pbData as _);Ok(result)
 }}
 if stored.starts_with(b"v10") {
  if stored.len()<31{return Err("Orion's protected key is incomplete.".into());}
  let state_path=root.parent().ok_or("Invalid Orion profile")?.join("Local State");
  let state:serde_json::Value=serde_json::from_slice(&std::fs::read(state_path).map_err(|error|format!("Could not read Orion's existing Local State: {error}"))?).map_err(|error|error.to_string())?;
  let encoded=state["os_crypt"]["encrypted_key"].as_str().ok_or("Orion's existing OS encryption key is missing.")?;
  let encrypted=STANDARD.decode(encoded).map_err(|error|error.to_string())?;
  if !encrypted.starts_with(b"DPAPI"){return Err("Unsupported Orion OS key protection.".into());}
  let master=unprotect(&encrypted[5..])?;
  let cipher=Aes256Gcm::new_from_slice(&master).map_err(|_|"Invalid Orion OS key length")?;
  let bytes=cipher.decrypt(Nonce::from_slice(&stored[3..15]),&stored[15..]).map_err(|_|"Could not authenticate Orion's original data key")?;
  String::from_utf8(bytes).map_err(|error|error.to_string())
 }else{String::from_utf8(unprotect(stored)?).map_err(|error|error.to_string())}
}

#[cfg(target_os="linux")]
fn decrypt(_root:&Path,stored:&[u8])->Result<String,String>{
 use aes::cipher::{KeyIvInit,BlockDecryptMut,block_padding::Pkcs7};
 use secret_service::{blocking::SecretService,EncryptionType};
 use std::collections::HashMap;
 if !stored.starts_with(b"v11") {return Err("Orion requires its original desktop keyring; insecure basic-text key protection is not accepted.".into());}
 let service=SecretService::connect(EncryptionType::Dh).map_err(|error|format!("Could not connect to Orion's desktop keyring: {error}"))?;
 for application in ["orion-local-ai","Orion","orion"] {
  let items=service.search_items(HashMap::from([("application",application)])).map_err(|error|error.to_string())?;
  for item in items.unlocked.into_iter().chain(items.locked) {
   item.unlock().map_err(|error|format!("Could not unlock Orion's existing keyring item: {error}"))?;
   let password=item.get_secret().map_err(|error|error.to_string())?;
   let mut key=[0u8;16];pbkdf2::pbkdf2_hmac::<sha1::Sha1>(&password,b"saltysalt",1,&mut key);
   if let Ok(bytes)=cbc::Decryptor::<aes::Aes128>::new((&key).into(),(&[b' ';16]).into()).decrypt_padded_vec_mut::<Pkcs7>(&stored[3..]) {
    if let Ok(value)=String::from_utf8(bytes) {if STANDARD.decode(&value).is_ok_and(|bytes|bytes.len()==32){return Ok(value);}}
   }
  }
 }
 Err("Could not locate Orion's original encryption secret in the desktop keyring. Existing data has not been changed.".into())
}

#[cfg(not(any(windows,target_os="linux")))]
fn decrypt(_root:&Path,_stored:&[u8])->Result<String,String>{
 Err("This operating system is not currently supported by Orion.".into())
}
