import { test } from "node:test";
import assert from "node:assert/strict";

import { alwaysRedraw } from "../src/mobject/value_tracker.ts";
import { Circle } from "../src/mobject/geometry.ts";

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
