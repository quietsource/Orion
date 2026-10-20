/// The service and all of its model/voice descendants die if the desktop host
/// crashes. Normal exit still goes through Orion's graceful shutdown first.
#[cfg(windows)]
pub struct Guard(usize);
#[cfg(windows)]
impl Guard {
  pub fn attach(pid: u32) -> Result<Self, String> {
    use windows_sys::Win32::{Foundation::CloseHandle, System::{JobObjects::*, Threading::*}};
    unsafe {
      let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
      if job.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
      let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as _, std::mem::size_of_val(&limits) as u32) == 0 { CloseHandle(job); return Err(std::io::Error::last_os_error().to_string()); }
      let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
      if process.is_null() { CloseHandle(job); return Err(std::io::Error::last_os_error().to_string()); }
      let assigned = AssignProcessToJobObject(job, process); CloseHandle(process);
      if assigned == 0 { CloseHandle(job); return Err(std::io::Error::last_os_error().to_string()); }
      Ok(Self(job as usize))
    }
  }
}
#[cfg(windows)]
impl Drop for Guard { fn drop(&mut self) { unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0 as _); } } }

#[cfg(unix)]
pub struct Guard(u32);
#[cfg(unix)]
impl Guard { pub fn attach(pid: u32) -> Result<Self, String> { Ok(Self(pid)) } }
#[cfg(unix)]
impl Drop for Guard { fn drop(&mut self) { unsafe { libc::kill(-(self.0 as i32), libc::SIGKILL); } } }
