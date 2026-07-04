import { test } from "node:test";
import assert from "node:assert/strict";

import { alwaysRedraw } from "../src/mobject/value_tracker.ts";
import { Circle, Line } from "../src/mobject/geometry.ts";
import { Text } from "../src/mobject/text/Text.ts";
import { Group } from "../src/mobject/Mobject.ts";

test("alwaysRedraw rebuilds geometry from fn() on update", () => {
  let radius = 1;
  const mob = alwaysRedraw(() => new Circle({ radius }));
  const w1 = mob.getWidth();
  radius = 2;
  mob.update(0);
  assert.ok(mob.getWidth() > w1 * 1.5);
});

test("alwaysRedraw copies custom fields too, not just the old hardcoded 7-field allowlist", () => {
  let value = 1;
  const mob: any = alwaysRedraw(() => {
    const c: any = new Circle({ radius: 1 });
    c.myCustomField = value;
    return c;
  });
  assert.equal(mob.myCustomField, 1);
  value = 5;
  mob.update(0);
  assert.equal(mob.myCustomField, 5);
});

test("alwaysRedraw copies 'radius' -- previously missing from its own allowlist (reactive()'s had it, this one didn't)", () => {
  let radius = 1;
  const mob: any = alwaysRedraw(() => new Circle({ radius }));
  radius = 3;
  mob.update(0);
  assert.equal(mob.radius, 3);
});

// Regression test for GitHub issue #18: alwaysRedraw() used to copy the
// redundant "color" field AFTER "fillColor"/"strokeColor", clobbering them
// right back via color's cascading setter -- silently resetting a colored
// Text (or every child of a colored Group) to white on the very first
// update tick. Fixed by copyMemberwiseStyle()'s denylist, which excludes
// "color"/"_color" entirely (src/mobject/copy_style.ts).
test("issue #18 case 1: a colored Text keeps its color after an update tick", () => {
  const wrapped: any = alwaysRedraw(() =>
    new Text("stay: 33.4%", { fontSize: 0.32, color: "#E8833A", point: [1, 1, 0] }),
  );
  assert.equal(wrapped.fillColor.toHex(), "#e8833a");
  for (const u of wrapped.updaters) u(wrapped);
  assert.equal(wrapped.fillColor.toHex(), "#e8833a", "color must survive an update tick");
});

test("issue #18 case 2: a Group of individually-colored children keeps their colors after an update tick", () => {
  const wrapped: any = alwaysRedraw(() => {
    const l = new Line([0, 0, 0], [1, 1, 0]);
    l.setColor("#E8833A");
    return new Group(l);
  });
  assert.equal(wrapped.submobjects[0].fillColor.toHex(), "#e8833a");
  for (const u of wrapped.updaters) u(wrapped);
  assert.equal(
    wrapped.submobjects[0].fillColor.toHex(),
    "#e8833a",
    "the Group's own cascading setColor(white) must not wipe an already-correctly-colored child",
  );
});
