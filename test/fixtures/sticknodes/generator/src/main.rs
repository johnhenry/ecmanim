//! Generates `.nodes` fixtures + sticknodes-rs read-back JSON dumps.
//! Usage: sn-fixturegen <out_dir>
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf};
use sticknodes_rs::*;

fn c(r: u8, g: u8, b: u8, a: u8) -> Color { Color::from_rgba(r, g, b, a) }

fn opts(t: NodeType, len: f32, angle: f32) -> NodeOptions {
    // NodeOptions has a crate-private field, so struct-update syntax is unavailable.
    let mut o = NodeOptions::default();
    o.node_type = t;
    o.length = len; o.default_length = len;
    o.local_angle = angle; o.default_local_angle = angle; o.default_angle = angle;
    o
}

/// `NodeOptions.thickness` is crate-private, so set `Node.thickness` after construction.
fn mk(o: NodeOptions, thick: i32) -> Node {
    let mut n = Node::from_options(o);
    n.thickness = thick;
    n
}

fn seg(len: f32, angle: f32, thick: i32) -> Node {
    let mut o = opts(NodeType::RoundedSegment, len, angle);
    o.default_thickness = thick;
    mk(o, thick)
}

fn new_fig(version: i32, build: i32) -> Stickfigure {
    let mut f = Stickfigure::new();
    f.version = version;
    f.build = build;
    f
}

fn idx(i: i32) -> DrawOrderIndex { DrawOrderIndex(i) }

/// A small humanoid: root -> spine -> {head, 2 arms(+forearms), 2 legs(+shins)}
fn humanoid(version: i32, build: i32, fancy: bool) -> Stickfigure {
    let mut f = new_fig(version, build);
    f.scale = 1.25;
    f.color = c(10, 20, 30, 255);
    let spine = f.add_node(seg(120.0, 90.0, 28), idx(0)).unwrap();
    let mut head_o = opts(NodeType::FilledCircle, 40.0, 10.0);
    head_o.default_thickness = 60;
    head_o.use_segment_color = true; head_o.color = c(200, 30, 40, 200);
    let head = f.add_node(mk(head_o, 60), spine).unwrap();
    let la = f.add_node(seg(70.0, 150.0, 20), spine).unwrap();
    let _lf = f.add_node(seg(60.0, -35.5, 18), la).unwrap();
    let ra = f.add_node(seg(70.0, 30.0, 20), spine).unwrap();
    let _rf = f.add_node(seg(60.0, 12.25, 18), ra).unwrap();
    let ll = f.add_node(seg(90.0, -120.0, 24), idx(0)).unwrap();
    let _ls = f.add_node(seg(85.0, -80.0, 22), ll).unwrap();
    let rl = f.add_node(seg(90.0, -60.0, 24), idx(0)).unwrap();
    let rs = f.add_node(seg(85.0, -100.0, 22), rl).unwrap();
    if fancy {
        let mut o = opts(NodeType::Segment, 30.0, 45.0);
        o.use_segment_color = true; o.color = c(0, 128, 255, 77);
        o.use_gradient = true; o.reverse_gradient = true; o.gradient_mode = GradientMode::Sideways;
        o.gradient_color = c(255, 255, 0, 255);
        o.is_static = true; o.is_stretchy = true;
        o.use_segment_scale = true; o.scale = 1.5;
        let foot = f.add_node(Node::from_options(o), rs).unwrap();
        f.add_polyfill(Polyfill {
            anchor_node_draw_index: spine,
            color: c(5, 200, 100, 180),
            use_polyfill_color: true,
            attached_node_draw_indices: vec![la, ra, ll, rl, foot],
        });
        f.add_polyfill(Polyfill {
            anchor_node_draw_index: head,
            color: c(1, 2, 3, 255),
            use_polyfill_color: false,
            attached_node_draw_indices: vec![spine],
        });
    }
    f
}

/// One node of every type with distinctive per-type options.
fn shapes(version: i32, build: i32) -> Stickfigure {
    let mut f = new_fig(version, build);
    f.color = c(240, 240, 240, 255);
    let hub = f.add_node(seg(50.0, 0.0, 16), idx(0)).unwrap();

    let mut o = opts(NodeType::Circle, 30.0, 20.0);
    o.use_circle_outline = true; o.circle_is_hollow = true; o.circle_outline_color = c(9, 8, 7, 255);
    o.use_segment_color = true; o.color = c(250, 0, 0, 255);
    f.add_node(Node::from_options(o), hub).unwrap();

    let mut o = opts(NodeType::Ellipse, 44.0, 70.0);
    o.default_thickness = 36;
    f.add_node(mk(o, 36), hub).unwrap();

    let mut o = opts(NodeType::Triangle, 55.0, 100.0);
    o.triangle_type = TriangleType::Isosceles; o.triangle_upside_down = true;
    o.default_thickness = 40;
    f.add_node(mk(o, 40), hub).unwrap();

    let mut o = opts(NodeType::Triangle, 55.0, 130.0);
    o.triangle_type = TriangleType::RightTriangle; o.triangle_flipped = true;
    f.add_node(Node::from_options(o), hub).unwrap();

    let mut o = opts(NodeType::Triangle, 55.0, 160.0);
    o.triangle_type = TriangleType::RightTriangle; o.triangle_flipped = false;
    f.add_node(Node::from_options(o), hub).unwrap();

    let mut o = opts(NodeType::Trapezoid, 65.0, -20.0);
    o.default_thickness = 40;
    o.trapezoid_thickness_start = 44.0; o.trapezoid_thickness_end = 12.0;
    o.trapezoid_is_rounded_start = true; o.trapezoid_is_rounded_end = false;
    f.add_node(mk(o, 40), hub).unwrap();

    let mut o = opts(NodeType::Polygon, 35.0, -70.0);
    o.num_polygon_vertices = 6;
    f.add_node(Node::from_options(o), hub).unwrap();

    let mut o = opts(NodeType::RoundedSegment, 80.0, -110.0);
    o.segment_curve_radius_and_default_curve_radius = 25;
    o.curve_circulization = true; o.half_arc = true; o.segment_curve_polyfill_precision = 3;
    f.add_node(Node::from_options(o), hub).unwrap();
    f
}

