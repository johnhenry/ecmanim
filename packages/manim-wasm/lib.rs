// manim shared math core, compiled to a dependency-free WebAssembly module with
// a C ABI. The same .wasm is loaded by manim-js (Node/browser via WebAssembly)
// and by Python manim (via wasmtime) — a genuinely cross-language computational
// core. No_std + static linear buffers so it needs no allocator and no libm
// (only +,-,*,/, and comparisons are used).

#![no_std]
#![allow(static_mut_refs)]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    loop {}
}

const N: usize = 65536;
static mut BUF: [f64; N] = [0.0; N]; // shared f64 scratch (points, matrices, ...)
static mut IBUF: [i32; N] = [0; N]; // shared i32 scratch (indices)

// Callers read/write the shared buffers directly in the module's linear memory.
#[no_mangle]
pub extern "C" fn buffer_ptr() -> *mut f64 {
    unsafe { BUF.as_mut_ptr() }
}
#[no_mangle]
pub extern "C" fn ibuffer_ptr() -> *mut i32 {
    unsafe { IBUF.as_mut_ptr() }
}
#[no_mangle]
pub extern "C" fn buffer_len() -> usize {
    N
}

/// Sanity check.
#[no_mangle]
pub extern "C" fn add(a: f64, b: f64) -> f64 {
    a + b
}

/// Evaluate a cubic Bezier at t. BUF[0..12] = p0(3), c1(3), c2(3), p3(3);
/// writes the point to BUF[12..15].
#[no_mangle]
pub extern "C" fn bezier_eval(t: f64) {
    unsafe {
        let mt = 1.0 - t;
        let a = mt * mt * mt;
        let b = 3.0 * mt * mt * t;
        let c = 3.0 * mt * t * t;
        let d = t * t * t;
        for k in 0..3 {
            BUF[12 + k] = a * BUF[k] + b * BUF[3 + k] + c * BUF[6 + k] + d * BUF[9 + k];
        }
    }
}

/// 3x3 (row-major) matrix times a 3-vector. BUF[0..9] = M, BUF[9..12] = v;
/// writes BUF[12..15].
#[no_mangle]
pub extern "C" fn mat3_vec() {
    unsafe {
        for r in 0..3 {
            BUF[12 + r] = BUF[3 * r] * BUF[9] + BUF[3 * r + 1] * BUF[10] + BUF[3 * r + 2] * BUF[11];
        }
    }
}

/// De Casteljau split of a cubic (BUF[0..12]) at t into two cubics, written to
/// BUF[16..28] (left) and BUF[28..40] (right).
#[no_mangle]
pub extern "C" fn split_bezier(t: f64) {
    unsafe {
        let lerp = |i: usize, j: usize, o: usize| {
            for k in 0..3 {
                BUF[o + k] = BUF[i + k] + (BUF[j + k] - BUF[i + k]) * t;
            }
        };
        // ab, bc, cd at scratch 40,44,48 ; abc,bcd 52,56 ; abcd 60
        lerp(0, 3, 40);
        lerp(3, 6, 44);
        lerp(6, 9, 48);
        lerp(40, 44, 52);
        lerp(44, 48, 56);
        lerp(52, 56, 60);
        // left = p0, ab, abc, abcd
        for k in 0..3 {
            BUF[16 + k] = BUF[k];
            BUF[19 + k] = BUF[40 + k];
            BUF[22 + k] = BUF[52 + k];
            BUF[25 + k] = BUF[60 + k];
        }
        // right = abcd, bcd, cd, p3
        for k in 0..3 {
            BUF[28 + k] = BUF[60 + k];
            BUF[31 + k] = BUF[56 + k];
            BUF[34 + k] = BUF[48 + k];
            BUF[37 + k] = BUF[9 + k];
        }
    }
}

// Signed area sign of triangle (ax,ay)(bx,by)(cx,cy).
#[inline]
fn cross(ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> f64 {
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

#[inline]
fn point_in_tri(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64, cx: f64, cy: f64) -> bool {
    let d1 = cross(px, py, ax, ay, bx, by);
    let d2 = cross(px, py, bx, by, cx, cy);
    let d3 = cross(px, py, cx, cy, ax, ay);
    let has_neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(has_neg && has_pos)
}

/// Ear-clip a simple polygon of `count` 2D points stored at BUF[0..2*count]
/// ([x0,y0,x1,y1,...]). Writes flat triangle-index triples to IBUF and returns
/// the number of triangles.
#[no_mangle]
pub extern "C" fn earclip(count: i32) -> i32 {
    unsafe {
        let n = count as usize;
        if n < 3 {
            return 0;
        }
        // Remaining vertex indices in IBUF's tail region [N/2 ..].
        let base = N / 2;
        for i in 0..n {
            IBUF[base + i] = i as i32;
        }
        let px = |idx: i32| BUF[2 * idx as usize];
        let py = |idx: i32| BUF[2 * idx as usize + 1];

        // Polygon orientation (positive = CCW).
        let mut area = 0.0;
        for i in 0..n {
            let a = i as i32;
            let b = ((i + 1) % n) as i32;
            area += px(a) * py(b) - px(b) * py(a);
        }
        let ccw = area >= 0.0;

        let mut remaining = n;
        let mut out = 0usize; // triangle count
        let mut guard = 0usize;
        let mut i = 0usize;
        while remaining > 3 && guard < 4 * n * n {
            guard += 1;
            let cur = base + (i % remaining);
            let prev = base + ((i + remaining - 1) % remaining);
            let next = base + ((i + 1) % remaining);
            let ia = IBUF[prev];
            let ib = IBUF[cur];
            let ic = IBUF[next];
            let convex = if ccw {
                cross(px(ia), py(ia), px(ib), py(ib), px(ic), py(ic)) > 0.0
            } else {
                cross(px(ia), py(ia), px(ib), py(ib), px(ic), py(ic)) < 0.0
            };
            let mut ear = convex;
            if ear {
                // No other vertex inside the candidate ear.
                for k in 0..remaining {
                    let iv = IBUF[base + k];
                    if iv == ia || iv == ib || iv == ic {
                        continue;
                    }
                    if point_in_tri(
                        px(iv), py(iv), px(ia), py(ia), px(ib), py(ib), px(ic), py(ic),
                    ) {
                        ear = false;
                        break;
                    }
                }
            }
            if ear {
                IBUF[out * 3] = ia;
                IBUF[out * 3 + 1] = ib;
                IBUF[out * 3 + 2] = ic;
                out += 1;
                // Remove vertex `cur` by shifting the tail region down.
                let rem_idx = i % remaining;
                for k in rem_idx..(remaining - 1) {
                    IBUF[base + k] = IBUF[base + k + 1];
                }
                remaining -= 1;
                if i > 0 {
                    i -= 1;
                }
            } else {
                i += 1;
            }
        }
        // Final triangle.
        if remaining == 3 {
            IBUF[out * 3] = IBUF[base];
            IBUF[out * 3 + 1] = IBUF[base + 1];
            IBUF[out * 3 + 2] = IBUF[base + 2];
            out += 1;
        }
        out as i32
    }
}
