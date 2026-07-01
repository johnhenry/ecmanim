// Matrix mobjects: a grid of element mobjects wrapped in a pair of tall square
// brackets. Ported from ManimCommunity's manim/mobject/matrix.py. Elements are
// laid out in a grid via arrangeInGrid, then bracket VMobjects are built as
// square-bracket outlines sized to the grid's height.

import { VMobject, VGroup } from "./VMobject.ts";
import { Mobject, Group } from "./Mobject.ts";
import { MathTex } from "./mathtex.ts";
import { DecimalNumber, Integer } from "./value_tracker.ts";
import * as V from "../core/math/vector.ts";

/** Configuration for the Matrix family of mobjects. */
export interface MatrixConfig {
  v_buff?: number;
  h_buff?: number;
  bracket_h_buff?: number;
  bracket_v_buff?: number;
  left_bracket?: string;
  right_bracket?: string;
  add_background_rectangles_to_entries?: boolean;
  include_background_rectangle?: boolean;
  element_alignment_corner?: number[];
  element_to_mobject?: (element: any) => Mobject;
  element_to_mobject_config?: Record<string, any>;
  bracket_config?: Record<string, any>;
  [key: string]: any;
}

const DEFAULT_V_BUFF = 0.8;
const DEFAULT_H_BUFF = 1.3;
const DEFAULT_BRACKET_H_BUFF = 0.25;
const DEFAULT_BRACKET_V_BUFF = 0.25;

// Convert a plain string / number into a MathTex mobject. Anything already a
// Mobject is returned unchanged (used by MobjectMatrix).
function defaultElementToMobject(element: any, config: Record<string, any> = {}): Mobject {
  if (element instanceof Mobject) return element;
  return new MathTex(String(element), config);
}

export class Matrix extends VGroup {
  mob_matrix: Mobject[][];
  elements: Mobject[];
  brackets: VGroup;
  v_buff: number;
  h_buff: number;
  bracket_h_buff: number;
  bracket_v_buff: number;
  left_bracket!: VMobject;
  right_bracket!: VMobject;
  element_alignment_corner: number[];

  constructor(rows: any[][], config: MatrixConfig = {}) {
    super();
    this.v_buff = config.v_buff ?? DEFAULT_V_BUFF;
    this.h_buff = config.h_buff ?? DEFAULT_H_BUFF;
    this.bracket_h_buff = config.bracket_h_buff ?? DEFAULT_BRACKET_H_BUFF;
    this.bracket_v_buff = config.bracket_v_buff ?? DEFAULT_BRACKET_V_BUFF;
    this.element_alignment_corner = config.element_alignment_corner ?? V.DR;

    const toMob = config.element_to_mobject ?? this.elementToMobject.bind(this);
    const elemConfig = config.element_to_mobject_config ?? {};

    // Build the 2D matrix of element mobjects.
    const nRows = rows.length;
    const nCols = nRows > 0 ? rows[0].length : 0;
    this.mob_matrix = [];
    this.elements = [];
    for (let i = 0; i < nRows; i++) {
      const rowMobs: Mobject[] = [];
      for (let j = 0; j < nCols; j++) {
        const mob = toMob(rows[i][j], elemConfig);
        rowMobs.push(mob);
        this.elements.push(mob);
      }
      this.mob_matrix.push(rowMobs);
    }

    // Group all elements and arrange them into a grid.
    const elementsGroup = new VGroup(...this.elements);
    if (this.elements.length > 0) {
      elementsGroup.arrangeInGrid({
        rows: nRows,
        cols: nCols,
        buff: [this.h_buff, this.v_buff],
      });
    }
    this.add(elementsGroup);
    this._entriesGroup = elementsGroup;

    // Build and add the brackets.
    this.addBrackets(
      config.left_bracket ?? "[",
      config.right_bracket ?? "]",
    );
    this.center();
  }

  private _entriesGroup!: VGroup;

  // Subclasses override this to choose the element mobject type.
  protected elementToMobject(element: any, config: Record<string, any> = {}): Mobject {
    return defaultElementToMobject(element, config);
  }