/// Angle locks, drag lock, smart stretch, floaty (modern builds only).
fn flags(version: i32, build: i32) -> Stickfigure {
    let mut f = new_fig(version, build);
    let a = f.add_node(seg(60.0, 45.0, 20), idx(0)).unwrap();
    let mut o = opts(NodeType::RoundedSegment, 60.0, 15.0);
    o.angle_lock_mode = AngleLockMode::Absolute;
    f.add_node(Node::from_options(o), a).unwrap();
    let mut o = opts(NodeType::RoundedSegment, 60.0, -15.0);
    o.angle_lock_mode = AngleLockMode::Relative; o.angle_lock_relative_multiplier = 2;
    f.add_node(Node::from_options(o), a).unwrap();
    let mut o = opts(NodeType::RoundedSegment, 60.0, 77.0);
    o.is_drag_locked = true; o.drag_lock_angle = 33.5;
    o.is_smart_stretch = true; o.do_not_apply_smart_stretch = true; o.smart_stretch_multiplier = 1.75;
    o.is_floaty = true; o.smart_stretch_reset_impulse = true;
    f.add_node(Node::from_options(o), a).unwrap();
    f
}

/// Connector nodes (builds >= 38). Each connector is an ONLY child of its
/// parent: sticknodes-rs's writer emits the per-child connector flags in
/// `get_children` order but the children themselves in reverse order, so a
/// connector sharing a parent with a plain sibling is mis-paired on read-back.
fn connectors(version: i32, build: i32) -> Stickfigure {
    let mut f = new_fig(version, build);
    let a = f.add_node(seg(100.0, 0.0, 20), idx(0)).unwrap();
    let b = f.add_node(seg(100.0, 90.0, 20), a).unwrap();
    let mut o = opts(NodeType::RoundedSegment, 60.0, 45.0);
    o.connector_data = Some(ConnectorData {
        local_x: 12.5, local_y: -7.25, percent: 0.4, percent_default: 0.35, value: 33.0,
        method: ConnectorMethod::ByValue, reversed: true, smart_stretch_ancestral_value: 1.5,
        end_node_draw_index: a,
    });
    let k1 = f.add_node(mk(o, 20), b).unwrap();
    let d = f.add_node(seg(30.0, -10.0, 12), k1).unwrap();
    let mut o = opts(NodeType::RoundedSegment, 40.0, -45.0);
    o.connector_data = Some(ConnectorData {
        local_x: 1.0, local_y: 2.0, percent: 0.75, percent_default: 0.75, value: 0.0,
        method: ConnectorMethod::ByPercent, reversed: false, smart_stretch_ancestral_value: 1.0,
        end_node_draw_index: b,
    });
    f.add_node(mk(o, 20), d).unwrap();
    f
}

fn dump(bytes: &[u8]) -> Value {
    let f = Stickfigure::from_bytes(bytes.to_vec()).expect("sticknodes-rs failed to read back its own file");
    let ser = f.to_serializable();
    let mut v = serde_json::to_value(&ser).unwrap();
    // add geometry sticknodes-rs derives from lengths + angles (y-up, cos/sin)
    let mut geo = serde_json::Map::new();
    for i in f.get_all_node_indices() {
        let n = f.get_node(i).unwrap().borrow();
        let p = n.get_local_position(&f);
        let s = n.get_global_start(&f);
        let e = n.get_global_end(&f);
        geo.insert(i.0.to_string(), json!({
            "parent": f.get_parent(i).map(|d| d.0),
            "localX": p.x, "localY": p.y,
            "globalStart": [s.x, s.y], "globalEnd": [e.x, e.y],
            "globalAngle": n.get_global_angle(&f),
        }));
    }
    v["geometry"] = Value::Object(geo);
    v
}

fn main() {
    let out = PathBuf::from(env::args().nth(1).expect("usage: sn-fixturegen <out_dir>"));
    fs::create_dir_all(&out).unwrap();
    let figs: Vec<(&str, Stickfigure)> = vec![
        ("humanoid-423-72", humanoid(423, 72, true)),
        ("humanoid-403-50", humanoid(403, 50, true)),
        ("humanoid-403-21", humanoid(403, 21, true)),
        ("humanoid-300", humanoid(300, 0, false)),
        ("humanoid-250-polyfill", humanoid(250, 0, true)),
        ("shapes-423-72", shapes(423, 72)),
        ("shapes-403-64", shapes(403, 64)),
        ("shapes-320", shapes(320, 0)),
        ("flags-423-72", flags(423, 72)),
        ("flags-403-57", flags(403, 57)),
        ("flags-403-45", flags(403, 45)),
        ("connectors-423-72", connectors(423, 72)),
        ("connectors-403-44", connectors(403, 44)),
    ];
    for (name, f) in figs {
        let bytes = f.to_bytes().unwrap_or_else(|e| panic!("write {name}: {e:?}"));
        fs::write(out.join(format!("{name}.nodes")), &bytes).unwrap();
        let v = dump(&bytes);
        fs::write(out.join(format!("{name}.json")), serde_json::to_string_pretty(&v).unwrap() + "\n").unwrap();
        println!("{name}: {} bytes", bytes.len());
    }
}
