struct VertexOutput {
   [[builtin(position)]] pos: vec4<f32>;
   [[location(0)]] color: vec3<f32>;
};

[[block]]
struct Locals {
    transform: mat4x4<f32>;
};
[[group(0), binding(0)]]
var<uniform> r_locals: Locals;

[[stage(vertex)]]
fn vs_main([[location(0)]] pos: vec3<f32>, [[location(1)]] color: vec3<f32>) -> VertexOutput {

    return VertexOutput(
        r_locals.transform * vec4<f32>(pos.x, pos.y, pos.z, 1.0),
        color);
}

[[stage(fragment)]]
fn fs_main([[location(0)]] color: vec3<f32>) -> [[location(0)]] vec4<f32> {
    return vec4<f32>(color, 1.0);
}
