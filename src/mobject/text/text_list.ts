// TextList: a bulleted/numbered list of plain Text items, with nested
// sub-lists, indent levels, and depth-aware markers as first-class concepts.
// Mirrors BulletedList (tex_extras.ts, which does the same job for Tex/
// MathJax content) but for plain Text, and adds indentation so an outline no
// longer has to be hand-positioned with raw `point` math.
//
// Every row is positioned via `nextTo`/`alignTo` (real geometry, exactly
// like BulletedList/Paragraph) with `align: 'left'` on each Text -- not by
// estimating a string's rendered width. This matters even when no vector
// font is loaded (Text's raster fallback sizes its box from a rough
// per-character estimate, not real glyph metrics): `align: 'left'` anchors
// the canvas render at the box's left edge rather than its center, and
// alignTo() sets that edge as a rigid shift of the object's existing box --
// so the actual rendered left edge lands exactly where alignTo put it,
// independent of whether the box's width estimate is accurate. A center-
// anchored layout (the natural first thing to reach for) does NOT have this
// property: any error in the width estimate feeds directly into where
// centered text actually renders, which is what a hand-rolled bulleted demo
// under ecmanim/orrery hit in practice.

import { VGroup } from "../VMobject.ts";
import { Text } from "./Text.ts";
import type { TextConfig } from "./Text.ts";
import * as V from "../../core/math/vector.ts";
import type { ColorLike } from "../../core/types.ts";

/** A list item: a line of text, or a nested sub-list under the preceding item. */
export type ListItem = string | ListItem[];

export type MarkerFn = (index: number, depth: number) => string;

const DEFAULT_MARKERS = ["•", "◦", "▪"];

function defaultMarker(_index: number, depth: number): string {
  return DEFAULT_MARKERS[Math.min(depth, DEFAULT_MARKERS.length - 1)];
}

export interface TextListConfig extends TextConfig {
  /** Marker glyph for every item, or a function of (index, depth) -- e.g.
   *  `(i) => \`${i + 1}.\`` for an ordered list. Defaults to a depth-cycled
   *  bullet (•, then ◦, then ▪ for depth 2+), matching common outline style. */
  marker?: string | MarkerFn;
  /** Horizontal shift per nesting depth, in world units. */
  indent?: number;
  /** Vertical gap between rows. */
  buff?: number;
  /** Horizontal gap between a row's marker and its text. */
  markerBuff?: number;
  markerColor?: ColorLike;
}

interface Row {
  group: VGroup;
  marker: Text;
  content: Text;
  depth: number;
}

export class TextList extends VGroup {
  items: VGroup;
  rows: Row[];
  buff: number;
  indent: number;
  markerBuff: number;
  marker: string | MarkerFn;

  constructor(items: ListItem[], config: TextListConfig = {}) {
    super();

    const {
      marker = defaultMarker,
      indent = 0.6,
      buff = 0.35,
      markerBuff = 0.2,
      markerColor,
      ...textConfig
    } = config;

    this.marker = marker;
    this.indent = indent;
    this.buff = buff;
    this.markerBuff = markerBuff;

    const rows: Row[] = [];
    let counter = 0;
    const resolveMarker = (depth: number): string =>
      typeof marker === "function" ? marker(counter, depth) : marker;

    const buildRows = (list: ListItem[], depth: number) => {
      for (const item of list) {
        if (Array.isArray(item)) {
          buildRows(item, depth + 1);
          continue;
        }
        const markerText = resolveMarker(depth);
        counter += 1;
        const markerMob = new Text(markerText, {
          ...textConfig,
          align: "left",
          color: markerColor ?? textConfig.color,
        });
        const content = new Text(item, { ...textConfig, align: "left" });
        content.nextTo(markerMob, V.RIGHT, markerBuff);
        const group = new VGroup(markerMob, content);
        rows.push({ group, marker: markerMob, content, depth });
      }
    };
    buildRows(items, 0);

    for (let i = 1; i < rows.length; i++) {
      rows[i].group.nextTo(rows[i - 1].group, V.DOWN, this.buff);
    }

    // Pin each row's marker to its depth's indent column -- a rigid shift of
    // the row's own box (see module doc), not a width-based computation.
    if (rows.length > 0) {
      const baseX = rows[0].group.getLeft()[0];
      for (const row of rows) {
        row.group.alignTo([baseX + row.depth * this.indent, 0, 0], V.LEFT);
      }
    }

    this.rows = rows;
    this.items = new VGroup(...rows.map((r) => r.group));
    this.add(...rows.map((r) => r.group));
    this.center();
  }

  /** The marker Text mobject for row `i` (in document order, depth-first). */
  getMarker(i: number): Text {
    return this.rows[i].marker;
  }

  /** The content Text mobject for row `i` (in document order, depth-first). */
  getContent(i: number): Text {
    return this.rows[i].content;
  }
}
