#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KvCacheScales {
    pub k: f32,
    pub v: f32,
}

pub const DEFAULT_FP8_KV_CACHE_SCALES: KvCacheScales = KvCacheScales { k: 1.0, v: 1.0 };

#[cfg(feature = "cuda")]
mod cuda;
#[cfg(feature = "cuda")]
pub use cuda::*;

#[cfg(feature = "metal")]
mod metal;
#[cfg(feature = "metal")]
pub use metal::*;