  // Build tall square brackets flanking the entries. Each bracket is a VMobject
  // whose outline is a square-bracket shape ( "[" style: three straight edges ).
  addBrackets(leftStr = "[", rightStr = "]"): this {
    const bbox = this._entriesGroup.getBoundingBox();
    const height = bbox.max[1] - bbox.min[1] + 2 * this.bracket_v_buff;
    const width = Math.max(0.2, height * 0.15);
    const half = height / 2;

    // Left bracket "[": top -> left -> bottom (open to the right).
    const left = new VMobject({ strokeWidth: 0, fillOpacity: 1 });
    left.setPointsAsCorners([
      [width, half, 0],
      [0, half, 0],
      [0, -half, 0],
      [width, -half, 0],
    ]);

    // Right bracket "]": mirror of the left (open to the left).
    const right = new VMobject({ strokeWidth: 0, fillOpacity: 1 });
    right.setPointsAsCorners([
      [-width, half, 0],
      [0, half, 0],
      [0, -half, 0],
      [-width, -half, 0],
    ]);

    // Give the brackets a visible stroke so they draw like manim's LaTeX brackets.
    for (const b of [left, right]) {
      b.setStroke("#FFFFFF", 4, 1);
      b.setFill("#FFFFFF", 0);
    }

    // Position the brackets just outside the entries.
    const cy = (bbox.max[1] + bbox.min[1]) / 2;
    left.moveTo([bbox.min[0] - this.bracket_h_buff - width / 2, cy, 0]);
    right.moveTo([bbox.max[0] + this.bracket_h_buff + width / 2, cy, 0]);

    this.left_bracket = left;
    this.right_bracket = right;
    this.brackets = new VGroup(left, right);
    this.add(this.brackets);
    return this;
  }

  // --- accessors ----------------------------------------------------------
  // Rows as a VGroup of VGroups (one per matrix row).
  getRows(): VGroup {
    const rows = new VGroup();
    for (const rowMobs of this.mob_matrix) {
      rows.add(new VGroup(...rowMobs));
    }
    return rows;
  }

  // Columns as a VGroup of VGroups (one per matrix column).
  getColumns(): VGroup {
    const cols = new VGroup();
    const nCols = this.mob_matrix.length > 0 ? this.mob_matrix[0].length : 0;
    for (let j = 0; j < nCols; j++) {
      const colMobs: Mobject[] = [];
      for (let i = 0; i < this.mob_matrix.length; i++) colMobs.push(this.mob_matrix[i][j]);
      cols.add(new VGroup(...colMobs));
    }
    return cols;
  }

  // Flat VGroup of every entry mobject (row-major order).
  getEntries(): VGroup {
    return new VGroup(...this.elements);
  }

  getBrackets(): VGroup {
    return this.brackets;
  }

  getMobMatrix(): Mobject[][] {
    return this.mob_matrix;
  }

  // Set the color of every entry (not the brackets).
  setColumnColors(...colors: any[]): this {
    const cols = this.getColumns();
    for (let j = 0; j < cols.submobjects.length && j < colors.length; j++) {
      cols.submobjects[j].setColor(colors[j]);
    }
    return this;
  }
}

// Elements coerced to DecimalNumber mobjects.
export class DecimalMatrix extends Matrix {
  protected elementToMobject(element: any, config: Record<string, any> = {}): Mobject {
    if (element instanceof Mobject) return element;
    return new DecimalNumber(Number(element), config);
  }
}

// Elements coerced to Integer mobjects.
export class IntegerMatrix extends Matrix {
  protected elementToMobject(element: any, config: Record<string, any> = {}): Mobject {
    if (element instanceof Mobject) return element;
    return new Integer(Number(element), config);
  }
}

// Elements are assumed to already be mobjects.
export class MobjectMatrix extends Matrix {
  protected elementToMobject(element: any): Mobject {
    if (element instanceof Mobject) return element;
    throw new Error("MobjectMatrix expects each element to already be a Mobject.");
  }
}

// A determinant label |A| built from vertical bars around a Matrix. Returns a
// Group of the two bars; typically added alongside the matrix.
export function get_det_text(
  matrix: Matrix,
  determinant?: string | number,
  backgroundRectangle = false,
  initialScaleFactor = 0.7,
): Group {
  void backgroundRectangle;
  const bbox = matrix.getBoundingBox();
  const height = bbox.max[1] - bbox.min[1];
  const parenScale = (height / 2) * initialScaleFactor;
  const leftBar = new MathTex("|", { fontSize: parenScale });
  const rightBar = new MathTex("|", { fontSize: parenScale });
  leftBar.nextTo(matrix, V.LEFT, 0.1);
  rightBar.nextTo(matrix, V.RIGHT, 0.1);
  const group = new Group(leftBar, rightBar);
  if (determinant !== undefined) {
    const eq = new MathTex("=" + String(determinant), { fontSize: parenScale });
    eq.nextTo(matrix, V.RIGHT, 0.3);
    group.add(eq);
  }
  return group;
}

// Convenience wrapper: build a Matrix from a 2D array.
export function matrix_to_mobject(matrix: any[][], config: MatrixConfig = {}): Matrix {
  return new Matrix(matrix, config);
}
