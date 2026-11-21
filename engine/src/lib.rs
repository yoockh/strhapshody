//! strhapshody core logic engine.
//!
//! Everything in this crate is pure, deterministic, camera-free and mic-free
//! logic (see DECISIONS.md ADR-0002). It compiles to WASM for the browser and
//! is unit-tested natively with `cargo test` — no camera or human in the loop.
//!
//! Task 0.2 only proves the WASM pipeline end to end with a couple of trivial
//! exported functions and a native round-trip test. Real modules (hexmap,
//! strum, smoothing, powerstrip, gesture, distortion) land in later phases.

use wasm_bindgen::prelude::*;

pub mod smoothing;
pub use smoothing::OneEuroFilter;

pub mod strum;
pub use strum::{StrumDetector, StrumDirection, StrumEvent};

pub mod gesture;
pub use gesture::{classify_hand_shape, GestureDetector, HandShape};

/// Trivial number round-trip: proves primitive values marshal across the
/// JS <-> WASM boundary. Used by the TS round-trip test for task 0.2.
#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

/// String round-trip: proves heap-allocated values (String) marshal across the
/// boundary too. Returns the crate version so the frontend can sanity-check it
/// is talking to the engine build it expects.
#[wasm_bindgen]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_sums_values() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(add(-4, 4), 0);
        assert_eq!(add(i32::MAX - 1, 1), i32::MAX);
    }

    #[test]
    fn engine_version_matches_cargo() {
        assert_eq!(engine_version(), env!("CARGO_PKG_VERSION"));
        assert_eq!(engine_version(), "0.1.0");
    }
}
